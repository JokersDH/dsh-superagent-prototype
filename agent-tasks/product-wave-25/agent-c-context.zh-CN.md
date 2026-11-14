# Agent C：完整身份与清单驱动的同包双格式审阅整包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-c`，原分支 `codex/g3-assistant-context`。
仅拥有 `packages/context/`、`packages/proposals/`、`packages/knowledge/`、`packages/routing/`，原 lock 差异和所有历史 runs 保留。
先读 `START-HERE.zh-CN.md`、`product-spec/README.md`、[本轮 README](README.zh-CN.md)、[0064](../../docs/rfcs/WP-16/0064-trial-readiness-and-parallel-inputs.md)、[0065](../../docs/rfcs/WP-16/0065-wave-25-eight-agent-delivery.md)。
fetch 并合并最新 `origin/main`，真实接口和 source 以当前 `AGENTS.md` 为准；八位外部 Agent A–H 与 main 并行，C 不越界改 UI/HTTP/SQL。
保留 C `d9ada879` 的真实 A 模块调用、两次实际 restore/source consumer、精确 0ede 包正向和旧 source/cleanup 回归，不重派已关闭旧问题。
新缺口是 package 必需 PID/APIstart 仍能缺省通过，以及这些已有路径尚未成为一次 manifest 驱动的同包全链。

建立或延续整个结果包 goal，不设 token 预算。十六阶段连续实施，C4/C8/C12/C16 后发布四个可运行完整结果里程碑并继续。
主结果：完整 identity 必需/拒缺省 → 唯一 driver 实际消费 A expectation/manifest → 准确包两格式独立恢复与失效 → 完整工具 API。
工具核验不授执行或发布权，E 保留独立 installed/release 断言；package 与 later-main UI 字节不可互贴。

## C1 固定已通过的实际 consumer 范围

- 同步 main，确认实际来源诊断 UI、CLI help 和 package 接口已经存在，不继续列旧 missing-entry。
- 保留 source 严格结果、HTTP abort、合法 reuse、cleanup 降级和准确 0ede default entry 正向范围。
- 分开记录 package positive、缺省 identity gate、source 双 restore 和 A 模块调用，不能合并成未实测全链。
- 列出当前 descriptor、数据输入和实例接口的真实版本与最小依赖。
- 验收：新任务只针对实际剩余缺口，旧成果和限制有准确 source/命令引用。
- 交接物：本轮稳定入口、状态/退出码语义和依赖表。

## C2 package 必需身份拒缺省

- 必须验证 launcher PID/start、API PID/start、state/install/config/root/operation、实际选择和 current health 的完整关系。
- 修复 `typeof pid === number` 才检查、没有 else 的路径，缺必需字段不得继续 `bound:true`。
- 明确 status checks 的必需集合，不能因空 checks 的 every/some 语义而认证身份完整。
- 合法同选择 reuse 保留原 PID/start；不同选择/根/配置、已退出或替换的进程准确拒绝。
- 验收：完整私有正对照通过，唯一省略 PID/APIstart 或改 start/root/config 各准确失败，真实完整包 positive 保持。
- 交接物：必需 identity schema/公开读取契约与实际 driver 负例，不只单测自造对象。

## C3 descriptor 与清理结果保持真实

- 执行、status、stop 和 provenance 统一使用同一个实际 descriptor；合法非默认 pa-entry 也报告正确路径/hash。
- 保留 descriptor_mismatch 的 fail-closed 行为，不能为兼容覆盖取消来源核验或返回未执行默认字节。
- cleanup 必须先证明本轮出生 ownership；复用、keep、unknown 与必须停止分别处理，不按端口或共享目录认领资源。
- 原有 owned stop 失败降级保持，缺 PID 不能初始化为“已不存活”继而认证 stopped。
- 验收：真实入口/hash 一致，必需自有停止有可验证终态，unknown 保留状态和材料，reuse 实例不受信号。
- 交接物：单一 descriptor、来源证明与状态明确的 cleanup 输出。

## C4 第一里程碑：完整实例核验可运行

- 固定一个准确包，实际 prepare/start/status/health/stop 和合法 reuse 使用完整 identity 规则。
- 准确复验缺 PID/APIstart 原反例，正向完整观察不能代替遗漏拒绝；别将旧失败重新称未实现所有包能力。
- preparation、identity、HTTP、status、stop 的剩余总预算和输出大小继续保持，新增时限风险有限校准。
- 不因 short positive 宣称所有故障均服从总限，保留实际 fault 与长期未知范围。
- 验收：发布第一可运行完整实例结果和有限负例，交后继续 manifest/双格式，不停在小修完成。
- 交接物：准确 package subject、完整 observation、实际命令与缺省拒绝证据。

