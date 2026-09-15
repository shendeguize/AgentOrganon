import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs, readJSON, writeJSON, main } from './lib.mjs';

export function checkContent(repo) {
  repo = path.resolve(repo);
  const names = execFileSync('git', ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0');
  const errors = []; let checked = 0;
  for (const relative of new Set(names)) {
    if (!relative.endsWith('.md') || /(^|\/)(\.local|node_modules|dist|site|snapshots|reviews)(\/|$)/.test(relative)) continue;
    const file = path.join(repo, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const actual = fs.realpathSync(file);
    // Quoted source/code examples are data, not executable repository navigation.
    const text = fs.readFileSync(actual, 'utf8').replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '');
    checked++;
    for (const match of text.matchAll(/!?\[[^\]\n]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const link = match[1] || match[2];
      if (/^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(link)) continue;
      const pathname = decodeURIComponent(link.split('#')[0].split('?')[0]);
      if (!pathname || pathname.startsWith('/')) continue;
      if (!fs.existsSync(path.resolve(path.dirname(actual), pathname))) errors.push(`${relative}: missing ${link}`);
    }
  }
  for (const relative of ['docs/rationale.md', 'zh/docs/rationale.md', 'zh/rationale.md', 'docs/self-iteration.md', 'zh/docs/self-iteration.md']) {
    if (fs.existsSync(path.join(repo, relative))) errors.push(`Retired document entry remains: ${relative}`);
  }
  const philosophies = ['PHILOSOPHY.md', 'SoftwareEngineering/PHILOSOPHY.md'];
  for (const relative of philosophies) {
    const en = path.join(repo, relative); if (!fs.existsSync(en) || fs.lstatSync(en).isSymbolicLink()) continue;
    const zh = path.join(path.dirname(en), 'zh/PHILOSOPHY.md');
    if (!fs.existsSync(zh)) { errors.push(`${relative}: missing Chinese counterpart`); continue; }
    const ids = file => [...fs.readFileSync(file, 'utf8').matchAll(/<!-- organon:id ([^ ]+) -->/g)].map(m => m[1]);
    if (JSON.stringify(ids(en)) !== JSON.stringify(ids(zh))) errors.push(`${relative}: EN/ZH stable IDs differ`);
  }
  return { status: errors.length ? 'failed' : 'passed', checked, errors };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(() => {
  const args = parseArgs(); const result = checkContent(args.repo || '.');
  if (args.manifest) { result.source_digest = readJSON(args.manifest).source_digest; result.gate = 'content'; result.product = args.product; }
  if (args.out) writeJSON(args.out, result);
  console.log(JSON.stringify(result, null, 2)); if (result.status !== 'passed') process.exitCode = 1;
});
