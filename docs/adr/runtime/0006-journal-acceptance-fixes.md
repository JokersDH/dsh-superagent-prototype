# WP-03 第六批（G1）：Journal 入场修复

- 分支：`codex/g1-runtime`（已合并 `origin/main` `db6ea7d`）
- 任务：`agent-tasks/g1-journal-acceptance.md`（审查对象 `24b4449`）
- 结论：**四项验收全部 PASS**（`PASS_JOURNAL_ADMISSION_CASES`）

---

## 1. 四项阻断逐条修复

### JOURNAL-DURABLE-APPEND — append 返回前必须落盘

| 修改前 | 修改后 |
| --- | --- |
| `writeSync` 后直接返回，无 fsync | `writeAll()` 处理 **short write**（循环直到写完全部字节）+ **`fsyncSync(fd)`**，二者都完成后才返回 |
| 新建文件 / 尾部修复无元数据同步 | 新建文件时对文件 fsync 后再 **fsync 父目录**；partial-tail 截断后同样 fsync 文件与目录 |

声明范围：这是**同机持久化**保证。断电、文件系统损坏、网络盘行为**未验证**，不声称已验证断电持久性。

### JOURNAL-CORRUPT-APPEND — 损坏必须 fail closed

| 修改前 | 修改后 |
| --- | --- |
| `open()` 报 `corruptAt=0`，`append()` 仍成功，bytes/seq 与物理文件不一致 | 恢复发现损坏时 `recovery.readOnly = true`；`append()` 抛 `journal_corrupt_read_only`，**不写入任何字节** |

- 损坏文件**原样保留**（测试逐字节比对），prefix 与 gap 历史不被静默丢弃；
- `readOnly` 同时暴露为 `journal.readOnly` 供调用方查询。

### JOURNAL-SAME-ID-CONFLICT — 事实不可变

`factDigest(fact, payload)` 对 `{fact, payload}` 做**规范化 JSON**（键排序、忽略 undefined）后取 sha256。三个位置统一使用：

1. `append()`：同 factId 不同 digest → `journal_fact_conflict`；**完全相同**才返回 `duplicate: true`（幂等，不写第二条）；
2. `open()` 恢复已有文件时：逐条校验，同 id 不同体使该偏移成为 corruption；
3. `replayJournal()`：同 id 不同体记入 `failures`（`fact_conflict`），**不再计入 duplicates**。

覆盖的范围包括 identity（epoch 等）、`payloadRef` 和 payload **内容**。

### JOURNAL-AUTHORITATIVE-ACK — 只接受权威回执

`validateReceipt(receipt, factId)`：

- 用**冻结的** `DurableReceiptSchema` 严格解析（`persisted` 是字面量 `true`，`seq` 必须为正整数）；
- factId 必须与本次 fact 一致；
- 任何不合规回执（含 `persisted: false`）→ `invalid_receipt` 抛出，**不向上传播**；
- 本地 spool 成功**不等于**平台已接受。

---

## 2. 边界与严格校验（任务附加要求）

- `maxBytes` 与 `maxRecordBytes` 两个硬上限：单条记录超限 → `journal_record_too_large`；
- **恢复时不按声称长度分配**：文件超过 `maxBytes` 直接判 `readOnly`，不读入内存；
- 前缀必须匹配 `^[0-9a-f]{8} [0-9a-f]{16} $`，否则是 **corruption**（与“截断尾”区分开）；
- 记录 `seq` 必须是正整数，否则 corruption；
- 破坏前缀 → corruption；文件末尾不完整记录 → **partial tail**，可修复且不视为损坏。

---

## 3. oversize 测试

按任务要求改为**断言安全错误类别**，不放宽任何容量限制：2 MiB 帧被抓取时可能被判为 `frame_too_large`（遇到换行）或 `buffer_limit`（缓冲上限先到），两者都是同一安全拒绝。测试断言 `exit.reason === 'error'`、存在 `runtime.error` 事实，且**绝不产生 `turn.ended` 业务事实**。

---

## 4. 验证

```sh
node tools/bootstrap/review-journal.mjs --runtime .
# status: PASS_JOURNAL_ADMISSION_CASES，四项 passesInvariant: true

cd packages/driver-kit && node --test test/*.test.ts   # 18 pass
cd packages/testing    && node --test test/*.test.ts   #  8 pass
cd packages/execution  && node --test test/*.test.ts   # 44 pass
cd apps/runner         && node --test test/*.test.ts   # 66 pass
```

合计 **136 项**（上一批 126 + 本批新增 10）。原有通过测试全部保留。

类型检查：`tsc` 6.0.3 strict（含测试）→ exit 0。

---

## 5. 未完成 / 明确不声称

1. **断电持久性未验证**：只做了同机 fsync + 重开 + SIGKILL。不能声称断电场景已验证。
2. **Driver factId 延续**：`FakeDriver` 每次 `serve` 的 `factSeq` 仍从 0 开始；`FileJournal.seq` 延续**不等于** Driver 的 factId 已延续。当前恢复流程只 replay 原事实、**不重新 serve 同一 attempt**。若未来允许同 attempt 续接，需要显式持久 fact cursor 或唯一 allocator 及竞争用例 —— 本批不推论其安全。
3. **serve 失败后的 native 资源清理**：测试 `finally` 中的 `stopAll` 只证明**测试自身**清理干净，不构成运行实现已保证资源回收。
4. 与 main 的生产 `ImmutablePayloads` 恢复适配层、`createRuntimeIngress` 接线未在本批。
5. 厂商 Driver 未启动；未改全局配置、未改 coordinator/storage。
