# Buyers Agent Lead Scraper

A full-stack tool for scraping, deduplicating, categorising, and AI-enriching buyers agent leads across Australia. Built with Next.js, Python, and the OpenAI API.

---

## What This Does

Finds every buyers agent business in Australia on Google Maps, cleans the data, extracts contact information from each website, and presents everything in a searchable web dashboard the client can use for outreach.

**Final dataset:** ~2,865 unique businesses · 1,361 emails · 1,661 founder names · 1,018 leads with both

---

## Architecture

```
Step 1 — Apify (Google Maps scraper)
  ↓ exports raw CSV files

Step 2 — Python scraper (contact enrichment)
  ↓ reads CSVs, visits each website, extracts emails
  ↓ outputs buyers_agents_master.csv

Step 3 — Name cleaner (Python)
  ↓ strips junk from founder name field
  ↓ outputs buyers_agents_clean.csv

Step 4 — Next.js web app (this repo)
  ↓ upload CSVs → deduplicate → categorise → AI enrich → export
```

---

## Project Structure

```
lead-tool/                          # Next.js app (this repo)
  app/
    page.js                         # Main UI — upload, table, filters, export
    globals.css                     # Dark theme, design tokens
    layout.js                       # Root layout
    api/
      enrich/
        route.js                    # API route — fetches website + calls GPT
  lib/
    processor.js                    # Dedup, classify, filter, CSV export logic
  .env.local                        # API keys (never committed)

lead-scraper/                       # Python scripts (separate folder, not deployed)
  scrape_contacts.py                # Reads Apify CSVs, scrapes emails from websites
  clean_names.py                    # Cleans junk from GPT-extracted founder names
  buyers_agents_master.csv          # Output of scrape_contacts.py
  buyers_agents_clean.csv           # Output of clean_names.py
  *.csv                             # Raw Apify exports (80 files)
```

---

## Setup

### Prerequisites
- Node.js 18+
- Python 3.11+
- An OpenAI API key ([platform.openai.com](https://platform.openai.com))
- An Apify account ([apify.com](https://apify.com))

### Next.js App

```bash
cd lead-tool
npm install
```

Create `.env.local` in the root of the project:
```
OPENAI_API_KEY=sk-proj-your-key-here
```

Start the dev server:
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

### Python Scripts

```bash
pip3 install requests beautifulsoup4 pandas
```

---

## How to Use

### 1. Scrape with Apify

Use the **Google Maps Scraper** actor on Apify. Run it with these search terms across all 8 Australian capital cities (Sydney, Melbourne, Brisbane, Perth, Adelaide, Canberra, Darwin, Hobart). Set results to **100 per search**.

Priority search terms:
- `buyers agent`
- `buyers advocate`
- `property buyers agency`
- `investment buyers agent`
- `SMSF buyers agent`
- `buyers agent first home`
- `off the plan buyers agent`
- `property advisor`
- `property acquisition`
- `property strategist`

Export each search as a CSV. Name files descriptively e.g. `buyers_agent_sydney.csv`.

### 2. Enrich emails with Python

Drop all Apify CSV exports into the `lead-scraper` folder alongside `scrape_contacts.py`. Run:

```bash
cd lead-scraper
python3 scrape_contacts.py
```

This will:
- Merge and deduplicate all CSVs
- Visit each business website
- Extract email addresses from contact/about pages
- Save results to `buyers_agents_master.csv`

Takes 2–3 hours for ~3,000 leads. Saves progress every 10 rows so it's safe to stop and restart.

### 3. Clean founder names

```bash
python3 clean_names.py
```

Strips page headings, brand names, and navigation text that got mistakenly extracted as founder names. Saves `buyers_agents_clean.csv`.

### 4. Use the web app

1. Go to [localhost:3000](http://localhost:3000) (or the deployed Vercel URL)
2. Upload all Apify CSVs + `buyers_agents_clean.csv` at once
3. The app merges, deduplicates, and categorises everything automatically
4. Use **Enrich all leads** to run AI extraction on founder names for any remaining gaps
5. Filter by state, category, or search
6. Export a clean CSV ready for outreach

---

## Lead Categories

The classifier tags each lead automatically based on keywords in their business name, Google categories, and the search term that found them:

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

## AI Enrichment

The **Enrich** feature uses `gpt-4o-mini` to read each business website and extract:
- Founder / principal name
- Job title
- Email address (if visible on the page)

**Realistic hit rates:**
- ~40% of sites return a real founder name
- ~25% of sites have no useful text (JavaScript-rendered or bot-protected)
- ~25% show contact forms instead of email addresses
- Email data from the Python scraper is more reliable than AI extraction

**Cost:** ~$0.00015 per lead with gpt-4o-mini. Full dataset of 2,865 leads costs approximately $0.43.

**Rate limiting:** Requests are batched 5 at a time with a 1.2 second delay between batches to stay within OpenAI limits.

---

## Environment Variables

| Variable | Description |
|---|---|
| `OPENAI_API_KEY` | OpenAI API key for AI enrichment |

Add to `.env.local` for local development. Add to Vercel environment variables for production.

---

## Deployment

The app is deployed on Vercel. Push to the connected GitHub repo and Vercel deploys automatically.

Before deploying, add `OPENAI_API_KEY` to your Vercel project environment variables:
1. Go to your project on [vercel.com](https://vercel.com)
2. Settings → Environment Variables
3. Add `OPENAI_API_KEY` with your key value

---

## What's Not in This Repo

The raw Apify CSV exports and Python output files are not committed to GitHub — they're too large and contain personal data. The `lead-scraper` folder lives locally only.

The `.env.local` file is excluded via `.gitignore` and must be recreated manually on any new machine.

---

## Future Improvements

- **Apollo.io / LinkedIn integration** — match business domains to LinkedIn profiles for verified founder data
- **Re-scrape on demand** — button to re-run Apify for a specific city/term from within the app
- **Outreach status tracking** — mark leads as contacted, replied, converted
- **Duplicate phone detection** — some businesses list multiple locations with the same phone number
- **Webhook integration** — push new leads directly to a CRM (HubSpot, Pipedrive) on export