import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseArgs, readJSON, writeJSON, requireValue, sha256, confined, digest, main } from './lib.mjs';
import { INVENTORY_FILE, validateTrustedEvidence } from './evidence.mjs';
import { assertManifest } from './manifest.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(() => {
  const args = parseArgs(); const manifestFile = path.resolve(requireValue(args, 'manifest')); const root = path.dirname(manifestFile);
  const manifest = readJSON(manifestFile); assertManifest(manifest);
  const directory = path.resolve(requireValue(args, 'reports'));
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new Error('Reports must be inside the candidate directory');
  function visit(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => item.isDirectory() ? visit(path.join(dir, item.name)) : [path.join(dir, item.name)]); }
  const added = [];
  for (const file of visit(directory).filter(file => file.endsWith('.json'))) {
    const relative = path.relative(root, file).split(path.sep).join('/'); confined(root, relative);
    const report = readJSON(file);
    if (!report.gate || report.status !== 'passed') continue;
    if (report.source_digest !== manifest.source_digest || report.artifact_digest !== digest(manifest.artifacts)) throw new Error(`Report belongs to another source or package object: ${relative}`);
    const previous = manifest.evidence.find(item => item.file === relative);
    const checksum = sha256(fs.readFileSync(file));
    if (previous && previous.sha256 !== checksum) throw new Error(`A previously collected report changed: ${relative}; preserve it under a new name`);
    if (!previous) { manifest.evidence.push({ file: relative, sha256: checksum }); added.push(relative); }
  }
  const inventory = path.join(root, INVENTORY_FILE);
  if (fs.existsSync(inventory)) { manifest.trusted_executions = { file: INVENTORY_FILE, sha256: sha256(fs.readFileSync(inventory)) }; validateTrustedEvidence(manifest, root); }
  writeJSON(requireValue(args, 'out'), manifest); console.log(JSON.stringify({ status: 'collected', added }));
});
