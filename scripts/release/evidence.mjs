import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readJSON, confined, sha256, digest } from './lib.mjs';
import { validateReceipt } from '../agents/review.mjs';

export function verifyReference(root, reference) {
  if (!reference || typeof reference.file !== 'string' || !/^[a-f0-9]{64}$/.test(reference.sha256 || '')) throw new Error('Invalid evidence reference');
  const file = confined(root, reference.file);
  if (!fs.statSync(file).isFile() || sha256(fs.readFileSync(file)) !== reference.sha256) throw new Error('Evidence artifact checksum mismatch: ' + reference.file);
  return file;
}
// Only explicit {file, sha256} objects form artifact edges. Textual output is never interpreted as an artifact directive.
export function discoverArtifactReferences(value) {
  const references = [];
  const visit = current => {
    if (!current || typeof current !== 'object') return;
    if (!Array.isArray(current) && Object.hasOwn(current, 'file') && Object.hasOwn(current, 'sha256')) {
      if (typeof current.file !== 'string' || !/^[a-f0-9]{64}$/.test(current.sha256 || '')) throw new Error('Malformed nested artifact reference');
      references.push({ file: current.file, sha256: current.sha256 });
    }
    for (const child of Object.values(current)) visit(child);
  };
  visit(value); return references;
}
export function artifactChildren(root, reference) {
  const file = verifyReference(root, reference);
  return reference.file.endsWith('.json') ? discoverArtifactReferences(readJSON(file)) : [];
}
export function evidenceRoots(manifest) { return discoverArtifactReferences(manifest); }
export function collectEvidenceClosure(manifest, root) {
  const pending = evidenceRoots(manifest), visited = new Map();
  while (pending.length) {
    const ref = pending.shift(), previous = visited.get(ref.file);
    if (previous) { if (previous.sha256 !== ref.sha256) throw new Error('Conflicting identities for evidence file: ' + ref.file); continue; }
    if (visited.size >= 10000) throw new Error('Evidence closure exceeds file limit');
    visited.set(ref.file, ref); pending.push(...artifactChildren(root, ref));
  }
  return [...visited.values()].sort((a, b) => a.file.localeCompare(b.file));
}
export async function fetchEvidenceClosure(manifest, root, fetchArtifact) {
  const pending = evidenceRoots(manifest), visited = new Map();
  while (pending.length) {
    const ref = pending.shift(), previous = visited.get(ref.file);
    if (previous) { if (previous.sha256 !== ref.sha256) throw new Error('Conflicting identities for evidence file: ' + ref.file); continue; }
    if (visited.size >= 10000) throw new Error('Evidence closure exceeds file limit');
    // Confinement is checked before a caller is allowed to download this path.
    confined(root, ref.file);
    await fetchArtifact(ref);
    visited.set(ref.file, ref); pending.push(...artifactChildren(root, ref));
  }
  return [...visited.values()].sort((a, b) => a.file.localeCompare(b.file));
}
export function validateApprovedAgentReport(root, approved) {
  const unreviewedFile = verifyReference(root, approved.unreviewed_report);
  const receipt = readJSON(verifyReference(root, approved.review_receipt));
  const expected = { ...validateReceipt(root, unreviewedFile, receipt), unreviewed_report: approved.unreviewed_report, review_receipt: approved.review_receipt };
  if (!isDeepStrictEqual(approved, expected)) throw new Error('Approved agent summary differs from its independently reviewed exact original');
  return expected;
}

