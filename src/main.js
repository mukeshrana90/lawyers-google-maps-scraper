import { Actor } from 'apify';
import { PlaywrightCrawler, Dataset, RequestQueue } from 'crawlee';
import { scrapeMapResults } from './scraper.js';
import { extractBestEmail, extractSocialLinks, tryContactPage } from './enricher.js';
import {
    enrichLawyerFields,
    extractPracticeAreasFromCurrentPage,
    extractFeeStructureFromCurrentPage,
    extractLanguagesFromCurrentPage,
    extractServicesFromCurrentPage,
} from './lawyerEnrichment.js';
import {
    applyLawyerNicheFilters,
    applyFirmSizeClassification,
    detectBookingFromCurrentWebsite,
    detectFreeConsultFromCurrentWebsite,
} from './lawyerNiche.js';
import { buildSearchUrls, log, navigateWithRetry, randomDelay } from './utils.js';

await Actor.init();

// ── Input ────────────────────────────────────────────────────────────────────
const input = await Actor.getInput() ?? {};
const {
    searchTerms        = ['personal injury lawyer'],
    locations          = ['New York, USA'],
    maxResults         = 100,
    enrichEmails       = false,
    enrichSocials      = false,
    enrichLawyer       = false,
    enrichLawyerNiche  = false,
    minRating          = 0,
    proxyConfig,
} = input;

// ── Proxy ────────────────────────────────────────────────────────────────────
let proxy;
try {
    const cfg = proxyConfig ? { ...proxyConfig } : { useApifyProxy: true };
    delete cfg.apifyProxyGroups;
    log.info('Proxy config', cfg);
    proxy = await Actor.createProxyConfiguration(cfg);
} catch (e) {
    log.warning(`Proxy setup failed (${e.message}), running without proxy`);
    proxy = undefined;
}

// ── Request queue ────────────────────────────────────────────────────────────
const requestQueue = await RequestQueue.open();

const searchUrls = buildSearchUrls(searchTerms, locations);
for (const { url, label, meta } of searchUrls) {
    await requestQueue.addRequest({ url, label, userData: { meta } });
}

log.info(`Queued ${searchUrls.length} search(es) across ${locations.length} location(s)`);

// ── Results store (dedup by placeId) ─────────────────────────────────────────
const seen = new Set();
let totalScraped = 0;

