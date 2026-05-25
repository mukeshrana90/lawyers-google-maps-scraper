/**
 * Niche filters for the lawyers scraper.
 *
 * 1. detectOnlineBooking()    → Calendly / Acuity / Clio Grow / etc.
 * 2. detectFreeConsultation() → "free consultation" CTAs on Maps + site
 * 3. isInMetroArea()          → coordinate-based metro detection (universal)
 * 4. classifyFirmSize()       → solo / small / mid / large
 */


// ─────────────────────────────────────────────────────────────────────────────
// 1. ONLINE BOOKING — replaces "online ordering"
// ─────────────────────────────────────────────────────────────────────────────

const BOOKING_PLATFORMS = [
    'calendly.com', 'cal.com', 'acuityscheduling.com', 'squarespace-scheduling.com',
    'clio.com/grow', 'cliogrow.com', 'lawpay.com/payment', 'lawmatics.com',
    'mycase.com', 'practicepanther.com',
    'setmore.com', 'doodle.com', 'youcanbook.me', '10to8.com',
    'meetings.hubspot.com', 'bookings.googleusercontent.com',
];

const BOOKING_KEYWORDS = [
    'book a consultation', 'book an appointment', 'schedule a consultation',
    'schedule an appointment', 'book online', 'schedule online',
    'request a consultation', 'request an appointment',
    'book now', 'schedule now',
];

export async function detectBookingFromMapsPage(page) {
    return page.evaluate(() => {
        const btns = [...document.querySelectorAll('a[data-item-id], a[aria-label], button[jsaction], button[aria-label]')];
        const bookRe = /\bbook\b|\bschedule\b|\bappointment\b|\bconsultation\b/i;
        const btn = btns.find(el => {
            const text = ((el.textContent || '') + ' ' + (el.getAttribute('aria-label') || '')).trim();
            return bookRe.test(text);
        });
        return btn
            ? { found: true, platform: 'maps_button', url: btn.href || null }
            : { found: false, platform: null, url: null };
    }).catch(() => ({ found: false, platform: null, url: null }));
}

export async function detectBookingFromCurrentWebsite(page) {
    return page.evaluate((platforms, keywords) => {
        const html    = document.documentElement.innerHTML.toLowerCase();
        const links   = [...document.querySelectorAll('a[href]')].map(a => a.href.toLowerCase());
        const iframes = [...document.querySelectorAll('iframe[src]')].map(f => f.src.toLowerCase());
        const haystack = [...links, ...iframes];

        for (const p of platforms) {
            const hit = haystack.find(u => u.includes(p));
            if (hit) return { found: true, platform: p, url: hit };
        }
        const platformMatch = platforms.find(p => html.includes(p));
        if (platformMatch) return { found: true, platform: platformMatch, url: null };

        const hasKeyword = keywords.some(kw => html.includes(kw.toLowerCase()));
        const hasBookCTA = !!document.querySelector(
            'a[href*="book"], a[href*="schedule"], a[href*="consult"], a[href*="appointment"], button[class*="book" i], button[class*="schedule" i]',
        );
        if (hasKeyword && hasBookCTA) return { found: true, platform: 'native_form', url: null };

        return { found: false, platform: null, url: null };
    }, BOOKING_PLATFORMS, BOOKING_KEYWORDS).catch(() => ({ found: false, platform: null, url: null }));
}


// ─────────────────────────────────────────────────────────────────────────────
// 2. FREE CONSULTATION — replaces "reservation" (legal-specific signal)
// Rarely a Maps-level button, mostly a website claim.
// ─────────────────────────────────────────────────────────────────────────────

const FREE_CONSULT_KEYWORDS = [
    'free consultation', 'free case evaluation', 'free initial consultation',
    'no-cost consultation', 'no cost consultation', 'complimentary consultation',
    'free legal consultation',
];

export async function detectFreeConsultFromMapsPage(page) {
    return page.evaluate((keywords) => {
        const text = document.body.innerText.toLowerCase();
        const hit = keywords.find(k => text.includes(k));
        return hit ? { found: true, evidence: hit } : { found: false, evidence: null };
    }, FREE_CONSULT_KEYWORDS).catch(() => ({ found: false, evidence: null }));
}

