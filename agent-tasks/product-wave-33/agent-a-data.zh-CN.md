# Agent A：可连续读取的可信历史与原产物数据闭包

日期：2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-a`。
原分支 `codex/g2-workspaces-verification`；保留全部 dirty、原数据、报告与历史。
先读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读 [0083 已交主线](../../docs/rfcs/WP-16/0083-main-registered-port-and-workbench-consumers.md)、[0084 架构复审](../../docs/rfcs/WP-16/0084-wave-33-reviewed-architecture.md)、[0085 完整工程](../../docs/rfcs/WP-16/0085-wave-33-whole-product-program.md)。
保留改动后同步 `origin/main`，重新记录实际 source；只提交 owned 路径到原 origin 分支。

## 整块 Goal 与当前基线

建立或延续一个 goal：交付生产历史 continuation、实际产品兼容消费者及原产物字节级重开闭包。
以下三项是三个完整工程成果，不是逐条等批准的小修或增加测试编号。
发布早期 reader、中期 consumer、后期完整数据闭包 source 后持续联调与独立队列。
无同日截止、工时或 token 承诺，检查点不结束整块 goal。

- 固定起点 `a9ae5cd1`，A/F/C 本轮已验范围见主线验收，不重做已经关闭的历史绑定修复。
- 两个真实登记项目走原 runtime/Work/check/accept 并重开 Store 的受控正证已成立。
- 这不是安装实例重启、真实 native 或同原 Work 故障接管证明，不能重贴层级。
- 当前 reader 的 source50 上限加 available counts 没有 source continuation，仍读不到被截掉的后续记录。
- 单独 C 本地 slice/offset 不能补齐这个生产缺口，不能仅把 truncated 标签换成 complete。
- Work/contract/attempt/review/verification/acceptance 和原 artifact 继续由现有 Store/WorkIndex 提供。

## 成果一：生产历史有界 Continuation

实施范围：

- 在 `packages/storage/`、`packages/workflows/` 的既有只读接口交可持续取下一页的正式 reader。
- 复用原表、索引、事务与原 evidence，不新增 history ledger、candidate 表或第二完成生命周期。
- 为 Work/合同版本/attempt 及各历史集合定义稳定排序、同时间 ID 消歧和 continuation 身份。
- 内部游标必须绑定原项目、Work、过滤条件、集合与读取版本，不能只给全局裸 offset。
- 明确并发新增记录时的快照或边界政策，已有页不丢失、不重复，不悄悄切到另一主体。
- source coverage、caller 限额、已知总数与未观测总数分开；count 不得依赖全库无界扫描。
- 页数、记录数、字节与读取成本有界，跨 ticket/集合的预算不能各自耗尽同一总预算。
- 历史真实性按原 attempt binding 校验；current eligibility 仍由原 ProductCompletion 判断。
- canonical key、严格 shape、原 contract/artifact 关系和 unclassified 原因保持，不放宽历史准入。
- 公共签名 cursor、HTTP/schema/权限需求交 main，A 的数据 continuation 不产生新授权。

实际 consumer：

- 原 WorkIndex/evidence ports 和 C 的明确读取消费者能够从第一页继续取到 source50 以后的记录。
- main 可以在同一个原 Work 历史入口消费正式接口，而非依赖另一个 checkout 的私有 SQL。
- 保留旧有 capped reader 的兼容语义；新增消费能力需要明确版本或入口，不静默改旧协议。

必要正负：

- 非空多 attempt、超过50/多页、同时间记录、页间新增及 caller limit0/小上限各有真实对照。
- 源截断与 caller 截断同时存在仍诚实，未知不变完整零值，末页与超出当前页明确区分。
- foreign project/Work/版本、错误 continuation、集合错配和坏 canonical 记录独立拒绝或明确未知。
- 读取无事件/接受/队列/模型增量，原 current/accept 行为不被历史浏览改变。

Source 交接：

- 早交生产入口、类型、排序/游标/预算契约、可编译调用例和命令 exit，供 main/C 渐进消费。
- 写出旧调用兼容及未知语义，必要迁移仅 A 追加，并提供真实性能或索引理由。
- reader 检查点发布后继续成果二，不在一条超过50的测试变绿后结束。

## 成果二：Main 兼容的真实历史消费者

实施范围：

- 将 continuation 与原完成事实、receipt、verification/artifact/source metadata 关系连成正式读取闭包。
- 提供两项目、多会话、原/新合同与多 attempt 的非空数据，保留原 IDs 和原权限边界。
- 历史有效、当前关联、已接受、被替代、unclassified、missing 和 unknown 不合并成一个 verified。
- 页面所需的页状态、下一页、coverage、原因和稳定引用来自正式 DTO，不要求前端反推 SQL。
- 产物正文读取继续复用原授权 evidence/artifact 入口，不因为 metadata 可见就公开原文。
- main 保留 HTTP、cursor 签名、principal/Scope/body gate、App 与原表单确认权威。
- A 给稳定 port 与最小调用需求；C/F 不得各复制一套 review 分类、候选或统计账本。
- 对 main 尚未导入的累积 A source 给完整最小依赖闭包，不能只交一个脱离 exports 的函数。

实际 consumer：

- main/C 可从同一原 Work 浏览多页历史、查看原证据引用，再返回当前数据和原接受流程。
- F/E 获得真实 public 输入及样例，模块测试、source HTTP 和最终安装结论分别记录。
- 既有原 WorkIndex/Completion/evidence 调用兼容，不把新的历史 reader 另起为产品 authority。

必要正负：

- 两项目各有不同 Work/合同/attempt/原 receipt 的连续浏览链，下一页不串项目或丢旧历史。
- 当前 epoch 变化保留合法旧 review；已失效 current、撤销/替代与旧 receipt 不复活批准。
- 缺原 artifact、错误版本、坏引用、部分源和 cursor 到期有清楚结果，不 fallback 全项目扫描。
- 严格类型和实际 main 兼容调用通过；UI 尚未接线时准确 SOURCE_READY，不填 installed。

Source 交接：

- 中期交生产 reader/ports/exports、actual consumer、原 IDs、命令 exit 与 main 最小接线清单。
- 未达 UI 或独立 E 验收按层列明，继续成果三和自己的兼容/错误队列。
- 不以新 JSON 样例、helper 输出或 report DONE 代替真实产品消费者。

## 成果三：非空恢复、原产物内容与原 ID 重开

实施范围：

- 沿原生产流程产生非空原 Work/检查/当前候选/人工接受，再读回同一批数据，不手写终态。
- 超过只核 artifactDigest 元数据：经原 Store/evidence 读真实冻结内容，核实际 bytes/digest/format。
- 验证 review/verification/candidate/原 artifactIds 与实际内容一致，不用一个合法64hex代替内容证据。
- Store/合法运行消费者重开后读同一 Work/合同/receipt/产物，旧来源与当前资格仍各自正确。
- 复用已有默认 v1/显式 v2 snapshot/restore 和独立内容期望，非空恢复不复制 credential 或旧批准。
- 合法恢复后的 readonly 读取/coverage/正文权限/held queue/provider 行为准确，不顺手激活 writer。
- 真正跨进程或包内消费者只在已有安全入口准入后执行，缺准入不借另一 normal Work 补证。
- 数据损坏、缺失、换包、source 变化和资源未知保留现场，不为完成 goal 强制清理。

实际 consumer：

- main/C 原历史及 evidence/body 消费者读同一批原 IDs 与内容，H/E 可按原始材料独立核对。
- D 的完整发行/迁移子系统消费正式 data/proof 依赖；A 不另起安装器或要求临时 ZIP 冲刺。
- 安装层在选定集成版本由 D/E 闭合，A 的 source/受控重开事实不冒称已安装可用。

必要正负：

- 原产物 bytes/digest/格式及原接受关系在正常重开、两格式合法恢复中一致。
- 缺/替换正文、摘要不符、跨项目原文、旧合同、篡改清单和 target-only drift 独立拒绝。
- unknown receipt 按同 commandId/body 核对，不重复创建/接受/Outcome，不消耗 held queue。
- 有限相关 strict/回归与可操作手册齐；native/live recovery/长期运行未测明确列未达。

Source 交接：

- 后期交字节级原始证据、正式 reader/API、非空恢复/重开 consumer、命令 exit 与准确范围。
- 状态写 `packages/workflows/reports/wave33-status.json`，保留失败、限制、main 已消费与候选层差异。
- 提交 owned 路径到原 origin 分支后继续整块联调，不能把尚未闭合的实际消费者改叫完成。

## 独立备选队列

- main 公共 contract/HTTP 未到：先交 typed port 与真实数据，继续 continuation/兼容/内容/故障。
- C/F 尚未接线：提供稳定样例和最小调用，继续 A 生产实现，不越权写其组件或 SQL 之外接口。
- B/private/研究受阻：只阻相应 native 层，普通历史/原产物/非空恢复工程继续。
- 数据库迁移如确有必要由 A 唯一追加；E 独占产品独立断言，模块验证不替代发行 oracle。

## Whole Goal 完成条件与边界

- 三成果均有生产实现、actual consumer、必要正负与 source 交接，并被 main 的集成版本实际消费。
- 未接 main/未安装/未达 native 均保持准确分层，不按测试数、提交数或任务编号增加完成率。
- 仅拥有 `packages/storage/`、`packages/workflows/`；shared root/contracts/lock/HTTP/App/transport 属 main。
- 自动真实 vendor/model/native0，B 旧 cap4 UNKNOWN 不可花，E 原 blocked pilot 不 reset/topup/refund/补样。
- 保留十二用户服务及全部 state/profile/tar/ledger/dirty/runs；仅原独立 birth/full 资源且每次 fresh 可受信号。
- 无 global discovery、借凭据、真实 CLI 回退、新 Driver/CAC/桌面/自动接受/第二 ledger 或生命周期。
- 当前推进完整方案B，CAC排除，发行并行但不以临时包装替代工程；不新建 checkout 或派工线程。
