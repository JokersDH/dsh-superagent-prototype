# 帮助与交接材料

## 遇到问题时

先按 [问题处理](04-troubleshooting.zh-CN.md) 判断属于哪一类；不要用“重装/删除数据”解决所有问题。

上报时请提供：

1. 启动命令（去掉路径中的个人目录名也可）与终端打印的地址。
2. 页面：当前视图（主对话/工作与交付/待我决定/执行器连接/试用准备）、状态条文字、错误提示原文。
3. 时间与操作顺序：做了什么、预期什么、实际什么。
4. 是否只读恢复、是否固定流程、是否导入过项目。
5. 可复现步骤；如果涉及草稿丢失，说明切换了哪个项目/会话。

不要提供：

- `bootstrap.key`、`api.key`、模型 key、`model.json`、`.assistant-settings.json`；
- 数据库文件、原生 profile、`.local-state` 目录副本；
- 其他同事的会话、项目路径或截图中的凭据。

## 谁能处理什么

| 问题 | 归属 |
| --- | --- |
| 主对话、模型设置、项目导入、执行器目录、工作/问题/候选/来源审阅 | main（工作台组合与现有产品流程） |
| 试用准备的状态文字、动作派生、配方草案预览、观察区准入、本指南 | F（`apps/console/src/trial/`、`docs/user-guide/`） |
| 安装/升级/停止/迁移与包内诊断 | D 的分发指南；H 的独立只读 preflight（若交付包含） |
| 独立验收结论/失败断言 | E（product-acceptance） |
| 原生执行器、业务恢复、协调器恢复 | B 的范围；未准入时不要用固定流程替代 |
| 数据恢复/迁移内容核验 | A/C 的范围 |
| 项目任务/检查声明与只读草案数据 | J（`packages/project-recipes/`）；F 只做预览 |

F 不处理：安装命令、原生 profile 配置、数据库修复、恢复授权、真实模型计费、第二套设置页。

## 试用交班清单

- 分支：`codex/g4-trial-experience`；自有路径：`apps/console/src/trial/`、`test/trial/`、`e2e/trial/`、`docs/user-guide/`、`reports/trial-experience/`。
- 源码与范围：`reports/trial-experience/wave27-status.json`。
- 当前 App 接线：main `967dc0c`；F 的身份修复与四源原字节导入，入口为导航“试用准备”。
- 证据：`apps/console/e2e/trial/report-all.json` 及各 `report-*.json`、`screenshots/`。
- 未达依赖：J 草案与 G 指标尚未接入默认产品（对应段落不显示）、原生/安装包/E 最终验收不在 F 范围。

交接时只交源代码、文档和可复现证据，不交任何状态目录、凭据或用户数据。
