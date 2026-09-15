import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { PRODUCTS, digest, parseArgs, requireValue, readJSON, main } from './lib.mjs';
import { assertManifest } from './manifest.mjs';

const SHA = /^[a-f0-9]{40}$/;
const HASH = /^[a-f0-9]{64}$/;
const REPOSITORIES = new Set(Object.values(PRODUCTS).map(product => `shendeguize/${product.repo}`));
const INTERNAL_PACKAGES = new Set([...Object.values(PRODUCTS).map(product => product.package), '@shendeguize/organon-site-tools']);
const gitBlobHash = bytes => crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const utf8 = bytes => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (text.includes('\0')) throw new Error('Binary content cannot receive a release text transformation');
  return text;
};
function insist(condition, message) { if (!condition) throw new Error(message); }
function checkedRepository(repository) { insist(REPOSITORIES.has(repository), 'Unexpected source repository'); return repository; }
function checkedSHA(sha) { insist(SHA.test(sha), 'Expected an immutable Git object SHA'); return sha; }
async function responseBytes(response, limit) {
  insist(response.ok, `Immutable release source unavailable: HTTP ${response.status}`);
  const parts = []; let size = 0;
  for await (const part of response.body) {
    size += part.length; insist(size <= limit, 'Immutable release source exceeds read limit'); parts.push(part);
  }
  return Buffer.concat(parts);
}

/** Read-only transport. The test backend supplies the same object-shaped methods. */
export function githubBackend({ token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN } = {}) {
  const request = async (repository, suffix) => {
    const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`https://api.github.com/repos/${checkedRepository(repository)}/${suffix}`, { headers, signal: AbortSignal.timeout(30000) });
    return JSON.parse((await responseBytes(response, 32 * 1024 * 1024)).toString('utf8'));
  };
  return {
    async rcManifest(version) {
      insist(/^1\.0\.0-rc\.[1-9]\d*$/.test(version), 'Expected an exact RC version');
      const response = await fetch(`https://github.com/shendeguize/AgentOrganon/releases/download/v${version}/release-manifest.json`, { signal: AbortSignal.timeout(30000) });
      return JSON.parse((await responseBytes(response, 4 * 1024 * 1024)).toString('utf8'));
    },
    commit: (repository, sha) => request(repository, `git/commits/${checkedSHA(sha)}`),
    tree: (repository, sha) => request(repository, `git/trees/${checkedSHA(sha)}?recursive=1`),
    async blob(repository, sha) {
      const response = await request(repository, `git/blobs/${checkedSHA(sha)}`);
      insist(response.sha === sha && response.encoding === 'base64', 'GitHub returned an unrelated blob');
      const bytes = Buffer.from(response.content, 'base64');
      insist(response.size === bytes.length, 'GitHub blob size mismatch');
      return bytes;
    },
  };
}

