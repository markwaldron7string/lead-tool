"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import Papa from "papaparse";
import { processFiles, filterLeads, leadsToCSV } from "@/lib/processor";

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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function StatCard({ label, value, color }) {
  const colorMap = {
    green: "var(--green)",
    amber: "var(--amber)",
    red: "var(--red)",
    blue: "var(--blue)",
    default: "var(--text)",
  };
  return (
    <div className="stat-card fade-up">
      <div className="stat-label">{label}</div>
      <div
        className="stat-value"
        style={{ color: colorMap[color] || colorMap.default }}
      >
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

// ── Responsive hook ───────────────────────────────────────────────────────────

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);
  return isMobile;
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Home() {
  const [leads, setLeads] = useState([]);
  const [stats, setStats] = useState(null);
  const [loadedFiles, setLoadedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutoLoading, setIsAutoLoading] = useState(true);

  const [search, setSearch] = useState("");
  const [filterState, setFilterState] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [hideExcluded, setHideExcluded] = useState(true);

  const [page, setPage] = useState(1);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState(1);

  const [enriching, setEnriching] = useState({});
  const [enrichProgress, setEnrichProgress] = useState(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const cancelRef = useRef(false);
  const fileInputRef = useRef(null);
  const isMobile = useIsMobile();

  // ── Auto-load leads.csv ───────────────────────────────────────────────────

  useEffect(() => {
    async function autoLoad() {
      try {
        const res = await fetch("/leads.csv");
        if (!res.ok) {
          setIsAutoLoading(false);
          return;
        }
        const text = await res.text();
        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          complete: (result) => {
            const file = { name: "leads.csv", rows: result.data };
            const { leads: newLeads, stats: newStats } = processFiles([file]);
            setLeads(newLeads);
            setStats(newStats);
            setLoadedFiles([file]);
            setIsAutoLoading(false);
          },
          error: () => setIsAutoLoading(false),
        });
      } catch {
        setIsAutoLoading(false);
      }
    }
    autoLoad();
  }, []);

  // ── File handling ─────────────────────────────────────────────────────────

  const handleFiles = useCallback((newFiles) => {
    const csvFiles = [...newFiles].filter((f) =>
      f.name.toLowerCase().endsWith(".csv"),
    );
    if (!csvFiles.length) return;
    setIsProcessing(true);
    const parsed = [];
    let remaining = csvFiles.length;
    csvFiles.forEach((file) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          parsed.push({ name: file.name, rows: result.data });
          remaining--;
          if (remaining === 0) {
            setLoadedFiles((prev) => {
              const combined = [...prev];
              parsed.forEach((p) => {
                const idx = combined.findIndex((f) => f.name === p.name);
                if (idx >= 0) combined[idx] = p;
                else combined.push(p);
              });
              const { leads: newLeads, stats: newStats } =
                processFiles(combined);
              setLeads(newLeads);
              setStats(newStats);
              setPage(1);
              setIsProcessing(false);
              return combined;
            });
          }
        },
        error: () => {
          remaining--;
          if (remaining === 0) setIsProcessing(false);
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
    setPage(1);
    setEnriching({});
    setEnrichProgress(null);
    setBulkRunning(false);
  }, []);

  // ── Enrichment ────────────────────────────────────────────────────────────

  const enrichOne = useCallback(async (lead) => {
    const key = lead.title;
    if (!lead.website) return;
    setEnriching((prev) => ({ ...prev, [key]: true }));
    try {
      const res = await fetch("/api/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website: lead.website,
          businessName: lead.title,
          existingEmail: lead.emails || "",
        }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setLeads((prev) =>
        prev.map((l) =>
          l.title !== key
            ? l
            : {
                ...l,
                founder_name: data.founder_name || l.founder_name || "",
                job_title: data.job_title || l.job_title || "",
                emails: data.email || l.emails || "",
                _enriched: true,
              },
        ),
      );
    } catch (err) {
      console.error("Enrich failed", err);
    }
    setEnriching((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
  }, []);

  const enrichAll = useCallback(async () => {
    const toEnrich = leads.filter(
      (l) => l.website && l._category !== "EXCLUDED",
    );
    if (!toEnrich.length) return;
    cancelRef.current = false;
    setBulkRunning(true);
    setEnrichProgress({ done: 0, total: toEnrich.length });
    let done = 0;
    for (let i = 0; i < toEnrich.length; i += BATCH_SIZE) {
      if (cancelRef.current) break;
      const batch = toEnrich.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async (lead) => {
          if (cancelRef.current) return;
          const key = lead.title;
          setEnriching((prev) => ({ ...prev, [key]: true }));
          try {
            const res = await fetch("/api/enrich", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                website: lead.website,
                businessName: lead.title,
                existingEmail: lead.emails || "",
              }),
            });
            if (!res.ok) throw new Error();
            const data = await res.json();
            setLeads((prev) =>
              prev.map((l) =>
                l.title !== key
                  ? l
                  : {
                      ...l,
                      founder_name: data.founder_name || l.founder_name || "",
                      job_title: data.job_title || l.job_title || "",
                      emails: data.email || l.emails || "",
                      _enriched: true,
                    },
              ),
            );
          } catch {
            /* silent */
          }
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

  const cancelEnrich = useCallback(() => {
    cancelRef.current = true;
    setBulkRunning(false);
    setEnrichProgress(null);
    setEnriching({});
  }, []);

  // ── Filtering & sorting ───────────────────────────────────────────────────

  let filtered = filterLeads(leads, {
    search,
    state: filterState,
    category: filterCategory,
  });
  if (hideExcluded)
    filtered = filtered.filter((l) => l._category !== "EXCLUDED");
  if (sortCol) {
    filtered = [...filtered].sort((a, b) => {
      const av = a[sortCol] || "",
        bv = b[sortCol] || "";
      return av < bv ? -sortDir : av > bv ? sortDir : 0;
    });
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => d * -1);
    else {
      setSortCol(col);
      setSortDir(1);
    }
    setPage(1);
  };
  const enrichedCount = leads.filter((l) => l._enriched).length;
  const hasEmailCount = leads.filter((l) => l.emails && l.emails.trim()).length;
  const hasNameCount = leads.filter(
    (l) => l.founder_name && l.founder_name.trim(),
  ).length;
  const hasActiveFilters = search || filterState || filterCategory;

  const handleExport = () => {
    const csv = leadsToCSV(filtered);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `buyers_agents_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Loading screen ────────────────────────────────────────────────────────

  if (isAutoLoading) {
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
  }

  // ── Render ────────────────────────────────────────────────────────────────

  // On mobile, only show key columns
  const tableColumns = isMobile
    ? [
        ["title", "Business"],
        ["state", "State"],
        ["_category", "Category"],
        ["emails", "Email"],
      ]
    : [
        ["title", "Business name"],
        ["phone", "Phone"],
        ["city", "City"],
        ["state", "State"],
        ["totalScore", "Rating"],
        ["_category", "Category"],
        ["website", "Website"],
        ["emails", "Email"],
        ["founder_name", "Founder"],
      ];

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <div
        style={{
          maxWidth: 1400,
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
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 7,
                background: "var(--green)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path
                  d="M2 7h10M7 2l5 5-5 5"
                  stroke="#0a0a0b"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
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
                Buyers Agent Australia
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
            {leads.length > 0 && !isMobile && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                {filtered.length.toLocaleString()} leads
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
          <div className="stats-grid">
            <StatCard label="Imported" value={stats.totalRows} />
            <StatCard label="Dupes removed" value={stats.dupes} color="amber" />
            <StatCard label="Unique leads" value={stats.unique} color="green" />
            <StatCard
              label="Categorised"
              value={stats.categorised}
              color="blue"
            />
            <StatCard label="With email" value={hasEmailCount} color="green" />
            <StatCard label="With name" value={hasNameCount} color="blue" />
          </div>
        )}

        {/* ── Enrichment bar ── */}
        {leads.length > 0 && (
          <div className="enrich-bar">
            <div>
              <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 3 }}>
                AI Enrichment
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--muted)",
                    marginLeft: 10,
                  }}
                >
                  gpt-4o-mini
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                {enrichedCount > 0
                  ? `${enrichedCount.toLocaleString()} leads enriched this session`
                  : "Extract founder names and emails using AI"}
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
                    cursor: leads.length ? "pointer" : "not-allowed",
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
            value={filterState}
            onChange={(e) => {
              setFilterState(e.target.value);
              setPage(1);
            }}
            disabled={!leads.length}
            style={{ width: "auto", flex: "0 1 auto" }}
          >
            <option value="">All states</option>
            {stats?.states.map((s) => (
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
              {hideExcluded ? "✓ Hiding excluded" : "Show excluded"}
            </button>
          )}
          {hasActiveFilters && (
            <button
              onClick={() => {
                setSearch("");
                setFilterState("");
                setFilterCategory("");
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
                files loaded
              </span>
              <span style={{ color: "var(--muted)" }}>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    color: "var(--green)",
                    marginRight: 5,
                  }}
                >
                  {stats?.unique.toLocaleString()}
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
                padding: "2px 6px",
                borderRadius: 4,
                flexShrink: 0,
              }}
              onMouseOver={(e) => (e.target.style.color = "var(--red)")}
              onMouseOut={(e) => (e.target.style.color = "var(--muted)")}
            >
              Clear all
            </button>
          </div>
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
              <table style={{ minWidth: isMobile ? 400 : 900 }}>
                <thead>
                  <tr>
                    {tableColumns.map(([col, label]) => (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        style={{ cursor: "pointer", userSelect: "none" }}
                      >
                        {label}
                        {sortCol === col ? (
                          <span style={{ marginLeft: 4, opacity: 0.7 }}>
                            {sortDir === 1 ? "↑" : "↓"}
                          </span>
                        ) : (
                          <span style={{ marginLeft: 4, opacity: 0.2 }}>↕</span>
                        )}
                      </th>
                    ))}
                    {!isMobile && <th>Enrich</th>}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((lead, i) => {
                    const isEnriching = !!enriching[lead.title];
                    const isExcluded = lead._category === "EXCLUDED";
                    return (
                      <tr key={i} className={isExcluded ? "excluded" : ""}>
                        {tableColumns.map(([col]) => {
                          if (col === "title")
                            return (
                              <td
                                key={col}
                                title={lead.title}
                                style={{
                                  fontWeight: 500,
                                  maxWidth: isMobile ? 140 : "none",
                                }}
                              >
                                {lead.title}
                              </td>
                            );
                          if (col === "_category")
                            return (
                              <td key={col}>
                                <Badge category={lead._category} />
                              </td>
                            );
                          if (col === "website")
                            return (
                              <td key={col}>
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
                          if (col === "emails")
                            return (
                              <td
                                key={col}
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
                          if (col === "founder_name")
                            return (
                              <td key={col} style={{ fontSize: 12 }}>
                                {lead.founder_name ? (
                                  <span style={{ color: "var(--text)" }}>
                                    {lead.founder_name}
                                  </span>
                                ) : (
                                  <span style={{ color: "var(--muted)" }}>
                                    —
                                  </span>
                                )}
                              </td>
                            );
                          if (col === "phone")
                            return (
                              <td
                                key={col}
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                }}
                              >
                                {lead.phone || "—"}
                              </td>
                            );
                          if (col === "totalScore")
                            return (
                              <td
                                key={col}
                                style={{
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 11,
                                }}
                              >
                                {lead.totalScore || "—"}
                              </td>
                            );
                          return <td key={col}>{lead[col] || "—"}</td>;
                        })}
                        {!isMobile && (
                          <td>
                            {!isExcluded && (
                              <button
                                onClick={() => enrichOne(lead)}
                                disabled={isEnriching || !lead.website}
                                title={
                                  !lead.website
                                    ? "No website"
                                    : "Enrich with AI"
                                }
                                style={{
                                  background: "none",
                                  border: "1px solid var(--border)",
                                  color: isEnriching
                                    ? "var(--green)"
                                    : "var(--muted)",
                                  borderRadius: 5,
                                  padding: "4px 8px",
                                  fontSize: 11,
                                  cursor: lead.website
                                    ? "pointer"
                                    : "not-allowed",
                                  opacity: lead.website ? 1 : 0.3,
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 4,
                                  transition: "all 0.15s",
                                }}
                                onMouseOver={(e) => {
                                  if (lead.website && !isEnriching)
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
                        )}
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
                {filtered.length.toLocaleString()} leads · page {page} of{" "}
                {totalPages}
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  style={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    color: page === 1 ? "var(--muted)" : "var(--text)",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 12,
                    opacity: page === 1 ? 0.4 : 1,
                    cursor: page === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  style={{
                    background: "var(--surface2)",
                    border: "1px solid var(--border)",
                    color: page === totalPages ? "var(--muted)" : "var(--text)",
                    borderRadius: 6,
                    padding: "6px 14px",
                    fontSize: 12,
                    opacity: page === totalPages ? 0.4 : 1,
                    cursor: page === totalPages ? "not-allowed" : "pointer",
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
