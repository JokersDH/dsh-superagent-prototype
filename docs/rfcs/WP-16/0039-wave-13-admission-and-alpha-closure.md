# 第十三轮固定验收、完成度与Alpha出口

日期2026-11-12，main产品基线e1e0c97。用户要求验收A–E已提交成果、再派长任务，并说明当前完成度。本轮验收不把候选报告当全产品准入，也不撤销此前主线已测限定能力。

## 完成度结论

首期稳定内部试用目标69/100，约70%（工程区间65–75%）；完整方案B加权50.8%，约50%（45–55%）。计算依据见[交付项评分](../../roadmap/progress-2026-11-12.zh-CN.md)及[机器数据](../../../reports/releases/wave13-admission/progress.json)。不是测试通过率、工时比例或release PASS。

当前产品已有讨论/SSE、明确委托、worktree/验证/patch/接受、问题中心、明确决定/提案、真实SQL回复恢复和上下文历史/原文。主要发布缺口为活动任务控制恢复、进程所有权、当前personal安装/升级、独立gate和稳定性；多协议/CAC尚未接入，创新效果未证明。

## 固定source与实际闭合

| Owner | 固定source | 本轮独立结果 |
| --- | --- | --- |
| A | `d42a6e9b050be4f45df9cd69cc624b0f0a013d38` | storage87/workflows94通过；旧4反例关闭，新增source完整性1PASS/3FAIL |
| B | `9ec60270105e05b0a3c8d8264bec1f070fa43249` | 旧3/11和strict/68通过；新增JSON/诊断0PASS/5FAIL；新版B13基底6PASS/1NT但未证生产恢复 |
| C | `667bf74a118597369e050ea3f17b932a4b0e5666` | 旧8/17、四包269、当前main组合9通过；新来源链0PASS/6FAIL |
| D | `0ac2b58d4d861f066172dada6427de284219bd1c` | 旧6关闭；新6个mock及legacy复制1项仍FAIL；真实schema18产物成立但不是当前main全能力 |
| E | `90baa01b4b8aaf8b5834d2ba3228de6bfc950824` | A18独立进程回复4/4通过；旧安装143PASS/1FAIL/18NT仍schema16；3项关键case未进installed-alpha必测 |

这些HEAD与origin各自分支一致。保留B两份原共享报告差异、C root-lock差异和E38个原untracked runs；没有reset用户变更。新的复现与范围在[wave13证据](../../../reports/releases/wave13-admission/README.zh-CN.md)。

## 关键发现

### D：P1资源归属仍阻断真实安装矩阵

`identity.mjs:64`允许legacy record没有configRoot，只用复制根launcher.json自称归属；本次只对新spawn自有API复现STOPPED_ORPHAN，原API被停。旧新式record错config修复保留，legacy不能借此放行。

`upgrade.mjs:490/493`对record/journal PID未完整核对start；缺journal processStart或旧API PID复用仍可SIGTERM。`412/534`把ps失败或pidReused变成proven空集合。`766`的recover starting忽略requested install角色，错误根仍RECOVERED；实际target_stop_unproven入口还会停假复用API后REVERTED。新增6例全部使用mock inventory/signals，实际OS扫描/信号0。

修复应统一可信spawn/record/journal的PID/start/UID/root/operation和old/new install角色，unknown拒绝，不继续为每个分支加弱例外。修复前不跑宽范围真实cleanup/安装停止矩阵；不影响当前main workbench入口的已测范围。

### B：生产恢复证据仍缺实际产品链

新版B13确实使用真实ProductStore、新协调子进程SIGKILL、binding和认证cancel，比原内存/自建表前进；但`fixtures/b13-attempt-process.mjs:59`仍只写任意command body并inspect socket。writer在Runner fixture启动时已spawn，未被产品begin命令驱动。

独立插桩得到B13六个PASS时，Work/Ticket/effect/fact_receipts/dispatch_receipts/answers/answer_deliveries/user_questions/runtime_current/runtime_authority均0，只有command_receipts3、binding1，worker starts1/cancels1。因此不能证明生产begin/question/answer恢复。真正生产入口在main已有ProductExecution.effects→execute→runtime.launch/feed→committed fact；回答经handleQuestionAnswers→nativeFence→allowAnswer→send。

