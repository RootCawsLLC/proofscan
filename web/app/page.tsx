'use client';

import { useState } from 'react';

/* ---- light client-side mirrors of the tool's shapes (only fields we render) ---- */
type Sev = 'critical' | 'high' | 'medium' | 'low';
interface Finding {
  id: string;
  layer: string;
  rule_id: string | null;
  title: string;
  description: string;
  file_path: string | null;
  line: number | null;
  endpoint: string | null;
  severity: Sev;
  exploitability_note: string;
  status: string;
  code_excerpt: string | null;
}
interface ScannerOutcome { name: string; status: string; findings_count: number; }
interface VerificationRun { finding_id: string; result: string; evidence: Record<string, unknown>; sandbox_ref: string; }
interface ScanReport {
  scan_run: { layers_run: string[]; scanners: ScannerOutcome[]; tool_version: string };
  findings: Finding[];
  verification_runs: VerificationRun[];
  notes: string[];
}
interface RunResult {
  source: ScanReport | null;
  dynamic: ScanReport | null;
  operatorNotes: string[];
  targetLabel: string;
  durationMs: number;
}

const SAMPLE_TARGETS = [
  { id: 'second-app', name: 'Bookmarks API (full demo)', blurb: 'Synthetic Express service with an IDOR bug. Boots as a live sandbox so the AI + dynamic layers can prove the bug by running an exploit.', supports: { s: true, a: true, d: true } },
  { id: 'vulnerable', name: 'Vulnerable fixture (static)', blurb: 'Hardcoded fallback secrets, permissive CORS, missing rate-limit/validation, schema drift. Static layer only.', supports: { s: true, a: false, d: false } },
  { id: 'clean', name: 'Clean control (negative)', blurb: 'The negative control the rules must stay silent on. Expect ~0 findings.', supports: { s: true, a: false, d: false } },
] as const;

const DEFAULT_BYO = `// Paste a small Express app. proofscan runs its static + AI-reasoning layers.
const express = require('express');
const cors = require('cors');
const app = express();

// permissive CORS with credentials — a static finding
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());

// hardcoded fallback signing secret — a static finding
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

// no input validation, no rate limit on an auth route — static findings
app.post('/login', (req, res) => {
  res.json({ token: 'demo' });
});

app.listen(3000);
`;

