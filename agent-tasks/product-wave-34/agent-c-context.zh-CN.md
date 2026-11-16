# Agent C：当前决定到原工作确认的两个连续工程包

日期：2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-c`。
原分支 `codex/g3-assistant-context`，保留原 lock 差异、runs、全部报告与历史。
先读 AGENTS、START-HERE、product-spec/README、[本轮 README](README.zh-CN.md)。
再读 [0086 主线实际消费者](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)、[0087 架构复审](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)、[0088 两包工程](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。
保留改动后同步 `origin/main`，记录真实 source；不要把旧 main 缺口或中间状态当当前阻断。

## 一个 Whole Goal，两个连续工程包

建立或延续一个 goal：让显式决定以可信当前 scope/version/provenance 进入新工作，并有完整普通治理与重开。
工程包一交当前 snapshot、受限 capture/selection 和原 Work 确认 consumer；包二交治理、草稿与完整 API 体验。
每包三个完整生产成果，共六个，不能把两个缺陷拆成六条测试来代替工程范围。
发布 early/intermediate/final 可运行 source 后继续全部两个包与独立队列，不逐项等待再派工。
无同日截止、工时、持续时长或 token 承诺，检查点不结束 goal。

- 固定起点 `ecac059d`；旧 TS7016、静态 symlink/0644 保存、invalid expiry 三处已真关闭，不重派。
- unknown/source50 coverage 旧修复保持，实际 session CLI 与原治理也有正证。
- 新 P2 是 snapshot Scope 未 deep-freeze、untrusted clone 的完整 scope/provenance 未被 revalidate 绑定。
- 实际 API 为 `captureDecisionSnapshot`、`revalidateDecisionSnapshot`、`DecisionGovernance.getEffective`。
- main `23d5a98e` 已交0086实际回调和支持消费者，未把候选 snapshot valid 当新工作授权断言。
- 复用 `decisionContextProvider`、`ContextComposer` 与 main `ProductContextPreview`，不新建同名第二框架。
- 仅拥有 context/proposals/knowledge/routing 四 package；root/HTTP/App/委托 schema 与最终授权归 main。

## 工程包一：可信 Snapshot 与原新工作确认

### 成果 C1：完整可验证的当前决定 Snapshot

实施范围：

- 完成 `decision-context-snapshot/1` 的严格输入/输出语义，invalid snapshot 明确拒绝而非宽松 any。
- capture 的 nested Scope、数组、coverage 和来源字段真正独立 snapshot/deep-freeze，不只冻结外壳。
- revalidate 将所表示的完整 Scope/version/content/sourceMessageId/sourceTextDigest/recordedAt 等对回当前可信记录。
- 处理缺/错字段、未知协议、重复决定、无效时间和 untrusted clone，不能仅 content digest 相同就 valid。
- valid 是当前数据一致性，不是 grant；不得让 forged scope 或 provenance 借 valid 进入执行授权。

实际 consumer：

- 正式治理 provider 和 main 兼容 caller 使用同一 canonical projection，不从客户端字段推可信来源。
- 原 `DecisionGovernance` 的状态/source/expiry 有效性仍唯一，main 的 current Scope/filter/权限 gate 保持。

必要正负：

- 正常当前 snapshot、合法版本/来源和 source scan 完整性有真实正例，旧 revoke/expiry 负控保持。
- 扩 allowedPaths、去 exclusions、换 sourceMessageId/recordedAt、缺字段或 nested mutation 必须被拒或不可变。

Source 交接：

- 早交生产类型/完整 canonical 校验、实际 caller 和必要命令 exit，修复发布后继续 C2，不就此收工。

### 成果 C2：有界 Capture 与显式选择的生产消费者

实施范围：

- 完成 project/selected IDs/max/time 的有限输入、唯一性、source/caller coverage 和当前有效集合语义。
- 不在先截掉的集合里把合法但未读取的选择误报为已撤销；完整扫描失败与 caller 选择不足分清。
- 用原 `listEffectiveWindow`/`getEffective`/`decisionContextProvider` 读取，不复制 SQL 或新决定 ledger。
- 当前项目/工作 Scope 与决定适用 Scope 的匹配沿原受限 atom/排除/expiry 规则，不造路径扩权。
- 交 typed data-only snapshot、可读缺口及原引用；server capture 与客户端 clone 的信任边界明确。

实际 consumer：

- main 原上下文/决定读取入口实际消费新的版本/来源 projection，F 能呈现真实可选/失效状态。
- 原 public consumer 兼容，C 不另起 HTTP 或只依赖 CLI/private checkout 才能使用。

必要正负：

- 两项目、有效显式选择、caller cap、合法新观察与不完整 source 有真实结果和有限成本。
- wrong project、unknown ID、duplicate、过期/current Scope 变化、NaN/非法 limits 或 scan_incomplete 不变完整零值。

Source 交接：

- 中期交稳定 port/DTO、真实 main 兼容调用与 scope/coverage 说明，继续 C3 的原工作创建消费。

### 成果 C3：原新工作 Prepare、Assert 与明确确认

实施范围：

- 在 main 原表单/委托 schema/命令链中预览所选决定版本，确认后固定原 source/version 引用。
- C 给 typed preparation/assert 数据与真实 caller；main 写 shared schema、原表单与最终 Work/contract/criteria。
- 准备到原写入之间重核当前 Scope/source/version/expiry/撤销替代，沿原同步边界或原 guarded context 接口执行。
- 决定变化要求明确重新预览，不能悄悄替换用户已确认字段或 active Work 的冻结上下文。
- 不以“先 create_work 再 assistantContextSend”声称创建前已绑定，也不把 snapshot hash 当批准 token。

实际 consumer：

- 一个真实 main 兼容的原 create_work 用户链使用所选 snapshot，并可从原 Work 查其冻结决定引用。
- 不选择决定时原普通委托仍可用，当前原工具权限、机器 FAIL 和人工接受保持原权威。

必要正负：

- 两项目各有合法决定版本到原 Work 的真实链，creation 前后对象/摘要可核对且无隐式创建。
- prepare 后 revoke/supersede/source/config/Scope 变化、旧 version/主体和 unknown receipt 按原 guard 拒绝或核对。

Source 交接：

- 发布包一完整生产 source、实际创建 consumer、原 IDs 与必要 main 接线需求，直接继续工程包二。

## 工程包二：原上下文治理、草稿重开与完整 API

### 成果 C4：原上下文与明确决定的完整治理流程

实施范围：

- 将原来源预览、选择/确认发送、提案确认/拒绝、record/supersede/revoke 和历史审计连续使用。
- 未来选择只用当前显式有效决定，撤回不重写原冻结 bytes，不复活历史或候选规则。
- 运行中 Work 受决定变化影响时交 main 原修订/停止流程，不由 C 原地修改 mandate 或 scope。
- 原 receipt replay/unknown/written/observed 区分，沿同 commandId/body 核对，不自动换 ID 重发。
- source/principal/项目/会话/合同/expiry 变化和来源省略真实可解释，permission/auth 问答不能当共享决定。

实际 consumer：

- actual main 兼容会话/Work/context/source consumer 使用同一原 Store/Broker/guard 和冻结引用。
- F 拿正式 DTO/错误语义，C 不增加另一确认 authority、模型 loop 或自动学习 pipeline。

必要正负：

- 原合法来源与明确决定可记录/替代/撤销，旧冻结正文仍可读，未来新 context 不引用失效规则。
- foreign source/旧合同/撤销重放/未知结果和只读模式不触发重复发送、执行或接受。

Source 交接：

- 交治理 API/实际 consumer/原 IDs/状态及有限正负，持续 C5，不用孤立 CLI 输出当默认产品完成。

### 成果 C5：安全草稿持久化与两项目普通重开

实施范围：

- 保留已关闭的文件/expiry 修复，完成草稿创建、明确更新、原 ID、来源/version 与当前项目的连续状态。
- 草稿读写有界、owner/private/regular/no-follow 和安全替换政策清楚，失败不损坏原草稿或别的用户材料。
- 加载只是历史数据，TTL 尚有效也需检查当前 source/config/选择；invalid/unknown 不可称 usable。
- 两项目、多会话、关闭重开、冲突 body 和 lost response 仍关联原 command/request，用户能明确核对再继续。
- CLI 与 App 使用同一 data-only DTO/语义，秘密、confirm token 与原文权限不进入持久草稿或日志。

实际 consumer：

- 原 main/F 普通会话与新工作流程能恢复草稿、重新预览并经原确认继续，不能只有终端工具可用。
- A 提供持久原事实，main 决定公开 API/副作用，C 不新建会话数据库、执行 ledger 或授权缓存。

必要正负：

- 合法 private 草稿/更新/过期/重新预览、两项目原 ID 重开和已知 receipt 核对有实际正例。
- symlink/0644/坏时间/大文件回归保持；source/version/项目变更、旧 token 和 duplicate 不造成重复业务。

Source 交接：

- 交持久策略、实际普通消费者、可操作错误返回与命令 exit，继续 C6，不重复旧三修补当本包成果。

### 成果 C6：实际 API、兼容与操作交付

实施范围：

- 收口生产 exports/types/source/dist、现有 API 兼容和主线默认上下文/决定消费者，而非继续堆工具脚本。
- 原 `ProductContextPreview`/provider/composer 与新 snapshot 共用有效性与原引用，不养两套相似规则。
- 文档说明选择、准备、确认、撤销/失效、readonly、unknown 核对和原来源重开，适用层级准确。
- 用完整两项目普通流交可定位数据/错误/预算，缺外部能力准确未达，不借其他 checkout/旧包补齐。
- 整体集成达到相应出口后再由 D/E 验准确安装，C 不发临时 first ZIP 或自授 release/native/value。

实际 consumer：

- main/F/A 用正式稳定 port/DTO 操作这块产品；E 可独立核原对象和权限结果，不信 report DONE。
- RootHTTP/App、委托 schema 与实际副作用由 main，C 早交可编译 caller，持续到它被真实消费。

必要正负：

- 相关 strict、模块/实际 consumer 的有限正负、旧接口及指南通过，源与受控结果可复现。
- unknown schema/缺依赖/旧版本/未安装/未达 native 不被混写为完整方案已交付。

Source 交接：

- 后期写 `packages/context/reports/wave34-status.json`，两个包六成果 source/对象/命令/已合/剩余齐全。

## 独立备选队列与持续执行

- main schema/原表单未到：交稳定 preparation/snapshot/caller，继续治理、草稿、兼容与失效。
- A continuation 未到：保留真正 truncated/unknown，继续决定/来源，不复制 SQL 或造替代 reader。
- F 尚未接线：给 DTO/状态例和明确回调需求，继续实际 main 数据/API，不复制第二 UI。
- 包一完成或受依赖阻断后继续包二/独立队列；研究/B/private 未达只阻对应层，不停止普通工程。

## Whole Goal 完成条件与边界

- 六成果各有生产实现、actual consumer、必要正负与 source handoff，并进入 main 实际集成版本。
- owned 仅 `packages/context/`、`packages/proposals/`、`packages/knowledge/`、`packages/routing/`。
- main 掌 shared/root/contracts/lock/HTTP/App/transport/授权，A 唯一生产 SQL/迁移，E 独占产品断言。
- 自动真实 vendor/model/native0，B cap4 UNKNOWN/E 原 blocked pilot 不 reset/topup/refund/补样或价格研究。
- 保留十二服务及全部 state/profile/tar/ledger/dirty/runs；仅独立 birth/full 资源且每次 fresh 可受信号。
- 无 global discovery、借凭据、真实 CLI 回退、新 Driver/CAC/桌面/自动接受/第二 ledger 或生命周期。
- CAC排除，不新建 checkout/线程，不做 first-ZIP 冲刺；数据 valid 不是 grant，未达层不靠数量补完成率。
