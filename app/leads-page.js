"use client";

import Link from "next/link";
import { useState, useCallback, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import Papa from "papaparse";
import { processFiles, leadsToCSV, scoreLead } from "@/lib/processor";

const PAGE_SIZE = 30;
const BATCH_SIZE = 5;
const BATCH_DELAY = 1200;

const CAT_BADGE = {
  "Investment BA": "badge-investment",
  SMSF: "badge-smsf",
  "Owner-occupier": "badge-owner",
  "Off-the-plan": "badge-offplan",
  "Project sales": "badge-project",
  "Property advisor": "badge-advisor",
  Uncategorised: "badge-unknown",
  EXCLUDED: "badge-excluded",
};

const ALL_CATEGORIES = [
  "Investment BA",
  "SMSF",
  "Owner-occupier",
  "Off-the-plan",
  "Project sales",
  "Property advisor",
  "Uncategorised",
  "EXCLUDED",
];

function getDefaultCols(regionLabel, businessIdLabel) {
  return [
    { key: "_score", label: "Score", width: 90, visible: true },
    { key: "title", label: "Business", width: 210, visible: true },
    { key: "phone", label: "Phone", width: 145, visible: true },
    { key: "city", label: "City", width: 110, visible: true },
    { key: "state", label: regionLabel, width: 80, visible: true },
    { key: "totalScore", label: "Rating", width: 72, visible: true },
    { key: "reviewsCount", label: "Reviews", width: 80, visible: false },
    { key: "_category", label: "Category", width: 145, visible: true },
    { key: "website", label: "Website", width: 170, visible: true },
    { key: "emails", label: "Email", width: 210, visible: true },
    { key: "founder_name", label: "Founder", width: 150, visible: true },
    { key: "linkedin_company", label: "LinkedIn Co.", width: 160, visible: false },
    { key: "linkedin_personal", label: "LinkedIn Person", width: 160, visible: false },
    { key: "instagram", label: "Instagram", width: 160, visible: false },
    { key: "abn", label: businessIdLabel, width: 130, visible: false },
    { key: "entity_type", label: "Entity Type", width: 180, visible: false },
  ];
}

const SCORE_TIERS = [
  { label: "All leads", value: 0 },
  { label: "Good", value: 40 },
  { label: "Great", value: 60 },
  { label: "Best", value: 75 },
];

const PRESET_TERMS = [
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
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function useIsMobile() {
  const [v, setV] = useState(false);
  useEffect(() => {
    const fn = () => setV(window.innerWidth < 768);
    fn();
    window.addEventListener("resize", fn);
    return () => window.removeEventListener("resize", fn);
  }, []);
  return v;
}

function classifyClient(lead) {
  const text = `${lead.title} ${lead._source || ""}`.toLowerCase();
  if (text.includes("smsf") || text.includes("super fund")) return "SMSF";
  if (text.includes("off the plan") || text.includes("off-the-plan"))
    return "Off-the-plan";
  if (text.includes("project sales") || text.includes("project marketing"))
    return "Project sales";
  if (text.includes("investment") || text.includes("investor"))
    return "Investment BA";
  if (text.includes("first home") || text.includes("owner occupier"))
    return "Owner-occupier";
  if (text.includes("advisor") || text.includes("strategist"))
    return "Property advisor";
  return "Uncategorised";
}

// ── Score info tooltip ────────────────────────────────────────────────────────

function ScoreInfoTooltip({ onFilter }) {
  const [visible, setVisible] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const tooltipRef = useRef(null);

  useEffect(() => {
    function onDown(e) {
      const inBtn = btnRef.current?.contains(e.target);
      const inTooltip = tooltipRef.current?.contains(e.target);
      if (!inBtn && !inTooltip) {
        setPinned(false);
        setVisible(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function calcPos() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({
      top: r.bottom + window.scrollY + 8,
      left: r.left + window.scrollX,
    });
  }
  function onEnter() {
    calcPos();
    setVisible(true);
  }
  function onLeave() {
    if (!pinned) setVisible(false);
  }
  function onClick(e) {
    e.stopPropagation();
    const next = !pinned;
    setPinned(next);
    if (next) {
      calcPos();
      setVisible(true);
    } else setVisible(false);
  }
  function onClose(e) {
    e.stopPropagation();
    setPinned(false);
    setVisible(false);
  }
  function handleTierClick(e, score) {
    e.stopPropagation();
    onFilter(score);
    setPinned(false);
    setVisible(false);
  }

  const rows = [
    { label: "Email address", pts: "30 pts", color: "#3ecf8e", sub: null },
    { label: "Founder name", pts: "20 pts", color: "#3ecf8e", sub: null },
    { label: "Website", pts: "10 pts", color: "#4c9cf1", sub: null },
    { label: "Phone number", pts: "10 pts", color: "#4c9cf1", sub: null },
    {
      label: "Google rating",
      pts: "up to 15",
      color: "#e8a045",
      sub: [
        ["4.8+", "15 pts"],
        ["4.5–4.7", "12 pts"],
        ["4.0–4.4", "8 pts"],
        ["3.5–3.9", "4 pts"],
      ],
    },
    {
      label: "Review count",
      pts: "up to 10",
      color: "#e8a045",
      sub: [
        ["50+ reviews", "10 pts"],
        ["20–49", "7 pts"],
        ["10–19", "4 pts"],
        ["1–9", "2 pts"],
      ],
    },
    { label: "Categorised", pts: "5 pts", color: "#666670", sub: null },
    { label: "LinkedIn / Socials", pts: "bonus", color: "#a78bfa", sub: null },
  ];
  const tiers = [
    { value: 40, label: "Good", color: "#999" },
    { value: 60, label: "Great", color: "#e8a045" },
    { value: 75, label: "Best", color: "#3ecf8e" },
  ];

  const tooltip =
    visible && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={tooltipRef}
            style={{
              position: "absolute",
              top: pos.top,
              left: pos.left,
              zIndex: 99999,
              background: "#111113",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: 12,
              padding: 16,
              width: 284,
              boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
              fontFamily: "'DM Sans', system-ui, sans-serif",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: pinned ? 12 : 4,
              }}
            >
              <div>
                <div
                  style={{ fontSize: 13, fontWeight: 500, color: "#efefef" }}
                >
                  How scores are calculated
                </div>
                <div style={{ fontSize: 11, color: "#666670", marginTop: 3 }}>
                  Each lead scored 0–100 on data quality
                </div>
              </div>
              <button
                onClick={onClose}
                style={{
                  background: "none",
                  border: "none",
                  color: "#666670",
                  cursor: "pointer",
                  fontSize: 14,
                  lineHeight: 1,
                  padding: "2px 4px",
                }}
                onMouseOver={(e) => (e.currentTarget.style.color = "#efefef")}
                onMouseOut={(e) => (e.currentTarget.style.color = "#666670")}
              >
                ✕
              </button>
            </div>
            {!pinned && (
              <div
                style={{
                  fontSize: 10,
                  color: "#3ecf8e",
                  marginBottom: 10,
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  opacity: 0.8,
                }}
              >
                <span style={{ fontSize: 9 }}>●</span> Click ⓘ to keep this open
              </div>
            )}
            {rows.map(({ label, pts, color, sub }) => (
              <div key={label}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "5px 0",
                    borderBottom: "0.5px solid rgba(255,255,255,0.07)",
                    fontSize: 12,
                  }}
                >
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 7,
                      color: "#efefef",
                    }}
                  >
                    <span
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: color,
                        flexShrink: 0,
                      }}
                    />
                    {label}
                  </span>
                  <span
                    style={{
                      fontFamily: "monospace",
                      fontSize: 11,
                      fontWeight: 600,
                      color,
                      background: "rgba(255,255,255,0.06)",
                      borderRadius: 4,
                      padding: "2px 7px",
                    }}
                  >
                    {pts}
                  </span>
                </div>
                {sub?.map(([desc, val]) => (
                  <div
                    key={desc}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      padding: "2px 0 2px 22px",
                      fontSize: 11,
                      color: "#666670",
                    }}
                  >
                    <span>{desc}</span>
                    <span>{val}</span>
                  </div>
                ))}
              </div>
            ))}
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "0.5px solid rgba(255,255,255,0.07)",
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  color: "#666670",
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                }}
              >
                Filter by tier
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {tiers.map(({ value, label, color }) => (
                  <button
                    key={value}
                    onClick={(e) => handleTierClick(e, value)}
                    style={{
                      flex: 1,
                      textAlign: "center",
                      padding: "8px 4px",
                      border: "0.5px solid rgba(255,255,255,0.12)",
                      borderRadius: 6,
                      background: "transparent",
                      cursor: "pointer",
                      transition: "all 0.15s",
                    }}
                    onMouseOver={(e) => {
                      e.currentTarget.style.background =
                        "rgba(255,255,255,0.06)";
                      e.currentTarget.style.borderColor = color;
                    }}
                    onMouseOut={(e) => {
                      e.currentTarget.style.background = "transparent";
                      e.currentTarget.style.borderColor =
                        "rgba(255,255,255,0.12)";
                    }}
                  >
                    <div
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 600,
                        fontSize: 15,
                        color,
                        marginBottom: 2,
                      }}
                    >
                      {value}+
                    </div>
                    <div style={{ fontSize: 10, color: "#666670" }}>
                      {label}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        onClick={onClick}
        aria-label="How scores are calculated"
        title="Hover to preview · Click to pin open"
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: `1.5px solid ${pinned ? "#3ecf8e" : visible ? "#3ecf8e" : "rgba(255,255,255,0.25)"}`,
          background: pinned ? "rgba(62,207,142,0.15)" : "none",
          color: visible ? "#3ecf8e" : "rgba(255,255,255,0.4)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          transition: "all 0.15s",
          flexShrink: 0,
          padding: 0,
          fontFamily: "var(--font-sans)",
        }}
      >
        i
      </button>
      {tooltip}
    </>
  );
}

