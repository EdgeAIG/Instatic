/**
 * One-shot generator: turns the multi-agent audit workflow output into
 *   - instatic-audit-report.json   (clean structured report)
 *   - instatic-audit-report.html   (interactive visual dashboard)
 * Run: bun scripts/generate-audit-report.ts <workflow-output-file>
 */

const SEV_ORDER = { critical: 0, high: 1, medium: 2, low: 3 } as const
type Sev = keyof typeof SEV_ORDER

const srcPath = process.argv[2]
if (!srcPath) throw new Error('Usage: bun scripts/generate-audit-report.ts <output-file>')

interface RawFinding {
  title: string
  category: string
  severity: string
  file: string
  lineStart: number
  lineEnd: number
  description: string
  impact: string
  evidence: string
  reproduction: string
  suggestedFix: string
}
interface RawVerdict {
  isReal: boolean
  confidence: string
  severity: string
  replicated: boolean
  replicationSteps: string
  assessment: string
  falsePositiveReason: string
  refinedFix: string
  cwe: string
}
interface RawRecord {
  finder: string
  finding: RawFinding
  verdict: RawVerdict | null
}

const raw = await Bun.file(srcPath).text()
const parsed = JSON.parse(raw) as Record<string, unknown>
const result = (parsed.result ?? parsed) as { findings?: RawRecord[]; finderCount?: number }
const rawFindings: RawRecord[] = result.findings ?? []

const records = rawFindings.map((rec, i) => {
  const f = rec.finding
  const v = rec.verdict ?? null
  const isReal = v ? !!v.isReal : true
  const effectiveSeverity: Sev = (v && isReal ? v.severity : f.severity) as Sev
  return {
    id: `ISS-${String(i + 1).padStart(3, '0')}`,
    finder: rec.finder,
    title: f.title,
    category: f.category,
    provisionalSeverity: f.severity as Sev,
    severity: effectiveSeverity,
    status: v ? (isReal ? 'confirmed' : 'false-positive') : 'unverified',
    confidence: v?.confidence ?? null,
    replicated: v ? !!v.replicated : false,
    cwe: v?.cwe || '',
    file: f.file,
    lineStart: f.lineStart,
    lineEnd: f.lineEnd,
    description: f.description,
    impact: f.impact,
    reproduction: f.reproduction,
    evidence: f.evidence,
    suggestedFix: f.suggestedFix,
    assessment: v?.assessment ?? '',
    replicationSteps: v?.replicationSteps ?? '',
    falsePositiveReason: v?.falsePositiveReason ?? '',
    refinedFix: v?.refinedFix ?? '',
  }
})

// Sort: confirmed before FP, then by severity, then replicated first.
const statusRank = { confirmed: 0, unverified: 1, 'false-positive': 2 } as Record<string, number>
records.sort((a, b) => {
  if (statusRank[a.status] !== statusRank[b.status]) return statusRank[a.status] - statusRank[b.status]
  if (SEV_ORDER[a.severity] !== SEV_ORDER[b.severity]) return SEV_ORDER[a.severity] - SEV_ORDER[b.severity]
  if (a.replicated !== b.replicated) return a.replicated ? -1 : 1
  return a.id.localeCompare(b.id)
})

const confirmed = records.filter((r) => r.status === 'confirmed')
const count = (pred: (r: typeof records[number]) => boolean) => records.filter(pred).length

const stats = {
  total: records.length,
  confirmed: confirmed.length,
  falsePositive: count((r) => r.status === 'false-positive'),
  replicated: count((r) => r.replicated && r.status === 'confirmed'),
  bySeverity: {
    critical: confirmed.filter((r) => r.severity === 'critical').length,
    high: confirmed.filter((r) => r.severity === 'high').length,
    medium: confirmed.filter((r) => r.severity === 'medium').length,
    low: confirmed.filter((r) => r.severity === 'low').length,
  },
  byCategory: Object.fromEntries(
    [...new Set(confirmed.map((r) => r.category))].map((c) => [c, confirmed.filter((r) => r.category === c).length]),
  ),
}

const generatedAt = new Date().toISOString()

const report = {
  meta: {
    project: 'Instatic CMS',
    generatedAt,
    finderAgents: result.finderCount ?? null,
    totalAgents: parsed.agentCount ?? null,
    method: 'Multi-agent deep audit: 26 scoped finder agents (security / bugs / memory-leaks / concurrency / data-integrity), each finding adversarially verified by an independent agent that re-read the code, attempted refutation and end-to-end reproduction, and reassessed severity for a self-hosted single-tenant CMS.',
  },
  stats,
  findings: records,
}

