import { argumentsFor, run } from './lib/cli.js';
import { classify } from './lib/operations.js';
run(() => {
  const args = argumentsFor(['ours', 'theirs', 'source-id', 'kind', 'base-file']);
  if (args.positional.length) throw new Error('Unexpected positional arguments');
  return classify({ ...args, sourceId: args['source-id'], baseFile: args['base-file'] });
});
