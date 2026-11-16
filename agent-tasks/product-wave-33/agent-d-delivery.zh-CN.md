# D：完整普通生命周期、非空迁移与准确发行

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-d`，分支 `codex/g3-local-distribution`。
保留全部历史和工作区内容，同步 `origin/main`，先读 AGENTS、START-HERE、product-spec/README。
本轮约定见 [README](README.zh-CN.md)；以下三个成果属于同一个完整工程 goal。
读 [0083 已发布消费者](../../docs/rfcs/WP-16/0083-main-registered-port-and-workbench-consumers.md)。
读 [0084 验收架构](../../docs/rfcs/WP-16/0084-wave-33-reviewed-architecture.md)。
读 [0085 整体工程计划](../../docs/rfcs/WP-16/0085-wave-33-whole-product-program.md)。
main `fc38` 已交真实登记端口和 F 工作台消费者；端口可读不等于原 Work 恢复通过。
目标是随完整方案 B 交付可重复使用的发行子系统，不以临时 ZIP 冲刺替代工程完整性。
建立或延续覆盖全部三成果的 whole goal，早、中、晚发布可运行 source 后持续推进。
不设同日 deadline、耗时承诺或 token 预算；一次 source 发布、一个 PASS 或一个包不结束整块。

## 固定输入与责任

- 当前 D 输入 `bb6b5b11`，干净构建源 `e8348a864d7d192589e72b8099475520f841b1e5`。
- W32 inner build `88eb8c69b0671171`，tar SHA `65c386d108d385c1e8463de33b801a1865925d5dd752a7b82a0c57974b8453ac`。
- inner 大小 `20543106` 字节，6866 清单项；实际文件、链接和摘要已独立通过。
- outer ZIP SHA `0a46cd3620e00154ea13e7286dcc73e40ffad4df4522f2339e229ffcb027bc06`，`63475809` 字节。
- outer 6874 项、Node/LICENSE、原入口模板、ZIP CRC 和准确 source/build 已独立静态通过。
- 保留这些真进展，不重做 Node wrapper、第二安装器或相同字节的新包来增加交付数量。
- 本轮实际 source closure JSON 是 197 条、192 个唯一路径；status 的 209 是陈旧计数。
- E 最新真实对象仍为 R1；其新生命周期记录不能自动认证 W32 inner 或 outer。
- W32 本轮 backup 为 eventSeq0、artifacts0；它证明机制，尚未证明非空业务迁移。
- 只拥有 `apps/launcher/`、`packages/portability/`、`tools/distribution/`。
- main 独占根契约、配置、锁、HTTP/App/transport 和 bootstrap 外层集成；A 独占生产迁移。
- E 独占产品断言和最终独立结论；D 不修改 E 的 gate 或用自测替代 E verdict。
- 状态写 `tools/distribution/reports/wave33-status.json`，按真实 source/consumer/subject 分层。

## 成果一：真实普通运行与配置生命周期

让同一已选安装版本完成首次配置、普通启动、准确复用、状态读取、关闭与再次使用。
真正 consumer 是包内原 `bin/pa`、当前个人产品入口、公开配置/readiness 和实际工作台。
继续使用 main 的唯一 Start/Stop/Settings/Node 封装，不复制生命周期或新增后台服务。
先消费现成 W32；只有实际运行源码确需改变时才形成必要后继，不因文档或测试重冻。

- 模型未配置、已有私有配置、明确切换允许模型各自保持准确状态，不把配置存在当成功调用。
- 不把网页模型选择器写成 GUI API key/Base URL 编辑器；现有私有 JSON 权限继续执行。
- five roots、安装路径、build、模式、端口和配置身份在后续 start/status/stop 中保持一致。
- 同 tuple 合法复用必须核真实 PID/start/health；重复打开不能产生第二个无主实例。
- 缺执行器、版本不符、认证未就绪时明确退化或拒绝，不能用固定 fixture 冒充原生编码。
- 只读版本/存在性诊断和实际 native turn 分开；自动真实模型/native 仍为 0。
- 原 native 准入和 `beforeNativeWrite` 守卫权威不变，外层 Node 不带来执行许可。
- 当前机器已有配置由用户显式选择，不复制构建者 model key、账号目录或旧授权。
- 明确个人 normal、discussion-only、fixture 与 restored-readonly 的 scope，不混合正例。
- 准备真正合法正向后验证 wrong root/config/build、不同端口、不可用执行器和配置权限负向。
- 失败不能清空 state、自动换 fixture、借另一账号认证或强制清掉旧进程制造可用。
- 记录每个入口的准确 source、包 hash、命令 exit、请求模式与实际返回，不只写 PASS 总数。
- 现包没有 main fc38 新工作台时如实写时间范围，不能调用当前 checkout 补冻结能力。
- H 的 review-unavailable 触发只等待 currentCandidate，未证明 ready 后仍拒绝。
- 合法接受应等原 `actions.available` 包含 accept_candidate，并读取原 verification 状态。
- 不为该旧触发抢跑放宽受信 review、机器检查或资源屏障，不实现第二套 review。

验收：同一准确版本的普通操作可重复，配置、执行可用性、实例身份和实际退出相互一致。
早期 source 交接给 main/E：实际入口、稳定接口、完整合法正向、必要拒绝与未达范围。
source 发布后继续成果二、三及本成果联调，不因等待 E 最终结论暂停独立工作。

## 成果二：同版本非空业务备份与搬根只读恢复

用原产品消费者生成可追溯的业务数据，再在同一安装 subject 上完成完整备份和新根恢复。
真正 consumer 是原 Store/Application/Broker/检查/人工接受、原 backup/verify/restore 及公开只读 reader。
使用已有受控能力和明示自有根；不得消费真实供应商 turn 或把另一包的非空结果重贴当前包。

- 数据至少包含原 Work、合同/candidate、人工 accepted 事实、产物记录与可核对产物字节。
- 需要问答时保留原 question/answer/delivery/receipt 身份，不能只手填一张 summary 表。
- 记录业务 source、subject、原 IDs、事件游标、产物 bytes/digest 和真实生成入口。
- eventSeq0 或只有数据库条目的备份只计机制正向，不能称本成果完成。
- backup/verify/restore 使用原 CLI 的 `--out`、`--bundle`、`--to`，目标全新且不覆盖活跃 state。
- 在同 tuple 下备份实际非空内容和引用 artifact，不复制 native session、credential 或 grant。
- 新根恢复必须保持 readonly；不消费旧 queue，不重发已完成 begin/answer/deliver。
- 搬根后的原身份、合同/candidate、accepted 记录与产物 bytes 必须通过实际 reader 读取核对。
- 私有项目不因路径复制自动获权；消费已有明确 restored review/rebinding 入口及原授权范围。
- 无显式审阅时的 403、显式允许后的原身份读取，以及业务动作拒绝分别给实际证据。
- 同时读取或恢复 v1/v2 时绑定各自真实 manifest/recipe，不把重命名格式当兼容通过。
- 正向必须是原始真实生成数据；不以空库、fixture 越权或新 ID 重建替代身份连续性。
- 必要负向覆盖缺产物、同长度改字节、wrong source/manifest、错误路径映射与未来 schema。
- 单变量负向必须从合法正向派生，不能让参数早拒冒充内容校验或权限隔离。
- 失败保留 private 材料与准确错误，恢复产物和原 source 不覆盖、不交换身份。
- 读取和完整性证明仍是数据事实，不升级为恢复执行、目标激活或物理 quiescence。

验收：同版本非空数据和 artifact 经新根 readonly 实际 reader 保持原身份与字节，旧动作不重发。
中期 source 交接给 A/C/E/main：参数化真实数据 recipe、完整 subject、读取结果和独立负向。
若某项公共 reader 尚缺授权 consumer，提交最小依赖并继续已有格式、产物和升级队列。

## 成果三：升级回退、支持与唯一发行闭包

把普通运行与非空业务成果接入原升级/回退/支持路径，交一个准确可被 E 锁定的完整 cohort。
真正 consumer 是原 upgrade/journal/pointer、目标 health、backup、rollback、support 和唯一构建闭包。

- 保留已有 R2→W32 七项机制正向；它同 schema 且未 seed 业务，不外推非空或生产迁移。
- 新业务正向在升级前后读取同一 Work/accepted/artifact 字节，明确 baseline 和 target 的角色。
- rollback-install 只回二进制指针；不能用旧快照覆盖升级后新写入来伪造数据连续性。
- 错误目标、目标不健康、错误 ABI、复制 record、UNKNOWN writer 与新数据保护保持拒绝。
- 真实生产 schema 迁移只消费 A 已准入入口，D 不私造 migration 或回填第二账本。
- 支持输出只含白名单诊断，0600、新路径、不覆盖；未知/失败不能在脱敏中被抹掉。
- 原 source closure JSON 是唯一数据来源，准确校正 197/192 与旧 209 文档，不增重复项凑数。
- 完整 root/config/launcher/portability/runtime/native ABI/dependency license/console 闭包一起核对。
- outer 保留 inner 字节，原 ZIP 不含任何运行后的 state、凭据或构建者配置。
- main fc38 的 F/登记端口是实际新 runtime 输入；按产品需求选择必要后继 cohort。
- 先给 main/E source 差异、接口和必要性，再用原 build/stage/freeze 形成新不可变 tuple。
- docs-only、工具断言或报告校正不 refreeze；不能每次 HEAD 变化都让 E 追移动包。
- E 一次锁一个 cohort；后继有真实新字节后明确交接，不覆盖 W32/R1/R2 或重贴旧 verdict。
- 当前未签名/未公证、Apple Silicon 同机范围、跨机与长期未测保持准确说明。

验收：非空业务升级/指针回退/支持/闭包能够共同指向准确安装 subject，E 可从唯一输入独立重做。
晚期 source 交接包含 owned diff、实际 consumer、有限命令/exit、原始正负材料及准确余项。

## 独立队列与整块完成条件

外部依赖只阻相关项，不无限轮询，不新增第二实现；先发布可编译约定和精确所缺 consumer。
可独立推进配置/复用拒绝、版本识别、support、许可证、格式兼容、文档数据一致性与升级数据保护。
三个成果都需实现、真实 consumer、合法正向、必要独立负向和可运行 source handoff。
尚未安装只记 SOURCE_READY；E 尚未验只记候选，不把整块写 COMPLETE 或提高产品完成率。
自动 vendor/model/native0；B cap4 UNKNOWN 不可花，E 原24turn/200000token/USD5 pilot 仍 BLOCKED。
不 reset/top-up/refund/补样或研究价格；研究受阻不停止独立工程，CAC/subteam 本轮不含。
保留全部 state/profile/tar/ZIP/ledger/history/dirty/runs，以及十二5180/8796至5191/8807实例。
仅完整独立 birth/UID/start/fullargv/root/config/operation/资源集合可进入自有 live 处置，每 signal fresh。
禁止 global discovery、force cleanup、未知删除、借凭据、真实 CLI fallback 或用 parent 消失推出静止。
无新 Driver、桌面壳、自动接受、writer racing、动态 DAG、第二生命周期或第二 review authority。
显式 owned 路径提交到原 `origin` 分支，绝不 upstream/reset；持续到整体工程实际可消费的三成果闭合。
