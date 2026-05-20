// app/api/scrape/route.js
// Searches Google Places API for buyers agent businesses.
// Uses the official Places API (New) Text Search endpoint.
//
// Requires: GOOGLE_PLACES_KEY in .env.local
// Get your key at: console.cloud.google.com → Enable "Places API (New)"
// Cost: $17/1000 requests — covered by Google's $200/month free credit.

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.nationalPhoneNumber',
  'places.internationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.primaryType',
  'places.types',
  'places.businessStatus',
  'places.location',
  'places.googleMapsUri',
].join(',');

const AU_CITIES = {
  'Sydney':     { lat: -33.8688, lng: 151.2093 },
  'Melbourne':  { lat: -37.8136, lng: 144.9631 },
  'Brisbane':   { lat: -27.4698, lng: 153.0251 },
  'Perth':      { lat: -31.9505, lng: 115.8605 },
  'Adelaide':   { lat: -34.9285, lng: 138.6007 },
  'Canberra':   { lat: -35.2809, lng: 149.1300 },
  'Darwin':     { lat: -12.4634, lng: 130.8456 },
  'Hobart':     { lat: -42.8821, lng: 147.3272 },
  'Gold Coast': { lat: -28.0167, lng: 153.4000 },
  'Newcastle':  { lat: -32.9283, lng: 151.7817 },
  'Wollongong': { lat: -34.4278, lng: 150.8931 },
  'Geelong':    { lat: -38.1499, lng: 144.3617 },
};

const NZ_CITIES = {
  'Auckland':        { lat: -36.8485, lng: 174.7633 },
  'Wellington':      { lat: -41.2865, lng: 174.7762 },
  'Christchurch':    { lat: -43.5321, lng: 172.6362 },
  'Hamilton':        { lat: -37.7870, lng: 175.2793 },
  'Tauranga':        { lat: -37.6878, lng: 176.1651 },
  'Dunedin':         { lat: -45.8788, lng: 170.5028 },
  'Palmerston North':{ lat: -40.3523, lng: 175.6082 },
  'Nelson':          { lat: -41.2706, lng: 173.2840 },
  'Rotorua':         { lat: -38.1368, lng: 176.2497 },
  'New Plymouth':    { lat: -39.0556, lng: 174.0752 },
};

const AU_STATE_BY_CITY = {
  'Sydney': 'New South Wales', 'Newcastle': 'New South Wales', 'Wollongong': 'New South Wales',
  'Melbourne': 'Victoria', 'Geelong': 'Victoria',
  'Brisbane': 'Queensland', 'Gold Coast': 'Queensland',
  'Perth': 'Western Australia',
  'Adelaide': 'South Australia',
  'Canberra': 'Australian Capital Territory',
  'Darwin': 'Northern Territory',
  'Hobart': 'Tasmania',
};

