# Spec — 工具安全护栏（Tool Safety Guard）

**日期**：2026-09-29
**状态**：已实现
**背景**：阶段 3 落地了 11 个工具，但 `run_command` 可执行任意命令、`write_file` 可覆盖任意绝对路径，全程无确认、无边界。对一个本地桌面 agent 来说，模型一次幻觉即可造成不可逆损失。

## 不改的架构不变式

- **单推送通道**：主 → 渲染仍然只走 `agent:stream`，确认请求是新增的 `tool_confirm` kind，不开第二条推送通道。
- **新能力开新通道**：渲染 → 主的答复走 `agent:tool:confirm:reply`（`ipcRenderer.send` 单向，不用 invoke，避免句柄悬挂）。
- **事件永远带 runId + chatId**，确认回复额外带 `confirmId`。
- **`risk` 不外发给模型**：`toOpenAITool()` 只向 LLM 暴露 name/description/parameters。

## 三层防护

| 层 | 位置 | 行为 | 典型场景 |
|---|---|---|---|
| 硬拦截 | `Tool.validate()` | 返回原因字符串即阻止，不弹窗、不让模型重试替代 | shell 黑名单、路径越界、敏感凭据、`rm -rf` |
| 人工确认 | `risk: 'confirm'` + `ToolConfirmGateway` | 工具执行挂起，等用户在弹窗里放行 | 写文件、跑命令、写剪贴板、改日程 |
| 兜底收口 | `DefaultToolRegistry.execute()` | 输出截断到 8000 字符；`MAX_TOOL_ROUNDS = 8`；shell 超时上限 120s | 防止单次工具结果撑爆上下文、防止进程挂死 |

## 风险分级

| 工具 | risk | 理由 |
|---|---|---|
| `now` | safe | 只读时间 |
| `read_file` | safe | 只读，但仍受 read 域沙箱限制 |
| `list_dir` | safe | 同上 |
| `web_search` | safe | 只读公开网页 |
| `db_get` / `db_put` / `db_del` | safe | 操作的是应用自持 KV（LLM 的便签本），不是用户文件系统；记错可改回 |
| `write_file` | confirm | 同名文件内容会丢失 |
| `run_command` | confirm | 在本机执行进程 |
| `clipboard_read` | confirm | 剪贴板可能含密码，读取后进入上下文 |
| `clipboard_write` | confirm | 覆盖用户剪贴板 |
| `schedule_add` | confirm | 产生系统通知 + 持久数据 |
| `schedule_remove` | confirm | 删除用户日程 |

判定口径：**只对「用户可见资源」产生副作用就要确认；应用私有数据不算。**

## 路径沙箱

- 根目录由 `main.ts` 在 app ready 后注入：`os.homedir()` + `documents` / `downloads` / `desktop`。
- **不含** `app.getPath('userData')` —— 那里放着 lowdb 数据库，不能被 agent 直接改。
- read / write 分域，默认同集；命令行无关的情况下可收紧成不同集合。
- 额外拦截：
  - 相对路径一律拒绝（必须绝对路径）；
  - 敏感目录段 `.ssh .aws .azure .gnupg .kube .docker .password-store credentials credential`；
  - 敏感文件 `id_rsa/dsa/ecdsa/ed25519`、`*.pem|pfx|key|p12|jks|keystore|kdbx`、`.npmrc .pypirc .netrc .pgpass .env*`；`.env.example/.sample/.template` 放行；
  - 符号链接逃逸检查（沿路径向上找最深存在节点再校验）。

## shell 黑名单（硬拦截，不给确认机会）

递归/强制删除（`rm -rf`、`del /f /s`、`rd /s`、`Remove-Item -Recurse`）、磁盘操作（format/mkfs/diskpart/fdisk）、关机注销、提权（sudo/doas/runas/su -）、权限放开（chmod 777、chown -R、icacls 授权）、注册表修改、结束进程、裸磁盘写（dd if=）、fork 炸弹、动态执行脚本（iex / Invoke-Expression）、下载后直送解释器（curl|bash）、丢弃 Git 改动或强推（git clean -f / reset --hard / push -f / checkout .）。

规则表在 `guard.ts` 的 `COMMAND_BLOCK_RULES`，每条都带中文原因，测试逐一覆盖。

## 确认机制的语义

- **超时 = 拒绝**（默认 120s），窗口销毁 = 拒绝，run 被中止 = 拒绝。拿不到肯定答复就当没同意。
- **「本次会话不再询问」只存在于内存**（`ToolConfirmGateway.remembered`），进程重启必须重新询问——避免一次误勾变成永久授权。
- 拒绝后喂回模型的文案（`TOOL_DENIED_MESSAGE`）明确要求模型收敛，而不是换个参数重试同一个操作。
- `finishRun` / `cleanupRun` / `will-quit` 都会 `cancelRun`，不留悬垂 Promise。

