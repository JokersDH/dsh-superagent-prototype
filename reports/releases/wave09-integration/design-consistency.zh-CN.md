# Wave-09 Context / Evidence 设计一致性记录

日期：2026-11-11。范围：`ContextWorkspace.tsx` / `context.css`、`WorkEvidencePanel.tsx` / `evidence.css` 及其 App、transport、main 接线；普通扩展，Mode 为 Operate。独立 finish review 的结论为 [ship](ui-finish-review.zh-CN.md)，本记录补充实际实现与既有设计的对应关系，不重新定义视觉系统。

## 设计依据与范围

依据为 [PRODUCT.md](../../../apps/console/PRODUCT.md)、[DESIGN.md](../../../apps/console/DESIGN.md)、[sidecar](../../../apps/console/.impeccable/design.json) 和 [Main Workbench 方向契约](../../../apps/console/.impeccable/surfaces/src-app-tsx.md)。沿用“精密工作台”、种子 `d7807279`、专业浅色、石墨导航 / 白色主会话 / 青绿动作色，以及会话优先、细节按需展开的方向。

本次只新增明确打开的上下文预览和工作详情内的交付记录。预览入口受 configuration 与 transport capability 控制；Evidence 安装在当前候选产物之后、可用动作之前。主会话、输入器、四阶段条、项目导航及执行授权结构继续承担原有职责。

仅新增本报告；未改写 PRODUCT、DESIGN、sidecar、surface brief 或生产实现。图片均为测试截图，没有新增随产品交付的 raster 资源。

## 实际实现对照

| 项目 | 已实现值与行为 | 与既有系统的关系 |
| --- | --- | --- |
| 颜色 | 新样式使用 `--ink #29312f`、`--muted #69716d`、`--line #e2e8e3`、`--panel #fff`、`--accent #197764`、`--ok #27764c`、`--warn #8e5e20` / `--warn-soft #fcf3e4`。来源正文背景取现行 `--canvas #f6f8f6`。 | 继承 `workbench.css` 的实际级联；完成、部分、未知和失败均保留文字，没有增加主题色。 |
| 字体 | 继承 Inter / 系统中文字体、固定字号、零字距、等宽数字。Context 标题继承对话框 17px，结果标题 15px / 600；字段和来源正文 14px / 12px，选择器继承 13px，摘要 11px；来源行与警告 13px。Evidence 标题 13px / 600，记录正文 12px，辅助信息 11px，时间、来源 ID、部分标签 10px。 | 延续紧凑操作面与技术信息层级，没有展示字体或视口缩放字号。`code` 继承既有等宽字体栈；来源正文使用 `pre`。 |
| 间距与分区 | Context 桌面宽 `min(680px, 100% - 32px)`；复用对话框 24px 内边距，选择器间隔 14px，来源正文内边距 12px，结果前留白 18px。Evidence 顶距 20px、纵向内边距 16px、记录行纵向内边距 11px；时间与测量值右对齐。 | 保留现有按用途取值的紧凑节奏，以 1px 细线组织平面分区，没有给每个分区增加卡片。 |
| 形状与深度 | Context 继承既有 `project-settings-dialog` 的 8px 圆角、模态遮罩及结构阴影；输入 5px、按钮 6px，来源正文不另设外层卡片。Evidence 为上下细线界定的无阴影区，部分标签 3px。 | 复用既有工具容器与标签形状；常驻内容保持平面。没有新增阴影或动效体系。 |
| 控件 | 原生 select、checkbox、数字 input、`details/summary`；生成 / 复制为明确命令，预算折叠，来源与遗漏可展开。lucide 提供工具、来源、历史、时钟及状态图标。 | 对应熟悉控件与按需揭示原则；工具按钮沿用固定 32px 图标格及名称 / title。 |
| 响应式 | 720px 以下 Context 选择器与预算改单列，输入和选择器为 16px，动作最小高度 40px，内边距 20px，最大高度 `100dvh - 24px`。来源 `pre` 最大高度 280px，自身滚动并换行；摘要允许任意位置换行。Evidence 继承 350px 详情栏及移动抽屉，记录内容列为 `minmax(0, 1fr)`。 | 延续现有 720px 移动断点与抽屉布局；长来源和身份文本在所属区域处理。 |

`main.tsx` 在 `workbench.css` 和既有功能样式之后加载 evidence / context 样式；以上记载按当前实际级联读取，不把 DESIGN 中的抽象角色当成所有组件的唯一尺寸。

## 状态与可访问性

