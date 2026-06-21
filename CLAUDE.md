# Lawyers Google Maps Scraper

Apify actor that scrapes lawyers and law firms from Google Maps and enriches them with contact details (emails, social media), practice areas, fee structure, languages spoken, services offered, review sentiment, online-booking / free-consultation detection, metro classification, and firm-size categorization.

## Tech Stack

- **Runtime:** Node.js (ES modules)
- **Dependencies:** apify ^3.2.0, crawlee ^3.8.0, playwright ^1.44.0
- **Browser:** Playwright (headless, residential proxies recommended)

## Commands

- `npm start` — Run actor in production
- `npm run dev` — Run locally (stores data in `./storage/`)
- No test or lint setup yet

## Architecture

```
src/
  main.js              — Entry point: orchestrates the per-place website-visit
                          and pure-compute classification phases
  scraper.js           — Google Maps scraping: scroll results, visit each place,
                          extract details AND run Maps-Overview enrichment
                          (niche detection + lawyer fields incl. review
                          sentiment) on the same freshly-loaded page
  enricher.js          — Pure HTML helpers: extractBestEmail, extractSocialLinks,
                          tryContactPage. Scoring tuned for legal: intake@ /
                          consult@ / partner@ score higher than restaurant case.
  lawyerEnrichment.js  — Practice areas, fee structure, languages spoken,
                          services offered, review sentiment (legal keyword dict)
  lawyerNiche.js       — Online booking (Calendly / Acuity / Clio), free
                          consultation, metro detection, firm-size classification
  utils.js             — buildSearchUrls(), randomDelay(), navigateWithRetry()
```

**Flow:** Actor init → build search URLs → PlaywrightCrawler → for each place:
0. (in scraper.js, on the place's freshly-loaded page) Maps Overview enrichment —
   niche detection runs before lawyer enrichment because the latter clicks the
   Reviews tab. Done here, NOT via a second navigation, so each place is loaded
   once — this halves Maps loads (less Google throttling) and runs review
   sentiment on a page known to have rendered.
1. (main.js) Single website visit (emails + socials + practice areas + fee +
   languages + services + booking + free-consult detection — all in one nav).
2. (main.js) Pure-compute firm-size classification.
3. PPE charge calls per enabled enrichment.

## Input

Defined in `INPUT_SCHEMA.json`: searchTerms, locations, maxResults, minRating,
enrichEmails, enrichSocials, enrichLawyer, enrichLawyerNiche, proxyConfig.

## Output

35+ fields per record: name, category, practiceAreas, address (parsed), phone,
website, email, social links, feeStructure, languagesSpoken, servicesOffered,
hasOnlineBooking, hasFreeConsultation, firmSize, rating, reviewCount,
reviewSentiment, hours, coordinates, placeId, mapsUrl, scrapedAt.

## Conventions

- ES module imports (`import`/`export`)
- Apify SDK patterns: `Actor.init()`, `Actor.getInput()`, `Actor.charge()`, `Actor.exit()`
- Anti-detection: random delays, consent dialog dismissal, human-like scrolling
- Deduplication by `placeId`
- Per-enrichment PPE billing: `email-enrichment`, `social-enrichment`,
  `lawyer-enrichment`, `niche-enrichment`

## Domain mapping (vs restaurants actor)

| Restaurant field        | Lawyer equivalent       |
|-------------------------|-------------------------|
| `cuisine`               | `practiceAreas`         |
| `priceRange`            | `feeStructure`          |
| `dietaryOptions`        | `languagesSpoken`       |
| `menuHighlights`        | `servicesOffered`       |
| `hasOnlineOrdering`     | `hasOnlineBooking`      |
| `hasReservation`        | `hasFreeConsultation`   |
| `restaurantType`        | `firmSize`              |
| `metroName`             | unchanged               |
