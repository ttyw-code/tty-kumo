# tty-kumo

轻量级示例桌面应用（Electron + Vite + React + TypeScript）。本项目用于演示如何使用现代前端工具链构建 Electron 桌面应用

## 主要特性

- Electron 主/渲染进程分离与通信（IPC）
- 基于 Vite 的开发与构建流程（支持主进程与渲染进程）
- 使用 React + TypeScript 构建渲染层 UI
- Tailwind CSS 用于快速样式开发
- 示例模块：五子棋 AI、番茄钟、Todo、LowDB Worker、IPC 示例

## 系统需求

- Node.js >= 18（推荐 20+）
- npm 或 pnpm/yarn
- Windows / macOS / Linux

## 快速开始

安装依赖：

```bash
npm install
```

如果在中国大陆下载 Electron 失败，先设置镜像：

PowerShell：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
```

bash / macOS：

```bash
export ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
```

本地开发（启动 Vite + Electron）：

```bash
npm run dev
```

生产构建并运行：

```bash
npm run build
npm run start
```

打包示例（Windows）：

```bash
npm run pack:win
```

（具体打包命令请查看 `package.json` 中的 scripts）

## 项目结构（简要）

- src/
  - main/            Electron 主进程代码（应用生命周期、窗口管理、原生集成）
  - common/          共享工具与类型
  - base/            基础工具函数
  - renderer/        渲染层（React 应用）
    - src/
      - basic-page/  示例页面与组件
      - components/  可复用组件
- build/              构建相关资源（图标、打包配置）

完整结构请查看仓库源码。

## 开发建议

- 使用 Node 20 + npm 9 测试通过率更高。
- 出现依赖或构建异常时，可尝试删除 `node_modules` 与锁文件后重装。
- 编辑主/渲染进程代码时注意 IPC 接口的类型定义保持同步。

## 贡献

欢迎提交 issue 或 PR：

1. Fork 仓库并新建分支
2. 提交变更并发起 Pull Request

请在 PR 中简要描述改动与目的。

## 许可证

本项目采用 ISC 许可证，详见 LICENSE 文件（若存在）。

---

如果你有特别想要在 README 中加入的内容（例如演示截图、常用命令或开发流程说明），告诉我，我会补充并调整。 
