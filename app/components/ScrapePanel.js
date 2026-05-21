"use client";

import { useState, useRef } from "react";
import { classify } from "@/lib/processor";

// ── Template data ─────────────────────────────────────────────────────────────

export const TEMPLATES = {
  AU: {
    label: "🇦🇺 Buyers Agents — Australia",
    terms: [
      "buyers agent",
      "buyers advocate",
      "property buyers agency",
      "investment buyers agent",
      "SMSF buyers agent",
      "property advisor",
      "property acquisition",
      "property strategist",
      "off the plan buyers agent",
      "buyers agent first home",
    ],
    cities: [
      "Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide",
      "Canberra", "Darwin", "Hobart", "Gold Coast", "Newcastle",
      "Wollongong", "Geelong",
    ],
  },
  NZ: {
    label: "🇳🇿 Buyers Agents — New Zealand",
    terms: [
      "buyers agent",
      "buyers advocate",
      "property buyers agency",
      "investment buyers agent",
      "property advisor",
      "property acquisition",
      "property strategist",
      "buyers agent first home",
      "property consultant",
      "buyers agent residential",
    ],
    cities: [
      "Auckland", "Wellington", "Christchurch", "Hamilton",
      "Tauranga", "Dunedin", "Palmerston North", "Nelson",
      "Rotorua", "New Plymouth",
    ],
  },
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── ScrapePanel ───────────────────────────────────────────────────────────────

export default function ScrapePanel({
  onLeadsFound,
  cities,          // city list used in custom mode
  country,         // "AU" | "NZ" — sets default template
  countryName,
  defaultOpen = false,
}) {
  const initTemplate = TEMPLATES[country] ? country : "AU";

  const [templateKey, setTemplateKey] = useState(initTemplate);
  const isCustom = templateKey === "CUSTOM";
  const template = TEMPLATES[templateKey];

  // Term state
  const [templateTerm, setTemplateTerm] = useState(
    () => TEMPLATES[initTemplate].terms[0]
  );
  const [customTerm, setCustomTerm] = useState("buyers agent");
  const [useCustomInput, setUseCustomInput] = useState(false);

  // City state
  const [templateCity, setTemplateCity] = useState(
    () => TEMPLATES[initTemplate].cities[0]
  );
  const [customCity, setCustomCity] = useState(
    () => (cities && cities[0]) || ""
  );

  const [maxResults, setMaxResults] = useState(60);
  const [allCities, setAllCities] = useState(false);
  const [open, setOpen] = useState(defaultOpen);

  // Progress / result state
  const [scraping, setScraping] = useState(false);
  const [allTermsRunning, setAllTermsRunning] = useState(false);
  const [termProgress, setTermProgress] = useState(null);  // { current, total, term }
  const [cityProgress, setCityProgress] = useState(null);  // { current, total, city }
  const [runTotals, setRunTotals] = useState(null);        // { added, dupes, found }
  const [result, setResult] = useState(null);
  const [runSummary, setRunSummary] = useState(null);
  const [error, setError] = useState("");
  const cancelRef = useRef(false);

  // Derived
  const activeTerm = isCustom ? customTerm : templateTerm;
  const activeCities = isCustom ? (cities || []) : (template?.cities || []);
  const activeCity = isCustom ? customCity : templateCity;
  const isRunning = scraping || allTermsRunning;

  function handleTemplateChange(key) {
    setTemplateKey(key);
    if (TEMPLATES[key]) {
      setTemplateTerm(TEMPLATES[key].terms[0]);
      setTemplateCity(TEMPLATES[key].cities[0]);
    }
    setResult(null);
    setError("");
    setRunSummary(null);
    setRunTotals(null);
    setAllCities(false);
    setUseCustomInput(false);
  }

  async function runCity(term, targetCity) {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchTerm: term, city: targetCity, maxResults, country }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Scrape failed");
    const classified = (data.leads || []).map((lead) => ({
      ...lead,
      _category: classify(lead, lead._source || ""),
    }));
    return onLeadsFound(classified); // returns { added, duplicates }
  }

  async function handleScrape() {
    const term = activeTerm?.trim();
    if (!term) return;
    setScraping(true);
    setResult(null);
    setError("");
    setRunSummary(null);
    cancelRef.current = false;

    const citiesForRun = allCities ? activeCities : [activeCity];
    let totalAdded = 0, totalDupes = 0, totalFound = 0;

    for (let i = 0; i < citiesForRun.length; i++) {
      if (cancelRef.current) break;
      const city = citiesForRun[i];
      if (allCities) setCityProgress({ current: i + 1, total: citiesForRun.length, city });

      try {
        const { added, duplicates } = await runCity(term, city);
        totalAdded += added;
        totalDupes += duplicates;
        totalFound += added + duplicates;
      } catch (err) {
        if (!allCities) {
          setError(
            err.message.includes("GOOGLE_PLACES_KEY")
              ? "⚠ Google Places API key not configured. Add GOOGLE_PLACES_KEY to .env.local."
              : `Error: ${err.message}`
          );
          setScraping(false);
          setCityProgress(null);
          return;
        }
        console.warn(`Scrape skipped for ${city}:`, err.message);
      }

      if (i < citiesForRun.length - 1 && !cancelRef.current) await sleep(2000);
    }

    setCityProgress(null);
    setResult({ found: totalFound, added: totalAdded, duplicates: totalDupes });
    setScraping(false);
  }

  async function handleRunAllTerms() {
    if (!template) return;
    const { terms, cities: termCities } = template;

    setAllTermsRunning(true);
    setScraping(false);
    setResult(null);
    setRunSummary(null);
    setError("");
    setRunTotals({ added: 0, dupes: 0, found: 0 });
    cancelRef.current = false;

    let totalAdded = 0, totalDupes = 0, totalFound = 0;

    for (let ti = 0; ti < terms.length; ti++) {
      if (cancelRef.current) break;
      const term = terms[ti];
      setTermProgress({ current: ti + 1, total: terms.length, term });

      for (let ci = 0; ci < termCities.length; ci++) {
        if (cancelRef.current) break;
        const city = termCities[ci];
        setCityProgress({ current: ci + 1, total: termCities.length, city });

        try {
          const { added, duplicates } = await runCity(term, city);
          totalAdded += added;
          totalDupes += duplicates;
          totalFound += added + duplicates;
          setRunTotals({ added: totalAdded, dupes: totalDupes, found: totalFound });
        } catch (err) {
          console.warn(`Failed: "${term}" / ${city}:`, err.message);
        }

        if (ci < termCities.length - 1 && !cancelRef.current) await sleep(2000);
      }

      if (ti < terms.length - 1 && !cancelRef.current) await sleep(3000);
    }

    setTermProgress(null);
    setCityProgress(null);
    setAllTermsRunning(false);

    if (!cancelRef.current) {
      setRunSummary({ added: totalAdded, dupes: totalDupes, found: totalFound });
    }
    cancelRef.current = false;
  }

  function handleCancel() {
    cancelRef.current = true;
    setScraping(false);
    setAllTermsRunning(false);
    setTermProgress(null);
    setCityProgress(null);
  }

  const canScrape = !!activeTerm?.trim() && !isRunning;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        marginBottom: 16,
        overflow: "hidden",
      }}
    >
      {/* ── Header / toggle ── */}
      <div
        onClick={() => !isRunning && setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "13px 18px",
          cursor: isRunning ? "default" : "pointer",
          borderBottom: open ? "1px solid var(--border)" : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: isRunning ? "var(--amber)" : "var(--green)",
              boxShadow: isRunning ? "0 0 6px var(--amber)" : "0 0 6px var(--green)",
              flexShrink: 0,
            }}
          />
          <div>
            <span style={{ fontSize: 13, fontWeight: 500 }}>Scrape new leads</span>
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                color: "var(--muted)",
                marginLeft: 10,
              }}
            >
              Google Places API
            </span>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {result && !allTermsRunning && (
            <span style={{ fontSize: 12, color: "var(--green)", fontFamily: "var(--font-mono)" }}>
              +{result.added} leads added
            </span>
          )}
          {runTotals && allTermsRunning && (
            <span style={{ fontSize: 12, color: "var(--green)", fontFamily: "var(--font-mono)" }}>
              +{runTotals.added} so far
            </span>
          )}
          {!isRunning && (
            <span style={{ color: "var(--muted)", fontSize: 16 }}>{open ? "−" : "+"}</span>
          )}
        </div>
      </div>

      {open && (
        <div style={{ padding: "16px 18px" }}>

          {/* ── Template selector ── */}
          <div style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 11,
                color: "var(--muted)",
                marginBottom: 5,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Template
            </div>
            <select
              value={templateKey}
              onChange={(e) => handleTemplateChange(e.target.value)}
              disabled={isRunning}
              style={{ width: "100%", maxWidth: 340 }}
            >
              {Object.entries(TEMPLATES).map(([key, t]) => (
                <option key={key} value={key}>{t.label}</option>
              ))}
              <option value="CUSTOM">⚙ Custom</option>
            </select>
          </div>

          {/* ── Controls row ── */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>

            {/* Term selector */}
            {isCustom ? (
              <div style={{ flex: "1 1 200px" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Search term
                </div>
                <input
                  type="text"
                  value={customTerm}
                  onChange={(e) => setCustomTerm(e.target.value)}
                  placeholder="e.g. buyers agent"
                  disabled={isRunning}
                  style={{ width: "100%" }}
                />
              </div>
            ) : (
              <div style={{ flex: "1 1 200px" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Search term
                </div>
                <select
                  value={templateTerm}
                  onChange={(e) => setTemplateTerm(e.target.value)}
                  disabled={isRunning}
                  style={{ width: "100%" }}
                >
                  {template.terms.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            )}

            {/* City selector — hidden when all cities toggled */}
            {!allCities && (
              <div style={{ flex: "0 1 160px" }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  City
                </div>
                {isCustom ? (
                  <select
                    value={customCity}
                    onChange={(e) => setCustomCity(e.target.value)}
                    disabled={isRunning}
                    style={{ width: "100%" }}
                  >
                    {(cities || []).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={templateCity}
                    onChange={(e) => setTemplateCity(e.target.value)}
                    disabled={isRunning}
                    style={{ width: "100%" }}
                  >
                    {template.cities.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Max results */}
            <div style={{ flex: "0 1 120px" }}>
              <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 5, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                Max / city
              </div>
              <select
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                disabled={isRunning}
                style={{ width: "100%" }}
              >
                <option value={20}>20</option>
                <option value={40}>40</option>
                <option value={60}>60</option>
                <option value={100}>100</option>
              </select>
            </div>

            {/* Action buttons */}
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "flex-end", gap: 8, flexWrap: "wrap" }}>
              {/* All cities toggle */}
              <button
                onClick={() => setAllCities((a) => !a)}
                disabled={isRunning}
                style={{
                  background: allCities ? "rgba(62,207,142,0.15)" : "transparent",
                  border: `1px solid ${allCities ? "var(--green)" : "var(--border)"}`,
                  color: allCities ? "var(--green)" : "var(--muted)",
                  borderRadius: 7,
                  padding: "9px 14px",
                  fontSize: 12,
                  cursor: isRunning ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                }}
              >
                {allCities ? "✓ All cities" : "All cities"}
              </button>

              {/* Scrape / Cancel button */}
              <button
                onClick={isRunning ? handleCancel : handleScrape}
                disabled={!isRunning && !canScrape}
                style={{
                  background: isRunning ? "var(--surface2)" : "var(--green)",
                  color: isRunning ? "var(--red)" : "#0a0a0b",
                  fontWeight: 600,
                  fontSize: 13,
                  padding: "9px 20px",
                  borderRadius: 7,
                  cursor: (isRunning || canScrape) ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  border: isRunning ? "1px solid var(--border)" : "none",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                }}
              >
                {isRunning && !allTermsRunning ? (
                  <>
                    <svg width="12" height="12" viewBox="0 0 12 12" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
                      <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" />
                    </svg>
                    Cancel
                  </>
                ) : allCities
                  ? `⬇ Scrape all ${activeCities.length} cities`
                  : "⬇ Scrape leads"}
              </button>

              {/* Run all terms (template mode only) */}
              {!isCustom && (
                <button
                  onClick={allTermsRunning ? handleCancel : handleRunAllTerms}
                  disabled={!allTermsRunning && scraping}
                  style={{
                    background: allTermsRunning ? "var(--surface2)" : "rgba(167,139,250,0.15)",
                    color: allTermsRunning ? "var(--red)" : "#a78bfa",
                    fontWeight: 600,
                    fontSize: 13,
                    padding: "9px 16px",
                    borderRadius: 7,
                    cursor: (!allTermsRunning && scraping) ? "not-allowed" : "pointer",
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    border: `1px solid ${allTermsRunning ? "var(--border)" : "rgba(167,139,250,0.3)"}`,
                    whiteSpace: "nowrap",
                    transition: "all 0.15s",
                    opacity: !allTermsRunning && scraping ? 0.4 : 1,
                  }}
                >
                  {allTermsRunning ? (
                    <>
                      <svg width="12" height="12" viewBox="0 0 12 12" style={{ animation: "spin 0.8s linear infinite", flexShrink: 0 }}>
                        <circle cx="6" cy="6" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="14 8" />
                      </svg>
                      Cancel
                    </>
                  ) : (
                    `⚡ Run all ${template.terms.length} terms`
                  )}
                </button>
              )}
            </div>
          </div>

          {/* ── "Run all terms" progress ── */}
          {allTermsRunning && (termProgress || cityProgress) && (
            <div style={{ marginBottom: 12 }}>
              {/* Term progress label */}
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                <span>
                  {termProgress && (
                    <>
                      Term <strong style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>{termProgress.current}</strong> of{" "}
                      <strong style={{ color: "var(--text)", fontFamily: "var(--font-mono)" }}>{termProgress.total}</strong>
                      {" "}—{" "}
                      <em style={{ color: "var(--text)", fontStyle: "normal" }}>{termProgress.term}</em>
                    </>
                  )}
                  {cityProgress && (
                    <>
                      {" "}— Scraping{" "}
                      <strong style={{ color: "var(--text)" }}>{cityProgress.city}</strong>…
                      {" "}City{" "}
                      <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{cityProgress.current}</strong> of{" "}
                      <strong style={{ fontFamily: "var(--font-mono)", color: "var(--text)" }}>{cityProgress.total}</strong>
                    </>
                  )}
                </span>
              </div>
              {/* Term progress bar */}
              {termProgress && (
                <div style={{ height: 3, background: "var(--surface2)", borderRadius: 99, overflow: "hidden", marginBottom: 4 }}>
                  <div
                    style={{
                      height: "100%",
                      background: "#a78bfa",
                      borderRadius: 99,
                      width: `${(termProgress.current / termProgress.total) * 100}%`,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              )}
              {/* City progress bar */}
              {cityProgress && (
                <div style={{ height: 3, background: "var(--surface2)", borderRadius: 99, overflow: "hidden" }}>
                  <div
                    style={{
                      height: "100%",
                      background: "var(--green)",
                      borderRadius: 99,
                      width: `${(cityProgress.current / cityProgress.total) * 100}%`,
                      transition: "width 0.4s ease",
                    }}
                  />
                </div>
              )}
              {/* Running totals */}
              {runTotals && (
                <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: "var(--green)", fontFamily: "var(--font-mono)" }}>
                    +{runTotals.added} new leads
                  </span>
                  <span style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>
                    {runTotals.dupes} dupes skipped
                  </span>
                </div>
              )}
            </div>
          )}

          {/* ── Single-term city progress bar ── */}
          {scraping && !allTermsRunning && cityProgress && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 5 }}>
                <span>
                  Scraping <strong style={{ color: "var(--text)" }}>{cityProgress.city}</strong>…
                </span>
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {cityProgress.current} / {cityProgress.total}
                </span>
              </div>
              <div style={{ height: 3, background: "var(--surface2)", borderRadius: 99, overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    background: "var(--green)",
                    borderRadius: 99,
                    width: `${(cityProgress.current / cityProgress.total) * 100}%`,
                    transition: "width 0.4s ease",
                  }}
                />
              </div>
            </div>
          )}

          {/* ── Help text ── */}
          {!isRunning && !runSummary && (
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
              {isCustom
                ? "Run the same search term across multiple cities for full national coverage."
                : allCities
                ? `Will scrape "${activeTerm}" across all ${activeCities.length} ${countryName} cities. Duplicates removed automatically.`
                : `Select a term and city, or use All cities / Run all terms for full coverage.`}
            </div>
          )}

          {/* ── Error ── */}
          {error && (
            <div
              style={{
                background: "rgba(224,82,82,0.1)",
                border: "1px solid rgba(224,82,82,0.3)",
                borderRadius: 7,
                padding: "10px 14px",
                fontSize: 13,
                color: "var(--red)",
                marginTop: 8,
              }}
            >
              {error}
            </div>
          )}

          {/* ── Single scrape result ── */}
          {result && !runSummary && (
            <div
              style={{
                background: "rgba(62,207,142,0.08)",
                border: "1px solid rgba(62,207,142,0.2)",
                borderRadius: 7,
                padding: "10px 14px",
                fontSize: 13,
                marginTop: 8,
                display: "flex",
                gap: 20,
                flexWrap: "wrap",
              }}
            >
              <span style={{ color: "var(--green)" }}>
                <strong style={{ fontFamily: "var(--font-mono)" }}>+{result.added}</strong> new leads added
              </span>
              <span style={{ color: "var(--muted)" }}>
                <strong style={{ fontFamily: "var(--font-mono)" }}>{result.duplicates}</strong> duplicates skipped
              </span>
              <span style={{ color: "var(--muted)" }}>
                <strong style={{ fontFamily: "var(--font-mono)" }}>{result.found}</strong> total found
              </span>
            </div>
          )}

          {/* ── Run all terms summary ── */}
          {runSummary && (
            <div
              style={{
                background: "rgba(167,139,250,0.08)",
                border: "1px solid rgba(167,139,250,0.25)",
                borderRadius: 7,
                padding: "14px 16px",
                marginTop: 8,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 500, color: "#a78bfa", marginBottom: 8 }}>
                ⚡ Full run complete
              </div>
              <div style={{ display: "flex", gap: 20, flexWrap: "wrap", marginBottom: 10 }}>
                <span style={{ color: "var(--green)", fontSize: 13 }}>
                  <strong style={{ fontFamily: "var(--font-mono)" }}>+{runSummary.added}</strong> new leads
                </span>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  <strong style={{ fontFamily: "var(--font-mono)" }}>{runSummary.dupes}</strong> duplicates skipped
                </span>
                <span style={{ color: "var(--muted)", fontSize: 13 }}>
                  <strong style={{ fontFamily: "var(--font-mono)" }}>{runSummary.found}</strong> total found
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                💡 Tip: Export your CSV now before running enrichment — enrichment can take a while and you won&apos;t lose your data.
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
}
