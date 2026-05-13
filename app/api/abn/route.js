// app/api/abn/route.js
// Looks up Australian Business Number (ABN) using the free ABR API.
// Requires: ABN_GUID in .env.local
// Get your free GUID at: https://abr.business.gov.au/Tools/WebServices

const ENTITY_TYPES = {
  IND: "Individual / Sole Trader",
  PRV: "Australian Private Company",
  PUB: "Australian Public Company",
  PTR: "Partnership",
  TRT: "Trust",
  SUP: "Super Fund",
  NRP: "Non-Registered Body",
  OTH: "Other",
  COP: "Co-operative",
  UTR: "Unit Trust",
  DFT: "Discretionary Trust",
  DIT: "Discretionary Investment Trust",
  DTT: "Discretionary Trading Trust",
};

// ── XML helpers ───────────────────────────────────────────────────────────────

function extractXML(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\\/${tag}>`, "i"));
  return match ? match[1].trim() : null;
}

function extractAllXML(xml, tag) {
  const results = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

function formatABN(raw) {
  const digits = (raw || "").replace(/\D/g, "");
  if (digits.length !== 11) return digits;
  return `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5, 8)} ${digits.slice(8, 11)}`;
}

// ── Name matching ─────────────────────────────────────────────────────────────

function cleanName(name) {
  return (name || "")
    .toLowerCase()
    .replace(
      /\bpty\b|\bltd\b|\blimited\b|\bpty ltd\b|\bproprietary\b|\btrust\b|\btrustee\b/g,
      "",
    )
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchScore(businessName, resultName) {
  const a = cleanName(businessName);
  const b = cleanName(resultName || "");
  if (!a || !b) return 0;
  if (b === a) return 1;
  if (b.includes(a) || a.includes(b)) return 0.9;
  const wordsA = new Set(a.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(b.split(" ").filter((w) => w.length > 2));
  if (wordsA.size === 0) return 0;
  let overlap = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) overlap++;
  }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

// ── ABR API call ──────────────────────────────────────────────────────────────
// Uses ABRSearchByNameAdvancedSimpleProtocol with all required parameters.
// Confirmed working URL format from API testing.

async function fetchEntityDetails(abn, guid) {
  const url = `https://abr.business.gov.au/ABRXMLSearch/AbrXmlSearch.asmx/ABRSearchByABN?searchString=${abn}&includeHistoricalDetails=N&authenticationGuid=${guid}`;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/xml, application/xml' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    let xml = await res.text();

    // Strip default namespace declaration so regex matching works cleanly
    xml = xml.replace(/xmlns[^"]*"[^"]*"/g, '');

    const entityBlock   = extractAllXML(xml, 'entityType')[0] || '';
    const entityCode    = extractXML(entityBlock, 'entityTypeCode')    || '';
    const entityDesc    = extractXML(entityBlock, 'entityDescription') || '';
    const hasGST        = xml.includes('<goodsAndServicesTax>');

    return {
      entity_type:    entityDesc || ENTITY_TYPES[entityCode] || entityCode || '',
      entity_code:    entityCode,
      gst_registered: hasGST,
    };
  } catch (err) {
    console.error('fetchEntityDetails error:', err.message);
    return null;
  }
}

