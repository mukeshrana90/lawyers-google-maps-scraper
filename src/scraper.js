import { log, navigateWithRetry } from './utils.js';
import { Actor } from 'apify';

// Multiple selectors for the place detail heading — Google uses different
// class names across regions, devices, and A/B tests
const DETAIL_HEADING_SELECTORS = [
    'h1.DUwDvf',
    'h1.fontHeadlineLarge',
    'div[role="main"] h1',
    'h1[data-attrid]',
    '#QA0Szd h1',
];

const DETAIL_HEADING_CSS = DETAIL_HEADING_SELECTORS.join(', ');

/**
 * Scrapes a Google Maps search results page and returns an array of place objects.
 *
 * Strategy: scroll the results feed to collect all place URLs first,
 * then visit each URL directly. This avoids the fragile click/back cycle
 * where the DOM rebuilds and nth() locators go stale.
 */
export async function scrapeMapResults(page, { maxResults, searchTerm, location }) {
    const results = [];
    const seen    = new Set();

    const query = encodeURIComponent(`${searchTerm} in ${location}`);
    const searchUrl = `https://www.google.com/maps/search/${query}`;
    log.info(`Navigating to: ${searchUrl}`);
    await navigateWithRetry(page, searchUrl, { timeout: 60_000, retries: 2 });

    log.info(`Page loaded: ${page.url()}`);

    await dismissConsent(page);

    let placeUrls = await collectPlaceUrls(page, maxResults);
    if (placeUrls.length === 0) {
        log.warning('Empty feed — reloading search page once before giving up');
        await navigateWithRetry(page, searchUrl, { timeout: 60_000, retries: 1 });
        await dismissConsent(page);
        placeUrls = await collectPlaceUrls(page, maxResults);
    }
    log.info(`Collected ${placeUrls.length} place URLs`);

    if (placeUrls.length === 0) {
        try {
            const screenshot = await page.screenshot({ fullPage: false });
            await Actor.setValue('DEBUG_SCREENSHOT', screenshot, { contentType: 'image/png' });
        } catch { /* ignore debug errors */ }
        return results;
    }

    for (let i = 0; i < placeUrls.length; i++) {
        if (results.length >= maxResults) break;

        try {
            const reached = await navigateWithRetry(page, placeUrls[i], { timeout: 60_000, retries: 2 });
            if (!reached) {
                log.warning(`Skipped place ${i}: navigation failed`);
                continue;
            }

            const detailLoaded = await waitForDetailPanel(page);
            if (!detailLoaded) {
                log.warning(`Skipped place ${i}: detail panel did not load`);
                continue;
            }

            await page.waitForTimeout(300 + Math.random() * 300);

            const place = await extractPlaceDetail(page, { searchTerm, searchLocation: location });

            if (!place?.name || place.name === 'Results' || (!place.fullAddress && !place.phone && !place.website)) {
                log.warning(`Skipped place ${i}: invalid data (name="${place?.name}")`);
                continue;
            }

            const dedupeKey = place.placeId ?? place.name;
            if (!seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                results.push(place);
                log.info(`Scraped ${results.length}/${maxResults}: ${place.name}`);
            }
        } catch (e) {
            log.warning(`Skipped place ${i}: ${e.message}`);
        }
    }

    return results;
}

async function collectPlaceUrls(page, maxResults) {
    const listSelector = 'div[role="feed"]';
    try {
        await page.waitForSelector(listSelector, { timeout: 10_000 });
    } catch {
        log.warning('No results feed found on page');
        return [];
    }

    let prevCount = 0;
    let staleRounds = 0;

    while (true) {
        const count = await page.$$eval(
            'div[role="feed"] a[href*="/maps/place/"]',
            els => els.length,
        );

        if (count >= maxResults) break;
        if (count === prevCount) {
            staleRounds++;
            if (staleRounds >= 3) break;
        } else {
            staleRounds = 0;
        }
        prevCount = count;

        await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            if (el) el.scrollBy(0, 800);
        }, listSelector);

        await page.waitForTimeout(600 + Math.random() * 400);
    }

    log.info(`Scrolled to ${prevCount} place links`);

    return page.$$eval(
        'div[role="feed"] a[href*="/maps/place/"]',
        (anchors, max) => {
            const seen = new Set();
            const result = [];
            for (const a of anchors) {
                const href = a.href;
                if (href && !seen.has(href)) {
                    seen.add(href);
                    result.push(href);
                    if (result.length >= max) break;
                }
            }
            return result;
        },
        maxResults,
    );
}

async function waitForDetailPanel(page) {
    try {
        await Promise.any(
            DETAIL_HEADING_SELECTORS.map(sel =>
                page.waitForSelector(sel, { timeout: 5_000 }),
            ),
        );
        return true;
    } catch {
        return false;
    }
}

async function dismissConsent(page) {
    try {
        const consentSelectors = [
            'button[aria-label="Accept all"]',
            'button[aria-label="Alle akzeptieren"]',
            'button[aria-label="Tout accepter"]',
            'form[action*="consent"] button',
            'button:has-text("I agree")',
        ];
        for (const sel of consentSelectors) {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                log.info(`Consent dialog found, clicking: ${sel}`);
                await btn.click();
                await page.waitForTimeout(2000);
                await page.waitForSelector('div[role="feed"], div[role="article"]', { timeout: 10_000 }).catch(() => {});
                break;
            }
        }
    } catch { /* no consent dialog */ }
}

