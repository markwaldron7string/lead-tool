// lib/processor.js
// Deduplication, classification, state normalisation, scoring, filtering, CSV export.

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
  "smsf":                "SMSF",
  "off the plan":        "Off-the-plan",
  "off-the-plan":        "Off-the-plan",
  "project sales":       "Project sales",
  "project marketing":   "Project sales",
  "investment":          "Investment BA",
  "first home":          "Owner-occupier",
  "property advisor":    "Property advisor",
  "property strategist": "Property advisor",
};

const STATE_MAP = {
  'NSW': 'New South Wales',   'VIC': 'Victoria',
  'QLD': 'Queensland',        'SA':  'South Australia',
  'WA':  'Western Australia', 'TAS': 'Tasmania',
  'NT':  'Northern Territory','ACT': 'Australian Capital Territory',
  'New South Wales': 'New South Wales', 'Victoria': 'Victoria',
  'Queensland': 'Queensland', 'South Australia': 'South Australia',
  'Western Australia': 'Western Australia', 'Tasmania': 'Tasmania',
  'Northern Territory': 'Northern Territory',
  'Australian Capital Territory': 'Australian Capital Territory',
  'Australian Capital Territory (ACT)': 'Australian Capital Territory',
  'Northern Territory (NT)': 'Northern Territory',
};

function normaliseState(raw) {
  if (!raw) return '';
  return STATE_MAP[raw.trim()] || raw.trim();
}

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
  const catFields = Array.from({ length: 10 }, (_, i) => row[`categories/${i}`] || "");
  const text = [row.title || "", row.categoryName || "", sourceName, ...catFields]
    .join(" ").toLowerCase();
  const hasGood = GOOD_KW.some(k => text.includes(k));
  const hasBad  = HARD_EXCLUDE_KW.some(k => text.includes(k));
  if (hasBad && !hasGood) return "EXCLUDED";
  for (const cat of CATEGORIES) {
    if (cat.kw.some(k => text.includes(k))) return cat.name;
  }
  if (row._category && row._category !== "Uncategorised" && row._category !== "EXCLUDED") {
    return row._category;
  }
  return getSourceHint(sourceName) || "Uncategorised";
}

// ── Lead scoring ──────────────────────────────────────────────────────────────
// 0–100 points based on data completeness and quality.

export function scoreLead(lead) {
  let score = 0;

  if (lead.emails        && String(lead.emails).trim())        score += 30;
  if (lead.founder_name  && String(lead.founder_name).trim())  score += 20;
  if (lead.website       && String(lead.website).trim())       score += 10;
  if (lead.phone         && String(lead.phone).trim())         score += 10;

  const rating = parseFloat(lead.totalScore);
  if (!isNaN(rating)) {
    if      (rating >= 4.8) score += 15;
    else if (rating >= 4.5) score += 12;
    else if (rating >= 4.0) score += 8;
    else if (rating >= 3.5) score += 4;
  }

  const reviews = parseInt(lead.reviewsCount);
  if (!isNaN(reviews)) {
    if      (reviews >= 50) score += 10;
    else if (reviews >= 20) score += 7;
    else if (reviews >= 10) score += 4;
    else if (reviews >= 1)  score += 2;
  }

  if (lead._category && lead._category !== 'Uncategorised' && lead._category !== 'EXCLUDED') {
    score += 5;
  }

  // Bonus points for social presence (enrichment rewards)
  if (lead.linkedin_company  && String(lead.linkedin_company).trim())  score = Math.min(100, score + 3);
  if (lead.linkedin_personal && String(lead.linkedin_personal).trim()) score = Math.min(100, score + 3);
  if (lead.instagram         && String(lead.instagram).trim())         score = Math.min(100, score + 2);
  if (lead.abn               && String(lead.abn).trim())               score = Math.min(100, score + 2);

  return score;
}

// ── Process files ─────────────────────────────────────────────────────────────