## 怎么验证（分层）

护栏的失败模式是「静默失效」——弹窗没弹出来、拒绝之后还是执行了，界面上不一定看得出来。所以按四层验，每层回答不同问题。

### 第 1 层：单元测试

> 注意：CI（`.github/workflows/electron-build.yml`）目前只 build，不跑 vitest。改护栏后请本地执行，别指望流水线拦。

```bash
yarn test                                   # 全量
yarn test src/main/agent/tools/guard.test.ts   # 只跑策略层
yarn test src/main/agent                    # 只跑 agent 相关
```

| 文件 | 测试数 | 回答的问题 |
|---|---|---|
| `tools/guard.test.ts` | 49 | 沙箱边界、敏感路径、符号链接逃逸、21 条黑名单逐条、超时与输出截断 |
| `tools/tools.test.ts` | 12 | 经 `registry.execute` 的真实链路：越界不落盘、拒绝不落盘、abort 不执行、safe 工具不打扰 |
| `agent/confirm.test.ts` | 10 | 网关语义：超时=拒绝、窗口销毁=拒绝、run 中止=拒绝、remember 只记 allow、重复回复被忽略 |
| `renderer/src/store/confirm.test.ts` | 7 | 渲染端队列：入队顺序、答复回传、拒绝不带 remember、删会话清队列、跨 run 事件被丢弃 |

断言的落点必须是**副作用**（文件到底建没建、命令到底跑没跑），不是返回值字符串——`tools.test.ts` 里每个拒绝用例都跟了一句 `expect(fs.existsSync(target)).toBe(false)`。

### 第 2 层：手工端到端（不配 API key）

`yarn dev` 自带 `TTY_MOCK=1`，`MockProvider` 按消息关键词挑工具，三条路径都能点出来：

| 在输入框里发 | 触发 | 应该看到 |
|---|---|---|
| `现在几点` | `now`（safe） | 直接出结果，**不弹窗** |
| `帮我写个文件` | `write_file` → `~/tty-kumo-guard-demo.txt` | **弹出确认框**，显示工具名 + 参数 JSON + 后果说明 |
| `跑个命令` | `run_command` → `echo tty-kumo-guard-demo` | **弹出确认框**；点允许才执行 |
| `把 /tmp 删了` | `run_command` → `rm -rf /tmp/...` | **不弹窗**，回复里直接写「已阻止执行：命令命中安全黑名单」 |

确认框上逐项验：
- 点「拒绝」→ 工具没执行，`~/tty-kumo-guard-demo.txt` 没有被创建；
- 勾「本次会话内不再询问」+「允许」→ 同一工具后续不再弹窗；
- **重启应用后「不再询问」失效**（它只活在内存里，这是刻意设计）；
- 弹窗期间点「停止」或切走会话 → 工具按拒绝处理，不会卡住。

> 触发词表在 `src/main/agent/llm/mock.ts` 的 `planToolCall()`。要加新的演示场景（比如剪贴板、日程）就往里加分支。

### 第 3 层：真模型回归

配好 baseUrl / model / API key，让模型自己决定调工具，重点看两件事：
1. **模型会不会为了绕过拒绝而换参数重试**——`TOOL_DENIED_MESSAGE` 里明确要求它收敛，看实际表现；
2. **工具定义格式对不对**——`toOpenAITool()` 的 `{type:'function', function:{...}}` 包装，接不兼容的兼容端点会直接 400。

### 第 4 层：构建产物校验

```bash
yarn build && grep -c 'require("os")' out/src/main/main.cjs   # 必须 >= 1
```

`vite.main.config.ts` 的 `external` 漏配 `os` 时，vite 会静默把它编成 `{}`，运行到 `os.homedir()` 才抛错、应用根本起不来——这个坑踩过一次，产物里查一眼最省事。

## 已知边界 / 后续

1. 黑名单是**字符串匹配**，可被 `Base64 -d | sh`、变量拼接等方式绕过。真要硬隔离得把命令放进受限容器/沙箱进程。
2. `write_file` 目前不限制文件数或总写入量；恶意循环写盘没有配额。
3. 没有工具审计日志——出事后无法回溯「哪次会话跑了什么命令」。建议跟着阶段 2 的 Session Store 一起落 `run ledger`。
4. `web_search` 依赖 DuckDuckGo HTML 接口，无超时保护之外的限制。
5. db_* 判为 safe 是基于「应用私有数据」的前提；若将来把数据库开放给用户文件系统语义，需要重新定级。
