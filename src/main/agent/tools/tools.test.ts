import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DefaultToolRegistry, TOOL_ABORTED_MESSAGE, TOOL_DENIED_MESSAGE } from './registry';
import { readFileTool, writeFileTool } from './fs';
import { shellTool } from './shell';
import { nowTool } from './now';
import { MAX_TOOL_OUTPUT_CHARS, configureSandboxRoots, resetSandboxRoots } from './guard';
import type { Tool, ToolExecuteContext } from './types';

let root: string;
let outside: string;

function makeContext(confirmResult: boolean, aborted = false) {
  const calls: Array<string | undefined> = [];
  const controller = new AbortController();
  if (aborted) controller.abort();
  const ctx: ToolExecuteContext = {
    runId: 'run-1',
    chatId: 'chat-1',
    signal: controller.signal,
    confirm: async (hint?: string) => {
      calls.push(hint);
      return confirmResult;
    },
  };
  return { ctx, calls };
}

function buildRegistry(): DefaultToolRegistry {
  const registry = new DefaultToolRegistry();
  registry.register(nowTool);
  registry.register(readFileTool);
  registry.register(writeFileTool);
  registry.register(shellTool);
  return registry;
}

beforeEach(() => {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'kumo-tools-')));
  root = path.join(parent, 'sandbox');
  outside = path.join(parent, 'outside');
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  configureSandboxRoots({ read: [root], write: [root] });
});

afterEach(() => {
  resetSandboxRoots();
  fs.rmSync(path.dirname(root), { recursive: true, force: true });
});

describe('registry 护栏流程', () => {
  it('越界写入被硬拦截，且不会进入确认流程', async () => {
    const registry = buildRegistry();
    const { ctx, calls } = makeContext(true);
    const target = path.join(outside, 'a.txt');

    const result = await registry.execute('write_file', { path: target, content: 'x' }, ctx);

    expect(result).toContain('已阻止执行');
    expect(result).toContain('不在允许目录内');
    expect(calls).toHaveLength(0);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('用户拒绝时不落盘', async () => {
    const registry = buildRegistry();
    const { ctx, calls } = makeContext(false);
    const target = path.join(root, 'denied.txt');

    const result = await registry.execute('write_file', { path: target, content: 'x' }, ctx);

    expect(result).toBe(TOOL_DENIED_MESSAGE);
    expect(calls).toEqual(['将覆盖或新建你电脑上的一个文件，同名文件内容会丢失']);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('用户放行后才写入', async () => {
    const registry = buildRegistry();
    const { ctx } = makeContext(true);
    const target = path.join(root, 'ok.txt');

    const result = await registry.execute('write_file', { path: target, content: 'hello' }, ctx);

    expect(result).toBe('已写入');
    expect(fs.readFileSync(target, 'utf-8')).toBe('hello');
  });

  it('safe 工具不打扰用户', async () => {
    const registry = buildRegistry();
    const target = path.join(root, 'note.txt');
    fs.writeFileSync(target, 'content');

    const { ctx, calls } = makeContext(false);
    const result = await registry.execute('read_file', { path: target }, ctx);

    expect(result).toBe('content');
    expect(calls).toHaveLength(0);
  });

  it('敏感凭据文件读不到', async () => {
    const registry = buildRegistry();
    const sshDir = path.join(root, '.ssh');
    fs.mkdirSync(sshDir);
    fs.writeFileSync(path.join(sshDir, 'id_rsa'), 'PRIVATE KEY');

    const { ctx } = makeContext(true);
    const result = await registry.execute('read_file', { path: path.join(sshDir, 'id_rsa') }, ctx);

    expect(result).toContain('已阻止执行');
  });

  it('读取目录时给出可理解的失败原因（异常上抛，由 run 层包装给模型）', async () => {
    const registry = buildRegistry();
    const { ctx } = makeContext(true);
    await expect(registry.execute('read_file', { path: root }, ctx)).rejects.toThrow('list_dir');
  });

  it('黑名单命令不过确认、更不执行', async () => {
    const registry = buildRegistry();
    const victim = path.join(outside, 'victim.txt');
    fs.writeFileSync(victim, 'keep');

    const { ctx, calls } = makeContext(true);
    const result = await registry.execute('run_command', { command: `rm -rf ${root}` }, ctx);

    expect(result).toContain('已阻止执行');
    expect(calls).toHaveLength(0);
  });

  it('run 中止后工具不执行', async () => {
    const registry = buildRegistry();
    const { ctx, calls } = makeContext(true, true);
    const target = path.join(root, 'aborted.txt');

    const result = await registry.execute('write_file', { path: target, content: 'x' }, ctx);

    expect(result).toBe(TOOL_ABORTED_MESSAGE);
    expect(calls).toHaveLength(0);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('未知工具直接抛错', async () => {
    const registry = buildRegistry();
    const { ctx } = makeContext(true);
    await expect(registry.execute('nope', {}, ctx)).rejects.toThrow('未知工具');
  });

  it('超长输出被压到上下文可接受的长度', async () => {
    const registry = buildRegistry();
    const bigTool: Tool = {
      definition: { name: 'big_output', description: '', inputSchema: {}, risk: 'safe' },
      async execute() {
        return 'y'.repeat(MAX_TOOL_OUTPUT_CHARS + 500);
      },
    };
    registry.register(bigTool);

    const { ctx } = makeContext(true);
    const result = await registry.execute('big_output', {}, ctx);

    expect(result.length).toBeLessThan(MAX_TOOL_OUTPUT_CHARS + 100);
    expect(result).toContain('已省略 500 字符');
  });

  it('每个工具的 risk 都有明确取值', () => {
    const registry = buildRegistry();
    for (const def of registry.list()) {
      expect(['safe', 'confirm']).toContain(def.risk);
    }
  });

  it('confirm 级工具都提供了给弹窗看的后果说明', () => {
    const registry = buildRegistry();
    for (const def of registry.list()) {
      if (def.risk !== 'confirm') continue;
      expect(typeof def.confirmHint).toBe('string');
      expect(def.confirmHint!.length).toBeGreaterThan(0);
    }
  });
});
