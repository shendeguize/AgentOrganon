import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, readJSON, writeJSON, main, PRODUCTS } from './lib.mjs';

export function validateHistory(history, repository) {
  if (history.schema_version !== 1 || history.repository !== repository || !Array.isArray(history.observations)) throw new Error('Invalid star history identity');
  let previous = '';
  for (const point of history.observations) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(point.observed_at) || Number.isNaN(Date.parse(point.observed_at)) || point.observed_at <= previous || !Number.isSafeInteger(point.total) || point.total < 0) throw new Error('Invalid or unordered star observation');
    previous = point.observed_at;
  }
  return history;
}
export function observe(history, total, now = new Date()) {
  validateHistory(history, history.repository);
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Invalid GitHub star count');
  const timestamp = now.toISOString();
  const last = history.observations.at(-1);
  if (last && timestamp <= last.observed_at) throw new Error('Observation must advance time');
  // At most one actual observation per UTC date; retries cannot rewrite history.
  if (last?.observed_at.slice(0, 10) === timestamp.slice(0, 10)) return history;
  return { ...history, observations: [...history.observations, { observed_at: timestamp, total }] };
}
const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
export function renderSVG(history) {
  validateHistory(history, history.repository);
  const points = history.observations;
  const last = points.at(-1);
  const firstTime = points.length ? Date.parse(points[0].observed_at) : 0;
  const span = last ? Math.max(86400000, Date.parse(last.observed_at) - firstTime) : 86400000;
  const ceiling = Math.max(1, ...points.map(p => p.total));
  const xy = p => [56 + (Date.parse(p.observed_at) - firstTime) / span * 700, 176 - p.total / ceiling * 105];
  const segments = [];
  for (let i = 1; i < points.length; i++) {
    if (Date.parse(points[i].observed_at.slice(0, 10)) - Date.parse(points[i - 1].observed_at.slice(0, 10)) === 86400000) {
      const [a, b] = [xy(points[i - 1]), xy(points[i])];
      segments.push(`<path d="M${a.join(' ')} L${b.join(' ')}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="820" height="240" viewBox="0 0 820 240" role="img" aria-labelledby="title desc"><title id="title">${escape(history.repository)} — observed GitHub stars</title><desc id="desc">Daily observed totals, including decreases. Missing dates are gaps. ${last ? `Last observed ${last.observed_at}: ${last.total}.` : 'No observations yet.'}</desc><rect width="820" height="240" rx="12" fill="#f6f3ec"/><g fill="#242b29" font-family="system-ui,sans-serif"><text x="28" y="34" font-size="17">GitHub stars · ${last ? last.total : 'not yet observed'}</text><text x="28" y="57" font-size="12">${escape(history.repository)}</text><text x="28" y="211" font-size="12">${last ? `Observed since ${points[0].observed_at.slice(0, 10)} · Updated ${last.observed_at}` : 'Collection starts with the first successful observation.'}</text><text x="28" y="230" font-size="11">Daily total / 每日总数 · gaps indicate missing observations / 缺样保留断点</text></g><path d="M56 71V176H756" fill="none" stroke="#c3c8c1"/><g fill="none" stroke="#416954" stroke-width="2">${segments.join('')}</g><g fill="#416954">${points.map(p => { const [x,y]=xy(p); return `<circle cx="${x}" cy="${y}" r="3"><title>${p.observed_at}: ${p.total}</title></circle>`; }).join('')}</g></svg>\n`;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(async () => {
  const args = parseArgs();
  const repository = args.repository;
  if (!Object.values(PRODUCTS).some(p => `shendeguize/${p.repo}` === repository)) throw new Error('Expected one of the three Organon repositories');
  const file = path.resolve(args.history || 'site/public/assets/stars.json');
  let history = fs.existsSync(file) ? validateHistory(readJSON(file), repository) : { schema_version: 1, repository, observations: [] };
  if (!args.render) {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const response = await fetch(`https://api.github.com/repos/${repository}`, { headers });
    if (!response.ok) throw new Error(`GitHub star observation failed: HTTP ${response.status}; previous history preserved`);
    history = observe(history, (await response.json()).stargazers_count);
    writeJSON(file, history);
  }
  const svg = path.resolve(args.svg || path.join(path.dirname(file), 'stars.svg'));
  fs.mkdirSync(path.dirname(svg), { recursive: true });
  fs.writeFileSync(svg, renderSVG(history));
  console.log(JSON.stringify({ status: 'passed', observations: history.observations.length, latest: history.observations.at(-1) || null }));
});
