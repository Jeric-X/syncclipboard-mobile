# 完成下一个 iOS 功能 PR

收到本文件路径后，进入本文档所在的 Git 仓库，运行以下命令读取最新计划和交接台账。

```sh
git fetch origin codex/ios-dev codex/ios-adaptation-plan
git show origin/codex/ios-adaptation-plan:docs/ios-adaptation-plan.md
git show origin/codex/ios-adaptation-plan:docs/ios-handoff.md
```

1. 对照总开发分支 `origin/codex/ios-dev` 的实际代码、已合入及在审 PR，选择计划中下一个依赖已满足且无人进行的功能。每个会话只负责一个 PR。
2. 从最新的 `origin/codex/ios-dev` 创建独立工作树和 `codex/ios-<功能>` 分支，按仓库 `AGENTS.md` 实现并验证。每个 PR 优先控制在 1–6 个文件，紧密相关的改动可以一起提交。
3. 推送功能分支，向 **`codex/ios-dev`** 提 PR。在计划分支的台账登记功能、分支和 PR 链接。按 `pr-watch` 工作流跟进检查和评审，修复本 PR 的问题。检查通过后由用户合入。
4. 一旦确认 PR 已合入，即使还有 CI 在运行也结束监控。在计划分支更新同一条台账，填入合入提交、验证结果、待验事项和下一项工作，提交并推送台账。更新前同步远端，保留其他会话的记录。完成后结束本会话。