export default function Page() {
  const [mode, setMode] = useState<'sample' | 'byo'>('sample');
  const [sample, setSample] = useState<'second-app' | 'vulnerable' | 'clean'>('second-app');
  const [byo, setByo] = useState(DEFAULT_BYO);
  const [staticLayer, setStaticLayer] = useState(true);
  const [aiReasoning, setAiReasoning] = useState(true);
  const [dynamicL, setDynamicL] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const info = SAMPLE_TARGETS.find((t) => t.id === sample)!;
  const canAi = mode === 'byo' ? true : info.supports.a;
  const canDyn = mode === 'sample' && info.supports.d;

  async function run() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode,
          sample,
          byoSource: byo,
          layers: {
            staticLayer,
            aiReasoning: aiReasoning && canAi,
            dynamic: dynamicL && canDyn,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Scan failed.');
      setResult(data as RunResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed.');
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <h1>proofscan</h1>
      <p className="thesis">
        A finding is <b>verified-exploitable</b> only when an executed exploit changed another user’s data.
        Everything else stays <b>unverified-flagged</b>. Run it below and watch which is which.
      </p>
      <p className="sub">
        <a href="https://rootcawsllc.github.io/proofscan/">Guide</a> ·{' '}
        <a href="https://github.com/RootCawsLLC/proofscan">Source</a> · Live layers run only against an
        operator-owned synthetic sandbox — never an arbitrary target.
      </p>

      <div className="callout">
        This runs the <b>real scanner</b> in-process — not a recording. The AI layer boots a throwaway sandbox,
        runs a generated exploit against it, and only then promotes a finding. Semgrep/Gitleaks/Trivy are optional
        and reported honestly as <span className="scanner-tag">not_installed</span> when absent.
      </div>

      {/* ---------------- controls ---------------- */}
      <div className="panel">
        <div className="modes">
          <button className={`mode-btn ${mode === 'sample' ? 'on' : ''}`} onClick={() => setMode('sample')}>
            Sandboxed sample target
          </button>
          <button className={`mode-btn ${mode === 'byo' ? 'on' : ''}`} onClick={() => setMode('byo')}>
            Bring your own source
          </button>
        </div>

        {mode === 'sample' ? (
          <div className="targets">
            {SAMPLE_TARGETS.map((t) => (
              <button
                key={t.id}
                className={`target-card ${sample === t.id ? 'on' : ''}`}
                onClick={() => setSample(t.id)}
              >
                <div className="tn">{t.name}</div>
                <div className="tb">{t.blurb}</div>
              </button>
            ))}
          </div>
        ) : (
          <textarea value={byo} onChange={(e) => setByo(e.target.value)} spellCheck={false} />
        )}

        <div className="layers">
          <label className="layer">
            <input type="checkbox" checked={staticLayer} onChange={(e) => setStaticLayer(e.target.checked)} />
            <span>
              <span className="lt">Static</span>
              <br />
              <span className="ld">AST + text rules</span>
            </span>
          </label>
          <label className={`layer ${canAi ? '' : 'disabled'}`}>
            <input type="checkbox" checked={aiReasoning && canAi} disabled={!canAi} onChange={(e) => setAiReasoning(e.target.checked)} />
            <span>
              <span className="lt">AI reasoning + verify</span>
              <br />
              <span className="ld">runs a sandboxed exploit</span>
            </span>
          </label>
          <label className={`layer ${canDyn ? '' : 'disabled'}`}>
            <input type="checkbox" checked={dynamicL && canDyn} disabled={!canDyn} onChange={(e) => setDynamicL(e.target.checked)} />
            <span>
              <span className="lt">Dynamic fuzzer</span>
              <br />
              <span className="ld">live BOLA/IDOR on the sandbox</span>
            </span>
          </label>
        </div>

        <div className="run-row">
          <button className="run" onClick={run} disabled={running}>
            {running ? 'Scanning…' : 'Run scan'}
          </button>
          {running && (
            <span className="notes">
              <span className="spinner" /> The AI + dynamic layers boot a sandbox (npm install), so this can take
              20–60s.
            </span>
          )}
        </div>
      </div>

      {error && <div className="err">{error}</div>}

      {result && <Results result={result} />}
    </>
  );
}

function Results({ result }: { result: RunResult }) {
  const allFindings = [
    ...(result.source?.findings ?? []),
    ...(result.dynamic?.findings ?? []),
  ];
  const vruns = new Map<string, VerificationRun>();
  for (const v of result.source?.verification_runs ?? []) vruns.set(v.finding_id, v);

  const verifiedCount = allFindings.filter((f) => f.status === 'verified-exploitable').length;
  const scanners = [
    ...(result.source?.scan_run.scanners ?? []),
    ...(result.dynamic?.scan_run.scanners ?? []),
  ];
  const layersRun = [
    ...(result.source?.scan_run.layers_run ?? []),
    ...(result.dynamic?.scan_run.layers_run ?? []),
  ];
  const notes = [...(result.source?.notes ?? []), ...(result.dynamic?.notes ?? [])];
  const order: Record<Sev, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...allFindings].sort(
    (a, b) =>
      (a.status === 'verified-exploitable' ? -1 : 0) - (b.status === 'verified-exploitable' ? -1 : 0) ||
      order[a.severity] - order[b.severity],
  );

  return (
    <>
      <h2>Result — {result.targetLabel}</h2>
      <div className="panel">
        <div className="summary">
          <span><b>{allFindings.length}</b> finding{allFindings.length === 1 ? '' : 's'}</span>
          <span><b>{verifiedCount}</b> verified-exploitable</span>
          <span>layers: <b>{layersRun.join(', ') || '—'}</b></span>
          <span>{(result.durationMs / 1000).toFixed(1)}s</span>
        </div>
        <div className="summary" style={{ marginTop: '0.5rem' }}>
          {scanners.map((s, i) => (
            <span key={i} className="scanner-tag">
              {s.name}={s.status}
              {s.status === 'ran' ? ` (${s.findings_count})` : ''}
            </span>
          ))}
        </div>
      </div>

      {result.operatorNotes.length > 0 && (
        <div className="panel">
          <ul className="notes">
            {result.operatorNotes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="panel empty">
          No findings. For the clean control that is the point — the same rules that fire on the vulnerable target
          stay silent here.
        </div>
      ) : (
        sorted.map((f) => {
          const verified = f.status === 'verified-exploitable';
          const v = vruns.get(f.id);
          return (
            <div key={f.id} className={`finding ${verified ? 'verified' : 'flagged'}`}>
              <div className="f-head">
                <span className="f-title">{f.title}</span>
                <span className={`badge sev-${f.severity}`}>{f.severity}</span>
                <span className={`badge ${verified ? 'st-verified' : 'st-flagged'}`}>
                  {verified ? 'verified-exploitable' : f.status}
                </span>
              </div>
              <div className="f-meta">
                {f.layer}
                {f.rule_id ? ` · ${f.rule_id}` : ''}
                {f.endpoint ? ` · ${f.endpoint}` : ''}
                {f.file_path ? ` · ${f.file_path}${f.line ? `:${f.line}` : ''}` : ''}
              </div>
              <div className="f-desc">{f.description}</div>
              {f.exploitability_note && <div className="f-note">{f.exploitability_note}</div>}
              {v && (
                <details className="evidence">
                  <summary>Exploit evidence — the run that {v.result === 'pass' ? 'proved' : 'could not prove'} it (sandbox {v.sandbox_ref.slice(0, 8)})</summary>
                  <pre>{JSON.stringify(v.evidence, null, 2)}</pre>
                </details>
              )}
            </div>
          );
        })
      )}

      {notes.length > 0 && (
        <>
          <h2>Coverage &amp; notes</h2>
          <div className="panel">
            <ul className="notes">
              {notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
