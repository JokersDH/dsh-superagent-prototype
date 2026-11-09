# WP-03 第七批（G1）：Journal I/O、重放 ACK 与序列完整性

- 分支：`codex/g1-runtime`（已合并 `origin/main` `aae704f`）
- 任务：`agent-tasks/g1-agent-b-journal-followup.md`（审查对象 `32540a3`）
- 结论：**三项新增验收全部 PASS**；原四项仍 PASS（7/7）

---

## 1. 三项修复

### 1.1 JOURNAL-IO-FAILURE-POISONS-WRITER

| 修改前 | 修改后 |
| --- | --- |
| `writeSync`/`fsync` 抛错后 handle 仍可用，下一次 append "成功" | 字段 `#poisoned` 记录失败原因（`EIO` 等） |

规则：

- 任何 **写入或 fsync 失败** → 当前 handle 永久拒写，`append()` 抛 `journal_writer_poisoned`；
- **绝不**静默截断“可能已落盘”的记录、**不**重置计数器、**不**重试原生效果、**不**覆盖证据；
- 只有**显式重开**（重新 `open()`，经过恢复判定）才能继续写；
- `journal.poisoned` 暴露原因供诊断。

已覆盖：fsync 在完整写入后失败、失败后同一 handle 继续拒绝、重开后从实际恢复到的 `lastSeq` 继续、重开后容量/序列记账正确。

### 1.2 JOURNAL-REPLAY-VALIDATES-ACK

`replayJournal` 此前丢弃 sink 返回值并对 `persisted:false` 计 `replayed`。

现在每条恢复 ACK 都用与实时路径**同一个** `validateReceipt()`：

- 冻结 `DurableReceiptSchema` 严格解析（`persisted` 字面量 `true`、`seq` 正整数）；
- factId 必须与本条 fact 一致；
- **无效/拒绝的回执从不计入 `replayed`**，记为 `failures`；
- **意外持久化失败会中止本批**（不越过缺口继续推进），避免让剩余重放顺序不可验证；
- 保留原始 ID 与 payloadRef；不发 `begin`/`deliver`/`answer`；权威的 stale-business 拒绝与旧物理保留仍归 ingress。

### 1.3 JOURNAL-SEQUENCE-GAP

解码器此前接受序列 `[1,3]` 并当作完整可写。

现在要求**从 1 开始连续单调**：

| 情况 | 判定 |
| --- | --- |
| `seq` 恰为期望值 | 正常 |
| `seq` 小于期望值且**同体** | 精确重复，从 prefix 丢弃（不构成新事实） |
| `seq` 小于期望值且**异体** | corruption |
| `seq` 大于期望值（缺口） | **corruption** |
| 非法前缀 / `seq` 非正整数 / 记录信封非法 | corruption |

corruption → `readOnly = true`，恢复结果显式带 `corruptAt`；**`entries()`/`replayJournal` 不会用“成功的前缀”掩盖完整性失败**，调用方必须读取 `JournalRecovery.corruptAt/readOnly`。未检查的/有缺口的 prefix 不会被标成"已验证恢复快照"。

---

## 2. 附加修复：`#observeGroup` 观察失败语义

- 原实现把 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` 和 `status === 1` 都当作"组为空"，属于把**输出溢出/调用失败**误判为**正面观察到的缺席**；
- 现改为 `ps -A -o pid=,stat=,pgid=` 全量列举后按 pgid 过滤：**只有成功列举**才可能得出"无成员"；
  任何失败（溢出、缺失、异常退出）→ `unobservable` → `indeterminate`；
- 保留对**未证实/被复用 PID 发信号的拒绝**（start marker 缺失或漂移）。

理由：`ps -g` 在 macOS 对存在的组也返回 1，用它判断"组不存在"不可靠。

---

## 3. 验证

```sh
node tools/bootstrap/review-journal.mjs --runtime .           # PASS_JOURNAL_ADMISSION_CASES   4/4
node tools/bootstrap/review-journal-followup.mjs --runtime .  # PASS_JOURNAL_FOLLOWUP_CASES     3/3

packages/driver-kit  18 pass
packages/testing      8 pass
packages/execution   44 pass
apps/runner          78 pass
合计                148 pass / 0 fail   （上一批 136 + 本批 12）
```

类型检查：`tsc` 6.0.3 strict（含测试）→ exit 0。

---

## 4. 未完成 / 不声称

1. **断电持久性**未验证；只做同机 fsync + 重开 + SIGKILL。
2. **Driver factId 延续**未实现：`FakeDriver` 每次 serve 的 `factSeq` 仍从 0 开始；`FileJournal.seq` 连续 ≠ factId 延续。恢复只 replay 原事实、不重新 serve 同一 attempt。
3. **serve 失败的 native 资源清理**：测试 `finally` 的 `stopAll` 只证明测试清理，不证明运行实现已保证。
4. **AttemptRunner 后端方案**（每 attempt 私有 endpoint、恢复时不暴露业务路由、不可逆关闭准入、完整 owned-resource 清单、新鲜物理证据）**尚未提出** —— 需在 Journal 通过后另行提交；durable launcher/endpoint 注册属 A/main 的 storage RFC。
5. 未启动厂商适配；未改 contracts/根依赖/coordinator/storage/migrations；未放宽任何 review probe。
6. 平台：仅 darwin/arm64；Linux/Windows 的 `ps` 输出格式差异与目录 fsync 支持未测。
