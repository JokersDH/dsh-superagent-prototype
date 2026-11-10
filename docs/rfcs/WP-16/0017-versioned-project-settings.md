# 主线：版本化项目设置进入工作台

日期2026-11-10；基线`8c736f2`。本批完成wave-04主线M2的项目设置纵向，复用A已集成的projects版本/归档端口，没有修改storage源码或新增生产迁移，也未编辑A–E工作区。

## 产品行为

选择已导入的真实项目后，项目区域出现设置图标。可修改名称、固定验收检查（Node/pnpm/npm）、是否授权使用指定本地缓存离线准备依赖，查看版本记录，并归档/恢复项目。fixture项目和旧后端不展示不存在的设置入口。

保存采用expectedRevision，归档采用expectedArchiveRevision；旧窗口提交冲突时保留输入，用户可刷新核对。原项目必须仍是已有提交的干净Git根目录；离线缓存必须是项目外已有绝对目录。保存设置不运行检查、不安装依赖、不启动Agent或模型；真正委托仍走现有确认流程。

归档阻止新工作及新合同授权；已有工作、问题、停止、验证和交付保留。恢复后按当前设置允许新授权。单项目最多100版设置，达到上限界面明确阻止继续追加；版本不原地修改或永久删除。

## 配置如何保持冻结

新增`ProductProjectSettings`通过A的`store.workflows.projects`保存版本，通过已有ArtifactStore保存内容可寻址的私有快照。快照包含project身份/路径、固定check定义（实际executable/argv/environment allowlist）和environment策略/管理器路径；settings.sourceRef引用注册产物。存储历史保留这些引用和完整性校验，重开按快照恢复，不重新用当前工具/路径猜旧设置。

首版保留原check ID；后续每版使用独立`check-<projectId>.s<revision>`，不复用同ID的“最新检查”覆盖旧合同。新工作必须引用当前项目检查；旧页面或其它项目的检查引用拒绝。修订/继续若显式保留合法旧检查仍使用其原快照，归档时不能创建新授权。

ProductExecution在准备工作区前根据当前合同的检查引用解析其快照；环境状态同样按该合同解析。旧工作排队时修改设置，不会在实际开始时切换到新环境。全部历史检查留在内部注册表；公开configuration只列当前默认检查，避免历史无限增长突破公开列表上限。

私有`native-projects.json`继续保存初始路径/身份绑定；设置更新的唯一当前版本在同一SQLite ledger中，不在两种文件之间做非原子双写。bootstrap可为既有项目登记首版快照；后续设置和命令receipt/event同事务提交，失败回滚，不在内存发布半成功检查。

默认配置revision纳入当前名称、检查和归档结果；现有Work/Ticket/Assignment/合同摘要及环境凭证不被设置操作改写。Runner/data契约及其hash不变。

## 公共接口

定义：`packages/contracts/src/project-settings.ts`，companion protocol `project-settings/1`；生成schema/manifest在同包generated。configuration项目项增加可选`settingsAvailable`，只表示该项目有设置入口，不授予执行权限。

| 入口 | 输入/输出 | 规则 |
| --- | --- | --- |
| GET `/v1/projects/:id/settings` | ProjectSettingsPage | 当前版本、archive CAS、至多100版历史；认证读取，拒绝任意query |
| POST `/v1/projects/:id/settings` | ProjectSettingsCommand → CommandReceipt | update_project_settings / archive_project；URL与projectId必须一致；actor由服务端认证生成 |
| product.read.projectSettings | projectId → page | 仅配置的native项目；未知项目拒绝 |
| product.operations.projectSettings | command + TrustedActor | 解析、可信身份、Git/缓存/工具预检；同事务CAS版本与receipt/event |

更新输入：commandId/projectId/expectedRevision/displayName/check/environment。归档输入：commandId/projectId/expectedArchiveRevision/archived。不接受任意executable/argv/path/actor字段；不能借此切换项目路径。指定缓存路径是本机操作者明确设置，允许在认证设置页读取；默认configuration仍不暴露私有路径或native配置。

receipt是持久结果：同commandId/完整载荷/actor重放返回原回执，同ID不同载荷冲突；成功提交后响应丢失，先刷新核对，不换ID自动重发。A/C的决定/提案命令仍按其它检查点继续，不与本设置协议混用。

恢复只读模式依旧在HTTP层拒绝此POST；本批没有新增解除恢复隔离入口、路径迁移或发行准入。

## 验证与证据

新backend5项：旧排队合同/环境与检查冻结、重启、归档/恢复、CAS/actor/坏缓存、receipt失败回滚、原私有绑定文件不双写、认证HTTP边界。原导入4项、配置5项、application16项、product19项、environment3项、HTTP16项和恢复启动1项回归通过；契约198项、前端16项及相关typecheck/build通过。

四项真实HTTP/SQLite网页场景：编辑并保存历史、归档恢复实际配置、并发旧页拒绝且保留输入、窄屏缓存错误与键盘焦点恢复。配置fixture使用占位profile，但执行consumer从未启动；不是原生模型或依赖安装测试。本批模型调用0。

浏览器初次读取表单时没等待异步加载，工具已改为等当前版本显示。另实测发现侧栏移动到隐藏状态会隐藏嵌套dialog，已将dialog portal到body，并在窄屏关闭后把焦点交回工作空间按钮。没有改变既有设计方向；截图按DESIGN现有尺寸和颜色核对。

命令：`pnpm check:project-settings`；`pnpm check:project-settings-browser`（可加`--no-capture`）。浏览器工具自建临时目录/端口并关闭；证据在`reports/releases/project-settings/`。现有5180/5181/5182用户服务保持，新预览使用5183/8799和独立`.local-state/project-settings-preview`，不自动复制旧历史。

## 下一消费者

- A：本批只使用已发布projects.current/history/append/setArchived及artifact公开端口，sourceRef现在引用私有快照产物。新的assistant持久端口与迁移候选独立复验；不要修改本批合同/检查标识语义。
- C：项目设置变更不直接产生用户长期决定；读取上下文仍需来源和授权。新候选`45bf9de`及A`1dddee9`已观察到，尚未在本批接入产品。
- B：Runner/Driver源码与冻结wire未改；原生实际停止/问题/预算证据仍按B任务，不把配置fixture当native兼容。
- D：备份必须包含sourceRef所引用的注册快照产物；恢复重绑定后旧路径快照不能视为新机器授权，保持readonly门禁。
- E：独立验settingsAvailable、旧窗口合法命令的业务拒绝、旧合同环境冻结、归档后不新授权、receipt事务回滚、手机modal和错误保留输入。

限制：尚未进行本批新原生模型任务、跨机器迁移或完整个人Alpha准入；项目根移动、任意monorepo检查配置和自动重新准备旧环境不在此接口范围。