Context 源码包含读取中、无来源 / 部分来源 / 来源就绪、来源变化、项目不匹配、授权过期、预算无效 / 收紧、预览过期、复制成功 / 失败、遗漏和指令式文本提示。更换选择会清除旧预览；读取中禁用 fieldset；过期预览禁止复制。加载状态使用 `role="status"`，错误使用 `role="alert"`。动作限于生成及复制预览，未显示自动模型注入或执行授权。

Evidence 源码包含折叠 / 展开、刷新、初次读取、实例不支持、空历史、分页、来源受限、读取失败，以及 `recorded` / `source_missing` / `not_in_window` / `not_accepted` 接受投影。历史来源通过 disclosure 显示。测量同时显示“可见活动”“部分”；缺失为“未记录”，不会换成零或质量判断。当前测量绑定当前合同与验证引用，切换工作或旧请求晚到不会替换当前记录。

对话框使用原生 `showModal()`，有可见关闭按钮、Escape 路径及卸载后的焦点恢复；选择器、输入、来源组选项有名称，Evidence 展开按钮带 `aria-expanded`。多数控件继承 2px `#408f75` 焦点轮廓和 3px 偏移；Context 文本 / 数字输入局部采用 2px accent 轮廓和 2px 偏移。禁用、hover 与 reduced-motion 继承已有规则；新加载占位条没有动画。状态不只靠颜色表达。

这些是源码核对结果，不等于已完成屏幕阅读器、完整键盘、缩放或对比度审计。既有浏览器报告另覆盖 Escape 关闭与焦点返回、过期禁用、无效预算及无水平溢出；本次未重跑这些流程。

## 截图与既有浏览器证据

已逐张核对八张测试截图：桌面 `1440×900`，移动端 `390×844`。

| 证据 | 可见结论 |
| --- | --- |
| [Context 桌面](context-browser/desktop.png)、[来源详情](context-browser/desktop-source.png) | 选择、明确动作、来源计数、有效期、分组、来源正文和双摘要延续现有工具布局。 |
| [Context 移动](context-browser/mobile.png)、[滚动后的来源](context-browser/mobile-source.png) | 单列字段与来源换行可读；第二张用于展示滚动后正文和摘要，不要求概览首屏容纳全部内容。 |
| [Evidence 桌面](evidence-browser/desktop.png)、[移动](evidence-browser/mobile.png) | 当前接受投影、部分计时、来源标识和时间线在既有详情栏 / 抽屉内可扫描，主会话结构保留。 |
| [未知测量](evidence-browser/desktop-unknown.png) | “可见活动 · 部分”明确显示“未记录”。 |
| [失败验证](evidence-browser/desktop-fail.png) | “未通过”仍为风险状态，可用动作未出现接受当前候选；历史入口不改变验证结论。 |

[Context 浏览器报告](context-browser/browser-report.json) 为 6/6 PASS，[Evidence 浏览器报告](evidence-browser/browser-report.json) 为 8/8 PASS，均记录零模型调用。主线已在干净源码 `32fc7aee99b30b49030208d6bac95e843cc38d9c` 使用 `--no-capture` 复跑，两份当前报告均为 `sourceWorktreeClean=true`；这些报告提供该提交上的功能复验结果。

上述八张截图仍为实现阶段未提交工作树的捕获，未在 `32fc7ae` 上重新拍摄。Evidence 外层工具栏随后新增上下文入口和非视觉计时门控，面板样式及内容未变；截图不能标记为干净提交的新截图，也不构成冻结安装物的回归证据。

截图未覆盖所有 loading / error / empty / 分页 / 过期分支，相关存在性以源码及上述报告区分记录。Evidence 报告使用真实本地 HTTP / SQLite 与受控子进程 fixture；历史分页为每次读取的观测，不保证跨请求冻结快照，活动区间只是部分观察元数据。

## 既有 Drift 与限制

沿用此前 detector 的 `13px` / `16px` / `10px` 字号 advisories，不在本次修复或新增全局 token：13px 已用于既有问题标题和对话框字段，16px 是已确认的移动输入尺寸，10px 已记录为密集元数据角色。本扩展的对应取值有现有用途依据；这不是忽略所有字号风险或新一轮 detector PASS。本次未运行 detector，也未刷新其记录。

本次仅作源码、既有设计和截图比较，未启动浏览器、服务、runtime、native turn 或模型调用。独立 ship 结论只适用于本次 Context / Evidence 扩展；不覆盖全站无障碍、自动上下文注入、原生执行、恢复目标激活、安装升级或整产品发布认证。
