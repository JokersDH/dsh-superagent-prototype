# Agent A：G0-A Core 独立提取验证

交付仓库：`https://github.com/JokersDH/dsh-superagent-prototype`。
本机工作目录：`/Users/hh/Desktop/joker/superagent-agent-a`。
唯一工作分支：`codex/g0-core-extraction`。

## 开始检查

先读根 `AGENTS.md`、[代码地图](../START-HERE.zh-CN.md)、[架构复用](../product-spec/02-architecture-and-reuse.zh-CN.md) 与 [WP-00](../product-spec/tasks/WP-00.md)。

```sh
pwd
git status --short --branch
git remote -v
git log -1 --oneline
```

分支或目录不对就停止写入，报告实际位置。不要切换主工作目录的分支或覆盖其他改动。记录初始 HEAD 作为本轮 base。

## 唯一可写路径

`tools/reuse-spike/core-extraction/`，包括该目录内 package、lock、源码副本、fixtures、测试、README、provenance 和报告。其他路径只读。允许在该目录内安装最小试验依赖；不改根依赖，不全仓安装或升级原生 agent。

## 实施要求

1. 从固定上游 commit `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` 提取 `src/core/**`，保留 MIT、版权、来源和逐文件差异。
2. 将原 `tests/core-engine.spec.ts` 和 `tests/stage.spec.ts` 放入隔离试验，按需调整 import 路径/测试宿主，保留全部测试语义，不修改原领域规则迎合测试。
3. 建立最小独立 TS/test package 与 lock，在提取目录实际运行 baseline。预期 144 个原测试；报告实际数量和任何差异。原仓结果不能代替本试验。
4. 检查完整 runtime 和 TypeScript type import graph；证明不依赖 `@deepseek-ai/*`、Cordis、原插件根入口或原 app Store。仅搜索直接 import 不够。
5. 输出后续可信完成、candidate generation、reportAssignment/fence 所需最小改造建议及失败用例清单；本轮不提前实现正式 WP-01。
6. 提供一个干净 checkout 可复现的命令序列，不能引用个人 node_modules、绝对路径或被 ignore 的 `.artifacts` 才能运行。

## 输出

- `README.md`：运行方式、依赖、边界和限制。
- `report.md`：命令、环境、测试结果、导入图结论、阻塞与建议。
- `source-manifest.json`：上游 commit、许可证、提取文件、digest、改动说明。
- 提取源码、原测试副本、最小 package/lock、导入图检查和测试证据。
- 临时数据和 node_modules 不进入提交；需要时在自己目录增加局部 `.gitignore`。

本轮提供 CORE-01 的 G0 证据。与生产数据库、native runtime、产品 E2E 相关的能力不属于已经完成的验证。

## 上传和交接

检查 stage 后，只提交 `tools/reuse-spike/core-extraction/`，push 到 `origin/codex/g0-core-extraction`。不 push/merge main，不改其他 Agent 的文件。

报告 base/commit/branch、路径、实际命令、PASS/FAIL/SKIPPED/NOT_TESTED、CORE-01→证据、限制及下游接手方式。测试失败可以提交可复现试验和阻塞报告，不能伪造通过。

结束后等待主 Agent 的 G0 结论；下一包是 WP-02，但本轮不自动开始。
