# 08 多 Agent 分工与集成协议

本章给你一个可直接派工的开发机制。17 个任务包是实现职责，不要求同时启动 17 个 agent；先形成一条可验收链路，再按瓶颈增加资源。

## 1. 四个唯一所有者

| 共享资产 | 唯一 owner | 其他 agent 的动作 |
| --- | --- | --- |
| 公共 schema/生成类型/版本 | WP-00 契约负责人 | 提交 RFC + 失败 fixture，不私自 fork types |
| Ticket/Assignment 核心规则 | WP-01 | 提出领域事实/接口需求，不另建 Work engine |
| DB schema/迁移/事务连接 | WP-02 | 提交表/索引需求，由 storage owner 分配迁移号 |
| root manifests/lockfile/组合根/跨模块 E2E | WP-16 集成负责人 | 提交依赖请求和组合样例，不竞争改 lockfile |

WP-00 交付的 bootstrap 模板由 WP-16 集成到根文件；这样没有两位 agent 同时拥有同一 lockfile。模块内部 tests、fixtures、文档与源码由各模块 owner 一起维护。

## 2. 任务包怎样用

先读 [索引](tasks/README.md)，打开对应 `WP-XX.md`，把“可复制派工指令”发送给选定开发 agent。该包包含目标、输入、owned/read-only/forbidden paths、输出 interface、实施步骤、mock、开始/验收依赖、证据和交接格式。

`startAfter` 表示开始实现必须满足的基线；`acceptAfter` 表示最终集成验收依赖。两者不同，例如 UI 可以基于冻结 fixture 开发，但正式接受必须有应用接口和问题/产物链路；Driver 可以做 parser，但不能在 Runner 尚未验收时宣称稳定接入。

依赖所说的“模块接受”与“产品 gate 通过”分开：公共包先凭自身 interface/fixture/真实存储或子进程测试接受，可由下游消费；跨包 E2E/native 断言由组合根在对应 gate 最终验证。公共 Catalog 的模块接受不依赖三个 native Driver，原生 Driver 在它之上提交真实兼容证据。验收目录共用 ID 时，每包报告自己负责的层次/断言，不能把局部 fixture PASS 汇总为产品 PASS。

交付仓库已确定为用户 fork `JokersDH/dsh-superagent-prototype`。任务包路径均相对于这个仓库根目录：新产品新增 `packages/`、`apps/`，G0 试验位于 `tools/reuse-spike/`；原 `src/` 保留为提取来源。根 workspace 的具体配置仍由 G0/WP-16 验证和集成。代码位置、分支和首轮入口见 [START-HERE](../START-HERE.zh-CN.md)。工作分支统一以 `codex/` 开头。

## 3. 推荐派工波次

| 波次 | 可同时推进 | 先集成什么 |
| --- | --- | --- |
| 0 | WP-00；其他 agent 仅只读熟悉资料 | 提取试验、contracts v1、版本/路径规则 |
| 1 | WP-01 core、WP-02 storage、WP-03 runtime、WP-11 UI fixtures、WP-16 bootstrap | 确定性 fake subprocess 闭环 |
| 2 | WP-04 验证、WP-05 问题、WP-06 catalog、WP-07/08/09 协议开发、WP-10 应用 | 一个通过真实门槛的 Driver |
| 3 | WP-11 UI 联调、WP-12 运维、WP-13 知识决定、其余 Driver | 两项目 Alpha、恢复/备份、第二协议 |
| 4 | WP-14 学习研究、WP-15 CAC 后续 | 独立实验和能力矩阵，不拖住稳定版本 |

同一包可以在单独分支/worktree 由一个 agent 负责；若内部再拆分，必须保持唯一模块 owner，先划不重叠路径，禁止两个实现同时写同一迁移或共享类型。

## 4. 每包的统一过程

1. 读取上游 commit、contracts hash、任务包和相关专题；输出本包风险与依赖核对。
2. 先确定本包调用/输出 interface 的 fixture，覆盖成功、取消、过期、未知和失败；不为每行实现写镜像测试。
3. 在 owned paths 实现，以注入依赖替代跨包私有 import。不得跨模块读内部 SQL 或用 UI vendor if/else 绕契约。
4. 跑本包测试，记录实际执行和 NOT_TESTED；提交 evidence 和模块 README。
5. 由集成人在共同基线拉取，执行 acceptAfter 对应集成测试；失败退回原 owner 修复。
6. 合并后更新交接版本与兼容矩阵；另一个 agent 再 review 关键不变量。

## 5. 契约变更 RFC

```text
RFC ID / owner / 影响任务包
现有契约无法表达什么具体场景
最小失败 fixture 与实际 native/领域证据
拟议 schema/语义变化及旧消费者行为
数据迁移/版本/取消/恢复/权限的影响
备选方式与推荐；验收 ID；回滚条件
```

RFC 进入 `docs/rfcs/` 自己的包目录，契约 owner 审核并更新唯一来源。受影响包先基于已冻结旧版继续无关工作，不能默默加入私有可选字段再让其他模块猜。通过后提高版本、生成 types/fixtures、跑旧消费者和所有受影响 Driver。

每个任务包自动拥有 `docs/rfcs/WP-XX/`，因此提出契约/迁移请求不需要编辑别人模块。Owned 子路径优先于 Read-only 父目录的泛化规则；除此之外只读。禁止项仍然有效。

一般实现选择无需反复问你；权限边界、唯一状态来源、破坏性数据变更、范围扩张和研究推广需在 ADR/门槛上明确决定。

## 6. 集成 discipline

WP-16 维护可运行纵向样例和 root lock，不顺手接管各模块源码。若模块需要修复，优先由 owner 在其分支修；紧急跨包改动必须登记 ownership 交接，重新 review 并回归。

所有包以共同 contracts release 和最新接受基线构建；禁止把整个 workspace 的未提交变更复制给另一个 agent 当依赖。合并顺序遵循 acceptAfter DAG；startAfter DAG 只决定何时能用 mock 开始。

Driver goldens、mock 与 native reports 必须分开。不得编辑模拟 fixture 让某个未支持能力“看起来支持”。native 的 SKIPPED/NOT_TESTED 不转为通用 PASS。

## 7. 完成交接模板

```text
任务包 / 分支 / commit / contractsHash
实现的用户或模块行为
改动路径（与 owned paths 比对）
公开 interface、配置和调用样例
实际执行的命令与结果（含失败/未测）
验收 ID -> evidence 路径
原生身份/兼容范围；迁移与依赖请求
已知限制、未决 RFC、下游接入步骤
```

下游无需阅读上游整个对话；模块 README、公共 fixture 和这份交接应足以继续开发。

## 8. 停工与返工条件

发现需要复制一个新的任务状态机、原生 unknown 必须盲重试、权限只能靠 prompt 声称、共享 DB 连接无法保持原子、旧 writer 不明却准备重复写，先阻止相关上线并给出最小复现。其他独立模块可继续。

发现 spec 错误以具体 P1/P2、场景和 interface 影响报告；修订文档和契约后再继续受影响实现。目标是可集成产品，不是最大化并行 agent 数。
