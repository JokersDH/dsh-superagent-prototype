# Agent E：独立产品、UI 与安装迁移验收

工作目录 `/Users/hh/Desktop/joker/superagent-agent-e`，分支 `codex/g3-product-acceptance`，由主线从派工后的最新 `origin/main` 创建。本轮正式只拥有 `tests/product-acceptance/` 下的 harness、fixtures、用例、截图、报告和消费说明。目录就绪后开工，不在 primary 或其它 Agent 目录写代码。审计基线 `c3f018e`，读取 AGENTS、START-HERE、product-spec/README、本轮 README 和当前真实发布报告。

不改任何生产实现、root manifest/lock、公共 schema 或迁移；不降低期望使失败通过。B 拥有 `tests/native-acceptance/` 与 Runtime，E 拥有跨产品验收，两者共享证据事实但不互改源码。主线不在你的目录并发写测试。

## E1 可失败的独立 harness 与检查点

消费公共配置/命令/回执/snapshot/问题/环境/verification/artifact parser，支持私有 state/端口、源码/版本身份、超时/预算和精确 case 状态。默认只读/controlled/mock，无任何外部模型请求；写入/故障需要显式选项和自有临时资源。

先证明工具会失败：缺必要用例、未知/坏响应、受理不确定、非法 fixture、旧报告、无候选/坏 patch、未执行 native 都不能被聚合成 release PASS。认证验证受保护路由；读取/发送 credential 前验证 loopback origin，不跟随重定向泄漏。提交稳定检查点后继续 E2–E5。

## E2 日常产品纵向和功能负例

使用真实 product/SQLite/Runner 与现有受控执行器，走公开 API，覆盖会话目录/搜索归档、项目设置版本、普通聊天/工作补充/明确委托、任务/问题/验证/完整 patch/接受与重开。新接口未到先测现有路径，按主线提交增量复验。

验证所有重要反例：同 commandId replay/conflict、两会话/两项目隔离、旧合同/答案/提案、机器 FAIL 不可接受、artifact/环境漂移、缺缓存/坏设置、故障恢复操作、不重复 writer。使用合法业务输入检验 stale 拒绝，不能让 schema 400 冒充正确业务保护。

与 C 的上下文/提案/决定对接时使用本地 provider mock：来源/范围正确，确认前无执行，重复确认幂等，撤销后不再生效，提示注入不扩大权限。fixture 与 actual native 分开报告。

## E3 独立浏览器和视觉/交互回归

界面规范读取 `apps/console/PRODUCT.md`、`apps/console/DESIGN.md` 与已提交的视觉证据；主线已有的受控测试可作参考，不能以其通过代替自己的独立产品验收。

使用已安装的 `apps/console` 的 `@playwright/test` 与实际同源 API，桌面 1440×900、笔记本 1280×800、窄屏 390×844。覆盖正常/空/加载/离线/慢响应/错误、长中文和路径、键盘/focus、面板滚动、问题表单、diff/完整下载、接受与重开。

检查实际内容和关键操作可达、不重叠/溢出；download 需要校验 bytes 和 roundtrip，不只看事件。UI 以主线确认的石墨导航、白色对话、青绿强调和主对话中心为视觉基线，不在测试里重设计产品或把截图像素数当美观通过。

截图和缺陷按同一批 viewport/状态检查，一次汇总明确步骤、预期/实际和 owner；主线修改后只复验相关面，避免无限截图/微调循环。

## E4 有界稳定性与独立安装迁移

先做实际执行→提问/完成/失败/停止→重开的混合受控周期，而非只创建/重放命令；至多 30 周期或 45 分钟任一先到，首次未解释不变量破坏就停止并留 seed/输入/资源证据。观测属于本实例的进程、可见 FD/内存/磁盘、begin/回执和延迟；未知测量明确未知，不能以端口数不变证明无进程泄漏。

D 发行/迁移检查点到达后，在新目录或可用新账户按普通同事路径安装、first-run、启动/停止、doctor、完整备份/恢复/路径映射/升级回滚。缺产物/损坏 bundle/不兼容版本/未知旧 writer 不得假成功。迁移不能自动重发模型业务；缺真实跨机器条件就准确标 NOT_TESTED。

## E5 发布矩阵、复验与交接

输出 actual native / controlled fixture / SDK mock / readonly / 未测的逐项矩阵，绑定源码和实际版本。消费 B 的已提交原生证据需验证范围与来源，不把 B 的 profile 或 helper 自测当原生行为，也不替 B 触发新的计费任务。

发布工具聚合必需项时，FAIL、缺失、未执行和过期证据非零退出。产品缺陷给主线/A/B/C/D 最小复现后继续其它独立项，不能在验收目录复制生产状态机补功能。维护 `reports/execution-status.json` 与可复制命令，交 branch/commit/base、实际证据、未测条件和下一消费者步骤，仅 push 自己分支。

## 预算与边界

本包默认 **0 模型任务**，包括聊天模型，使用隔离 mock/controlled 路径。后续稳定发布如确需一项全新原生复验，可提出最多 1 个有界任务的明确缺口；只有用户单独下发该预算才执行，不默认开启，不与 B 共享或重置账本。既有私有候选只在 main/B 明确提供为测试输入且权限/资源身份可核对时复用。

不操作用户当前 5180/8796 或 5181/8797 服务，不读取账号 home/native session/真实项目凭据。遇生产缺口先交复现，继续其它流程、报告负例和安装 fixtures；全部可执行阶段结束或只剩明确阻断时统一交付，不无限轮询“等版本”。
