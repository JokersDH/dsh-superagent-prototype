# RFC-0001：AttemptIO payload 引用缺少 fact kind 与 generation，ingress 无法自证 payload 合法

- 状态：**Accepted（按主 Agent 决议，2026-11-07）** — 不修改冻结 ports；authoritative ingress 无条件严格解析 `{kind,value}` 并核对 fact.kind；payload 引用不可变/内容寻址；同 factId 内容变化视为冲突，不引入 generation
- 提出者：Agent B（WP-03）
- 影响包：`packages/contracts`（只读，归主 Agent）、`packages/execution`、`apps/runner`、后续 `packages/storage`
- 关联验收：REL-05、RT-07、RT-10、DATA-01（既有契约）、OPS 无关

## 1. 具体失败场景

WIP 期间的真实调用路径是：

1. Driver 拿到原生事件（例如 `turn.ended`），把它整理成 payload；
2. Driver 调 `AttemptIO.payloads.store(payload, 'critical')` 得到 `payloadRef`；
3. Driver 构造 `CriticalFact { kind: 'turn.ended', payloadRef }` 交给 `AttemptIO.record`；
4. ingress（未来是 core/storage 的事务）读取 `payloadRef` 对应的 payload，做业务处理。

现在的接口签名是：

```ts
payloads: {
  read(reference: string): Promise<Json>;
  store(payload: Json, classification: 'critical' | 'diagnostic'): Promise<string>;
}
```

`store` 不知道 `kind`，`read` 也不知道 `kind`。于是存在两个真实风险：

1. **payload 与 fact kind 不一致无法在存储边界发现。** 冻结契约的 `RuntimeFactPayloadSchema` 是一个按 `kind` 判别的联合（`packages/contracts/src/schemas.ts:206`），而且 README 明确要求“解析后必须匹配 fact kind”。但 `Json` 是任意 JSON，Driver 把 `runtime.exited` 的 payload 挂在 `turn.ended` 的 fact 上，只有到了业务代码里才会炸，且现场只剩一个字符串引用。
2. **同一 factId 的替换/重放无法区分 payload 代次。** 若 Driver 因重连重新生成同一 `factId` 的 payload（本地 `factIdFor` 是确定性编号），ingress 无法判断手里这个 `payloadRef` 是新代次还是旧代次；storage 层要么覆盖、要么拒绝，但没有任何字段能表达“这是第几代”。

这不是“实现没写”，而是**接口表达力不足**：`payloads.store` 是写入点，却没有携带判定 payload 合法性所需的最小上下文。

## 2. 最小 fixture

```json
{
  "spec": { "attemptId": "attempt-1", "fenceEpoch": 1, "...": "见 packages/testing/src/fixtures.ts" },
  "fact": {
    "ticketId": "ticket-1", "assignmentId": "assignment-1",
    "attemptId": "attempt-1", "fenceEpoch": 1,
    "factId": "fact-attempt-1-1", "source": "fake-driver",
    "kind": "turn.ended", "payloadRef": "payload-1"
  },
  "storedPayload": { "kind": "runtime.exited", "value": { "resourceRef": "res-1", "exitCode": 0, "signal": null, "evidenceRefs": ["exit"] } }
}
```

当前状态：`record(fact)` 接受、storage 存下、业务层解析时才失败。期望状态：写入或 ingress 阶段就以稳定错误拒绝，且错误能指出“payload 声明 runtime.exited，fact 声明 turn.ended”。

## 3. 拟议变更（三种，按侵入度排序）

### 方案 A（推荐，最小）：`store` 增加 kind，`read` 返回 kind 信封

```ts
type StoredPayload = { kind: RuntimeFactKind; value: Json };
payloads: {
  store(kind: RuntimeFactKind, value: Json, classification: 'critical' | 'diagnostic'): Promise<string>;
  read(reference: string): Promise<StoredPayload>;
}
```

- 写入时由 Driver 显式声明 kind，`store` 可以立即用 `RuntimeFactPayloadSchema.parse({ kind, value })` 校验。
- 读取时返回信封，ingress 可以断言 `stored.kind === fact.kind`。
- 兼容性：这是 **ports.ts 的本地接口**（非 wire JSON），`CONTRACT_IDENTITY.schemaHash` 覆盖 ports 源码哈希，所以会改变 schemaHash——需要主 Agent 决定是否作为 v1 内的小版本更新，并按契约 README 的规则补旧消费者 fixture。若主 Agent 认为 G1 期间不宜变更 schemaHash，可采用方案 B。

### 方案 B（零契约变更）：Runner 侧前置校验 + 诊断事实

保持 `store(payload: Json, ...)` 不变，但约定 `AttemptIO` 的 `record` 前置执行：

1. `const stored = await payloads.read(fact.payloadRef)`；
2. 若 `stored` 是 `{ kind, value }` 形状且 `stored.kind !== fact.kind`，拒绝并记 `runtime.error`（`protocol_error`）；
3. 否则放行。

代价：约定靠文档和测试维持，Driver 可以直接写一个不带 `kind` 的 JSON 绕过；并且 `read` 在 record 前发生，多一次读取。

### 方案 C（只做 generation）：payloadRef 变成 `{ ref, generation }`

把代次显式化，解决重放/替换歧义，但仍不解决 kind 校验，且改动面最大。不建议在 G1 做。

## 4. 兼容、迁移与恢复影响

- 方案 A 只影响本地 TS 端口，不影响任何 wire schema 字段；但 `schemaHash` 会变（ports 源码哈希在覆盖范围内），因此需要主 Agent 重新冻结 contracts release，并在 `packages/contracts/test` 增加旧消费者 fixture。
- 不影响数据库迁移：payload 仍是外部引用，storage 只需按新信封存/取。
- 恢复路径：旧 payload（无 kind 信封）在 `read` 时应当明确 `unknown`，而不是按默认 kind 猜测；ingress 对 unknown 走“先 reconcile、不重放”的既有规则。

## 5. 本批（WP-03 第一批）的处理

在 RFC 结论出来之前，本批做了**不扩大契约的防御**：

- `apps/runner/src/runner.ts` 的 `#record` 校验 fact 的 attempt/assignment/epoch 身份，不匹配即拒；
- `packages/driver-kit/src/attempt-io.ts` 的 `criticalFact()` 要求调用方提供 `payloadRef`，并由包内测试固定“payload 必须由 store 产生”的用法；
- 测试假件 `InMemoryPayloadStore` 记录了 classification，但没有伪造 kind 信封，以免制造与未来契约不一致的假象。

因此本批**没有任何代码声称已经解决 payload/kind 一致性**；该缺口在报告里记为 NOT_TESTED + 待 RFC 决定。

## 6. 验收影响

- REL-05（关键事实有持久 receipt/保留容量）：本批的容量与 receipt 语义与 payload 信封无关，方案 A 不改变其验收口径。
- RT-07（无控制饥饿）：不受影响。
- DATA-01（契约单一来源）：方案 A 需要在 contracts 内更新 ports 与 fixtures，因此 DATA-01 的“单一来源”要求在变更后重新出证据。
