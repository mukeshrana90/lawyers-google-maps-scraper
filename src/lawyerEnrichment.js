/**
 * Lawyer-specific enrichment module.
 * Adds: practiceAreas, feeStructure, languagesSpoken, servicesOffered,
 *       reviewSentiment.
 *
 * Mirrors the architecture of the restaurants actor's restaurantEnrichment.js:
 * Maps-Overview work only here; website fallbacks happen inside main.js's
 * consolidated website phase so we visit each firm's website at most once.
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. PRACTICE AREAS — closest analog to restaurant "cuisine"
// Source A: Maps category + sub-category tags (already captured as
//           `subCategories` in scraper.js)
// Source B: Inferred from name/category keywords
// ─────────────────────────────────────────────────────────────────────────────

const PRACTICE_AREA_KEYWORDS = {
    'Personal Injury':    ['personal injury', 'pi lawyer', 'accident', 'injury'],
    'Immigration':        ['immigration', 'asylum', 'visa', 'green card', 'naturalization'],
    'Family Law':         ['family law', 'divorce', 'custody', 'adoption', 'matrimonial'],
    'Criminal Defense':   ['criminal', 'defense', 'dui', 'dwi', 'felony', 'misdemeanor'],
    'Corporate / Business': ['corporate', 'business law', 'commercial', 'mergers', 'acquisitions', 'm&a'],
    'Estate Planning':    ['estate planning', 'wills', 'trust', 'probate', 'inheritance'],
    'Real Estate':        ['real estate', 'property law', 'landlord', 'tenant'],
    'Employment':         ['employment law', 'labor', 'wrongful termination', 'discrimination'],
    'Intellectual Property': ['intellectual property', 'patent', 'trademark', 'copyright'],
    'Tax':                ['tax law', 'tax attorney'],
    'Bankruptcy':         ['bankruptcy', 'chapter 7', 'chapter 11', 'chapter 13'],
    'Workers Compensation': ['workers comp', 'workers compensation', "workman's comp"],
    'Medical Malpractice': ['medical malpractice', 'med mal'],
    'Class Action':       ['class action', 'mass tort'],
    'Civil Rights':       ['civil rights', 'discrimination', 'police brutality'],
    'Social Security / Disability': ['social security', 'ssdi', 'disability claim'],
};

/**
 * Build a deduplicated practice-area list from the Maps category, sub-category
 * tags (already in `place.subCategories`), and any name keywords.
 */
export function inferPracticeAreas(place) {
    const sources = [
        place.name      ?? '',
        place.category  ?? '',
        ...(place.subCategories ?? []),
    ].join(' ').toLowerCase();

    const matched = [];
    for (const [area, keywords] of Object.entries(PRACTICE_AREA_KEYWORDS)) {
        if (keywords.some(k => sources.includes(k))) matched.push(area);
    }
    return matched.length ? matched : null;
}

