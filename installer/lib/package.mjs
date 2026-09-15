import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { extractTarball } from './archive.mjs';
import { json, sha256, listFiles, safeRelative } from './files.mjs';

export const PRODUCTS = { 'agent-organon': '@shendeguize/agent-organon', core: '@shendeguize/organon-core', advised: '@shendeguize/advised-organons' };
export const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-rc\.\d+)?$/;
export function verifyPackage(directory) {
  if (!fs.lstatSync(directory).isDirectory()) throw new Error('Package root must be a regular directory');
  const manifest = json(path.join(directory, 'organon-content.json'));
  const metadata = json(path.join(directory, 'package.json'));
  if (manifest.schema !== 1 || !Object.hasOwn(PRODUCTS, manifest.product) || manifest.nonLean !== true || metadata.name !== PRODUCTS[manifest.product] || metadata.version !== manifest.version || !EXACT_VERSION.test(manifest.version)) throw new Error('Invalid package identity');
  if (!Array.isArray(manifest.files) || !Array.isArray(manifest.skills) || !manifest.files.length || !manifest.skills.length) throw new Error('Invalid content manifest');
  const names = new Set();
  for (const entry of manifest.files) {
    safeRelative(entry.path);
    if (names.has(entry.path) || entry.path === 'organon-content.json' || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error('Invalid manifest entry');
    names.add(entry.path);
    const file = path.join(directory, entry.path);
    if (!fs.lstatSync(file).isFile() || sha256(fs.readFileSync(file)) !== entry.sha256) throw new Error(`Content integrity mismatch: ${entry.path}`);
  }
  const actual = listFiles(directory).filter(file => file !== 'organon-content.json');
  if (actual.length !== names.size || actual.some(name => !names.has(name))) throw new Error('Unlisted content in package');
  const skillNames = new Set();
  for (const skill of manifest.skills) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skill.name) || skillNames.has(skill.name) || !skill.path.startsWith('payload/') || !names.has(safeRelative(skill.path))) throw new Error('Invalid skill discovery metadata');
    skillNames.add(skill.name);
    if (!fs.readFileSync(path.join(directory, skill.path), 'utf8').includes(`name: ${skill.name}\n`)) throw new Error('Skill name differs from discovery metadata');
  }
  if (metadata.scripts || metadata.dependencies || (manifest.product !== 'agent-organon' && metadata.bin)) throw new Error('Package must have no lifecycle scripts, runtime dependencies or conflicting bin');
  if (manifest.product === 'agent-organon' && (Object.keys(metadata.bin ?? {}).join(',') !== 'organon' || metadata.bin.organon !== 'installer/organon.mjs')) throw new Error('Invalid organon executable entrypoint');
  return { ...manifest, manifestHash: sha256(fs.readFileSync(path.join(directory, 'organon-content.json'))) };
}
export async function openPackage({ from, product, version, bundled }) {
  let temporary;
  try {
    if (!from && bundled) {
      const local = verifyPackage(bundled);
      if (local.product === product && (!version || version === local.version)) return { directory: bundled, manifest: local, close() {} };
    }
    if (!from) {
      if (!EXACT_VERSION.test(version ?? '')) throw new Error('Registry installation requires an exact --version; use --from for offline installation');
      temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'organon-download-'));
      const metadataResponse = await fetch(`https://registry.npmjs.org/${encodeURIComponent(PRODUCTS[product])}/${version}`, { signal: AbortSignal.timeout(30000) });
      if (!metadataResponse.ok) throw new Error(`Registry request failed: ${metadataResponse.status}`);
      const metadata = await metadataResponse.json();
      const url = new URL(metadata.dist?.tarball);
      if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org') throw new Error('Unexpected registry tarball origin');
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Download failed: ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 16 * 1024 * 1024) throw new Error('Package exceeds download limit');
      const { createHash } = await import('node:crypto');
      if (metadata.dist.integrity !== `sha512-${createHash('sha512').update(bytes).digest('base64')}`) throw new Error('Registry integrity mismatch');
      from = path.join(temporary, 'download.tgz'); fs.writeFileSync(from, bytes);
    }
    from = path.resolve(from);
    let directory = fs.realpathSync(from);
    if (!fs.statSync(from).isDirectory()) {
      temporary ??= fs.mkdtempSync(path.join(os.tmpdir(), 'organon-extract-'));
      directory = extractTarball(from, temporary);
    }
    const manifest = verifyPackage(directory);
    if (manifest.product !== product || (version && manifest.version !== version)) throw new Error('Package does not match requested product/version');
    return { directory, manifest, close() { if (temporary) fs.rmSync(temporary, { recursive: true, force: true }); } };
  } catch (error) {
    if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}
