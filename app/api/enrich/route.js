// app/api/enrich/route.js
// Fetches a website and extracts contact info + social media URLs using GPT.
// Social links are extracted from raw HTML using regex patterns — much more
// reliable than hunting for href attributes, since most sites store social
// URLs in JavaScript, JSON-LD, or data attributes.

import OpenAI from 'openai';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CONTACT_SLUGS = [
  '/contact', '/contact-us', '/about', '/about-us',
  '/our-team', '/team', '/meet-the-team', '/who-we-are',
  '/our-story', '/people',
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-AU,en;q=0.9',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseUrl(url) {
  if (!url) return null;
  url = url.trim();
  if (!url.startsWith('http')) url = 'https://' + url;
  return url;
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}

// ── Social URL extraction ─────────────────────────────────────────────────────
// Searches the raw HTML (before stripping tags) for social media URL patterns.
// This catches URLs in href attributes, JavaScript strings, JSON-LD schema,
// data-* attributes, onclick handlers — anywhere they appear in the HTML.

function extractSocialUrls(html) {
  const found = {
    linkedin_company:  new Set(),
    linkedin_personal: new Set(),
    instagram:         new Set(),
    facebook:          new Set(),
  };

  // LinkedIn company pages: linkedin.com/company/something
  for (const [match] of html.matchAll(/https?:\/\/(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9_%-]+)/gi)) {
    const clean = cleanSocialUrl(match);
    if (clean) found.linkedin_company.add(clean);
  }

  // LinkedIn personal pages: linkedin.com/in/something
  for (const [match] of html.matchAll(/https?:\/\/(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_%-]+)/gi)) {
    const clean = cleanSocialUrl(match);
    if (clean) found.linkedin_personal.add(clean);
  }

  // Instagram: instagram.com/handle (not photo/p/ paths)
  for (const [match] of html.matchAll(/https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9._]+)(?![/?])/gi)) {
    const clean = cleanSocialUrl(match);
    // Skip Instagram's own pages and generic paths
    if (clean && !clean.match(/instagram\.com\/(p\/|explore\/|tv\/|reel\/|stories\/|accounts\/|static\/|developer\/|legal\/|about\/|press\/|blog\/)/)) {
      found.instagram.add(clean);
    }
  }

  // Facebook: facebook.com/something
  for (const [match] of html.matchAll(/https?:\/\/(?:www\.)?facebook\.com\/([a-zA-Z0-9._-]+)(?![/?])/gi)) {
    const clean = cleanSocialUrl(match);
    // Skip Facebook's own pages
    if (clean && !clean.match(/facebook\.com\/(sharer|share|login|dialog|plugins|groups\/|events\/|pages\/create|help\/|policies\/|legal\/)/)) {
      found.facebook.add(clean);
    }
  }

  // Convert sets to arrays, take best candidate
  return {
    linkedin_company:  [...found.linkedin_company][0]  || null,
    linkedin_personal: [...found.linkedin_personal][0] || null,
    instagram:         [...found.instagram][0]         || null,
    facebook:          [...found.facebook][0]          || null,
    // All found, for GPT context
    all: [
      ...[...found.linkedin_company].map(u => `LinkedIn Company: ${u}`),
      ...[...found.linkedin_personal].map(u => `LinkedIn Personal: ${u}`),
      ...[...found.instagram].map(u => `Instagram: ${u}`),
      ...[...found.facebook].map(u => `Facebook: ${u}`),
    ].slice(0, 15).join('\n'),
  };
}

function cleanSocialUrl(url) {
  // Remove trailing punctuation, quotes, backslashes that got captured
  return url
    .replace(/['"\\>)\]\s,;]+$/, '')
    .replace(/\/$/, '')
    .toLowerCase()
    .trim() || null;
}

// ── JSON-LD parser ────────────────────────────────────────────────────────────
// Many business sites include schema.org JSON-LD with sameAs links
// which reliably contain their official social media profiles.

function extractJsonLdSocial(html) {
  const result = { linkedin_company: null, linkedin_personal: null, instagram: null, facebook: null };

  for (const [, jsonStr] of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(jsonStr.trim());
      const items = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const sameAs = item.sameAs || item.url || [];
        const urls = Array.isArray(sameAs) ? sameAs : [sameAs];
        for (const url of urls) {
          if (typeof url !== 'string') continue;
          const u = url.toLowerCase();
          if (u.includes('linkedin.com/company/') && !result.linkedin_company) {
            result.linkedin_company = cleanSocialUrl(url);
          } else if (u.includes('linkedin.com/in/') && !result.linkedin_personal) {
            result.linkedin_personal = cleanSocialUrl(url);
          } else if (u.includes('instagram.com/') && !result.instagram) {
            result.instagram = cleanSocialUrl(url);
          } else if (u.includes('facebook.com/') && !result.facebook) {
            result.facebook = cleanSocialUrl(url);
          }
        }
      }
    } catch {}
  }
  return result;
}

// ── Page fetcher ──────────────────────────────────────────────────────────────

async function fetchPage(url, timeout = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    return { html, finalUrl: res.url };
  } catch { return null; }
}

