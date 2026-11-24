# 0096：里程碑04的兼容准入与新根授权

日期：2026-11-24。状态：实施约束已提出，公共schema尚未修改；具体加法字段由B的实际零模型探测与main消费者共同验证后落码。范围仅为[里程碑04](../../product/MILESTONE-04.zh-CN.md)的两个出口，不改冻结Runner wire，不引入新核心生命周期。

## 为什么不能只加一个ACP包

当前`NativeProductConfiguration.profile`、runtime默认展示、execution的Codex策略解析、native-attempt的scenario和Runner工厂构成了单协议假设。未知Codex版本又分别被launcher/preview/coordinator按历史版本拦截。修改一个版本比较或新增一个Driver目录不能使默认工作台真正支持多协议。

`configuration.ts`要求native_test_passed才允许dispatch，Catalog的部分内部判定却接受inspection_passed。需要表达新的“协议兼容但产品未实测”事实，不能通过伪造历史PASS来解决。恢复目标仍明确not_granted；打开另一份数据库也不等于获得当前机器执行权。

## 决定一：探测、准入、实测分开

复用原Profile、CompatibilityIdentity、CapabilityObservation、ProbeReport与Catalog。B拥有具体CLI/schema解释和兼容判定，main拥有公共展示/命令契约及准入消费，D的launcher和wrapper消费同一事实。

| 事实 | 来源 | 不授予什么 |
| --- | --- | --- |
| 可执行身份与版本 | 当前目标文件与零模型version/schema检查 | 不自动代表原native证据仍有效 |
| 协议兼容 | 实际方法、字段、枚举、通知、ID及握手的逐能力检查 | 不代表真实工具/审批/交付已通过 |
| 当前可用操作 | 兼容检查、受控原消费者、当前权限策略和物理资源门槛的交集 | UI按钮或CLI自称支持不能扩大权限 |
| 产品真实验证 | 准确版本/协议/策略/安装的真实任务观察 | 不自动推广到所有版本、机器或模式 |

公共配置须增加或复用能明确表达“未验证兼容版本”的状态和逐能力可用性，保留历史native_test_passed的原意。若开放显式试用开发，必须由公共契约单列试用准入及提示，重新验证create/begin/answer/stop的原guard；禁止让inspection_passed在其他路径暗中成为全权限。

不能仅依赖schema证明实际进程隔离；原ProcessHost/策略/资源门槛仍须满足。任何缺失、方法不明、超时或无法解析均保持unknown/disabled。兼容模块不得维护第二张独立授权表。

## 决定二：每个profile注册一个Driver实现

保持`AgentDriverV1.inspect/serve/reconcile`和原`AttemptIO`为Driver接口，第二个Adapter用实际协议验证这一接口。B实现ACP内部请求/通知/权限映射和Runner工厂；main将原单profile组合接为受控的注册集合，不进行运行时任意插件加载。

| 消费位置 | 责任与不变量 |
| --- | --- |
| 原native-startup/configuration | 逐profile准入；ACP未装不阻断Codex；只展示安全DTO |
| 原NewWork表单及创建命令 | 用户选已准入profile，project授权允许，合同保存不可变id/revision，不自动选择路由 |
| 原execution准备/恢复 | 根据合同中原profile解析对应策略；不能用CodexSettings解析ACP，也不能将缺策略默认为宽权限 |
| 原NativeProductAttempt/Runner工厂 | 精确已注册driver/scenario，无HTTP/env任意工厂替换，无fixture回退 |
| Driver serve | 原合法begin后才prompt；并发响应answer/cancel，不能被长prompt Promise堵塞控制 |
| Driver reconcile | 原journal/资源/运行状态只读核对，不重新prompt；无恢复能力时明确降级，不假称已恢复 |
| 问题与答案 | 原target/session/question/command保真；协议只证明response_written时不得报native_applied |
| 停止 | 原完整资源静止/屏障才归还；cancel应答或session终态不代替物理证据 |

工厂注册只是选择已有实现，不创建第二个调度器或持久生命周期。公共语义缺口经main RFC评估，ACP私有线协议留Driver内部。两协议的ExecutionOutcome沿原profileRef和记录来源，usage未知如实记录。

## 决定三：恢复来源只读，新根显式授权后只接新Work

原restore/source-confirmation作为历史来源，原target材料/库存作为准备证据。main补授权命令与默认消费者；D补物理准备和正常启动，A在原Store/UoW内填真正缺失的持久事实。不能由launcher写一份私有permissions.json代替Application授权。

授权至少绑定当前principal、恢复来源确认、generation、目标真实根、配置摘要、项目映射、已准入profile/revision及当前操作幂等身份；使用前重验私有根/单writer/资源/当前配置。相同请求重放只返回原回执，结果未知先查询；身份/代次/配置变化必须拒绝并要求明确重新确认，不能挪用旧权限。

历史业务和原运行资源不迁移为活动授权，原held/UNKNOWN材料不丢弃；新执行根只能创建用户明确授权的新Work。旧问题答案、begin、native session和cached permission不得自动投递。恢复marker不是需要删掉的障碍，source根不能被改成normal来绕过。

目标已有未知writer、非空冲突、库存不全或源确认过期时拒绝，不清库/覆盖/重试同业务。授权状态和运行状态分开，不能因为写了authorization回执就认定服务已经启动。D正常启动消费准确授权后，仍沿原实例身份与物理资源流程。

## 实施与验收顺序

B先交共享版本probe/分类小闭包，main/D消费；B同时持续ACP。main并行新授权接线。E从公共接口对已验证/兼容未验证/不兼容/unknown做独立正反例，覆盖当前绑定改变和未知回执，不能由producer简化断言。

以上消费在受控路径成立后，才用同一个M04 ACP上限做真实任务。D冻结必须包含兼容及新授权的运行代码，E验准确包。同事完成另一台Mac首次任务和新根第二次任务，才有跨机/恢复真实交付结论。此RFC本身、纯函数或schema通过均不代表出口完成。
