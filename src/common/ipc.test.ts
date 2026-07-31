import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));

function extractChannels(code: string): string[] {
  return [...code.matchAll(/'agent:[^']+'/g)].map((m) => m[0].slice(1, -1)).sort();
}

describe('IPC channel 同步', () => {
  it('preload 与 common/ipc.ts 的 channel 集合一致', () => {
    const common = readFileSync(join(here, 'ipc.ts'), 'utf8');
    const preload = readFileSync(join(here, '../main/preload.ts'), 'utf8');

    const commonChannels = extractChannels(common);
    const preloadChannels = extractChannels(preload);

    expect(commonChannels.length).toBeGreaterThan(0);
    expect(preloadChannels).toEqual(commonChannels);
  });
});
