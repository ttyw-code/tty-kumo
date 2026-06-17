# Domain Docs

Engineering skill 在探索代码库时应如何消费本仓库的领域文档。

## 探索前先阅读

- 根目录的 **`CONTEXT.md`**，或者
- 如果根目录存在 **`CONTEXT-MAP.md`**——它会指向每个上下文各自的 `CONTEXT.md`。阅读与当前主题相关的每一份。
- **`docs/adr/`**——阅读涉及当前工作范围的 ADR。多上下文仓库还需检查 `src/<上下文>/docs/adr/` 中的上下文级决策。

如果以上任何文件不存在，**静默跳过**。不要提示缺失，也不要主动建议创建。生产者 skill（`/grill-with-docs`）会在术语或决策实际敲定时懒创建它们。

## 文件结构

单上下文仓库（大多数仓库）：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-事件溯源订单.md
│   └── 0002-postgres-写模型.md
└── src/
```

多上下文仓库（根目录存在 `CONTEXT-MAP.md`）：

```
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← 系统级决策
└── src/
    ├── ordering/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← 上下文级决策
    └── billing/
        ├── CONTEXT.md
        └── docs/adr/
```

## 使用术语表中的词汇

当你的输出提及某个领域概念（Issue 标题、重构提案、假设、测试名称）时，使用 `CONTEXT.md` 中定义的术语。不要使用术语表明确避免的同义词。

如果所需概念尚未出现在术语表中，这是一个信号——要么你在造项目不使用的语言（重新考虑），要么确实存在缺口（记录给 `/grill-with-docs`）。

## 标记 ADR 冲突

如果你的输出与已有 ADR 矛盾，请显式指出来，而非静默覆盖：

> _与 ADR-0007（事件溯源订单）矛盾——但值得重新讨论，因为……_
