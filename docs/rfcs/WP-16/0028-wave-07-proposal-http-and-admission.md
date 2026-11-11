# 第七轮提案HTTP闭环与新候选准入反馈

日期2026-11-11；实现源码`627ef0d`，前置[0027](0027-wave-07-command-and-recovery-checkpoint.md)源码da54758。本批实现后端真实SQLite/HTTP组合，不开放提案网页或恢复目标启动，不构成installed-alpha/native/review-value准入。

## 1. 可消费的提案API

公共输入/输出见[proposal-commands.ts](../../../packages/contracts/src/proposal-commands.ts)，实际消费者见[ProductProposals](../../../apps/coordinator/product/proposals.ts)，已接入createProductRuntime与认证HTTP：

| 接口 | 输入与结果 |
| --- | --- |
| POST /v1/proposals/prepare | projectId/conversationId/sourceMessageId及结构化payload；返回只读签名preview、pending record、requiredInputs和五分钟期限 |
| POST /v1/proposals/commands | confirm_proposal或reject_proposal；稳定commandId、同项目/会话、原token，以及确认的work或revision输入；返回原CommandReceipt |

支持propose_work、propose_revision和propose_decision，复用C的planProposalCommand、AssistantProposalService、A的实际assistant port与已有UserCommand/决定服务。普通reply不是可执行提案；不从Markdown/对话文本猜测执行命令。

创建工作必须明确提供scope/criteria/profile；修订必须提供完整goal/scope/criteria并绑定当前合同。缺项返回拒绝，不补默认范围。record_decision走既有明确决定服务；结果回执包含entityRefs.decisionId，工作结果包含workId，UI无须猜最新记录。

准备阶段不写pending行或业务效果，preview本身不赋权。确认/拒绝才把必要的pending与终态记录一并提交。提案网页、模型结构化输出接入和上下文预览尚待M3；不能把当前纯文本助手回复说成已自动产生可确认提案。

## 2. 同事务与重放保证

来源必须是原项目/会话的trusted_user消息；当前文本摘要、grant、actor、合同及期限在预检后、实际事务内再次核对。模型/问题展示消息不能代替用户来源，body不能注入actor/native权限。

异步应用预检在事务外，确认在同一source UnitOfWork内写proposal状态、原业务效果、效果命令receipt、proposal事件及外层确认receipt。应用/决定返回rejected时抛错回滚参与者，再记录外层拒绝回执；最后receipt写入失败时所有proposal版本、Work/Ticket、queue和消息均回滚。

已提交相同commandId/body/actor返回原回执，即使原preview过期或重开；改变body/actor拒绝。原响应未知时必须保留原完整命令查回执，不换ID制造另一次执行。提案拒绝后不能确认，已确认后另一命令也不能再创建一份工作。没有自动接受、第二执行生命周期或writer racing。

长中文决定的签名token原50k上限不足，现改为有界150k；仅两种签名确认路由/proposals/commands和/decisions/commands接受256KiB body，其余仍64KiB。16384字中文决定的提案/直接决定两条确认均有回归，普通命令超限仍413。冻结Runner/data hash不变。

## 3. 本批实测

| 命令/范围 | 结果 |
| --- | --- |
| proposal-commands + decision-commands + recovery-intents + application-http + recovery-preflight + recovery-startup | 46项PASS，真实临时SQLite/HTTP handler；已有HTTP套件含实际loopback检查 |
| product-execution + assistant-replies + project-settings，--test-timeout=30000 | 33项PASS，受控子进程/审批/交付/机器FAIL/停止屏障/恢复/流式及设置 |
| contracts全部测试，--test-reporter=dot | exit0；含新提案schema及原冻结协议/生成一致性 |
| contracts build/typecheck/generated，coordinator typecheck:product/typecheck:http/typecheck | exit0；root lock与新coordinator→proposals依赖一致 |

早期扩展回归曾卡在流式测试。单项命令`node --test --test-timeout=3000 --test-name-pattern='stream snapshots' tests/integration/assistant-replies.case.mjs`稳定超时，定点观测为队列1条/provider调用0；新异步preflight让测试启动kick早于enqueue。生产ProductExecution已有50ms kick。直接测试消费者改为提交后显式kick，保留内容/落库断言并给两种stream等待加5秒上限；原单项约100ms通过，全33项重跑通过，临时DEBUG日志已移除。

所有模型provider为mock，真实模型/原生turn新增0；不重启5180–5185用户服务，不改旧state。此处不是新版本网页或原生模型试跑证据。

## 4. A新候选：读回失败及接口对齐

A当前检查点`0c9ca71`/`9f1833d`（交付da5f62a）新增schema14及旧RecoveryPlan intent port，尚未集成。独立临时SQLite探针调用record后验证`RecoveryPlanSchema.safeParse(result.record.plan)`失败，结果为：

```json
{"status":"FAIL_RECOVERY_PLAN_ROUNDTRIP","returnedProtocol":"recovery-intent/1","nestedPlan":true,"modelCalls":0}
```

原因在storage/recovery-intents.ts的mapRow：payload保存的是含plan的envelope，却把整个envelope当作RecoveryPlan返回。A需测record/getByPlan/getByCommand/list/reopen的完整结构、摘要和内容，不只测planId/authorization。

此外，该旧port还不等价于0027的RecoveryActivationFacts：后者必须绑定target/generation/config/principal/machine/resource-policy及稳定activation身份；不能用一个仍commitAvailable=false的旧RecoveryPlan填充假值冒充新契约。A在原A2/A4继续消费已发布接口，兼容历史记录；迁移只由A追加，main不改其SQL。先给最小修复/接口检查点，不重置已交证据或重做整包。

## 5. D新候选：fresh-source first-run失败

D `c9a0698`修复覆盖配置根的发行manifest初始化，尚未集成。独立探针在临时空install/config根调用实际firstRun，退出1：

```json
{"status":"FAIL_FRESH_SOURCE_FIRST_RUN","error":"Cannot read properties of null (reading 'commit')","modelCalls":0}
```

原因是无安装清单/无release时source=null，结果组装却读release.source.commit。D需保留真实发行来源验证，同时覆盖源码/空根/已有源码release/完整发行根的实际firstRun和CLI，而非仅测release-bootstrap helper。源码路径应返回明确未验证来源状态，不借用默认根，也不因null崩溃。

D已有bin/upgrade在其工作树进行，main未修改/重置。该反馈并入D1/D5原包，后续双binary与恢复消费继续；不要求等待本批准入才开始独立升级工作。

## 6. 后续输入与范围

C的supersession列表反例仍按0027处理，未准入有效上下文。E可从本源码消费提案HTTP并独立补反例；main不改E断言。A/D以上新候选先修复/对齐再逐段准入，不能因自报测试通过整支合入。

main下一步为M3真实网页消费与M4目标准备/源事实核验/激活重入；恢复HTTP commit仍未开放。D冻结安装目标必须使用后续实际集成来源；本批没有产生新安装物、原生控制结论或复核收益结果。
