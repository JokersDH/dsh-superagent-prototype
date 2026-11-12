# 第十一轮验收与长任务边界

日期2026-11-12。审视基线main `7f7bdd7`，当前产品4140cac/schema16，新增共享输入98a50ca。用户要求重新验收，并让A–E连续开发较久；本包按十个有独立成果的阶段组织，每人交早期、组合、最终三个稳定检查点，依赖缺失时继续独立队列。

## 本轮实测结论

| 角色 | 固定source | 保留通过与剩余范围 |
| --- | --- | --- |
| A | `8a91958c5e3ef9afe35555bd92f0d3b0418128b8` | 与已按路径集成的source一致；reader/v16/context绑定及备份既有准入保留，不重做已关闭三反例。其“main无context-use”是旧基线描述。 |
| B | `b4e2031ce819168ec688309ee5a3b11d766c4688` | 旧七case、68 owned、普通strict通过；新probe7 PASS/4 FAIL；持久重启仍NOT_TESTED。 |
| C | `2c2598524b9bd253f2a68d47558e35ec3beeb667` | context78/proposals26/knowledge75通过；实际新export probe8 PASS/9 FAIL，当前main私有adapter/完整指纹不受影响。 |
| D | `fe01c3c541e5f3fb870119f637ab067cb0aee8bc` | 旧upgrade/accounting/material7/7和跨source准备7/7保留；新通用stop probe2 PASS/1 FAIL，有跨state终止风险。 |
| E | `c12c15e0def25c84c490b70acdd89406759e5ca6` | 独立发现stop跨state缺陷；现报告仍旧schema15安装组合，current-main/schema16/context-use未独立准入。 |

A/B/D固定source干净并与origin一致；C保留其原有root lock差异，测试源码与origin一致；E已有untracked runs保留。B–E多数基于f99ca39，不能把未合并后续main的“入口没发布”当当前产品缺陷。完整命令、摘要、结果和限制在[wave11证据](../../../reports/releases/wave11-admission/README.zh-CN.md)。

### 先关闭的实际问题

1. **P1，D通用stop**：`apps/launcher/lib/stop.mjs:34/:53`只验证record自身，没有比较调用者requested data root。独立受控测试请求A、record属于B时仍STOPPED_ORPHAN，B临时API被杀且记录删除。只使用本次spawn的PID，无用户服务/CLI/全局扫描。这不撤销此前独立upgrade/accounting修复。
2. **B消费者类型/输入**：`review-sender.ts:134/:161`在main实际`exactOptionalPropertyTypes`下仍两条TS2379；无法structuredClone的input被替换成refused占位值后仍reserve/send；runtime-diagnostics的shell路径解析不支持合法空格绝对路径。main当前未消费这些新helper，不是现用个人路径权限漏洞。
3. **B/E协议**：E guardedSend传flat字段，B module-level send却取nested admission，实际落entry mismatch拒绝；export存在/回显reservation不等于协议闭合。当前inert且研究仍BLOCKED，只需有限拒绝协议对接。
4. **B持久恢复证据**：B12重建的是内存对象，没有SQLite/真实进程重启，optional-call的recover不存在；实际新对象deliver为attempt_not_running。原证据仅支持内存范围。下一消费者应跑真正SQLite+子进程重启，不要求强加名为recover的方法来迎合旧probe。
5. **C边界**：question锚点、未选work的工作补充被纳入，合法reasoner_reply被排除；maxIds限制返回数却没有限制missing lookup次数。新adapter不能直接替换main现用实现。
6. **C完整性**：manifest换sourceId/实际预算仍unchanged；prompt末尾换行使bytes/token超一，且上游truncated被清成false。均为实际候选export复现，非固定旧recipe。
7. **发行来源**：D最新tar为cf7a3cf/schema15/build da2d78d126e4745f，真实SHA/size匹配，但解包确认缺selected-context send/audit；E实际仍6830e38/schema15。二者都不能表示当前main/schema16已安装通过。

本轮只按路径接入C已确认proposal replay的expectedDigest校验及三个main-path测试；没有接新adapter、sender或launcher。proposals26/26和main实际提案集成10/10通过；原main运行能力与九组用户服务保留。

## 三个已发布数据接口

接口仅为稳定开发输入，不计新产品功能完成。冻结Runner/data hash不变；唯一迁移仍A拥有。

### 恢复源逻辑快照

`RecoverySourceReader.inspect(query)`在`store.workflows.recoverySource`提供，schema位于[recovery-source.ts](../../../packages/contracts/src/recovery-source.ts)。它读取源库的全部相关逻辑族、完整性与摘要，不读取marker/宿主机/profile，也不给启动权。startupAvailable固定false。

