// Source for generated task packets. Implementation paths are relative to the user's fork root.
export const sharedReadOnly = ['product-spec/', 'packages/contracts/', 'docs/adr/'];
export const sharedForbidden = ['user credentials/private native homes', 'unrelated user worktrees', 'production accounts/data'];
export const tasks = [
  {
    id: 'WP-00', title: '复用提取、契约冻结与 Bootstrap 试验', gate: 'G0', startAfter: [], acceptAfter: [],
    ownedPaths: ['packages/contracts/', 'tools/reuse-spike/', 'tools/bootstrap/', 'docs/adr/bootstrap/'],
    readOnlyPaths: ['src/core/', 'tests/core-engine.spec.ts', 'tests/stage.spec.ts', 'product-spec/'],
    forbiddenPaths: ['src/', 'apps/', 'packages/orchestrator-core/', 'packages/storage/', 'pnpm-lock.yaml'],
    interface: 'contracts v1 + schema hash + generated TS/JSON fixtures；独立 core extraction report；供集成者应用的 bootstrap 模板。',
    steps: ['从固定上游 commit 提取 core 与原测试到隔离试验，保留 MIT、版权和 provenance；验证 runtime/type graph 均不含 DSH 宿主。', '运行独立 144-test baseline，锁最小测试依赖并保存命令、import graph、版本与结果；失败时记录具体依赖阻塞，先裁剪。', '把公共类型草案转成单一运行时 schema 来源和生成流程，补非法/旧版本消费者 fixture；冻结接口、身份、错误和版本规则。', '验证拟议 Node/pnpm/better-sqlite3 发行组合，输出 native-load、SQLite engine 检查和 root bootstrap 模板；由 WP-16 合入根配置。'],
    mocks: ['纯 core MemoryRepositories 与 fake ports', '合法/非法 UserCommand、Attempt、Question、Completion fixtures'],
    deliverables: ['独立提取报告和可重跑脚本', '公共 schema/生成类型/测试 fixtures', 'bootstrap ADR、依赖锁模板和 ownership 表'],
    acceptanceIds: ['CORE-01', 'DATA-01', 'OPS-01'], effort: '2–4 个工程日；原生依赖受阻则重新评估',
    notes: '只拥有复用试验，不将试验里的 core 变成长期第二副本；G0 通过后由 WP-01 接手正式核心。'
  },
  {
    id: 'WP-01', title: '正式 Core 提取与可信完成/Fence 扩展', gate: 'G1', startAfter: ['WP-00'], acceptAfter: ['WP-00'],
    ownedPaths: ['packages/orchestrator-core/', 'docs/adr/core/'], readOnlyPaths: ['src/core/', 'tests/', 'packages/storage/', 'packages/contracts/'],
    forbiddenPaths: ['packages/storage/migrations/', 'apps/console/', 'packages/drivers/', 'pnpm-lock.yaml'],
    interface: '原 Engine/Repositories/Executor ports；additive reportAssignment、completionMode、confirmCompletion 与 candidate generation。',
    steps: ['接管 G0 已验证 core slice，保留原结构、测试和 MIT；所有 Ticket/Assignment 转换仍集中于核心。', '以失败用例驱动 external completion mode，legacy 语义保持；产品 ready/candidate 不先 completed，可信 gate 再结束。', '增加当前 Assignment 的报告检查与候选失效，限定可信完成调用方；bridge 继续校验完整 attempt/epoch/合同。', '验证旧 revision attach/resume、ended Ticket stop no-op、retry 与 completion notification 的边界，给应用/执行层接线说明。'],
    mocks: ['MemoryRepositories + transactional port fakes', '新旧 candidate、迟到 report 和修订授权 fixtures'],
    deliverables: ['正式 core package + upstream diff manifest', 'legacy + 新 guard 测试', 'Executor/完成接口说明和 ADR'],
    acceptanceIds: ['CORE-01', 'CORE-02', 'CORE-03', 'CORE-04', 'CORE-05', 'CORE-06', 'CORE-07', 'CORE-08', 'CORE-09', 'CORE-10'], effort: '3–5 个工程日',
    notes: '不写 Work 执行状态，不把原生问题伪装成 GitHub merged Thread；不能让 worker 调用可信完成。'
  },
  {
    id: 'WP-02', title: '事务存储、Effects、Outbox 与数据迁移', gate: 'G1', startAfter: ['WP-00'], acceptAfter: ['WP-01'],
    ownedPaths: ['packages/storage/', 'packages/effects/', 'docs/adr/storage/'], readOnlyPaths: ['src/app/store.ts', 'src/app/effects.ts', 'src/app/outbox.ts', 'packages/contracts/', 'packages/orchestrator-core/'],
    forbiddenPaths: ['packages/orchestrator-core/', 'packages/drivers/', 'apps/console/', 'pnpm-lock.yaml'],
    interface: '同连接 UnitOfWork/Repositories/QueueStore、命令/fact receipt、event cursor、产品 repository ports、backup/restore 和 migration。',
    steps: ['选择性提取领域 SQL/索引/事务行为，去除旧 Store 应用迁移与 DSH imports；新产品独立 state/schema。', '实现嵌套 savepoint、rollback、afterCommit；核心变更、产品索引、effect、receipt、event 在同事务。', '保留 Effects 算法并加入未知原生发送的分类接线；文本 Outbox 与 AnswerDelivery 分离。', '独占管理迁移号与所有产品表；提供 real-binding crash harness、完整性检查、backup/restore 和 orphan/retention ports。'],
    mocks: ['以真实 SQLite binding 测试，不只用内存 map', '由其他包提交 repository schema/fixture 请求，owner 统一迁移'],
    deliverables: ['storage/effects 包与单一迁移入口', '真实故障窗口测试及恢复报告', '数据库/备份格式与 repository 文档'],
    acceptanceIds: ['DATA-01', 'DATA-02', 'DATA-03', 'DATA-04', 'DATA-05', 'DATA-06', 'DATA-07', 'DATA-08', 'REL-01', 'REL-02', 'REL-03', 'OPS-03'], effort: '4–7 个工程日',
    notes: '其他模块不允许自开 DB writer。原 Effects 通用重试不能覆盖 indeterminate native send。'
  },
  {
    id: 'WP-03', title: 'Supervisor、Runner、DriverKit 与故障子进程', gate: 'G1', startAfter: ['WP-00'], acceptAfter: ['WP-01', 'WP-02'],
    ownedPaths: ['packages/execution/', 'packages/driver-kit/', 'packages/testing/', 'apps/runner/', 'docs/adr/runtime/'], readOnlyPaths: ['packages/contracts/', 'packages/orchestrator-core/', 'packages/storage/'],
    forbiddenPaths: ['packages/contracts/', 'packages/orchestrator-core/', 'packages/storage/migrations/', 'packages/drivers/', 'apps/console/'],
    interface: 'core Executor bridge；AttemptSupervisor；OwnedProcessHost/AttemptIO；critical-fact ingress；Driver host 和 conformance runner。',
    steps: ['以冻结契约实现 Runner 的进程身份、argv 启动、分帧/UTF-8、EOF/超时、控制优先 pump 与有界日志/journal。', '实现 Supervisor、资源 lease 和 epoch；同事务 fence 再调用 core，事实重复/迟到不改变当前派工。', '实现 prepare-before-begin、cancel/reconcile/物理停止屏障和未知发送分类；共享服务只能控制本 session。', '用 fake subprocess 构造等待用户、输出洪峰、受理后掉线、迟到事件、进程复用等故障，提供各 Driver 可运行的 fixture harness。'],
    mocks: ['可编程 fake native 子进程，不依赖模型账号', 'fake clock、受限 payload store、process registry 和 profile preparation facts'],
    deliverables: ['Runner/driver-kit/testing/execution packages', 'fenced ingress 与恢复时序说明', 'RT 故障用例和可复用 conformance CLI'],
    acceptanceIds: ['RT-01', 'RT-02', 'RT-03', 'RT-04', 'RT-05', 'RT-06', 'RT-07', 'RT-08', 'RT-09', 'RT-10', 'REL-04', 'REL-05', 'REL-06', 'REL-07', 'REL-08'], effort: '6–10 个工程日；本包内部可由 owner 再划不重叠子模块',
    notes: '没有厂商分支和第二调度内核；关键事实 ACK 只有真正持久化后返回。'
  },
  {
    id: 'WP-04', title: '工作区、候选冻结与可信验证', gate: 'G2', startAfter: ['WP-00'], acceptAfter: ['WP-01', 'WP-02', 'WP-03'],
    ownedPaths: ['packages/workspaces/', 'packages/verification/'], readOnlyPaths: ['packages/contracts/', 'packages/orchestrator-core/', 'packages/execution/', 'packages/storage/'],
    forbiddenPaths: ['user original worktree reset', 'packages/storage/migrations/', 'packages/orchestrator-core/', 'apps/console/'],
    interface: 'WorkspaceManager reserve/freeze/release；Verification runner；CompletionProposal；artifact refs/digests。',
    steps: ['保留用户原工作区/dirty diff，以受控 worktree 和资源归属建立 attempt 目录；记录共享 git 元数据限制。', '绑定当前 candidateGeneration，确认 writer 静止后冻结 artifact 和环境；验证期间输入变化令候选失效。', '执行经批准的项目检查，记录真实 exit/outcome、criteria/environment/artifact digest；不信任 worker 自述。', '只输出可信 CompletionProposal，由应用/core gate 核对；测试 SKIPPED、人工条件、过期接受、集成失败和 GC 引用。'],
    mocks: ['临时 git repo + dirty 文件 + 故意失败的测试', 'fake completion port 和 writer evidence'],
    deliverables: ['workspaces/verification 包', 'artifact manifest 和验证报告示例', '候选失效/人工接受集成 tests'],
    acceptanceIds: ['CORE-02', 'CORE-03', 'CORE-04', 'REL-09', 'REL-10', 'AC-UX-07'], effort: '3–5 个工程日',
    notes: 'git worktree 不当作沙箱；默认交 patch/branch，不自动 merge/deploy。'
  },
  {
    id: 'WP-05', title: 'QuestionBroker 与逐 Target 答案投递', gate: 'G2', startAfter: ['WP-00'], acceptAfter: ['WP-02', 'WP-03'],
    ownedPaths: ['packages/questions/'], readOnlyPaths: ['packages/contracts/', 'packages/storage/', 'packages/execution/', 'product-spec/03-contracts-and-data.zh-CN.md'],
    forbiddenPaths: ['packages/storage/migrations/', 'packages/orchestrator-core/', 'packages/drivers/', 'apps/console/'],
    interface: '持久 UserQuestion、可信答案、作用域去重、原生 binding 验证和逐 target AnswerDelivery。',
    steps: ['按原生工具/动作 provenance 分类澄清、权限、认证和未知 review，不按 RPC 方法名独断；输出统一 QuestionPresentation，UI 不解析品牌 payload。', '先持久问题再通知，先存答案再排 answer effect；恢复业务的答案同事务失效旧 candidate，不重复 generic deliver/Core Input。', '实现语义/范围/版本/有效期共同成立的业务答案复用；权限/认证逐请求。', '测试连接 epoch 变化、旧 requestId 的原始 wire 类型/精度、部分成功、写出但未应用、取消后迟到和主入口离线重开。'],
    mocks: ['多 target、同文异 scope、connector 批准和 form/url fixtures', 'fake Driver answer receipts'],
    deliverables: ['QuestionBroker 包与 repository 需求', 'question fixtures 和 delivery tests', 'UI/Driver 接线示例'],
    acceptanceIds: ['CORE-03', 'DATA-07', 'RT-05', 'AC-UX-05', 'AC-UX-10', 'AC-LRN-08', 'API-04'], effort: '3–5 个工程日',
    notes: '不自建权限代理；没有原生消费证据不能标 applied。'
  },
  {
    id: 'WP-06', title: 'Agent Catalog、Profile 与原生策略准备', gate: 'G2', startAfter: ['WP-00'], acceptAfter: ['WP-02', 'WP-03'],
    ownedPaths: ['packages/catalog/', 'packages/policy-preparation/'], readOnlyPaths: ['packages/contracts/', 'packages/drivers/', 'packages/storage/', 'packages/execution/'],
    forbiddenPaths: ['native credential files', 'native user profile reset', 'packages/storage/migrations/', 'packages/contracts/'],
    interface: 'Catalog probe/compatibility records、版本化 Profile、PreparedExecutionPolicy gate、config drift invalidation。',
    steps: ['实现可信 executable/argv 身份、版本和配置引用检查；发现检查不运行模型任务、不读取私有 token。', '能力分 advertised/observed/test/policy，分别呈现安装/认证/兼容/任务可用，required features 不静默豁免。', '经 Driver 事实映射原生权限，准备记录绑定 attempt/epoch/fingerprint，验证通过后才允许 begin。', '配置/HMR/二进制替换使旧记录失效；给出原生登录与专用 home bootstrap 步骤，不覆盖用户设置。'],
    mocks: ['missing/auth_required/version mismatch/HMR profiles', 'advertised true 但实际 test FAIL 的 fixtures'],
    deliverables: ['Catalog/policy preparation 包', '三个目标的 draft Profile（默认未获调度资格）', '兼容身份/漂移测试与接入步骤'],
    acceptanceIds: ['RT-02', 'RT-08', 'AC-UX-09', 'EXT-01'], effort: '3–4 个工程日',
    notes: '本包以公共 gate/契约/fixture 独立模块验收，不依赖三个 Driver 的 NATIVE 报告；真实 mapping/能力证据由对应 Driver 与 WP-16 在 G2/G4 验收，避免证据依赖闭环。'
  },
  {
    id: 'WP-07', title: 'Codex Native Driver', gate: 'G2/G4', startAfter: ['WP-00'], acceptAfter: ['WP-03', 'WP-05', 'WP-06'],
    ownedPaths: ['packages/drivers/codex-native/'], readOnlyPaths: ['packages/contracts/', 'packages/driver-kit/', 'packages/testing/', 'product-spec/research/'],
    forbiddenPaths: ['packages/contracts/', 'packages/execution/', 'packages/storage/', 'apps/console/'],
    interface: 'AgentDriverV1；Codex app-server stdio 的规范化命令、事实、权限、问题、取消与 reconcile。',
    steps: ['以安装版导出 schema 固定白名单/hash，验证 initialize/initialized、thread/turn/item/request 的身份链。', '实现 begin/deliver/answer/cancel 与受理/结束/usage 事实；方法存在不代替原生行为验证。', '按工具 provenance 分类 requestUserInput、command/file/permissions/MCP 批准，保留原生选项和逐请求 scope。', '先 parser/goldens/子进程 fixture，再 scratch native smoke；验证实际权限拒绝、提问、取消、丢回执与恢复，提交按版本报告。'],
    mocks: ['安装版 JSON schema + 脱敏 goldens', 'DriverKit fake native transport'],
    deliverables: ['Driver 源码/semantic-map/source-lock', 'parser/mapping/contract tests', 'native/recovery/capability reports'],
    acceptanceIds: ['NATIVE-01', 'RT-02', 'RT-03', 'RT-04', 'RT-05', 'RT-06', 'RT-10', 'EXT-02'], effort: '4–7 个工程日；受原生行为影响',
    notes: '不得启动无预算真实任务、改账号或把旧 RPC ID 跨连接复用；工作区使用专门 scratch。'
  },
  {
    id: 'WP-08', title: 'ACP v1 Driver 与 DeepSeek Harness Profile', gate: 'G2/G4', startAfter: ['WP-00'], acceptAfter: ['WP-03', 'WP-05', 'WP-06'],
    ownedPaths: ['packages/drivers/acp-v1/'], readOnlyPaths: ['packages/contracts/', 'packages/driver-kit/', 'packages/testing/', 'product-spec/research/'],
    forbiddenPaths: ['packages/contracts/', 'packages/execution/', 'packages/storage/', 'native user profile reset'],
    interface: 'AgentDriverV1 + 官方 ACP SDK stable v1；DSH 专用 Profile 与有效配置身份。',
    steps: ['锁官方 SDK stable v1 入口；核对 installed DSH acp profile，明确 SDK JSON-RPC 是另一协议。', '实现 session/prompt/update/permission/elicitation/cancel 的真实协商与 mapping，缺能力准确降级。', '专用 home/bootstrap 不 reset 用户 profile；profile/bundle/patch/HMR 均纳入 fingerprint，prepared policy 经过验证。', '跑协议 fixtures/TCK 补充和 DSH scratch native tests；验证响应写出不冒充持久消费、取消不冒充所有子工具停止。'],
    mocks: ['ACP SDK 稳定版 fixtures + forms/url/无业务问题能力', 'fake DSH launcher/config drift'],
    deliverables: ['通用 ACP Driver 和 DSH 版本化 Profile', '协商/取消/恢复 goldens', 'DSH native 报告和 TCK 限制说明'],
    acceptanceIds: ['NATIVE-02', 'RT-02', 'RT-03', 'RT-04', 'RT-05', 'RT-06', 'RT-08', 'RT-09', 'EXT-02', 'EXT-03'], effort: '4–7 个工程日',
    notes: '缺核心能力时先提交缺口证据/RFC，再评估 DSH native adapter；不默认 sdk-minimal。'
  },
  {
    id: 'WP-09', title: 'ZCode 安装版协议 Spike 与 Native Driver', gate: 'G2/G4', startAfter: ['WP-00'], acceptAfter: ['WP-03', 'WP-05', 'WP-06'],
    ownedPaths: ['packages/drivers/zcode-native/'], readOnlyPaths: ['packages/contracts/', 'packages/driver-kit/', 'packages/testing/', 'product-spec/research/'],
    forbiddenPaths: ['packages/contracts/', 'packages/execution/', 'packages/storage/', 'ZCode private credentials'],
    interface: 'AgentDriverV1；经过安装版 identity/schema 对齐的 ZCode native protocol。',
    steps: ['先对齐 launcher/engine/wire/schema 与安装版 0.16.5；公开 source CLI 0.1.0 仅线索，记录无法对齐的证据。', '区分 module v4、wire 3、projection 1；实现解析、replay/projection、interaction binding 与原生事件 mapping。', '显式映射和验证权限，不能沿用 headless 默认 yolo；准备失败不得 begin。', '完成 scratch 提问/权限/取消/background/recovery 测试；未对齐时交付实验 driver 与 NOT_TESTED，不进入稳定调度。'],
    mocks: ['固定 commit 源码 goldens 与版本不匹配 fixtures', 'projection gap、迟到 interaction、后台取消 fixtures'],
    deliverables: ['安装版对齐 spike report', 'Driver/semantic-map/source-lock/goldens', '原生兼容矩阵与可用/实验边界'],
    acceptanceIds: ['NATIVE-03', 'RT-02', 'RT-03', 'RT-04', 'RT-05', 'RT-06', 'RT-10', 'EXT-02'], effort: '先 2–3 日 spike，再按稳定 interface 评估 4–7 日实现',
    notes: '不复用 Codex Driver 冒充兼容；公开源可见不代表稳定外部 API 承诺。'
  },
  {
    id: 'WP-10', title: 'ApplicationService、主对话 Reasoner 与 HTTP/SSE', gate: 'G2/G3', startAfter: ['WP-00'], acceptAfter: ['WP-01', 'WP-02', 'WP-03', 'WP-04', 'WP-05', 'WP-06'],
    ownedPaths: ['packages/application/', 'packages/reasoner/', 'apps/coordinator/http/'], readOnlyPaths: ['packages/contracts/', 'packages/orchestrator-core/', 'packages/questions/', 'packages/verification/', 'packages/catalog/'],
    forbiddenPaths: ['packages/contracts/', 'packages/storage/migrations/', 'packages/drivers/', 'apps/coordinator/main.ts', 'apps/console/'],
    interface: 'ApplicationService dispatch/inspect/changes；可信 LocalSource/PersonalPolicy；受限 Reasoner tools；HTTP 命令/SSE。',
    steps: ['实现 commandId receipt、可信 actor、Work/合同/Thread 归属、按发送时项目和锚点路由；分页持久主对话，禁止广播所有 Ticket。', '实现修订/停止后继续/暂停后续派工/核心重试：新授权/合同、撤旧授权、物理屏障、延后 intake，旧 revision 恢复 guard。', 'Reasoner 复用 existing runtime，限读/提案；查询、回答、停止、接受和学习控制确定性处理且模型故障可用。', '以 Hono 暴露命令/snapshot/messages/cursor SSE，认证/Origin/CSRF/路径错误有稳定 code；Question answer 不重复 generic deliver。'],
    mocks: ['两项目同名 Work、讨论vs委托、多 anchor、模型离线', 'fake runtime Reasoner + frozen application fixture'],
    deliverables: ['Application/Reasoner/HTTP modules', 'snapshot/event/error schema fixtures', '主对话/修订/权限 provenance 接线和 tests'],
    acceptanceIds: ['API-01', 'API-02', 'API-03', 'API-04', 'API-05', 'API-06', 'AC-UX-01', 'AC-UX-02', 'AC-UX-03', 'AC-UX-04', 'AC-UX-06', 'AC-UX-10'], effort: '5–8 个工程日',
    notes: '不得自己手写通用 LLM/tool loop；执行权仍在 core，Reasoner 不是新的授权来源。'
  },
  {
    id: 'WP-11', title: '主对话工作台与产品交互', gate: 'G2/G3', startAfter: ['WP-00'], acceptAfter: ['WP-04', 'WP-05', 'WP-06', 'WP-10'],
    ownedPaths: ['apps/console/'], readOnlyPaths: ['packages/contracts/', 'product-spec/01-product-and-experience.zh-CN.md', 'packages/application/'],
    forbiddenPaths: ['packages/storage/', 'packages/drivers/', 'packages/orchestrator-core/', 'apps/coordinator/', 'pnpm-lock.yaml'],
    interface: '只消费 ApplicationService HTTP/SSE；主对话、工作、待决定、执行器、交付、决定/学习控制视图。',
    steps: ['先以固定 scenarios 做真实可操作 app shell：主对话为首页，紧凑列表、项目/回复锚点和空状态。', '实现澄清/权限/认证/主观验收不同表单；答案已记录/写出/未知按 target 呈现，不自行改变 phase。', '实现候选/验证/交付、修订/停止中、过期按钮、登录/能力/漂移状态；关闭重开和 SSE gap 恢复。', 'Playwright 覆盖桌面/窄屏、键盘/焦点、长文本/错误，验证模型离线仍能查询回答停止；不在 UI 写厂商分支。'],
    mocks: ['01 的完整场景数据 + 长标题/多问题/失败状态', '可恢复 SSE、过期 cursor 和部分投递 fixture server'],
    deliverables: ['console 源码与场景 fixtures', 'E2E 测试/截图/可访问性记录', '交互状态与错误接线说明'],
    acceptanceIds: ['AC-UX-01', 'AC-UX-02', 'AC-UX-03', 'AC-UX-04', 'AC-UX-05', 'AC-UX-06', 'AC-UX-07', 'AC-UX-08', 'AC-UX-09', 'AC-UX-10', 'AC-UX-11', 'AC-UX-12'], effort: '5–8 个工程日；fixture 可与后端并行',
    notes: '不做营销首页或只读 dashboard；UI 关闭不退出 daemon。'
  },
  {
    id: 'WP-12', title: 'CLI、诊断、打包、备份与运行维护', gate: 'G3', startAfter: ['WP-00'], acceptAfter: ['WP-02', 'WP-03', 'WP-06', 'WP-10'],
    ownedPaths: ['packages/operations/', 'apps/cli/', 'release/'], readOnlyPaths: ['packages/contracts/', 'packages/storage/', 'packages/application/', 'packages/execution/'],
    forbiddenPaths: ['packages/storage/migrations/', 'packages/contracts/', 'apps/coordinator/main.ts', 'native credentials', 'pnpm-lock.yaml'],
    interface: '同 ApplicationService 的 CLI；doctor/health/diagnostics；release manifest；backup/restore/drain hooks。',
    steps: ['实现 start/status/answer/stop/doctor，CLI 不直接写 DB；退出网页与退出 daemon 分开，未知资源不报假 success。', '实现有界脱敏日志/导出、磁盘/队列/unknown writer 指标，默认只本地且不上传。', '调用 storage backup/restore ports，形成停新受理/备份/迁移/核对手册；验证恢复到新目录。', '锁平台发行组合，先 darwin-arm64 再 x64，原生 binding load/兼容/卸载/自动启动选项有测试；不清理用户项目和原生数据。'],
    mocks: ['auth required、unknown writer、磁盘不足、第二实例', '含模拟 secret 的脱敏 fixtures'],
    deliverables: ['CLI/operations/release code', '发行 manifest/安装和运维手册', '平台加载、备份恢复、诊断测试报告'],
    acceptanceIds: ['OPS-01', 'OPS-02', 'OPS-03', 'OPS-04', 'OPS-05', 'OPS-06', 'REL-11', 'REL-12'], effort: '4–6 个工程日',
    notes: '打包与账号登录分开；不自动升级用户原生 agent 或复制 token。'
  },
  {
    id: 'WP-13', title: '知识连接、明确决定与上下文构建', gate: 'G3', startAfter: ['WP-00'], acceptAfter: ['WP-02', 'WP-10'],
    ownedPaths: ['packages/knowledge/'], readOnlyPaths: ['packages/contracts/', 'packages/application/', 'product-spec/06-learning-and-evaluation.zh-CN.md'],
    forbiddenPaths: ['packages/storage/migrations/', 'vault automatic overwrite', 'packages/orchestrator-core/', 'packages/learning/'],
    interface: 'Source adapter/read-only Obsidian、UserDecision registry、provenance-aware ContextBuilder、scope/撤回与 assignment snapshot。',
    steps: ['先实现用户选定项目/知识路径的只读读取和引用，忽略凭据/无关目录；不要求全库索引才能工作。', '明确决定由可信用户入口即时记录来源/范围/版本，冲突按具体 scope/显式 supersede 处理，不能把模型推断写成规范。', 'ContextBuilder 固定本 Assignment 的有效来源与策略快照；只接 active 策略，candidate/testing/shadow 零进入。', '撤回阻止后续引用并标记影响；当前工作若受规范变化影响交应用修订/停止屏障，不原地改 Mandate。'],
    mocks: ['小型 Obsidian vault、相互冲突决定、过期来源', 'candidate/shadow/active policy read port'],
    deliverables: ['knowledge/context 包', '决定/来源/snapshot tests', '知识接入和撤回限制说明'],
    acceptanceIds: ['AC-LRN-01', 'AC-LRN-02', 'AC-LRN-03', 'AC-LRN-04', 'AC-LRN-06', 'AC-LRN-07', 'AC-LRN-12', 'AC-UX-08', 'AC-UX-11'], effort: '3–5 个工程日',
    notes: '不先造向量数据库；决定是规范要求，技术是否可执行另核验。'
  },
  {
    id: 'WP-14', title: '选择性学习、联合提问与迁移实验', gate: 'G5', startAfter: ['WP-00', 'WP-13'], acceptAfter: ['WP-03', 'WP-05', 'WP-07', 'WP-08', 'WP-13', 'WP-16'],
    ownedPaths: ['packages/learning/', 'experiments/'], readOnlyPaths: ['packages/contracts/', 'packages/knowledge/', 'packages/questions/', 'product-spec/06-learning-and-evaluation.zh-CN.md'],
    forbiddenPaths: ['packages/orchestrator-core/', 'packages/storage/migrations/', 'production account replay', 'hidden evaluation tests'],
    interface: 'Intervention/interpretation、PolicyRevision registry、隔离 experiment adapter、shadow recommendation、promotion/withdrawal evidence。',
    steps: ['先收集有范围原始介入与前后目标/产物，不覆盖事实；允许 mixed/unknown，区分目标变化与执行违约。', '用既有 runtime/GEPA 风格 adapter 生成候选，建立不学习/局部记忆/简单规则等强基线和相同预算。', '按实际环境恢复能力标 R0–R3，加入原动作 placebo；隔离 lane 和预算，candidate/testing/shadow 不影响真实上下文。', '分别评估 I1/I2/I3，留出项目/任务族，报告质量、风险覆盖、并集人工时间、费用与负迁移；无收益收窄或停止。'],
    mocks: ['可重建纠错/改需求/临时处理/混合片段', '两种真实 harness 的固定能力矩阵'],
    deliverables: ['learning module 与隔离实验 pipeline', '预声明方案、数据划分、基线/结果/费用报告', '推广/撤回门槛与反例集'],
    acceptanceIds: ['AC-LRN-01', 'AC-LRN-02', 'AC-LRN-03', 'AC-LRN-04', 'AC-LRN-05', 'AC-LRN-06', 'AC-LRN-07', 'AC-LRN-08', 'AC-LRN-09', 'AC-LRN-10', 'AC-LRN-11', 'AC-LRN-12'], effort: '研究迭代，先 1–2 周机制试验再决定',
    notes: '创新效果不是实现完成即成立；先完成 G3/G4 稳定产品，无数据不得宣称突破。'
  },
  {
    id: 'WP-15', title: '未来 CAC Adapter 与原生 Sub-team 接入', gate: 'G6', startAfter: ['WP-00'], acceptAfter: ['WP-03', 'WP-05', 'WP-06', 'WP-16'],
    ownedPaths: ['packages/drivers/cac-native/', 'docs/adr/cac/'], readOnlyPaths: ['packages/contracts/', 'packages/driver-kit/', 'packages/questions/', '/Users/hh/Desktop/huawei/ade/cac'],
    forbiddenPaths: ['CAC source mutation without separate task', 'packages/orchestrator-core/', 'packages/storage/migrations/', 'packages/contracts/'],
    interface: 'AgentDriverV1 或与现有协议同兼容的 CAC Profile；sub-team 父子/问题 provenance；不替换主内核。',
    steps: ['先核对可获得 CAC 版本和 interface；最新版 sub-team 不可得时仅提交缺口与 fixture，不宣称已兼容。', '优先复用 CAC 原生 runtime/team，父 Ticket 继续是唯一产品执行权威；原生问题带完整 binding 回主入口。', '验证 ask-user/permission、消息接收、取消子资源和恢复；不将内部 peer 消息标 human。', '跨 harness 子委派另提交父授权/scope 继承 RFC/ADR；测试越权、撤销、迟到回答和物理停止。'],
    mocks: ['CAC stub/team envelope 与父授权 scope fixture', '真实源码不可用时 NOT_TESTED compatibility report'],
    deliverables: ['interface spike 与 source-lock', 'adapter/fixtures/compatibility report（有真实 interface 才实现）', '子委派授权 ADR 草案'],
    acceptanceIds: ['EXT-02', 'EXT-04', 'RT-05', 'RT-06', 'RT-09'], effort: '接口拿到后先 2–3 日 spike；不是首版阻塞项',
    notes: '可在 G0 后研究，不能在真实接口缺失时最终验收；B 产品不依赖 CAC。'
  },
  {
    id: 'WP-16', title: '集成、根配置、端到端与发布门禁', gate: 'G0–G4', startAfter: ['WP-00'], acceptAfter: ['WP-01', 'WP-02', 'WP-03', 'WP-04', 'WP-05', 'WP-06', 'WP-07', 'WP-08', 'WP-09', 'WP-10', 'WP-11', 'WP-12', 'WP-13'],
    ownedPaths: ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', 'tsconfig.json', '.github/', 'apps/coordinator/main.ts', 'tests/integration/', 'tests/e2e/', 'reports/releases/'], readOnlyPaths: ['packages/', 'apps/', 'product-spec/'],
    forbiddenPaths: ['module-owner source paths without explicit handoff', 'packages/contracts/', 'packages/storage/migrations/', 'unrelated user changes'],
    interface: '组合根、实际运行入口、root dependency lock、CI、跨模块 E2E、gate 证据与 release report。',
    steps: ['接收 G0 模板和 contracts，建立 workspace、依赖锁、测试脚本和 import/ownership 检查；不接管模块内部实现。', '按 gate 集成：fake 闭环→一真实 Driver→两项目 Alpha→第二协议→三目标能力矩阵；G2/G3 可先阶段接受，无须等全 G4。', '验证 UI/API/Broker/Verifier/Runner/Core 真实接线，注入 commit/发送/取消/恢复窗口故障并回归已有 Driver。', '汇总 PASS/FAIL/SKIPPED/NOT_TESTED 和限制，运行发布矩阵/soak/备份恢复；稳定支持和实验目标分别声明。'],
    mocks: ['所有模块提交的冻结 fixtures 和 contract suite', '无账号 fake-native E2E lane 与单独 native lane'],
    deliverables: ['可运行产品组合根与 lockfile/CI', 'G0–G4 gate 报告、E2E/soak/release evidence', '安装/启动入口和最终兼容能力矩阵'],
    acceptanceIds: ['CORE-10', 'DATA-08', 'API-06', 'REL-11', 'REL-12', 'OPS-01', 'OPS-02', 'OPS-03', 'OPS-04', 'OPS-05', 'OPS-06', 'EXT-01', 'EXT-02', 'EXT-03', 'NATIVE-01', 'NATIVE-02', 'NATIVE-03', 'AC-UX-08', 'AC-UX-12'], effort: '持续集成职责，每 gate 分段交付',
    notes: 'acceptAfter 是最终 G4 汇总所需；不能让最终依赖阻止 G1/G2 的增量集成。G5/G6 不属于此包完成前提。'
  }
];
