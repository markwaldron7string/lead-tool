// app/api/abn/route.js
// Looks up Australian Business Number (ABN) and entity details
// using the free Australian Business Register (ABR) API.
//
// Requires: ABN_GUID in .env.local
// Get your free GUID at: https://abr.business.gov.au/Tools/WebServices

// ABR entity type codes → human readable
const ENTITY_TYPES = {
  'IND':  'Individual/Sole Trader',
  'PRV':  'Australian Private Company',
  'PUB':  'Australian Public Company',
  'PTR':  'Partnership',
  'TRT':  'Trust',
  'SUP':  'Super Fund',
  'NRP':  'Non-Registered Body',
  'FXT':  'Fixed Trust',
  'OTH':  'Other',
  'STSP': 'State Superannuation',
  'COP':  'Co-operative',
  'FPE':  'Foreign Partnership Entity',
  'FUT':  'Fixed Unit Trust',
  'HYT':  'Hybrid Trust',
  'LIT':  'Listed Investment Trust',
  'PPT':  'Pooled Superannuation Trust',
  'PST':  'Public Trading Trust',
  'SAF':  'Small APRA Fund',
  'UTR':  'Unit Trust',
  'DFT':  'Discretionary Trust',
  'DIT':  'Discretionary Investment Trust',
  'DTT':  'Discretionary Trading Trust',
};

// Simple XML value extractor — avoids needing xml2js dependency
function extractXML(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)<\/${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

function extractAllXML(xml, tag) {
  const results = [];
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

// Format ABN with standard Australian spacing: XX XXX XXX XXX
function formatABN(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length !== 11) return digits;
  return `${digits.slice(0,2)} ${digits.slice(2,5)} ${digits.slice(5,8)} ${digits.slice(8,11)}`;
}

// Strip legal suffixes to get a cleaner match name
function cleanName(name) {
  return name
    .toLowerCase()
    .replace(/\bpty\b|\bltd\b|\blimited\b|\bpty ltd\b|\bproprietary\b|\btrust\b|\btrustee\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Score how well an ABR result matches our business name (0–1)
function matchScore(businessName, resultName) {
  const a = cleanName(businessName);
  const b = cleanName(resultName || '');
  if (!a || !b) return 0;
  if (b.includes(a) || a.includes(b)) return 1;

  // Word overlap
  const wordsA = new Set(a.split(' '));
  const wordsB = new Set(b.split(' '));
  let overlap = 0;
  for (const w of wordsA) { if (wordsB.has(w)) overlap++; }
  return overlap / Math.max(wordsA.size, wordsB.size);
}

export async function POST(request) {
  try {
    const { businessName } = await request.json();

    if (!businessName) {
      return Response.json({ error: 'No business name provided' }, { status: 400 });
    }

    const guid = process.env.ABN_GUID;
    if (!guid) {
      return Response.json({ error: 'ABN_GUID not configured' }, { status: 500 });
    }

    // Call ABR name search API
    const searchName = encodeURIComponent(businessName.replace(/['"]/g, '').slice(0, 80));
    const apiUrl = `https://abr.business.gov.au/ABRXMLSearch/AbrXmlSearch.asmx/ABRSearchByNameSimpleProtocol?name=${searchName}&maxResults=5&guid=${guid}`;

    const res = await fetch(apiUrl, {
      headers: { 'Accept': 'text/xml, application/xml' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return Response.json({ abn: null, entity_type: null, gst_registered: null, error: 'ABR API error' });
    }

    const xml = await res.text();

    // Check for exception/error in response
    if (xml.includes('AbnException') || xml.includes('<exception>')) {
      const exceptionMsg = extractXML(xml, 'exceptionDescription');
      console.error('ABR exception:', exceptionMsg);
      return Response.json({ abn: null, entity_type: null, gst_registered: null, error: exceptionMsg });
    }

    // Parse all result records
    const records = extractAllXML(xml, 'searchResultsRecord');
    if (!records.length) {
      return Response.json({ abn: null, entity_type: null, gst_registered: null });
    }

    // Find the best matching record
    let best = null;
    let bestScore = 0;

    for (const record of records) {
      // Only consider active ABNs
      const isCurrent = extractXML(record, 'isCurrentIndicator');
      if (isCurrent !== 'Y') continue;

      const abnValue    = extractXML(record, 'identifierValue');
      const orgName     = extractXML(record, 'organisationName') || extractXML(record, 'fullName');
      const score       = matchScore(businessName, orgName);

      if (score > bestScore) {
        bestScore = score;
        best = { record, abn: abnValue, name: orgName };
      }
    }

    // Require at least 30% word overlap to avoid false positives
    if (!best || bestScore < 0.3) {
      return Response.json({ abn: null, entity_type: null, gst_registered: null });
    }

    const { record, abn } = best;
    const entityCode = extractXML(record, 'entityTypeCode');
    const entityDesc = extractXML(record, 'entityDescription') || ENTITY_TYPES[entityCode] || entityCode;
    const gstTag     = record.includes('<goodsAndServicesTax>');
    const stateCode  = extractXML(record, 'stateCode');

    return Response.json({
      abn:            formatABN(abn),
      abn_raw:        abn,
      entity_type:    entityDesc,
      entity_code:    entityCode,
      gst_registered: gstTag,
      state_code:     stateCode,
      match_score:    Math.round(bestScore * 100),
    });

  } catch (err) {
    console.error('ABN lookup error:', err);
    return Response.json({ abn: null, entity_type: null, gst_registered: null, error: err.message });
  }
}