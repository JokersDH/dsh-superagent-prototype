# Agent J：可复用项目任务与检查声明配方

日期：2026-11-14。新目录 `/Users/hh/Desktop/joker/superagent-agent-j`，分支 `codex/g5-project-recipes`，由 main 创建后使用，不另建无关 checkout。
仅拥有 `packages/project-recipes/`、`tools/project-recipes/`、`docs/project-recipes/`、`reports/project-recipes/`。
先读 START-HERE、product-spec、[本轮 README](README.zh-CN.md)、[0068](../../docs/rfcs/WP-16/0068-coordinator-channel-and-project-recipe-inputs.md)、[0069](../../docs/rfcs/WP-16/0069-wave-27-ten-agent-continuation.md)。
fetch 并合并最新 `origin/main`，实际类型/接口以 AGENTS 和 main 检查点为准；十位外部 Agent A–J 加 main 并行。
复用既有 ApplicationConfiguration、Scope、RequiredCriteria、CheckRegistry 公开 views、ProjectRegistration 及原 Proposal/WorkDraft 明确确认。
任务是交实际可复用配方库和只读 facts 工具，不是新 check runner、安装 recipe、ledger、验证 gate 或执行生命周期。

建立整个结果包 goal，不设 token 预算。20 阶段，J4/J8/J12/J16/J20 后发布五个完整可运行结果，交后继续。
核心为 deterministic match(project facts,current config,kind)，输出 goal/template/scope/criteria/profile 建议、needs_input/unsupported、provenance、authorization none。
不做 UI/API，main/F 接既有预览/草案与用户确认；用户取消当天完成目标，按正常节奏与正常门槛实施。

## J1 理解现有检查和草案边界

- 阅读当前公开配置、注册 checks、项目/profile scope、原 verifier policy 与 WorkDraft/Proposal 流程。
- 只使用明确已注册的 Node/pnpm/npm 支持范围，不扩大平台或语言执行兼容。
- 配方是数据建议，只有原 main 应用确认后才进入既有执行流程。
- 不注册 check、不安装依赖、不读取 home/env/credential，不调用模型或原生 agent。
- 验收：列出实际可复用类型/API 和所有权，不能把新模块变成另一执行 authority。
- 交接物：范围说明、源引用和最小消费者需求。

## J2 稳定 typed 配方输出

- 定义纯输入 project facts、当前 configuration、任务 kind 和明确选择偏好。
- 输出完整建议或 needs_input/unsupported，并包含输入/config revision、provenance 与 authorization none。
- scope/profile/check 引用来自当前配置和明确用户输入，不由仓库文本伪造准入。
- 不添加执行状态机、审批 token 或可直接运行 shell 的输出字段。
- 验收：类型严格可编译，未知/缺字段不补成可执行默认值，来源可追溯。
- 交接物：正式类型、示例和错误/未知语义。

## J3 实现 deterministic catalog

- 交至少三类实用任务配方，如回归修复、有限范围变更、已有检查的验证跟进。
- 复用现有项目 defaultCriteria 与已注册 checkDefinitionRef，不按脚本名字猜可执行命令。
- 相同版本输入得到稳定输出，用户偏好只在允许 scope/profile/criteria 内影响建议。
- 缺注册 check、无匹配 profile 或未知语言必须 needs_input/unsupported，不自动降到 fixture/另一 agent。
- 验收：三种真实输入有完整可审阅结果，缺能力的负例不会产生虚假 native 就绪。
- 交接物：可运行纯 match 函数和版本化配方库。

## J4 第一完整结果：typed pure catalog

- 发布纯库、完整三配方、输入/输出 schema、正常/缺能力/错误 scope 对照。
- 早交给 main/F 可编译 preview 输入，不等待 CLI 或全部文档完成。
- 主线 root deps/lock/公开 contract 由 main 集成，J 不为编译越权编辑根配置。
- 样例明确是数据，不发命令，不以 UI green/authorization none 推导授权。
- 验收：独立 caller 可纯函数调用并验证输出，发布 source 后继续 facts CLI。
- 交接物：第一 runnable checkpoint、API/测试与接入说明。

## J5 注入式公开 project facts

- 优先接受 main/已有 inspection 提供的明确公开 facts，避免重复环境扫描或读取私有配置。
- facts 包含来源、观察时间/范围、支持 manager/格式与缺失项，不包含原始 key、argv secret 或 home 内容。
- 配置、项目元数据与环境准入证据分层，配置存在不代表已安装/已测试/可执行。
- 读取缺口由 caller 明确提供，不通过猜测路径或执行版本命令自动补齐。
- 验收：注入合法/未知/过期 facts 均得到准确建议或 needs_input。
- 交接物：facts contract 与实际 main 数据映射。

## J6 显式授权元数据读取

- CLI 只读取用户/主线明确授权 root 和 allow-listed metadata path，不按 cwd 自动扫描全机。
- 使用 JSON parser、NOFOLLOW/fstat 和有界文件读取，拒绝 symlink/非普通文件、越根和文件替换。
- 不读取 home/env、.npmrc、credential、可执行配置或脚本正文来扩展授权。
- root 的元数据读取许可与执行 Scope 分开，由明确输入决定，不自行解读新安全权威。
- 验收：正确显式路径通过，缺授权/链接/越界/过大/坏 JSON 在读取边界有限拒绝。
- 交接物：只读 facts reader、参数与实际正负样例。

