# 第七轮实际接口检查点：同步命令与恢复意图

日期2026-11-11；实现源码`da54758`。本检查点已实现可调用接口与受控SQLite消费者，尚未开放恢复commit/目标启动或提案网页。它是[0026](0026-wave-07-integration-and-admission.md)的部分实现，不是完整个人Alpha准入。

## 1. 已集成来源与限制

main已按拥有路径cherry-pick C `0d876b8`/`25f983a`及A `c3990c2`/`2c5d002`，对应集成提交`07a2649`、`1b6d21c`、`7323a47`、`644751d`。root lock仅补这些包已声明的workspace/dev依赖。D第七轮first-run修复尚待检查点，不将D旧包报告当新源码准入。

本批11包build、contracts/application typecheck、coordinator typecheck:product通过；contracts/storage/workflows/proposals/knowledge/routing/application七包测试命令退出0，恢复意图消费者4项通过。原冻结Runner/data hash仍为`74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`。

独立反例额外发现C列表不一致：替代决定撤销后，getSync旧决定为superseded，listSync(status=active)却返回旧决定。可运行`node tools/bootstrap/probe-wave07-supersession.mjs`，当前exit1。C需在C2/C4修复并覆盖listEffectiveWindow；不是整包测试通过就能忽略的残余问题。主线尚未开放自动/预览上下文消费，已有决定目录逐条getSync不受这一路径复活影响。

## 2. C/main：应用命令可加入现有事务

类型在[prepared-commands.ts](../../../packages/contracts/src/prepared-commands.ts)，实际实现是Application的`prepareCommand`和`commitPrepared`：

```ts
const prepared = await application.prepareCommand(command, actor)
const receipt = store.uow.atomic(() => {
  // Revalidate and commit the proposal participant here, using A's actual port.
  const result = application.commitPrepared(prepared)
  if (result.status === 'rejected') {
    throw new ApplicationFault(result.error.code, result.error.message, result.error.retry)
  }
  return result
})
```

prepare只在事务外运行异步预检，无receipt或业务写入；返回五分钟有效的本进程不透明handle。复制/序列化/别的Application实例均不能消费，业务command/actor为解析后快照，caller修改原输入不改变授权内容。

commitPrepared必须在caller已有UnitOfWork内，同步重验当前应用规则、guard和期限；core/queue/event/receipt仍按原规则同事务。它返回rejected时只保证自己的效果已回滚，**composer必须抛错回滚自己的proposal变更**，随后才可在独立外层savepoint记录组合命令拒绝回执。不能看到rejected仍提交confirmed proposal。

原dispatch已复用此路径，不增加一种执行生命周期。已提交命令的相同ID/body重放仍返回原receipt，过期handle不产生新权限。恢复/重开后重新prepare相同业务命令可查原receipt；handle自身不能跨进程。

C继续维护intent/command plan和提案效力规则，不自己调用异步dispatch包事务。main后续负责不同命令ID的组合回执、认证HTTP及UI；本检查点不宣称这部分已完成。

## 3. A/main：恢复事实的最小同步port

共享[recovery-activation.ts](../../../packages/contracts/src/recovery-activation.ts)提供`RecoveryActivationIntentSchema`、`RecoveryActivationFacts`和`RecoveryActivationCommitSchema`。A实现get(activationId)、forCommand(commandId)、put(intent)，全部同步，写入加入现有source UnitOfWork；同body幂等、同activation/command不同body冲突。优先复用现有记录和receipt，必要迁移仅A追加。

intent绑定稳定activation/command/plan身份和planDigest、source state/root/marker/inspection、新generation/root/config、principal、当前machine/resource-policy摘要及最长五分钟期限。它不接受force、oldQueueMayRun或authorized字段。摘要只是绑定材料，不能单靠提供一个摘要证明资源安全。

实际[RecoveryIntentCommitter](../../../apps/coordinator/product/recovery-intents.ts)消费该port：认证actor，检查期限，在source同一UOW内调用必需的同步freshness guard，再写事实、application.recovery.intent事件和command receipt；receipt最后失败，事实及事件全部回滚。重放同时核对事实/命令/receipt的一致性，返回原sourceReceipt。

main的guard必须验证实际marker、source、plan、machine、target path/policy与当前物理资源；A不推导授权。当前4项集成测试的port使用真实SQLite现有receipts作测试适配器，**不是A生产port已完成**。准确消费recipe见[集成测试](../../../tests/integration/recovery-intents.case.mjs)。

## 4. D/E：当前不能作为启动凭据

sourceReceipt只是已提交意图的查询身份，不是独立可携带的启动token。D尚不可拿一份客户端JSON启动目标，更不能把旧库切normal。实际target manifest、私有准备目录、source事实复查、激活指针/启动和崩溃重入尚待main后续协议/实现。

恢复HTTP仍只有inspect/prepare，commitAvailable=false，旧marker/queue不变。未知writer屏障没有被新state/receipt替代；备份再恢复不继承新本机权限。D可继续manifest first-run、双binary升级和失败recipe，E可继续预算与既有产品负例。

## 5. 可重跑检查与下一步

```sh
pnpm --filter @personal-agent/contracts --filter @personal-agent/application typecheck
pnpm --filter @personal-agent/contracts check:generated
pnpm --filter @personal-agent/application test
node --test tests/integration/recovery-intents.case.mjs
node tools/bootstrap/probe-wave07-supersession.mjs
```

最后一个命令是当前C残余失败的复现，预期修复后exit0；其余为本检查点通过范围。未运行真实模型、未改用户六组服务或旧state。main继续提案的真实HTTP组合和恢复目标激活；A/C/D/E在原六阶段中消费本检查点，不需要新建任务。
