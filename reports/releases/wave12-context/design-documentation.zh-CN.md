# 上下文历史扩展：设计文档核对

日期：2026-11-12。角色：Impeccable documenter。模式：Operate，沿用“精密工作台”。

## 结论

此次历史与冻结来源阅读属于既有界面的普通扩展，没有新的视觉世界、共享 token 或品牌决定需要写入设计系统。`apps/console/DESIGN.md`、`.impeccable/design.json`、`PRODUCT.md` 和既有 surface brief 均保留原文；本报告是唯一新增文件。历史双列、手机列表/详情互斥和来源正文的渐进展开是本次界面行为，不提升为所有页面都必须遵守的系统规则。

## 核对的源码与文档

源码依据为 `eea5fa25a6df9bf921e3be3a57bb77d539194abd`。本次使用 `git diff eea5fa2 -- <以下五个实现文件及四个既有设计文件>` 核对，输出为空。

| 文件 | 本次实际检查内容 |
| --- | --- |
| `apps/console/src/ContextHistory.tsx` | 全文；项目/工作/会话范围、分页、选择态、原会话入口、手机返回与焦点恢复、loading/empty/error/stale 状态 |
| `apps/console/src/ContextSources.tsx` | 全文；来源身份、可读正文、复制、摘要/原始记录展开、缺失/未核对/范围变化/截断/遗漏提示 |
| `apps/console/src/ContextWorkspace.tsx` | 全文；现有原生 dialog、标题关联、关闭、预览/记录 tabs、键盘切换、发送/原请求核对与历史入口的组合 |
| `apps/console/src/context.css` | 全文；变量引用、固定字号、细线、列表/正文层次、长文本换行、720px 响应式切换 |
| `apps/console/src/App.tsx` | 定向采样；工具入口、ContextWorkspace 挂载与原会话导航、消息内 ContextSourceRecord 消费 |
| `apps/console/src/main.tsx` | 样式加载顺序：styles、workbench、功能样式、context |
| `apps/console/src/workbench.css` | 全局变量/字体/控件/焦点与既有 project-settings-dialog；并读取 `2e7db89` 版本确认旧字号和弹窗阴影已存在 |
| `apps/console/src/styles.css` | 旧基础样式定向检索；实际颜色、字体和字距以随后加载的 workbench 级联为准 |
| `apps/console/DESIGN.md` | 全文；YAML token、八段规范、四条 named rules、固定字号、平面容器、lucide 与移动约定 |
| `apps/console/.impeccable/design.json` | 颜色/字号元数据、阴影、动效、断点、组件映射与 narrative；未改写或重新生成 |
| `apps/console/PRODUCT.md` | 全文；主对话优先、明确授权、按需展开和准确能力状态 |
| `apps/console/.impeccable/surfaces/src-app-tsx.md` | 全文；THESIS、OWN-WORLD、STORY、FIRST VIEWPORT、FORM 与原选定方向 `d7807279` |
| `reports/releases/wave12-context/quality-bar.zh-CN.md` | 全文；现有实现校准、普通扩展边界和截图用途 |

操作规范读取了 `/Users/hh/.codex/skills/impeccable/agents/impeccable_documenter.toml` 与 `reference/document.md` 全文。未运行 init，也未重建设计系统。

## 核对的视觉与浏览器证据

逐张打开并目视检查：

- `reports/releases/wave12-context/history-final/desktop.png`，1440×900：历史列表与原始上下文并列；选中项使用既有浅青绿，来源项以细线区分，原始 JSON/摘要不占默认正文。
- `reports/releases/wave12-context/history-final/mobile.png`，390×844：筛选纵向排列，详情单独显示并保留返回箭头与关闭入口；当前截图中的长中文在正文区域内换行。
- `reports/releases/wave12-integration/context-browser-final/desktop-source.png` 与 `mobile-source.png`：作为既有上下文工具基准，核对相同的白色工具容器、遮罩、细线、字色、圆角和工作台背景；本次没有替换视觉体系。

读取 `reports/releases/wave12-context/history-final/browser-report.json`：记录 source `eea5fa2`、schema18、8/8 PASS，包含真实 A18 分页、冻结正文、桌面/手机返回、范围切换/重试、过期 cursor、模型关闭时审计、原会话导航、readonly 与 tabs 键盘状态。记录的真实模型/native turn 均为0，读取触发 mock reply 为0。此处引用已有浏览器报告，本 documenter 未重新运行浏览器、服务、模型或 native。

截图只能证明所拍状态的外观；动态行为依据上述源码和已有浏览器报告。它们是测试证据，不是产品内 shipping raster，没有新增产品图像资产或对应的新素材 provenance 条目。

## 五行系统摘要

1. 配色：石墨导航、白色阅读面、冷中性边线；沿用 `accent` 青绿动作与 `accent-soft` 选择态，琥珀/风险色配合真实状态文字。
2. 字体：沿用本地 Inter 与中文回退、等宽技术标识；固定字号、零字距，手机字段固定16px；遵循 The Fixed Type Rule。
3. 布局：主对话继续为底层主屏，来源工具按需打开；本次桌面双列、720px 内单详情，长中文在自身区域换行；沿用 The Stable Geometry Rule。
4. 形状与深度：列表、正文和来源分区平铺，细线分隔；工具容器复用既有8px边界，未增加嵌套装饰卡片或装饰性图形；以 The Structural Shadow Rule 为既有规范。
5. 控件与语义：原生 select/checkbox/details、tabs 与 lucide 图标工具共用既有样式；名称、选择态、可见焦点和可重读状态保留，沿用 The Semantic Color Rule。

## 未固化或修复的既有差异

`design-detector.json` 共12条，全部为 `design-system-font-size` advisory，涉及13px、10px、16px。机器字号表没有这些独立键；但既有 DESIGN 正文已说明密集10px和手机16px，workbench 的旧实现也已使用13px标题、10px元数据与16px手机字段。因此不通过补 token 或缩改正文来消除 advisory，也不把局部字号当成新获准的共享字号阶梯。

另有既有文档覆盖差异：`project-settings-dialog` 在 `2e7db89` 已使用 `0 18px 70px #17251e26` 阴影；本次工具继承它，而 DESIGN/sidecar 的阴影清单仅列覆盖抽屉。本报告记录该差异，不把它推广为所有容器的阴影规则，也不在普通扩展中修补旧规范。

本次无需为扩展修改既有系统文档。上述差异保留为后续明确设计系统维护的输入。本报告不提供 finish 分数或替代独立 reviewer 对三项修复的裁定，也不将已有 HTTP/SQLite/React/mock-provider 证据扩大为 native 或安装验收。
