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

describe('CommonRpcExceptionFilter wiring', () => {
  // connectMicroservice() registers RMQ handlers immediately, so app.useGlobalFilters() called afterwards never
  // reaches them. Without a controller-level filter, Nest replies to RPC callers with a generic
  // "Internal server error" and the gateway maps every 4xx to 500.
  it('is applied to every controller that handles @MessagePattern', () => {
    const missing = findControllers(join(REPO_ROOT, 'apps'))
      .filter((file) => {
        const source = readFileSync(file, 'utf8');
        return source.includes('@MessagePattern(') && !source.includes('@UseFilters(CommonRpcExceptionFilter)');
      })
      .map((file) => relative(REPO_ROOT, file));

    expect(missing).toEqual([]);
  });
});
