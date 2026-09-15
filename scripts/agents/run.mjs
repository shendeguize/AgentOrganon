import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractTarball } from '../../installer/lib/archive.mjs';
import { parseArgs, requireValue, readJSON, confined, sha256, digest } from '../release/lib.mjs';
import { assertRunner, settings, isolatedEnv, capture, commandArgs, outputFile, artifact, caseTasks, inputText, requestPrompt, observedModels, newRunId, redact } from './core.mjs';

export async function run(options, source = process.env) {
  const manifestFile = path.resolve(requireValue(options, 'manifest'));
  const root = path.dirname(manifestFile), manifest = readJSON(manifestFile);
  assertRunner(source, manifest);
  const agent = requireValue(options, 'agent'), matrix = requireValue(options, 'matrix');
  if (!settings.agents[agent]) throw new Error('Unknown agent');
  if (matrix === 'full' && process.platform !== 'linux') throw new Error('Full method matrix requires native Linux');
  const cases = caseTasks(matrix, options.probe === true);
  const out = path.resolve(requireValue(options, 'out'));
  const prefix = path.relative(root, out).split(path.sep).join('/');
  confined(root, prefix + '/report.json');
  if (fs.existsSync(out)) throw new Error('Output directory already exists; preserve preceding evidence');
  fs.mkdirSync(out, { recursive: true });
  const id = newRunId(), scratch = fs.mkdtempSync(path.join(source.RUNNER_TEMP, 'organon-agents-'));
  const definition = settings.agents[agent], secrets = [source[definition.secret]].filter(Boolean);
  const report = { schema_version: 1, gate: 'agents', source_digest: manifest.source_digest, artifact_digest: digest(manifest.artifacts), agent, platform: process.platform, node: process.version, matrix, probe: options.probe === true, run_id: id, status: 'blocked', actual_call: false, independent_reviewer: false, model: null, requested_model: source[definition.model_env] || null, tool_version: null, cases: [], ci: { run_id: source.GITHUB_RUN_ID, run_attempt: source.GITHUB_RUN_ATTEMPT, source_commit: source.GITHUB_SHA, runner: source.RUNNER_OS } };
  const raw = [], prepared = [];
  try {
    if (!source[definition.secret]) throw new Error(`Missing authentication: ${definition.secret}`);
    if (agent === 'opencode' && !source.OPENCODE_MODEL) throw new Error('Missing explicit OPENCODE_MODEL');
    const toolsRoot = source.ORGANON_AGENT_TOOLS;
    if (!toolsRoot || !path.resolve(toolsRoot).startsWith(path.resolve(source.RUNNER_TEMP) + path.sep)) throw new Error('Tool installation must be under runner temporary directory');
    const launcher = readJSON(path.join(toolsRoot, agent, 'launcher.json'));
    outputFile(root, prefix + '/tool-installation.json', launcher);
    if (launcher.package_lock_sha256) {
      const lock = fs.readFileSync(path.join(toolsRoot, agent, 'package-lock.json'), 'utf8');
      if (sha256(lock) !== launcher.package_lock_sha256) throw new Error('CLI installation lock changed');
      outputFile(root, prefix + '/tool-package-lock.json', lock);
    }
    const binary = confined(path.join(toolsRoot, agent), launcher.file);
    if (sha256(fs.readFileSync(binary)) !== launcher.sha256) throw new Error('Installed CLI launcher changed');
    const command = launcher.node ? process.execPath : binary, leading = launcher.node ? [binary] : [];
    const version = await capture(command, [...leading, '--version'], { cwd: scratch, env: isolatedEnv(agent, path.join(scratch, 'version-home'), source), timeout: 60_000 });
    outputFile(root, prefix + '/tool-version.json', version);
    if (version.exit_code !== 0 || version.timed_out || !version.stdout.trim().includes(definition.version)) throw new Error('CLI version probe failed or differs from pinned version');
    report.tool_version = version.stdout.trim(); report.tool_sha256 = launcher.sha256;
    const packages = {};
    if (!options.probe) {
      const packageRoot = path.resolve(requireValue(options, 'package-dir'));
      for (const product of ['core', 'advised', 'agent-organon']) {
        const packageFile = artifact(packageRoot, manifest.artifacts?.[product]);
        packages[product] = await extractTarball(packageFile, path.join(scratch, 'packages', product));
      }
      report.package_artifacts = manifest.artifacts;
    }
    for (const testCase of cases) {
      const work = path.join(scratch, testCase.id, 'workspace'), home = path.join(scratch, testCase.id, 'home');
      fs.mkdirSync(work, { recursive: true });
      const clean = isolatedEnv(agent, home, source);
      const setup = [];
      if (!options.probe) {
        const installer = path.join(packages['agent-organon'], 'installer/organon.mjs');
        for (const product of ['core', 'advised', 'agent-organon']) {
          const args = [installer, 'install', '--product', product, '--agent', agent, '--scope', 'project', '--project', work, '--from', packages[product], ...(product === 'advised' ? ['--domain', 'SoftwareEngineering'] : [])];
          const result = await capture(process.execPath, args, { cwd: work, env: clean, timeout: 60_000 });
          setup.push({ product, ...result });
          outputFile(root, prefix + '/' + testCase.id + '-install-' + product + '.json', result);
          if (result.exit_code !== 0 || result.timed_out) throw new Error(`Package installation failed: ${product}/${testCase.id}: ${result.stderr}`);
        }
        const domain = testCase.skill === 'organon-software-engineering';
        const args = [installer, 'init', '--product', domain ? 'advised' : 'core', '--agent', agent, '--scope', 'project', '--project', work, '--philosophy', domain ? 'SoftwareEngineering' : 'core', ...(domain ? ['--domain', 'SoftwareEngineering'] : [])];
        const preview = await capture(process.execPath, args, { cwd: work, env: clean, timeout: 60_000 });
        setup.push({ init_preview: true, ...preview });
        outputFile(root, prefix + '/' + testCase.id + '-init-preview.json', preview);
        if (preview.exit_code !== 0 || preview.timed_out) throw new Error(`Baseline preview failed: ${preview.stderr}`);
        const plan = JSON.parse(preview.stdout);
        if (!/^[a-f0-9]{64}$/.test(plan.planSha256 || '')) throw new Error('Installer did not return a bound init plan');
        const result = await capture(process.execPath, [...args, '--apply', '--plan-sha256', plan.planSha256], { cwd: work, env: clean, timeout: 60_000 });
        setup.push({ init: true, ...result });
        outputFile(root, prefix + '/' + testCase.id + '-init-apply.json', result);
        if (result.exit_code !== 0 || result.timed_out) throw new Error(`Explicit baseline initialization failed: ${result.stderr}`);
        fs.writeFileSync(path.join(work, 'INPUT.md'), inputText(testCase.skill));
      }
      outputFile(root, prefix + '/' + testCase.id + '-setup.json', setup);
      const prompt = requestPrompt(testCase);
      const input = { ...testCase, prompt, input: inputText(testCase.skill), adopted_philosophy: fs.existsSync(path.join(work, 'PHILOSOPHY.md')) ? fs.readFileSync(path.join(work, 'PHILOSOPHY.md'), 'utf8') : null, adopted_source_sha256: fs.existsSync(path.join(work, 'PHILOSOPHY.md')) ? sha256(fs.readFileSync(path.join(work, 'PHILOSOPHY.md'))) : null };
      prepared.push(input);
      // Persist the exact task before starting a paid/actual agent process.
      outputFile(root, prefix + '/' + testCase.id + '-input.json', input);
      const invocation = await capture(command, [...leading, ...commandArgs(agent, prompt, report.requested_model)], { cwd: work, env: isolatedEnv(agent, home, source, { auth: true }), secrets });
      const rawRef = outputFile(root, prefix + '/' + testCase.id + '-raw.json', invocation);
      const attachments = [];
      const collect = (directory, relative = '') => {
        if (!fs.existsSync(directory)) return;
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          if (entry.isSymbolicLink()) throw new Error('Reviewer artifact cannot be a symbolic link');
          const file = path.join(directory, entry.name), name = relative + entry.name;
          if (entry.isDirectory()) collect(file, name + '/');
          else {
            if (!entry.isFile() || fs.statSync(file).size > 4 * 1024 * 1024 || attachments.length >= 100) throw new Error('Reviewer evidence exceeds capture limits');
            attachments.push(outputFile(root, prefix + '/' + testCase.id + '-review/' + name, redact(fs.readFileSync(file, 'utf8'), secrets)));
          }
        }
      };
      collect(path.join(work, 'review-evidence'));
      raw.push({ id: testCase.id, artifact: rawRef, attachments });
      const ok = invocation.exit_code === 0 && !invocation.timed_out && !invocation.output_limit && !invocation.error && Boolean(invocation.stdout.trim());
      report.actual_call ||= !invocation.error;
      const models = observedModels(agent, invocation.stdout);
      report.cases.push({ id: testCase.id, skill: testCase.skill, process_status: ok ? 'completed' : 'failed', observed_models: models, raw: rawRef });
      if (!ok) throw new Error(`Actual invocation incomplete: ${testCase.id}`);
    }
    report.status = report.probe ? 'probe_completed' : 'needs_independent_review';
    const models = [...new Set(report.cases.flatMap(c => c.observed_models))];
    report.model = models.length ? models.join(', ') : null;
    report.model_status = models.length ? 'observed_session_metadata' : 'needs_independent_observation';
  } catch (error) {
    report.status = report.actual_call ? 'failed' : 'blocked';
    report.reason = redact(error.message, secrets);
  } finally {
    report.raw_response = outputFile(root, prefix + '/raw-index.json', { source_digest: manifest.source_digest, artifact_digest: digest(manifest.artifacts), cases: raw });
    report.inputs = outputFile(root, prefix + '/inputs.json', { source_digest: manifest.source_digest, artifact_digest: digest(manifest.artifacts), package_artifacts: report.package_artifacts || {}, cases: prepared });
    outputFile(root, prefix + '/report.json', report);
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const result = await run(parseArgs()); console.log(JSON.stringify({ status: result.status, run_id: result.run_id, reason: result.reason })); process.exitCode = result.status === 'probe_completed' ? 0 : result.status === 'needs_independent_review' ? 3 : 1; }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