const NZ_REGION_BY_CITY = {
  'Auckland':         'Auckland',
  'Wellington':       'Wellington',
  'Christchurch':     'Canterbury',
  'Hamilton':         'Waikato',
  'Tauranga':         'Bay of Plenty',
  'Dunedin':          'Otago',
  'Palmerston North': 'Manawatu-Whanganui',
  'Nelson':           'Nelson',
  'Rotorua':          'Bay of Plenty',
  'New Plymouth':     'Taranaki',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function parsePlaceToLead(place, searchTerm, city, regionByCity) {
  const name     = place.displayName?.text || '';
  const address  = place.formattedAddress  || '';
  const phone    = place.internationalPhoneNumber || place.nationalPhoneNumber || '';
  const website  = place.websiteUri        || '';
  const rating   = place.rating            ? String(place.rating)           : '';
  const reviews  = place.userRatingCount   ? String(place.userRatingCount)  : '';
  const mapsUrl  = place.googleMapsUri     || '';
  const status   = place.businessStatus    || '';

  if (status === 'CLOSED_PERMANENTLY') return null;

  let parsedCity  = city;
  let parsedState = regionByCity[city] || '';
  let street      = '';

  if (place.addressComponents) {
    for (const comp of place.addressComponents) {
      const types = comp.types || [];
      if (types.includes('street_number') || types.includes('route')) {
        street = street ? `${street} ${comp.longText}` : comp.longText;
      }
      if (types.includes('locality')) parsedCity  = comp.longText;
      if (types.includes('administrative_area_level_1')) parsedState = comp.longText;
    }
  }

  return {
    title:        name,
    phone,
    website,
    street,
    city:         parsedCity,
    state:        parsedState,
    totalScore:   rating,
    reviewsCount: reviews,
    url:          mapsUrl,
    emails:       '',
    founder_name: '',
    linkedin_company:  '',
    linkedin_personal: '',
    instagram:    '',
    facebook:     '',
    abn:          '',
    entity_type:  '',
    _source:      `${searchTerm} ${city}`,
    _category:    'Uncategorised',
    _score:       0,
    _scraped_now: true,
  };
}

async function fetchPlaces(query, city, citiesMap, regionCode, pageToken = null) {
  const apiKey  = process.env.GOOGLE_PLACES_KEY;
  const coords  = citiesMap[city];

  const body = {
    textQuery:      query,
    maxResultCount: 20,
    languageCode:   'en',
    regionCode,
    locationBias: {
      circle: {
        center: { latitude: coords.lat, longitude: coords.lng },
        radius: 50000,
      },
    },
  };

  if (pageToken) body.pageToken = pageToken;

  const res = await fetch(PLACES_URL, {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'X-Goog-Api-Key':  apiKey,
      'X-Goog-FieldMask': FIELD_MASK,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Places API error ${res.status}: ${err}`);
  }

  const data = await res.json();
  return {
    places:    data.places    || [],
    nextToken: data.nextPageToken || null,
  };
}

export async function POST(request) {
  try {
    const { searchTerm, city, maxResults = 60, country = 'AU' } = await request.json();

    if (!searchTerm?.trim()) {
      return Response.json({ error: 'searchTerm is required' }, { status: 400 });
    }
    if (!city?.trim()) {
      return Response.json({ error: 'city is required' }, { status: 400 });
    }

    const apiKey = process.env.GOOGLE_PLACES_KEY;
    if (!apiKey) {
      return Response.json({
        error: 'GOOGLE_PLACES_KEY not configured. Add it to .env.local and Vercel environment variables.',
      }, { status: 500 });
    }

    const isNZ       = country === 'NZ';
    const citiesMap  = isNZ ? NZ_CITIES : AU_CITIES;
    const regionByCity = isNZ ? NZ_REGION_BY_CITY : AU_STATE_BY_CITY;
    const regionCode = isNZ ? 'NZ' : 'AU';
    const countryName = isNZ ? 'New Zealand' : 'Australia';

    if (!citiesMap[city]) {
      return Response.json({
        error: `Unknown city "${city}". Valid options: ${Object.keys(citiesMap).join(', ')}`,
      }, { status: 400 });
    }

    const query    = `${searchTerm.trim()} ${city} ${countryName}`;
    const allLeads = [];
    const seen     = new Set();
    let   pageToken = null;
    let   pages     = 0;
    const maxPages  = Math.ceil(maxResults / 20);

    while (pages < maxPages && allLeads.length < maxResults) {
      if (pages > 0) await sleep(2500);

      try {
        const { places, nextToken } = await fetchPlaces(query, city, citiesMap, regionCode, pageToken);

        for (const place of places) {
          const name = place.displayName?.text || '';
          const key  = name.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!key || seen.has(key)) continue;
          seen.add(key);

          const lead = parsePlaceToLead(place, searchTerm, city, regionByCity);
          if (lead) allLeads.push(lead);
        }

        pageToken = nextToken;
        pages++;

        if (!nextToken) break;
      } catch (err) {
        console.error(`Places API fetch error on page ${pages}:`, err.message);
        break;
      }
    }

    return Response.json({
      leads:      allLeads,
      count:      allLeads.length,
      city,
      searchTerm,
      pages,
    });

  } catch (err) {
    console.error('Scrape route error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
