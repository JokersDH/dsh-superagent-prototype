# 受控工作台试用

这是可操作的受控预览：实际 HTTP、SQLite、子进程、原生提问、产物验证及接受交付均已接线。当前 profile 执行固定 scratch 操作，不调用模型，也不执行输入文本中的任意代码。独立 Runner 和真实 Codex/DSH/ZCode 尚未准入。

## 启动

推荐 Node 24.22.2、pnpm 11.7.0。从仓库根运行：

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm check:g2-workbench
pnpm dev:workbench
```

默认工作台：`http://127.0.0.1:5180`；产品 API：`http://127.0.0.1:8796`。启动器会先启动产品 API，再从认证的 `/v1/configuration` 读取受控 profile/check 默认值，随后启动工作台。它不重启已有 A/B 服务，不切换分支，不访问原生账号，也不调用模型。

首次登录令牌位于 `.local-state/workbench/bootstrap.key`。在页面登录框输入该文件的令牌即可。终端只显示私有文件位置，不显示令牌；不要将令牌、状态目录或本地数据库提交到 Git。

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
```

第一条覆盖现有 328 项契约/产品测试，加工作台 8 项模块测试及类型检查、构建。第二条需要已启动的工作台，使用 Playwright 覆盖 8 个实际浏览器场景，截图和报告保存在 `reports/releases/workbench-browser/`。

工作台源码按 A `a517635` 的 `apps/console/` 原样导入。当前启动器为该检查点提供从真实配置派生的环境参数；直接在 HTTP transport 中消费动态配置仍由 A 当前整包完成。窄屏发送按钮过窄等视觉收尾已列入集成交接。

本次未导入 A 的通用 workspace patch 候选和 B 的独立运行时。它们的新准入失败、修复责任和复现命令见 [候选准入交接](rfcs/WP-16/0005-candidate-admission-and-workbench.md)。
