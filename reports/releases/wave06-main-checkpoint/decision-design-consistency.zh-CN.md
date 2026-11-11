# 明确决定界面设计一致性记录

结论：`PASS_DESIGN_CONSISTENCY`；`disposition: ship`，仅限本次明确决定界面检查点。它是既有 Operate 工作台的普通代码扩展，未改变视觉世界，无需更新设计系统。

## 1. 范围与源码

- 日期：2026-11-11；分支：`codex/g2-execution-integration`。
- 最终检查源码：`f638fe070f34d7b38f8f38bc167d3e9985a57efc`。此前 `b5d7dab` 的决定弹窗、样式和接线在 `6076d00` 注意力集成时未变；最终提交补齐外部动作，并将预览令牌期限标为“确认期限”，范围自身有到期值时另列“范围到期”。
- 检查目标：`apps/console/src/DecisionWorkspace.tsx`、`decisions.css`，以及 `App.tsx`、`main.tsx`、`transport.ts` 的相关接线；采样 `workbench.css` 和 `styles.css` 的现行级联。
- 基准：`apps/console/PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json`、`.impeccable/surfaces/src-app-tsx.md`。保留“精密工作台”和既有 FORM seed `d7807279`。
- 本次唯一写入为本记录；未修改设计规范、sidecar、tokens、配置、surface brief、实现或其他报告。

## 2. 证据与来源限制

| 证据 | 实际检查 | 可支持的结论 |
| --- | --- | --- |
| 最终 `apps/console/.impeccable/review/desktop.png` | 打开并目检，1440×900 | 完整非空工作台与确认弹窗；主对话和既有导航仍构成基础画面，内容、关闭、确认及返回按钮可见。 |
| 最终 `apps/console/.impeccable/review/mobile.png` | 打开并目检，390×844 | 确认内容正常换行；范围行、两项动作和关闭入口完整可见，底部导航保留，无可见遮挡或横向溢出。 |
| 最终源码与两图 | 比对“外部动作”“确认期限”及预览结构 | 两图与当前确认内容一致；没有范围到期值的截图不证明该条件分支的视觉状态。截图的提交归属采用主线交接，本次未独立捕获。 |
| `decisions-browser/browser-report.json` | 读取报告，source 为 `f638fe0`，`sourceWorktreeClean: true`，4/4 PASS，`errors: []`，`modelCalls: 0` | 只读预览与响应式、确认/重开/撤销审计、丢失响应后 reload 重试同一请求，以及不创建 Work/native effects。测试由主线执行，本记录未重跑。 |

目录的全部来源状态、长目录分页、错误状态和未知结果条没有逐态截图；它们的一致性判断来自组件/样式阅读，行为范围以上述真实本地 HTTP/SQLite 浏览器报告为准。本次未启动浏览器或服务，未运行 detector，未发送 native/model 请求。

## 3. 现行系统摘要

1. 配色：石墨导航 `#272d2a`、白色工具面 `#fff`、青绿动作 `#197764`，辅助灰与细线维持层级，语义色均配中文状态。
2. 字体：继承 Inter 与中文系统回退；正文 14px，辅助信息 11–12px，弹窗标题继承既有 17px；固定字号、零字距，移动 textarea 为 16px。
3. 布局：主对话优先，平面目录行以细线分隔；弹窗宽度为 `min(560px, calc(100% - 32px))`，复用原弹窗的视口高度限制和内部滚动。
4. 形状与交互：继承 6px 控件和 8px 弹窗圆角，lucide 图标配名称/提示，主次按钮、可见焦点及禁用状态复用现行规则。
5. 命名规则：延续 Semantic Color、Fixed Type、Stable Geometry 和 Structural Shadow 的现有意图；新增内容没有建立独立 token 或组件视觉体系。

## 4. 扩展与既有系统的对应

| 项目 | 判定 | 依据 |
| --- | --- | --- |
| 主画面与密度 | 一致 | 保留桌面 utility header、石墨轨道、项目列及白色对话；移动端保留单主区和底栏。未新增 hero、装饰分区或嵌套卡片。 |
| 确认容器与动作 | 一致 | 复用 `project-settings-dialog`、`settings-actions`、标准按钮和 icon-button。原生 dialog 提供明确确认的焦点边界，关闭后恢复原焦点；忙碌时阻止取消。 |
| 内容与范围阅读 | 一致 | 内容使用现行正文体系，元数据采用紧凑双列；长文及身份允许换行。外部动作单列，“确认期限”与可选“范围到期”区分业务含义。 |
| 目录、来源与撤销 | 一致，源码范围 | 平面列表、中文审计状态、独立来源状态和按需展开的技术详情沿用可扫描的 Operate 结构；逐条撤销具有第二次确认，危险动作使用现有样式。 |
| 预览与确认边界 | 一致 | 入口仅面向已持久化的 trusted_user 项目消息；先准备只读预览，再由独立“确认记录”提交。“已记录”未表达编码执行或权限批准。 |
| 未知结果与重开 | 一致，行为报告范围 | 会话存储保存完整原命令；结果未知时提供“重试原请求”并禁用新的决定写入。它没有把 reload 变成新的业务授权。 |
| 资产与动效 | 一致 | 代码与现有 lucide 足以表达本次操作，无新增 shipping raster、展示字体或运动资产，也无新增资产出处义务。 |

## 5. 未归一化差异与准入边界

现有 DESIGN 的阴影文字主要描述抽屉，而此前已存在的项目设置 dialog 使用 `0 18px 70px #17251e26` 和 backdrop；本次决定界面直接复用该容器。这是已有文档与实现的覆盖差异，本记录不把它新增为全局规则，也不修改旧规范。13px 空态文字和 16px 移动 textarea 的 detector 建议与 incumbent 用法相符，不构成本次 material fix；没有为消除建议新增字体 token。

本次无设计一致性层面的 material fix。系统文件保持原样。结论只允许交付上述明确决定 UI 检查点，不代表 whole-product、actual-native-control、installed-alpha、review-value、通用提案执行、自动上下文注入或恢复新授权通过。
