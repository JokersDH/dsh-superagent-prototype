# Wave08 提案工作台设计一致性记录

日期：2026-11-11。范围：现有「个人 Agent 工作台」中的普通功能扩展，沿用已确定的石墨导航、白色阅读面与青绿动作色；本次没有建立新的视觉体系。

本记录只写入此文件。`PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json` 与主工作台 surface brief 均保留；未新增栅格素材、视觉探索稿或全局设计 token。

## 参照与源码

- 文档流程：[impeccable document reference](/Users/hh/.codex/skills/impeccable/reference/document.md)。此处记录已有体系中的扩展，不重写现有设计文件。
- 产品约束：[PRODUCT.md](/Users/hh/Desktop/joker/superagent/apps/console/PRODUCT.md)。主对话优先，讨论、明确授权与验证完成保持可辨认的阶段；界面使用具体中文动作与真实状态。
- 视觉依据：[DESIGN.md](/Users/hh/Desktop/joker/superagent/apps/console/DESIGN.md)、[design.json](/Users/hh/Desktop/joker/superagent/apps/console/.impeccable/design.json)、[主工作台 brief](/Users/hh/Desktop/joker/superagent/apps/console/.impeccable/surfaces/src-app-tsx.md)。实际样式级联仍以先加载的 `styles.css`、其后的 `workbench.css` 及功能样式为准。
- 新组件：[ProposalWorkspace.tsx](/Users/hh/Desktop/joker/superagent/apps/console/src/ProposalWorkspace.tsx)、[proposals.css](/Users/hh/Desktop/joker/superagent/apps/console/src/proposals.css)、[configuration-labels.ts](/Users/hh/Desktop/joker/superagent/apps/console/src/configuration-labels.ts)。
- 接线：[App.tsx](/Users/hh/Desktop/joker/superagent/apps/console/src/App.tsx)、[transport.ts](/Users/hh/Desktop/joker/superagent/apps/console/src/transport.ts)、[main.tsx](/Users/hh/Desktop/joker/superagent/apps/console/src/main.tsx)。

## 保留的设计规则

| 规则 | 本次体现 |
| --- | --- |
| 石墨、白色与青绿的职责 | 常驻导航、侧栏与对话底层结构沿用原工作台；提案使用白色面、墨色正文、辅助灰元数据，青绿用于确认及选中态。 |
| 语义状态可读 | 未确认请求和错误有文字说明；成功使用勾号与结果文字；过期项目显示「项目授权已过期」，并禁用预览。没有仅凭颜色表达状态。 |
| 固定字号与零字距 | 正文使用 14px，辅助信息主要为 11/12px，局部标题为 13/14px；继承 Inter/中文回退字体与零字距。移动文本框固定为 16px。 |
| 紧凑控件与明确动作 | 工具入口与关闭按钮复用 `icon-button`；图标来自 lucide，具有名称和 title。提案类型用分段按钮，路径和检查用 checkbox，选择项使用原生 select。 |
| 平面分区与轻圆角 | 表单、范围、检查和预览按细线分区；没有给普通内容再套卡片。文本框 5px、分段控件 6px，外层复用 8px 设置对话框。 |
| 主对话的稳定布局 | 不改变 52px 顶栏、56px 导航、232px 项目列、760px 阅读宽度或既有详情抽屉结构。新增提案在原工作台上按需打开。 |
| 受约束的响应式布局 | 对话框宽度为 `min(620px, calc(100% - 32px))`；720px 以下字段由双列转单列，操作行允许换行，对话框内部纵向滚动。长路径、来源与工作身份允许换行。 |
| 既有交互反馈 | 继承按钮禁用、150ms 颜色过渡、可见焦点与 reduced-motion 规则。原生 modal dialog 提供模态边界，源码保留关闭入口、Escape 处理及关闭后焦点恢复。 |

## 新增组件的边界

`ProposalWorkspace` 复用已有 `project-settings-dialog` 外壳和设置表单习惯，提供创建工作、修订工作与记录决定三种模式。预览将来源、路径、外部动作、执行器、检查与确认期限分层呈现；来源身份放在可展开的 details 中，确认与拒绝是清楚的命令。

入口增加在顶栏和可信用户消息旁，均受配置能力与 transport 方法存在性控制。`configuration-labels.ts` 从原 `App.tsx` 提取同一份阻断文案，供提案窗口复用。HTTP transport 校验预览身份与命令回执；界面保留响应未知时的原完整命令及预览，用「核对原请求」呈现恢复动作。

提案类型的选中态保留局部浅阴影 `0 1px 3px rgb(32 49 40 / 9%)`，用于分段选择的状态辨认。本记录将其限定为该组件状态，不加入全局阴影词汇。外层 modal 的 `0 18px 70px #17251e26` 阴影来自既有设置对话框；它未完整体现在旧 DESIGN 的抽屉阴影叙述中，属于既有文档与样式的差异。

## 检测提示与修复区分

