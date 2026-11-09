# Native MVP 外部交付复核与下一轮边界

日期：2026-11-09。复核主线 `codex/g2-execution-integration` / `1f3229f82d0df6c68465aaf200e74a696e12964c`，已发布至 `origin/main`；实际 MVP 实现 `252bf70`。A 候选 `codex/g2-workspaces-verification` / `f1d4b1f7dba15b728207ac0a0326b752ab0a4d49`（包实现 `5a8f677`），B 候选 `codex/g1-runtime` / `0e62a3dc0a449546de4e8eddf1e8d8e86f76e96c`。两者旧共同基线 `cef31c4`，未整枝合入主线。

## 结论与测量范围

已有无依赖 Node/Codex MVP 保留原通过范围。A 有可复用的环境模块，但五项独立准入未通过，尚不启用依赖安装；B 有只读验收框架，但 native 分支尚未实现，不能认定真实验收完成。本次复核未调用模型、未重启当前产品服务、未改变用户项目或 native 账号配置。

| 对象 | 实际执行 | 结果 |
| --- | --- | --- |
| A 包内检查 | typecheck、12 项测试、build | PASS，仅包内范围 |
| A 新增准入 | 清理归属、嵌套外链、已安装版本漂移、Node OR 范围、pnpm 项目钩子 | 五项 FAIL，安装接入 BLOCKED |
| B harness 自测 | 八项 selftest | PASS，仅框架范围 |
| B 当前主线只读 | API/configuration/profile 读取 | 五项框架 PASS，七项 native NOT_TESTED |
| B 契约与执行分支复核 | schema、profile/project 配对、required human、native 可用分支 | 四项 FAIL，无实际 native 请求 |

只读报告的 HARNESS-AUTH 用公开 health 200 作断言，因此该 PASS 不单独证明受保护接口认证。native NOT_TESTED 不说明现有产品不能执行，当前产品已发布可用原生入口。

## 可复验入口

从对应 checkout 执行，使用 Node 24.22.2 与 pnpm 11.7.0；原 readonly CLI 本次运行使用 Node 24.21.0。主线的复验脚本需要支持直接加载 TypeScript 的 Node。

```sh
# Agent A checkout
pnpm --dir packages/environment-preparation typecheck
pnpm --dir packages/environment-preparation test
pnpm --dir packages/environment-preparation build
node /Users/hh/Desktop/joker/superagent/tools/bootstrap/review-environment-preparation.mjs --environment "$PWD"

# Agent B checkout: zero-model harness selftest and read-only product probe
node --test tests/native-acceptance/selftest.mjs
node tests/native-acceptance/run.mjs --url http://127.0.0.1:8796 --state /Users/hh/Desktop/joker/superagent/.local-state/workbench
```

主线记录 A 准入时附加 `--record`；预期当前 exit 1，结果见 [environment-admission.json](../../../reports/releases/native-followup/environment-admission.json)。私有临时 fixtures 和本地离线 tarball 证明了 pnpm 的 `--ignore-scripts` 仍运行 `.pnpmfile.cjs`；其无害钩子仅在本次临时根目录内、workspace 之外写 marker。没有请求网络，也没有声称对所有网络行为做了监测。

B 的 [acceptance-readonly.json](../../../reports/releases/native-followup/acceptance-readonly.json) 保存当前主线只读结果；[acceptance-review.json](../../../reports/releases/native-followup/acceptance-review.json) 保存共享 parser、纯 builder 与无网络 fake client 的四项复核。即使补齐 commandId/conversationId，create_work 仍缺 goal 并有多余 workId/text；fixture-first 项目未过滤 profile；必需 human criterion 被过滤；available=true 的 native 分支 clientCalls 为零并固定返回七项未执行。

## 三个整包及消费顺序

当前派工入口为 [native-mvp-02](../../../agent-tasks/native-mvp-02/README.zh-CN.md)。外部 A 仅改 `packages/environment-preparation/`，外部 B 仅改 `tests/native-acceptance/`；产品接线、公共 contracts/root lock、workspaces/verification/console 归主线。外部 checkout 在复核结束时均无工作区改动，未切分支；安装带来的 A 临时 root-lock importer 差异已仅恢复到复核前状态。

A 先关五项复现，再交可信环境凭证、复验/清理及进程注入 API 检查点，并继续完成整包。主线可先消费 API 写 fixture 接线，实际安装必须等准入。B 先用最新 main 的无依赖项目独立完成真实交付、必需检查 FAIL、运行中停止和 coordinator 故障矩阵，给主线产品复现；不等 A、不修改产品代码降低预期。

主线随后交付单包离线 pnpm 项目的 UI → 环境 → Codex → 注册检查 → 完整 patch → 接受/重开。安装写进程必须接入既有 independent Runner/资源屏障；worker 可写 marker 不构成删除权限，不能有第二个 Work 状态机或协调器隐形 installer。

本次未验完整 G2、带依赖产品、真实问题/审批、跨 harness、全崩溃矩阵或长期 soak。后续报告仍分 readonly、fixture、actual native 和未执行范围，不用测试数量或文档检查升级产品准入。
