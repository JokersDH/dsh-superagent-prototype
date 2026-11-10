# RFC-E-001：独立产品验收所需的跨模块消费接口

日期：2026-11-10 · 提出者：Agent E · 状态：开放
拥有路径：`tests/product-acceptance/`（本文不修改任何生产实现或公共 schema）

本文件只记录「验收需要什么公开语义」。E 不定义生产协议、不复制私有类型、不另建 Work 生命周期。
公共 DTO/schema 仍由主线单一 owner 决定；A 的 SQL 迁移、B 的 Runner 实现不变。

## 已可直接消费（无缺口）

| 接口 | 现状 | E 的用法 |
| --- | --- | --- |
| `GET /v1/health`、`GET /v1/configuration` | 已发布 | 判定运行模式/受控 profile/注册检查，创建前读取 |
| `POST /v1/commands`、`GET /v1/snapshot`、`GET /v1/works/:id` | 已发布 | 会话、委托、补充、问题回答、停止、重试、接受 |
| `GET /v1/conversations/:id/messages` | 已发布（分页） | 对话持久化与重开 |
| `GET /v1/verifications/:id`、`GET /v1/artifacts/:id` | 已发布 | 机器结果、artifact 字节与 sha256 roundtrip |
| `GET /v1/questions/:id/deliveries` | 已发布 | 回答投递状态（不得把 local_recorded 当原生已应用） |
| `pnpm start` / `pnpm doctor` / `tools/dev/workbench.mjs --fixture` | 已发布 | 浏览器与安装验收的启动/只读诊断 |

## 缺口 1：会话目录、搜索、归档（A / 主线）

- 输入：现有 `snapshot` 只有当前 `conversation` 分页，没有会话列表或搜索。
- 预期：`GET /v1/conversations?query=&archived=` 返回稳定 ID、标题、最近消息时间、活动/归档状态；
  归档后新命令不得写入，历史仍可读。
- 实际：路由不存在（404 `Unknown product route`）。最小复现：
  `curl -H 'authorization: Bearer …' http://127.0.0.1:<port>/v1/conversations`
- 需要语义：只读投影 + 一个幂等归档命令。归档不是删除，也不是第二个 Work 生命周期。
- E 当前继续：E2 用现有单会话分页与两会话隔离验证持久化；目录/搜索/归档用例标记 NOT_TESTED。

## 缺口 2：项目设置版本化与归档（A）

- 输入：`POST /v1/projects` 只注册项目；没有设置修订、默认 profile/检查版本或归档。
- 预期：读取项目设置当前修订；修订必须产生新版本且旧合同仍按原版本判定；归档阻断新委托但保留在途。
- 实际：无对应路由/schema 字段。E 以 `revise_work` 的合同版本为替代，覆盖了「旧合同拒绝」，
  不等于「项目设置版本」。
- 需要语义：设置版本标识与当前合同/候选的绑定关系。
- E 当前继续：E2 验证合同 revision 递增与 stale 拒绝；设置版本化标 NOT_TESTED。

## 缺口 3：上下文、提案、明确决定（C）

- 输入：公共 schema 已有 `UserDecision`、`ReasonerProposal`、`KnowledgePage`，但没有 HTTP 入口，
  也没有「确认前不执行」的提案命令。
- 预期：提案只读、来源/范围可核对；`record_decision` 需幂等；`revoke_decision` 后新上下文不再引用；
  提示注入不得扩大 scope 或授权执行。
- 实际：`record_decision`/`revoke_decision` 命令已存在，但知识/提案投影未接线到产品 HTTP。
- 需要语义：提案确认是独立命令；确认前后都不得绕过 `create_work` 的显式合同。
- E 当前继续：E2 用本地 mock SDK 验证「普通聊天不授权执行」；提案/决定链路标 NOT_TESTED。

## 缺口 4：发行 bundle 清单与迁移状态（D）

- 输入：没有 `apps/launcher/`、`tools/distribution/`、`packages/portability/`。
- 预期：可机读的 bundle 清单（版本、文件 `path/sha256/bytes`、rollback 目标）、first-run 记录、
  备份/恢复/路径映射证据；缺失产物、损坏 bundle、不兼容版本、未知旧 writer 必须明确失败。
- 实际：目录不存在。E 已准备 `fixtures/portability/` 的验收清单样本与负例（拒绝 traversal/重复/坏 digest），
  但真实安装路径无法执行。
- 需要语义：D 发布自己的清单格式；E 的 `acceptance-bundle-checklist/1` 只是验收侧检查表，
  不是产品协议，D 落地后按其实际格式适配一次。
- E 当前继续：安装、first-run、备份、升级回滚、跨机器迁移全部标 NOT_TESTED。

## 缺口 5：原生验收证据交接（B）

- 输入：B 拥有 `tests/native-acceptance/`；E 只消费其已提交证据。
- 预期：机器可读证据绑定 source commit、attempt/epoch/contract、`executed: true`、实际模型任务计数、
  停止/问题/恢复的 scope。
- 实际：E 不读取 B 的 profile/helper 自测作为原生行为，也不触发新的计费任务。
- 需要语义：证据中的 `executed` 必须表示真实 vendor 执行，而不是 fixture 分支被选中。
- E 当前继续：`full-product` tier 要求原生用例，当前无证据 → 任何 full-product 声明都会被 gate 拒绝。

## 缺口 6：静态工作台与 daemon 入口（D / 主线）

- 输入：当前 `tools/dev/workbench.mjs` 是开发启动器（Vite dev + 子进程），不是可分发静态产物。
- 预期：`pnpm start` 在全新目录/新账户下启动静态 UI + daemon，`pnpm stop`、`pnpm doctor` 有稳定退出码。
- 实际：开发入口可用，但没有安装/首启/升级概念。
- E 当前继续：E3 用开发 launcher 做真实同源 API 的浏览器交互；安装路径在 E4 明确 NOT_TESTED。
