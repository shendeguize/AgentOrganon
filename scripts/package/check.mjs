import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { extractTarball } from '../../installer/lib/archive.mjs';
import { verifyPackage } from '../../installer/lib/package.mjs';
import { exists, listFiles } from '../../installer/lib/files.mjs';

export function checkPackage(file) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-check-package-'));
  try {
    const root = fs.statSync(file).isDirectory() ? file : extractTarball(file, temporary);
    const manifest = verifyPackage(root);
    if (!manifest.snapshots || Object.keys(manifest.snapshots).sort().join(',') !== ['AdvisedOrganons', 'AgentOrganon', 'OrganonCore'].sort().join(',') || Object.values(manifest.snapshots).some(value => !/^[a-f0-9]{40}$/.test(value))) throw new Error('Package source snapshots must identify all three repositories');
    for (const file of manifest.files) {
      if (file.source && (!Object.hasOwn(manifest.snapshots, file.source.repository) || file.source.revision !== manifest.snapshots[file.source.repository] || !/^[a-f0-9]{64}$/.test(file.source.sourceSha256 || ''))) throw new Error('Package file provenance differs from its source snapshot');
    }
    const forbidden = manifest.files.filter(entry => /(?:^|\/)(?:lean|docs|tests?|examples|\.local|node_modules|site|\.git)(?:\/|$)|organon(?:-core)?-lean/.test(entry.path));
    if (forbidden.length) throw new Error(`Forbidden release content: ${forbidden.map(entry => entry.path).join(', ')}`);
    const missing = [];
    for (const name of listFiles(path.join(root, 'payload'))) {
      const full = path.join(root, 'payload', name);
      const text = fs.readFileSync(full, 'utf8');
      if (/\.(?:js|mjs)$/.test(name)) {
        for (const match of text.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) {
          if (!exists(path.resolve(path.dirname(full), match[1]))) missing.push(`${name}: ${match[1]}`);
        }
      }
      if (name.endsWith('.md')) {
        for (const match of text.matchAll(/\]\(([^\s)]+)\)/g)) {
          const href = match[1].split('#')[0];
          if (!href || /^(?:[a-z]+:|\/)/i.test(href) || href.includes('.local/')) continue;
          if (!exists(path.resolve(path.dirname(full), decodeURIComponent(href)))) missing.push(`${name}: ${href}`);
        }
      }
    }
    if (missing.length) throw new Error(`Package closure is incomplete:\n${missing.join('\n')}`);
    return { passed: true, product: manifest.product, version: manifest.version, files: manifest.files.length, skills: manifest.skills.length, manifestHash: manifest.manifestHash, snapshots: manifest.snapshots };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const index = process.argv.indexOf('--package');
    if (index < 0 || !process.argv[index + 1]) throw new Error('--package TGZ_OR_DIRECTORY is required');
    console.log(JSON.stringify(checkPackage(path.resolve(process.argv[index + 1])), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
