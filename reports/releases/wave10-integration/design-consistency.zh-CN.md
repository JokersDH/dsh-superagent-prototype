# Wave-10 所选上下文消息：既有设计一致性记录

2026-11-11。结论：本次普通扩展与既有工作台设计一致；沿用独立 finish reviewer 的限定 `ship`，没有需要改写设计体系或补充产品栅格资产的变化。本记录只补充设计比对与证据范围，不颁发整产品、原生、恢复激活或发行准入。

## 范围与依据

固定方向来自 `apps/console/PRODUCT.md`、`apps/console/DESIGN.md`、`apps/console/.impeccable/design.json` 和 `apps/console/.impeccable/surfaces/src-app-tsx.md`：Operate 模式，对话主导，石墨导航、白色阅读面、青绿动作色；FORM 保留 `Seed d7807279`。按 Impeccable `reference/document.md` 扫描既有实现，本次保留这四份文件和全部 sidecar 内容，没有建立新视觉世界或重命名 token。

比对源码为工作区中的 `apps/console/src/ContextWorkspace.tsx`、`context.css`、`App.tsx` 与 `transport.ts`，并核对 `workbench.css` 的实际级联。独立终审为 `ui-finish-review.zh-CN.md`，其 `disposition: ship`、`material_fixes: 无` 仅覆盖所列前端源码和既有截图。

## 设计比对

| 项目 | 结果 | 实际延续与适配 |
| --- | --- | --- |
| 颜色与材质 | 一致 | 新增样式使用既有 `--panel`、`--ink`、`--muted`、`--line`、`--canvas`、`--accent` 与 `--warn`。白色工具面、细分隔线和琥珀待核对文字继续承担结构与状态，没有增加装饰色、插画或仿材质。 |
| 布局与形状 | 一致的局部扩展 | 复用 `project-settings-dialog`，上下文工具宽度限制为 `min(680px, calc(100% - 32px))`，继承 8px 圆角、遮罩和对话框滚动。确认文本、动作、来源汇总和逐条详情按顺序平铺；分区以细线分隔，没有嵌套卡片。 |
| 字体与信息层级 | 一致 | 延续本地 Inter / 系统中文字体、固定字号和零字距。14px 消息正文、15px 结果标题、12px 标签及 11/10px 技术元数据各有用途；13px 局部标题保持紧凑。长原文、会话身份和摘要允许换行，来源正文在自身范围滚动。 |
| 控件与动作等级 | 一致 | 使用既有按钮、原生 select、checkbox、number input、textarea、details / summary 和 lucide 图标。编辑时“预览消息”是主动作，“生成预览”是次动作；确认后“确认发送”为主，“修改消息”“复制预览”为次。关闭与重读工具有图标名称及提示。 |
| 响应式 | 一致 | 沿用 720px 断点。项目/工作选择与预算改为单列，来源选择和动作行可换行；移动输入固定 16px，动作最小高度提高至 40px。对话框受视口高度约束，长摘要不扩大页面宽度。 |
| 状态与可访问性 | 一致，证据有界 | 读取、无来源、部分纳入、来源缺失、授权/预览过期、发送未知及记录损坏都有中文文字和禁用条件，状态不只靠颜色。原生 modal dialog、字段 label、`aria-label`、`role=status/alert`、全局 `focus-visible` 和关闭后恢复焦点延续既有模式；在途发送暂时阻止关闭。此处为源码与截图核对，未另做屏幕阅读器或完整键盘验收。 |

## 操作流程一致性

