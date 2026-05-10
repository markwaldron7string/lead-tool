'use client';

import { useState, useCallback, useRef } from 'react';
import Papa from 'papaparse';
import { processFiles, filterLeads, leadsToCSV } from '@/lib/processor';

const PAGE_SIZE = 30;

const CAT_BADGE = {
  'Investment BA':    'badge-investment',
  'SMSF':            'badge-smsf',
  'Owner-occupier':  'badge-owner',
  'Off-the-plan':    'badge-offplan',
  'Project sales':   'badge-project',
  'Property advisor':'badge-advisor',
  'Uncategorised':   'badge-unknown',
  'EXCLUDED':        'badge-excluded',
};

const ALL_CATEGORIES = [
  'Investment BA', 'SMSF', 'Owner-occupier',
  'Off-the-plan', 'Project sales', 'Property advisor',
  'Uncategorised', 'EXCLUDED',
];

// ── Small components ──────────────────────────────────────────────────────────

function StatCard({ label, value, color }) {
  const colorMap = {
    green:   'var(--green)',
    amber:   'var(--amber)',
    red:     'var(--red)',
    blue:    'var(--blue)',
    default: 'var(--text)',
  };
  return (
    <div className="stat-card fade-up">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={{ color: colorMap[color] || colorMap.default }}>
        {value?.toLocaleString() ?? '—'}
      </div>
    </div>
  );
}

