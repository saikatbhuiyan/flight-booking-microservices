import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';

const REPO_ROOT = join(__dirname, '../../../..');

function findControllers(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : findControllers(path);
    return entry.name.endsWith('.controller.ts') ? [path] : [];
  });
}

describe('RPC controller wiring', () => {
  // App-level filters/pipes never reach RMQ handlers (connectMicroservice() registers them immediately and APP_*
  // providers bind to the HTTP app). Without the controller-level filter, Nest replies with a generic
  // "Internal server error" so every 4xx surfaces as 500; without the pipe, payloads go unvalidated.
  it.each(['@UseFilters(CommonRpcExceptionFilter)', '@UsePipes(RpcValidationPipe)'])(
    'every controller that handles @MessagePattern applies %s',
    (decorator) => {
      const missing = findControllers(join(REPO_ROOT, 'apps'))
        .filter((file) => {
          const source = readFileSync(file, 'utf8');
          return source.includes('@MessagePattern(') && !source.includes(decorator);
        })
        .map((file) => relative(REPO_ROOT, file));

      expect(missing).toEqual([]);
    },
  );
});