// ── Scrape panel ──────────────────────────────────────────────────────────────

function ScrapePanel({ onLeadsFound, cities, country, countryName }) {
  const [searchTerm, setSearchTerm] = useState("buyers agent");
  const [city, setCity] = useState(cities[0]);
  const [maxResults, setMaxResults] = useState(60);
  const [scraping, setScraping] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [allCities, setAllCities] = useState(false);
  const [cityProgress, setCityProgress] = useState(null);
  const cancelScrapeRef = useRef(false);

  async function runSingleCity(term, targetCity) {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ searchTerm: term, city: targetCity, maxResults, country }),
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error || "Scrape failed");
    const classified = (data.leads || []).map((lead) => ({
      ...lead,
      _category: classifyClient(lead),
    }));
    return onLeadsFound(classified);
  }

  async function handleScrape() {
    setScraping(true);
    setResult(null);
    setError("");
    cancelScrapeRef.current = false;

    if (allCities) {
      let totalAdded = 0;
      let totalDupes = 0;
      let totalFound = 0;

      for (let i = 0; i < cities.length; i++) {
        if (cancelScrapeRef.current) break;
        const targetCity = cities[i];
        setCityProgress({
          current: i + 1,
          total: cities.length,
          city: targetCity,
        });

        try {
          const { added, duplicates } = await runSingleCity(
            searchTerm,
            targetCity,
          );
          totalAdded += added;
          totalDupes += duplicates;
          totalFound += added + duplicates;
        } catch (err) {
          console.warn(`Failed for ${targetCity}:`, err.message);
        }

        if (i < cities.length - 1 && !cancelScrapeRef.current) {
          await sleep(2000);
        }
      }

      setResult({
        found: totalFound,
        added: totalAdded,
        duplicates: totalDupes,
      });
      setCityProgress(null);
    } else {
      try {
        const res = await fetch("/api/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchTerm, city, maxResults, country }),
        });
        const data = await res.json();
        if (!res.ok || data.error) {
          setError(data.error || "Scrape failed");
          setScraping(false);
          return;
        }
        const classified = (data.leads || []).map((lead) => ({
          ...lead,
          _category: classifyClient(lead),
        }));
        const { added, duplicates } = onLeadsFound(classified);
        setResult({ found: data.count, added, duplicates });
      } catch (err) {
        setError(err.message);
      }
    }

    setScraping(false);
  }

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
      <div
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "13px 18px",
          cursor: "pointer",
          borderBottom: open ? "1px solid var(--border)" : "none",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: scraping ? "var(--amber)" : "var(--green)",
              boxShadow: scraping
                ? "0 0 6px var(--amber)"
                : "0 0 6px var(--green)",
            }}
          />
          <div>
            <span style={{ fontSize: 13, fontWeight: 500 }}>
              Scrape new leads
            </span>
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
          {result && (
            <span
              style={{
                fontSize: 12,
                color: "var(--green)",
                fontFamily: "var(--font-mono)",
              }}
            >
              +{result.added} leads added
            </span>
          )}
          <span style={{ color: "var(--muted)", fontSize: 16 }}>
            {open ? "−" : "+"}
          </span>
        </div>
      </div>

      {open && (
        <div style={{ padding: "16px 18px" }}>
          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            {/* Search term */}
            <div style={{ flex: "1 1 200px" }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  marginBottom: 5,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Search term
              </div>
              <select
                value={
                  PRESET_TERMS.includes(searchTerm) ? searchTerm : "__custom__"
                }
                onChange={(e) => {
                  if (e.target.value === "__custom__") setSearchTerm("");
                  else setSearchTerm(e.target.value);
                }}
                style={{
                  width: "100%",
                  marginBottom: PRESET_TERMS.includes(searchTerm) ? 0 : 6,
                }}
              >
                {PRESET_TERMS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
                <option value="__custom__">Custom…</option>
              </select>
              {!PRESET_TERMS.includes(searchTerm) && (
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Enter custom search term…"
                  style={{ width: "100%" }}
                  autoFocus
                />
              )}
            </div>

            {/* City — hidden when running all cities */}
            {!allCities && (
              <div style={{ flex: "0 1 160px" }}>
                <div
                  style={{
                    fontSize: 11,
                    color: "var(--muted)",
                    marginBottom: 5,
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  City
                </div>
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  style={{ width: "100%" }}
                >
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Max results */}
            <div style={{ flex: "0 1 120px" }}>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted)",
                  marginBottom: 5,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Max / city
              </div>
              <select
                value={maxResults}
                onChange={(e) => setMaxResults(Number(e.target.value))}
                style={{ width: "100%" }}
              >
                <option value={20}>20</option>
                <option value={40}>40</option>
                <option value={60}>60</option>
                <option value={100}>100</option>
              </select>
            </div>

            {/* Buttons */}
            <div
              style={{
                flex: "0 0 auto",
                display: "flex",
                alignItems: "flex-end",
                gap: 8,
              }}
            >
              <button
                onClick={() => setAllCities((a) => !a)}
                disabled={scraping}
                style={{
                  background: allCities
                    ? "rgba(62,207,142,0.15)"
                    : "transparent",
                  border: `1px solid ${allCities ? "var(--green)" : "var(--border)"}`,
                  color: allCities ? "var(--green)" : "var(--muted)",
                  borderRadius: 7,
                  padding: "9px 14px",
                  fontSize: 12,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                }}
              >
                {allCities ? "✓ All cities" : "All cities"}
              </button>

              <button
                onClick={
                  scraping
                    ? () => {
                        cancelScrapeRef.current = true;
                      }
                    : handleScrape
                }
                disabled={!searchTerm.trim()}
                style={{
                  background: scraping ? "var(--surface2)" : "var(--green)",
                  color: scraping ? "var(--red)" : "#0a0a0b",
                  fontWeight: 600,
                  fontSize: 13,
                  padding: "9px 20px",
                  borderRadius: 7,
                  cursor: searchTerm.trim() ? "pointer" : "not-allowed",
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  border: scraping ? "1px solid var(--border)" : "none",
                  whiteSpace: "nowrap",
                  transition: "all 0.15s",
                }}
              >
                {scraping ? (
                  <>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 12 12"
                      style={{
                        animation: "spin 0.8s linear infinite",
                        flexShrink: 0,
                      }}
                    >
                      <circle
                        cx="6"
                        cy="6"
                        r="4.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeDasharray="14 8"
                      />
                    </svg>
                    Cancel
                  </>
                ) : allCities ? (
                  `⬇ Scrape all ${cities.length} cities`
                ) : (
                  "⬇ Scrape leads"
                )}
              </button>
            </div>
          </div>

          {/* City progress bar */}
          {cityProgress && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 5,
                }}
              >
                <span>
                  Scraping{" "}
                  <strong style={{ color: "var(--text)" }}>
                    {cityProgress.city}
                  </strong>
                  …
                </span>
                <span style={{ fontFamily: "var(--font-mono)" }}>
                  {cityProgress.current} / {cityProgress.total}
                </span>
              </div>
              <div
                style={{
                  height: 3,
                  background: "var(--surface2)",
                  borderRadius: 99,
                  overflow: "hidden",
                }}
              >
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

          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {allCities
              ? `Will scrape "${searchTerm}" across all ${cities.length} ${countryName} cities. Duplicates removed automatically.`
              : "Run the same search term across multiple cities for full national coverage."}
          </div>

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
              {error.includes("GOOGLE_PLACES_KEY")
                ? "⚠ Google Places API key not configured. Add GOOGLE_PLACES_KEY to .env.local and Vercel."
                : `Error: ${error}`}
            </div>
          )}

          {result && (
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
                <strong style={{ fontFamily: "var(--font-mono)" }}>
                  +{result.added}
                </strong>{" "}
                new leads added
              </span>
              <span style={{ color: "var(--muted)" }}>
                <strong style={{ fontFamily: "var(--font-mono)" }}>
                  {result.duplicates}
                </strong>{" "}
                duplicates skipped
              </span>
              <span style={{ color: "var(--muted)" }}>
                <strong style={{ fontFamily: "var(--font-mono)" }}>
                  {result.found}
                </strong>{" "}
                total found
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Small components ──────────────────────────────────────────────────────────

function StatCard({ label, value, color }) {
  const c = {
    green: "var(--green)",
    amber: "var(--amber)",
    red: "var(--red)",
    blue: "var(--blue)",
    purple: "#a78bfa",
  };
  return (
    <div className="stat-card fade-up">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: c[color] || "var(--text)" }}>
        {value?.toLocaleString() ?? "—"}
      </div>
    </div>
  );
}

function Badge({ category }) {
  return (
    <span className={`badge ${CAT_BADGE[category] || "badge-unknown"}`}>
      {category}
    </span>
  );
}

function ScorePill({ score }) {
  const n = Number(score) || 0;
  const color =
    n >= 75 ? "var(--green)" : n >= 40 ? "var(--amber)" : "var(--muted)";
  return (
    <span
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 13,
        fontWeight: 600,
        color,
      }}
    >
      {n}
    </span>
  );
}

function Spinner() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      style={{ animation: "spin 0.8s linear infinite", display: "block" }}
    >
      <circle
        cx="6"
        cy="6"
        r="4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeDasharray="14 8"
      />
    </svg>
  );
}

