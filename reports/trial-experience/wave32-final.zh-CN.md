# F 包 wave-32 最终报告：同事第一次就看得懂的工作台

日期：2026-11-16 · 分支 `codex/g4-trial-experience` · 基线 main `58b4e4c8`（已合并，含 0080 导出、0076/0077、打包源），本包最终源码提交在 `wave32-status.json` 记录。

## 整块结果

在现有精密浅色工作台内完成首次使用、执行器/模型状态、项目选择、模板到原表单、待决定/候选、返回原工作/草稿、委托到交付与错误恢复的完整体验；不新增第二导航、营销页或权限。

### 本轮真实改动

1. **首次使用空状态**：无项目时项目区直接给出“导入项目”，复用原 `onAction('import_project')`；使用唯一 accessible name，避免与上方向导在真实 App 中的名称冲突。
2. **配方错误恢复**：新增可选 `onReloadRecipes`；错误从普通文字变为 alert + “重试”，只让 main 重新读取，不直接发 HTTP；main 未传时只说明、不显示重试（准确降级）。
3. **导出状态**：明确点击、展示-only 说明、下载中禁用并显示“正在导出…”，失败“导出未完成”可就地重试，旧包无按钮；组件自身不发请求。
4. **支持与诊断**：折叠只读摘要（模式/启动方式/项目/对话/窗口/配置/观察时间/包/来源），键盘可开、无路径/凭据/命令、缺标签写“未提供/未声明”。
5. **可理解性**：observedAt/当前范围、讨论与执行分离、blocked/unknown/readonly 语义、模板声明与选择范围一致、排除项保留规则继续有效。
6. **移动/键盘/错误**：390 与 1440、长文本、空/loading/error/readonly、焦点与控件尺寸同批审计；新增状态纳入 mobile 审计。

## 实际 consumer

- main 真实 App：trial **8/8**、观察+导出 **13/13**、模板 **8/8**，在本包改动后重跑通过。
- F owned：`run-all` **10/10**（纯映射 20、hook 异步 7、浏览器状态 33、HTTP 6、App 目标 6、两项目 8、日常委托/问答/证据/接受/返回/重开 7，加 strict/build）。
- 两项目 controlled fixture 完成委托→问题→回答→PASS→证据→人工接受；待决定/工作/交付返回原对象；重开保留交付历史、不伪造草稿。

## 正确性正负

正向：空项目内联导入→原表单；缺模型/执行器正确分派；模板选择→原表单 preview/apply/edit/confirm；导出显式点击；支持摘要键盘打开。

负向：readonly 不出现导入/批准；blocked/expired/排除/声明与预览范围不一致拒绝；recipe/export/readiness 失败有界恢复；迟到/旧身份不覆盖当前；重开不伪造未发送草稿；无隐式模型/执行。

## 分层与未达

- **source** 已交付并进入 main 当前 source；**controlled** 已实际运行；**installed** 由 E 对准确包验证——R1 829 仅做 artifact/bundle 只读核对，当前个人预览打包源 `b72e935d` 未由 F 安装；**native** 0；**recovery/value** 不涉及。
- `onReloadRecipes` 仍是可选候选接线（main 未传时重试隐藏）。
- 未测：真实长期 auth 过期、人工屏幕阅读器、非 Chromium、200% 缩放/强制色彩、长浸泡、效率收益。
- 本会话不能读图，视觉门是程序化几何/对比度/控件审计；截图供 E/人工复核。
- 受控流程仍有 2 次 main-owned review-activity 409 遥测冲突，不影响交付；未改 main。

## 资源与所有权

只改 `apps/console/src/trial/`、`test/trial/`、`e2e/trial/`、`docs/user-guide/`、`reports/trial-experience/`；未编辑 App/transport/根 CSS/contracts/HTTP/授权。十二用户实例与全部 state/profile/tar/ledger/dirty/runs 保留；无 reset/清状态/新 checkout，临时根与端口已清理；自动 vendor/model/native 0。

完整字段见 `wave32-status.json`。
