# Agent C：精确包内 consumer 与同数据双版本审阅整包

日期：2026-11-14。继续 `/Users/hh/Desktop/joker/superagent-agent-c`，分支 `codex/g3-assistant-context`。
仅修改 `packages/context/`、`packages/proposals/`、`packages/knowledge/`、`packages/routing/`；保留原 `pnpm-lock.yaml` 差异。
先读根 `START-HERE.zh-CN.md`、`product-spec/README.md`、[本轮 README](README.zh-CN.md)、[0062](../../docs/rfcs/WP-16/0062-source-scope-diagnostics-ui.md) 与 [0063](../../docs/rfcs/WP-16/0063-wave-24-admission-and-product-closure.md)。
fetch 并合并最新 `origin/main`，从当前 `AGENTS.md` 确认实际来源诊断 UI、CLI help 和发行源码；不把已发布入口继续列为缺失。
保留 C `a97fbd2` 源级严格结果、合法 reuse、HTTP abort、双格式 source 流程和故障回归 8/8；上轮旧三问题不再重派。

本包完成 package 分支可信运行 → A manifest 真正驱动同一 consumer → 精确包内双快照恢复与 UI 输入全链。
建立或延续完整结果包 goal，不设 token 预算；早期、中期、最终三个可运行里程碑提交后继续独立阶段。
实际 package start 尚未获验，不能以 source 8/8 或 package review 已到达推断整包成功；外部依赖只阻对应范围。
driver 是数据/行为核验工具，E 独立认证包与发布；不创建新的执行许可、确认 authority、SQL writer 或生命周期。

## C1 唯一实际命令描述与入口字节

- 修正 package 执行 `--pa-entry`，结果却报告默认 pa 文件摘要的问题；同一个已解析描述供 prepare/start/status/stop 与输出使用。
- 实际 source/package dialect 的路径、argv、工作目录、必要依赖和字节身份明确，拒绝相互矛盾的入口 override。
- 记录真正执行的 review/start/identity/stop consumer，不拿未执行的默认文件或 checkout helper 冒充同包来源。
- D/E 仍独立验证实际包路径和字节；普通字符串 packageSubject 回显不能成为 installed 认证。
- 验收：实际 override 与输出路径/hash 完全一致；默认文件存在但未执行的独立对照不能被报告为 consumer。
- 交接物：单一 dialect command descriptor、准确 provenance 输出与真实正向/唯一 foreign entry 负例。

## C2 完整 package 进程与读取身份

- package `RUNNING`/`REUSED` 必须绑定实际 PID/start、state/config/root/operation、review identity 与当前 health，不只检查状态和 digest 字符串。
- 从 main/D 已有可信实例接口取得身份；缺 PID、进程已变、root/config 不同或 health 非该 consumer 时保持不可验证。
- 合法同选择 reuse 保留原 PID/start 和读取选择，不停止旧实例；不同/缺选择、不同根与已退出入口后的旧服务必须拒绝。
- 记录未获信任的 RUNNING 输出不等于本轮创建资源，不能据此调用 pa stop；需要明确本轮出生或合法复用证据。
- 验收：完整 package 正对照通过，唯一省略 PID、改变 start/root/config/review digest 的变异准确拒绝，合法 reuse 无资源扰动。
- 交接物：actual consumer 关系图、required identity 字段和原实例保持记录，不以端口或同 UID 认领资源。

## C3 停止与清理结果必须真实

- 对必须归还的本轮自有资源，stop 失败、超时或结束状态 unknown 不能继续返回 verified-flow/verified:true/exit0。
- 先证明精确 ownership，再沿同一个 command descriptor 停止；不能因参数 state 指向某目录就停止另一个运行实例。
- 关闭后核对真实实例/进程结果，不仅看 CLI exit0；unknown 时保留数据、marker、资源身份和可恢复诊断。
- 合法 reuse 和显式 keep 属于不应停止的不同模式，准确标 not-owned/kept，不为凑 stopped:true 关闭它们。
- 验收：stop0 正对照与唯一 stop1/无终态/仍存活变异区分，失败非 verified；不删除 live 或 unknown 根。
- 交接物：完整 cleanup 输出、非零失败传播、自有资源归还与复用实例未动的证据。

## C4 统一总 deadline 与第一里程碑

- prepare、identity、start、HTTP、status 和 stop 都受同一总 budget 约束，预留清理时间，不保留独立固定 30s/10s 超时绕过短总限。
- HTTP 已有 abort 保持；增加 child/pipe/output bytes 上限和剩余时间传播，不让同步子进程或正文读取超出承诺。
- 总限耗尽时准确输出阶段/unknown，必要清理有明确剩余预算；不以 readiness_timeout 掩盖准备阶段已越总限。
- 旧源级 8/8 正向范围保持，不把修复总限变成重复扩大所有历史套件。
- 验收：声明 1s 的慢 prepare/identity/半响应/stop 场景在约定预算内结束；交早期可运行源码后继续完整包。
- 交接物：每阶段预算和实际 elapsed、终态与剩余资源记录，caller 能判断是否可安全重跑。

## C5 准确安装包实际启动 dialect

- 从 D 当前准确 frozen artifact 运行包内 prepare/start/status/health/stop，不只在 source checkout 观察 NOT_REACHED。
- 固定 tar/hash/source/build/schema/ABI/mode 与 actual command 字节；包内缺能力必须准确失败或标 `NOT_REACHED`，无 source fallback。
- 当前 main 已有 launcher/portability 集成；需要公共 identity/port 时提最小 RFC，不越权修改 launcher、HTTP、shared contracts 或 root lock。
- 旧包缺晚到诊断/UI 不代表旧读取回归；包含新能力的准确字节才能声明覆盖新行为。
- 验收：至少一个精确包完成真正 start 和只读请求，合法 reuse/不同选择拒绝在同包实测；缺外部包时继续其他阶段。
- 交接物：安装根、真实入口/字节清单、实例生命周期和能力分层，不让 D/E 猜测 source 与 package 混用。

