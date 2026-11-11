# 跨项目待办：设计一致性核对

日期：2026-11-10。结果：**PASS，限既有设计系统的普通扩展一致性**。没有批准新视觉世界或系统变更；`apps/console/DESIGN.md`、`.impeccable/design.json`、配置和 surface brief 保留原样。本报告不授予整产品发布准入。

## 核对范围

- 分支：`codex/g2-execution-integration`；证据生产源：`e937dbed5e06b7bcf68b1cd7121d2a4bf2436e03`；父提交：`73f8446ee66bb8cf9891c17f87e3416310cd4ede`。截图与浏览器报告绑定该证据源。
- 设计依据：`apps/console/PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json`、`.impeccable/surfaces/src-app-tsx.md`；方法依据为 Impeccable documenter 角色及 `reference/document.md` 的普通扩展规则。
- 源码：完整读取 `src/AttentionInbox.tsx`、`src/attention.css`，抽样核对 `src/workbench.css`、`src/styles.css`，以及 `App.tsx` 的来源导航、逐项审阅和单候选接受段落、`main.tsx` 的样式级联、`transport.ts` 的 attention 读取与校验。
- 实际打开并目检 `apps/console/.impeccable/review/desktop.png`（1440×900）、`user-1280.png`（1280×800）、`mobile.png`（390×844）；用 `sips` 确认尺寸。1280×800 是测试尺寸，不代表已知用户实际视口。
- 已读 `reports/releases/attention-inbox/ui-finish-review.zh-CN.md` 与 `browser/browser-report.json`。本次只做源码和既有证据核对，没有启动服务、重跑浏览器、检测器或原生任务。

## 一致性结果

| 维度 | 结果与依据 |
| --- | --- |
| 视觉世界 | match：白色主面、石墨导航、冷浅灰侧栏与青绿交互延续现有 Operate 壳层；跨项目待办是主区内的工作视图。 |
| 色彩与语义 | match：问题沿用琥珀，候选交付沿用青绿，阻塞沿用风险红；均有类别和摘要文字。错误边线 `#efd5d4` 已见于 `workbench.css`；局部悬停底色 `#f8faf8` 未形成新强调色或复用 token。 |
| 字体与字阶 | match：继承本地 Inter、中文回退、零字距与等宽数字；14px 项标题、13px 摘要、12px 控件、11px 元数据保持紧凑层级，移动搜索为 16px、排序辅助信息为 10px，没有展示大字。 |
| 布局、形状与层次 | match：列表以细线分隔，无浮起页面卡片或新装饰阴影；控件沿用小圆角，长中文在自身区域换行。720px 断点收紧留白、让项目筛选独占一行，并保留既有底部导航。 |
| 稳定几何 | resolved：三张当前截图中“项目”均横排，与 select 同行且无可见筛选区溢出；源码已设置标签不收缩、不换行。finish review 的最终 `ship` 仅评分这一项修复。 |
| 工作语义 | match，源码范围：标题、项目、类型、摘要和未知时间明确；计数注明“本页”，源码保留有界覆盖、分页、空态和错误态。逐项审阅只导航，接受仍携带单个 candidate；未新增批量授权控件。 |

## 五行系统摘要

1. 配色：白色阅读面、石墨导航、青绿动作，琥珀与风险红承担语义状态。
2. 字体：本地 Inter 加中文回退；固定字阶、零字距、等宽数字。
3. 空间：全高工作壳层、平面分区、细线列表；720px 切换移动布局。
4. 控件：紧凑小圆角、lucide 图标、既有按钮与可见焦点，长文本自行换行。
5. 命名规则：Semantic Color、Fixed Type、Stable Geometry、Structural Shadow 均继续适用。

## 既有差异与证据边界

既有 YAML 字阶没有逐项列出 13px、10px 和移动输入 16px；正文、组件说明及 sidecar 已记录这些用法。错误边线也没有单独列为颜色 primitive，但已存在于旧工作台源码。这是已有记录粒度差异，本次不补 token、不修旧漂移，也不将检测器咨询项或局部值升格为新系统规则。抽样范围未发现需要批准系统变更的视觉漂移。

浏览器报告在同一源提交记录真实本机 HTTP/SQLite 与受控子进程的 6/6 PASS、`errors: []`、`modelCalls: 0`；当前是有界工作页内等待排序，未启用 C 的确定性优先级。该报告支持已列的筛选、来源导航、逐项审阅和单目标动作场景，不证明多页覆盖、所有边缘状态、键盘交互、原生兼容性或实际审阅收益；本次文档核对没有重新执行这些行为。

收尾时工作区存在后续未提交兼容修改：`AttentionInbox.tsx` 在 attention 不可用时，改为仅在 `active` 为真时渲染旧回退内容。该修改不在上述提交、截图和浏览器报告的证明范围，集成方需另行验证；本报告不修改它或扩大原证据范围。

没有新增 shipping raster。三张截图只是测试证据；界面复用 lucide 和现有自托管字体，本次不产生图片资产来源记录。未规范化或修复的项目仅为上述已有记录粒度差异，原因是任务属于普通扩展，未授权设计系统更新。
