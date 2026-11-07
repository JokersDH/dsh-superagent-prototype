# Agent B：G0-B 隔离运行时与 SQLite 验证

交付仓库：`https://github.com/JokersDH/dsh-superagent-prototype`。
本机工作目录：`/Users/hh/Desktop/joker/superagent-agent-b`。
唯一工作分支：`codex/g0-platform-validation`。

## 开始检查

先读根 `AGENTS.md`、[代码地图](../START-HERE.zh-CN.md)、[稳定性](../product-spec/05-reliability-and-operations.zh-CN.md)、[选型](../product-spec/09-technology-and-evidence.zh-CN.md) 和 [WP-00](../product-spec/tasks/WP-00.md)。

```sh
pwd
git status --short --branch
git remote -v
git log -1 --oneline
```

分支或目录不对就停止写入，报告实际位置。记录初始 HEAD 作为本轮 base。不要切换主工作目录的分支、更新全局运行时或覆盖用户设置。

## 唯一可写路径

`tools/reuse-spike/platform/`，包括独立 package/lock、探针、临时测试资源引用与报告。其他路径只读。临时 DB/原生包缓存不得提交。

## 实施要求

1. 核对 OS/arch 和已安装 Node，区分本机观察 `24.21.0` 与拟议 Node `24.22.2`、pnpm `11.7.0`、better-sqlite3 `13.0.3`。对目标组合的测试使用隔离目录/环境，不全局升级、不 reset agent profile。
2. 验证拟议 binding 实际安装和加载、prebuild 和 `SELECT sqlite_version()`，检查版本 admission ≥3.51.3。记录实际 runtime/binding/SQLite/OS/arch；其他架构为 NOT_TESTED。
3. 在临时 SQLite 上验证 WAL、外键、唯一约束、rollback、嵌套 savepoint 和同连接事务内的状态/effect/receipt 原子性。注入回滚断点；这只是探针，不实现正式 Store/Queue。
4. 通过 binding 的一致备份机制完成 backup→新目录 restore→integrity/foreign_key 检查。说明尚未包含产品 artifact、Runner 或完整业务恢复。
5. 若资源允许，在自己的独立子进程试验中验证 commit 前后退出的最小持久化行为；未做则明确 NOT_TESTED，不夸大 G1 覆盖。
6. 输出发行组合建议、可重跑步骤、release manifest 草案与阻塞；拟议组合失败时给替代建议，不静默切换 binding。

不要运行原生 agent 模型任务、读取凭据、访问生产 DB、重置用户 home/profile、创建第二执行内核或改根 lockfile。运行时下载和试验依赖仅落在本任务受控目录或隔离缓存，记录来源和版本。

## 输出

- `README.md`：环境准备、探针和复现命令。
- `report.md`：实际矩阵、事务/备份结果、限制和阻塞。
- `release-candidate.json`：实际测到的组合与 admission。
- 最小 package/lock、探针源码/测试与脱敏证据。
- 本任务局部 `.gitignore`：临时 DB、WAL/SHM、缓存、解压 runtime、依赖和构建输出不能进入 Git。

本轮提供 OPS-01 的 G0 适用证据；不将实验数据库结果冒充生产 Store、跨模块恢复或 native 兼容。

## 上传和交接

检查 stage 后，只提交 `tools/reuse-spike/platform/`，push 到 `origin/codex/g0-platform-validation`。不 push/merge main，不改其他 Agent 的文件。

报告 base/commit/branch、路径、实际环境/命令、PASS/FAIL/SKIPPED/NOT_TESTED、OPS-01→证据、阻塞和建议。无法验证目标组合也要交付可复现失败，不制造通过结论。

结束后等待主 Agent 的 G0 结论；下一包是 WP-03，但本轮不自动开始。
