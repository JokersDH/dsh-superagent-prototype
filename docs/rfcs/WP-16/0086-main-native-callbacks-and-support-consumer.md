# 0086：原执行回调与真实诊断摘要消费者

日期：2026-11-16。主线在 `e05ee8d8` 后继续交付；完整方案B，CAC后置。本文描述已实现源码，不授予新模型、原生、安装或发行准入。

## 1. 原生执行共用原守卫

`apps/coordinator/product/native-attempt.ts` 把原 stdio 闭包提取为同一个 `NativeProductAttempt` 的方法：

- `readPayload` 保持原 immutable payload 与环境准备的 current/binding 检查。
- `recordFact` 保持原 attempt/source、载荷复制、原 registration、Store ACK 和 policy-prepared 行为。
- `beforeNativeWrite` 保持原 current、product-command 精确摘要和 live answerWrites 一次性准入；成功仍为 void。
- `nativeWriteDecision` 仅在上述守卫成功后返回 `{allowed:true}`，拒绝或异常返回 false。

原 RunnerLink stdio 和新增 Node 内部 `RunningAttempt.attachCallbacks` 使用以上同一实现。`attachPort` 仍来自原持久登记与 producer 的 clone；在准备完成/current 检查后随原 attempt 返回。没有自动 attach，没有公开 HTTP port，没有新 ledger、candidate 表或生命周期。

B/I 可直接消费真实 fact/payload/nativeWrite 回调，不再等待另一个虚构权限接口。通信层不能把成功 void 当 allowed，也不能把 sink 可写当 native permission。fresh guard 必须在每笔真实 effect 前调用；旧允许、旧 lease 和缓存不可迁移。

本次没有导入 B 新 raw feed/cancel 或 AttemptSlotScheduler。其外来 cancel 在身份检查前关闭原 service 的反例尚未闭合；独立内存槽队列不能替代原调度器。

## 2. 默认工作台诊断摘要

实际链路：原授权观察 reader → G metadata report/file → 严格公共 DTO → 认证只读 GET `/v1/insights/support` → ConsoleTransport → 当前范围下载 hook → 试用准备的支持详情内“导出诊断摘要”。

从 G 固定 `76467c33` 导入 `support.ts`、`support-port.ts` 和必要 index exports。没有挂载其通用上传 handler，也没有暴露 passthrough schemas。服务端每次重新读取已授权项目/7或30天/时区的观察，规范化自由文字；公开文件只有 metadata，无 metric value、formatted、label、detail、用户目标、原文件路径或原始证据。

`UsageSupportReportSchema`、`UsageSupportDownloadSchema` 均 strict，检查 scope/window/count/status 一致性、精确文件名、内外 report 和 UTF-8 bytes。服务端生成 SHA256，浏览器用 WebCrypto 再核验；错误只显示固定文案，旧404保持原工作台可用。

摘要声明 `authorization:none`、`numericValues:false`。目前没有受验证的安装身份输入，故 `origin:null`、`exportCapability:unverified`；不会由 Git HEAD 或文件名冒充当前安装身份。只读诊断不扩项目授权，也不证明收益。

同一个下载 hook 通过 format 区分 observation/support，identity/project/days/timezone/configurationRevision/format 构成 key。切范围或身份立即取消旧请求，迟到响应不生成下载；与原数值观察导出互不覆盖。

## 3. 验证与证据边界

已完成受控回归：

- 新11项 NativeProductAttempt + 原4项 attach，真实 ProductStore/原类方法，15 PASS。
- 新4项 support HTTP/生产文件与独立 G reader、1项 transport 正负/旧404，5 PASS。
- 原观察导出4项保持通过；契约241项、生成可重复性、协调器/Console strict 与 Console build 通过。
- 冻结 Runner v1 hash 仍为 `74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`。

真实 App 干净源码 browser 证据另见 `reports/releases/wave34-integration/`；必须记录实际 source，不以本文替代运行结果。

类级 callbacks 回归没有运行 Native.launch、原生子进程或完整原 Work/Broker 恢复。原 SIGKILL 恢复到 candidate/check/manualaccept、原2/4槽资源归还仍待 B/main/H/E 真实链验收。没有新依赖、迁移、tar、用户实例重启或模型/native任务；十二实例及全部状态/预算保留。

## 4. 后续 owner 消费

B 使用原 attachPort/attachCallbacks 连接唯一 I channel，先授权再 feed/cancel，终态不写；I 仅负责通信。H 独立消费真实原接口与对象。G 继续 metadata 支持能力和当前安装身份的有证据输入，不再把 main 默认 support 缺口当未实现。F 保持同范围/身份取消与原导航动作。D 后续因实际 runtime 源码变化才冻结 successor；E 先独立验固定 W33，再对必要 successor 独立记录，不追移动 main。
