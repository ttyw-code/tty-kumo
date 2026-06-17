# Issue tracker: GitHub

本仓库的 Issue 和 PRD 以 GitHub Issues 形式存在。所有操作通过 `gh` CLI 完成。

## 规范

- **创建 Issue**：`gh issue create --title "..." --body "..."`。多行内容使用 heredoc。
- **查看 Issue**：`gh issue view <number> --comments`，通过 `jq` 过滤评论并获取标签。
- **列出 Issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合 `--label` 和 `--state` 过滤条件使用。
- **评论 Issue**：`gh issue comment <number> --body "..."`
- **添加 / 移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭 Issue**：`gh issue close <number> --comment "..."`

仓库信息通过 `git remote -v` 推断——在 clone 目录下运行 `gh` 会自动识别。

## 当 skill 说"发布到 issue tracker"

创建一个 GitHub Issue。

## 当 skill 说"获取相关工单"

执行 `gh issue view <number> --comments`。