sourceFingerprint覆盖schema、所有必要业务/资源数据及稳定source writer身份；不把observedAt或全局event cursor作为内容比较值。唯一可忽略的自有变更是`ignoreCommitted`所给、且与源库真实fact/原receipt一致的那一笔recovery确认：其activation row、对应command receipt和确切intent事件。任意其他receipt/事件/业务变更必须可见；不得忽略所有控制或资源记录。

允许固定忽略`coordinator_instances.heartbeat_at`，PID/nonce/start身份不忽略。before-commit无ignore与after-commit忽略本笔确认时，逻辑sourceFingerprint应相同；观察游标和忽略说明可以不同。未知/缺表、越界、损坏、超扫描预算返回bounded/unsupported，不能以空列表放行。main另验marker、machine/profile和物理资源，这个摘要不替代认证proof。

### 上下文历史

`AssistantContextHistory.page(query)`在`store.workflows.assistant.contextHistory`提供，类型位于[assistant-records.ts](../../../packages/contracts/src/assistant-records.ts)。按main授权projectIds和可选conversation/work过滤，keyset分页、稳定tie-break、单页最多100；低层raw cursor仅数据续页，公共cursor由main签名绑定principal/筛选/期限。

读取历史绑定不会重发模型；过期绑定仍可作为历史查看。main负责按当前用户范围提供冻结来源正文/标题/摘要及missing状态，C只做有界投影；不把历史来源或模型文字当新执行授权。

### 已完成回复数据

`AssistantReplyResults.forRequest/forReply/put`在`store.workflows.assistant.replyResults`提供。`AssistantInferenceRecordSchema`准确描述现有before-send receipt.result；它是发送前记录，不是成功结果。新`AssistantReplyResult`只记录真实已返回的完成数据引用，关联原requestDigest、源/回复ID、项目/会话/principal、model、artifact/text摘要，双identity不可变。

`AssistantReplyBody`为有限text与既有ReasonerProposal候选数据，最大512KiB；候选原source/project必须匹配，正文不携带actor/tool/command权限。root保存结果artifact和A记录后再发布回复/候选；若回复事务失败，重开用同一结果补齐，不再请求模型。只有before-send receipt而没有完成结果时仍unknown，不猜成功、不补发。

这不是新的推理/执行生命周期。候选进入用户明确预览/确认的既有ProductProposals路径；格式不支持时保留普通回复，不能为修格式自动多调用一次模型。副作用、HTTP、provider/SSE/UI归main，A只管同connection持久化与backup，C只管校验/投影。

## 十阶段整包怎么长时间推进

每人先完成1–2阶段并push早期可运行checkpoint，随后连续做到组合、故障窗口、规模/兼容和交接；在4–6阶段交第二个稳定source，最终交完整报告。三次检查点是供消费者接入，不能成为等待用户回复的停点。

外部依赖只阻断对应组合验收；给出exact source、最小复现、缺失owner/输入后，切该packet独立队列。全部可独立内容完成后再如实NOT_TESTED剩余依赖，不能无限轮询、重复空测试、增加模型任务来凑时长。每包范围见[wave11任务包](../../../agent-tasks/product-wave-11/README.zh-CN.md)。

日常能力线是来源检索/历史、已完成回复恢复与明确提案；可靠性线是实际持久控制、恢复激活、普通个人安装与升级。两条线并行，普通安装不依赖恢复或研究。D先关requested-root所有命令路径再跑stop矩阵；E先独立验current-main，不等旧tar或pilot。

main仍拥有真实恢复baseline/确认/target启动授权，并必须交实际consumer；A/D不替main签grant。激活许可需本机私有验证、准确source/receipt/target/machine/profile/policy和当前资源，备份内audit不继承启动权。未知旧writer不得因新generation消失。

## 边界不变

自动开发/验收模型/native0；B旧cap4 UNKNOWN不可花，E旧pilot24turn（8作者+16复核）/200000计费token/USD5/单在途保持BLOCKED，账不清零/补样本/退unknown。不再做费用上界调查，不新增Driver/CAC/桌面壳/自动接受、writer racing或动态Ticket DAG。

保留原五个工作树/分支、所有历史source/tar/测量及九组服务5180/8796至5188/8804。只能停止本次可证明自有进程；共用install/PID不是权威。contracts/root lock/公共文档与产品组合归main，SQL迁移A唯一，E断言不由其他角色修改。所有push仅origin各自分支，main评审集成。
