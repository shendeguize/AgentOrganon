import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createTarball } from '../../installer/lib/archive.mjs';
import { PRODUCTS, EXACT_VERSION, verifyPackage } from '../../installer/lib/package.mjs';
import { exists, write, serialize, sha256, listFiles } from '../../installer/lib/files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const excluded = /(?:^|\/)(?:lean|docs|tests?|examples|\.local|node_modules|site|\.git)(?:\/|$)|organon(?:-core)?-lean/;
const repositories = [
  { root: path.join(ROOT, 'OrganonCore'), name: 'OrganonCore' },
  { root: path.join(ROOT, 'AdvisedOrganons'), name: 'AdvisedOrganons' },
  { root: ROOT, name: 'AgentOrganon' },
];
function repositoryOf(file) { return repositories.find(repo => file === repo.root || file.startsWith(`${repo.root}${path.sep}`)); }
function revision(repo) { return execFileSync('git', ['-C', repo.root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }

export function buildPackage({ product, out, version = VERSION }) {
  if (!Object.hasOwn(PRODUCTS, product) || !EXACT_VERSION.test(version)) throw new Error('Provide --product agent-organon|core|advised and an exact release version');
  if (!out) throw new Error('--out is required');
  out = path.resolve(out); fs.mkdirSync(out, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-build-'));
  const staging = path.join(temporary, 'package'); fs.mkdirSync(staging);
  const sourceMap = new Map();
  const provenance = new Map();
  const snapshots = new Map(repositories.map(repo => [repo.name, revision(repo)]));
  function add(source, target) {
    if (!exists(source)) throw new Error(`Required release source is missing: ${source}`);
    const real = fs.realpathSync(source);
    if (fs.statSync(real).isDirectory()) {
      for (const entry of fs.readdirSync(real).sort()) {
        const next = `${target}/${entry}`;
        if (!excluded.test(next)) add(path.join(real, entry), next);
      }
      return;
    }
    if (!fs.statSync(real).isFile()) throw new Error('Release source is not a regular file');
    sourceMap.set(target, { source, real });
  }
  try {
    // Explicit roots only: no directory-wide repository copies or npm prepare hooks.
    for (const file of ['LICENSE', 'AGENTS.md', 'PHILOSOPHY.md']) add(path.join(ROOT, file), `payload/${file}`);
    for (const file of ['init.js', 'check.js', 'resolve.js', 'export.js', 'classify.js', 'apply.js']) add(path.join(ROOT, 'scripts', file), `payload/scripts/${file}`);
    add(path.join(ROOT, 'scripts/lib'), 'payload/scripts/lib');
    add(path.join(ROOT, 'skills'), 'payload/skills');
    for (const file of ['LICENSE', 'AGENTS.md', 'PHILOSOPHY.md', 'zh/PHILOSOPHY.md', 'zh/AGENTS.md']) add(path.join(ROOT, 'OrganonCore', file), `payload/OrganonCore/${file}`);
    add(path.join(ROOT, 'OrganonCore/skills'), 'payload/OrganonCore/skills');
    add(path.join(ROOT, 'OrganonCore/scripts/lib'), 'payload/OrganonCore/scripts/lib');
    // The migration is a release prerequisite; never silently package the old docs path.
    add(path.join(ROOT, 'OrganonCore/rationale'), 'payload/OrganonCore/rationale');
    if (exists(path.join(ROOT, 'OrganonCore/zh/rationale'))) add(path.join(ROOT, 'OrganonCore/zh/rationale'), 'payload/OrganonCore/zh/rationale');
    if (product === 'advised') {
      for (const file of ['PHILOSOPHY.md', 'AGENTS.md', 'zh/PHILOSOPHY.md']) add(path.join(ROOT, 'AdvisedOrganons/SoftwareEngineering', file), `payload/AdvisedOrganons/SoftwareEngineering/${file}`);
      add(path.join(ROOT, 'AdvisedOrganons/SoftwareEngineering/rationale'), 'payload/AdvisedOrganons/SoftwareEngineering/rationale');
      if (exists(path.join(ROOT, 'AdvisedOrganons/SoftwareEngineering/zh/rationale'))) add(path.join(ROOT, 'AdvisedOrganons/SoftwareEngineering/zh/rationale'), 'payload/AdvisedOrganons/SoftwareEngineering/zh/rationale');
      add(path.join(ROOT, 'AdvisedOrganons/skills'), 'payload/AdvisedOrganons/skills');
      add(path.join(ROOT, 'AdvisedOrganons/LICENSE'), 'payload/AdvisedOrganons/LICENSE');
    }
    add(path.join(ROOT, 'installer'), 'installer');
    const destinationByReal = new Map();
    for (const [target, entry] of sourceMap) {
      // Prefer the canonical Core copy over the materialized outer mirror.
      if (!destinationByReal.has(entry.real) || target.startsWith('payload/OrganonCore/')) destinationByReal.set(entry.real, target);
    }
    const omittedLinks = [];
    for (const [target, { source, real }] of sourceMap) {
      const raw = fs.readFileSync(real);
      let bytes = raw;
      const transformations = [];
      if (target.endsWith('.md')) {
        const converted = raw.toString('utf8').replace(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g, (whole, href) => {
          if (/^(?:[a-z]+:|#|\/)/i.test(href)) return whole;
          const [relative, fragment] = href.split('#');
          const resolved = path.resolve(path.dirname(real), decodeURIComponent(relative));
          const mapped = destinationByReal.get(exists(resolved) ? fs.realpathSync(resolved) : resolved);
          if (mapped) {
            const link = path.relative(path.dirname(target), mapped).split(path.sep).join('/');
            return `](${link}${fragment ? `#${fragment}` : ''})`;
          }
          if (/\.local(?:\/|$)/.test(relative)) return whole;
          const repo = repositoryOf(resolved);
          if (!repo) return whole;
          const relativeSource = path.relative(repo.root, resolved).split(path.sep).map(encodeURIComponent).join('/');
          const url = `https://github.com/shendeguize/${repo.name}/blob/${snapshots.get(repo.name)}/${relativeSource}${fragment ? `#${fragment}` : ''}`;
          omittedLinks.push({ file: target, source: href, destination: url });
          return `](${url})`;
        });
        bytes = Buffer.from(converted);
        if (!bytes.equals(raw)) transformations.push('rebase-reference-links');
      }
      if (source !== real) transformations.push('materialize-symbolic-link');
      write(path.join(staging, target), bytes);
      const repo = repositoryOf(real);
      provenance.set(target, { repository: repo.name, path: path.relative(repo.root, real).split(path.sep).join('/'), revision: snapshots.get(repo.name), sourceSha256: sha256(raw), transformations });
    }
    const metadata = { name: PRODUCTS[product], version, description: 'Organon philosophy and non-Lean agent skills', type: 'module', license: 'MIT', engines: { node: '>=22' }, ...(product === 'agent-organon' ? { bin: { organon: 'installer/organon.mjs' } } : {}), repository: { type: 'git', url: `git+https://github.com/shendeguize/${product === 'core' ? 'OrganonCore' : product === 'advised' ? 'AdvisedOrganons' : 'AgentOrganon'}.git` } };
    write(path.join(staging, 'package.json'), serialize(metadata));
    write(path.join(staging, 'payload/package.json'), serialize({ type: 'module', organon: { coreVersion: '>=0.1.0 <0.2.0' } }));
    write(path.join(staging, 'LICENSE'), fs.readFileSync(path.join(ROOT, 'LICENSE')));
    write(path.join(staging, 'README.md'), `# ${PRODUCTS[product]}\n\nProduct ${version}. Includes philosophy, non-Lean skills and the shared offline installer.\n\n\`node installer/organon.mjs install --product ${product} --agent codex --scope project --project /path/to/project --from .${product === 'advised' ? ' --domain SoftwareEngineering' : ''}\`\n\nInstallation does not adopt a philosophy. Use \`init\` to preview an explicit project adoption; \`--apply --plan-sha256 HASH\` executes the plan identified by the preview's \`planSha256\`. Lean and website documentation are not installed.\n`);
    const prefix = product === 'core' ? 'payload/OrganonCore/skills/' : product === 'advised' ? 'payload/AdvisedOrganons/skills/' : 'payload/skills/';
    const skills = listFiles(staging).filter(file => file.startsWith(prefix) && file.endsWith('/SKILL.md')).map(file => ({ name: fs.readFileSync(path.join(staging, file), 'utf8').match(/^name:\s*(.+)$/m)[1].trim(), path: file }));
    const files = listFiles(staging).map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(staging, file))), ...(provenance.has(file) ? { source: provenance.get(file) } : { generated: true }) }));
    const manifest = { schema: 1, product, version, installerVersion: version, nonLean: true, snapshots: Object.fromEntries(snapshots), skills, files, omittedLinks };
    write(path.join(staging, 'organon-content.json'), serialize(manifest));
    verifyPackage(staging);
    const tarball = path.join(out, `${PRODUCTS[product].replace('@', '').replace('/', '-')}-${version}.tgz`);
    createTarball(staging, tarball);
    const result = { product, version, tarball, sha256: sha256(fs.readFileSync(tarball)), manifestHash: sha256(fs.readFileSync(path.join(staging, 'organon-content.json'))), files: files.length, skills: skills.map(skill => skill.name) };
    write(`${tarball}.json`, serialize(result));
    return result;
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).reduce((rows, value, index, all) => index % 2 ? rows : [...rows, [value.replace(/^--/, ''), all[index + 1]]], []));
    console.log(serialize(buildPackage(args)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