## J7 package 元数据与未知能力

- 仅提取必要结构化 name/packageManager/明确语言标记和脚本存在信息，不把 scripts 值作为可执行输入。
- 只识别已有支持 Node/pnpm/npm 范围；未知 manager/版本/多锁冲突准确 needs_input/unsupported。
- 项目文字、package metadata 和 readme 不能注册 trusted CheckDefinition 或选择任意 executable/argv。
- 使用现有公开 inspection 结果时保留其未知/阻断，不另造安装/检查政策。
- 验收：恶意 scripts/误导说明不会出现在可运行建议里，未知语言不被默认视作 Node。
- 交接物：有界 metadata schema 与分类结果。

## J8 第二完整结果：只读 facts CLI

- 提供 tools/project-recipes 的真实 CLI，显式输入 facts 或授权 root/path，输出结构化配方数据。
- --help/只读预览不创建用户项目、执行器或隐藏配置，不启动模型/agent/安装命令。
- 输出默认脱敏且包含 provenance/unknown/authorization none，不打印原始路径之外的私有材料。
- 支持 stdout/明确新 output 文件，防止无意覆盖已有用户文件和报告。
- 验收：真实 CLI 可在私有样例上运行，正常/拒绝/unknown 有准确 exit 与输出，发布后继续。
- 交接物：第二 runnable checkpoint、参数和可直接复跑命令。

## J9 当前 config 与 scope 匹配

- 以当前 ApplicationConfiguration/项目 Scope 匹配允许路径、排除、profile 引用和默认 criteria。
- 保留当前 config revision，输入变化后需要 main 重新准备预览，不能旧配方直接提交新作用域。
- readonly/discussion-only/unknown 或缺能力只能给解释/needs_input，不派工或暗中选择别的 profile。
- 模板建议不能扩大 external actions、允许路径或绕开既有验证政策。
- 验收：两项目相同名字/不同 ID、窄 Scope、排除路径和旧 revision 不会混用。
- 交接物：项目/config/scope 的准确 deterministic 匹配逻辑。

## J10 注册检查引用与政策复用

- 复用 CheckRegistry 公开视图、不可变 id/revision 和现有 RequiredCriteria/checkDefinitionRef。
- 注册信息不足时 needs_input，不从 package.json 自动构造 executable/argv 后标已注册。
- 新 check 声明若作为待审阅数据，必须明确 requires_registration，实际注册仍由原 trusted operator/main 流程。
- 不实现新 runner、CheckRegistry 写入口、安装逻辑或 completion gate。
- 验收：registered/unknown/revision 不匹配准确区分，输出不可直接变成绕过政策的命令。
- 交接物：既有 verifier policy 的消费映射和独立拒绝例。

## J11 main/F 可接的草案预览

- 输出 main 可接既有 template/draft/proposal preview 的稳定数据，包含目标、scope、criteria、profile 建议与需补输入。
- main 保留 UI/API/确认 authority，F 保留体验组件；J 不改 App/transport 或新建确认页面。
- 用户修改配方建议仍通过原应用验证和明确确认，J 不发命令、不生成 approval token。
- UI 接口未到先交真实 typed consumer 与样例，不以静态演示冒充产品集成。
- 验收：现有 WorkDraft 预览可消费候选数据，缺字段/过期配置按原 guard 拒绝。
- 交接物：最小接线需求、正式预览类型和实际 caller 示例。

## J12 第三完整结果：可用预览草案

- 交纯 catalog→只读 facts→当前 config/policy→可确认草案的一条完整数据链。
- 与 main/F 确认实际输入可编译/可呈现，最终动作仍在原用户确认流程。
- 外部 UI 未接只记该范围未达，其他 CLI/库/兼容工作继续，不自行造第二入口。
- 不以“建议已生成”声称任务已执行、质量已验证或节省了多少时间。
- 验收：第三 runnable 结果可给真实现有草案系统使用，发布后继续多项目和故障。
- 交接物：完整预览数据、准确 source/consumer 与未知项。

## J13 真实多项目与任务类型

- 在至少两个明确授权 Node 项目/配置上复用三种配方，覆盖不同 profile/check/Scope/manager facts。
- 相同模板不共享批准、对话、原任务或 check registry 写入，所有关联按真实 ID。
- 已注册 npm/pnpm 差异按既有支持，不扩展 Python/其他平台执行能力。
- fixture 与 native 配置事实明确，fixture 不能展示为厂商执行准入。
- 验收：各项目结果隔离、可编辑可审阅，不漏掉缺注册 check/环境的阻断。
- 交接物：真实多项目例、配置来源与预览结果。

## J14 失败与异常输入

