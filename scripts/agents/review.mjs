import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, requireValue, readJSON, sha256, digest } from '../release/lib.mjs';
import { SKILLS, artifact, outputFile } from './core.mjs';

const nonempty = value => typeof value === 'string' && value.trim().length > 0;
function insist(condition, message) { if (!condition) throw new Error(message); }
export function validateReceipt(root, reportFile, receipt) {
  const report = readJSON(reportFile), reportHash = sha256(fs.readFileSync(reportFile));
  insist(report.gate === 'agents' && report.status === 'needs_independent_review' && report.actual_call === true && report.probe === false, 'Only completed actual non-probe invocations can receive release review');
  insist(report.tool_version && report.ci?.run_id && report.ci?.source_commit && /^[a-f0-9]{64}$/.test(report.source_digest), 'Missing actual tool/CI identity');
  insist(receipt.schema_version === 1 && receipt.report_sha256 === reportHash && receipt.source_digest === report.source_digest && receipt.artifact_digest === report.artifact_digest && receipt.inputs_sha256 === report.inputs.sha256 && receipt.raw_sha256 === report.raw_response.sha256, 'Review does not bind the exact report, inputs and raw response');
  const inputs = readJSON(artifact(root, report.inputs)), rawBundle = readJSON(artifact(root, report.raw_response));
  insist(rawBundle.source_digest === report.source_digest && rawBundle.artifact_digest === report.artifact_digest, 'Raw bundle source/package identity mismatch');
  const raw = rawBundle.cases;
  insist(Array.isArray(raw), 'Missing raw case inventory');
  insist(inputs.source_digest === report.source_digest && inputs.artifact_digest === report.artifact_digest, 'Input source identity mismatch');
  const allowed = new Map();
  for (const item of raw) {
    artifact(root, item.artifact); allowed.set(item.artifact.file, item.artifact);
    for (const ref of item.attachments || []) { artifact(root, ref); allowed.set(ref.file, ref); }
  }
  const quote = citation => {
    insist(citation && nonempty(citation.quote) && citation.quote.length >= 12 && allowed.has(citation.artifact?.file), 'Review needs an exact nontrivial citation from captured raw evidence');
    insist(allowed.get(citation.artifact.file).sha256 === citation.artifact.sha256, 'Citation raw identity mismatch');
    insist(fs.readFileSync(artifact(root, citation.artifact), 'utf8').includes(citation.quote), 'Cited evidence text is absent');
  };
  const reviewer = receipt.reviewer;
  insist(reviewer && ['human', 'agent'].includes(reviewer.kind) && nonempty(reviewer.id) && nonempty(reviewer.session_id) && reviewer.session_id !== report.run_id && reviewer.harness_author === false && reviewer.case_author === false, 'Review must identify a distinct, non-author reviewer');
  const assessment = artifact(root, receipt.assessment);
  insist(fs.statSync(assessment).size >= 100, 'Independent assessment is missing substantive content');
  const reviewerInput = artifact(root, receipt.reviewer_input);
  const inputText = fs.readFileSync(reviewerInput, 'utf8');
  insist(inputText.includes(reportHash) && inputText.includes(report.raw_response.sha256) && inputText.includes(report.inputs.sha256), 'Independent reviewer input must identify the exact frozen evidence');
  insist(receipt.raw_preserved_before_comparison === true && nonempty(receipt.exposure) && nonempty(receipt.limits), 'Review must disclose exposure, preservation order and limits');
  const expected = report.matrix === 'full' ? SKILLS : ['organon-assess'];
  insist(['full', 'smoke'].includes(report.matrix) && (report.matrix !== 'full' || report.platform === 'linux'), 'Invalid method matrix');
  for (const collection of [inputs.cases, report.cases, receipt.cases]) insist(Array.isArray(collection) && collection.length === expected.length && new Set(collection.map(c => c.id)).size === expected.length && expected.every(id => collection.some(c => c.id === id)), 'Case coverage must equal the selected matrix without duplicates');
  insist(raw.length === expected.length && new Set(raw.map(c => c.id)).size === expected.length && expected.every(id => raw.some(c => c.id === id)), 'Raw coverage does not match cases');
  for (const result of report.cases) insist(result.process_status === 'completed', 'Failed or incomplete invocation cannot pass review');
  for (const item of receipt.cases) {
    insist(item.verdict === 'accepted' && nonempty(item.findings) && nonempty(item.limits), 'Each case requires a bounded independent judgment');
    quote(item.discovery); quote(item.invocation); quote(item.payload_access);
    insist(nonempty(item.subject_session?.id) && item.subject_session.id !== reviewer.session_id, 'Reviewer must be distinct from the observed subject session');
    quote(item.subject_session.evidence);
    insist(item.subject_session.evidence.quote.includes(item.subject_session.id), 'Subject session citation does not identify its session');
    insist(nonempty(item.discovered_path), 'Missing actual discovery path');
    const delegation = item.delegation;
    insist(delegation && ['completed', 'not_required'].includes(delegation.status), 'Required delegation is incomplete');
    if (delegation.status === 'not_required') {
      insist(!['organon-absorb', 'organon-core-absorb'].includes(item.id) && nonempty(delegation.reason), 'Absorption needs actual independent-first evidence');
    } else {
      insist(nonempty(delegation.reviewer_id) && delegation.reviewer_id !== reviewer.id && nonempty(delegation.session_id) && delegation.session_id !== report.run_id && delegation.session_id !== item.subject_session.id && delegation.initial_before_candidate === true, 'Missing distinct native delegation identity/order');
      quote(delegation.initial_input); quote(delegation.initial_response); quote(delegation.comparison);
    }
  }
  insist(nonempty(receipt.observed_model?.name), 'Actual model must be observed, not inferred from a default');
  quote(receipt.observed_model.evidence);
  return { ...report, status: 'passed', model: receipt.observed_model.name, model_status: 'independently_observed', independent_reviewer: reviewer, independent_assessment: receipt.assessment, independent_review_input: receipt.reviewer_input, all_non_lean_skills: report.matrix === 'full' ? [...SKILLS] : false, review_scope: 'Structurally verified, separately attributed evidence judgment; no automated proof of philosophical correctness.' };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(), manifestFile = path.resolve(requireValue(options, 'manifest')), root = path.dirname(manifestFile), manifest = readJSON(manifestFile);
    const reportFile = path.resolve(requireValue(options, 'report')), receiptFile = path.resolve(requireValue(options, 'receipt'));
    const approved = validateReceipt(root, reportFile, readJSON(receiptFile));
    if (approved.source_digest !== manifest.source_digest || approved.artifact_digest !== digest(manifest.artifacts)) throw new Error('Review source differs from manifest');
    const receiptRef = outputFile(root, path.relative(root, path.resolve(requireValue(options, 'out'))).split(path.sep).join('/') + '.receipt.json', fs.readFileSync(receiptFile, 'utf8'));
    approved.review_receipt = receiptRef;
    approved.unreviewed_report = { file: path.relative(root, reportFile).split(path.sep).join('/'), sha256: sha256(fs.readFileSync(reportFile)) };
    const ref = outputFile(root, path.relative(root, path.resolve(options.out)).split(path.sep).join('/'), approved);
    console.log(JSON.stringify({ status: 'passed', evidence: ref }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
