import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '../..');

/**
 * 构建形态的护栏。
 *
 * Electron 的 sandbox preload **不能 require 相对文件**。rollup 在多入口下会把
 * main 与 preload 共享的模块（`common/ipc.ts` 两边都引用）抽成公共 chunk，
 * preload 于是写出 `require('./chunk-ipc.cjs')`，沙箱里直接：
 *
 *     Unable to load preload script: ...\preload.cjs
 *     Error: module not found: ./chunk-ipc.cjs
 *
 * 整个 preload 加载失败 → `window.ipcChannel` / `window.agentBridge` 全没了 →
 * 渲染端拿不到通道就一律 return，表现为「点 New Chat 没反应」。
 *
 * 所以 preload 必须单独构建成自包含单文件（单入口 → rollup 不抽 chunk）。
 * 这个坑真踩过一次，守在这里。
 */
describe('主进程构建形态', () => {
  it('build:main 与 dev:main 都单独构建 preload', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    for (const name of ['build:main', 'dev:main']) {
      expect(pkg.scripts[name], `${name} 必须带 --mode preload 单独构建 preload`).toContain(
        '--mode preload',
      );
    }
  });

  it('构建配置里 preload 是独立入口分支', () => {
    const source = readFileSync(join(root, 'vite.main.config.ts'), 'utf8');
    expect(source, 'vite.main.config.ts 应当按 mode 区分入口').toContain('preloadOnly');
  });

  it('preload 产物不依赖任何相对路径文件', () => {
    const file = join(root, 'out/src/main/preload.cjs');
    if (!existsSync(file)) return; // 尚未构建过就跳过

    const code = readFileSync(file, 'utf8');
    const relativeRequires = [...code.matchAll(/require\(["'](\.[^"']+)["']\)/g)].map((m) => m[1]);
    expect(
      relativeRequires,
      'preload 必须自包含：sandbox 下 require 相对文件会 module not found',
    ).toEqual([]);
  });

  it('preload 产物把共享模块内联了（能查到 IPC 通道常量）', () => {
    const file = join(root, 'out/src/main/preload.cjs');
    if (!existsSync(file)) return;

    const code = readFileSync(file, 'utf8');
    expect(code, 'preload 应当内联 common/ipc.ts，否则通道白名单会失效').toContain(
      'agent:chat:list',
    );
  });
});