export function processFiles(fileDataArray) {
  const seen = new Map();
  let totalRows = 0, dupes = 0;

  for (const file of fileDataArray) {
    const sourceName = file.name.replace(/\.csv$/i, "").replace(/_/g, " ");

    for (const row of file.rows) {
      if (!row || typeof row !== "object") continue;
      totalRows++;

      const title = (row.title || row["Business Name"] || "").trim();
      if (!title) continue;

      const key          = normalizeKey(title);
      const emails       = String(row.emails        || row.Email          || row.Emails           || "").trim();
      const founderName  = String(row.founder_name  || row["Founder Name"]|| "").trim();
      const linkedinCo   = String(row.linkedin_company  || row["LinkedIn Company"]  || "").trim();
      const linkedinPers = String(row.linkedin_personal || row["LinkedIn Personal"] || "").trim();
      const instagram    = String(row.instagram     || row.Instagram      || "").trim();
      const facebook     = String(row.facebook      || row.Facebook       || "").trim();
      const abn          = String(row.abn           || row.ABN            || "").trim();
      const entityType   = String(row.entity_type   || row["Entity Type"] || "").trim();

      if (seen.has(key)) {
        // Merge any missing contact/social data from duplicates
        const ex = seen.get(key);
        if (!ex.emails          && emails)       ex.emails          = emails;
        if (!ex.founder_name    && founderName)  ex.founder_name    = founderName;
        if (!ex.linkedin_company  && linkedinCo)   ex.linkedin_company  = linkedinCo;
        if (!ex.linkedin_personal && linkedinPers)  ex.linkedin_personal = linkedinPers;
        if (!ex.instagram       && instagram)    ex.instagram       = instagram;
        if (!ex.facebook        && facebook)     ex.facebook        = facebook;
        if (!ex.abn             && abn)          ex.abn             = abn;
        if (!ex.entity_type     && entityType)   ex.entity_type     = entityType;
        ex._score = scoreLead(ex);
        dupes++;
        continue;
      }

      const processed = {
        title,
        phone:             String(row.phone        || row.Phone    || "").trim(),
        website:           String(row.website      || row.Website  || "").trim(),
        street:            String(row.street       || row.Street   || "").trim(),
        city:              String(row.city         || row.City     || "").trim(),
        state:             normaliseState(String(row.state || row.State || "").trim()),
        totalScore:        String(row.totalScore   || row.Rating   || "").trim(),
        reviewsCount:      String(row.reviewsCount || row.Reviews  || "").trim(),
        emails,
        founder_name:      founderName,
        linkedin_company:  linkedinCo,
        linkedin_personal: linkedinPers,
        instagram,
        facebook,
        abn,
        entity_type:       entityType,
        _source:           String(row["Source Search"] || sourceName).trim(),
        _category:         "Uncategorised",
        _score:            0,
      };

      processed._category = classify({ ...row, title }, processed._source);
      processed._score    = scoreLead(processed);
      seen.set(key, processed);
    }
  }

  const leads = [...seen.values()];

  const excluded    = leads.filter(r => r._category === "EXCLUDED").length;
  const unknown     = leads.filter(r => r._category === "Uncategorised").length;
  const categorised = leads.length - excluded - unknown;
  const hasEmail    = leads.filter(r => r.emails).length;
  const hasName     = leads.filter(r => r.founder_name).length;
  const hasLinkedIn = leads.filter(r => r.linkedin_company || r.linkedin_personal).length;
  const hasABN      = leads.filter(r => r.abn).length;
  const states      = [...new Set(leads.map(r => r.state).filter(Boolean))].sort();

  const categoryBreakdown = {};
  for (const lead of leads) {
    if (lead._category === "EXCLUDED") continue;
    categoryBreakdown[lead._category] = (categoryBreakdown[lead._category] || 0) + 1;
  }

  const scoreDist = {
    40: leads.filter(r => (Number(r._score) || 0) >= 40).length,
    60: leads.filter(r => (Number(r._score) || 0) >= 60).length,
    75: leads.filter(r => (Number(r._score) || 0) >= 75).length,
  };

  return {
    leads,
    stats: {
      totalRows, dupes,
      unique: leads.length,
      categorised, unknown, excluded,
      hasEmail, hasName, hasLinkedIn, hasABN,
      categoryBreakdown, states, scoreDist,
    },
  };
}

export function filterLeads(leads, { search, state, category, minScore }) {
  return leads.filter(lead => {
    if (search) {
      const q   = search.toLowerCase();
      const hay = `${lead.title} ${lead.city} ${lead.phone} ${lead.website} ${lead.emails} ${lead.founder_name} ${lead.abn}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (state    && lead.state     !== state)    return false;
    if (category && lead._category !== category) return false;
    if (minScore > 0 && (Number(lead._score) || 0) < minScore) return false;
    return true;
  });
}

export function leadsToCSV(leads) {
  const cols = [
    "title", "phone", "website", "street", "city", "state",
    "totalScore", "reviewsCount",
    "emails", "founder_name",
    "linkedin_company", "linkedin_personal", "instagram", "facebook",
    "abn", "entity_type",
    "_category", "_score", "_source",
  ];
  const headers = [
    "Business Name", "Phone", "Website", "Street", "City", "State",
    "Rating", "Reviews",
    "Emails", "Founder Name",
    "LinkedIn Company", "LinkedIn Personal", "Instagram", "Facebook",
    "ABN", "Entity Type",
    "Category", "Lead Score", "Source Search",
  ];
  const escape = v => `"${String(v || "").replace(/"/g, '""')}"`;
  const rows = leads.map(r => cols.map(c => escape(r[c])).join(","));
  return [headers.join(","), ...rows].join("\n");
}