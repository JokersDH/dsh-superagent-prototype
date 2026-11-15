# F 包 wave-31 最终报告：三包十二成果（R1 固定包、R2 导出、长用支持）

日期：2026-11-15 · 分支 `codex/g4-trial-experience` · 基线 main `8deda18d`（已合并，含 0080 导出与 runner 通道），本包最终源码提交 `5832cb8f`（之后仅有文档/状态更新）。

## 交付包一：R1 固定准确包的日常工作台（4 成果）

R1 身份已锁定并只读核对：source `82ee5b8f…`、build `8296720d8a25f38c`、tar `04926739…`、20,458,670 bytes / 6,849 entries。bundle 含“试用准备/使用观察/观察窗口[7,30]/配方草案/打开原表单模板/模板草稿”，**不含 `/insights/export` 或导出按钮**。因此 R1 的导出按旧包能力隐藏，观察行仍可读；R1 安装/用户流由 E 独立验，F 未启动实例。

- R1.1：组件对旧包无导出回调时准确降级，支持摘要不伪造包标签；显示 observedAt/当前范围。
- R1.2：两项目受控日常（委托/问题/回答/PASS/证据/人工接受/重开）在真实 App 通过，草稿与项目归属不串。
- R1.3：模板声明范围与受限选择范围一致；blocked/expired/排除/追加排除/预览越界均拒绝。
- R1.4：桌面/手机/键盘/错误集中验证；RC 观测与 source 修复分开。

## 交付包二：R2 当前 source 的导出与完整工作台（4 成果）

- R2.1 导出入口：明确点击才导出；重新读取当前项目/窗口新快照；显示“正在导出…”；失败“导出未完成”可就地重试；旧包无按钮；文件仅展示数据。
- R2.2 页面/文档一致：显示 observedAt/scope/window/coverage/来源/未知/行样本/层/币种；7/30 切换旧窗口立即隐藏；不把导出文件当收益证明。
- R2.3 连续工作：真实 server preview 模板→受限选择→原 NewWorkForm 预填/编辑/明确创建→问题/检查/候选/人工接受；历史/来源/观察可连续切换。
- R2.4 无障碍与 successor：导出/支持/模板控件键盘可达、390 无溢出；R2 的 successor tar 未出现在 `wave31-target`，installed 验收 **NOT_REACHED**，只记 source/controlled。

## 交付包三：长用、同事支持与指南（4 成果）

- R3.1 长用身份：两项目/两会话/多工作、关闭重开、待决定/工作/交付返回；应用内草稿保留，整页重开不伪造草稿，迟到响应不覆盖当前身份。
- R3.2 支持与诊断：新增只读 `<details>` 摘要（模式/启动方式/项目/对话/窗口/配置/观察时间/包/来源），默认折叠、键盘可开、不含路径/凭据/命令；缺少包/来源标签显示“未提供/未声明”。
- R3.3 指南：六章更新到真实入口（模板、7/30、导出、支持、只读/未知、错误恢复），明确 R1 无导出、R2 source 有导出。
- R3.4 交接：9 个运行源文件（新增 `support.ts`）、typed props/callback、禁止打包目录、R1/R2/installed/native 分层与剩余门槛。

## 证据

`node e2e/trial/run-all.mjs`：**10/10 套件 exit 0**——纯映射 20、hook 身份/异步 7、浏览器状态 33、真实 HTTP 6、真实 App 四目标 6、两项目 8、日常委托/问答/证据/接受/返回/重开 7，加上两套 strict 与 build。

main 自有测试在本包改动后重跑：trial App **8/8**、观察+导出 **13/13**（7/30、项目范围、late/503/404、下载）、模板 **8/8**。受控流程仍有 2 次 main-owned `review-activity` 409 遥测冲突，不影响交付；未改 main。

## 分层与未达

- **source** 已交付；**controlled** 两项目 fixture 与 main 受控浏览器已实际运行；**R1** 只做 artifact/bundle 只读核对，installed 用户流 E-owned；**R2 installed** NOT_REACHED（无 successor tar）；**native/vendor/model** 0；**value/activation** 未涉及。
- 未测：非 Chromium、人工屏幕阅读器、200% 缩放/强制色彩、真实长期 auth 过期、48h/长浸泡、效率收益。
- 本会话不能读图，视觉门是程序化几何/对比度/控件审计；截图供 E/人工复核。
- 只改五个自有路径（已核对），未编辑 App/transport/根 CSS/contracts/HTTP；十二用户实例与 state/profile/tar/ledger 未触碰，临时根/端口清理，无 reset/清状态/新 checkout。

完整字段见 `wave31-status.json`，RC 基线见 `wave31-rc-baseline.zh-CN.md`。