export async function detectFreeConsultFromCurrentWebsite(page) {
    return page.evaluate((keywords) => {
        const text = document.body.innerText.toLowerCase();
        const hit = keywords.find(k => text.includes(k));
        if (!hit) return { found: false, evidence: null };

        // Try to find a CTA link or button nearby to surface a URL
        const link = [...document.querySelectorAll('a[href]')].find(a =>
            keywords.some(k => a.textContent.toLowerCase().includes(k)),
        );
        return { found: true, evidence: hit, url: link?.href ?? null };
    }, FREE_CONSULT_KEYWORDS).catch(() => ({ found: false, evidence: null, url: null }));
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. METRO AREA DETECTION — coordinate-based (identical to restaurants actor)
// ─────────────────────────────────────────────────────────────────────────────

const METRO_AREAS = [
    // USA
    { metro: 'New York Metro',   tier: 1, country: 'USA', lat: 40.75,  lon:  -73.95,  radiusKm: 80,
      cityKeywords: ['new york', 'brooklyn', 'manhattan', 'queens', 'bronx', 'staten island', 'jersey city', 'newark'] },
    { metro: 'LA Metro',         tier: 1, country: 'USA', lat: 34.05,  lon: -118.25,  radiusKm: 75,
      cityKeywords: ['los angeles'] },
    { metro: 'Chicago Metro',    tier: 1, country: 'USA', lat: 41.88,  lon:  -87.63,  radiusKm: 60,
      cityKeywords: ['chicago'] },
    { metro: 'Houston Metro',    tier: 1, country: 'USA', lat: 29.76,  lon:  -95.37,  radiusKm: 70,
      cityKeywords: ['houston'] },
    { metro: 'Dallas Metro',     tier: 1, country: 'USA', lat: 32.78,  lon:  -96.80,  radiusKm: 75,
      cityKeywords: ['dallas', 'fort worth'] },
    { metro: 'Miami Metro',      tier: 1, country: 'USA', lat: 25.77,  lon:  -80.19,  radiusKm: 60,
      cityKeywords: ['miami'] },
    { metro: 'Atlanta Metro',    tier: 1, country: 'USA', lat: 33.75,  lon:  -84.39,  radiusKm: 75,
      cityKeywords: ['atlanta'] },
    { metro: 'Seattle Metro',    tier: 2, country: 'USA', lat: 47.61,  lon: -122.33,  radiusKm: 55,
      cityKeywords: ['seattle'] },
    { metro: 'Boston Metro',     tier: 2, country: 'USA', lat: 42.36,  lon:  -71.06,  radiusKm: 50,
      cityKeywords: ['boston'] },
    { metro: 'Phoenix Metro',    tier: 2, country: 'USA', lat: 33.45,  lon: -112.07,  radiusKm: 55,
      cityKeywords: ['phoenix'] },
    { metro: 'Denver Metro',     tier: 2, country: 'USA', lat: 39.74,  lon: -104.99,  radiusKm: 55,
      cityKeywords: ['denver'] },
    { metro: 'SF Bay Area',      tier: 1, country: 'USA', lat: 37.77,  lon: -122.42,  radiusKm: 70,
      cityKeywords: ['san francisco', 'oakland', 'san jose', 'berkeley', 'palo alto', 'mountain view', 'sunnyvale', 'fremont'] },
    { metro: 'DC Metro',         tier: 1, country: 'USA', lat: 38.91,  lon:  -77.04,  radiusKm: 50,
      cityKeywords: ['washington', 'arlington', 'alexandria'] },
    { metro: 'Philadelphia Metro', tier: 1, country: 'USA', lat: 39.95, lon:  -75.17,  radiusKm: 50,
      cityKeywords: ['philadelphia'] },
    { metro: 'San Diego Metro',  tier: 2, country: 'USA', lat: 32.72,  lon: -117.16,  radiusKm: 45,
      cityKeywords: ['san diego'] },
    { metro: 'Austin Metro',     tier: 2, country: 'USA', lat: 30.27,  lon:  -97.74,  radiusKm: 40,
      cityKeywords: ['austin'] },
    { metro: 'Las Vegas Metro',  tier: 2, country: 'USA', lat: 36.17,  lon: -115.14,  radiusKm: 40,
      cityKeywords: ['las vegas'] },
    // UK
    { metro: 'Greater London',     tier: 1, country: 'UK', lat: 51.51, lon:  -0.13, radiusKm: 35,
      cityKeywords: ['london'] },
    { metro: 'Greater Manchester', tier: 2, country: 'UK', lat: 53.48, lon:  -2.24, radiusKm: 25,
      cityKeywords: ['manchester'] },
    { metro: 'West Midlands',      tier: 2, country: 'UK', lat: 52.48, lon:  -1.90, radiusKm: 25,
      cityKeywords: ['birmingham'] },
    // India
    { metro: 'Mumbai Metro',     tier: 1, country: 'India', lat: 19.08, lon: 72.88, radiusKm: 40,
      cityKeywords: ['mumbai'] },
    { metro: 'Delhi NCR',        tier: 1, country: 'India', lat: 28.61, lon: 77.21, radiusKm: 50,
      cityKeywords: ['delhi', 'new delhi', 'gurgaon', 'gurugram', 'noida'] },
    { metro: 'Bengaluru Metro',  tier: 1, country: 'India', lat: 12.97, lon: 77.59, radiusKm: 40,
      cityKeywords: ['bengaluru', 'bangalore'] },
    { metro: 'Hyderabad Metro',  tier: 2, country: 'India', lat: 17.39, lon: 78.49, radiusKm: 35,
      cityKeywords: ['hyderabad'] },
    { metro: 'Pune Metro',       tier: 2, country: 'India', lat: 18.52, lon: 73.86, radiusKm: 30,
      cityKeywords: ['pune'] },
    { metro: 'Chennai Metro',    tier: 2, country: 'India', lat: 13.08, lon: 80.27, radiusKm: 30,
      cityKeywords: ['chennai'] },
    // UAE
    { metro: 'Dubai',     tier: 1, country: 'UAE', lat: 25.20, lon: 55.27, radiusKm: 40,
      cityKeywords: ['dubai'] },
    { metro: 'Abu Dhabi', tier: 1, country: 'UAE', lat: 24.47, lon: 54.37, radiusKm: 40,
      cityKeywords: ['abu dhabi'] },
    // Australia
    { metro: 'Sydney Metro',    tier: 1, country: 'Australia', lat: -33.87, lon: 151.21, radiusKm: 50,
      cityKeywords: ['sydney'] },
    { metro: 'Melbourne Metro', tier: 1, country: 'Australia', lat: -37.81, lon: 144.96, radiusKm: 50,
      cityKeywords: ['melbourne'] },
    // Canada
    { metro: 'Greater Toronto', tier: 1, country: 'Canada', lat: 43.65, lon:  -79.38, radiusKm: 50,
      cityKeywords: ['toronto'] },
    { metro: 'Metro Vancouver', tier: 2, country: 'Canada', lat: 49.28, lon: -123.12, radiusKm: 40,
      cityKeywords: ['vancouver'] },
];

function haversineKm(lat1, lon1, lat2, lon2) {
    const toRad = d => (d * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
}

export function isInMetroArea(place, minTier = 2) {
    if (typeof place.latitude === 'number' && typeof place.longitude === 'number') {
        let best = null;
        for (const m of METRO_AREAS) {
            if (m.tier > minTier) continue;
            const dist = haversineKm(place.latitude, place.longitude, m.lat, m.lon);
            if (dist <= m.radiusKm && (!best || dist < best.dist)) {
                best = { m, dist };
            }
        }
        if (best) {
            return {
                isMetro:   true,
                metroName: best.m.metro,
                metroTier: best.m.tier,
                country:   best.m.country,
            };
        }
    }

    const addressText = [place.city, place.state, place.country, place.fullAddress]
        .filter(Boolean).join(' ').toLowerCase();
    for (const m of METRO_AREAS) {
        if (m.tier > minTier) continue;
        if (m.cityKeywords.some(k => addressText.includes(k))) {
            return {
                isMetro:   true,
                metroName: m.metro,
                metroTier: m.tier,
                country:   m.country,
            };
        }
    }

    return { isMetro: false, metroName: null, metroTier: null, country: null };
}


// ─────────────────────────────────────────────────────────────────────────────
// 4. FIRM SIZE CLASSIFIER
// Classifies into: 'solo' | 'small' (2–10) | 'mid' (11–50) | 'large' (50+) | 'unknown'
//
// Signals:
//   - Name suffix ("...& Associates", "...LLP", "Group", "Firm")
//   - Maps category ("Law firm" vs "Lawyer" vs "Attorney")
//   - Review count (proxy for client volume / firm size)
// ─────────────────────────────────────────────────────────────────────────────

const LARGE_FIRM_KEYWORDS = ['llp', 'pllc', 'law group', 'law firm', 'group', 'partners'];
const SMALL_FIRM_KEYWORDS = ['& associates', 'and associates', 'law office', 'law offices', 'law center'];
const SOLO_KEYWORDS       = ['attorney at law', 'law office of', 'lawyer'];

export function classifyFirmSize(place) {
    const nameL     = (place.name ?? '').toLowerCase();
    const categoryL = (place.category ?? '').toLowerCase();
    const reviews   = place.reviewCount ?? 0;

    const signals = [];

    // Strong name signal — LLP / large group naming
    if (LARGE_FIRM_KEYWORDS.some(k => nameL.includes(k))) {
        signals.push('large_firm_keyword');
        return { type: 'large', label: 'Large Law Firm', confidence: 'medium', signals };
    }

    // "& Associates" / "Law Office of" — small firm
    if (SMALL_FIRM_KEYWORDS.some(k => nameL.includes(k))) {
        signals.push('small_firm_keyword');
        // Cross-check with review count: > 500 reviews probably means mid-sized
        if (reviews > 500) {
            signals.push(`reviews=${reviews}`);
            return { type: 'mid', label: 'Mid-Size Firm (11–50)', confidence: 'medium', signals };
        }
        return { type: 'small', label: 'Small Firm (2–10)', confidence: 'medium', signals };
    }

    // Solo signals
    if (SOLO_KEYWORDS.some(k => nameL.includes(k)) || categoryL.includes('lawyer')) {
        signals.push('solo_keyword_or_category');
        if (reviews > 500) {
            signals.push(`reviews=${reviews}`);
            return { type: 'small', label: 'Small Firm (2–10)', confidence: 'low', signals };
        }
        return { type: 'solo', label: 'Solo Practitioner', confidence: 'medium', signals };
    }

    // Pure review-count fallback
    if (reviews >= 2000) {
        signals.push(`reviews=${reviews}`);
        return { type: 'large', label: 'Large Law Firm', confidence: 'low', signals };
    }
    if (reviews >= 500) {
        signals.push(`reviews=${reviews}`);
        return { type: 'mid', label: 'Mid-Size Firm (11–50)', confidence: 'low', signals };
    }
    if (reviews >= 50) {
        signals.push(`reviews=${reviews}`);
        return { type: 'small', label: 'Small Firm (2–10)', confidence: 'low', signals };
    }

    return { type: 'unknown', label: 'Unknown', confidence: 'low', signals };
}


// ─────────────────────────────────────────────────────────────────────────────
// MASTER — Maps-Overview-only checks + pure-compute metro
// Firm-size classification is moved out (runs in main.js after enrichment
// completes, so it can use the full review-count + name data).
// ─────────────────────────────────────────────────────────────────────────────

export async function applyLawyerNicheFilters(page, place) {
    const enriched = { ...place };

    const booking = await detectBookingFromMapsPage(page);
    enriched.hasOnlineBooking = booking.found;
    enriched.bookingPlatform  = booking.platform;
    enriched.bookingUrl       = booking.url;

    const freeConsult = await detectFreeConsultFromMapsPage(page);
    enriched.hasFreeConsultation       = freeConsult.found;
    enriched.freeConsultationEvidence  = freeConsult.evidence;

    const metro = isInMetroArea(enriched);
    enriched.isMetroArea = metro.isMetro;
    enriched.metroName   = metro.metroName;
    enriched.metroTier   = metro.metroTier;

    return enriched;
}

export function applyFirmSizeClassification(enriched) {
    const cls = classifyFirmSize(enriched);
    enriched.firmSize           = cls.type;
    enriched.firmSizeLabel      = cls.label;
    enriched.firmSizeConfidence = cls.confidence;
    enriched.firmSizeSignals    = cls.signals;
    return enriched;
}