## C6 A producer/manifest 真正进入 driver

- 实际读取 A 已修复的 producer、独立 reader、可信期望和完整 manifest，不仅保留 C 私有 helper 再声称“可消费 A”。
- 校验原 Work/Ticket/Assignment/attempt/contract/epoch、question/answer/target、commands/dispatch/observations 与 required coverage。
- 同 Store 数据来源和恢复 root 映射必须由真实 snapshot/restore 证明；不改 root/删集合后重算普通摘要绕过来源核验。
- 继续使用唯一 consumer driver，A 负责数据和迁移；若数据未达准入只阻完整 manifest 范围，不另造 SQL writer 或第二 producer。
- 验收：A 真实输出驱动 source/package 请求；foreign subject、原 commands 删空、错误映射或 partial 冒充 complete 准确拒绝。
- 交接物：A→C 实际调用、原 ID 对应与真实包内用户结果；提交中期源码后继续整包。

## C7 同 Store 原业务与冻结上下文

- 同一 Store 包含真实 Broker 问答、native_applied、Work、SDK 候选、确认回执、context binding 和冻结正文，不拼接不同 fixture。
- 生产数据经原公开应用路径返回，权限问题的显示文本不进入普通模型上下文，旧批准不可移给另一原生请求。
- 读取候选/history/Work/delivery/原文时验证实际原 ID 和字节摘要，未知不填零，当前 live source 不替代历史 frozen body。
- 所有只读业务命令保持拒绝，provider 不新增，旧 held queue 不消费；若 B 未准入不能将受控数据称 recovered native。
- 验收：一条完整同数据用户流程可从 producer 追到包内 HTTP，唯一 wrong ID/正文替换/回执重放各准确处理。
- 交接物：原数据 manifest 到实际返回字段的消费映射与 provider/queue 前后值。

## C8 两个真实 snapshot restore 与第二根

- 同批数据分别创建默认 workflow v1 与显式 v2 两份真实快照，各自 verify 后经实际 restore 到不同新根。
- 不以复制数据库后手写 marker 或重贴格式替代恢复；两个格式各自配方/摘要准确，personal-evidence/bundle 协议另列。
- 每个恢复根重新准备明确读取选择，绑定该包 actual consumer；源级与包级结果、producer 与 consumer 字节分别记录。
- 候选/history/Work/问答/原文可审阅，窄 Scope/新增排除保持原 main gate，恢复副本不继承执行许可或 writer 静止结论。
- 验收：同一精确包的两独立恢复路径都可运行，原 ID/摘要一致、业务 422、队列/provider 不增；未达格式准确分层。
- 交接物：两份 snapshot/restore/selection/consumer 链及其真实结果，不把同一次 copy 计成两个独立格式。

## C9 独立失效负例与 UI 输入

- 在 fresh 合法正对照后分别改变 signature、source、marker、artifact、root、Scope/排除或有效期，明确每个唯一失败原因。
- 保留诊断不授权、原正文 gate 唯一权威；有界 reasons/withheldSourceCount 保持，未知 readable counts 不公开、不扫描全库补数字。
- 给 main 真实来源 state/reasons、partial、遮蔽数与 UI 样例，核对本轮实际诊断 UI；C 不改 console/HTTP/SQL/E 断言。
- main UI 已发布后不能继续称页面缺少该入口，也不能以静态样例代替实际后端返回。
- 验收：verified-validity、scope_changed、missing、unverified 四态样例来自实际流程，独立失效可归因且不外发模型请求。
- 交接物：更新的 UI 输入 contract、实际响应和准确覆盖范围，禁止 token/principal/raw path 进入不必要展示。

## C10 最终包与持续 goal

- 第三个可运行里程碑交精确 package driver、真实 A manifest 消费、同 Store 双 snapshot restore、独立负例和 UI 输入。
- 状态写 `packages/context/reports/wave24-status.json`，逐阶段列 source、command、exit、原 ID、actual entry/hash、instance/review identity、cleanup 与能力范围。
- 只针对新增风险运行 strict/exactOptional/build 和有限回归，旧已过 source 范围按准确来源保留，不把更多测试当发布许可。
- source/package/installed、normal/recovered/vendor、private/target/value 分层，不将 `verified-flow` 自身提升为 E 发布结论。
- 显式 stage 自有路径，push 原 `origin` 分支，禁止 upstream/reset/清历史；每个检查点后继续独立队列。
- goal 只有整个承诺结果实际完成才结束；不新增 Driver、CAC、桌面壳、自动接受、动态 DAG 或私有 LLM loop。

## 独立备选队列

- D 新包未到：完成命令描述/哈希、identity、cleanup、总限和 source 正负校准；精确 package 输入需求交 D，不回退 checkout。
- A manifest 未准入：交独立完整期望消费 contract 和真实旧 helper 正向范围，保留未达标签，先做 package 实例闭环与双格式入口。
- B/private/target 未到：只阻对应恢复执行结论，不阻普通包安装、只读双快照恢复、来源诊断与 UI 输入。
- 全程真实 vendor/model/native 调用 0；B 原 cap4 UNKNOWN 不可花，E 原 BLOCKED pilot 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807、全部 state/profile/tar/ledger、原 lock 差异和所有 runs；只处理独立证明本轮出生的精确资源。
- 不扫描全局 socket、不读无关 credential、不按共享路径/端口认领资源；main 拥有 HTTP/UI/授权，A 拥有 SQL/迁移，E 拥有独立断言。
