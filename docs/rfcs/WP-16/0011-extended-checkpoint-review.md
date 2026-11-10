# 扩展队列交付复核与剩余准入

日期：2026-11-09。主线已发布 `04871fb`，M1 可信环境 port/真实 Git 回归与 M5 操作诊断可消费。A 最终候选 `b6dd261`（实现 `8dcbdce`、`8a5ded3`），B 最终候选 `e392fc5`；本轮未整枝合入它们，也未启用环境安装。不要用各自 final 状态代替独立准入。

## A：原五项已关闭，三项仍阻断

主线用 immutable git archive 复验了早期接口提交和最终提交，避免读到工作区中途改动；依赖链接只读复用 A 已安装目录。原五项全部 PASS，新三项在两次候选均 FAIL，见 [最终环境复验](../../../reports/releases/native-followup/environment-final-review.json)。A 自报的 31 项仅保留包内范围。

```sh
node tools/bootstrap/review-environment-preparation.mjs --environment /Users/hh/Desktop/joker/superagent-agent-a --candidate b6dd261
```

- `ENV-TRUSTED-BLOCKED-CLEANUP-PRESERVES-UNOWNED`：显式 authorityRoot、坏 package.json、预置伪造 v2 marker 时，blocked.cleanup 仍删除未归属的 node_modules 内容。blocked 与 stale/reuse 分支必须与 ready 一样使用调用方私有证明；不能只修这个 JSON 错误入口，worker marker 在所有分支都不是删除/认领权限。
- `ENV-PROCESS-OBSERVATION-UNKNOWN-IS-NOT-CONFIRMED`：真实子进程正常退出，受控模拟进程组观察 EPERM，standalone port 仍返回 confirmed。只把 ESRCH 等明确证据认作不存在，观察失败保留 unknown/indeterminate。
- `ENV-COMBINED-STDOUT-STDERR-LIMIT`：两个流各写 15 字节，合并预算 20，实际捕获 30 且 outputLimited=false。预算按合并字节计量，输出和终止语义都需回归。

A 优先在原包修这三项，保留 A4–A6 增量，再交早期稳定修复检查点并继续自己的回归。主线可继续消费已发布 interface，但在独立准入通过前不添加产品安装路径。不要修改 root lock 或主线源码来绕过准入。

## B：工具仍有误报，故障矩阵未完成

主线重跑 B 的 selftest 为 14/14；另外用有效共享配置及无网络 fake client 复现两项 FAIL，见 [验收工具复核](../../../reports/releases/native-followup/acceptance-final-review.json)：

```sh
node tools/bootstrap/review-native-acceptance.mjs --acceptance /Users/hh/Desktop/joker/superagent-agent-b --candidate e392fc5
```

- `NATIVE-LINK` 在 create_work 受理后就 log.pass，之后没有候选的 log.fail 已不能改变该 case，实际缺候选仍 PASS。一个用例必须在全部必要断言完成后才终结；任务计数也不能仅由发出无效命令推定。
- 自动发出的 continue_work 使用 workId 而没有 expected，违反共享 schema。create_work 已会排执行 effect；continue_work 是已结束工作创建下一合同版本的命令，不是首轮启动步骤。保留同 commandId 核对，去掉错误的二次启动假设。

B 报告的“base/head 相同没有 diff”不构成产品缺陷：未提交 worktree 的完整 patch 是独立产物，不能用两个 commit 的 diff 替代。主线本批给 manifest 新增 `patch: {artifactId, sha256, bytes, format}`，仍保留原产物顺序。下载这些实际字节，校验并在 base clone 上 apply；旧候选清单没有该字段时，使用既有第二项 patch 产物，不因此重跑模型。当前主线的 location 在候选、接受和重开后均已验证；B 的 null 位置需要准确源码/实体/响应复现，不能用它停止其它停止/重启用例。

Playwright 也不是新增根依赖阻断。主线在 B checkout 已实际确认 `apps/console` 的 `@playwright/test` 可解析，Chromium 可执行文件存在；使用现有声明而非从根目录查找未声明的 `playwright`：

```js
import { createRequire } from 'node:module'
const { chromium } = createRequire(new URL('../../apps/console/package.json', import.meta.url))('@playwright/test')
```

`B3` 当前六项仅是部分命令/游标检查，旧问题断言还使用非法字段，400 不证明合法旧问题被拒绝；`B5` 只做创建/重放，未等待实际执行、问题、停止或重开，不能称执行稳定性；`B6` 只读 profile 元数据，未知能力用的是已实现命令且两分支都 pass，不能称 Driver conformance。先把这些状态降为已测子集/待完成，再按原任务补实际行为，禁止以配置断言替代运行断言。

B 继续原目录/分支修复工具和完成 B2–B6。优先复用已有候选补 patch/accept/reopen，剩余两个原生任务优先停止/重启；不额外计费补刷 happy path。真实机器 FAIL/问题若额度或能力不足，明确未测并给下一消费者准确缺口；所有 fixture 扩展仍可独立推进。Native 新项目必须自己创建并通过公开项目导入，不以默认用户项目代替私有 fixture。

## 主线结果与下一步

主线新增交付清单的补丁引用和 HTTP roundtrip 校验；产品 14 项、typecheck 通过，当前 location 的待审/接受/重开保留也通过。整包受控回归与发布记录另列，未运行新模型。当前用户服务保持运行，本批后端变化在下次正常重启后生效，doctor 已可立即使用。

M2/M3 的生产依赖准备等待 A 准入；M4 的真实停止/恢复缺陷等待 B 提供有效独立复现；主线已有接口、诊断和完整 patch 交付继续可用。A/B 只在各自拥有目录修复和 push；原队列仍有效，复核不是要求用户重新讲述历史或扩大模型额度。