function treeEntries(tree, sha) {
  insist(tree.sha === sha && tree.truncated === false && Array.isArray(tree.tree), 'Incomplete or unrelated Git tree');
  const result = new Map();
  for (const entry of tree.tree) {
    insist(typeof entry.path === 'string' && entry.path && !entry.path.includes('\\') && !entry.path.split('/').some(part => !part || part === '.' || part === '..') && SHA.test(entry.sha), 'Invalid Git tree entry');
    insist(!result.has(entry.path), 'Duplicate Git tree entry');
    const types = { '040000': 'tree', '100644': 'blob', '100755': 'blob', '120000': 'blob', '160000': 'commit' };
    insist(types[entry.mode] === entry.type, 'Unsupported Git tree mode/type');
    result.set(entry.path, entry);
  }
  return result;
}
const protectedPath = file => /(?:^|\/)(?:PHILOSOPHY(?:\.lock)?\.json|PHILOSOPHY\.md|lean(?:\/|\.|$)|rationale(?:\/|\.|$)|philosophy(?:\/|\.|$))/i.test(file);
function replaceVersion(text, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(?<![0-9.])${escaped}(?![0-9A-Za-z-])`, 'g'), '1.0.0');
}
function dependencyVersions(object, rcVersion) {
  for (const group of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const name of INTERNAL_PACKAGES) if (object[group]?.[name] === rcVersion) object[group][name] = '1.0.0';
  }
}
function versionJSON(file, before, after, rcVersion, product) {
  if (!['package.json', 'package-lock.json', 'site/site.json', ...(product === 'core' ? ['tools/site/package.json', 'tools/site/package-lock.json'] : [])].includes(file)) return false;
  const old = JSON.parse(before); const next = JSON.parse(after); const expected = structuredClone(old);
  if (file === 'package.json' || (product === 'core' && file === 'tools/site/package.json')) {
    insist(INTERNAL_PACKAGES.has(old.name), 'Unknown package metadata cannot change');
    if (expected.version === rcVersion) expected.version = '1.0.0';
    dependencyVersions(expected, rcVersion);
  } else if (file === 'package-lock.json' || (product === 'core' && file === 'tools/site/package-lock.json')) {
    if (expected.version === rcVersion) expected.version = '1.0.0';
    if (expected.packages?.['']) {
      if (expected.packages[''].version === rcVersion) expected.packages[''].version = '1.0.0';
      dependencyVersions(expected.packages[''], rcVersion);
    }
    for (const name of INTERNAL_PACKAGES) {
      for (const item of [expected.packages?.[`node_modules/${name}`], expected.dependencies?.[name]].filter(Boolean)) {
        if (item.version === rcVersion) item.version = '1.0.0';
        dependencyVersions(item, rcVersion);
        if (typeof item.resolved === 'string' && item.resolved.startsWith(`https://registry.npmjs.org/${name}/-/`)) item.resolved = replaceVersion(item.resolved, rcVersion);
      }
    }
  } else if (file === 'site/site.json') {
    insist(old.product === product, 'Site configuration belongs to a different product');
    for (const key of ['version', 'themeVersion']) if (expected[key] === rcVersion) expected[key] = '1.0.0';
  } else return false;
  insist(digest(expected) === digest(next) && replaceVersion(before, rcVersion) === after, `Unapproved metadata difference: ${file}`);
  return true;
}
function toolingJSON(before, after, rc, stable, product) {
  const old = JSON.parse(before); const next = JSON.parse(after); const expected = structuredClone(old);
  const roles = product === 'core' ? { workspace: 'agent-organon' } : product === 'advised' ? { workspace: 'agent-organon', core: 'core' } : {};
  insist(Object.keys(old).sort().join(',') === ['schema_version', ...Object.keys(roles)].sort().join(',') && old.schema_version === 1, 'Unexpected tooling fields');
  let transformed = before;
  for (const [role, peer] of Object.entries(roles)) {
    const original = old[role]; const updated = next[role];
    insist(original && Object.keys(original).sort().join(',') === 'commit,repository' && original.repository === rc.sources[peer].repository && SHA.test(original.commit), 'Invalid original tooling identity');
    insist(updated && updated.repository === original.repository, 'Tooling repository cannot change');
    if (updated.commit !== original.commit) {
      insist(original.commit === rc.sources[peer].commit && updated.commit === stable.sources[peer].commit, 'Tooling pin is not the exact RC-to-stable peer transition');
      expected[role].commit = updated.commit;
      transformed = transformed.replaceAll(original.commit, updated.commit);
    }
  }
  insist(digest(expected) === digest(next) && transformed === after, 'Unapproved tooling difference');
}
function permittedBlob(file, before, after, rc, stable, product) {
  insist(!protectedPath(file), `Philosophy, rationale and Lean must remain byte-identical: ${file}`);
  if (file === 'release/tooling.json') { toolingJSON(before, after, rc, stable, product); return 'fixed-tooling-peer-reference'; }
  if (versionJSON(file, before, after, rc.version, product)) return 'product-version-metadata';
  if (['README.md', 'zh/README.md', 'docs/getting-started.md', 'zh/docs/getting-started.md'].includes(file) || /^site\/(?:[^/]+\/)*[^/]+\.md$/.test(file)) {
    insist(replaceVersion(before, rc.version) === after, `Only exact product version tokens may change: ${file}`);
    return 'product-version-reading-text';
  }
  throw new Error(`Unapproved source change: ${file}`);
}

/**
 * Validate an approved RC's immutable source transition. Artifact and fresh
 * execution gates remain the caller's responsibility. approvalDigest comes from
 * a separately configured approval environment, never from a dispatch field.
 */