function Badge({ category }) {
  return (
    <span className={`badge ${CAT_BADGE[category] || 'badge-unknown'}`}>
      {category}
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [leads, setLeads]             = useState([]);
  const [stats, setStats]             = useState(null);
  const [loadedFiles, setLoadedFiles] = useState([]);
  const [isDragging, setIsDragging]   = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [search, setSearch]           = useState('');
  const [filterState, setFilterState] = useState('');
  const [filterCategory, setFilterCategory] = useState('');
  const [page, setPage]               = useState(1);
  const [sortCol, setSortCol]         = useState(null);
  const [sortDir, setSortDir]         = useState(1);
  const fileInputRef = useRef(null);

  // ── File handling ───────────────────────────────────────────────────────────

  const handleFiles = useCallback((newFiles) => {
    const csvFiles = [...newFiles].filter(f => f.name.toLowerCase().endsWith('.csv'));
    if (!csvFiles.length) return;

    setIsProcessing(true);

    const parsed = [];
    let remaining = csvFiles.length;

    csvFiles.forEach(file => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => {
          parsed.push({ name: file.name, rows: result.data });
          remaining--;
          if (remaining === 0) {
            setLoadedFiles(prev => {
              const combined = [...prev];
              parsed.forEach(p => {
                const idx = combined.findIndex(f => f.name === p.name);
                if (idx >= 0) combined[idx] = p;
                else combined.push(p);
              });
              const { leads: newLeads, stats: newStats } = processFiles(combined);
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

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const clearAll = useCallback(() => {
    setLoadedFiles([]);
    setLeads([]);
    setStats(null);
    setSearch('');
    setFilterState('');
    setFilterCategory('');
    setPage(1);
  }, []);

  // ── Filtering & sorting ─────────────────────────────────────────────────────

  let filtered = filterLeads(leads, {
    search, state: filterState, category: filterCategory,
  });

  if (sortCol) {
    filtered = [...filtered].sort((a, b) => {
      const av = a[sortCol] || '';
      const bv = b[sortCol] || '';
      if (av < bv) return -sortDir;
      if (av > bv) return  sortDir;
      return 0;
    });
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d * -1);
    else { setSortCol(col); setSortDir(1); }
    setPage(1);
  };

  // ── Export ──────────────────────────────────────────────────────────────────

  const handleExport = () => {
    const csv  = leadsToCSV(filtered);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `buyers_agents_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const hasActiveFilters = search || filterState || filterCategory;

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '0 24px 80px' }}>

      {/* ── Header ── */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '28px 0 24px', borderBottom: '1px solid var(--border)', marginBottom: 28,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 30, height: 30, borderRadius: 7,
            background: 'var(--green)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 7h10M7 2l5 5-5 5" stroke="#0a0a0b" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', letterSpacing: '0.06em', marginBottom: 2, cursor: 'default' }}>
              LEAD SCRAPER
            </div>
            <h1 style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1, cursor: 'default' }}>
              Buyers Agent Australia
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {stats && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
              {filtered.length.toLocaleString()} leads
            </span>
          )}
          <button
            onClick={handleExport}
            disabled={!filtered.length}
            style={{
              background: filtered.length ? 'var(--green)' : 'var(--surface2)',
              color: filtered.length ? '#0a0a0b' : 'var(--muted)',
              fontWeight: 600, fontSize: 13, padding: '8px 18px',
              borderRadius: 8, transition: 'opacity 0.15s',
              opacity: filtered.length ? 1 : 0.4,
              cursor: filtered.length ? 'pointer' : 'not-allowed',
            }}
          >
            Export CSV
          </button>
        </div>
      </header>

      {/* ── Stats row ── */}
      {stats && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 10, marginBottom: 24,
        }}>
          <StatCard label="Imported"      value={stats.totalRows}    />
          <StatCard label="Dupes removed" value={stats.dupes}        color="amber" />
          <StatCard label="Unique leads"  value={stats.unique}       color="green" />
          <StatCard label="Categorised"   value={stats.categorised}  color="blue"  />
          <StatCard label="Uncategorised" value={stats.unknown}      color="amber" />
          <StatCard label="Excluded"      value={stats.excluded}     color="red"   />
        </div>
      )}

      {/* ── Search + filters + upload (one cohesive toolbar) ── */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16,
        alignItems: 'stretch', flexWrap: 'wrap',
      }}>
        {/* Search — most prominent */}
        <input
          type="text"
          placeholder={leads.length ? `Search ${leads.length.toLocaleString()} leads…` : 'Search leads…'}
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1); }}
          style={{ flex: '1 1 260px', fontSize: 14, padding: '9px 14px' }}
        />

        {/* State filter */}
        <select
          value={filterState}
          onChange={e => { setFilterState(e.target.value); setPage(1); }}
          style={{ flex: '0 0 auto' }}
          disabled={!leads.length}
        >
          <option value="">All states</option>
          {stats?.states.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Category filter */}
        <select
          value={filterCategory}
          onChange={e => { setFilterCategory(e.target.value); setPage(1); }}
          style={{ flex: '0 0 auto' }}
          disabled={!leads.length}
        >
          <option value="">All categories</option>
          {ALL_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        {/* Clear filters */}
        {hasActiveFilters && (
          <button
            onClick={() => { setSearch(''); setFilterState(''); setFilterCategory(''); setPage(1); }}
            style={{
              background: 'var(--surface2)', border: '1px solid var(--border)',
              color: 'var(--muted)', borderRadius: 6, padding: '9px 14px', fontSize: 13,
            }}
          >
            Clear
          </button>
        )}

        {/* Divider */}
        <div style={{ width: 1, background: 'var(--border)', margin: '0 4px', alignSelf: 'stretch' }} />

        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          style={{
            background: 'var(--surface2)', border: '1px solid var(--border)',
            color: 'var(--text)', borderRadius: 6, padding: '9px 16px', fontSize: 13,
            display: 'flex', alignItems: 'center', gap: 7, whiteSpace: 'nowrap',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>↑</span>
          {loadedFiles.length ? 'Add more CSVs' : 'Upload CSVs'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          multiple
          style={{ display: 'none' }}
          onChange={e => handleFiles(e.target.files)}
        />
      </div>

      {/* ── File summary (replaces chip list) ── */}
      {loadedFiles.length > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 8, padding: '10px 14px', marginBottom: 16,
          fontSize: 13,
        }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
            <span style={{ color: 'var(--muted)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)', marginRight: 5 }}>
                {loadedFiles.length}
              </span>
              files loaded
            </span>
            <span style={{ color: 'var(--muted)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text)', marginRight: 5 }}>
                {stats?.totalRows.toLocaleString()}
              </span>
              rows imported
            </span>
            <span style={{ color: 'var(--muted)' }}>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--green)', marginRight: 5 }}>
                {stats?.unique.toLocaleString()}
              </span>
              unique leads
            </span>
            {isProcessing && (
              <span style={{ color: 'var(--amber)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                Processing…
              </span>
            )}
          </div>
          <button
            onClick={clearAll}
            style={{
              background: 'none', border: 'none', color: 'var(--muted)',
              fontSize: 12, cursor: 'pointer', padding: '2px 6px',
              borderRadius: 4, transition: 'color 0.1s',
            }}
            onMouseOver={e => e.target.style.color = 'var(--red)'}
            onMouseOut={e => e.target.style.color = 'var(--muted)'}
          >
            Clear all
          </button>
        </div>
      )}

      {/* ── Drop zone (only shown when no files loaded) ── */}
      {loadedFiles.length === 0 && (
        <div
          className={`drop-zone ${isDragging ? 'dragging' : ''}`}
          style={{ padding: '48px 24px', textAlign: 'center', marginBottom: 20 }}
          onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <div style={{ fontSize: 28, marginBottom: 10, color: 'var(--muted)' }}>↑</div>
          <div style={{ fontSize: 15, fontWeight: 500, marginBottom: 6 }}>
            Drag & drop your Apify CSV exports here
          </div>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>
            Drop all 80 files at once — duplicates removed automatically
          </div>
        </div>
      )}

      {/* ── Table ── */}
      {leads.length > 0 && (
        <>
          <div style={{
            border: '1px solid var(--border)', borderRadius: 10,
            overflow: 'hidden', overflowX: 'auto',
          }}>
            <table>
              <colgroup>
                <col style={{ width: '22%' }} />
                <col style={{ width: '11%' }} />
                <col style={{ width: '9%'  }} />
                <col style={{ width: '6%'  }} />
                <col style={{ width: '5%'  }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '17%' }} />
              </colgroup>
              <thead>
                <tr>
                  {[
                    ['title',        'Business name'],
                    ['phone',        'Phone'],
                    ['city',         'City'],
                    ['state',        'State'],
                    ['totalScore',   'Rating'],
                    ['_category',    'Category'],
                    ['website',      'Website'],
                    ['emails',       'Email'],
                  ].map(([col, label]) => (
                    <th
                      key={col}
                      onClick={() => handleSort(col)}
                      style={{ cursor: 'pointer', userSelect: 'none' }}
                    >
                      {label}
                      {sortCol === col
                        ? <span style={{ marginLeft: 4, opacity: 0.7 }}>{sortDir === 1 ? '↑' : '↓'}</span>
                        : <span style={{ marginLeft: 4, opacity: 0.2 }}>↕</span>
                      }
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {paginated.map((lead, i) => (
                  <tr key={i} className={lead._category === 'EXCLUDED' ? 'excluded' : ''}>
                    <td title={lead.title} style={{ fontWeight: 500 }}>{lead.title}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {lead.phone || '—'}
                    </td>
                    <td>{lead.city || '—'}</td>
                    <td>{lead.state || '—'}</td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                      {lead.totalScore || '—'}
                    </td>
                    <td><Badge category={lead._category} /></td>
                    <td>
                      {lead.website ? (
                        <a
                          href={lead.website.startsWith('http') ? lead.website : `https://${lead.website}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: 'var(--blue)', textDecoration: 'none', fontSize: 12 }}
                        >
                          {lead.website.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                        </a>
                      ) : '—'}
                    </td>
                    <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                      {lead.emails
                        ? <span style={{ color: 'var(--green)' }}>{lead.emails.split(',')[0].trim()}</span>
                        : <span style={{ color: 'var(--muted)' }}>—</span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ── */}
          <div style={{
            display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', marginTop: 16,
          }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
              {filtered.length.toLocaleString()} leads · page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  color: page === 1 ? 'var(--muted)' : 'var(--text)',
                  borderRadius: 6, padding: '6px 14px', fontSize: 12,
                  opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? 'not-allowed' : 'pointer',
                }}
              >
                ← Prev
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                style={{
                  background: 'var(--surface2)', border: '1px solid var(--border)',
                  color: page === totalPages ? 'var(--muted)' : 'var(--text)',
                  borderRadius: 6, padding: '6px 14px', fontSize: 12,
                  opacity: page === totalPages ? 0.4 : 1,
                  cursor: page === totalPages ? 'not-allowed' : 'pointer',
                }}
              >
                Next →
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Empty state ── */}
      {!leads.length && !isProcessing && loadedFiles.length === 0 && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--muted)' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 40, marginBottom: 14, opacity: 0.3 }}>
            ∅
          </div>
          <div style={{ fontSize: 15, marginBottom: 6, color: 'var(--text)' }}>
            No leads loaded yet
          </div>
          <div style={{ fontSize: 13 }}>
            Upload your Apify CSV exports using the button above
          </div>
        </div>
      )}

    </div>
  );
}