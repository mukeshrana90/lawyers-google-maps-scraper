import { log } from './utils.js';

// Each social platform: regex (global, so we can scan all candidates), invalid
// slugs (share widgets, generic pages), and a URL builder. We iterate matches
// and pick the first slug that doesn't look like junk.
const SOCIAL_EXTRACTORS = {
    instagram: {
        regex: /(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9_.]+)/gi,
        invalidSlugs: new Set([
            'p', 'reel', 'reels', 'explore', 'tv', 'directory', 'stories',
            'accounts', 'about', 'developer', 'legal', 'web', 'share',
        ]),
        build: slug => `https://instagram.com/${slug}`,
    },
    facebook: {
        regex: /(?:https?:\/\/)?(?:www\.|m\.)?facebook\.com\/([A-Za-z0-9_.-]+)/gi,
        invalidSlugs: new Set([
            'sharer', 'share', 'plugins', 'dialog', 'tr', 'pages',
            'login', 'help', 'policy', 'privacy', 'about', 'careers',
            'business', 'home.php', 'l.php', 'profile.php',
            'p', 'groups', 'events', 'reel', 'watch', 'photo', 'story.php',
        ]),
        build: slug => `https://facebook.com/${slug}`,
    },
    linkedin: {
        regex: /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/(company|in)\/([A-Za-z0-9_-]+)/gi,
    },
    twitter: {
        regex: /(?:https?:\/\/)?(?:www\.)?(?:twitter|x)\.com\/([A-Za-z0-9_]+)/gi,
        invalidSlugs: new Set([
            'intent', 'share', 'home', 'search', 'i', 'compose',
            'explore', 'notifications', 'messages',
            'bolt', 'stripe', 'shopify', 'squarespace', 'wix', 'wordpress',
            'godaddy', 'mailchimp', 'klaviyo', 'hubspot', 'segment',
        ]),
        build: slug => `https://x.com/${slug}`,
    },
};

// Emails to ignore. For the legal vertical, "info" and "contact" addresses
// ARE valuable (they're often the firm's published intake email), so we don't
// blacklist them — only obvious tech/PR/no-reply patterns.
const EMAIL_BLACKLIST = [
    'example', 'test', 'noreply', 'no-reply',
    'privacy', 'abuse', 'webmaster', 'postmaster',
    'sentry', 'wix', 'wordpress', 'shopify', 'press',
];

const INVALID_TLDS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'css', 'js', 'html', 'xml', 'json', 'woff', 'woff2', 'ttf', 'eot', 'map'];

function extractBestEmail(html, websiteUrl) {
    const matches = [...html.matchAll(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g)]
        .map(m => m[0].toLowerCase())
        .filter(e => {
            const tld = e.split('.').pop();
            return !INVALID_TLDS.includes(tld);
        });

    if (!matches.length) return null;

    const domain = extractDomain(websiteUrl);

    const scored = matches
        .filter(e => !isBlacklisted(e))
        .map(e => ({ email: e, score: scoreEmail(e, domain) }))
        .sort((a, b) => b.score - a.score);

    return scored[0]?.email ?? null;
}

function scoreEmail(email, domain) {
    let score = 0;
    const [prefix] = email.split('@');
    const emailDomain = email.split('@')[1];

    if (domain && emailDomain?.includes(domain)) score += 10; // domain match
    // Legal-specific decision-maker prefixes
    if (/^(intake|consult|consultation|newclient|new\.client)/i.test(prefix)) score += 10;
    if (/^(info|contact|hello|admin|reception)/i.test(prefix))                score += 6;
    if (/^(attorney|lawyer|paralegal|partner|associate|founder|principal)/i.test(prefix)) score += 8;
    if (prefix.length < 30) score += 2;
    return score;
}

const DOMAIN_BLACKLIST = [
    'google.com', 'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com',
    'domain.com', 'example.com', 'example.org', 'example.net',
    'yourdomain.com', 'mydomain.com', 'site.com', 'website.com',
    'company.com', 'email.com', 'mail.com', 'placeholder.com', 'sample.com',
];

function isBlacklisted(email) {
    const domain = email.split('@')[1];
    if (DOMAIN_BLACKLIST.includes(domain)) return true;
    if (domain && EMAIL_BLACKLIST.some(bad => domain.includes(bad))) return true;
    return EMAIL_BLACKLIST.some(bad => email.includes(bad + '@') || email.startsWith(bad));
}

async function tryContactPage(page, baseUrl) {
    try {
        const url = new URL('/contact', baseUrl).href;
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10_000 });
        const html = await page.content();
        return extractBestEmail(html, baseUrl);
    } catch {
        return null;
    }
}

function extractSocialLinks(html) {
    const result = {};

    const li = html.match(SOCIAL_EXTRACTORS.linkedin.regex);
    if (li) {
        const m = li[0].match(/linkedin\.com\/(company|in)\/([A-Za-z0-9_-]+)/i);
        if (m) result.linkedin = `https://linkedin.com/${m[1]}/${m[2]}`;
    }

    for (const platform of ['instagram', 'facebook', 'twitter']) {
        const cfg = SOCIAL_EXTRACTORS[platform];
        for (const m of html.matchAll(cfg.regex)) {
            const slug = m[1].replace(/[/?#].*$/, '').toLowerCase();
            if (!slug) continue;
            if (cfg.invalidSlugs.has(slug)) continue;
            if (/^\d+$/.test(slug) && slug.length < 12) continue;
            if (slug.endsWith('.php')) continue;
            result[platform] = cfg.build(slug);
            break;
        }
    }

    return result;
}

function extractDomain(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return null;
    }
}

export { extractBestEmail, extractSocialLinks, tryContactPage };