export async function validateStable(manifest, root, { backend = githubBackend(), approvalDigest = process.env.APPROVED_RC_MANIFEST_SHA256 } = {}) {
  assertManifest(manifest, { publish: true });
  insist(manifest.version === '1.0.0' && manifest.channel === 'stable', 'Stable transition requires product version 1.0.0');
  insist(HASH.test(approvalDigest ?? '') && approvalDigest === manifest.approved_rc.manifest_sha256, 'Missing or mismatched separately configured RC approval');
  const rc = await backend.rcManifest(manifest.approved_rc.version);
  assertManifest(rc, { publish: true });
  insist(rc.channel === 'rc' && rc.version === manifest.approved_rc.version && digest(rc) === approvalDigest, 'Public RC manifest is not the exact approved object');
  const changes = []; const repositories = {};
  for (const [product, spec] of Object.entries(PRODUCTS)) {
    const repository = `shendeguize/${spec.repo}`;
    const oldCommit = rc.sources[product].commit; const newCommit = manifest.sources[product].commit;
    const [oldObject, newObject] = await Promise.all([backend.commit(repository, oldCommit), backend.commit(repository, newCommit)]);
    insist(oldObject.sha === oldCommit && newObject.sha === newCommit && SHA.test(oldObject.tree?.sha) && SHA.test(newObject.tree?.sha), 'GitHub commit identity mismatch');
    const [oldTree, newTree] = await Promise.all([backend.tree(repository, oldObject.tree.sha), backend.tree(repository, newObject.tree.sha)]);
    const oldEntries = treeEntries(oldTree, oldObject.tree.sha); const newEntries = treeEntries(newTree, newObject.tree.sha);
    insist([...oldEntries.keys()].sort().join('\0') === [...newEntries.keys()].sort().join('\0'), `Stable transition adds or deletes source paths: ${product}`);
    const blobs = new Map();
    const read = async entry => {
      if (!blobs.has(entry.sha)) {
        const bytes = Buffer.from(await backend.blob(repository, entry.sha));
        insist(gitBlobHash(bytes) === entry.sha, 'Git blob does not match its immutable identity');
        blobs.set(entry.sha, bytes);
      }
      return blobs.get(entry.sha);
    };
    const oldPackage = oldEntries.get('package.json'); const newPackage = newEntries.get('package.json');
    insist(oldPackage?.type === 'blob' && newPackage?.type === 'blob', 'Product package metadata is missing');
    const oldMetadata = JSON.parse(utf8(await read(oldPackage))); const newMetadata = JSON.parse(utf8(await read(newPackage)));
    insist(oldMetadata.name === spec.package && newMetadata.name === spec.package && oldMetadata.version === rc.version && newMetadata.version === '1.0.0', `Product metadata does not implement the approved version transition: ${product}`);
    for (const [file, oldEntry] of oldEntries) {
      const newEntry = newEntries.get(file);
      insist(oldEntry.type === newEntry.type && oldEntry.mode === newEntry.mode, `Stable transition changes a file type/mode: ${product}/${file}`);
      if (oldEntry.type === 'tree') continue;
      if (product === 'agent-organon' && ['OrganonCore', 'AdvisedOrganons'].includes(file)) {
        const peer = file === 'OrganonCore' ? 'core' : 'advised';
        insist(oldEntry.type === 'commit' && oldEntry.sha === rc.sources[peer].commit && newEntry.sha === manifest.sources[peer].commit, `Peer gitlink does not match the frozen source identity: ${file}`);
        if (oldEntry.sha !== newEntry.sha) changes.push({ product, path: file, before: oldEntry.sha, after: newEntry.sha, reason: 'peer-gitlink' });
        continue;
      }
      if (oldEntry.sha === newEntry.sha) continue;
      insist(oldEntry.type === 'blob' && oldEntry.mode !== '120000', `Unapproved symbolic-link or gitlink change: ${product}/${file}`);
      const reason = permittedBlob(file, utf8(await read(oldEntry)), utf8(await read(newEntry)), rc, manifest, product);
      changes.push({ product, path: file, before: oldEntry.sha, after: newEntry.sha, reason });
    }
    if (product === 'agent-organon') for (const peer of ['OrganonCore', 'AdvisedOrganons']) insist(oldEntries.has(peer), `Required peer gitlink is missing: ${peer}`);
    repositories[product] = { repository, rc_commit: oldCommit, stable_commit: newCommit, rc_tree: oldObject.tree.sha, stable_tree: newObject.tree.sha };
  }
  return { schema_version: 1, gate: 'stable-transition', status: 'passed', approved_rc_manifest_sha256: approvalDigest, stable_manifest_sha256: digest(manifest), source_digest: manifest.source_digest, repositories, changes, approval_binding: 'separate-configured-RC-digest', scope: 'Immutable source differences only; rebuilt packages, fresh validation gates and user approval remain separate requirements.' };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(async () => {
  const args = parseArgs(); const file = path.resolve(requireValue(args, 'manifest'));
  console.log(JSON.stringify(await validateStable(readJSON(file), path.dirname(file)), null, 2));
});
