# 里程碑04续工：从组件交付到可用安装和第二协议

2026-11-26。分别转发下列三段给B、D、E；沿用原目录/分支，不启动其他队列。仍是原M04的13项，不是新wave，不增加预算或验收项。先读根AGENTS、[M04](../../docs/product/MILESTONE-04.zh-CN.md)与[RFC0096](../../docs/rfcs/WP-16/0096-milestone-04-protocol-admission-and-target-authorization.md)。原开工话术的持续责任仍有效，本页补充实际验收反馈和现在已可消费的接口。

当前可消费主线代码：`33a69f44`（诊断闭包、公共兼容和显式试用投影）及`4af915f2`（恢复只读下关闭逐操作可用状态）。先合入origin/main中的这两个代码检查点；仅共享文档变化不要求再次测试或打包。

## 这次验收结论

| 交付 | 核对结果 | 接受范围 |
| --- | --- | --- |
| B `6c0207a0` | 兼容分类、Codex schema探测和ACP组件已写；main复现14个相关组件测试通过，但ACP原输入消费另有实际FAIL | main只接5个诊断源码/测试文件，ACP/Runner工厂不进默认路径 |
| D `ddfd01b8` | 0.1.2 DMG的真实引擎仍为旧source83f79e82/buildd3ba | 打包链样例保留，不是M04 F0；只读support修复已在main，不重派 |
| E `3a54438a` | 报告明确HARNESS_ONLY，兼容/恢复BLOCKED、同事实测NOT_TESTED；部分判定只看字段存在，清理直接按PID signal | 保留工具准备和旧包观测，先修消费者，暂不导入运行 |

当前L1 0/6、L2 0/7。不是否认源码进展，而是原清单要求实际入口和准确包旅程。49项主线契约/原HTTP投影/诊断/既有Codex协议回归通过；没有因此关闭版本、ACP或跨机条目。本次主线没有真实模型发送或故障信号。B报告6次新prompt尚未使用，后续先建立本轮独立实际发送记录，不能用旧ledger推定可花余额。

## 发给 Agent B

```text
继续原M04第二协议整包，不开新wave。你仍在 /Users/hh/Desktop/joker/superagent-agent-b，分支 codex/g1-runtime，保留原dirty、b16和旧reports，不清理。先读取origin/main最新的M04、RFC0096和本续工文档。不要整枝夹带旧Runner/信号/接管候选；共享contracts和根lock由main写，I的attach-channel不动。

本次6c0207a0按“源码检查点”接收，兼容/Codex诊断5个原文件已由main精确导入。ACP包和Runner工厂暂不准入。你连续负责修到原产品真实旅程，不要修完组件再等待下一次派工。

先闭合三个直接阻断：
1. ACP serve必须解析原ExecutionInputSchema和合同身份，再发任务正文；现在index.ts:321把command.inputRef引用当文本。main实际零模型repro已失败：/Users/hh/Desktop/joker/pa-artifacts/m04-admission-20261126/acp-input-repro.mjs。按原PreparedExecutionPolicy/policy.prepared/preparedPolicyRef流程，在执行策略可证明生效后才begin；缺scope不能补成全目录。Runner准备不能只覆盖codex-native。用正常payload引用做consumer，不能把引用和内容合成一个测试字符串。
2. 解析原nativeBindingRef/answerRef指向的NativeQuestionBindingSchema、NativeAnswerPayloadSchema和parseQuestionAnswer，核原target/session/question/version/command/合同。不能把answerRef当optionId或正则猜allow/deny。创建ACP Driver必须传入并逐次调用原beforeAnswerWrite新鲜guard，未知/过期/错target都零原生写；response_written不伪报native_applied。
3. reconcile看到turn.ended/runtime.exited不能单独报告writer=quiescent；沿原完整资源/owned runtime核对，UNKNOWN保持占位与材料。cancel应答、prompt结束和自然终态后的stop不算运行中停止；控制与清理都走原资源屏障。

同时把选择证据做实：B41的a/b/c/d固定digest和写死版本不能当真实兼容身份；acpObservedSurface把required复制成observed不能证明权限/cancel/ID已观察。保留旧报告，不重写。以精确本机CLI/适配器/版本/真实可执行摘要、受审配置指纹及实际initialize输出建立新观察，每项写advertised/observed/controlled/native的真实层；只握手成功就只记握手。probe也使用原自有进程身份和正常退出，不在finally裸kill或绕过refusal。未证明的enforcement保持阻断，不凭“会弹审批”伪造sandbox/网络/凭据限制。

公共接入接口已在main：packages/contracts/src/execution-compatibility.ts，ExecutionProfileView.compatibility与trialAdmission；apps/coordinator/product/execution-profile-view.ts把你的一份CompatibilityVerdict投影为公开DTO。protocol-only不能enabled；未知兼容须inspection_passed，不能native_test_passed；显式试用必须引用当前identity/policy与确认命令。它们只是事实/展示，不是你可自行写造的授权。main负责真实consent回执和默认多profile接线，你交共享probe、明确ACP策略构造/解析接口和Runner工厂，别私造第二套公共类型。schema检查还应验证实际使用字段的类型/必填/审批枚举和ID，不能只看名字，未证范围如实unknown。

早交修好的最小完整闭包和一个经过原Runner/AttemptIO的消费者，main接默认工作台后继续联调。准备真实发送的入口必须复用main工作台/HTTP原Ticket/Assignment/Broker/检查/候选/接受，不另写一个CLI直接跑成功冒充产品。新grant共享总上限仍6次、单在途、你唯一发送；先做0发送dry-run和持久计数，再由main明确给“准确source+consumer已就绪”后执行。此文不是LIVE_READY，不是追加6次。main/D/E不另拿额度。UNKNOWN发送占额并核对，不能换ID重发；旧cap4和旧研究grant不碰。

在同一责任内完成真实交付、审批允许/拒绝、运行中停止和原屏障，再写一次抽象复盘；未触发/未达/unknown如实保留。修复消费者后继续同一结果，别交一个探针就结束；若main实际接线尚未准备，继续安全的原payload/权限/策略/资源消费者，不开展其他功能。检查点三行：L1/L2进度、剩余与下一consumer、需要用户决定的事。
```

