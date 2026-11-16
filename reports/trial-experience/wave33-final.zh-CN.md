# F 包 wave-33 最终报告：三个完整工作台成果

日期：2026-11-16 · 分支 `codex/g4-trial-experience` · 基线 main `e05ee8d8`（合并后），main App `fc38bf65`，本包最终源码提交 `0ce1adcc`（之后仅有文档/状态更新）。

## 成果一：完整日常多项目工作流

- 同一真实 App 完成两项目委托→问题→回答→PASS→证据→人工接受；新增第三项机器 FAIL 工作与第四项待回答问题工作，验证 FAIL 不出现接受、未交付；待回答、已交付、已接受分属正确项目/会话，工作列表不串项目。
- 原草稿、项目/会话、返回原对象保持；重开后交付历史与证据仍在且不重复，未发送草稿不被伪造。
- 模板仍是受限 selection→main 原 server preview/apply/edit/confirmation；F 不重建创建 fields、不写业务命令。
- 实际 consumer：F `app-daily-flow` 9/9；main trial 8/8、templates 8/8、observation 13/13。

## 成果二：当前事实驱动的首次使用与错误恢复

- 无项目时项目区就地给出“导入项目”（复用原动作、accessible name 唯一）；缺模型/执行器由状态条+下一步分流；配置存在不等于执行准入。
- 配方 preview 失败在真实 App 显示 alert+“重试”，点击后恢复行且不产生业务命令；导出失败可就地重试；readiness 失败保留旧观察；旧服务/无 callback 精准降级。
- 实际 consumer：F `trial-states` 33/33（含空项目、recipe retry、export loading/error/no-export、support、mobile/keyboard）与 daily flow 的 recipe-retry 步骤；main 13/13 错误/旧接口路径。
- 负向：readonly 无导入/批准；blocked/expired/范围/排除拒绝；错项目/窗口/auth 不串；错误文案脱敏；无自动模型/执行。

## 成果三：历史、来源与支持的可访问日常体验

- 支持摘要新增“上下文历史/来源审阅入口是否提供”，与模式/启动方式/项目/对话/窗口/配置/观察时间/包/来源并列；折叠、键盘可开、无路径/凭据/命令。
- 导出继续明确点击、display-only、observedAt/scope/window/覆盖/未知；历史与来源正文仍由 main/A/C 原组件负责，F 不复制读取或授权。
- 真实 App 中从工作返回后可展开支持并回到草稿；1440/390、长中文/错误、控件尺寸审计通过。
- 实际 consumer：F `SUPPORT-PANEL`/`trial-states`、daily flow 支持切换；main 历史/来源消费者保持原状。

## 证据

`node e2e/trial/run-all.mjs`：**10/10 套件 exit 0**——纯映射 20、hook 异步 7、浏览器状态 33、真实 HTTP 6、App 目标 6、两项目 8、日常多工作/返回/重开 9，加 strict/build。main 自有：trial **8/8**、观察+导出 **13/13**、模板 **8/8**。受控流程仍有 2 次 main-owned review-activity 409 遥测冲突，不影响交付。

## 分层与未达

- **source** 已交付；前序六源已在 main，支持摘要历史/来源行等本轮小额 source 为候选待 main 再导入；**controlled** 已实际运行；**installed** 不由 F 自证（R1 829 仅 artifact/bundle 只读核对；current 包未安装）；**native** 0；**recovery/value** 不涉及。main 的 Node attachPort 不被当作 F 的授权或完整恢复证明。
- 未测：人工屏幕阅读器、非 Chromium、200% 缩放/强制色彩、真实长期 auth 过期、长浸泡、效率收益；历史/来源正文 UI 属 main/A/C，F 只报告入口可用性。
- 本会话不能读图，视觉门是程序化几何/对比度/控件审计；截图供 E/人工复核。
- 只改五个自有路径（已核对），未编辑 App/transport/根 CSS/contracts/HTTP；十二实例与全部 state/profile/tar/ledger/dirty/runs 保留，无 reset/清状态/新 checkout，临时根/端口清理，自动 vendor/model/native 0。

完整字段见 `wave33-status.json`。