const crawler = new PlaywrightCrawler({
    requestQueue,
    proxyConfiguration: proxy,
    maxRequestRetries: 1,
    maxConcurrency: 2,
    requestHandlerTimeoutSecs: 900,
    navigationTimeoutSecs: 60,

    // Google Maps almost never reaches the default 'load' state cleanly
    // (analytics / tiles keep streaming), so wait only for DOMContentLoaded.
    preNavigationHooks: [
        (_ctx, gotoOptions) => { gotoOptions.waitUntil = 'domcontentloaded'; },
    ],

    launchContext: {
        launchOptions: {
            headless: true,
            args: [
                '--lang=en-US',
                '--no-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-setuid-sandbox',
            ],
        },
    },

    async requestHandler({ request, page, log: crawlLog }) {
        const { label, userData: { meta } } = request;

        await dismissConsentDialog(page);

        if (totalScraped >= maxResults) {
            crawlLog.info('Max results already reached — skipping remaining searches.');
            return;
        }

        if (label === 'MAPS_SEARCH') {
            crawlLog.info(`Scraping: ${meta.term} in ${meta.location}`);

            const places = await scrapeMapResults(page, {
                maxResults,
                searchTerm: meta.term,
                location:   meta.location,
            });

            crawlLog.info(`Found ${places.length} places`);

            for (const place of places) {
                if (seen.has(place.placeId)) continue;
                seen.add(place.placeId);

                if (minRating > 0 && place.rating < minRating) continue;

                // Reserve a result slot synchronously — before any `await` below —
                // so concurrent request handlers can't both pass the cap check and
                // overshoot. `maxResults` is a GLOBAL limit across every
                // term × location search, not a per-search limit.
                if (totalScraped >= maxResults) {
                    crawlLog.info('Max results reached — stopping.');
                    break;
                }
                totalScraped++;

                let enriched = { ...place };

                // ── PHASE 1: Maps Overview tab ────────────────────────────────
                // Niche detection runs BEFORE lawyer enrichment because the
                // latter clicks the Reviews tab.
                if (enrichLawyer || enrichLawyerNiche) {
                    try {
                        await navigateWithRetry(page, place.mapsUrl, { timeout: 60_000, retries: 2 });
                        await Promise.race([
                            page.waitForSelector('h1.DUwDvf',          { timeout: 10_000 }),
                            page.waitForSelector('h1.fontHeadlineLarge',{ timeout: 10_000 }),
                            page.waitForSelector('div[role="main"] h1',{ timeout: 10_000 }),
                            page.waitForSelector('h1',                 { timeout: 10_000 }),
                        ]).catch(() => {});

                        if (enrichLawyerNiche) {
                            enriched = await applyLawyerNicheFilters(page, enriched);
                        }
                        if (enrichLawyer) {
                            enriched = await enrichLawyerFields(page, enriched);
                        }
                    } catch (e) {
                        crawlLog.warning(`Maps enrichment failed for ${place.name}: ${e.message}`);
                    }
                }

                // ── PHASE 2: Single firm-website visit ────────────────────────
                const needsWebsite = place.website && (
                    enrichEmails || enrichSocials
                    || (enrichLawyer       && !enriched.practiceAreas)
                    || enrichLawyer  // also: fee structure, languages, services always benefit from website
                    || (enrichLawyerNiche  && !enriched.hasOnlineBooking)
                    || (enrichLawyerNiche  && !enriched.hasFreeConsultation)
                );

                if (needsWebsite) {
                    try {
                        // Use the same retry / partial-load strategy as Maps nav so a
                        // single slow website doesn't discard the Maps record we already
                        // have. `ok === false` means every attempt hit a hard error.
                        const ok = await navigateWithRetry(page, place.website, { timeout: 15_000, retries: 1 });
                        if (!ok) throw new Error('website unreachable');
                        await randomDelay(1000, 2000);

                        const html = await page.content();

                        if (enrichEmails) {
                            enriched.email = extractBestEmail(html, place.website);
                        }
                        if (enrichSocials) {
                            Object.assign(enriched, extractSocialLinks(html));
                        }
                        if (enrichLawyer) {
                            // Practice areas: merge Maps signals + website scan
                            const sitePractices = await extractPracticeAreasFromCurrentPage(page);
                            if (sitePractices) {
                                const union = new Set([...(enriched.practiceAreas ?? []), ...sitePractices]);
                                enriched.practiceAreas = [...union];
                            }
                            // Fee structure: website-only
                            enriched.feeStructure = await extractFeeStructureFromCurrentPage(page);
                            // Languages: merge Maps + website
                            const siteLangs = await extractLanguagesFromCurrentPage(page);
                            if (siteLangs) {
                                const union = new Set([...(enriched.languagesSpoken ?? []), ...siteLangs]);
                                enriched.languagesSpoken = [...union];
                            }
                            // Services: website-only
                            enriched.servicesOffered = await extractServicesFromCurrentPage(page);
                        }
                        if (enrichLawyerNiche && !enriched.hasOnlineBooking) {
                            const b = await detectBookingFromCurrentWebsite(page);
                            if (b.found) {
                                enriched.hasOnlineBooking = true;
                                enriched.bookingPlatform  = b.platform;
                                enriched.bookingUrl       = b.url ?? place.website;
                            }
                        }
                        if (enrichLawyerNiche && !enriched.hasFreeConsultation) {
                            const f = await detectFreeConsultFromCurrentWebsite(page);
                            if (f.found) {
                                enriched.hasFreeConsultation      = true;
                                enriched.freeConsultationEvidence = f.evidence;
                                enriched.freeConsultationUrl      = f.url ?? null;
                            }
                        }

                        if (enrichEmails && !enriched.email) {
                            enriched.email = await tryContactPage(page, place.website);
                        }
                    } catch (e) {
                        crawlLog.warning(`Website phase failed for ${place.name}: ${e.message}`);
                    }
                }

                // ── PHASE 3: Firm-size classification (pure compute) ──────────
                if (enrichLawyerNiche) {
                    applyFirmSizeClassification(enriched);
                }

                await Dataset.pushData(toOutputSchema(enriched, { enrichEmails, enrichSocials, enrichLawyer, enrichLawyerNiche }));

                // Per-enrichment PPE charges. Bill ONLY when the enrichment actually
                // produced data — never on an empty or failed attempt. No-op if PPE
                // isn't configured.
                const charges = [];
                if (enrichEmails && enriched.email) {
                    charges.push('email-enrichment');
                }
                if (enrichSocials && (enriched.instagram || enriched.facebook || enriched.linkedin || enriched.twitter)) {
                    charges.push('social-enrichment');
                }
                if (enrichLawyer && (
                    enriched.practiceAreas?.length
                    || enriched.feeStructure?.length
                    || enriched.languagesSpoken?.length
                    || enriched.servicesOffered?.length
                    || enriched.reviewSentiment
                )) {
                    charges.push('lawyer-enrichment');
                }
                if (enrichLawyerNiche && (
                    enriched.hasOnlineBooking
                    || enriched.hasFreeConsultation
                    || enriched.isMetroArea
                    || (enriched.firmSize && enriched.firmSize !== 'unknown')
                )) {
                    charges.push('niche-enrichment');
                }
                for (const eventName of charges) {
                    await Actor.charge({ eventName }).catch(e =>
                        crawlLog.warning(`charge ${eventName} failed: ${e.message}`),
                    );
                }
            }
        }
    },

    failedRequestHandler({ request }, err) {
        log.error(`Request failed: ${request.url} — ${err.message}`);
    },
});