## 发给 Agent D

```text
继续原M04同事可用整包。仍在 /Users/hh/Desktop/joker/superagent-agent-d、codex/g3-local-distribution，保留原root/历史。先fetch并消费origin/main最新源码、M04和RFC0096，不回退旧source。原apps/launcher/tools/distribution/packages/portability及M04列出的精确desktop工具临时归属不变，共享docs/根依赖/contracts由main写。

6754e6cb的只读support修复已被main以a784d65c接入，main还对真实旧非空DB独立验证了文件/表不变和脱敏，不用重复修。ddfd01b8的0.1.2虽是新外壳，artifact和stage引擎仍是83f79e82/d3ba；只保留作打包样例，不称M04 F0、不发同事、不据E旧HARNESS_ONLY写本轮已验。

这一整块持续负责到“安装应用能选择已授权的新工作区，正常启动/重开并给E准确包”。先做可运行入口，不急于再打包。main已有默认恢复UI/HTTP：source prepare/confirm→targets prepare→targets authorize；GET /v1/recovery/targets/:id/authorization是原未知请求的核对。新授权只写目标原command_receipts，历史来源及held队列不变。准备目标的recovery-target.json不是执行权；demo使用apps/coordinator/product/recovery-target-authorization.ts的verifyRecoveryTargetStartup重验原grant。

请在原桌面窗口/preview/launcher给出普通用户能操作的“打开已有工作区/恢复后目标”入口，路径只作为选择，不能代替授权。当前host/principal、目标根/父目录/DB身份、material/generation、profile/config必须匹配原回执；没有grant、换根/DB/父目录/profile、unknown都拒绝执行并保留现场。旧restore来源只读，不删marker，不把历史库改normal，不复制账号/权限，不自动重发旧Work。与main协调所需最小consumer，不自行SQL/私有授权表。应用的路径选择偏好可以本地保存，但绝不能变成执行授权，也不能改用户原实例。

兼容部分只消费B经main发布的一份判定和公共ExecutionProfileView.compatibility/trialAdmission；不要在start/doctor/preview又维护三张版本白名单。相关DTO在packages/contracts/src/execution-compatibility.ts，main投影在apps/coordinator/product/execution-profile-view.ts。未验证兼容明确提示、仅开已核能力；inspection_passed/initialize成功不代表真实测试通过。main实际consent与probe消费未就绪时保留阻断，并继续新根入口/正常启停/诊断联调。

零模型做真实源码/安装入口consumer，覆盖授权前拒绝、原回执重开、正常新业务不破坏grant、复制/替换拒绝、中文locale/空格/重复打开。所有测试先确认无故障信号入口；原正常stop/退出拒绝即保留unknown，不裸kill、不全局找PID/端口。你没有模型发送额度，不代同事下任务。

等兼容产品消费和新根普通入口都进入main、main点名准确source且E消费者就绪后才冻结F0，包含所有新增源码/依赖及Node完整身份。D/E两边先核相同source/build/DMG SHA，E出结论前字节不变；不追HEAD、不为文档或测试变动换包。若依赖未达，只交source和具体阻断，不再封旧引擎成新版本。主线会给同事一页说明；用户本人联系同事，你持续跟到最终安装阻断修完和E同包结论。检查点三行，不另开维护队列。
```