async function extractPlaceDetail(page, { searchTerm, searchLocation }) {
    return page.evaluate(({ searchTerm, searchLocation, headingCss }) => {
        const txt = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;

        const name = document.querySelector(headingCss)?.textContent?.trim() ?? txt('h1');
        const category = txt('button.DkEaL') || txt('button[jsaction*="category"]');

        // ── Rating & reviews ──────────────────────────────────────────────────
        const ratingText = txt('div.F7nice span[aria-hidden="true"]')
            || txt('span.ceNzKf span[aria-hidden="true"]');
        const rating = ratingText ? parseFloat(ratingText) : null;

        let reviewCount = null;
        const reviewSpans = document.querySelectorAll(
            'div.F7nice span[aria-label], span.ceNzKf span[aria-label]',
        );
        for (const s of reviewSpans) {
            const label = s.getAttribute('aria-label') ?? '';
            if (/review/i.test(label)) {
                const m = label.match(/([\d,]+)/);
                if (m) { reviewCount = parseInt(m[1].replace(/,/g, ''), 10); break; }
            }
        }
        if (reviewCount == null) {
            const text = document.querySelector('div.F7nice, span.ceNzKf')?.textContent ?? '';
            const m = text.match(/\(([\d,]+)\)/);
            if (m) reviewCount = parseInt(m[1].replace(/,/g, ''), 10);
        }

        // ── Address ───────────────────────────────────────────────────────────
        const addressEl  = document.querySelector('button[data-item-id="address"]');
        const fullAddress = addressEl?.textContent?.trim() ?? null;

        let address = fullAddress;
        let city = null, state = null, country = null, postalCode = null;

        if (fullAddress) {
            const parts = fullAddress.split(',').map(s => s.trim());

            if (parts.length >= 3) {
                const lastPart = parts[parts.length - 1];
                const stateZipMatch = lastPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);

                if (stateZipMatch) {
                    state = stateZipMatch[1];
                    postalCode = stateZipMatch[2];
                    city = parts[parts.length - 2];
                    address = parts.slice(0, parts.length - 2).join(', ');
                } else if (parts.length >= 4) {
                    country = lastPart;
                    const stateZip2 = parts[parts.length - 2].match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
                    if (stateZip2) {
                        state = stateZip2[1];
                        postalCode = stateZip2[2];
                        city = parts[parts.length - 3];
                        address = parts.slice(0, parts.length - 3).join(', ');
                    } else {
                        city = parts[parts.length - 3] ?? null;
                        state = parts[parts.length - 2] ?? null;
                        country = lastPart;
                        address = parts.slice(0, Math.max(1, parts.length - 3)).join(', ');
                    }
                } else {
                    address = parts[0];
                    city = parts[1] ?? null;
                    state = parts[2] ?? null;
                }
            } else if (parts.length === 2) {
                address = parts[0];
                city = parts[1];
            }
        }

        // ── Phone ─────────────────────────────────────────────────────────────
        const phoneEl = document.querySelector('button[data-item-id^="phone"]');
        let phone = null;
        if (phoneEl) {
            const dataId = phoneEl.getAttribute('data-item-id') ?? '';
            phone = dataId.replace(/^phone:(tel:)?/, '') || null;
            if (!phone || phone === 'phone') {
                phone = phoneEl.textContent?.trim() ?? null;
            }
        }

        // ── Website ───────────────────────────────────────────────────────────
        const websiteEl = document.querySelector('a[data-item-id="authority"]');
        let website = websiteEl?.href ?? null;
        if (website && website.includes('google.com/url')) {
            try {
                const u = new URL(website);
                website = u.searchParams.get('q') || website;
            } catch { /* keep original */ }
        }

        // ── Hours ─────────────────────────────────────────────────────────────
        const isOpenNow = !!document.querySelector('span.ZDu9vd');
        const hoursRows = [...document.querySelectorAll('table.eK4R0e tr')];
        const hours = {};
        for (const row of hoursRows) {
            const day  = row.querySelector('td.ylH6lf')?.textContent?.trim();
            const time = row.querySelector('td.mxowUb')?.textContent?.trim();
            if (day && time) hours[day] = time;
        }

        // ── Place ID & coords from URL ─────────────────────────────────────────
        const url = window.location.href;

        const hexMatch = url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
        const placeId = hexMatch?.[1] ?? null;

        const latMatch = url.match(/!3d(-?\d+\.\d+)/);
        const lngMatch = url.match(/!4d(-?\d+\.\d+)/);
        let latitude  = latMatch ? parseFloat(latMatch[1]) : null;
        let longitude = lngMatch ? parseFloat(lngMatch[1]) : null;

        if (!latitude || !longitude) {
            const coordMatch = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
            latitude  = coordMatch ? parseFloat(coordMatch[1]) : latitude;
            longitude = coordMatch ? parseFloat(coordMatch[2]) : longitude;
        }

        // ── Sub-category tags (for lawyers: practice area hints) ──────────────
        const tags = [...document.querySelectorAll('div.skqShb button')]
            .map(b => b.textContent.trim())
            .filter(Boolean);
        const subCategories = tags.length ? tags : null;

        return {
            name, category, subCategories,
            address, fullAddress,
            city, state, country, postalCode,
            phone, website,
            rating, reviewCount,
            hours: Object.keys(hours).length ? hours : null,
            isOpenNow,
            latitude, longitude,
            placeId,
            mapsUrl: url,
            searchTerm,
            searchLocation,
        };
    }, { searchTerm, searchLocation, headingCss: DETAIL_HEADING_CSS });
}