await crawler.run();

log.info(`Done. Total unique results saved: ${totalScraped}`);
await Actor.exit();

// ── Helpers ───────────────────────────────────────────────────────────────────

async function dismissConsentDialog(page) {
    try {
        const selectors = [
            'button[aria-label="Accept all"]',
            'button[aria-label="Alle akzeptieren"]',
            'button[aria-label="Tout accepter"]',
            'form[action*="consent"] button',
            '[data-ved] button:has-text("Accept all")',
            'button:has-text("I agree")',
        ];
        for (const sel of selectors) {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await btn.click();
                await page.waitForTimeout(1000);
                return;
            }
        }
    } catch { /* no dialog */ }
}

/** CRM-ready output shape */
function toOutputSchema(place, opts = {}) {
    const out = {
        name:           place.name           ?? null,
        category:       place.category       ?? null,
        subCategories:  place.subCategories  ?? null,

        address:        place.address        ?? null,
        fullAddress:    place.fullAddress    ?? null,
        city:           place.city           ?? null,
        state:          place.state          ?? null,
        country:        place.country        ?? null,
        postalCode:     place.postalCode     ?? null,
        latitude:       place.latitude       ?? null,
        longitude:      place.longitude      ?? null,

        phone:          place.phone          ?? null,
        website:        place.website        ?? null,

        rating:         place.rating         ?? null,
        reviewCount:    place.reviewCount    ?? null,

        hours:          place.hours          ?? null,
        isOpenNow:      place.isOpenNow      ?? null,

        placeId:        place.placeId        ?? null,
        mapsUrl:        place.mapsUrl        ?? null,
        scrapedAt:      new Date().toISOString(),
        searchTerm:     place.searchTerm     ?? null,
        searchLocation: place.searchLocation ?? null,
    };

    if (opts.enrichEmails) {
        out.email = place.email ?? null;
    }
    if (opts.enrichSocials) {
        out.instagram = place.instagram ?? null;
        out.facebook  = place.facebook  ?? null;
        out.linkedin  = place.linkedin  ?? null;
        out.twitter   = place.twitter   ?? null;
    }
    if (opts.enrichLawyer) {
        out.practiceAreas    = place.practiceAreas    ?? null;
        out.feeStructure     = place.feeStructure     ?? null;
        out.languagesSpoken  = place.languagesSpoken  ?? null;
        out.servicesOffered  = place.servicesOffered  ?? null;
        out.reviewSentiment  = place.reviewSentiment  ?? null;
    }
    if (opts.enrichLawyerNiche) {
        out.hasOnlineBooking         = place.hasOnlineBooking         ?? null;
        out.bookingPlatform          = place.bookingPlatform          ?? null;
        out.bookingUrl               = place.bookingUrl               ?? null;
        out.hasFreeConsultation      = place.hasFreeConsultation      ?? null;
        out.freeConsultationEvidence = place.freeConsultationEvidence ?? null;
        out.freeConsultationUrl      = place.freeConsultationUrl      ?? null;
        out.isMetroArea              = place.isMetroArea              ?? null;
        out.metroName                = place.metroName                ?? null;
        out.metroTier                = place.metroTier                ?? null;
        out.firmSize                 = place.firmSize                 ?? null;
        out.firmSizeLabel            = place.firmSizeLabel            ?? null;
        out.firmSizeConfidence       = place.firmSizeConfidence       ?? null;
    }

    return out;
}
