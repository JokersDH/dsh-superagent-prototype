---
name: "个人 Agent 工作台"
description: "精密工作台：石墨导航、白色主对话、青绿点缀，任务阶段清晰可见。"
colors:
  accent: "#197764"
  accent-strong: "#135e4f"
  accent-soft: "#eaf4ed"
  ink: "#29312f"
  muted: "#69716d"
  line: "#e2e8e3"
  panel: "#fff"
  rail: "#272d2a"
  rail-ink: "#d1dfd5"
  sidebar: "#f7f8f7"
  surface-subtle: "#f5f7f5"
  ok: "#27764c"
  ok-soft: "#edf6ef"
  warn: "#8e5e20"
  warn-soft: "#fcf3e4"
  danger: "#ad4247"
  danger-soft: "#fcf0ef"
  process: "#456d8b"
  process-soft: "#edf3f8"
  badge: "#edf1ed"
  badge-ink: "#5a695e"
  focus: "#408f75"
typography:
  headline:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  empty-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "23px"
    fontWeight: 550
    lineHeight: 1.5
    letterSpacing: "0"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
  reading:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.85
    letterSpacing: "0"
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.6
    letterSpacing: "0"
  metadata:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Microsoft YaHei', sans-serif"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.65
    letterSpacing: "0"
  mono:
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "0"
rounded:
  flat: "0"
  code: "3px"
  badge: "4px"
  list: "5px"
  control: "6px"
  message: "7px"
  composer: "8px"
  dot: "50%"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  control: "14px"
  lg: "16px"
  section: "24px"
  reading-gutter: "28px"
  view-gutter: "32px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.panel}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-primary-hover:
    backgroundColor: "{colors.accent-strong}"
  button-quiet:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  button-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.control}"
    padding: "7px 12px"
  input-project:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.list}"
    padding: "7px 8px"
    width: "100%"
  navigation-rail:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    padding: "15px 6px 12px"
    width: "56px"
  chip-phase:
    backgroundColor: "{colors.badge}"
    textColor: "{colors.badge-ink}"
    typography: "{typography.metadata}"
    rounded: "{rounded.badge}"
    padding: "2px 6px"
  card-question:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "14px"
  work-stage-strip:
    backgroundColor: "#fafcf9"
    textColor: "{colors.ink}"
    rounded: "{rounded.flat}"
    padding: "8px 28px"
  composer:
    backgroundColor: "#fbfdfa"
    textColor: "{colors.ink}"
    rounded: "{rounded.composer}"
    padding: "13px 14px 11px"
---

# Design System: 个人 Agent 工作台

## Overview

**Creative North Star: "精密工作台"**

简洁、专业、精密，适合长时间工作。石墨导航构成稳定的操作边界，白色主对话提供阅读空间，青绿只在动作和选中状态中承担强调。界面以清晰层级、紧凑工具尺寸与可扫描状态建立辨识度。

整体采用平面布局，靠细分隔线、轻微底色和留白组织信息。任务身份、当前问题和工作阶段各有位置；细节按需展开，抽屉的阴影承担结构性的前后关系。

**Key Characteristics:**

- 石墨导航、白色阅读面与克制的青绿动作色。
- 固定字号、零字距、等宽数字与细分隔线。
- 平面分区、紧凑控件、按需展开的工作上下文。
- 任务身份与四阶段分行，琥珀提示当前待决定问题。

本文从已实现的 `src/App.tsx` 与样式提取。`src/main.tsx` 先加载 `src/styles.css`，再加载 `src/workbench.css`；后者及实际 CSS 级联是视觉依据。YAML 记录已复用的值，sidecar 补充阴影、动效、断点和组件片段，不生成生产样式。

## Colors

配色以冷静中性面为主体，青绿承载交互，少量状态色帮助扫描。

### Primary

- **青绿** (`accent`)：主要确认与发送动作、链接和输入光标。
- **深青绿** (`accent-strong`)：主要动作悬停态。
- **浅青绿** (`accent-soft`)：委托图标按钮的柔和底色，与主发送按钮形成等级。

### Secondary

- **完成绿** (`ok` / `ok-soft`)：已交付、检查通过和原生已应用。
- **问题琥珀** (`warn` / `warn-soft`)：待用户决定、验证中、权限与认证问题及本地已记录。
- **风险红** (`danger` / `danger-soft`)：停止中、不确定、离线、过期、检查失败和未测试结果。
- **执行蓝灰** (`process` / `process-soft`)：执行中、排队中、评估中与审阅类标签。

这些是语义状态色，不是第二套装饰强调色。每个标签同时保留中文状态文本。

