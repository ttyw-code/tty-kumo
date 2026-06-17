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
  common/         Shared between main & renderer (database worker, LCS, IPC)
  base/           VSCode-style primitives (Disposable, Emitter, Event, lifecycle)
  platform/       Platform abstractions (window, DI/graph)
```

- **UI framework**: HeroUI (`@heroui/react`) + Lucide icons (`lucide-react`) + Tailwind CSS v4
- **Database**: LowDB v7 running in a Node `worker_threads` (client: `common/database/lowdb-client.ts`, worker: `common/database/lowdb-worker.ts`)
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

No test runner configured. `yarn test` exits with error. A test file exists at `src/platform/instantiation/test/instantiation.test.ts` but there's no framework or run command.

## CI

GitHub Actions (`.github/workflows/electron-build.yml`) builds on windows/macos/ubuntu, runs `npm install` + `npm run build` + `npx electron-builder --publish=never`.

## Agent skills

### Issue tracker

Issue 和 PRD 以 GitHub Issues 形式存在于 `ttyw-code/tty-desktop`，通过 `gh` CLI 操作。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认 Matt Pocock 标签词汇：`needs-triage`、`needs-info`、`ready-for-agent`、`ready-for-human`、`wontfix`。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文仓库——根目录一个 `CONTEXT.md` + `docs/adr/`。二者尚不存在，engineering skill 静默跳过，直到 `/grill-with-docs` 创建。详见 `docs/agents/domain.md`。
