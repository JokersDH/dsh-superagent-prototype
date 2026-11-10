# 本机 Codex 开发工作台

当前默认入口已接入真实 Codex：确认项目与目标后，在独立 Git worktree 改代码、运行注册检查、审阅完整 patch 并接受当前交付。现有 macOS arm64/Codex 0.164.0 的实际后端与浏览器闭环通过；这是本机单执行器 MVP，完整 G2、其它原生分支和长期稳定性仍单独验收。

首次使用先看 [助手简介与使用指南](ASSISTANT-GUIDE.zh-CN.md)，工作台顶部帮助图标也可下载该指南。

## 启动

日常使用直接双击仓库根目录的 `start.command`，或从仓库根运行：

```sh
pnpm start
```

默认工作台：`http://127.0.0.1:5180`；产品 API：`http://127.0.0.1:8796`。工作台读取认证的 `/v1/configuration`，原生项目选择实际 Codex，固定测试项目只能选择 fixture。主对话网关与开发执行器认证分开，执行器使用本机既有 Codex 配置。启动本身不开始模型任务；确认委托才开始实际开发。

默认本机试用打开即用，无需输入令牌。启动会自动构建必要模块；已有实例运行时直接复用。首次取得仓库才需要先运行 `pnpm install --frozen-lockfile --ignore-scripts`。推荐 Node 24.22.2、pnpm 11.7.0。

双击 `stop.command` 或运行 `pnpm stop` 可关闭本工作台；修改后端代码后运行 `pnpm restart` 可重启。状态和产物会保留。

自动访问由此 loopback personal 入口显式开启，保留 Host、Origin、JSON 和服务端 actor 检查。普通 product API 仍严格认证，Runner 恢复仍使用私有凭据；需要手动登录时可用 `pnpm dev:workbench --require-login`。

端口占用时可指定另一组端口和私有状态目录：

```sh
pnpm dev:workbench --port 5181 --api-port 8797 --state /absolute/private/workbench-state
```

关闭浏览器页面不会终止后台工作。默认真实项目在 `~/.local/share/superagent-personal/projects/starter`，原生工作区在同一私有根的 `workspaces/`。导入项目和每项工作的实际路径可在工作台查看。CLI 管理服务；正式备份、发行和长期 soak 属于后续出口。

## 真实开发流程

选择已导入的项目，点击项目区域的设置图标，可修改名称、验收检查和离线缓存授权，查看设置历史，或归档/恢复项目。设置只作用于后续授权，已有任务保留原检查与环境；并发修改冲突时刷新核对。保存设置本身不会启动编码或安装依赖。

侧栏“对话”可搜索历史消息和标题，切换已有对话；每行图标可重命名或归档，勾选“包含归档”可找回并取消归档。有进行中任务或待办的归档对话仍会保留提示。新建对话和名称持久化，草稿仅在当前网页内按会话分别保留。

1. 使用默认开发项目，或导入干净且已有提交的 Git 根目录。
2. 在对话输入目标，点击“委托执行”，确认真实项目、Codex 和验收标准，再创建工作。
3. 查看执行状态和需要你决定的问题，等待注册检查。
4. 检查通过后查看原项目/工作区/基线、完整 patch 与证据，再接受当前候选。
5. 原项目保持不变；审阅下载的 patch 后由你集成。失败的机器检查不能用人工接受覆盖。

只测固定流程时显式使用 `pnpm dev:workbench --fixture --port 5181 --api-port 8797 --state /tmp/pa-fixture-workbench`。真实 MVP 不自动回退到 fixture；有依赖的项目目前需要先具备可用隔离环境，环境准备包由外部 A 继续推进。

## 复验

验证异常时，工作详情会显示原因；基础设施异常最多自动尝试三次，候选/环境失效则直接等待处理。恢复条件满足后可点击“重新检查”，仅运行当前合同已有的注册检查，不重新编码。已经产生的机器 FAIL 不能通过重新检查或人工接受覆盖；需要修改目标或实现时使用工作修订流程。关闭重开会保留故障与操作回执。

恢复接口和独立浏览器验收见 [验证恢复检查点](rfcs/WP-16/0014-verification-recovery-checkpoint.md)，运行 `pnpm check:verification-recovery` 可在自建隔离实例验证，无需操作当前用户服务，也不会调用模型。

```sh
pnpm check:g2-workbench
pnpm check:g2-browser
pnpm check:assistant-browser
```

第一条覆盖契约、确定性产品、项目导入、模型适配与工作台模块，并运行类型检查和构建；以 `g2-workbench.json` 的实际计数为准。第二条显式选择 fixture 项目/执行器，在独立会话验证 11 个受控流程场景。第三条使用实际 SDK/SQLite/HTTP/SSE 和临时本地模型 fixture 验证流式对话。它们不调用付费网关。

工作台已导入 A `8e302b4` 的配置驱动 console 检查点，并在主线增加对话优先布局、图标工具栏、Markdown、独立对话、模型设置及桌面/窄屏适配。它直接消费动态配置，不再依赖固定的执行器表单默认值。

原 A/B 的八项准入阻断已在本轮主线修复；旧报告保留历史结论。最新代码范围、原生证据与限制见 [MVP 集成](rfcs/WP-16/0008-native-mvp-integration.md) 和 `reports/releases/native-mvp/`。`pnpm check:native-product` 与 `pnpm check:native-browser` 是显式真实模型验收命令，日常 CI 不自动运行它们。