async function getPageData(baseUrl) {
  let home = await fetchPage(baseUrl);

  // Try www prefix if failed
  if (!home) {
    try {
      const parsed = new URL(baseUrl);
      if (!parsed.hostname.startsWith('www.')) {
        const alt = baseUrl.replace(parsed.hostname, 'www.' + parsed.hostname);
        home = await fetchPage(alt);
      }
    } catch {}
    if (!home) return null;
  }

  const finalBase = home.finalUrl || baseUrl;
  let allHtml = home.html;

  // Try to also fetch a contact/about page for extra data
  for (const [, href] of home.html.matchAll(/href=["']([^"']*?)["']/gi)) {
    const lower = href.toLowerCase();
    if (CONTACT_SLUGS.some(slug => lower.includes(slug))) {
      try {
        const contactUrl = new URL(href, finalBase).href;
        if (contactUrl !== finalBase) {
          const contact = await fetchPage(contactUrl);
          if (contact) allHtml += ' ' + contact.html;
        }
      } catch {}
      break;
    }
  }

  return {
    text:     extractText(allHtml),
    rawHtml:  allHtml,
    url:      finalBase,
  };
}

// ── GPT extraction ────────────────────────────────────────────────────────────

async function extractWithGPT(pageText, socialContext, businessName, existingEmail) {
  const prompt = `You are extracting contact information from an Australian buyers agent business website.

Business name: ${businessName}
${existingEmail ? `Known email: ${existingEmail}` : ''}

Social media URLs already found on the page (use these directly if present):
${socialContext || '(none detected automatically — check page text below)'}

Page text:
${pageText}

Respond ONLY with a valid JSON object — no explanation, no markdown fences:
{
  "founder_name": "Real person's first and last name (2-3 words, title-cased). Must be a human being, never a company name or page heading. Null if not found with confidence.",
  "job_title": "Their exact job title e.g. Principal Buyers Agent, Director, Founder. Null if not found.",
  "email": "Contact email address. Prefer personal email over generic info@ or hello@. Null if not found.",
  "linkedin_company": "LinkedIn company page URL. If provided in social context above, use that exactly. Otherwise look in page text. Must start with https://www.linkedin.com/company/. Null if not found.",
  "linkedin_personal": "Founder's LinkedIn personal URL. Must start with https://www.linkedin.com/in/. Null if not found.",
  "instagram": "Instagram profile URL. Must start with https://www.instagram.com/. Null if not found.",
  "facebook": "Facebook page URL. Must start with https://www.facebook.com/. Null if not found."
}

Important: for founder_name, never return a page heading, service name, menu item, or company name. Only return an actual person's name.`;

  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 300,
    temperature: 0,
  });

  const raw = (response.choices[0]?.message?.content || '').trim();
  try {
    const clean = raw.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim();
    return JSON.parse(clean);
  } catch {
    return { founder_name: null, job_title: null, email: null, linkedin_company: null, linkedin_personal: null, instagram: null, facebook: null };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { website, businessName, existingEmail } = await request.json();

    if (!website) return Response.json({ error: 'No website provided' }, { status: 400 });

    const url = normaliseUrl(website);
    if (!url) return Response.json({ error: 'Invalid URL' }, { status: 400 });

    const page = await getPageData(url);
    if (!page) {
      return Response.json({
        founder_name: null, job_title: null,
        email: existingEmail || null,
        linkedin_company: null, linkedin_personal: null,
        instagram: null, facebook: null,
        error: 'Could not fetch website',
      });
    }

    // Extract social URLs two ways and merge:
    // 1. Regex scan of raw HTML (catches href, data-*, JS strings, etc.)
    // 2. JSON-LD schema parsing (most reliable when present)
    const regexSocial  = extractSocialUrls(page.rawHtml);
    const jsonLdSocial = extractJsonLdSocial(page.rawHtml);

    // JSON-LD takes priority over regex (more authoritative)
    const mergedSocial = {
      linkedin_company:  jsonLdSocial.linkedin_company  || regexSocial.linkedin_company,
      linkedin_personal: jsonLdSocial.linkedin_personal || regexSocial.linkedin_personal,
      instagram:         jsonLdSocial.instagram          || regexSocial.instagram,
      facebook:          jsonLdSocial.facebook           || regexSocial.facebook,
    };

    // Build social context string for GPT
    const socialContext = Object.entries(mergedSocial)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    // GPT fills in contact info + confirms/supplements social URLs
    const result = await extractWithGPT(page.text, socialContext || regexSocial.all, businessName, existingEmail);

    // Merge: regex/JSON-LD social takes priority over GPT guesses for URLs
    // (GPT is better at names/emails, regex is better at URLs)
    const final = {
      founder_name:      result.founder_name      || null,
      job_title:         result.job_title          || null,
      email:             result.email              || existingEmail || null,
      linkedin_company:  mergedSocial.linkedin_company  || result.linkedin_company  || null,
      linkedin_personal: mergedSocial.linkedin_personal || result.linkedin_personal || null,
      instagram:         mergedSocial.instagram          || result.instagram         || null,
      facebook:          mergedSocial.facebook           || result.facebook          || null,
    };

    // Normalise URLs to canonical form
    for (const key of ['linkedin_company', 'linkedin_personal', 'instagram', 'facebook']) {
      if (final[key]) {
        try {
          const u = new URL(final[key].startsWith('http') ? final[key] : 'https://' + final[key]);
          final[key] = (u.origin + u.pathname).replace(/\/$/, '');
        } catch { final[key] = null; }
      }
    }

    return Response.json(final);

  } catch (err) {
    console.error('Enrich error:', err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}