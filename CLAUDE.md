# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Development (starts main build, renderer dev server, and electron concurrently)
npm run dev

# Build
npm run build:main       # Main process + preload + worker (vite, CJS output)
npm run build:renderer   # React renderer (vite)
npm run build            # Both

# Packaging (Windows)
npm run pack:win         # All Windows targets
npm run pack:nsis        # NSIS installer only
npm run pack:msi         # MSI installer only

# Clean
npm run clean            # Remove ./out
```

Uses **pnpm** (see `pnpm.onlyBuiltDependencies` in package.json). Vite configs: `vite.config.ts` (renderer, dev server on port 5175) and `vite.main.config.ts` (main/preload/worker, CJS format, targeting Node 18).

## Architecture

An Electron desktop app bundling multiple mini-apps: **Gomoku** (五子棋), **Todo List**, **Pomodoro Timer**, and a **Basic Page** demo. React + HeroUI + Tailwind CSS on the frontend, VS Code-inspired patterns on the backend.

### Process layout

- **Main process** (`src/main/main.ts`) — creates `BrowserWindow` (frameless, transparent), initializes LowDB via a worker thread, registers IPC handlers (`app:quit`, `app:window:minimize`, `app:window:close`), locks to a single instance.
- **Preload** (`src/main/preload.ts`) — exposes `appBridge` (quit/minimize/close) and `webUtils.getPathForFile` to the renderer via `contextBridge`.
- **Renderer** (`src/renderer/src/`) — React app with a hub screen (`app.tsx`) that conditionally renders each sub-app (`gomoku/`, `todoList/`, `pomodoro/`, `basic-page/`, `message/`).

### Key patterns

- **DI/IOC** (`src/platform/instantiation/`) — Partial VS Code-style dependency injection (descriptors, graph, InstantiationService). `InstantiationService` is a stub; the core methods throw `"Method not implemented."`.
- **Disposables** (`src/base/lifecycle.ts`) — `IDisposable`, `DisposableStore`, and abstract `Disposable` base class. Used throughout for resource cleanup.
- **Event/Emitter** (`src/base/event.ts`) — Custom typed event system with `Emitter<T>` and `Event<T>`, plus adapters for Node `EventEmitter` and DOM targets.
- **Async utils** (`src/base/async.ts`) — `timeout`, `timeoutWithValue`, `timeoutWithError`, `throttle`, `debounce`, `createCancelablePromise`.
- **IPC channel abstraction** (`src/common/simple-ipc.ts`) — `ChannelServer`/`ChannelClient` over any `IMessagePassingProtocol`, with an `InMemoryProtocol` for testing. Request-response with correlation IDs.
- **LowDB worker** (`src/main/db-worker/`) — Runs LowDB in a `worker_threads` to avoid blocking the main process. `LowDbWorkerClient` wraps request/response with timeouts and promise-based API (`init`, `put`, `get`, `del`).

### Path aliases

`@/` maps to `src/` (configured in both `tsconfig.json` and both vite configs).
