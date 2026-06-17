# 敏感操作

- 涉及文件删除、数据库变更、环境变量修改等操作时，先展示将要执行的命令并确认
- git push、git commit 等操作仅在明确要求时执行
- 不在代码中写入或暴露密钥、token、密码等敏感信息
- 不修改 git config、不跳过 git hooks、不使用 force push
