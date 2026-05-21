"use client";

import Link from "next/link";
import { useState, useEffect } from "react";

export default function HomePage() {
  const [counts, setCounts] = useState({ au: null, nz: null });

  useEffect(() => {
    async function loadCounts() {
      const results = { au: null, nz: null };
      try {
        const r = await fetch("/leads_au.csv");
        if (r.ok) {
          const text = await r.text();
          const lines = text.trim().split("\n").filter(Boolean);
          results.au = Math.max(0, lines.length - 1);
        }
      } catch {}
      try {
        const r = await fetch("/leads_nz.csv");
        if (r.ok) {
          const text = await r.text();
          const lines = text.trim().split("\n").filter(Boolean);
          results.nz = Math.max(0, lines.length - 1);
        }
      } catch {}
      setCounts(results);
    }
    loadCounts();
  }, []);

  const countries = [
    { flag: "🇦🇺", name: "Australia", href: "/au", count: counts.au },
    { flag: "🇳🇿", name: "New Zealand", href: "/nz", count: counts.nz },
  ];

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 24px",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 48 }}>
        <div
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--green)",
            letterSpacing: "0.1em",
            marginBottom: 12,
          }}
        >
          LEAD SCRAPER
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 600,
            letterSpacing: "-0.02em",
            color: "var(--text)",
          }}
        >
          Select Country
        </h1>
      </div>

      <div
        style={{
          display: "flex",
          gap: 20,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {countries.map(({ flag, name, href, count }) => (
          <Link key={href} href={href} style={{ textDecoration: "none" }}>
            <div
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 16,
                padding: "40px 56px",
                textAlign: "center",
                cursor: "pointer",
                transition: "border-color 0.15s, background 0.15s",
                minWidth: 220,
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.borderColor = "var(--green)";
                e.currentTarget.style.background = "var(--surface2)";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--surface)";
              }}
            >
              <div style={{ fontSize: 56, lineHeight: 1, marginBottom: 16 }}>
                {flag}
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 600,
                  marginBottom: 10,
                  color: "var(--text)",
                }}
              >
                {name}
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  color: count > 0 ? "var(--green)" : "var(--muted)",
                }}
              >
                {count === null
                  ? "…"
                  : count > 0
                  ? `${count.toLocaleString()} leads`
                  : "No leads yet"}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
