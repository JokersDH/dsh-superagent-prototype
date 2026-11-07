# G0-A：superagent core 独立提取试验

本目录是 [WP-00](../../../product-spec/tasks/WP-00.md) 的 G0 子任务 A：证明 `src/core` 领域内核可以在**不依赖 DSH 宿主**的前提下独立提取、独立安装依赖并通过原有 144-test baseline。它是一次性验证试验，**不是产品包**；正式提取由 G0 通过后的 WP-01 执行。

## 来源与许可

- 上游仓库：`https://github.com/deepseek-ai/dsh-superagent-prototype.git`
- 固定提取 commit：`8c32a9dc5d72c033816c6a8110b37f40cf94fba4`
- 许可证：MIT — Copyright (c) 2026 DeepSeek Harness Team（`LICENSE` 随源码逐字保留）
- 逐文件来源与 SHA-256：见 [source-manifest.json](source-manifest.json)
- 提取方式：`git show <commit>:<path>` 逐字节写出，**零修改**。spike 目录布局镜像上游路径（`src/core/`、`tests/`），因此两个测试文件的 `import '../src/core/index.ts'` 也逐字保留。

## 结果（2026-11-07，本机 macOS arm64）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 独立安装 | `pnpm install` | 3 个 devDependencies（@types/node 22.20.0、typescript 6.0.3、vitest 4.1.8），独立 lockfile |
| 类型图 | `pnpm typecheck`（tsc --noEmit） | PASS，无错误 |
| 传递 import 闭包 | `pnpm graph` | PASS：core 入口仅 `node:crypto`；测试入口加 `vitest`；无 `@deepseek-ai/*`、无 Cordis、无原插件根入口/app Store、无目录逃逸 |
| baseline 测试 | `pnpm test` | **144/144 通过**（core-engine 113 + stage 31），与原仓基线数量一致 |
| 来源验证 | `pnpm extract` | 18/18 文件与上游 commit 字节一致 |

详细命令输出与证据在 [report.md](report.md) 和 `reports/` 目录。

## 干净 checkout 复现步骤

要求：本仓任意 checkout（主目录或 worktree），已安装 Node（`^22.19.0 || >=24.0.0`）与 pnpm 11.7.0，且本地 git 历史包含上游 commit `8c32a9d`（fork 的 `main` 即包含）。

```sh
cd tools/reuse-spike/core-extraction
pnpm install        # 独立 node_modules + pnpm-lock.yaml，不碰仓库根
pnpm extract        # 验证 18 个提取文件与上游 commit 字节一致
pnpm typecheck      # TypeScript type graph 独立编译
pnpm graph          # 传递 runtime/type import 闭包断言
pnpm test           # 144-test baseline
```

要重新从上游 commit 物化文件：`node scripts/extract.mjs --write`（会重建 `source-manifest.json`）。

## 边界与限制

- 本试验只覆盖 **CORE-01**（独立提取 + 144 基线 + 无宿主依赖）。OPS-01（Node/binding/SQLite 发行组合）归 Agent B，DATA-01（公共契约 schema）归主 Agent，均为 NOT_TESTED。
- 未验证：原生 runtime、产品数据库、DSH Session API、任何 end-to-end 行为。这些不属于本证据。
- `src/core` 之外的文件（`src/policy.ts`、`src/admission.ts`、app Store 等）**不在**提取范围内；core 通过 `ports.ts` 的接口（`Policy`、`Assessor`、`Executor`、`Outbox`）与它们解耦，测试在文件内自带 fake 实现。
- 后续产品所需的 completion gate、reportAssignment 绑定、candidate generation 最小扩展位置与失败用例见 [report.md](report.md) 第 6 节；本轮不实现。
