# D：两个连续工程包，完整发行与可重复业务使用

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-d`，分支 `codex/g3-local-distribution`。
先读 AGENTS、START-HERE、product-spec/README 和 [本轮 README](README.zh-CN.md)。
读 [0086 原生回调与支持消费者](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)。
读 [0087 验收架构](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)。
读 [0088 两包工程计划](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。
main `23d5a98e6e75a3b0fb08168431260a9935cf5674` 已提交0086 callbacks/support的真实source。
它不授新的 native、恢复、安装或发行准入；W33固定字节与后来必要后继保持独立。
本任务是一个 whole goal：两个连续工程包，每包三个完整产品成果，共六成果。
不是六个小修阶段，也不是临时 ZIP 冲刺；目标是完整方案 B 可重复运行和交付。
建立或延续整块 goal；source 早、中、晚发布后继续第二包、联调和独立队列。
不设工时、时长、同日完成或 token 承诺，不在一次提交、一个 PASS 或某个包后停工。

## 既成事实与责任边界

- D 固定输入 `7b8022e6`，W33 构建源 `048f0184606202b0b39e7426b7747f3fe57541c1`。
- 当前 W33 inner build `f880e5bc9c6c1c57`，tar 大小 `20547728` 字节，6867 清单项。
- tar SHA：`ee45c92c7c5a8f2caa0449572b14bf97175b0392f1fd92c6f89d7a19464604e8`。
- outer ZIP SHA：`46e01c8c7b79818d19e019f6d2208ad54c5c9538674218f85455434eff8207f9`。
- outer 大小 `63481603` 字节，6875 清单项；完整 inner/outer/CRC/Node/LICENSE 已独立通过。
- 当前 canonical source closure 已去重为 192 路径；旧 W32 的 197/192 与陈旧 209 已区分。
- 新非空 Work/合同/接受、20 artifact 备份与四个产物 bytes 在源/恢复/升级根均已真核对。
- 这些不是旧 eventSeq0 的结果，不重派成“先证明有非空数据”，也不抹掉原有进展。
- 但数据由同源码受控 Product 产生，Store 读取与公共已授权 HTTP 读取仍要区分。
- 原始 `rollback.json` 是 BLOCKED；summary/guide 的 BINARY_ROLLED_BACK 尚缺成功原回执。
- E306PASS/20NT、199/200 为 R1 基础加 W32 新 subset，不能认证 D 最新 W33 全包。
- H 已改为等待 available accept，并在 W32 真正接受/交付/重开；不再修它的旧抢跑。
- 只拥有 `apps/launcher/`、`packages/portability/`、`tools/distribution/`。
- main 拥有根契约/配置/锁、HTTP/provider/App/transport、唯一 bootstrap 封装和共享接线。
- A 独占生产迁移，E 独占产品断言；D 不改 E gate、不造第二 review 或生命周期。
- 状态写 `tools/distribution/reports/wave34-status.json`，实现/consumer/subject/限制分别记录。

## 工程包一：把普通运行和真实业务生命周期做完整

这一包的共同出口是同一准确版本可反复使用，不靠新目录或重建包绕过原失败。
三个成果分别交实现、actual consumer、合法正向、必要独立负向和可运行 source handoff。
保留现成 W33 作为可消费输入，先交早期 source，再持续完成本包与第二包。

### 成果 D1：真实普通配置与原 CLI 生命周期

让首次使用、已有配置、重复打开、准确关闭和重开成为同一个产品流程。
actual consumer 是原 `bin/pa`、main 外层入口、配置/readiness 与实际工作台。

- 模型未配置、已有私有 JSON、允许模型切换分别观察，不把配置存在写成模型调用成功。
- 使用用户显式选择的配置；不复制作者 key/auth/home/native session，不覆盖现有文件。
- Settings 仍是私有 JSON 编辑入口，不宣称网页已经可任意编辑 key/Base URL。
- 同一安装、build、模式、端口和五 roots 在所有后续命令保持一致。
- 首次自动同包 adopt、合法 REUSED、status STOPPED exit2 与真正 BLOCKED 各自判断。
- 正常运行与退化只消费原执行器可用性/版本/认证事实，不静默 fixture 或真实 CLI fallback。
- 版本/存在性诊断不是 native turn；原 native admission 和 beforeNativeWrite 继续权威。
- 模型缺失可讨论准备/审阅；不把 discussion-only 说成可任意开发，也不假造执行器可用。
- 合法接受等待 `actions.available` 的 accept_candidate，并看原 verification/resource 状态。
- 保留 H 新合法接受正向，不松 trusted review/机器 FAIL，不实现第二套 review。
- 必要负向包括错误 root/config/build/端口、权限变化、版本不符、重复打开和失效旧记录。
- 失败保留原 state/record/日志，不能换根、强清理或借别的账号制造可运行。

验收：同 tuple 的普通使用可重复，原 CLI 退出、健康、配置和资源身份一致。
交接：实际入口/返回、原始命令 exit、合法 positive 与原因准确的 negatives，不只写 PASS 数量。
发布 source 后继续后两成果；E 最终结论未到不阻配置、兼容和文档的独立队列。

### 成果 D2：同 cohort 非空业务反复备份、搬根与只读读取

在已通过的新非空数据上扩展反复使用，不重新把一个 eventSeq0 正向包装成非空。
actual consumer 是原业务生成链、包内 backup/verify/restore 和授权后的原身份 reader。

- 保留 Work `e9c9a0de8048124ad16d7a04bd979024`、accepted49/游标51、四产物真字节记录。
- 参数化 producer/reader，明确 source 生成、安装运行和公共 HTTP 哪一层产生证据。
- 同版本至少经历新增业务、备份、重开、新根只读读取，不能每次用空 state 重做首次安装。
- 核原 Work/合同/candidate/接受、question/answer/receipt 与全部引用 artifact IDs/bytes/digests。
- 新旧备份各有不可变 manifest/source/evidence digest，不覆盖旧归档或混淆 snapshot 格式。
- 原 CLI 用 `backup --out`、`verify-backup --bundle`、`restore --bundle --to`。
- 恢复目标必须新建、私有且非活跃；不从已停请求或 parent 消失推出可覆盖。
- v1/v2 workflow 与 personal bundle 按各自真实 recipe 核对，不重命名或忽略 family 凑兼容。
- 已经通过的 Store 字节连续性继续保留，进一步接已有明确 review/rebinding 的公共读取。
- 无授权403、明确选择后原身份可读、业务写入422分别验证，不借 fixture 越权完成个人读取。
- 已完成 begin/answer/deliver 不重发；有真实待处理 queue 才能声称验证了 held/no-resend。
- 恢复不复制 executable grant、认证、native session，不自动恢复执行或激活 target。
- 必要负向从同一合法数据派生：缺/同长度改 artifact、错误 source/manifest/映射、未来 schema。
- 缺授权 consumer 时发布最小依赖，继续格式、产物、重复备份和数据保护队列。

验收：反复使用后的非空数据经同 cohort 新根 readonly 保持原身份与字节，原动作不重复。
交接：真实数据 recipe、所用包/entry hash、每轮原 IDs/bytes、公开读取及正负边界。
不得用旧 R1/W32 的非空结果认证 W33；也不因数据 counter 不列 Work 就抹掉已证 Work 行。

### 成果 D3：非空升级到真实回退或诚实保留的原操作

把当前 CONFIRMED 升级和数据保留接成完整可核对的原管理操作，不拿 summary 替回执。
actual consumer 是原 upgrade/rollback-install、operation/journal/pointer、健康与同 Work 数据 reader。

- 保留当前 W32→W33 CONFIRMED、target health 与相同业务/四产物可读的合法事实。
- 保留原 BLOCKED unknown_live_resource 的 `rollback.json`，不能回写成成功。
- 若确有成功重试，另交成功原 CLI receipt、exit、operation、前后 pointer/identity 和读取结果。
- 若仍被原 guard 阻断，写 HELD/NOT_REACHED 与最小复现，不把 pointer/Store 可读等同回退成功。
- 不强杀 wrapper shell、不按路径认领未知资源、不删除 record 或绕过原资源检查。
- baseline 业务应由 baseline 消费者生成；当前从 W33 复制同 schema 数据的范围要继续披露。
- 补升级后真实新增业务，再验证 binary rollback 没有恢复旧快照或丢掉新增事实。
- 区分二进制指针回退、数据恢复与 A 的生产迁移，不做 schema 降级或第二 migration。
- 合法正向后覆盖错误目标/ABI/健康、UNKNOWN writer、复制 scope 与失败回退的数据保护。
- 所有关闭/切换仅原入口，完整独立资源集合未知时保留整个 operation 的材料。

验收：升级和回退状态/exit/pointer/data 同源，成功有原回执，拒绝也有完整保留证据。
本包交中期 source 后继续工程包二，不因外部准入未闭把 whole goal 结束为 PARTIAL。

## 工程包二：可搬迁运行、唯一发行事实与完整独立交付

这一包消费前包成果，形成可供 main/E 实际使用的完整发行子系统。
不另起 Node wrapper/installer/daemon，不把包装完成当作完整方案 B 已完成。

### 成果 D4：可搬迁 Mac ARM 发行与同事使用现实

把现有可搬迁发行变成他人能按准确说明重复使用的产品路径，保留 Apple Silicon 实测范围。
actual consumer 是现有 outer、bundled Node、原入口、显式私有 roots 和支持诊断。

- 包内 Node/完整 LICENSE/依赖许可和原 inner inventory 不变，运行后数据始终在包外。
- 解压路径有空格/中文、移动后的稳定安装位置、端口占用与缺项目工具给明确行为。
- 打开工作台无需全局 Node，不等于开发任意 npm/pnpm/Git 项目无需其工具与依赖。
- 未签名/未公证及组织安全策略现实写清，不自动修改系统策略、全局账号或安装权限。
- 支持同事自己的模型配置与原生可用性，不能分发构建者 HOME、key、native profile 或 state。
- 测试只消费 main 明确的 preview/private-root 选择，不重设 HOME 或借用用户真实目录。
- 若共享显式 root 接口缺失，先交最小约定由 main 实现，不复制另一套外层入口。
- 跨机、长时、签名和其它平台分别测或明确未达，不从同机 copy 推断兼容。
- 错包/Node/LICENSE/配置权限/已有输出/不可用执行器的拒绝必须保持无覆盖、无强清理。

验收：可搬迁入口、许可与支持范围准确，可由同事用自己的根和认证重复操作。
交接：实际 consumer/平台/权限/入口和失败材料 policy，不把作者目录变成运行依赖。

### 成果 D5：唯一 manifest/source closure 与支持事实

让构建、安装、文档、支持和验收都从一个可核对的发行事实来源取数。
actual consumer 是原 build/stage/freeze/manifest checker、source closure 与 support 读取路径。

- canonical 当前192路径已真去重；grouped204、旧197/192和旧209只保留准确历史角色。
- 数字随真正源集合生成，不另手写一份数量或补重复文件让表格看起来一致。
- source/dirty、runtime checkpoint、build、tar/ZIP hash/bytes、schema/ABI/依赖与 entry hash 全绑定。
- 完整 launcher/portability/console/coordinator/storage/native ABI 运行闭包一起验证，不孤取单文件。
- support 白名单保留错误/未知/operation 事实，0600、新输出、无秘密，不抹掉原失败。
- module close、receipt sent、process stopped 和 accepted 事实分开，不能以摘要推资源静止。
- 必要负向包括 cross-artifact consumer、陈旧/缺 manifest、内容变异、外链与错误 entry。
- 旧包缺后发功能只按时间范围说明；当前 checkout 不补冻结缺项，文档 HEAD 不替运行身份。

验收：包/源码/支持/文档能独立追到同一真实事实源，合法 old scope 不被覆盖。
source 先给 main/E 消费，再补所有必要独立控制；不靠静态数量提高产品完成率。

### 成果 D6：锁定 W33 的完整 E 交接与必要后继

先把已有准确 W33 `f880/46e` 作为完整产品输入交 E 独立消费，不再包装抢跑。
actual consumer 是 E 的 immutable loader、实际 outer entry、非空数据和产品 required/oracle。

- E 一次锁一个明确 cohort；给全部 sidecars、可重做业务 recipe、原入口和未达，而非移动 main。
- E306/20NT 的199/200为 R1+W32，不得重贴为 W33 independent PASS。
- main `23d5a98e` 的0086真实 callbacks/support 属新 runtime；必要时作为另一明确后继 cohort。
- 先发布源码/接口和已验 consumer，待 main 选定运行组合后再用原 D 工具 freeze 一次。
- docs/tests-only、数量校正或 E 断言修复不 refreeze，不要求 E 反复追 HEAD。
- 保护已有 W33/W32/R1/R2、所有 raw失败和成功；后继不覆盖 archive 或重新命名旧 subject。
- E 工具新 caller retention P1 必须由 E 修；D 不改 assertions，也不借工具问题掩盖产品缺口。
- 最终安装/恢复/原生/收益独立分层；仅已证的 ordinary/controlled/data scope 可进入说明。

验收：main 和 E 有一个稳定、完整、实际可消费的产品 cohort，必要后继也有明确边界。
晚期 source 和完整交接发布后继续独立队列与联调，直到两包六成果实际闭合。

## 独立队列、完成条件与提交边界

外部依赖只阻对应项；发最小可编译约定/owner复现，继续配置、兼容、数据、support、许可和文档。
每成果都必须有实现、actual consumer、合法正向、必要独立负向与 source handoff。
无完整新运行数据就记 SOURCE_READY/NOT_REACHED；只交 source 或候选不称 whole goal 完成。
只提交显式 owned 路径到原 origin 分支，不 upstream/reset，不回滚用户或其他 Agent 内容。
自动真实 vendor/model/native0；B cap4 UNKNOWN 不可花，E 原24turn/200000token/USD5 pilot BLOCKED。
不 reset/top-up/refund/补样/价格研究，不冒用用户后续主动使用补自动验收证据。
保留全部 state/profile/archive/ledger/history/dirty/runs/五日志及十二5180/8796至5191/8807实例。
live 只允许完整独立 birth/PID/start/UID/fullargv/root/config/op/full resource proof 的自有资源。
全集合先验、每次 signal fresh；UNKNOWN 保留 HOME/install/state/model 等整份材料，不 force cleanup。
禁止 global discovery、路径认领、借凭据、真实 CLI fallback、自动接受和第二生命周期/账本。
无新 Driver/CAC/subteam/桌面壳/writer racing/动态 DAG；共享授权、机器 FAIL 和受信 review 不放宽。
整个 goal 同时覆盖工程包一和二；交接不是停点，外部 BLOCKED 不终止可做的完整工程。