`review-sender.ts:223`嵌套BigInt/NaN和Symbol key仍reserve/send后才出错或丢值；应结构化核对实际JSON payload。`runtime-diagnostics.ts:349/401`的version/versionRaw及嵌套detail/invalidation/observedFrom仍泄露私有路径。这些helper未被现用main产品消费，不是当前个人路径已证明的权限绕过。

### A：完整逻辑源仍有三个反例

扫描从rowid>-1开始，负rowid行内容变化被漏读；ignore仅验activation的部分列，target_json与body不一致仍被忽略；command event payload改为rejected也仍被排除。三者均返回complete旧fingerprint。普通业务行变化正对照会改变摘要。

这是候选RecoverySourceStore完整性缺口，main尚未接入该reader；已有history work校验/回复/备份scope保留。复用已有严格fact mapper与同事务核对，不能把逻辑complete当物理writer停止或启动权。

### C：跨层Scope、coverage、回复身份和元数据边界

`relevance.ts:188`缺trusted Scope仍选decision；`composer.ts:661/815`同项目private decision进入src grant，且实际scoped provider complete=false丢成sufficient/manifest complete。main现用外层scopeWithin/扫描issue/最终同步guard有效，不能移除。

`history.ts:143`只匹配source/project/conversation，仍附加foreign principal/request/reply/model/artifact；应经main完整回复reader或准确可信读取port。`source-review.ts:239/163`遗漏数组无独立上限，5000 omissions输出365081bytes，detail路径未脱敏。预算须明确内容、遗漏/diagnostic和固定开销，不将任意小content预算误称整个JSON大小保证。

旧八反例与四包269、新真实A18无Map组合改进成立；9项当前main组合未读取SSE，也没有证明新factory已替换main私有provider。main仍固定save suggestions=[]，纯validator导入不等于自动候选产品完成。

### E：验收工具不能继续忽略声明的发布case

`release-requirements.mjs:142`的installed-alpha没有E7-OWNERSHIP-COPY、E4-UPGRADE-FAULTS和E6-CURRENT-MAIN-INSTALL。真实E7 FAIL未参与该tier；当前tier仍因其他NT失败，不能据此说它已错发PASS，但必测缺口必须关闭。

`e4-install.mjs:1093`用target建库后强制schema变化，当前18对18会误FAIL；1181仍无条件NT，217的installed context强制fixture不证明personal。`build-handoff`固定旧stop/缺history叙述需按actual cases生成。main e1e0c97有history/source API/UI，不能重复旧missing-entry结论。

## 发行字节范围

真实新D tar为`wave12-target-020af82.tar.gz`，source `020af824390e9230a4ff9d01f9e29b1ee93dd246`，build `1a2f34ac359a5739`，SHA256 `96d32fb55a0d8fa9a02f4a5497c54774e84176b42c5727da449343fb3913bfe5`，20147268bytes。6707项文件库存/内部21条symlink核对，实际schema18、Node24.21.0/darwin-arm64/ABI137/SQLite3.53.4。含旧context prepare/send和真实reply结果，缺新history/sources HTTP；不是当前main全能力安装。

E当前安装结果仍a22d3a4/schema16，不能表示该schema18包通过或失败。下一轮先修所有权，合并当前main冻结新字节，再给E独立personal/current capability验收。普通安装不等待target激活或BLOCKED研究。

## 本轮报告保全

旧wave11 context探针忽略PA_ADMISSION_REPORT，把本轮17PASS写回历史context.json；来源已确认是本次审计调用。新观测先归档到wave13/context-previous-boundaries.json，原历史文件恢复HEAD字节并验证无diff。工具已支持显式输出，并将静态旧计数/行号标historical；本轮包数量以新实际执行为准。

## 下一轮出口

[第十三轮整包](../../../agent-tasks/product-wave-13/README.zh-CN.md)每人十阶段、早/中/最终source后继续。A交严格源数据，B先交真实产品纵向控制，C交可替换来源链，D先统一归属再发当前包，E先修gate后验新字节。main先交无执行器实际启动/禁派工，再完成C/候选/source/target消费者；主线欠项不能转给A/C/D/E或阻断其全部独立工作。

本轮不扩大功能范围/预算；无新Driver/CAC/桌面壳/自动接受、writer racing或动态Ticket DAG。所有自动模型/native0，原账本/十组服务/state/原worktree/分支/旧tar保留。只有明确本次自有资源可停止；每个实验/安装/native/value范围独立报告。