async function searchABR(name, guid) {
  const encodedName = encodeURIComponent(name.replace(/['"]/g, '').slice(0, 80));

  const url = [
    'https://abr.business.gov.au/ABRXMLSearch/AbrXmlSearch.asmx/ABRSearchByNameAdvancedSimpleProtocol',
    `?name=${encodedName}`,
    `&postcode=`,
    `&legalName=Y`,
    `&tradingName=Y`,
    `&NSW=Y&SA=Y&ACT=Y&VIC=Y&WA=Y&QLD=Y&NT=Y&TAS=Y`,
    `&SIC=Y&charity=Y&superan=Y&deceased=N`,
    `&maxResults=10`,
    `&searchWidth=typical`,
    `&minimumScore=0`,
    `&authenticationGuid=${guid}`,
  ].join('');

  const res = await fetch(url, {
    headers: { 'Accept': 'text/xml, application/xml' },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`ABR API returned ${res.status}`);
  const xml = await res.text();
  return xml.replace(/xmlns[^"]*"[^"]*"/g, '');
}

// ── Parse XML response ────────────────────────────────────────────────────────
// Actual XML structure from ABR:
//
// <searchResultsRecord>
//   <ABN>
//     <identifierValue>21140900974</identifierValue>
//     <identifierStatus>Active</identifierStatus>
//   </ABN>
//   <businessName>
//     <organisationName>Cohen Handler</organisationName>
//     <score>100</score>
//     <isCurrentIndicator>Y</isCurrentIndicator>
//   </businessName>
//   <mainBusinessPhysicalAddress>
//     <stateCode>NSW</stateCode>
//     <postcode>2028</postcode>
//     <isCurrentIndicator>Y</isCurrentIndicator>
//   </mainBusinessPhysicalAddress>
// </searchResultsRecord>

function parseABRResponse(xml, businessName) {
  if (!xml) return null;

  if (xml.includes("exceptionDescription")) {
    console.error("ABR exception:", extractXML(xml, "exceptionDescription"));
    return null;
  }

  const records = extractAllXML(xml, "searchResultsRecord");
  if (!records.length) return null;

  let best = null;
  let bestScore = 0;

  for (const record of records) {
    // ABN value and status
    const abnBlock = extractAllXML(record, "ABN")[0] || "";
    const abn = extractXML(abnBlock, "identifierValue");
    const abnStatus = extractXML(abnBlock, "identifierStatus");

    // Skip inactive ABNs
    if (abnStatus && abnStatus !== "Active") continue;

    // Business name is inside <businessName> block
    const nameBlock = extractAllXML(record, "businessName")[0] || "";
    const orgName = extractXML(nameBlock, "organisationName") || "";
    const isCurrent = extractXML(nameBlock, "isCurrentIndicator");
    const apiScore = parseInt(extractXML(nameBlock, "score") || "0");

    // Also check entityType block which appears in some records
    const entityBlock = extractAllXML(record, "entityType")[0] || "";
    const entityCode = extractXML(entityBlock, "entityTypeCode") || "";
    const entityDesc = extractXML(entityBlock, "entityDescription") || "";

    // Address
    const addrBlock =
      extractAllXML(record, "mainBusinessPhysicalAddress")[0] || "";
    const stateCode = extractXML(addrBlock, "stateCode") || "";

    // Score by name match AND API's own score
    const nameMatch = matchScore(businessName, orgName);
    // Weight: our name match (60%) + API score normalised (40%)
    const combined = nameMatch * 0.6 + (apiScore / 100) * 0.4;

    if (combined > bestScore) {
      bestScore = combined;
      best = { abn, orgName, entityCode, entityDesc, stateCode, record };
    }
  }

  // Require at least 30% combined confidence
  if (!best || bestScore < 0.3) return null;

  const entityType =
    best.entityDesc || ENTITY_TYPES[best.entityCode] || best.entityCode || "";

  // Check for GST registration in full record
  const hasGST =
    best.record.includes("<goodsAndServicesTax>") ||
    best.record.includes("<gstStatus>");

  return {
    abn: formatABN(best.abn),
    abn_raw: best.abn,
    entity_type: entityType,
    entity_code: best.entityCode,
    gst_registered: hasGST,
    state_code: best.stateCode,
    matched_name: best.orgName,
    match_score: Math.round(bestScore * 100),
  };
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { businessName } = await request.json();

    if (!businessName?.trim()) {
      return Response.json(
        { error: "No business name provided" },
        { status: 400 },
      );
    }

    const guid = process.env.ABN_GUID;
    if (!guid) {
      return Response.json(
        { error: "ABN_GUID not configured" },
        { status: 500 },
      );
    }

    const xml = await searchABR(businessName.trim(), guid);
    const result = parseABRResponse(xml, businessName.trim());

    if (!result) {
      return Response.json({
        abn: null,
        entity_type: null,
        gst_registered: null,
      });
    }

    // Fetch full entity details using the raw ABN
    if (result?.abn_raw) {
      const details = await fetchEntityDetails(result.abn_raw, guid);
      if (details) {
        result.entity_type = details.entity_type;
        result.entity_code = details.entity_code;
        result.gst_registered = details.gst_registered;
      }
    }

    return Response.json(result);
  } catch (err) {
    console.error("ABN lookup error:", err.message);
    return Response.json({
      abn: null,
      entity_type: null,
      gst_registered: null,
      error: err.message,
    });
  }
}