## C5 唯一 driver 的 A 数据输入

- 为唯一 personal-review driver 提供实际 A producer/expectation/manifest 输入，不只新增一个独立 wrapper 测试。
- A 是数据/SQL owner，C 调用其公开数据接口，不能在 C 复制清单算法或制造第二 producer/ledger。
- 可信 expectation 来自原 producer，不能由待验证 manifest 自己生成 required sets。
- 输入版本、A source/module 字节、数据根、原 ID、格式和 coverage 都有准确来源。
- 验收：同一次 driver 真正验证 A 输出后才使用其 HTTP 标识；manifest 缺失/不完整/不匹配准确拒绝。
- 交接物：可运行 CLI/API 输入与类型，确需 shared contract 时交 main 最小 RFC。

## C6 原身份到 HTTP consumer 的映射

- 由 A 数据输入取得原 Work/attempt/question/answer/candidate/context ID，不在另一 fixture 手填同名行补齐。
- 对回原 assignment/contract/epoch、required commands/dispatch/observations、delivery 和 coverage。
- 原根到恢复根依赖真实 snapshot/restore 证据，不手改 dataRoot 后重算摘要绕过来源检查。
- HTTP 返回的实体和冻结字节必须与原数据清单相符，错误响应或空字段不算缺省成功。
- 验收：一条输入关联到实际 HTTP 数据；foreign ID、删集合、错根或错来源在读取错数据前失败。
- 交接物：A→driver→HTTP 的完整运行记录和原 ID/字节对应。

## C7 版本与能力可迁移输入

- source/package dialect 使用相同数据语义，但实际入口、依赖、root args 与字节来源准确分开。
- 支持 caller 提供真实安装根和 artifact subject，不搜索任意 checkout 文件补旧包能力。
- 缺入口、缺格式或不含晚到诊断能力准确失败/未达，旧包既有范围保留。
- 不包含 token、私有 key/profile 或可复用批准；packageSubject 普通回显不能替代独立来源校验。
- 验收：参数化输入可在不同新根运行，能力差异可机读，无 hidden fallback。
- 交接物：公开输入、输出和能力错误 contract，D/E 可直接消费。

## C8 第二里程碑：清单驱动实际包读取

- 用准确冻结包运行一次 manifest 驱动的实际只读用户流程，而非并列几个 PASS。
- 实际候选/history/Work/问答/delivery/冻结原文回到同一批 A 数据，业务 422、provider/queue 不增。
- 含新 UI/诊断的声明只绑定包含该字节的包；旧 0ede positive 不认证后来 main UI。
- 独立 verifier 仍由 E 拥有，C 工具 verified 不是全产品发布 verdict。
- 验收：发布第二可运行完整链，保存 producer/expectation/manifest/consumer/package 的准确关联，交后继续。
- 交接物：同一次实际调用和可复制参数，不需要用户手工修改内部文件。

## C9 两格式各自真正 snapshot restore

- 同一批原数据独立创建/验证默认 workflow v1 和显式 v2 两份快照，保持真实配方和各自摘要。
- 每份快照分别走真实 bundle/restore 到不同新根，不仅 copy DB、改 marker 或重贴版本。
- 两个根各自生成新读取选择，准确绑定实际包/consumer；恢复不继承旧执行授权。
- personal-evidence/bundle 与 workflow snapshot/evidence 协议分别记录，不机械换版本号。
- 验收：两套实际 restore 记录与原 manifest 对得上，错快照/错根/错 artifact 映射拒绝。
- 交接物：两个独立格式的 producer、快照、恢复、选择和 consumer 链。

## C10 同包双根完整用户流程

- 在同一个准确包分别消费两个恢复根，读取同 Store 原 Broker/SDK/候选/history/Work/delivery/正文。
- 验证原实体、冻结摘要、coverage 和实际返回，不让当前 live source 替代原文或权限显示进入普通输入。
- 合法窄 Scope/新增排除仍由 main 原 body gate 隐藏内容，诊断只解释不授权。
- 原回执不能重放为新执行，provider 无新请求、held queue 保持、业务拒绝不放松。
- 验收：两个实际包内流程各自完成并产生一致原数据关系，不能用 source 两格式加 package 单格式拼结果。
- 交接物：准确 same-package 双根/双格式结果，原 IDs 与各 consumer 字节独立记录。

## C11 独立失效和有限重开

