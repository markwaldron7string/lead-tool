// lib/processor.js
// Pure logic — no UI. Handles deduplication, classification, and stats.

// ── Signals ──────────────────────────────────────────────────────────────────

const GOOD_KW = [
  "buyer's agent", "buyers agent", "buyer agent", "buyers advocate",
  "buyer advocate", "buyers agency", "buyer agency", "property buyer",
  "property finder", "buyers representative", "acquisition specialist",
  "off-market", "buyers consultant", "property acquisition",
  "buyers concierge", "buyer representative", "property advocacy",
];

const HARD_EXCLUDE_KW = [
  "property management company", "rental management", "strata management",
  "conveyancing", "conveyancer", "mortgage broker", "mortgage broking",
  "building inspection", "pest inspection", "real estate agent",
  "listing agent", "selling agent", "vendor agent",
  "property developer", "land developer",
];

const CATEGORIES = [
  { name: "SMSF",             kw: ["smsf", "self managed super", "superannuation property", "super fund property"] },
  { name: "Off-the-plan",     kw: ["off the plan", "off-the-plan", "display suite", "display home", "new development", "developer stock", "new homes"] },
  { name: "Project sales",    kw: ["project sales", "project marketing", "development marketing", "channel sales", "new home sales"] },
  { name: "Investment BA",    kw: ["investment property", "property investment", "investor", "wealth creation", "portfolio", "cashflow", "cash flow", "rental yield", "capital growth", "passive income", "financial freedom"] },
  { name: "Owner-occupier",   kw: ["owner occupier", "owner-occupier", "first home buyer", "first home", "home buyer", "dream home", "family home", "residential buyer"] },
  { name: "Property advisor", kw: ["property coach", "property mentor", "property educator", "property strategist", "wealth advisor", "strategic advisor", "property consulting", "advisory service"] },
];

const SOURCE_HINTS = {
  "smsf":              "SMSF",
  "off the plan":      "Off-the-plan",
  "off-the-plan":      "Off-the-plan",
  "project sales":     "Project sales",
  "project marketing": "Project sales",
  "investment":        "Investment BA",
  "first home":        "Owner-occupier",
  "property advisor":  "Property advisor",
  "property strategist": "Property advisor",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function getSourceHint(source) {
  const s = (source || "").toLowerCase();
  for (const [k, v] of Object.entries(SOURCE_HINTS)) {
    if (s.includes(k)) return v;
  }
  return null;
}

function normalizeKey(title) {
  return (title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function classify(row, sourceName) {
  // Build a combined text from all available fields
  const catFields = Array.from({ length: 10 }, (_, i) => row[`categories/${i}`] || "");
  const text = [
    row.title || "",
    row.categoryName || "",
    sourceName,
    ...catFields,
  ].join(" ").toLowerCase();

  const hasGood = GOOD_KW.some(k => text.includes(k));
  const hasBad  = HARD_EXCLUDE_KW.some(k => text.includes(k));

  if (hasBad && !hasGood) return "EXCLUDED";

  for (const cat of CATEGORIES) {
    if (cat.kw.some(k => text.includes(k))) return cat.name;
  }

  // If it came in via an enriched CSV that already has _category, preserve it
  if (row._category && row._category !== "Uncategorised" && row._category !== "EXCLUDED") {
    return row._category;
  }

  const hint = getSourceHint(sourceName);
  if (hint) return hint;

  return "Uncategorised";
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * processFiles
 * Takes an array of { name: string, rows: object[] } (parsed CSV data)
 * Returns { leads: object[], stats: object }
 */
export function processFiles(fileDataArray) {
  const seen = new Map();
  let totalRows = 0;
  let dupes = 0;

  for (const file of fileDataArray) {
    const sourceName = file.name
      .replace(/\.csv$/i, "")
      .replace(/_/g, " ");

    for (const row of file.rows) {
      if (!row || typeof row !== "object") continue;
      totalRows++;

      const title = (row.title || row["Business Name"] || "").trim();
      if (!title) continue;

      const key = normalizeKey(title);
      if (seen.has(key)) {
        dupes++;
        continue;
      }

      const processed = {
        // Normalise field names — handle both raw Apify and enriched CSV
        title,
        phone:        row.phone        || row.Phone        || "",
        website:      row.website      || row.Website      || "",
        street:       row.street       || row.Street       || "",
        city:         row.city         || row.City         || "",
        state:        row.state        || row.State        || "",
        totalScore:   row.totalScore   || row.Rating       || "",
        reviewsCount: row.reviewsCount || row.Reviews      || "",
        emails:       row.emails       || row.Email        || "",
        founder_name: row.founder_name || row["Founder Name"] || "",
        _source:      row["Source Search"] || sourceName,
        _category:    "Uncategorised", // set below
      };

      processed._category = classify({ ...row, title }, processed._source);
      seen.set(key, processed);
    }
  }

  const leads = [...seen.values()];

  // ── Stats ─────────────────────────────────────────────────────────────────
  const excluded    = leads.filter(r => r._category === "EXCLUDED").length;
  const unknown     = leads.filter(r => r._category === "Uncategorised").length;
  const categorised = leads.length - excluded - unknown;
  const hasEmail    = leads.filter(r => r.emails && r.emails.trim()).length;
  const hasName     = leads.filter(r => r.founder_name && r.founder_name.trim()).length;

  // Category breakdown (excluding EXCLUDED)
  const categoryBreakdown = {};
  for (const lead of leads) {
    if (lead._category === "EXCLUDED") continue;
    categoryBreakdown[lead._category] = (categoryBreakdown[lead._category] || 0) + 1;
  }

  // Unique states
  const states = [...new Set(leads.map(r => r.state).filter(Boolean))].sort();

  const stats = {
    totalRows,
    dupes,
    unique:      leads.length,
    categorised,
    unknown,
    excluded,
    hasEmail,
    hasName,
    categoryBreakdown,
    states,
  };

  return { leads, stats };
}

/**
 * filterLeads
 * Client-side filtering — fast, no re-processing needed
 */
export function filterLeads(leads, { search, state, category }) {
  return leads.filter(lead => {
    if (search) {
      const q = search.toLowerCase();
      const haystack = `${lead.title} ${lead.city} ${lead.phone} ${lead.website} ${lead.emails}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (state && lead.state !== state) return false;
    if (category && lead._category !== category) return false;
    return true;
  });
}

/**
 * leadsToCSV
 * Converts a leads array to a CSV string for download
 */
export function leadsToCSV(leads) {
  const cols = [
    "title", "phone", "website", "street", "city", "state",
    "totalScore", "reviewsCount", "emails", "founder_name",
    "_category", "_source",
  ];
  const headers = [
    "Business Name", "Phone", "Website", "Street", "City", "State",
    "Rating", "Reviews", "Emails", "Founder Name",
    "Category", "Source Search",
  ];
  const escape = v => `"${String(v || "").replace(/"/g, '""')}"`;
  const rows = leads.map(r => cols.map(c => escape(r[c])).join(","));
  return [headers.join(","), ...rows].join("\n");
}