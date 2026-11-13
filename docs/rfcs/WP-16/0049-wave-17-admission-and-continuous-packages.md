# 0049：第十七轮交付验收与实际确认后的长包

2026-11-13，wave16独立验收固定main7a2f9e9/产品1169535。审查期间main另交实际source确认e32a3fc（[0048](0048-actual-source-confirmation-checkpoint.md)），所以旧审查中的source确认NOT_REACHED只描述先前时点，下一包已可直接消费。十二组用户服务/状态/预算不变，无真实vendor/native发送。

## 固定source与实际通过范围

| Owner/source | 独立验证 | 保留范围与未到项 |
| --- | --- | --- |
| A58a22e26a7ea48f4c081d4d7d20d333a97a1092b | 原snapshot4/4，storage87/workflows109、strict/build | v2 exact21family及真实SDK候选/问答数据恢复成立；新混版本/缺空表两反例未关 |
| B8d7ddce71be191cab9789c78c3592fc1c7ee1905 | B16新3PASS+1NT，两个模块strict/exactOptional，Runner针对17，normalB13 6PASS+1NT | 真实独立Runner begin1、dispatch/turn2事实成立；是receiver half，无App/A Store/Broker/子writer与业务恢复 |
| Cf56f17cecd688348e941b9caa9e31acca4f794cb | 原wrapper4，四包124+40+93+44=301、strict/build | 已真实消费SDK candidate GET/prepare/三kind/confirm/replay；nested getter仍P2，不是主线公开权限绕过 |
| D6f05ab5045e48e15dea05b82ad85e075791562ed | 旧child/UNKNOWN4，新tar6731项闭包 | foreignUID/discoveredUNKNOWN/CLIexit旧问题关闭；sameUID child独立身份仍P1 |
| E79e0ab5eb6b0624e84ca00d37ca2a98537ae9715 | 旧7行为反例及真实成功正对照通过 | 新NO_OP/exit1及缺pointer两反例未关；171PASS/17NT仍旧8962d10 |

新问题不撤销旧已过scope，也不整包认证这些候选。A/C仅第二根数据/Store审阅不等于恢复只读runtime/HTTP、old queue held与无重发已测。B未提交b16-real-begin保留、未执行，不计提交交付。所有脏report/lock/runs保持。

## 实际剩余问题

### D：sameUID不替代child出生身份（P1）

`apps/launcher/lib/upgrade.mjs:591/596`只补child UID，仍按树和路径认领资源，未核对child独立start/argv/config/data/install/operation。同条件完整parent正对照通过，sameUID未登记child被SIGTERM，startReads只有parent；actual recover同样信号child并REVERTED。新1PASS/2FAIL，全部mock，无真实信号。

需要完整registered-child正对照与unknown child不发信号/不推进pointer的真实入口约束，不是继续加一个UID分支。门未过不跑广泛live生命周期。

### B：准备契约尚未加入产品（未交付）

新B16真实Runner PID与协调器不同、receiver begin1、dispatch.observed/turn.ended两事实是实际成果，不能沿用B14零表/字符串服务结论。但sink仍内存数组返回persisted:true，未开A Store，因此业务行是NOT_MEASURED；默认fake无approval/question，无独立子writer。

`runner-service-entry.ts:37`在codex-fake关闭eager preparation并使用不会发policy.prepared的Driver；main NativeProductAttempt等prepared后才feed begin。下一步是保留原CodexProductDriver和guard，让B-owned fake executable完成真实准备协议，再加入原App/A Store/Broker；不能把此不匹配称为main必缺hook，或删除准备守卫求通过。B2–B9恢复port/回答停止/资源/有效epoch/交付/槽位尚未交。

### A：版本降格与缺空表（P2）

`packages/workflows/src/snapshot.ts:223`允许snapshot/1+evidence/2且缺familySetVersion进入弱子集校验；保留完整当前v2及fullqueue篡改拒绝正对照后，混配删除queue族仍放行篡改。`packages/storage/src/backup.ts:135`又将缺required空表当空family；删assistant_reply_results并重记DB hash，完整v2仍verify ok。新2PASS/2FAIL。

版本必须配对，required schema必须实际存在，不靠count0掩盖缺表。旧真实v1以明确能力兼容，不能用标签降格当前完整性。这些新snapshot slice未整包接入main，既有source确认/reader范围保留。

### E：终态/exit和pointer存在性（P2）

`tests/product-acceptance/lib/release.mjs:390`无差别接受exit0/1；实际target_unhealthy NO_OP/exit0正对照只改exit1仍过。旧RECOVERED_PREVIOUS/exit1历史不能免责NO_OP/exit1，D当前CLI已正常映射成功终态exit0。`:393`又让缺pointerBefore/After的undefined===undefined通过。新1PASS/2FAIL，完整六case实际证据正对照通过。

E要独立断言状态/exit、operation及present pointer身份再判断关系，不能用recognized-status OR exit0或放宽required集。

### C：nested未知输入（P2 helper）

`packages/proposals/src/reply-candidates.ts:341/360`对nested body.replyMessageId和principal getter仍抛异常，outer getter控制和typed非空正对照通过。仅helper健壮性，未发现main公开权限绕过。新包低成本修边界后继续真实readonly用户流程，不把主线当前候选重新标缺失或手造。

## 当前准确冻结包

D tar`/Users/hh/Desktop/joker/pa-artifacts/wave16-target/wave16-target-97cace7.tar.gz`，source97cace735c6cdbdd7ecdade05132371da1a5273c clean，build8a5a0a85631f22ca，SHA6b6517c441e56405ac9929ffbd7b3e3c8149b217c5ea736a2d9a447b4b4546c3，20218294 bytes。6710文件及21内部symlink共6731项全部核对，schema18/darwin-arm64/Node24.21.0/ABI137/SQLite3.53.4。

实际字节含1169535非空建议存储、候选HTTP、私有偏好及console。它早于main新e32source确认，不能重贴该后续API；普通建议版scope有效。E171PASS/17NT对应测试4a71624、产品8962d10/build88df6d2eef1feeb7；旧包candidate404是时间范围，不是当前main回归。installed-alpha因required独立D mock NT仍FAIL。

## main新增实际出口

最终6050b4b又补actual Store root绑定，14项新场景和clean组合106通过；它是本轮最终运行基线。下文e32a3fc为首次发布检查点，数据scope和未开放权限不变。

e32a3fc发布source prepare/confirm/audit消费者，13项新HTTP/独立进程场景通过；clean源码恢复/候选/提案组合105通过、contracts230/strict/generated通过，wire hash不变。原source事实/事件/receipt同UoW，postguard经A exact ignoreCommitted复核原完整源，额外写回滚，原token只重放原事实。仍无target/queue/native动作和私有许可，旧十二实例未重启。

下一包A/C/E直接消费，不再等待“main缺source确认”。main继续真正私有host/resources/target许可及获验B/D组合。普通personal冻结与独立E安装不等激活或BLOCKED试点；冻结准确变化字节后再最终验，docs-only提交不重复打包。

任务见[wave17](../../../agent-tasks/product-wave-17/README.zh-CN.md)和[分别转发话术](../../../agent-tasks/product-wave-17/forward-prompts.zh-CN.md)，报告与可复验工具见[验收记录](../../../reports/releases/wave17-admission/README.zh-CN.md)。每人十阶段、三个可运行checkpoint，提交后继续独立队列。自动模型/native0，旧B UNKNOWN和E BLOCKED预算不变，无新Driver/CAC/桌面/自动接受/动态DAG，releaseApproved=false。