/** Scan the currently-loaded firm website for additional practice-area matches. */
export async function extractPracticeAreasFromCurrentPage(page) {
    try {
        const text = (await page.innerText('body')).toLowerCase();
        const matched = [];
        for (const [area, keywords] of Object.entries(PRACTICE_AREA_KEYWORDS)) {
            if (keywords.some(k => text.includes(k))) matched.push(area);
        }
        return matched.length ? matched : null;
    } catch {
        return null;
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// 2. FEE STRUCTURE — Google Maps almost never surfaces this for lawyers
// Source: scan the firm's website for fee-model keywords
// ─────────────────────────────────────────────────────────────────────────────

const FEE_KEYWORDS = {
    'contingency':       ['contingency', 'no fee unless you win', 'no win no fee', 'no recovery no fee'],
    'free_consultation': ['free consultation', 'free case evaluation', 'free initial consultation', 'no-cost consultation'],
    'flat_fee':          ['flat fee', 'flat rate', 'fixed fee', 'fixed-fee'],
    'hourly':            ['hourly rate', 'per hour', '$/hr', 'per hour basis'],
    'sliding_scale':     ['sliding scale', 'income-based'],
    'pro_bono':          ['pro bono', 'free legal aid', 'pro-bono'],
};

export async function extractFeeStructureFromCurrentPage(page) {
    try {
        const text = (await page.innerText('body')).toLowerCase();
        const matched = [];
        for (const [model, keywords] of Object.entries(FEE_KEYWORDS)) {
            if (keywords.some(k => text.includes(k))) matched.push(model);
        }
        return matched.length ? matched : null;
    } catch {
        return null;
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// 3. LANGUAGES SPOKEN — replaces dietary options
// Source A: Maps "About" attributes section (sometimes lists languages)
// Source B: Website keyword scan ("Se habla español", "中文", etc.)
// ─────────────────────────────────────────────────────────────────────────────

const LANGUAGE_KEYWORDS = [
    // English-language indicators are not useful (everything is in English)
    'spanish', 'español', 'se habla español', 'hablamos español',
    'mandarin', 'cantonese', '中文', '普通话', '粵語', 'chinese',
    'french', 'français',
    'german', 'deutsch',
    'italian', 'italiano',
    'portuguese', 'português',
    'russian', 'русский',
    'arabic', 'العربية',
    'hindi', 'हिन्दी',
    'punjabi', 'ਪੰਜਾਬੀ',
    'urdu', 'اردو',
    'korean', '한국어',
    'japanese', '日本語',
    'vietnamese', 'tiếng việt',
    'tagalog', 'filipino',
    'polish', 'polski',
    'farsi', 'persian', 'فارسی',
    'hebrew', 'עברית',
    'turkish', 'türkçe',
    'greek', 'ελληνικά',
    'haitian creole', 'kreyòl',
];

// Normalised display names (collapse aliases into a single label)
const LANGUAGE_NORMALISE = {
    'español': 'Spanish', 'se habla español': 'Spanish', 'hablamos español': 'Spanish', 'spanish': 'Spanish',
    'mandarin': 'Mandarin', '普通话': 'Mandarin',
    'cantonese': 'Cantonese', '粵語': 'Cantonese',
    'chinese': 'Chinese', '中文': 'Chinese',
    'français': 'French', 'french': 'French',
    'deutsch': 'German', 'german': 'German',
    'italiano': 'Italian', 'italian': 'Italian',
    'português': 'Portuguese', 'portuguese': 'Portuguese',
    'русский': 'Russian', 'russian': 'Russian',
    'العربية': 'Arabic', 'arabic': 'Arabic',
    'हिन्दी': 'Hindi', 'hindi': 'Hindi',
    'ਪੰਜਾਬੀ': 'Punjabi', 'punjabi': 'Punjabi',
    'اردو': 'Urdu', 'urdu': 'Urdu',
    '한국어': 'Korean', 'korean': 'Korean',
    '日本語': 'Japanese', 'japanese': 'Japanese',
    'tiếng việt': 'Vietnamese', 'vietnamese': 'Vietnamese',
    'tagalog': 'Tagalog', 'filipino': 'Tagalog',
    'polish': 'Polish', 'polski': 'Polish',
    'farsi': 'Persian', 'persian': 'Persian', 'فارسی': 'Persian',
    'hebrew': 'Hebrew', 'עברית': 'Hebrew',
    'türkçe': 'Turkish', 'turkish': 'Turkish',
    'ελληνικά': 'Greek', 'greek': 'Greek',
    'kreyòl': 'Haitian Creole', 'haitian creole': 'Haitian Creole',
};

function normaliseLanguageList(raw) {
    const out = new Set();
    for (const k of raw) {
        const norm = LANGUAGE_NORMALISE[k.toLowerCase()] ?? k;
        out.add(norm);
    }
    return [...out];
}

export async function extractLanguagesFromMaps(page) {
    return page.evaluate((keywords) => {
        // Look for a Maps "Highlights"/"Languages" attributes section
        const allText = document.body.innerText.toLowerCase();
        const found = keywords.filter(k => allText.includes(k.toLowerCase()));
        return found.length ? found : null;
    }, LANGUAGE_KEYWORDS).then(raw => raw ? normaliseLanguageList(raw) : null).catch(() => null);
}

export async function extractLanguagesFromCurrentPage(page) {
    try {
        const text = (await page.innerText('body')).toLowerCase();
        const found = LANGUAGE_KEYWORDS.filter(k => text.includes(k.toLowerCase()));
        return found.length ? normaliseLanguageList(found) : null;
    } catch {
        return null;
    }
}


// ─────────────────────────────────────────────────────────────────────────────
// 4. SERVICES OFFERED — replaces menuHighlights
// Source A: nothing on Maps for lawyers
// Source B: scan the firm's website services / practice-area headings
// ─────────────────────────────────────────────────────────────────────────────

const SERVICE_BLOCKLIST = new Set([
    // Generic page-section / nav labels
    'menu', 'home', 'about', 'about us', 'contact', 'contact us',
    'services', 'practice areas', 'attorneys', 'team', 'our team', 'our attorneys',
    'blog', 'news', 'resources', 'testimonials', 'reviews',
    'careers', 'jobs', 'gallery',
    'hours', 'location', 'locations', 'find us', 'directions',
    'privacy', 'terms', 'disclaimer', 'cookies',
    'login', 'sign in',
    'welcome', 'free consultation', 'schedule consultation',
    // Form / CTA labels
    'email', 'email signup', 'sign up', 'subscribe', 'newsletter',
    // Day / time fragments (carried over from restaurants — same anti-leak)
]);

const SERVICE_BLOCK_REGEX =
    /(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon-|tue-|wed-|thu-|fri-|sat-|sun-)|\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i;

export async function extractServicesFromCurrentPage(page) {
    return page.evaluate(({ blocklist, blockPatternSrc }) => {
        const blocked   = new Set(blocklist);
        const blockRe   = new RegExp(blockPatternSrc, 'i');

        // Prefer service-list / practice-area selectors used by common law-firm
        // CMS templates; fall back to generic headings.
        const specific = [...document.querySelectorAll(
            '.practice-area__title, .practice-areas li, .service-item__title, ' +
            '.services-list li, [class*="practiceArea"] [class*="title"], ' +
            '[class*="practiceArea"] [class*="name"], [class*="serviceItem"] [class*="title"]',
        )];
        const headings = specific.length
            ? specific
            : [...document.querySelectorAll('h2, h3, h4, h5')];

        const seen = new Set();
        const out  = [];
        for (const el of headings) {
            const raw = el.textContent?.replace(/\s+/g, ' ').trim();
            if (!raw) continue;
            if (raw.length < 3 || raw.length > 80) continue;

            const lower = raw.toLowerCase();
            if (blocked.has(lower)) continue;
            if (blockRe.test(raw)) continue;
            // Skip short ALL-CAPS labels like "FAQ", "ABOUT"
            if (/^[A-Z\s&]+$/.test(raw) && raw.length < 12) continue;
            if (seen.has(lower)) continue;

            seen.add(lower);
            out.push(raw);
            if (out.length >= 12) break;
        }
        return out.length >= 3 ? out : null;
    }, {
        blocklist: [...SERVICE_BLOCKLIST],
        blockPatternSrc: SERVICE_BLOCK_REGEX.source,
    }).catch(() => null);
}


// ─────────────────────────────────────────────────────────────────────────────
// 5. REVIEW SENTIMENT — same architecture as restaurants, legal-tuned dict
// ─────────────────────────────────────────────────────────────────────────────

const SENTIMENT_DICT = {
    positive: [
        'professional', 'responsive', 'knowledgeable', 'helpful', 'thorough',
        'attentive', 'compassionate', 'experienced', 'expert', 'excellent',
        'recommend', 'highly recommend', 'won my case', 'best lawyer',
        'amazing', 'great', 'wonderful', 'fantastic', 'patient',
        'transparent', 'communicative', 'fair', 'trustworthy', 'caring',
        'aggressive',  // positive when describing courtroom representation
    ],
    negative: [
        'unresponsive', 'unprofessional', 'rude', 'late', 'missed',
        'no response', 'never returned', "didn't return", 'ignored',
        'overcharged', 'expensive', 'hidden fees', 'unethical',
        'lost my case', 'incompetent', 'disorganized', 'careless',
        'worst', 'terrible', 'awful', 'horrible', 'disappointing',
        'avoid', 'scam', 'malpractice',
    ],
};

const THEME_KEYWORDS = {
    expertise:        ['knowledgeable', 'expert', 'experienced', 'expertise', 'incompetent'],
    communication:    ['responsive', 'communication', 'returned', 'response', 'updated', 'unresponsive', 'ignored', 'no response'],
    professionalism:  ['professional', 'unprofessional', 'rude', 'courteous', 'respect'],
    caseOutcome:      ['won', 'lost', 'settlement', 'verdict', 'case', 'dismissed', 'reduced'],
    valueAndFees:     ['fee', 'price', 'cost', 'value', 'expensive', 'fair', 'hidden fees', 'transparent'],
    empathyAndCare:   ['caring', 'compassion', 'understanding', 'listened', 'patient', 'kind'],
};

export async function extractReviewSentiment(page) {
    const tabSelectors = [
        'button[role="tab"][aria-label*="Review" i]',
        'button[aria-label*="Reviews" i]',
        'button[jsaction*="reviewChart"]',
        'button[data-tab-index="1"]',
    ];
    let clicked = false;
    for (const sel of tabSelectors) {
        try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
                await btn.click();
                clicked = true;
                break;
            }
        } catch { /* try next */ }
    }
    if (!clicked) {
        try {
            const byRole = page.getByRole('tab', { name: /review/i }).first();
            if (await byRole.isVisible({ timeout: 1500 }).catch(() => false)) {
                await byRole.click();
                clicked = true;
            }
        } catch { /* still nothing */ }
    }

    try {
        await page.waitForSelector('div[data-review-id], div.jftiEf', { timeout: 12000 });
    } catch {
        if (!clicked) {
            // eslint-disable-next-line no-console
            console.warn('[reviewSentiment] Reviews tab not clickable — selector may be stale');
        }
        return null;
    }

    try {
        await page.evaluate(() => {
            const pane = document.querySelector('div[role="main"] div.m6QErb.DxyBCb, div.dS8AEf')
                || document.querySelector('div[data-review-id]')?.closest('div.m6QErb');
            if (pane) {
                for (let i = 0; i < 3; i++) pane.scrollBy(0, 1500);
            }
        });
        await page.waitForTimeout(1000);
    } catch { /* keep going */ }

    const moreButtons = await page.$$('button[aria-label="See more"], button.w8nwRe');
    for (const btn of moreButtons.slice(0, 10)) {
        try { await btn.click(); await page.waitForTimeout(150); } catch { /* skip */ }
    }

    const reviews = await page.evaluate(() => {
        const els = [...document.querySelectorAll('div[data-review-id]')].slice(0, 10);
        return els.map(el => {
            const text = (
                el.querySelector('span.wiI7pd')?.textContent
                ?? el.querySelector('.MyEned span')?.textContent
                ?? el.querySelector('span[jsname]')?.textContent
                ?? ''
            ).trim();
            const ratingEl = el.querySelector('span[role="img"][aria-label*="star" i]')
                || el.querySelector('span.kvMYJc');
            const ratingLabel = ratingEl?.getAttribute('aria-label') ?? '';
            const m = ratingLabel.match(/([\d.]+)/);
            return { text, rating: m ? parseFloat(m[1]) : 0 };
        }).filter(r => r.text.length > 5);
    });

    if (!reviews.length) return null;
    return analyseReviews(reviews);
}

function analyseReviews(reviews) {
    let posScore = 0, negScore = 0;
    const themeCounts = Object.fromEntries(Object.keys(THEME_KEYWORDS).map(k => [k, 0]));
    const snippets    = { positive: [], negative: [] };

    for (const { text } of reviews) {
        const lower = text.toLowerCase();
        const pos = SENTIMENT_DICT.positive.filter(w => lower.includes(w)).length;
        const neg = SENTIMENT_DICT.negative.filter(w => lower.includes(w)).length;
        posScore += pos;
        negScore += neg;

        for (const [theme, words] of Object.entries(THEME_KEYWORDS)) {
            if (words.some(w => lower.includes(w))) themeCounts[theme]++;
        }

        if (pos > neg && snippets.positive.length < 2) {
            snippets.positive.push(text.slice(0, 140));
        } else if (neg > pos && snippets.negative.length < 2) {
            snippets.negative.push(text.slice(0, 140));
        }
    }

    const total = posScore + negScore || 1;
    const sentimentScore = Math.round((posScore / total) * 100);

    const label =
        sentimentScore >= 75 ? 'Positive' :
        sentimentScore >= 50 ? 'Mixed'    :
        sentimentScore >= 25 ? 'Negative' : 'Very negative';

    const topThemes = Object.entries(themeCounts)
        .filter(([, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .map(([theme]) => theme);

    return {
        label,
        score: sentimentScore,
        topThemes,
        reviewsAnalysed: reviews.length,
        avgRating: +(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1),
        snippets,
    };
}


// ─────────────────────────────────────────────────────────────────────────────
// MASTER — called from main.js after Maps Overview navigation
// ─────────────────────────────────────────────────────────────────────────────

export async function enrichLawyerFields(page, place) {
    const enriched = { ...place };

    // Practice areas from Maps signals only (sub-categories + name keywords)
    enriched.practiceAreas = inferPracticeAreas(place);

    // Languages: Maps "About" panel sometimes carries them
    const langs = await extractLanguagesFromMaps(page).catch(() => null);
    if (langs) enriched.languagesSpoken = langs;

    // reviewSentiment runs LAST — it clicks the Reviews tab and leaves the
    // panel there. Everything else must complete on the Overview tab first.
    enriched.reviewSentiment = await extractReviewSentiment(page).catch(() => null);

    return enriched;
}
