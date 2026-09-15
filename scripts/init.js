import { argumentsFor, run } from './lib/cli.js';
import { initialize } from './lib/operations.js';
run(() => {
  const args = argumentsFor(['target', 'source', 'source-id']);
  if (args.positional.length) throw new Error('Unexpected positional arguments');
  return initialize({ ...args, sourceId: args['source-id'] });
});
