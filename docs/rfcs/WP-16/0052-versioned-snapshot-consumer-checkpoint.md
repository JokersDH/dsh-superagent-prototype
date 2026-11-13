# 0052：保留默认v1的双版本快照消费者

2026-11-13，基于main f875ead/e438ab5及独立审查A7cabe8d。主线按范围接入版本专属evidence读取与snapshot验证，不整包合并A分支，不改DB schema18、迁移、执行生命周期或启动权限。

## 默认兼容与显式新格式

`readWorkflowEvidence(path, version)`支持1/2，默认仍1；`WorkflowSnapshots.create({destination, formatVersion})`默认1，只有显式`formatVersion:2`才生成新格式。非法版本在创建目录/打开evidence DB之前拒绝。

v1使用真实历史13族、原字段/排序/digest；非空binding不含新增derived work_id字段，完整旧族摘要与旧producer golden一致。v2用明确21族及其新字段，`workflow-snapshot/2`必须配`workflow-evidence/2`和familySetVersion2。legacy与current都要求精确完整已知清单和整体digest，不能缺族/重复/混配/降格。

verify按外层格式只读取对应配方；create不额外扫描不用的legacy配方。默认v1 manifest也不新增仅v2需要的inventory字段。这保持已有调用者输出约定，同时为D/E显式测新格式提供实际入口；portability的personal-evidence格式是另一协议，不能因同为1/2便宣称已支持本格式。

## 保留现有安全检查

A候选在create漏掉valid schema检查，schema0会误标complete、1.5会create/verify通过。主线选择性整合，保留e438的非null、安全整数、≥1及required表/索引/未知表/未来版本检查，两条格式路径都拒绝这些数据。未覆盖现有主线guard来换取候选包测试通过。

## 真实历史向量

`tests/integration/fixtures/genuine-v1-evidence.json`来自整合前主线真实v1 producer，包含合成fixture、13族完整evidence、source/dist SHA与原结果，无数据库、无真实用户内容。它不是重标新v2清单。

旧binding族digest为51d53c57b7d4be9c586f5b6a255a9d8f6bbd8db64c71f3e032e70a2df6cce7dd，整体digest为e339e38272cdadaf38059ffeea18476a10c839e78427c30940371395c49de4cd。显式v2的同一binding新配方7022d0a2...不同，但旧manifest会选择旧配方验证，不再错误拒绝。

## 验证与范围

- 新双版本14项及原schema7项共21PASS：完整旧golden、默认兼容、显式新格式、混版本/缺族/重复/未来版本、非法参数和两格式metadata0/1.5拒绝。
- 上述21及实际source确认14组合35PASS，含原两独立进程SIGKILL窗口。
- 主线storage87/workflows93、typecheck/build、coordinator product strict通过；独立定向review再跑21/21并确认保留了主线guard，无新实质问题。
- 这不代表A分支所有fixture已整包接入，也不认证D最新安装包、真实模型/native、私有许可、writer quiescence或target启动。

十二组服务/所有state/profile/tar/ledger未更新或重启，真实厂商model/native0。后续D/E按准确新source冻结/独立测试显式v2；文档HEAD变化不迫使重复打包。相关主线状态在本轮integration报告，下一派工按0053。
