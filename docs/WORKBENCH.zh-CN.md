# 个人助理工作台试用

这是可操作的本机预览：主对话已接入真实模型，实际 HTTP、SQLite、子进程、原生提问、产物验证及接受交付均已接线。工作 profile 仍执行固定 scratch 操作，不执行输入文本中的任意代码。独立 Runner 和真实 Codex/DSH/ZCode 尚未准入。

首次使用先看 [助手简介与使用指南](ASSISTANT-GUIDE.zh-CN.md)，工作台顶部帮助图标也可下载该指南。

## 启动

日常使用直接双击仓库根目录的 `start.command`，或从仓库根运行：

```sh
pnpm start
```

默认工作台：`http://127.0.0.1:5180`；产品 API：`http://127.0.0.1:8796`。启动器会先启动产品 API，工作台从认证的 `/v1/configuration` 读取项目、profile 和验收默认值。它不重启已有 A/B 服务，不切换分支，不访问原生账号。主对话只有在你发送消息且本机模型已配置时才请求模型；启动和受控工作本身不调用模型。

默认本机试用打开即用，无需输入令牌。启动会自动构建必要模块；已有实例运行时直接复用。首次取得仓库才需要先运行 `pnpm install --frozen-lockfile --ignore-scripts`。推荐 Node 24.22.2、pnpm 11.7.0。

双击 `stop.command` 或运行 `pnpm stop` 可关闭本工作台；修改后端代码后运行 `pnpm restart` 可重启。状态和产物会保留。

自动访问只由此 loopback fixture 启动器显式开启，保留 Host、Origin、JSON 和服务端 actor 检查。普通 API 与 Runner 恢复认证不变；需要手动登录时可用 `pnpm dev:workbench --require-login`。

端口占用时可指定另一组端口和私有状态目录：

```sh
pnpm dev:workbench --port 5181 --api-port 8797 --state /absolute/private/workbench-state
```

在启动器终端按 Ctrl+C 会关闭它自己的 API 和 Vite 进程。关闭浏览器页面不会终止后台工作。当前 scratch 项目在 `/tmp/pa-project-*`，其引用在私有状态目录中；本入口用于开发验收，不是正式 daemon/备份/发行方案。

## 试用流程

1. 新建委托，默认选择 `profile-fixture-question`。
2. 在主入口回答真实子进程提出的权限问题。
3. 等待已注册检查完成，查看清单、patch、输出和检查证据。
4. 接受当前候选后，工作显示已交付；刷新仍保留产物。
5. 选择 `profile-fixture-fail` 可验证机器检查失败时不允许接受交付。

这些是固定 fixture 的真实数据流验收，不代表模型理解或通用自动开发能力已完成。

## 复验

```sh
pnpm check:g2-workbench
pnpm check:g2-browser
pnpm check:assistant-browser
```

第一条覆盖 350 项契约/产品/模型适配测试，加工作台 8 项模块测试及类型检查、构建。模型测试使用本地 mock SDK 服务，不产生模型费用。第二条在独立会话中验证受控工作流的 11 个浏览器场景，截图和报告保存在 `reports/releases/workbench-browser/`；不会写入默认个人对话。第三条使用临时 SQLite、实际 SDK/HTTP/SSE 与本地模型 fixture 验证流式展示、刷新不重发、导出和对话隔离，证据在 `reports/releases/assistant-streaming/`。两条浏览器检查均需要工作台前端已启动，不调用付费网关。

工作台已导入 A `8e302b4` 的配置驱动 console 检查点，并在主线增加对话优先布局、图标工具栏、Markdown、独立对话、模型设置及桌面/窄屏适配。它直接消费动态配置，不再依赖固定的执行器表单默认值。

本次未导入 A 的通用 workspace patch 候选和 B 的独立运行时。它们的新准入失败、修复责任和复现命令见 [候选准入交接](rfcs/WP-16/0005-candidate-admission-and-workbench.md)。