### Neutral

- **石墨** (`rail`) 与 **浅石墨字** (`rail-ink`)：常驻导航边界及其前景基础。
- **正文墨色** (`ink`) 与 **辅助灰** (`muted`)：正文、标题和上下文的主次关系。
- **白色面** (`panel`)：主对话、输入和问题项；**冷浅灰侧栏** (`sidebar`) 区分项目导航。
- **浅底** (`surface-subtle`)：用户消息、代码、选项组与小型图标容器。
- **细线** (`line`)：布局分区、字段和重复项的边界。
- **中性标签** (`badge` / `badge-ink`)：无额外语义的计数及状态底色。
- **焦点青绿** (`focus`)：可见键盘焦点轮廓。

**The Semantic Color Rule.** 状态色必须与状态文字一起使用；青绿强调明确动作，琥珀标记需要注意的问题。

## Typography

**Body Font:** 本地 Inter 可变字体，回退到系统界面字体和中文字体。字体文件为 `/fonts/InterVariable.woff2`，许可保存在 `public/fonts/Inter-LICENSE.txt`；使用 `font-display: swap`。

**Label/Mono Font:** 代码与技术标识使用 YAML 中的等宽字体栈。全局启用等宽数字，禁止合成字体样式。

**Character:** 同一无衬线体系承担阅读和操作，依靠字号、字重、行距和位置区分层级。标题保持紧凑，正文给足行距；没有独立的展示大字体系。

### Hierarchy

- **Headline**：目录视图标题；移动端固定降为 19px。
- **Empty Title**：空对话标题；移动端固定降为 22px。
- **Title**：主对话标题；详情标题采用相同字号和字重，行距为 1.65。
- **Body**：基础操作正文；对话使用 Reading 角色，移动端固定为 14px，行距保持 1.85。
- **Label / Metadata**：控件文字与状态、辅助信息。局部密集元数据使用 10px，不提升为正文角色。
- **Mono**：代码内容与路径；长路径允许换行，代码块在自身范围横向滚动。

**The Fixed Type Rule.** 字号使用固定值和明确断点，不使用视口单位缩放。全部字距为零；移动输入框使用 16px 字号。

## Layout

应用填满 `100dvh`。桌面采用 52px 顶栏、56px 石墨导航、232px 项目侧栏和可伸缩主区域；打开详情时增加 350px 右侧上下文。区域之间无外层卡片间隙，主要通过一像素细线分隔。

对话阅读宽度上限为 760px，居中保留至少 Reading Gutter 的水平留白。助手内容平铺，用户消息靠右且宽度上限为 88%；移动端上限为 94%。消息列表独立滚动，输入器留在对话底部，其最大宽度与阅读区一致。目录与详情各自滚动，不让长内容扩大整体画布。

间距按用途复用 YAML 中的尺度；界面也保留实际组件需要的非等差间距，不强行套统一四倍数网格。普通视图使用 View Gutter；详情分区以 Section 间距和细线组织。

- **1220px 及以下**：侧栏改为 216px，右侧详情变为覆盖抽屉；主对话不再为详情保留一列。
- **960px 及以下**：项目列为 202px；顶栏上下文隐藏，对话水平留白收紧。
- **720px 及以下**：只保留主区域；导航变为 56px 高的底栏并计入安全区。项目与详情分别成为抽屉，显示互斥；项目抽屉最多 292px，详情最多 350px，宽度均受屏幕约束。可见关闭按钮、背景遮罩和 Escape 提供关闭入口。

**The Stable Geometry Rule.** 图标按钮、导航格、发送与委托按钮保持固定尺寸；长标题截断或换行，不能推挤相邻状态与操作。

## Elevation & Depth

默认平面。主对话、目录、侧栏和详情分区使用底色与边线建立层次，不添加装饰阴影。输入器聚焦时改变边线与底色，按钮通过颜色反馈状态。

### Shadow Vocabulary

- **中宽视口详情抽屉**：`-12px 0 34px rgb(34 51 38 / 10%)`。
- **移动项目抽屉**：`10px 0 30px rgb(34 51 38 / 12%)`。
- **移动详情抽屉**：`-10px 0 30px rgb(34 51 38 / 12%)`。

**The Structural Shadow Rule.** 阴影只表达覆盖抽屉与底层画面的关系；常驻内容保持平面。

## Shapes

主区域、目录行和详情分区使用平直边界。小圆角按角色变化：代码与小计数、标签、列表选择态、标准控件、用户消息和输入器使用 YAML 中对应的 Rounded 值。常规控件为轻微圆角，消息和输入器最多为 Composer 圆角；圆形只用于状态点和阶段点。

