// app/api/enrich/route.js
// Takes a website URL, fetches the page, asks GPT to extract
// the founder name, email, and job title.

import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Pages most likely to have founder/contact info
const CONTACT_SLUGS = [
  "/contact",
  "/contact-us",
  "/about",
  "/about-us",
  "/our-team",
  "/team",
  "/meet-the-team",
  "/who-we-are",
  "/our-story",
  "/people",
];

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-AU,en;q=0.9",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function normaliseUrl(url) {
  if (!url) return null;
  url = url.trim();
  if (!url.startsWith("http")) url = "https://" + url;
  return url;
}

function extractText(html) {
  // Strip scripts, styles, and tags — keep readable text only
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000); // GPT context limit — first 6000 chars is plenty
}

async function fetchPage(url, timeout = 8000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    return { html, finalUrl: res.url };
  } catch {
    return null;
  }
}

async function getPageText(baseUrl) {
  // Try homepage first
  const home = await fetchPage(baseUrl);
  if (!home) {
    // Try with www prefix
    const parsed = new URL(baseUrl);
    if (!parsed.hostname.startsWith("www.")) {
      const alt = baseUrl.replace(parsed.hostname, "www." + parsed.hostname);
      const retry = await fetchPage(alt);
      if (!retry) return null;
      return { text: extractText(retry.html), url: retry.finalUrl };
    }
    return null;
  }

  const homeText = extractText(home.html);
  const finalBase = home.finalUrl || baseUrl;

  // Look for a contact/about link in the homepage HTML
  const linkMatches = [...home.html.matchAll(/href=["']([^"']*?)["']/gi)];
  let contactUrl = null;

  for (const [, href] of linkMatches) {
    const lower = href.toLowerCase();
    if (CONTACT_SLUGS.some((slug) => lower.includes(slug))) {
      try {
        contactUrl = new URL(href, finalBase).href;
      } catch {
        contactUrl =
          finalBase.replace(/\/$/, "") +
          (href.startsWith("/") ? href : "/" + href);
      }
      break;
    }
  }

  // If we found a contact/about page, fetch it too
  if (contactUrl && contactUrl !== finalBase) {
    const contact = await fetchPage(contactUrl);
    if (contact) {
      // Combine: contact page text first (more relevant), then homepage
      return {
        text: extractText(contact.html) + " " + homeText,
        url: finalBase,
      };
    }
  }

  return { text: homeText, url: finalBase };
}

// ── GPT extraction ────────────────────────────────────────────────────────────

async function extractWithGPT(pageText, businessName, existingEmail) {
  const prompt = `You are extracting contact information from an Australian buyers agent business website.

Business name: ${businessName}
${existingEmail ? `Known email: ${existingEmail}` : ""}

Page content:
${pageText}

Extract the following and respond ONLY with a valid JSON object, no explanation:
{
  "founder_name": "First Last (the founder, principal, director, or main contact person — must be a real human name, null if not found)",
  "job_title": "Their exact job title e.g. Principal Buyers Agent, Director, Founder (null if not found)",
  "email": "Their direct email or the main business email (null if not found)"
}

Rules:
- founder_name must be a real person's name (2-3 words, capitalised). Never return a heading, page title, menu item, or company name.
- If you cannot find a real person's name with confidence, return null for founder_name.
- For email, prefer a personal email over generic ones like info@ or hello@ if both exist.
- Return null for any field you are not confident about.`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 150,
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content?.trim() || "";

  try {
    // Strip markdown code fences if present
    const clean = raw
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/, "")
      .trim();
    return JSON.parse(clean);
  } catch {
    return { founder_name: null, job_title: null, email: null };
  }
}

// ── Route handler ─────────────────────────────────────────────────────────────

export async function POST(request) {
  try {
    const { website, businessName, existingEmail } = await request.json();

    if (!website) {
      return Response.json({ error: "No website provided" }, { status: 400 });
    }

    const url = normaliseUrl(website);
    if (!url) {
      return Response.json({ error: "Invalid URL" }, { status: 400 });
    }

    // Fetch page content
    const page = await getPageText(url);
    if (!page) {
      return Response.json({
        founder_name: null,
        job_title: null,
        email: existingEmail || null,
        error: "Could not fetch website",
      });
    }

    // Extract with GPT
    const result = await extractWithGPT(page.text, businessName, existingEmail);

    // If GPT didn't find an email but we already had one, keep the existing one
    if (!result.email && existingEmail) {
      result.email = existingEmail;
    }

    return Response.json(result);
  } catch (err) {
    console.error("Enrich error:", err);
    return Response.json({ error: err.message }, { status: 500 });
  }
}
