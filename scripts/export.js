import { argumentsFor, run } from './lib/cli.js';
import { exportPhilosophy } from './lib/operations.js';
run(() => {
  const args = argumentsFor(['source', 'out', 'source-id', 'core-only'], ['core-only']);
  if (args.positional.length) throw new Error('Unexpected positional arguments');
  return exportPhilosophy({ ...args, sourceId: args['source-id'], coreOnly: args['core-only'] });
});
