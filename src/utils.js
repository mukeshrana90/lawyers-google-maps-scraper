// ─────────────────────────────────────────────────────────────────────────────
// src/utils.js
// ─────────────────────────────────────────────────────────────────────────────
import { Log } from 'apify';
export const log = new Log({ prefix: 'LawyersScraper' });

/**
 * Builds a Google Maps search URL for each term × location pair.
 * Returns array of { url, label, meta } ready to push into RequestQueue.
 */
export function buildSearchUrls(searchTerms, locations) {
    const requests = [];
    for (const location of locations) {
        for (const term of searchTerms) {
            const q = encodeURIComponent(`${term} in ${location}`);
            // hl=en + gl=us nudges Google toward English UI and US consent flow,
            // matching what the scraper would build internally — having it on
            // the queued URL lets us skip a redundant in-handler navigation.
            requests.push({
                url:   `https://www.google.com/maps/search/${q}?hl=en&gl=us`,
                label: 'MAPS_SEARCH',
                meta:  { term, location },
            });
        }
    }
    return requests;
}

/**
 * Delays execution by a random amount within [min, max] ms.
 * Keeps scraping behaviour human-like.
 */
export function randomDelay(min = 500, max = 1500) {
    return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

/**
 * Navigate with retry and graceful fallback on slow residential proxies.
 *
 * Strategy per attempt:
 *   1. Try `domcontentloaded` with full timeout.
 *   2. If that times out, the page is often partially usable — swallow the
 *      error and let the caller's subsequent waitForSelector decide.
 *   3. Between attempts, do a small backoff + reload.
 *
 * Returns true if any attempt believed the page was reachable, false if
 * every attempt surfaced a hard error (net::, about:blank, etc).
 */
export async function navigateWithRetry(page, url, { timeout = 60_000, retries = 2 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout });
            return true;
        } catch (e) {
            lastErr = e;
            const msg = e.message || '';
            if (msg.includes('Timeout') && page.url() && page.url() !== 'about:blank') {
                log.warning(`Nav timeout on ${url} (attempt ${attempt + 1}) — continuing with partial load`);
                return true;
            }
            if (attempt < retries) {
                await new Promise(r => setTimeout(r, 1500 + attempt * 1500));
            }
        }
    }
    log.warning(`Navigation failed after ${retries + 1} attempts: ${lastErr?.message}`);
    return false;
}