| 流程 | 与既有产品原则的对应 |
| --- | --- |
| 明确预览，再明确确认 | 普通“生成预览”保持只读；“预览消息”固定原文、原会话、可选工作版本和来源，再显示“确认发送”。能力关闭时保留既有只读入口，预览不会被表现成发送或编码授权。见 `ContextWorkspace.tsx:60`、`:79`、`:143`。 |
| 结果未知，核对同一请求 | 网络发送前把同一 command/token 与 prepared 写入 `sessionStorage`；丢响应保留 pending，“核对原请求”复用原 command/token，原预览过期不阻断核对。页面明确显示“原请求待核对”，没有另开隐式发送动作。见 `ContextWorkspace.tsx:31`、`:94`、`:145`。 |
| 终态拒绝后可修订 | 收到 `rejected` 清除 pending / prepared，保留编辑文本并说明“消息未发送”，用户重新预览后才能再确认。存储读写损坏则暂停新的上下文发送。见 `ContextWorkspace.tsx:97`。 |
| 来源按需查看 | 确认区先显示条目、体积、估算 token、有效期、分组与遗漏，再展开内容和摘要。消息后的“上下文来源”懒读取实际 binding，提供未附加、读取中、失败与重试状态；transport 和视图核对消息、项目、会话身份。见 `ContextWorkspace.tsx:153`、`App.tsx:2319`、`transport.ts:438`。 |
| 成功只清理对应草稿 | 成功回调仍检查当前会话；只有主输入器草稿与发送原文完全相等时才清空，组件再做一次相等检查。对话框内改写消息不会清掉另一份主输入器草稿。见 `App.tsx:1243`、`:2068`。 |

这些行为将讨论、选定来源和明确授权继续分开，沿用现有 AssistantModelPort / SSE 的显示路径；界面没有增加执行生命周期、自动派单或自动接受的表述。

## 证据与限制

六张既有截图已经逐张查看，文件有效且画面与名称对应。桌面为 1440×900，移动为 390×844：

| 状态 | 桌面 | 移动 |
| --- | --- | --- |
| 编辑 | `context-browser/desktop-edit.png` | `context-browser/mobile-edit.png` |
| 确认 | `context-browser/desktop.png` | `context-browser/mobile.png` |
| 来源详情 | `context-browser/desktop-source.png` | `context-browser/mobile-source.png` |

截图在 A 的 SQL binding port 集成前，由明确标注的 `afterCommit_in_memory_composition_fixture` 捕获，只用于视觉布局和当时前端交互比对。来源详情的移动截图处于对话框内部滚动位置；这不是新一次截图捕获，也不是干净生产源码或 schema16 的截图证明。未见空白、黑块、横向溢出或不连贯遮挡。

最终功能重放的 `context-browser/browser-report.json` 为 main 执行 `--no-capture` 后的 9/9 PASS，`bindingPort=production_A_port`，使用实际本地 HTTP / SQLite / React / SSE 与 mock AssistantModelPort；schema16 是本轮生产接线范围。当前记录的 `sourceCommit=4140cac15f4ab9c4f5027d96fbee99edb22347be`、`sourceWorktreeClean=true`、`checkedAt=2026-11-11T15:27:07.679Z`，`errors=[]`、真实 `modelCalls=0`、`mockProviderCalls=3`。其中丢响应场景还覆盖 provider 不可用、原预览过期后仍能核对原 pending；独立 reviewer 已将这项限定修复标为 `resolved`，其作用是启用原请求核对，没有改变布局或样式。此次 clean source 功能重放没有重拍上述六张图片；图片仍属于实现阶段、A SQL port 集成前的 fixture，不能标为 clean `4140cac` 新截图。本次仅同步来源记录，没有新增设计审查、截图或 detector 运行，既有设计体系继续保留。

本会话已有一次 detector，只有继承的 13/16/10px 字号 ramp advisory，没有机械缺陷；本次没有重跑 context、detector、浏览器、模型、native 或用户服务。没有新增 shipping raster 产品资产，六张 PNG 是验收截图；因此没有新增产品资产 provenance 条目。`DESIGN.md`、其 sidecar、surface brief、生产源码与测试均未由本记录修改。

来源摘要、budget、授权和持久化的安全性仍以对应实现与独立测试为准。此处不证明生产 binding 表的崩溃耐久性、真实模型效果、native 控制、个人安装、恢复目标激活或完整可访问性覆盖；finish reviewer 的既有 `ship` 也不扩展到这些范围。
