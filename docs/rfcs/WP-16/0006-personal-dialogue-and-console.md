# 个人对话与工作台交接

日期：2026-11-09。分支：`codex/g2-execution-integration`。源码提交：`029a0bcd7ceeb67431ed03f520e9523014d6c598`；主线基线：`8acccbc6ca9679d08a320bb3aacc5c55700a1917`。本次是用户要求的使用简介、界面改进与真实模型对话，不升级 native/G1/G2 准入结论。

## 范围与来源

先导入 A `8e302b4` 的 `apps/console/`、WP-11 文档检查点（实现 `0bd8d15`），再在主 checkout 上改进界面和接入模型。A 随附截图/报告保留为原检查点证据；本次主线证据位于 `reports/releases/`。没有改动 A/B 工作目录，没有接入它们尚未通过的 workspace/runtime 候选。

拥有路径：主线 `packages/contracts/`、`packages/application/`、`apps/coordinator/`、根依赖与锁、集成测试和工具；本轮用户直接要求的 `apps/console/` 界面改进及相应指南。保留上游 MIT 归属；不提交本机凭据、数据库或原生账号目录。

## 实现边界

- 主对话通过 OpenAI 兼容 SDK 单次 completion 获取文本；不自建 Agent/tool loop。讨论和工作委托分开；模型回复不能创建 Work、调用终端或写仓库。
- `ApplicationService.chat` 同事务写用户消息、effect 与 command receipt；仅无工作 anchor 的对话排模型 effect。既有当前工作补充路径仍交给 core。
- 模型 effect 先提交稳定的请求意图，后发网络请求。已保存回复可重放；不确定请求不会再次调用模型，转为系统通知。SDK 自动重试关闭，网络超时 45 秒，拒绝重定向。
- 上下文按对话和项目过滤，只取当前及更早用户输入，并按来源关联已有回复；最多 20 条、24000 字符，单条最多 6000 字符。网络及私有配置读写均在数据库事务外。
- 密钥位于仓库外的 `~/.config/superagent-personal/model.json`；文件 600、目录 700。状态 DTO 不含 key、私有配置路径或原生账号数据。模型切换仅允许配置白名单，原子保存并保留 key。
- `GET /v1/assistant`、`POST /v1/assistant/model`、`GET /v1/guide` 继承本机认证及 Origin/Host 边界。浏览器不能提交 key 或任意网关。新增 assistant JSON Schema 有独立身份，原运行时协议哈希不变。
- UI 使用 Lucide、React Markdown、GFM；外部图片替换为链接，不加载远程图片。主对话居中，侧栏工作列表与按需详情，模型设置独立显示；窄屏使用抽屉。新对话以 URL ID 持久定位，刷新/后退可恢复。

## 验收

目标环境为 Node 24.22.2、pnpm 11.7.0、darwin/arm64。

| 命令或证据 | 结果 | 实际范围 |
| --- | --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | PASS | manifests 与 authoritative root lock 一致 |
| `pnpm check:g2-workbench` | PASS，350 项 | 188 contracts + 95 application/recovery + 30 workspace/verification + 14 controlled product + 5 configuration + 10 assistant + 8 console；含类型检查与构建 |
| `pnpm check:g2-browser` | PASS，11 场景 | 本机自动访问、真实受控提问/回答/检查/产物/接受/刷新、失败拒交付、响应布局、安全模型设置、指南、新对话刷新 |
| 实际网关 `/models` 与最小 completion | PASS，人工 smoke | 认证成功、返回实际模型 ID、实际文本回复；不是 native coding 证明 |
| 工作台真实模型对话 | PASS，人工 smoke | 用户输入经 durable effect 到模型；真实中文 Markdown 回复保存；服务重启及网页刷新后仍有 2 条消息、1 条模型回复 |
| 1440×960 与 390×844 截图 | PASS，人工视觉检查 | 对话和模型设置无横向溢出，发送按钮不竖排，抽屉关闭正常；测试后已恢复 viewport |
| 实际 key 扫描 | PASS，0 匹配 | Git 跟踪及非忽略待提交文件，加前端 dist；扫描输出仅计数/路径，不输出 key |

可重复测试均使用本地 mock 模型服务，不产生供应商请求。真实模型 smoke 使用用户授权的网关与最小普通提示词，没有读取或上传仓库文件。证据：`reports/releases/g2-product.json`、`g2-workbench.json`、`workbench-browser/report.json`、`assistant-ui/report.json` 及同目录截图。

## 当前限制

默认模型为网关实际 ID `DeepSeek-V4.1-Flash-1017`，同时配置 GLM-5.3 和 GLM-5.3-Flash。只有默认 DeepSeek 模型完成真实 completion；GLM 列表来自实际 `/models`，未逐一运行付费 completion。网关使用 HTTP，key 和对话传输不加密；HTTPS 探测未成功。

本轮不提供流式输出、自动仓库读取、终端工具或长期记忆。对话入口支持新建及 URL/浏览器历史恢复，完整历史列表后续实现。跨 session 子团队、Codex/ZCode/DSH 原生执行、通用 patch、新文件交付和独立 Runner 恢复仍按原准入任务验证。

## 后续消费

用户：双击 `start.command` 或 `pnpm start`，打开 `http://127.0.0.1:5180/`，点“新对话”；顶部模型名称/设置按钮切换模型，帮助图标下载指南。模型配置在本机准备，无需在网页粘贴 key。

A：合并最新 `origin/main` 后，以已集成动态配置和新视觉布局继续 console；自己的旧截图仅是历史检查点，不覆盖主线界面。保留原有受控动作、配置失效和草稿行为。

B：按原 native/runtime 准入任务继续。模型文本回复不会构成 Runner、Driver、writer 停止或可信完成证据。当前任务范围和八项阻断仍见 `0005-candidate-admission-and-workbench.md`。

主线：新增供应商优先使用同一兼容 SDK/私有模型配置；真正引入 coding runtime 必须经过 execution/Driver/Catalog 的独立准入，不在对话 handler 里加入 shell 或临时工具循环。