- 有限覆盖坏 JSON、过大 metadata、缺字段、重复/foreign ID、链接、越根、不可读或过期配置。
- 每项合法正对照后只改变一个原因，错误消息有用但不打印 secret、原始栈或无关文件内容。
- unknown 不变零/通过，读取错误不转换成“项目没有依赖/没有检查”。
- 不用执行 project hooks/脚本来判断信息，所有操作只读、有限。
- 验收：错误在接受/读取边界拒绝，正常项目不被误伤，无隐式写入或网络。
- 交接物：故障矩阵、真实 exit 和脱敏输出。

## J15 兼容、版本与范围

- 对公开 config/schema/check 视图的支持版本明确，未知版本准确 unsupported。
- 配方 catalog 版本、输入摘要和实际选择 provenance 可追溯，不依赖任意脚本命名约定。
- 旧后端缺可选 facts 时 needs_input，不降级另一个执行器或覆盖用户选择。
- 配方建议与真正环境准备/机器检查/人工接受分层，不误认已执行。
- 验收：支持/未知版本和多项目范围有实际测试，主线 consumer 严格编译。
- 交接物：兼容矩阵、版本输入与迁移说明。

## J16 第四完整结果：多项目可复用工具

- 交真实多项目、失败、兼容、Scope/政策边界组成的完整配方工具，不只几个数据 fixture。
- 证明相同输入稳定、不同配置不会复用旧建议，所有新副作用仍需原主线确认。
- 库和 CLI 不写 SQL/注册表/环境，不创建新执行状态或费用账本。
- 发布第四 checkpoint 后继续成本、文档和独立交接，不等待下一轮小修。
- 验收：独立使用者可按实际公开参数得到可审阅且边界准确的数据。
- 交接物：完整工具、样例和实际范围报告。

## J17 成本与隐私边界

- 给 metadata 文件/解析深度/集合条数/输出 bytes 和总流程时长设置明确上限。
- 只读取必要已授权字段，优先注入公开 facts，不遍历 home/env 或递归扫描整个仓库。
- 报告只含任务建议所需 provenance，路径/脚本存在信息不升级成可执行许可。
- 不做模型/native/价格配方研究，不用未观测数据估算效率收益。
- 验收：临近上限和越界输入有限处理，输出脱敏且原项目/配置没有变更。
- 交接物：成本预算、实际计数和隐私说明。

## J18 完整使用与开发文档

- 在 docs/project-recipes 写实际支持范围、facts 来源、CLI、草案、needs_input 和原确认接线说明。
- 给 main/F 可直接使用的具体数据与代码片段，不要求其猜字段或复制算法。
- 所有命令只读/声明式，不能把安装/执行 README 文本当自动步骤。
- 未支持语言、未注册 check 和实际执行准入准确说明，不把架构愿景当当前能力。
- 验收：独立开发者按文档可复跑三配方与失败处理，没有隐藏本机依赖。
- 交接物：完整用户/开发指南和维护说明。

## J19 真实 consumer 与独立验收输入

- 与 main/F 对齐原 WorkDraft/Proposal 确认接口，早交稳定 source，不阻塞到全包文档结束。
- 给 E 或明确 consumer 原配置、facts、配方版本、预览结果和负例，不修改其断言。
- 新 root deps/lock/public contract 由 main 集成；J 不抢 A/B/C/I 所有权。
- GUI/执行未接范围准确记未达，不能把 CLI 数据 PASS 当全产品或 native 完成。
- 验收：独立 consumer 能严格编译并复现已交范围，原权限/检查 gate 保持。
- 交接物：接入说明、实际 source/调用结果和完整证据索引。

## J20 第五完整结果与最终交接

- 写 `reports/project-recipes/wave27-status.json`，20 阶段列 source、命令/exit、provenance 与真实能力。
- 五结果覆盖 typed catalog、只读 facts CLI、main/F 草案预览、多项目失败兼容、工具文档与交接。
- 承诺结果实际齐备才结束 whole goal，外部未到不计完成，也不停止可独立阶段。
- 显式 stage 自有四类路径，推 origin 的 `codex/g5-project-recipes`，不 upstream/reset/清历史。
- 验收：每项完成声明可复跑，没有隐藏 register/install/run、模型/native 或新 authority。
- checkpoint 后继续独立备选队列，正常节奏不要求当天降范围完成。

## 独立备选队列

- 新目录未注册时由 main 创建/附加；不另建无关 repo，准备类型/公开接口调研后沿指定目录继续。
- main/F 预览未接：先完成纯库、facts reader/CLI、多项目/错误/文档，交最小 typed 接线，不造 UI/API。
- 缺注册检查或 profile：给 needs_input/unsupported，不执行脚本、注册 check 或选择别的 agent 补齐。
- vendor/model/native 自动调用 0；B cap4 UNKNOWN 不可花，E BLOCKED pilot 不重置、不退款、不补样。
- 保留十二服务 5180–5191 / 8796–8807 与全部 state/profile/tar/ledger/dirty；无用户资源/全局发现/无关 credential 动作。
- 不新 Driver/CAC/桌面壳/autoaccept/动态 DAG/ledger；main 保留 UI/API/授权，A 保留 SQL，B 保留 runtime，E 保留独立断言。