export const INVENTORY_FILE = 'trusted-executions.json';
const COORDINATOR = 'shendeguize/AgentOrganon';
const SEAL_WORKFLOW = `${COORDINATOR}/.github/workflows/seal.yml@refs/heads/release/1.0.0`;
export function assertSealRole(manifest, environment = process.env) {
  if (environment.GITHUB_ACTIONS !== 'true' || environment.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
      environment.GITHUB_REPOSITORY !== COORDINATOR || environment.GITHUB_REF !== 'refs/heads/release/1.0.0' ||
      environment.GITHUB_WORKFLOW_REF !== SEAL_WORKFLOW || environment.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      environment.GITHUB_SHA !== manifest.sources['agent-organon'].commit || !/^[1-9]\d*$/.test(environment.GITHUB_RUN_ID || '')) {
    throw new Error('Sealing requires the exact protected hosted coordinator workflow');
  }
}
export function readTrustedInventory(manifest, root, { required = false, sealing = false, environment = process.env } = {}) {
  if (!manifest.trusted_executions) {
    if (required || sealing || manifest.state === 'validated') throw new Error('Missing trusted execution inventory');
    return null;
  }
  if (manifest.trusted_executions.file !== INVENTORY_FILE) throw new Error('Unexpected trusted inventory path');
  const inventory = readJSON(verifyReference(root, manifest.trusted_executions));
  const collector = inventory.collector;
  if (inventory.schema_version !== 1 || inventory.source_digest !== manifest.source_digest || inventory.artifact_digest !== digest(manifest.artifacts) ||
      collector?.repository !== COORDINATOR || collector.workflow !== SEAL_WORKFLOW || collector.source_commit !== manifest.sources['agent-organon'].commit ||
      !/^[1-9]\d*$/.test(collector.run_id || '') || !/^[1-9]\d*$/.test(inventory.candidate_run || '') ||
      !Array.isArray(inventory.runs) || !Array.isArray(inventory.files)) throw new Error('Invalid trusted execution inventory identity');
  if (sealing) {
    assertSealRole(manifest, environment);
    if (collector.run_id !== environment.GITHUB_RUN_ID || collector.run_attempt !== environment.GITHUB_RUN_ATTEMPT) throw new Error('Inventory belongs to a different seal execution');
  }
  const runs = new Map();
  for (const run of inventory.runs) {
    if (!/^[1-9]\d*$/.test(run.run_id || '') || !/^[1-9]\d*$/.test(run.run_attempt || '') || runs.has(run.run_id) || run.source_commit !== collector.source_commit ||
        run.repository !== COORDINATOR || !['candidate.yml', 'agent-e2e.yml'].includes(run.workflow) || run.conclusion !== 'success') throw new Error('Invalid trusted workflow run');
    runs.set(run.run_id, run);
  }
  if (runs.get(inventory.candidate_run)?.workflow !== 'candidate.yml' || [...runs.values()].filter(run => run.workflow === 'candidate.yml').length !== 1) throw new Error('Missing unique trusted candidate run');
  const entries = new Map();
  for (const item of inventory.files) {
    confined(root, item.path);
    const run = runs.get(item.run_id);
    if (entries.has(item.path) || item.path === INVENTORY_FILE || item.path === 'release-manifest.json' || !/^[a-f0-9]{64}$/.test(item.sha256 || '') ||
        !run || item.workflow !== run.workflow || item.run_attempt !== run.run_attempt || !/^[1-9]\d*$/.test(item.artifact_id || '') || !/^sha256:[a-f0-9]{64}$/.test(item.artifact_digest || '') || !item.artifact?.endsWith('-' + run.run_attempt) || typeof item.artifact !== 'string' || !item.artifact) throw new Error('Invalid trusted artifact inventory entry');
    entries.set(item.path, item);
  }
  return { inventory, entries };
}
export function requireTrustedReference(root, trusted, reference, workflow, runID) {
  verifyReference(root, reference);
  const entry = trusted.entries.get(reference.file);
  if (!entry || entry.sha256 !== reference.sha256 || entry.workflow !== workflow || (runID && entry.run_id !== String(runID))) throw new Error('Evidence is not from the required trusted execution: ' + reference.file);
  return entry;
}
export function validateTrustedEvidence(manifest, root, options = {}) {
  const trusted = readTrustedInventory(manifest, root, options);
  if (!trusted) return null;
  const candidate = trusted.inventory.candidate_run;
  for (const ref of Object.values(manifest.artifacts || {})) requireTrustedReference(root, trusted, ref, 'candidate.yml', candidate);
  const packages = new Map(Object.values(manifest.artifacts || {}).map(ref => [ref.file, ref.sha256]));
  for (const ref of manifest.evidence || []) {
    const report = readJSON(verifyReference(root, ref));
    if (report.gate !== 'agents') {
      if (!['content', 'site', 'package', 'github', 'install'].includes(report.gate)) throw new Error('Unexpected mechanical evidence gate');
      for (const child of collectEvidenceClosure({ evidence: [ref] }, root)) requireTrustedReference(root, trusted, child, 'candidate.yml', candidate);
      continue;
    }
    const original = readJSON(verifyReference(root, report.unreviewed_report));
    if (original.ci?.source_commit !== manifest.sources['agent-organon'].commit || !original.ci?.run_id) throw new Error('Agent execution CI identity mismatch');
    const run = String(original.ci.run_id);
    if (trusted.inventory.runs.find(item => item.run_id === run)?.run_attempt !== String(original.ci.run_attempt)) throw new Error('Agent execution attempt differs from trusted artifact origin');
    // Raw output, inputs, indices and every captured attachment must share the original run.
    // Only the exact release packages referenced by inputs belong to the candidate run.
    for (const child of collectEvidenceClosure({ evidence: [report.unreviewed_report] }, root)) {
      const isPackage = packages.get(child.file) === child.sha256;
      requireTrustedReference(root, trusted, child, isPackage ? 'candidate.yml' : 'agent-e2e.yml', isPackage ? candidate : run);
    }
  }
  return trusted;
}
