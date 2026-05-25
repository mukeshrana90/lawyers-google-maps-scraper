# Lawyers Google Maps Scraper

Scrape **lawyers and law firms** from Google Maps with deep enrichment for legal-vertical lead generation — emails, social media, practice areas, fee structure, languages spoken, services list, review sentiment, online-booking detection, free-consultation availability, metro classification, and firm-size categorization.

35+ fields per record. Pay-per-event pricing — pay only for the enrichments you turn on.

## What you get

For every lawyer / law firm matched on Google Maps:

### Base data (always included)
- Name, Google Maps category, sub-category tags
- Full parsed address (street, city, state, country, postal code)
- Latitude / longitude, place ID, direct Maps URL
- Phone, website
- Rating, review count, hours, is-open-now

### Optional enrichments

| Toggle | Adds |
|---|---|
| **Extract emails** | Best contact email from the firm's website. Scoring prefers `intake@`, `consult@`, `partner@`, `info@`, `contact@` — Sentry / Wix / no-reply / placeholder addresses are filtered out. |
| **Extract social media links** | Instagram, Facebook, LinkedIn, X/Twitter — with widget-brand filtering (no Bolt, no copyright-year false positives, no `/p/` post URLs). |
| **Lawyer enrichment** | `practiceAreas` (16 categories: PI, immigration, criminal, family, IP, etc.), `feeStructure` (contingency / hourly / flat / free consultation / sliding scale / pro bono), `languagesSpoken` (Spanish, Mandarin, Russian, Arabic, etc.), `servicesOffered` (extracted from the firm's services / practice-area page), `reviewSentiment` (keyword-based scoring with legal-tuned dictionary; themes include expertise, communication, professionalism, case outcomes, fees, empathy). |
| **Niche classification** | `hasOnlineBooking` + platform (Calendly, Acuity, Clio Grow, Squarespace Scheduling, Setmore, HubSpot Meetings), `hasFreeConsultation` + URL, `isMetroArea` + `metroName` + `metroTier` (coordinate-based detection covering 30+ global metros), `firmSize` (solo / small / mid / large) with confidence + signals. |

## Use cases

- **Bar association directories** — bulk-enrich law firm contact data
- **Legal marketing agencies** — lead lists for outbound to specific practice areas
- **Insurance carriers** — find PI lawyers in metro areas they cover
- **Legal tech vendors** — segment by firm size and existing platform usage (Clio, MyCase, etc.)
- **Translation / interpretation services** — find firms claiming specific languages
- **CRM enrichment** — refresh contact + practice details on existing firm rosters

## Input

```json
{
  "searchTerms": ["personal injury lawyer", "immigration attorney"],
  "locations": ["New York, USA"],
  "maxResults": 50,
  "minRating": 0,
  "enrichEmails": true,
  "enrichSocials": true,
  "enrichLawyer": true,
  "enrichLawyerNiche": true,
  "proxyConfig": { "useApifyProxy": true }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `searchTerms` | string[] | `["personal injury lawyer"]` | Practice-area search queries |
| `locations` | string[] | `["New York, USA"]` | Cities, regions, countries |
| `maxResults` | int | `50` | Total places across all searches (1–500) |
| `minRating` | number | `0` | Filter places below this Google rating |
| `enrichEmails` | bool | `false` | Visit firm website, extract best contact email |
| `enrichSocials` | bool | `false` | Extract Instagram / Facebook / LinkedIn / X handles |
| `enrichLawyer` | bool | `false` | Practice areas, fee structure, languages, services, sentiment |
| `enrichLawyerNiche` | bool | `false` | Booking platform, free consultation, metro, firm size |
| `proxyConfig` | object | `{ useApifyProxy: true }` | Residential recommended for high volume |

## Sample output

```json
{
  "name": "Cellino Law LLP",
  "category": "Personal injury attorney",
  "practiceAreas": ["Personal Injury", "Medical Malpractice", "Workers Compensation"],
  "fullAddress": "420 Lexington Ave Suite 2840, New York, NY 10170, United States",
  "city": "New York",
  "state": "NY",
  "latitude": 40.7521,
  "longitude": -73.9756,
  "phone": "+12128887800",
  "website": "https://cellinolaw.com/",
  "email": "intake@cellinolaw.com",
  "instagram": "https://instagram.com/cellinolaw",
  "linkedin": "https://linkedin.com/company/cellino-law",
  "feeStructure": ["contingency", "free_consultation"],
  "languagesSpoken": ["Spanish", "Italian"],
  "servicesOffered": ["Car Accidents", "Slip & Fall", "Construction Accidents", "Wrongful Death"],
  "reviewSentiment": {
    "label": "Positive",
    "score": 91,
    "topThemes": ["expertise", "communication", "caseOutcome"],
    "reviewsAnalysed": 10,
    "avgRating": 4.8
  },
  "hasOnlineBooking": true,
  "bookingPlatform": "calendly.com",
  "bookingUrl": "https://calendly.com/cellino-law/consult",
  "hasFreeConsultation": true,
  "isMetroArea": true,
  "metroName": "New York Metro",
  "metroTier": 1,
  "firmSize": "large",
  "firmSizeLabel": "Large Law Firm",
  "rating": 4.9,
  "reviewCount": 3142
}
```

## Pricing

Pay-per-event:

| Event | Triggers | Price |
|---|---|---:|
| `apify-actor-start` | Once per run | $0.00005 |
| `apify-default-dataset-item` | Per result | $0.005 |
| `email-enrichment` | Per result if `enrichEmails` true | $0.005 |
| `social-enrichment` | Per result if `enrichSocials` true | $0.002 |
| `lawyer-enrichment` | Per result if `enrichLawyer` true | $0.013 |
| `niche-enrichment` | Per result if `enrichLawyerNiche` true | $0.005 |

Indicative totals: **$5 / 1000** base, **$30 / 1000** with all four enrichments enabled.

## Notes & limitations

- Sentiment analysis is keyword-based (no LLM cost). Themes are coarse but useful for segmentation.
- Firm-size classification is heuristic (name keywords + review count). Confidence is reported per result.
- Google Maps occasionally widens the search beyond the location keyword — expect some adjacent-area results.
- The actor is anti-block-friendly (random delays, consent-dialog handling, single website visit per place) but residential proxies are recommended for high-volume runs.