await Bun.write('instatic-audit-report.json', JSON.stringify(report, null, 2))

// ---- HTML ----
const dataJson = JSON.stringify(report).replace(/</g, '\\u003c')

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Instatic CMS — Security &amp; Reliability Audit</title>
<style>
  :root {
    --bg: #0e0f13; --surface: #16181f; --surface-2: #1d2029; --surface-3: #262a36;
    --border: #2c303c; --text: #e6e8ee; --muted: #9aa1b2; --faint: #6b7283;
    --crit: #ff5c6c; --high: #ff9d42; --med: #ffd24a; --low: #66b2ff;
    --ok: #4ad6a0; --fp: #6b7283; --accent: #8b9bff;
    --mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, Consolas, monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font-family: var(--sans); font-size: 14px; line-height: 1.55; }
  a { color: var(--accent); }
  header { padding: 28px 32px 20px; border-bottom: 1px solid var(--border); background: linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%); }
  h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.01em; }
  .sub { color: var(--muted); font-size: 13px; max-width: 980px; }
  .meta-line { color: var(--faint); font-size: 12px; margin-top: 8px; }
  .wrap { max-width: 1180px; margin: 0 auto; padding: 0 24px 80px; }

  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--border); border: 1px solid var(--border); border-radius: 14px; overflow: hidden; margin: 24px 0; }
  .stat { background: var(--surface-2); padding: 16px 18px; }
  .stat .n { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }
  .stat .l { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 2px; }
  .stat.crit .n { color: var(--crit); } .stat.high .n { color: var(--high); }
  .stat.med .n { color: var(--med); } .stat.low .n { color: var(--low); }
  .stat.ok .n { color: var(--ok); }

  .controls { display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; padding: 14px 0 18px; position: sticky; top: 0; background: var(--bg); z-index: 5; border-bottom: 1px solid var(--border); }
  .controls .group { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
  .controls label.gl { color: var(--faint); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; margin-right: 2px; }
  .chip { cursor: pointer; user-select: none; padding: 4px 10px; border-radius: 999px; border: 1px solid var(--border); background: var(--surface-2); color: var(--muted); font-size: 12px; transition: all .12s; }
  .chip[data-on="1"] { color: var(--text); border-color: var(--accent); background: var(--surface-3); }
  .chip.sev-critical[data-on="1"] { border-color: var(--crit); color: var(--crit); }
  .chip.sev-high[data-on="1"] { border-color: var(--high); color: var(--high); }
  .chip.sev-medium[data-on="1"] { border-color: var(--med); color: var(--med); }
  .chip.sev-low[data-on="1"] { border-color: var(--low); color: var(--low); }
  input[type=search] { background: var(--surface-2); border: 1px solid var(--border); color: var(--text); padding: 6px 12px; border-radius: 999px; font-size: 13px; min-width: 240px; font-family: var(--sans); }
  input[type=search]:focus { outline: none; border-color: var(--accent); }
  .count-line { color: var(--muted); font-size: 12px; margin: 14px 2px; }

  .issue { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
  .issue.sev-critical { border-left: 3px solid var(--crit); }
  .issue.sev-high { border-left: 3px solid var(--high); }
  .issue.sev-medium { border-left: 3px solid var(--med); }
  .issue.sev-low { border-left: 3px solid var(--low); }
  .issue.fp { opacity: 0.62; }
  .ihead { display: flex; align-items: flex-start; gap: 12px; padding: 14px 16px; cursor: pointer; }
  .ihead:hover { background: var(--surface-2); }
  .badges { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; flex-shrink: 0; }
  .badge { font-size: 10.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; padding: 3px 7px; border-radius: 5px; white-space: nowrap; }
  .b-critical { background: rgba(255,92,108,.16); color: var(--crit); }
  .b-high { background: rgba(255,157,66,.16); color: var(--high); }
  .b-medium { background: rgba(255,210,74,.15); color: var(--med); }
  .b-low { background: rgba(102,178,255,.16); color: var(--low); }
  .b-cat { background: var(--surface-3); color: var(--muted); }
  .b-rep { background: rgba(74,214,160,.15); color: var(--ok); }
  .b-fp { background: var(--surface-3); color: var(--fp); }
  .b-conf { background: var(--surface-3); color: var(--faint); }
  .ititle { flex: 1; min-width: 0; }
  .ititle .t { font-weight: 600; font-size: 14.5px; }
  .ititle .loc { color: var(--faint); font-size: 12px; font-family: var(--mono); margin-top: 3px; word-break: break-all; }
  .id-tag { color: var(--faint); font-family: var(--mono); font-size: 11px; padding-top: 2px; }
  .caret { color: var(--faint); transition: transform .15s; flex-shrink: 0; padding-top: 2px; }
  .issue.open .caret { transform: rotate(90deg); }

  .ibody { display: none; padding: 4px 16px 18px; border-top: 1px solid var(--border); }
  .issue.open .ibody { display: block; }
  .sec { margin-top: 14px; }
  .sec h4 { margin: 0 0 5px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--faint); }
  .sec p { margin: 0; color: var(--text); white-space: pre-wrap; }
  .sec.fix p { color: #cfe9dd; }
  pre.code { background: var(--bg); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; overflow-x: auto; font-family: var(--mono); font-size: 12.5px; color: #d7dbe6; white-space: pre-wrap; word-break: break-word; margin: 0; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  @media (max-width: 760px) { .grid2 { grid-template-columns: 1fr; } }
  .empty { color: var(--faint); padding: 40px; text-align: center; }
  .footer { color: var(--faint); font-size: 12px; margin-top: 30px; text-align: center; }
</style>
</head>
<body>
<header>
  <h1>Instatic CMS — Security &amp; Reliability Audit</h1>
  <div class="sub" id="method"></div>
  <div class="meta-line" id="metaline"></div>
</header>
<div class="wrap">
  <div class="cards" id="stats"></div>
  <div class="controls" id="controls"></div>
  <div class="count-line" id="countline"></div>
  <div id="list"></div>
  <div class="footer">Generated by a multi-agent audit workflow. Each finding was adversarially verified — but verifier verdicts are AI-generated; confirm critical/high items before acting.</div>
</div>
<script>
const REPORT = ${dataJson};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const SEVS = ['critical','high','medium','low'];
const cats = [...new Set(REPORT.findings.map(f => f.category))].sort();

const state = {
  sev: new Set(SEVS),
  cat: new Set(cats),
  showFP: false,
  onlyReplicated: false,
  q: '',
};

// header
document.getElementById('method').textContent = REPORT.meta.method;
document.getElementById('metaline').textContent =
  REPORT.meta.project + ' · generated ' + REPORT.meta.generatedAt.slice(0,10) +
  ' · ' + (REPORT.meta.finderAgents ?? '?') + ' finder agents · ' + (REPORT.meta.totalAgents ?? '?') + ' total agents';

// stats
const s = REPORT.stats;
const statCards = [
  { l: 'Confirmed', n: s.confirmed, cls: '' },
  { l: 'Critical', n: s.bySeverity.critical, cls: 'crit' },
  { l: 'High', n: s.bySeverity.high, cls: 'high' },
  { l: 'Medium', n: s.bySeverity.medium, cls: 'med' },
  { l: 'Low', n: s.bySeverity.low, cls: 'low' },
  { l: 'Replicated', n: s.replicated, cls: 'ok' },
  { l: 'False positives', n: s.falsePositive, cls: '' },
];
document.getElementById('stats').innerHTML = statCards.map(c =>
  '<div class="stat ' + c.cls + '"><div class="n">' + c.n + '</div><div class="l">' + c.l + '</div></div>').join('');

// controls
const ctl = document.getElementById('controls');
function chip(cls, label, on) { return '<span class="chip ' + cls + '" data-on="' + (on?1:0) + '">' + esc(label) + '</span>'; }
ctl.innerHTML =
  '<div class="group"><label class="gl">Severity</label>' + SEVS.map(v => chip('sev-' + v + ' f-sev', v, true)).join('') + '</div>' +
  '<div class="group"><label class="gl">Category</label>' + cats.map(c => chip('f-cat', c, true)).join('') + '</div>' +
  '<div class="group">' + chip('f-rep', 'replicated only', false) + chip('f-fp', 'show false positives', false) + '</div>' +
  '<div class="group"><input type="search" id="q" placeholder="Search title, file, CWE, text…" /></div>';

ctl.querySelectorAll('.f-sev').forEach(el => el.addEventListener('click', () => {
  const v = el.textContent; const on = el.dataset.on === '1';
  el.dataset.on = on ? '0' : '1'; on ? state.sev.delete(v) : state.sev.add(v); render();
}));
ctl.querySelectorAll('.f-cat').forEach(el => el.addEventListener('click', () => {
  const v = el.textContent; const on = el.dataset.on === '1';
  el.dataset.on = on ? '0' : '1'; on ? state.cat.delete(v) : state.cat.add(v); render();
}));
const repChip = ctl.querySelector('.f-rep');
repChip.addEventListener('click', () => { state.onlyReplicated = !state.onlyReplicated; repChip.dataset.on = state.onlyReplicated?1:0; render(); });
const fpChip = ctl.querySelector('.f-fp');
fpChip.addEventListener('click', () => { state.showFP = !state.showFP; fpChip.dataset.on = state.showFP?1:0; render(); });
document.getElementById('q').addEventListener('input', (e) => { state.q = e.target.value.toLowerCase(); render(); });

function matches(f) {
  if (!state.sev.has(f.severity)) return false;
  if (!state.cat.has(f.category)) return false;
  if (f.status === 'false-positive' && !state.showFP) return false;
  if (state.onlyReplicated && !f.replicated) return false;
  if (state.q) {
    const hay = (f.title + ' ' + f.file + ' ' + f.cwe + ' ' + f.description + ' ' + f.impact + ' ' + f.id + ' ' + f.finder).toLowerCase();
    if (!hay.includes(state.q)) return false;
  }
  return true;
}

function section(title, body, cls) {
  if (!body) return '';
  return '<div class="sec ' + (cls||'') + '"><h4>' + title + '</h4><p>' + esc(body) + '</p></div>';
}

function card(f) {
  const fpCls = f.status === 'false-positive' ? ' fp' : '';
  const sevBadge = '<span class="badge b-' + f.severity + '">' + f.severity + '</span>';
  const catBadge = '<span class="badge b-cat">' + esc(f.category) + '</span>';
  const repBadge = f.replicated ? '<span class="badge b-rep">replicated</span>' : '';
  const fpBadge = f.status === 'false-positive' ? '<span class="badge b-fp">false positive</span>' : '';
  const confBadge = f.confidence ? '<span class="badge b-conf">' + f.confidence + ' conf</span>' : '';
  const cweBadge = f.cwe ? '<span class="badge b-conf">' + esc(f.cwe.split(' ')[0]) + '</span>' : '';
  const sevNote = f.status === 'confirmed' && f.severity !== f.provisionalSeverity
    ? ' <span style="color:var(--faint)">(was ' + f.provisionalSeverity + ')</span>' : '';

  const body =
    section('Description', f.description) +
    section('Impact', f.impact) +
    '<div class="grid2">' +
      section('Reproduction (claimed)', f.reproduction) +
      section('Verifier — replication', f.replicationSteps) +
    '</div>' +
    section('Verifier assessment', f.assessment) +
    (f.falsePositiveReason ? section('Why false positive', f.falsePositiveReason) : '') +
    section('Suggested fix', f.suggestedFix, 'fix') +
    (f.refinedFix && f.refinedFix !== f.suggestedFix ? section('Refined fix (verifier)', f.refinedFix, 'fix') : '') +
    (f.evidence ? '<div class="sec"><h4>Evidence</h4><pre class="code">' + esc(f.evidence) + '</pre></div>' : '');

  return '<div class="issue sev-' + f.severity + fpCls + '" data-id="' + f.id + '">' +
    '<div class="ihead">' +
      '<span class="id-tag">' + f.id + '</span>' +
      '<div class="badges">' + sevBadge + catBadge + repBadge + confBadge + cweBadge + fpBadge + '</div>' +
      '<div class="ititle"><div class="t">' + esc(f.title) + sevNote + '</div>' +
        '<div class="loc">' + esc(f.file) + ':' + f.lineStart + (f.lineEnd && f.lineEnd!==f.lineStart ? '-' + f.lineEnd : '') +
        '  ·  ' + esc(f.finder) + '</div></div>' +
      '<span class="caret">▶</span>' +
    '</div>' +
    '<div class="ibody">' + body + '</div>' +
  '</div>';
}

function render() {
  const shown = REPORT.findings.filter(matches);
  const list = document.getElementById('list');
  list.innerHTML = shown.length ? shown.map(card).join('') : '<div class="empty">No findings match the current filters.</div>';
  document.getElementById('countline').textContent = 'Showing ' + shown.length + ' of ' + REPORT.findings.length + ' findings';
  list.querySelectorAll('.ihead').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
}
render();
</script>
</body>
</html>`

await Bun.write('instatic-audit-report.html', html)

console.log('Findings:', records.length, '| confirmed:', stats.confirmed, '| FP:', stats.falsePositive)
console.log('By severity (confirmed):', JSON.stringify(stats.bySeverity))
console.log('By category (confirmed):', JSON.stringify(stats.byCategory))
console.log('Wrote instatic-audit-report.json and instatic-audit-report.html')
