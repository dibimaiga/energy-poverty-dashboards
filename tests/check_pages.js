/*
 * End-to-end check of the published pages, in a real browser.
 *
 * Serves docs/ locally, opens every page on desktop, mobile and in dark mode, and fails if:
 *   - a script throws or a file fails to load;
 *   - a displayed figure or table cell does not match its data file;
 *   - text shows NaN / undefined / Infinity;
 *   - the page scrolls sideways, or a chart label is cut off or overlaps another;
 *   - the scorecard's scores or totals differ from pipeline/score_reference.py.
 *
 * Usage:  npm install && npx playwright install chromium && npm test
 *         npm test -- --screenshots    (also saves screenshots to tests/screenshots/)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const DOCS = path.resolve(__dirname, '..', 'docs');
const EXPECTED = JSON.parse(fs.readFileSync(path.join(__dirname, 'expected_scores.json'), 'utf8'));
const SHOTS = process.argv.includes('--screenshots') ? path.join(__dirname, 'screenshots') : null;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.csv': 'text/csv; charset=utf-8', '.txt': 'text/plain' };

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(DOCS, p);
    if (!file.startsWith(DOCS) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Runs inside the page: compares what is shown with the data the page loaded.
function pageChecks() {
  const report = { marks: 0, cells: 0, problems: [] };
  const root = document.getElementById('dash-root');
  if (!root) return report;
  const add = (p) => { if (report.problems.length < 30) report.problems.push(p); };

  function candidates(text) {
    let t = String(text).replace(/[\s  ]/g, '');
    const neg = /^[-−–]/.test(t);
    t = t.replace(/^[+\-−–]/, '');
    const pct = /%$/.test(t);
    t = t.replace(/%$/, '');
    const out = [];
    for (const [g, d] of [[',', '.'], ['.', ',']]) {
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const m = new RegExp('^(\\d{1,3}(?:' + esc(g) + '\\d{3})+|\\d+)?(?:' + esc(d) + '(\\d+))?$').exec(t);
      if (!m || (!m[1] && !m[2])) continue;
      const v = Number((m[1] || '0').replace(/\D/g, '') + '.' + (m[2] || '0'));
      out.push({ value: neg ? -v : v, step: Math.pow(10, -(m[2] || '').length), pct });
    }
    return out;
  }
  function matches(shown, value) {
    const s = String(shown).replace(/\s+/g, ' ').trim();
    if (value === null || value === undefined || value === '') return s === '—' || s === '';
    const n = typeof value === 'number' ? value : (!Number.isNaN(Number(value)) ? Number(value) : null);
    if (n === null) return s === String(value).trim();
    return candidates(s).some((c) => (c.pct ? [n * 100, n] : [n]).some((x) => {
      const q = Math.abs(x) / c.step, r = Math.round(Math.abs(c.value) / c.step);
      return q >= r - 0.5 - 1e-9 && q < r + 1;
    }));
  }
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  function pick(rows, el) {
    if (el.dataset.row != null) return rows[Number(el.dataset.row)];
    if (el.dataset.where) {
      const conds = el.dataset.where.split('&').map((p) => p.split('=').map(decodeURIComponent));
      return rows.find((r) => conds.every(([k, v]) => String(r[k]) === v));
    }
    return rows.length === 1 ? rows[0] : undefined;
  }

  root.querySelectorAll('[data-source][data-field]').forEach((el) => {
    if (el.closest('table')) return;
    report.marks++;
    const rows = rowsOf(el.dataset.source);
    const row = rows && pick(rows, el);
    if (!row) { add({ problem: 'figure without data', mark: el.outerHTML.slice(0, 140) }); return; }
    if (!matches(el.textContent, row[el.dataset.field])) add({ problem: 'figure differs from data', shown: el.textContent, inData: row[el.dataset.field], mark: el.outerHTML.slice(0, 140) });
  });

  root.querySelectorAll('table[data-source][data-row-key]').forEach((table) => {
    const key = table.dataset.rowKey;
    const ths = [...table.querySelectorAll('thead th')];
    table.querySelectorAll('tbody tr').forEach((tr) => {
      const tds = [...tr.children];
      if (tds.length === 1 && tds[0].colSpan > 1) return;
      const keyVal = tr.dataset.key !== undefined ? tr.dataset.key : tds[ths.findIndex((h) => h.dataset.field === key)].textContent;
      tds.forEach((td, i) => {
        const th = ths[i];
        const rows = rowsOf(th.dataset.source || table.dataset.source);
        const row = rows && rows.find((r) => String(r[key]) === String(keyVal));
        report.cells++;
        if (!row) { add({ problem: 'table row without data', key: keyVal }); return; }
        if (!matches(td.textContent, row[th.dataset.field])) add({ problem: 'cell differs from data', key: keyVal, field: th.dataset.field, shown: td.textContent, inData: row[th.dataset.field] });
      });
    });
  });

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('style,script')) continue;
    if (/NaN|undefined|Infinity|\[object|Invalid Date/.test(node.textContent)) add({ problem: 'bad text', text: node.textContent.trim().slice(0, 80) });
  }
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 1) add({ problem: 'page scrolls sideways', scrollWidth: de.scrollWidth, width: de.clientWidth });
  root.querySelectorAll('[class$="-card"]').forEach((c) => {
    if (c.scrollWidth > c.clientWidth + 1) add({ problem: 'card overflows', card: c.id || c.className });
  });

  root.querySelectorAll('svg').forEach((svg) => {
    const vb = svg.viewBox.baseVal;
    if (!vb || !vb.width) return;
    const labels = [];
    svg.querySelectorAll('text').forEach((t) => {
      const b = t.getBBox();
      if (!b.width) return;
      const m = svg.getCTM().inverse().multiply(t.getCTM());
      const x1 = m.a * b.x + m.e, x2 = m.a * (b.x + b.width) + m.e, y1 = m.d * b.y + m.f, y2 = m.d * (b.y + b.height) + m.f;
      if (x1 < vb.x - 1 || x2 > vb.x + vb.width + 1 || y1 < vb.y - 2 || y2 > vb.y + vb.height + 2) add({ problem: 'label cut off', chart: svg.parentElement.id, text: t.textContent });
      if (!t.closest('.tick')) labels.push({ t: t.textContent, r: t.getBoundingClientRect() });
    });
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
      const a = labels[i].r, b = labels[j].r;
      if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) add({ problem: 'labels overlap', chart: svg.parentElement.id, labels: [labels[i].t, labels[j].t] });
    }
  });
  return report;
}

async function checkScorecard(page, problems) {
  const got = await page.evaluate(() => ({ scores: dash.data('scores').data, totals: dash.data('totals').data[0] }));
  const byIso = Object.fromEntries(got.scores.map((r) => [r.iso3, r]));
  for (const e of EXPECTED.scores) {
    const g = byIso[e.iso3];
    for (const k of Object.keys(e)) {
      if (k === 'iso3') continue;
      const a = e[k], b = g ? g[k] : undefined;
      if ((a === null) !== (b === null || b === undefined) || (a !== null && Math.abs(a - b) > 0.05)) problems.push({ problem: 'score differs from reference', iso3: e.iso3, field: k, page: b, reference: a });
    }
  }
  for (const [k, v] of Object.entries(EXPECTED.totals)) {
    if (Math.abs(got.totals[k] - v) > 0.05) problems.push({ problem: 'total differs from reference', field: k, page: got.totals[k], reference: v });
  }
  // Controls: every lens, a slider, show all, sorting and search must work without errors.
  for (const label of ['People affected', 'Reliability and cost', 'Clean cooking', 'Energy poverty']) {
    await page.click(`#presets button:text-is("${label}")`);
  }
  await page.evaluate(() => { const s = document.getElementById('sl-w_oil'); s.value = '5'; s.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#presets button:text-is("Energy poverty")');
  await page.click('#toggle-all');
  const bars = await page.evaluate(() => document.querySelectorAll('#ch-rank svg > g > g').length);
  if (bars !== EXPECTED.scores.length) problems.push({ problem: '"Show all" does not list every country', bars });
  await page.click('#toggle-all');
  for (const key of ['country', 'access_pct', 'score']) await page.click(`th button[data-sort="${key}"]`);
  await page.fill('#search', 'seneg');
  const found = await page.evaluate(() => [...document.querySelectorAll('#tb tr')].map((tr) => tr.firstChild.textContent));
  if (found.length !== 1 || found[0] !== 'Senegal') problems.push({ problem: 'search does not find Senegal', found });
  await page.fill('#search', '');
}

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const runs = [];
  for (const pagePath of ['', 'senegal/', 'scorecard/']) {
    for (const [width, height, scheme] of [[1280, 900, 'light'], [400, 800, 'light'], [1280, 900, 'dark']]) {
      const context = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
      const page = await context.newPage();
      const problems = [];
      page.on('pageerror', (e) => problems.push({ problem: 'script error', message: e.message }));
      page.on('console', (m) => { if (m.type() === 'error') problems.push({ problem: 'console error', message: m.text() }); });
      page.on('response', (r) => { if (r.status() >= 400) problems.push({ problem: 'file failed to load', url: r.url(), status: r.status() }); });
      await page.goto(base + '/' + pagePath, { waitUntil: 'networkidle' });
      if (pagePath) {
        await page.waitForFunction(() => !document.querySelector('.dash-skeleton'), null, { timeout: 15000 })
          .catch(() => problems.push({ problem: 'page still loading after 15 s' }));
        await page.waitForTimeout(600);
        const r = await page.evaluate(pageChecks);
        problems.push(...r.problems);
        const sources = await page.evaluate(() => [...document.querySelectorAll('#sources a[download]')].map((a) => a.href));
        if (!sources.length) problems.push({ problem: 'sources section missing' });
        for (const href of sources) {
          const res = await page.request.get(href);
          if (!res.ok()) problems.push({ problem: 'data download link broken', href });
        }
        if (pagePath === 'scorecard/' && width === 1280 && scheme === 'light') await checkScorecard(page, problems);
        runs.push({ page: pagePath, width, scheme, figures: r.marks, cells: r.cells, problems });
      } else {
        runs.push({ page: 'index', width, scheme, figures: 0, cells: 0, problems });
      }
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${(pagePath || 'index').replace('/', '')}_${width}_${scheme}.png`), fullPage: true });
      await context.close();
    }
  }
  await browser.close();
  server.close();
  let failed = 0;
  for (const r of runs) {
    const status = r.problems.length ? 'FAIL' : 'ok';
    if (r.problems.length) failed++;
    console.log(`${status.padEnd(4)} ${(r.page || 'index').padEnd(11)} ${String(r.width).padStart(4)}px ${r.scheme.padEnd(5)}  figures checked: ${r.figures}, table cells: ${r.cells}`);
    r.problems.slice(0, 10).forEach((p) => console.log('       ', JSON.stringify(p)));
  }
  console.log(failed ? `\n${failed} run(s) with problems.` : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