- fresh 合法正对照后分别改变 signature、source、marker、artifact、root、Scope/排除和有效期。
- 用户刷新/重开只读页面、相同选择 reuse、不同选择拒绝分别使用准确原实例观察。
- 失败保留状态、材料与 unknown，不自动重发、换执行身份或关闭无法证明本轮出生的实例。
- 区分 configured、fixture、unavailable、unknown 与 native admitted，不能把 readiness 展示升级成授权。
- 验收：每个负例单变量、有限退出、原因可归因；正确来源和合法 reuse 不受扰动。
- 交接物：完整实际正负矩阵与资源保持记录。

## C12 第三里程碑：双格式包内闭环

- 发布 manifest 驱动的同包两根完整结果及已覆盖失效/重开，不停在独立模块修复。
- 不具备 B/private/target 的包只声明实际只读恢复范围，不以它认证原生业务恢复。
- source、旧准确包、后来 UI 字节与独立 installed verdict 保持分别可追溯。
- 依赖未到准确标未达并继续 tooling/API/成本阶段，不要求用户重派才做独立工作。
- 验收：第三可运行源码能从一个调用复跑两格式实际链，证据未混 subject。
- 交接物：D/E/main 可直接复现的数据和运行说明。

## C13 全阶段时限与故障归还

- 对新增完整链实际校准 prepare/identity/start/HTTP/status/stop 的剩余 budget，不只测函数参数。
- 连接不响应、半 JSON、入口早退、status unknown、停止失败和进程替换均有有界控制。
- 预留 cleanup 时间，PID 等待和 kill grace 不可无限越总限；总限不足时准确保留未知资源材料。
- 日志、response、manifest 和输出 bytes 有上限，不能为诊断读全库正文。
- 验收：每个承诺时限有 elapsed/退出证据，本轮自有资源可验证归还，reuse/用户资源保持。
- 交接物：时限表、故障结果和精确 ownership/终态记录。

## C14 完整工具 API 与兼容

- 收口唯一 driver 的数据/consumer API，不依赖本机旧 wave 测试路径或手填 actor/key。
- 输出区分 observed、verified-flow、reused、refused、NOT_REACHED 和 failed，caller 不猜 exit0 的意义。
- 旧 source 正向范围兼容，新增 manifest 模式的要求与 partial/unknown 明确，禁止默认补值产生新 authority。
- strict/exactOptional、对应 build 和真实 consumer 编译通过；工具版本与实际入口字节可追踪。
- 验收：独立调用者按文档完成同一次流程，缺能力能准确处理，不回退源码补证。
- 交接物：正式参数/API、输出 schema 和版本迁移说明。

## C15 UI 输入与独立交接

- main 已实现来源诊断 UI，C 更新真实四态/七 reason/partial/遮蔽数样例和实际 consumer 输入，不改 console/HTTP。
- F 的试用体验与 G 的可选观察报告不授新读写权限，不公开 readable count/raw path/principal/token。
- 将同包流程的精确 source/artifact/build/schema/ABI/mode 和文件 hash 提供 E 独立认证，不修改其断言。
- 旧正确样例继续保留，长期撤权、并发 writer、业务恢复等未测范围准确写明。
- 验收：真实样例可供 main/F 展示，D/E 能复现实际范围而不借 checkout 字节。
- 交接物：更新 UI input、工具指南和证据索引。

## C16 第四里程碑与最终整包结果

- 状态写 `packages/context/reports/wave25-status.json`，逐阶段记录实际 source、command、exit、原 ID、manifest、consumer 与资源结果。
- 第四可运行结果覆盖完整 identity、唯一 manifest consumer、同包两格式恢复和工具公开 API。
- 分开说明 source/package/installed、normal/recovered/native、private/target/value，不以多个独立 PASS 拼成未跑全链。
- 显式 stage 自有路径并 push 原 `origin` 分支，不推 upstream/reset/清历史，保留 lock 差异和全部 runs。
- 验收：所有承诺结果可实际复跑，未达依赖不计完成，goal 仅在整个包实际完成后结束。
- 发布后继续独立队列，不在第四里程碑前以完成一个旧反例结束工作。

## 独立备选队列

- A 数据入口未齐：先交真实 consumer 输入和独立期望 contract，继续完整 package identity、root 映射与失败控制，不造新 producer。
- D 新包未到：完成准确旧包的实际范围与 source 全链；晚 UI/新能力保持未达，不借 checkout 替换。
- B/private/target 未到：只阻对应业务恢复，普通只读同包双格式流程继续。
- 全程真实 vendor/model/native 调用 0；B 原 cap4 UNKNOWN 不可花，E 原 BLOCKED pilot 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807、全部 state/profile/tar/ledger、旧 dirty；只处理独立证明本轮出生的精确资源。
- 不改 A/B/D/E/F/G/H 路径、main UI/HTTP/contracts/根 lock，不新增 Driver/CAC/桌面壳/自动接受/动态 DAG。