## 发给 Agent E

```text
继续原M04独立验收整包。仍在 /Users/hh/Desktop/joker/superagent-agent-e、codex/g3-product-acceptance，只改tests/product-acceptance，保留旧ledger/证据和dirty。先读取origin/main当前M04、RFC0096及本续工文档。你的3a54438a按工具准备接收，旧包HARNESS_ONLY结果有效但不算M04跨机或新授权通过。

下一次运行前先修m04-consumer：253/270/301/306等裸child.kill(SIGTERM)要去掉，优先正常应用退出/原包stop。任何必要普通stop升级都须原spawn不可变身份、全资源计划预检和新鲜出生/UID/full argv核对；missing/timeout/unknown保留现场，不能事后仅看PID不存在就写完整清退。禁止故障信号和全局进程/端口枚举。不能为清理旧失败现场绕过refusal。

替换“猜字段/字段存在即PASS”的判定：372行compatibility.state=present不能令L1①PASS。公共契约现为packages/contracts/src/execution-compatibility.ts，profiles[].compatibility.classification/nativeVersion/protocol/schemaDigest/checkedAt/operations，trialAdmission单列explicit_trial及身份/策略/确认命令。用真实原configuration HTTP和工作台实际按钮/后端拒绝核各类状态，unknown/incompatible不执行，protocol-only不启用操作，trial不冒充native_test_passed。至少另一个实际安装版本是整项门槛，fixture反例或字段存在不能替代；无法获得时L1①部分完成。

恢复也不再从configuration里猜recovery字段。运行main实际默认恢复consumer：source prepare/confirm→targets prepare→targets authorize，GET targets/:id/authorization核同ID未知回执。以原source Store只读指纹/held队列、目标原command_receipts/EventLog/material/generation独立断言：不写source新授权、不重发旧Work、未授权目标不能执行；换host/root/DB/父目录/profile/config拒绝；刷新不产生第二授权。main tests/integration/recovery-target-authorization.case.mjs给可跑消费者，你定义自己的断言，不能直接相信其stdout PASS或在Store里填成功值。先审脚本无signal再运行，不跑历史fault实验文件。

consumer source早交给main后持续联调D的普通新根选择入口与B修复后的真实产品payload/答案/资源路径。没有D/main点名source就只做源码准备，别找旧d3ba包凑F0；没有原数据的能力明确未达。你模型发送0，B共享6次不归你；B实际原数据可以只读核对，不代发prompt/approval/stop凑覆盖。

main点名、D冻结准确F0后，自己核source/build/DMG SHA/manifest/Node，再独立从该包完成首次打开、能力提示、正常启停、恢复新授权到正常入口。少依赖开发仓、不依赖global Node/pnpm；绝不把旧cohort PASS搬到新包。发现阻断给最小repro，修复后只复验受影响旅程，最终仍同一准确包结论。

真正跨机首次开发和非空恢复后的第二个新Work必须由同事本人，用自己的账号/项目/额度操作；用户本人联系并转交。只核同事主动分享且预览过的metadata/步骤结果，不收源码、数据库、账号目录或日志全集。自述和可核对事实分开，缺证NOT_TESTED。不要因main49项测试或接口存在提高进度；持续到同包结论，检查点三行、最终一份汇总，不开全面oracle维护队列。
```

## main 同步责任

主线已经接入B最小诊断闭包，新增公共兼容/显式试用schema、`executionProfileView()`和原runtime configuration消费，并通过原认证HTTP验证。诊断本身默认不授予dispatch，原默认startup仍只使用已准入Codex；新DTO并非实际consent回执。

我继续负责实际版本probe进入默认startup、逐profile注册与策略/恢复解析、显式试用consent的原回执及后端控制/UI提示。B不修改这些main路径，D不另造准入表，E不以新字段自判通过。B给实际ACP策略/Driver闭包后，main持续接同一个工作台消费者；未就绪不宣布LIVE_READY、不消耗共享6次。最终只在两条线的原出口成立后计分、考虑启动M05；不立即派C或唤醒待命agent。