一次设计检测给出 13px、16px 未出现在 YAML typography ramp 中的 advisory。本记录未重跑该检测，也不将其记为零提示通过。两种字号均已有实现与文字依据：`workbench.css` 的工作行、问题标题及设置字段使用 13px，移动输入控件使用 16px；`decisions.css` 已使用同样的移动文本框字号；DESIGN 正文也明确记载 13px 问题标题与 16px 移动输入。它们是既有机器字号表覆盖不完整的提示，不能据此认定本次更换了字体体系。

静态核对另发现一项真正新增的问题：提案类型栏最初引用 `var(--surface-subtle)`，但所加载 CSS 没有这个变量的声明。DESIGN YAML 虽记录了该颜色，生产 CSS 的同类浅底此前使用字面量，不能把 YAML 记录当成运行时变量。主线已把该背景改为显式 `transparent`，保留已评审截图中变量未解析时的实际背景外观；本次没有为此新增全局变量。

修复后的提案样式仅引用 `--line`、`--panel`、`--ink`、`--muted`、`--accent-strong`、`--warn`、`--accent`、`--ok`。本次只读扫描在已加载样式中均能找到定义，没有剩余的新增未定义引用。设计依据文件的 `git diff --name-only` 为空。

## 独立审阅与验证范围

独立 finish reviewer 首轮为`fix`；最终 verdict pass 为`ship`，只评分下列两项原发现，均为resolved，不扩大为整张surface或整产品审查：

1. 修订确认必须披露目标工作的标题、`workId` 与预期合同版本。当前预览使用 `payload.expected` 的身份与版本，截图和浏览器断言均包含这三项。
2. 不可调度项目必须解释阻断原因。当前过期项目显示具体原因，保留「不可调度」选项标识，并禁用预览；桌面和手机均有对应截图与断言。

该 verdict 来自本次会话中的独立审阅交接，主线另存[review-verdict.json](review-verdict.json)；不能把它扩大为全应用、安装或恢复准入。此文档阶段只进行了源码核对与现有图片阅读，没有启动浏览器、服务、执行器或模型。

已保存的浏览器报告为 `PASS_PROPOSAL_HTTP_BROWSER`，8/8 PASS，`errors=[]`、`modelCalls=0`。覆盖：只读预览、确认只创建一个工作并导航、修订当前合同与明确新目标、决定与拒绝持久化、响应丢失后刷新沿用原命令且效果一次、拒绝回执结束未知重试、项目范围与缺项，以及过期项目的阻断说明。

此证据使用真实本地 HTTP、SQLite 与 A/C port 组合，启动模式为 fixture，未启动 runtime effects。它不证明原生执行、模型调用、自动结构化推理、恢复目标激活、安装升级或复核价值。文档阶段后主线另在空personal预览完成有界键盘/窄视口检查，见[preview-check.json](preview-check.json)：Enter打开、Tab不进入外部页面控件、Escape关闭及焦点返回、320px顶栏不重叠。浏览器chrome焦点边界按原生行为记录；辅助技术与全应用专项仍未测，该附加检查不扩大独立review verdict。

## 实际证据与来源限制

| 状态 | 桌面 1440×900 | 手机 390×844 |
| --- | --- | --- |
| 创建工作确认 | [desktop.png](/Users/hh/Desktop/joker/superagent/reports/releases/wave08-proposal-workbench/browser/desktop.png) | [mobile.png](/Users/hh/Desktop/joker/superagent/reports/releases/wave08-proposal-workbench/browser/mobile.png) |
| 修订目标与版本 | [desktop-revision.png](/Users/hh/Desktop/joker/superagent/reports/releases/wave08-proposal-workbench/browser/desktop-revision.png) | [mobile-revision.png](/Users/hh/Desktop/joker/superagent/reports/releases/wave08-proposal-workbench/browser/mobile-revision.png) |
| 过期项目阻断 | [desktop-blocked.png](/Users/hh/Desktop/joker/superagent/reports/releases/wave08-proposal-workbench/browser/desktop-blocked.png) | [mobile-blocked.png](/Users/hh/Desktop/joker/superagent/reports/releases/wave08-proposal-workbench/browser/mobile-blocked.png) |

- [browser-report.json](/Users/hh/Desktop/joker/superagent/reports/releases/wave08-proposal-workbench/browser/browser-report.json)：feature提交后于`2026-11-11T08:51:56.441Z`以--no-capture重跑，8项通过，sourceWorktreeClean=true。
- [proposal-workbench-browser.mjs](/Users/hh/Desktop/joker/superagent/tests/integration/proposal-workbench-browser.mjs)：实际 HTTP/SQLite 流程、截图尺寸、溢出与业务断言的来源。
- 截图拍摄基线为`e4402d3`的feature工作树，功能随后提交为`b436fde158a8dd14015c3705550bd3ff0d0fd307`；干净source功能重跑通过。透明背景清理保持先前透明回退的实际外观，未额外声称截图是在干净checkout重拍。文档阶段结束后的主线只更新来源说明与持久化verdict引用，没有改变设计体系或扩大审查范围。
