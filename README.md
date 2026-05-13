# Buyers Agent Lead Scraper

A full-stack lead generation and enrichment tool for finding buyers agent businesses across Australia. Built with Next.js, Python, and the OpenAI API.

---

## What This Does

Finds, enriches, and organises every buyers agent business in Australia into a searchable dashboard. The client uses it to build outreach lists. The cold caller uses it to work through leads.

**Current dataset:** 2,865 unique businesses · 1,406 emails · 1,789 founder names · 791 LinkedIn pages · 1,285 Instagram handles · 2,703 ABNs verified

---

## Architecture

```
Step 1 — Google Places API (in-app scraper)
  ↓ search by term + city → structured lead data added to table instantly

Step 2 — AI Enrichment (in-app)
  ↓ visits each website → extracts email, founder name, LinkedIn, Instagram, Facebook
  ↓ powered by gpt-4o-mini

Step 3 — ABN Lookup (in-app)
  ↓ searches Australian Business Register by business name
  ↓ returns ABN, entity type (Pty Ltd, sole trader, etc.), GST status
  ↓ free, no per-request cost

Step 4 — Export
  ↓ clean CSV with all enriched data, ready for outreach or CRM import
```

---

## Project Structure

```
lead-tool/                          # Next.js app (this repo)
  app/
    page.js                         # Main UI — dashboard, table, filters, scraper
    globals.css                     # Dark theme, CSS variables, responsive styles
    layout.js                       # Root layout
    api/
      enrich/
        route.js                    # AI enrichment — fetches website, calls GPT
      abn/
        route.js                    # ABN lookup — calls Australian Business Register
      scrape/
        route.js                    # Google Places scraper — searches by term + city
  lib/
    processor.js                    # Dedup, classify, score, filter, CSV export logic
  public/
    leads.csv                       # Base dataset — auto-loaded on app open
  .env.local                        # API keys (never committed)
```

---

## Environment Variables

| Variable | Description | Where to get it |
|---|---|---|
| `OPENAI_API_KEY` | GPT-4o-mini for AI enrichment | [platform.openai.com](https://platform.openai.com) |
| `ABN_GUID` | Australian Business Register API | [abr.business.gov.au/Tools/WebServices](https://abr.business.gov.au/Tools/WebServices) |
| `GOOGLE_PLACES_KEY` | Google Places API for scraping | [console.cloud.google.com](https://console.cloud.google.com) |

Add to `.env.local` for local development. Add to Vercel environment variables for production.

---

## Setup

### Prerequisites
- Node.js 18+
- API keys for OpenAI, ABR, and Google Places (see above)

### Install & run

```bash
cd lead-tool
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## How to Use

### Scraping new leads

1. Open the **Scrape new leads** panel
2. Select a search term (e.g. "buyers agent") and a city
3. Click **⬇ Scrape leads** for a single city, or toggle **All cities** to run all 12 Australian capitals automatically
4. New leads appear in the table instantly — duplicates are skipped

**Recommended search terms for full coverage:**
- buyers agent / buyers advocate / property buyers agency
- investment buyers agent / SMSF buyers agent
- property advisor / property strategist / property acquisition
- off the plan buyers agent / buyers agent first home

**Cost:** ~$17 per 1,000 requests, covered by Google's $200/month free credit.

### Enriching leads

1. Click **✦ Enrich all leads** to run enrichment on the full dataset
2. Each lead gets: contact email, founder name, LinkedIn company + personal, Instagram, Facebook, ABN, entity type
3. Runs in batches of 5 with delays to respect API rate limits
4. Export the CSV immediately when finished — enriched data lives in browser memory

**Run enrichment on localhost:3000, not the Vercel deployment.** Vercel serverless functions have a 10-second timeout which will interrupt long enrichment runs.

**Cost:** ~$0.00015 per lead with gpt-4o-mini. Full dataset of 2,865 leads ≈ $0.43. ABN lookup is free and unlimited.

### Filtering and finding leads

- **Score filter** — filter by Good (40+), Great (60+), or Best (75+) based on data completeness
- **State filter** — filter by Australian state
- **Category filter** — filter by buyer type (Investment BA, SMSF, Owner-occupier, etc.)
- **Advanced filters** — filter by source search term
- **⊞ Columns** — toggle and resize any column including LinkedIn, Instagram, ABN, Entity Type
- **Search** — instant full-text search across name, city, phone, email, ABN

### Exporting

Click **Export CSV** to download the current filtered view. The exported CSV includes all 19 columns including all enriched social and ABN data.

---

## Lead Scoring (0–100)

Each lead is automatically scored based on data completeness:

| Signal | Points |
|---|---|
| Email address | 30 |
| Founder name | 20 |
| Website | 10 |
| Phone | 10 |
| Google rating 4.8+ | 15 |
| Google rating 4.5–4.7 | 12 |
| Review count 50+ | 10 |
| Categorised | 5 |
| LinkedIn / social presence | bonus |

Click the **ⓘ** next to the Score column header for a full breakdown with tier filter shortcuts.

---

## Lead Categories

| Category | What it means |
|---|---|
| **Investment BA** | Helps clients buy investment properties |
| **SMSF** | Specialises in using super funds to buy property |
| **Owner-occupier** | Helps people buy a home to live in |
| **Off-the-plan** | Sells new developer stock before construction |
| **Project sales** | Engaged by developers to sell specific projects |
| **Property advisor** | Coaches/mentors clients on property strategy |
| **Uncategorised** | Legitimate buyers agent, sub-type unclear |
| **EXCLUDED** | Not a buyers agent (property manager, mortgage broker, etc.) |

---

## Deployment

Deployed on Vercel. Push to the connected GitHub repo and Vercel redeploys automatically.

After a full enrichment run:
```bash
# Copy the exported CSV to the public folder
cp ~/Downloads/buyers_agents_YYYY-MM-DD.csv ~/Desktop/lead-tool/public/leads.csv

# Commit and push — Vercel redeploys with enriched data baked in
git add .
git commit -m "update leads dataset"
git push
```

---

## API Costs Summary

| Service | Cost | Free tier |
|---|---|---|
| OpenAI gpt-4o-mini | ~$0.43 per full enrichment run | $5 signup credit |
| Google Places API | ~$17 per 1,000 searches | $200/month credit |
| ABR (ABN Lookup) | Free | Unlimited |

---

## Future Improvements

- **Cold caller view** — simplified call list mode with status tracking (Not called / Called / Interested / Not interested)
- **Apollo.io / LinkedIn integration** — match domains to LinkedIn profiles for verified founder data
- **Outreach status tracking** — mark leads as contacted, replied, converted directly in the dashboard
- **Webhook / CRM export** — push leads directly to HubSpot, Pipedrive, or similar on export
- **Re-enrich on demand** — button to re-run enrichment only on leads missing social or ABN data