function SocialLink({ url, type }) {
  if (!url) return <span style={{ color: "var(--muted)" }}>—</span>;
  let label = url;
  try {
    const u = new URL(url);
    const p = u.pathname.split("/").filter(Boolean);
    label = p[p.length - 1] || u.hostname;
  } catch {}
  const colors = {
    linkedin: "#0a66c2",
    instagram: "#e1306c",
    facebook: "#1877f2",
  };
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        color: colors[type] || "var(--blue)",
        textDecoration: "none",
        fontSize: 12,
      }}
      title={url}
    >
      {label.slice(0, 22)}
      {label.length > 22 ? "…" : ""}
    </a>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function LeadsPage({
  title,
  csvFile,
  cities,
  regionLabel,
  businessIdLabel,
  country,
  countryName,
}) {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loadedFiles, setLoadedFiles] = useState([]);
  const [isAutoLoading, setIsAutoLoading] = useState(true);
  const [csvMissing, setCsvMissing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterScore, setFilterScore] = useState(0);
  const [filterSource, setFilterSource] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [hideExcluded, setHideExcluded] = useState(true);

  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState("_score");
  const [sortDir, setSortDir] = useState(-1);

  const [cols, setCols] = useState(() => getDefaultCols(regionLabel, businessIdLabel));
  const [showColPanel, setShowColPanel] = useState(false);
  const colPanelRef = useRef(null);
  const dragRef = useRef({
    active: false,
    key: null,
    startX: 0,
    startWidth: 0,
  });

  const [enriching, setEnriching] = useState({});
  const [enrichProgress, setEnrichProgress] = useState(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const cancelRef = useRef(false);
  const fileInputRef = useRef(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    function h(e) {
      if (colPanelRef.current && !colPanelRef.current.contains(e.target))
        setShowColPanel(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── Column resize ─────────────────────────────────────────────────────────

  const startResize = useCallback((e, key, currentWidth) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      active: true,
      key,
      startX: e.clientX,
      startWidth: currentWidth,
    };
    function onMove(ev) {
      if (!dragRef.current.active) return;
      const w = Math.max(
        60,
        dragRef.current.startWidth + ev.clientX - dragRef.current.startX,
      );
      setCols((prev) =>
        prev.map((c) =>
          c.key === dragRef.current.key ? { ...c, width: w } : c,
        ),
      );
    }
    function onUp() {
      dragRef.current.active = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }, []);

  const toggleCol = (key) =>
    setCols((prev) =>
      prev.map((c) => (c.key === key ? { ...c, visible: !c.visible } : c)),
    );
  const resetCols = () => setCols(getDefaultCols(regionLabel, businessIdLabel));

  // ── Auto-load CSV ─────────────────────────────────────────────────────────

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(csvFile);
        if (!res.ok) {
          if (res.status === 404) setCsvMissing(true);
          setIsAutoLoading(false);
          return;
        }
        const text = await res.text();
        // Treat empty or header-only CSV as missing
        const lines = text.trim().split("\n").filter(Boolean);
        if (lines.length <= 1) {
          setCsvMissing(true);
          setIsAutoLoading(false);
          return;
        }
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: ({ data }) => {
            const file = { name: csvFile.replace(/^\//, ""), rows: data };
            const { leads: l, stats: s } = processFiles([file]);
            setLeads(l);
            setStats(s);
            setLoadedFiles([file]);
            setIsAutoLoading(false);
          },
          error: () => setIsAutoLoading(false),
        });
      } catch {
        setIsAutoLoading(false);
      }
    }
    load();
  }, [csvFile]);

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFiles = useCallback((newFiles) => {
    const csvFiles = [...newFiles].filter((f) =>
      f.name.toLowerCase().endsWith(".csv"),
    );
    if (!csvFiles.length) return;
    setIsProcessing(true);
    const parsed = [];
    let rem = csvFiles.length;
    csvFiles.forEach((file) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: ({ data }) => {
          parsed.push({ name: file.name, rows: data });
          if (--rem === 0) {
            setLoadedFiles((prev) => {
              const combined = [...prev];
              parsed.forEach((p) => {
                const idx = combined.findIndex((f) => f.name === p.name);
                if (idx >= 0) combined[idx] = p;
                else combined.push(p);
              });
              const { leads: l, stats: s } = processFiles(combined);
              setLeads(l);
              setStats(s);
              setPage(1);
              setIsProcessing(false);
              return combined;
            });
          }
        },
        error: () => {
          if (--rem === 0) setIsProcessing(false);
        },
      });
    });
  }, []);

  const onDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragging(false);
      handleFiles(e.dataTransfer.files);
    },
    [handleFiles],
  );

  const clearAll = useCallback(() => {
    setLoadedFiles([]);
    setLeads([]);
    setStats(null);
    setSearch("");
    setFilterState("");
    setFilterCategory("");
    setFilterScore(0);
    setFilterSource("");
    setPage(1);
    setEnriching({});
    setEnrichProgress(null);
    setBulkRunning(false);
  }, []);

  // ── Handle new leads from scraper ─────────────────────────────────────────

  const handleNewLeads = useCallback((newLeads) => {
    let added = 0,
      duplicates = 0;
    setLeads((prev) => {
      const seen = new Set(
        prev.map((l) => l.title.toLowerCase().replace(/[^a-z0-9]/g, "")),
      );
      const toAdd = [];
      for (const lead of newLeads) {
        const key = lead.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (seen.has(key)) {
          duplicates++;
        } else {
          seen.add(key);
          lead._score = scoreLead(lead);
          toAdd.push(lead);
          added++;
        }
      }
      return [...prev, ...toAdd];
    });
    setCsvMissing(false);
    setPage(1);
    return { added, duplicates };
  }, []);

  // ── Enrichment ────────────────────────────────────────────────────────────

  async function enrichLead(lead) {
    const [aiData, abnData] = await Promise.all([
      lead.website
        ? fetch("/api/enrich", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              website: lead.website,
              businessName: lead.title,
              existingEmail: lead.emails || "",
            }),
          })
            .then((r) => (r.ok ? r.json() : {}))
            .catch(() => ({}))
        : Promise.resolve({}),
      fetch("/api/abn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessName: lead.title }),
      })
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    ]);
    return {
      founder_name: aiData.founder_name || lead.founder_name || "",
      job_title: aiData.job_title || lead.job_title || "",
      emails: aiData.email || lead.emails || "",
      linkedin_company: aiData.linkedin_company || lead.linkedin_company || "",
      linkedin_personal:
        aiData.linkedin_personal || lead.linkedin_personal || "",
      instagram: aiData.instagram || lead.instagram || "",
      facebook: aiData.facebook || lead.facebook || "",
      abn: abnData.abn || lead.abn || "",
      entity_type: abnData.entity_type || lead.entity_type || "",
      _enriched: true,
    };
  }

  const enrichOne = useCallback(async (lead) => {
    const key = lead.title;
    setEnriching((prev) => ({ ...prev, [key]: true }));
    try {
      const result = await enrichLead(lead);
      setLeads((prev) =>
        prev.map((l) => {
          if (l.title !== key) return l;
          const u = { ...l, ...result };
          u._score = scoreLead(u);
          return u;
        }),
      );
    } catch {}
    setEnriching((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
  }, []);

  const enrichAll = useCallback(async () => {
    const toEnrich = leads.filter((l) => l._category !== "EXCLUDED");
    if (!toEnrich.length) return;
    cancelRef.current = false;
    setBulkRunning(true);
    setEnrichProgress({ done: 0, total: toEnrich.length });
    let done = 0;
    for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
      if (cancelRef.current) break;
      await Promise.all(
        toEnrich.slice(i, i + BATCH_SIZE).map(async (lead) => {
          if (cancelRef.current) return;
          const key = lead.title;
          setEnriching((prev) => ({ ...prev, [key]: true }));
          try {
            const result = await enrichLead(lead);
            setLeads((prev) =>
              prev.map((l) => {
                if (l.title !== key) return l;
                const u = { ...l, ...result };
                u._score = scoreLead(u);
                return u;
              }),
            );
          } catch {}
          setEnriching((prev) => {
            const n = { ...prev };
            delete n[key];
            return n;
          });
          done++;
          setEnrichProgress({ done, total: toEnrich.length });
        }),
      );
      if (i + BATCH_SIZE < toEnrich.length) await sleep(BATCH_DELAY);
    }
    setBulkRunning(false);
    setEnrichProgress(null);
    cancelRef.current = false;
  }, [leads]);

  const cancelEnrich = () => {
    cancelRef.current = true;
    setBulkRunning(false);
    setEnrichProgress(null);
    setEnriching({});
  };

  // ── Computed stats ────────────────────────────────────────────────────────

  const activeLeads = leads.filter(
    (l) => !hideExcluded || l._category !== "EXCLUDED",
  );
  const hasEmailCount = leads.filter((l) => l.emails).length;
  const hasNameCount = leads.filter((l) => l.founder_name).length;
  const hasLinkedIn = leads.filter(
    (l) => l.linkedin_company || l.linkedin_personal,
  ).length;
  const hasABN = leads.filter((l) => l.abn).length;
  const enrichedCount = leads.filter((l) => l._enriched).length;
  const scoreDist = {
    40: activeLeads.filter((l) => (Number(l._score) || 0) >= 40).length,
    60: activeLeads.filter((l) => (Number(l._score) || 0) >= 60).length,
    75: activeLeads.filter((l) => (Number(l._score) || 0) >= 75).length,
  };

  // ── Filter & sort ─────────────────────────────────────────────────────────

  let filtered = leads.filter((lead) => {
    if (hideExcluded && lead._category === "EXCLUDED" && filterCategory !== "EXCLUDED") return false;
    if (filterState && lead.state !== filterState) return false;
    if (filterCategory && lead._category !== filterCategory) return false;
    if (filterScore > 0 && (Number(lead._score) || 0) < filterScore)
      return false;
    if (filterSource && lead._source !== filterSource) return false;
    if (search) {
      const q = search.toLowerCase();
      if (
        !`${lead.title} ${lead.city} ${lead.phone} ${lead.website} ${lead.emails} ${lead.founder_name} ${lead.abn}`
          .toLowerCase()
          .includes(q)
      )
        return false;
    }
    return true;
  });

  if (sortCol) {
    filtered = [...filtered].sort((a, b) => {
      const av = a[sortCol] ?? "",
        bv = b[sortCol] ?? "";
      if (!isNaN(Number(av)) && !isNaN(Number(bv)) && av !== "" && bv !== "")
        return (Number(av) - Number(bv)) * sortDir;
      return String(av).localeCompare(String(bv)) * sortDir;
    });
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const paginated = filtered.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );
  const handleSort = (key) => {
    if (sortCol === key) setSortDir((d) => d * -1);
    else {
      setSortCol(key);
      setSortDir(key === "_score" ? -1 : 1);
    }
    setPage(1);
  };
  const hasActiveFilters =
    search || filterState || filterCategory || filterScore > 0 || filterSource;

  const handleExport = () => {
    const csv = leadsToCSV(leads);
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })),
      download: `buyers_agents_${country.toLowerCase()}_${new Date().toISOString().slice(0, 10)}.csv`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const visibleCols = isMobile
    ? [
        { key: "title", label: "Business", width: 160 },
        { key: "state", label: regionLabel, width: 80 },
        { key: "_category", label: "Category", width: 130 },
        { key: "emails", label: "Email", width: 180 },
      ]
    : cols.filter((c) => c.visible);

  // ── Loading ───────────────────────────────────────────────────────────────

  if (isAutoLoading)
    return (
      <div
        style={{
          height: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          color: "var(--muted)",
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          style={{
            color: "var(--green)",
            animation: "spin 1s linear infinite",
          }}
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="28 16"
          />
        </svg>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>
          Loading leads…
        </div>
      </div>
    );

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .resize-handle { position:absolute;right:0;top:0;bottom:0;width:6px;cursor:col-resize;user-select:none;z-index:2; }
        .resize-handle:hover,.resize-handle:active { background:var(--green);opacity:0.5; }
        .col-panel { position:absolute;top:calc(100% + 6px);right:0;z-index:50;background:var(--surface);border:1px solid var(--border2);border-radius:10px;padding:12px;min-width:210px;box-shadow:0 8px 32px rgba(0,0,0,0.4);max-height:420px;overflow-y:auto; }
        .col-row { display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;cursor:pointer;color:var(--text); }
        .col-row:hover { color:var(--green); }
        .col-check { width:14px;height:14px;border:1px solid var(--border2);border-radius:3px;display:flex;align-items:center;justify-content:center;font-size:10px;flex-shrink:0; }
        .col-check.on { background:var(--green);border-color:var(--green);color:#000; }
      `}</style>

      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: isMobile ? "0 16px 60px" : "0 24px 80px",
        }}
      >
        {/* ── Header ── */}
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: isMobile ? "20px 0 16px" : "28px 0 24px",
            borderBottom: "1px solid var(--border)",
            marginBottom: isMobile ? 16 : 28,
            gap: 12,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Link
              href="/"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 28,
                height: 28,
                borderRadius: 7,
                border: "1px solid var(--border)",
                color: "var(--muted)",
                textDecoration: "none",
                fontSize: 14,
                flexShrink: 0,
                transition: "border-color 0.15s, color 0.15s",
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "var(--border2)";
                e.currentTarget.style.color = "var(--text)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--muted)";
              }}
              title="Back to country selector"
            >
              ←
            </Link>
            <div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 10,
                  color: "var(--green)",
                  letterSpacing: "0.06em",
                  marginBottom: 2,
                  cursor: "default",
                }}
              >
                LEAD SCRAPER
              </div>
              <h1
                style={{
                  fontSize: isMobile ? 16 : 20,
                  fontWeight: 600,
                  letterSpacing: "-0.02em",
                  lineHeight: 1,
                  cursor: "default",
                }}
              >
                {title}
              </h1>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            {!isMobile && leads.length > 0 && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                {filtered.length.toLocaleString()} of{" "}
                {activeLeads.length.toLocaleString()} leads
              </span>
            )}
            <button
              onClick={handleExport}
              disabled={!filtered.length}
              style={{
                background: filtered.length
                  ? "var(--green)"
                  : "var(--surface2)",
                color: filtered.length ? "#0a0a0b" : "var(--muted)",
                fontWeight: 600,
                fontSize: isMobile ? 12 : 13,
                padding: isMobile ? "7px 12px" : "8px 18px",
                borderRadius: 8,
                opacity: filtered.length ? 1 : 0.4,
                cursor: filtered.length ? "pointer" : "not-allowed",
              }}
            >
              {isMobile ? "Export" : "Export CSV"}
            </button>
          </div>
        </header>

        {/* ── Stats ── */}
        {stats && (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(4,1fr)",
              gap: 10,
              marginBottom: 24,
            }}
          >
            <StatCard label="Unique leads" value={stats.unique} color="green" />
            <StatCard label="With email" value={hasEmailCount} color="green" />
            <StatCard label="With name" value={hasNameCount} color="blue" />
            <StatCard label="With LinkedIn" value={hasLinkedIn} color="blue" />
            <StatCard label={`With ${businessIdLabel}`} value={hasABN} color="purple" />
            <StatCard
              label="Categorised"
              value={stats?.categorised}
              color="blue"
            />
            <StatCard
              label="Dupes removed"
              value={stats?.dupes}
              color="amber"
            />
            <StatCard label="Imported" value={stats?.totalRows} />
          </div>
        )}

        {/* ── Scrape panel ── */}
        <ScrapePanel
          onLeadsFound={handleNewLeads}
          cities={cities}
          country={country}
          countryName={countryName}
        />

        {/* ── Enrichment bar ── */}
        {leads.length > 0 && (
          <div className="enrich-bar">
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
                AI Enrichment + {businessIdLabel} Lookup
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--muted)",
                    marginLeft: 10,
                  }}
                >
                  gpt-4o-mini + ABR
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {enrichedCount > 0
                  ? `${enrichedCount.toLocaleString()} leads enriched — contact, LinkedIn, Instagram, ${businessIdLabel}`
                  : `Extracts contact info, LinkedIn, Instagram, and ${businessIdLabel} for each lead`}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              {enrichProgress && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div
                    style={{
                      width: 120,
                      height: 4,
                      background: "var(--surface2)",
                      borderRadius: 99,
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        background: "var(--green)",
                        borderRadius: 99,
                        width: `${(enrichProgress.done / enrichProgress.total) * 100}%`,
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 12,
                      color: "var(--muted)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {enrichProgress.done} / {enrichProgress.total}
                  </span>
                </div>
              )}
              {bulkRunning ? (
                <button
                  onClick={cancelEnrich}
                  style={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    color: "var(--red)",
                    borderRadius: 7,
                    padding: "7px 14px",
                    fontSize: 13,
                  }}
                >
                  Cancel
                </button>
              ) : (
                <button
                  onClick={enrichAll}
                  disabled={!leads.length}
                  style={{
                    background: "var(--green)",
                    color: "#0a0a0b",
                    fontWeight: 600,
                    fontSize: 13,
                    padding: "8px 16px",
                    borderRadius: 7,
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                  }}
                >
                  ✦ Enrich all leads
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── Toolbar ── */}
        <div className="toolbar">
          <input
            type="text"
            placeholder={
              leads.length
                ? `Search ${leads.length.toLocaleString()} leads…`
                : "Search leads…"
            }
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            style={{
              flex: "1 1 200px",
              width: "auto",
              fontSize: 14,
              padding: "9px 14px",
            }}
          />
          <select
            value={filterScore}
            onChange={(e) => {
              setFilterScore(Number(e.target.value));
              setPage(1);
            }}
            disabled={!leads.length}
            style={{
              width: "auto",
              flex: "0 1 auto",
              borderColor: filterScore > 0 ? "var(--green)" : undefined,
              color: filterScore > 0 ? "var(--green)" : undefined,
            }}
          >
            {SCORE_TIERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.value === 0
                  ? `All leads (${activeLeads.length})`
                  : `${t.label} ${t.value}+ (${scoreDist[t.value] ?? "…"})`}
              </option>
            ))}
          </select>
          <select
            value={filterState}
            onChange={(e) => {
              setFilterState(e.target.value);
              setPage(1);
            }}
            disabled={!leads.length}
            style={{ width: "auto", flex: "0 1 auto" }}
          >
            <option value="">All {regionLabel.toLowerCase()}s</option>
            {stats?.states?.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={filterCategory}
            onChange={(e) => {
              setFilterCategory(e.target.value);
              setPage(1);
            }}
            disabled={!leads.length}
            style={{ width: "auto", flex: "0 1 auto" }}
          >
            <option value="">All categories</option>
            {ALL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {leads.length > 0 && (
            <button
              onClick={() => {
                setHideExcluded((h) => !h);
                setPage(1);
              }}
              style={{
                background: hideExcluded ? "var(--surface2)" : "transparent",
                border: `1px solid ${hideExcluded ? "var(--border2)" : "var(--border)"}`,
                color: hideExcluded ? "var(--text)" : "var(--muted)",
                borderRadius: 6,
                padding: "9px 14px",
                fontSize: 12,
                cursor: "pointer",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {hideExcluded ? "✓ Hide excluded" : "Show excluded"}
            </button>
          )}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch("");
                setFilterState("");
                setFilterCategory("");
                setFilterScore(0);
                setPage(1);
              }}
              style={{
                background: "var(--surface2)",
                border: "1px solid var(--border)",
                color: "var(--muted)",
                borderRadius: 6,
                padding: "9px 14px",
                fontSize: 13,
                flexShrink: 0,
              }}
            >
              Clear
            </button>
          )}
          {!isMobile && <div className="toolbar-divider" />}
          {!isMobile && leads.length > 0 && (
            <div
              style={{ position: "relative", flexShrink: 0 }}
              ref={colPanelRef}
            >
              <button
                onClick={() => setShowColPanel((p) => !p)}
                style={{
                  background: showColPanel ? "var(--surface2)" : "transparent",
                  border: `1px solid ${showColPanel ? "var(--border2)" : "var(--border)"}`,
                  color: "var(--text)",
                  borderRadius: 6,
                  padding: "9px 14px",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                ⊞ Columns
              </button>
              {showColPanel && (
                <div className="col-panel">
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--muted)",
                      marginBottom: 8,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    Toggle columns
                  </div>
                  {cols.map((col) => (
                    <div
                      key={col.key}
                      className="col-row"
                      onClick={() => toggleCol(col.key)}
                    >
                      <div className={`col-check ${col.visible ? "on" : ""}`}>
                        {col.visible && "✓"}
                      </div>
                      {col.label}
                      {[
                        "linkedin_company",
                        "linkedin_personal",
                        "instagram",
                        "abn",
                        "entity_type",
                      ].includes(col.key) && (
                        <span
                          style={{
                            marginLeft: "auto",
                            fontSize: 10,
                            color: "#a78bfa",
                            background: "rgba(167,139,250,0.1)",
                            borderRadius: 4,
                            padding: "1px 5px",
                          }}
                        >
                          new
                        </span>
                      )}
                    </div>
                  ))}
                  <div
                    style={{
                      borderTop: "1px solid var(--border)",
                      marginTop: 8,
                      paddingTop: 8,
                    }}
                  >
                    <button
                      onClick={resetCols}
                      style={{
                        background: "none",
                        border: "none",
                        color: "var(--muted)",
                        fontSize: 12,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      Reset to default
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: "var(--surface2)",
              border: "1px solid var(--border)",
              color: "var(--text)",
              borderRadius: 6,
              padding: "9px 14px",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ↑ {isMobile ? "Add CSVs" : "Add more CSVs"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            multiple
            style={{ display: "none" }}
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>

        {/* ── Advanced filters ── */}
        {leads.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            <button
              onClick={() => setShowAdvanced((a) => !a)}
              style={{
                background: "none",
                border: "none",
                color: showAdvanced ? "var(--text)" : "var(--muted)",
                fontSize: 12,
                cursor: "pointer",
                padding: "4px 0",
                display: "flex",
                alignItems: "center",
                gap: 6,
                transition: "color 0.15s",
              }}
            >
              <span style={{ fontSize: 10 }}>{showAdvanced ? "▼" : "▶"}</span>
              Advanced filters
              {filterSource && (
                <span
                  style={{
                    background: "rgba(62,207,142,0.15)",
                    color: "var(--green)",
                    borderRadius: 99,
                    padding: "1px 8px",
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  1 active
                </span>
              )}
            </button>

            {showAdvanced && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  padding: "10px 0 4px",
                }}
              >
                <select
                  value={filterSource}
                  onChange={(e) => {
                    setFilterSource(e.target.value);
                    setPage(1);
                  }}
                  style={{ width: "auto", flex: "0 1 280px" }}
                >
                  <option value="">All source searches</option>
                  {[...new Set(leads.map((l) => l._source).filter(Boolean))]
                    .sort()
                    .map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* ── File summary ── */}
        {loadedFiles.length > 1 && (
          <div className="file-summary">
            <div className="file-summary-stats">
              <span style={{ color: "var(--muted)" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--text)",
                    marginRight: 5,
                  }}
                >
                  {loadedFiles.length}
                </span>
                files
              </span>
              <span style={{ color: "var(--muted)" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--green)",
                    marginRight: 5,
                  }}
                >
                  {stats?.unique?.toLocaleString()}
                </span>
                unique leads
              </span>
              {isProcessing && (
                <span
                  style={{
                    color: "var(--amber)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                  }}
                >
                  Processing…
                </span>
              )}
            </div>
            <button
              onClick={clearAll}
              style={{
                background: "none",
                border: "none",
                color: "var(--muted)",
                fontSize: 12,
                cursor: "pointer",
              }}
              onMouseOver={(e) => (e.target.style.color = "var(--red)")}
              onMouseOut={(e) => (e.target.style.color = "var(--muted)")}
            >
              Clear all
            </button>
          </div>
        )}

        {/* ── Empty state / Drop zone ── */}
        {loadedFiles.length === 0 && !isAutoLoading && (
          csvMissing ? (
            <div
              style={{
                textAlign: "center",
                padding: "56px 24px",
                color: "var(--muted)",
                marginBottom: 20,
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 14, opacity: 0.4 }}>—</div>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 500,
                  marginBottom: 8,
                  color: "var(--text)",
                }}
              >
                No leads yet
              </div>
              <div style={{ fontSize: 13, marginBottom: 24 }}>
                Use the scrape panel above to find {countryName} leads, or drop a CSV file below.
              </div>
              <div
                className={`drop-zone ${isDragging ? "dragging" : ""}`}
                style={{ padding: "32px 24px", display: "inline-block", minWidth: 280 }}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <div style={{ fontSize: 22, marginBottom: 8, color: "var(--muted)" }}>↑</div>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 4 }}>Drop a CSV here</div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>or click to browse</div>
              </div>
            </div>
          ) : (
            <div
              className={`drop-zone ${isDragging ? "dragging" : ""}`}
              style={{
                padding: "48px 24px",
                textAlign: "center",
                marginBottom: 20,
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <div
                style={{ fontSize: 28, marginBottom: 10, color: "var(--muted)" }}
              >
                ↑
              </div>
              <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
                Drag & drop your CSV exports here
              </div>
              <div style={{ fontSize: 13, color: "var(--muted)" }}>
                All files merged and deduplicated automatically
              </div>
            </div>
          )
        )}

        {/* ── Table ── */}
        {leads.length > 0 && (
          <>
            <div
              style={{
                border: "1px solid var(--border)",
                borderRadius: 10,
                overflow: "hidden",
                overflowX: "auto",
                WebkitOverflowScrolling: "touch",
              }}
            >
              <table
                style={{
                  tableLayout: "fixed",
                  minWidth: isMobile
                    ? 400
                    : visibleCols.reduce((s, c) => s + c.width, 0) + 60,
                }}
              >
                <colgroup>
                  {visibleCols.map((col) => (
                    <col key={col.key} style={{ width: col.width }} />
                  ))}
                  <col style={{ width: 52 }} />
                </colgroup>
                <thead>
                  <tr>
                    {visibleCols.map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleSort(col.key)}
                        style={{
                          cursor: "pointer",
                          userSelect: "none",
                          position: "relative",
                          overflow: "visible",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                          }}
                        >
                          {col.label}
                          {sortCol === col.key ? (
                            <span style={{ opacity: 0.7 }}>
                              {sortDir === 1 ? "↑" : "↓"}
                            </span>
                          ) : (
                            <span style={{ opacity: 0.2 }}>↕</span>
                          )}
                          {col.key === "_score" && (
                            <ScoreInfoTooltip
                              onFilter={(score) => {
                                setFilterScore(score);
                                setPage(1);
                              }}
                            />
                          )}
                        </div>
                        {!isMobile && (
                          <div
                            className="resize-handle"
                            onMouseDown={(e) =>
                              startResize(e, col.key, col.width)
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                        )}
                      </th>
                    ))}
                    {<th style={{ overflow: "visible" }}>Enrich</th>}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((lead, i) => {
                    const isEnriching = !!enriching[lead.title];
                    const isExcluded = lead._category === "EXCLUDED";
                    return (
                      <tr key={i} className={isExcluded ? "excluded" : ""}>
                        {visibleCols.map(({ key }) => {
                          if (key === "_score")
                            return (
                              <td key={key} style={{ textAlign: "center" }}>
                                <ScorePill score={lead._score} />
                              </td>
                            );
                          if (key === "title")
                            return (
                              <td
                                key={key}
                                title={lead.title}
                                style={{ fontWeight: 500 }}
                              >
                                {lead.title}
                              </td>
                            );
                          if (key === "_category")
                            return (
                              <td key={key}>
                                <Badge category={lead._category} />
                              </td>
                            );
                          if (key === "website")
                            return (
                              <td key={key}>
                                {lead.website ? (
                                  <a
                                    href={
                                      lead.website.startsWith("http")
                                        ? lead.website
                                        : `https://${lead.website}`
                                    }
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                      color: "var(--blue)",
                                      textDecoration: "none",
                                      fontSize: 12,
                                    }}
                                  >
                                    {
                                      lead.website
                                        .replace(/^https?:\/\/(www\.)?/, "")
                                        .split("/")[0]
                                    }
                                  </a>
                                ) : (
                                  "—"
                                )}
                              </td>
                            );
                          if (key === "emails")
                            return (
                              <td
                                key={key}
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                }}
                              >
                                {lead.emails ? (
                                  <span style={{ color: "var(--green)" }}>
                                    {lead.emails.split(",")[0].trim()}
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--muted)" }}>
                                    —
                                  </span>
                                )}
                              </td>
                            );
                          if (key === "phone")
                            return (
                              <td
                                key={key}
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {lead.phone || "—"}
                              </td>
                            );
                          if (key === "founder_name")
                            return (
                              <td key={key} style={{ fontSize: 12 }}>
                                {lead.founder_name || (
                                  <span style={{ color: "var(--muted)" }}>
                                    —
                                  </span>
                                )}
                              </td>
                            );
                          if (key === "linkedin_company")
                            return (
                              <td key={key}>
                                <SocialLink
                                  url={lead.linkedin_company}
                                  type="linkedin"
                                />
                              </td>
                            );
                          if (key === "linkedin_personal")
                            return (
                              <td key={key}>
                                <SocialLink
                                  url={lead.linkedin_personal}
                                  type="linkedin"
                                />
                              </td>
                            );
                          if (key === "instagram")
                            return (
                              <td key={key}>
                                <SocialLink
                                  url={lead.instagram}
                                  type="instagram"
                                />
                              </td>
                            );
                          if (key === "abn")
                            return (
                              <td
                                key={key}
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {lead.abn || (
                                  <span style={{ color: "var(--muted)" }}>
                                    —
                                  </span>
                                )}
                              </td>
                            );
                          if (key === "entity_type")
                            return (
                              <td key={key} style={{ fontSize: 11 }}>
                                {lead.entity_type || (
                                  <span style={{ color: "var(--muted)" }}>
                                    —
                                  </span>
                                )}
                              </td>
                            );
                          if (key === "totalScore" || key === "reviewsCount")
                            return (
                              <td
                                key={key}
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                }}
                              >
                                {lead[key] || "—"}
                              </td>
                            );
                          return <td key={key}>{lead[key] || "—"}</td>;
                        })}
                        {
                          <td>
                            {!isExcluded && (
                              <button
                                onClick={() => enrichOne(lead)}
                                disabled={isEnriching}
                                title="Enrich with AI + ABN"
                                style={{
                                  background: "none",
                                  border: "1px solid var(--border)",
                                  color: isEnriching
                                    ? "var(--green)"
                                    : "var(--muted)",
                                  borderRadius: 5,
                                  padding: "4px 8px",
                                  fontSize: 11,
                                  cursor: "pointer",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  transition: "all 0.15s",
                                }}
                                onMouseOver={(e) => {
                                  if (!isEnriching)
                                    e.currentTarget.style.borderColor =
                                      "var(--green)";
                                }}
                                onMouseOut={(e) => {
                                  e.currentTarget.style.borderColor =
                                    "var(--border)";
                                }}
                              >
                                {isEnriching ? <Spinner /> : "✦"}
                              </button>
                            )}
                          </td>
                        }
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* ── Pagination ── */}
            <div className="pagination">
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                {filtered.length.toLocaleString()} leads · page {safePage} of{" "}
                {totalPages}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  style={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    color: safePage === 1 ? "var(--muted)" : "var(--text)",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 12,
                    opacity: safePage === 1 ? 0.4 : 1,
                    cursor: safePage === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage === totalPages}
                  style={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    color:
                      safePage === totalPages ? "var(--muted)" : "var(--text)",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 12,
                    opacity: safePage === totalPages ? 0.4 : 1,
                    cursor: safePage === totalPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
