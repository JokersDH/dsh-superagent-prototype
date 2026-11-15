# F 包 wave-30 最终报告：完整模板交付、日常返回与准确交接

日期：2026-11-15 · 分支 `codex/g4-trial-experience` · 基线 main `6f385a54`（已合并，含 0076 窗口/0077 工作台），本包最终源码提交 `86aeaa20`（之后仅有文档/状态更新）。

## 四个完整结果

1. **当前项目到原交付（模板链路）**
   修复新 P2：声明的模板范围（如 `src/`）与服务端 preview 选择（如 `test/`）不一致时不再 applicable；选择必须同时落在项目 atoms 与声明范围内。展示的范围就是实际点击/交给 main 的 `allowedPaths`，不重建完整 scope/criteria。受限选择无法携带项目之外的追加排除项，因此现在明确拒绝而不是静默丢弃。
   实际链路已由 main 0077 接通：试用准备的真实 server-preview 建议 → 受限选择 → 原 NewWorkForm `initialRecipe` → 重新 preview/应用/编辑 goal → 明确创建 → 问题/检查/候选/人工接受，两个项目均通过（main `project-recipes-browser` 8/8）。

2. **日常 work/待决定/交付与 7/30**
   两项目 controlled fixture 完整走通委托/问题/回答/PASS/证据/人工接受；从“待我决定/工作与交付/交付详情”返回原工作后草稿仍在；整页重开后已交付工作与证据仍在且不重复，未发送的内存草稿不会被伪造。试用准备的观察区消费 main 真实 7/30 窗口：范围/来源/覆盖/partial/行样本/层/币种/未知逐项保留，窗口切换旧数字立即隐藏（main `usage-observation-browser` 9/9）。

3. **精密工作台与移动品质**
   采用 main 已整合的移动/观察布局，保留石墨/白/青绿与局部 `trial-*` token；恢复来源已知/未知与币种显示，保持紧凑行、固定控件尺寸、长中文/路径/错误换行；7/30 选中态用 `aria-pressed` 而不是 disabled 低对比；桌面 1440 与 390 窄屏、键盘、加载/错误/只读同批程序化审计。

4. **同一准确包与用户指南**
   指南更新为真实入口：项目导入、模板委托（声明→预览→原表单→确认）、集中回答、验证接受、7/30 观察、重开/只读与错误处理。准确包核对：D 候选 `1fbaf94`（`daee1a94…`，20,458,656 bytes）bundle 含“试用准备/使用观察/模板草稿”，但**不含“配方草案/打开原表单模板/30 天窗口”**，因此 wave30 入口的 installed 验收为 **NOT_REACHED**，未用旧包贴新功能。

## 证据

`node e2e/trial/run-all.mjs`：**10/10 套件 exit 0**——纯映射/项目内选择 20、hook 身份/异步 7、浏览器状态 31、真实 HTTP 6、真实 App 四目标 6、两项目导入/草稿 8、两项目委托/问答/证据/接受/重开/日常返回 7，加上两套 strict 与 build。视口 1440×900 / 390×844。

main 自有测试在本包改动后重跑：
- `trial-workbench-browser.mjs` **8/8**
- `usage-observation-browser.mjs` **9/9**（7/30 真实窗口、旧窗口隐藏、项目范围、late/503/404）
- `project-recipes-browser.mjs` **8/8**（试用建议打开原表单、两模板工作到原候选/人工接受、桌面手机）

## 未达与分层

- **source** 已交付；**controlled** 两项目 fixture 与 main 0076/0077 受控浏览器已实际运行；**installed** NOT_REACHED（D 1fbaf94 缺 wave30 入口）；**native/vendor/model** 0；**value/activation** 未涉及。
- 安装包/E 最终同包验收、非 Chromium、人工屏幕阅读器、200% 缩放/强制色彩、真实会话中途过期、人力节省/收益因果均未测。
- 本会话不能读图，视觉门是程序化几何/对比度/控件审计；截图供 E/人工复核。
- 受控日常流程仍有 2 次 main-owned `review-activity` 409 遥测冲突，不影响交付；未改 main。
- 只改五个自有路径（已核对）；未编辑 App/transport/根 CSS/contracts/HTTP；十二用户实例与 state/profile/tar/ledger 未触碰，临时根/端口已清理。

完整字段见 `wave30-status.json`。