细边线采用实线。工作行以底部细线分隔，选中项目与工作使用轻微底色。问题是需要独立边界的重复项，保留描边和内边距；详情中的普通分区不再套卡片。

## Components

### Buttons

克制、紧凑，动作等级由填色表达。主要按钮使用青绿底与白字，基础最小高度为 34px；次要按钮使用白底细边线，危险按钮使用浅风险底与风险文字。悬停只改变色彩，不移动或放大控件。

图标工具默认透明、辅助灰前景，桌面常规尺寸为 32px 方形。发送与委托是并列的固定 34px 方形，移动端为 32px；发送使用实色，委托使用浅青绿底。图标来自 lucide，按钮具有名称与提示。

颜色状态过渡为 150ms ease。键盘焦点使用两像素焦点色轮廓与三像素外偏移；禁用按钮降低透明度并显示禁用指针。

### Chips

标签紧凑而非药丸形。阶段、类型、结果与投递状态共用轻圆角结构，语义颜色按 Colors 分配。中性阶段标签使用 Metadata 角色与 Chip Phase 内边距；侧栏内标签进一步收紧为 10px。

项目筛选是整行列表按钮，包含图标和文字，选中态使用浅绿底。它与只读状态标签的用途和形状分开。

### Cards / Containers

问题项使用白底、细描边、Control 圆角和 Control 内边距，标题固定为 13px、550 字重与 1.7 行距。选项、答案与投递状态按顺序排列，问题技术身份通过展开内容呈现。

普通详情分区与目录为无边框平面布局，分区间以细线隔开。登录框和输入器是具有明确边界的工具容器，使用 Composer 圆角；不把整页区块制成浮起卡片。

### Inputs / Fields

字段使用白底细边线、墨色文字与青绿光标。项目及新委托字段采用 List 圆角，最小高度为 34px；移动端提高到 38px。禁用态使用浅底，仍保留可读文本。

对话输入器以一层边界包住草稿和操作行；文本框本身无描边、阴影与额外圆角。聚焦由外层边线变化反馈。输入器正文桌面为 14px，移动端固定为 16px；高度允许有限纵向调整。搜索字段的焦点反馈由外层承担。

### Navigation

石墨导航采用等尺寸图标格，浅绿选中底与深绿图标表达当前位置。悬停保持在同一格内；待决定计数附着于对应图标。桌面项目导航为冷浅灰平面列表，当前对话、项目和工作各有清楚层级。

移动端图标导航保持在底部；打开项目抽屉时隐藏详情，打开详情时关闭项目抽屉。关闭入口保持在抽屉顶部，背景遮罩不覆盖顶栏和底栏。

### Work Stage Strip

当前工作阶段条是签名组件。第一行提供可打开详情的任务身份，并在有问题时显示独立的琥珀待决定按钮；第二行固定表达“已委托、执行、验证、交付”。任务名允许截断，待决定入口保持完整，阶段行可在自身范围横向滚动。

当前阶段用浅绿底和更高字重，已完成阶段以实心绿点及勾号区分。停止、不确定和结束等状态保留明确文字，不强行显示为正常推进。阶段由当前工作投影驱动；阶段条本身不是新的进度计算器。

### Motion

动效局限于颜色过渡与流式回复光标。光标按 1s、`steps(2)` 闪烁；遵循 `prefers-reduced-motion: reduce`，关闭动画和过渡，不引入额外运动。

## Do's and Don'ts

### Do:

- **Do** 使用现有 CSS 变量和语义状态文字，保持青绿动作、琥珀问题、风险红与完成绿的区别。
- **Do** 使用固定字号、零字距和明确断点；让长中文、任务标题与路径在自己的区域内处理溢出。
- **Do** 保持平面分区和紧凑工具尺寸，给主对话稳定的阅读宽度。
- **Do** 将任务身份、待决定入口与四阶段分行，并保持移动抽屉互斥。
- **Do** 保留可见焦点、图标名称、关闭入口和减少动态效果的支持。

### Don't:

- **Don't** 将普通页面分区包成浮起卡片，或把抽屉阴影扩展为装饰效果。
- **Don't** 用视口字号、非零字距、超大展示标题或装饰图形改变当前工作界面。
- **Don't** 单靠颜色表达状态，或将风险和未测试状态显示为完成。
- **Don't** 让动态文本改变图标格、发送按钮或导航的尺寸。
- **Don't** 把 fixture 计数、阶段示例或未接入能力当作产品已完成的事实。
