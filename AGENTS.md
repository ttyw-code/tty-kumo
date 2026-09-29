# AGENTS.md — tty-kumo

**交互语言：简体中文。所有对话、回复、代码注释均使用中文。**

Electron + Vite + React + TypeScript desktop app.

## Commands

```bash
yarn dev              # concurrent main build (watch) + renderer dev server + electron
yarn build            # build:main then build:renderer
yarn build:main       # vite build --config vite.main.config.ts
yarn build:renderer   # vite build (renderer)
yarn start            # build + electron .
yarn pack:win         # build + electron-builder --win
yarn clean            # rm -rf ./out
```

Dev server runs on **port 5175** (not default 5173).

## Architecture

```
src/
  main/           Electron main process (main.ts, preload.ts, tray.ts)
  renderer/src/   React app entry (main.tsx, app.tsx)
  common/         Shared between main & renderer (IPC contract, session types, LCS)
  base/           VSCode-style primitives (Disposable, Emitter, Event, lifecycle)
  platform/       Platform abstractions (window, DI/graph)
```

- **UI framework**: HeroUI (`@heroui/react`) + Lucide icons (`lucide-react`) + Tailwind CSS v4
- **Database**: LowDB v7 running in a Node `worker_threads` (client: `src/main/database/persister.ts`, worker: `src/main/database/lowdb-worker.ts`). KV 是 `string → string`，每次 `put` 都会整文件重写 —— 别在流式回调里逐 delta 落盘
- **Session storage**: 会话与消息的**真相源在主进程** —— `src/main/agent/session.ts` 的 `SessionStore`（`chat:index` + `chat:{id}`）；渲染端 `store/index.ts` 只是投影。设计见 `docs/specs/phase2-session-persistence.md`
- **Tool safety**: 工具执行统一走 `DefaultToolRegistry.execute`，三层防护（`Tool.validate` 硬拦截 → `risk: 'confirm'` 弹窗放行 → 输出截断）。策略见 `docs/specs/tool-safety-guard.md`
- **Path alias**: `@/` → `src/` (configured in both `tsconfig.json` paths and Vite resolve aliases)

## Build details

- Main process outputs **CJS** (`.cjs`) into `out/src/main/` — `main.cjs`, `preload.cjs`, `worker.cjs`
- Renderer outputs into `out/renderer/`
- `vite.main.config.ts` has `emptyOutDir: false` so all three CJS entries coexist
- `build-esbuild.js` is legacy — actual builds use Vite
- `package.json` has `"type": "module"` but main process entries are CJS

## Dev workflow gotchas

- `wait-on` blocks until `out/src/main/main.cjs`, `out/src/main/preload.cjs`, AND `tcp:127.0.0.1:5175` are ready
- `nodemon` restarts electron when any `.cjs` in `out/src/main` changes
- `VITE_DEV_SERVER_URL=http://localhost:5175` is set by `dev:electron` — main process reads this to load from dev server vs file
- **Preload path**: resolved from `out/src/main/preload.cjs` in both dev and packaged
- CSP headers in `renderer/index.html` allow `localhost:5175` connections; update if port changes
- Build order matters: `build:main` must complete before `build:renderer` in `yarn start` (and `dev:electron` depends on main CJS files existing)

## App lifecycle (main process)

- `app.requestSingleInstanceLock()` prevents duplicate instances
- `Main.start()` is essentially a no-op (empty `startup()`)
- Real init happens in `app.whenReady()` → `initApp()` → `createWindow()` → `createTray()`
- Window uses frameless/transparent mode with `contextIsolation: true` and `sandbox: true`
- IPC channels: `app:quit`, `app:window:minimize`, `app:window:close` — exposed via `contextBridge` as `window.appBridge`
- `platform/window/window.ts` has a `BaseWindow` wrapper class but `main.ts` uses raw `BrowserWindow` directly

## Testing

`yarn test` runs **vitest** (config: `vitest.config.ts`, `happy-dom` + testing-library setup at `src/renderer/src/test/setup.ts`). `yarn test:watch` for watch mode. There is no `typecheck` script — run `npx tsc --noEmit` directly; it must stay at 0 errors.

拒绝类断言要落在**副作用**上（如 `expect(fs.existsSync(target)).toBe(false)`），只验返回文案会漏掉静默失效。

## CI

GitHub Actions (`.github/workflows/electron-build.yml`) builds on windows/macos/ubuntu, runs `npm install` + `npm run build` + `npx electron-builder --publish=never`.

⚠️ 两个已知问题：workflow 用的是 `npm install`，但仓库锁文件是 `yarn.lock`（依赖漂移风险）；且 CI **只 build，不跑 vitest 也不跑 tsc**，所以本地验证不能省。

## Agent skills

### Issue tracker

Issue 和 PRD 以 GitHub Issues 形式存在于 `ttyw-code/tty-desktop`，通过 `gh` CLI 操作。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认 Matt Pocock 标签词汇：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文仓库——根目录一个 `CONTEXT.md` + `docs/adr/`。二者尚不存在，engineering skill 静默跳过，直到 `/grill-with-docs` 创建。详见 `docs/agents/domain.md`。
