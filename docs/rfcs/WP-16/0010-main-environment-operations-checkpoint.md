# 主线环境接口与操作诊断检查点

日期：2026-11-09。基线 `5bbd892`，主线分支 `codex/g2-execution-integration`。本文件记录 M1/M5 的可独立实现范围；环境模块尚未准入，未启用真实依赖安装，也没有更改 Runner/data wire、迁移或 root lock。

## A/B 可消费的 interface

`packages/workspaces` 导出 `WorkspaceEnvironment` 和 `WorkspaceEnvironmentPort`：

```ts
interface WorkspaceEnvironment {
  reference: string
  fingerprint: string
  excludedPaths: readonly string[]
}
interface WorkspaceEnvironmentPort {
  current(input: {
    assignment: AssignmentIdentity
    workspacePath: string
  }): WorkspaceEnvironment | undefined
}
```

组合时作为 `new WorkspaceManager(root, { environment })` 的可选依赖。主线 adapter 负责从 attempt 绑定的私有记录取 A 的 ref，调用同步 `verifyPreparedEnvironment` 或等价复验，再投影为此 interface；A 无需改 workspace 或公共 schema。`reference` 是不含本机目录的 opaque ID，A 的完整 authorityRoot/ref 仍留在私有调用方状态中。

每次 freeze/digest 都复验。预期凭证缺失或不匹配必须抛错，不能用 undefined 降级为无环境；undefined 仅用于明确无环境的 attempt。manager 进一步拒绝任意源码、跟踪文件、Git 目录、外链/缺失目录与坏路径。排除在 Git 临时 index staging 之前生效，环境摘要与排除策略进入候选 identity；不改用户 index/ignore/config。

本检查点仅验证该 port 与真实 Git 行为。可信 receipt 的创建、安装进程登记、恢复屏障、环境变量和产品 UI 由后续 M2/M3 消费已准入 A 接口时完成。固定 fixture 回调不构成生产环境证明。

## 操作入口

`pnpm doctor [--state <private-state>] [--json] [--output <new-report.json>]` 只读核对版本、启动进程、监听者、私有 API 凭据对应的配置、项目和 snapshot 中的恢复阻断。它不构造仓储、不创建凭据、不读取 native 账号、不安装或执行模型。默认只输出；显式导出的新报告为 600，拒绝覆盖现有文件，原始服务响应/错误和 key 不进入摘要。

启动记录协议为 `personal-workbench/1`，绑定 launcher 的进程启动时间和真实 fixture/personal 模式。复用已有服务前核对 launcher 的 uid/cwd/命令/启动时间，以及 API/console 的监听 PID 与父子关系，再发送只读凭据；GET 不跟随重定向，响应有时间/字节上限。legacy 记录仍需通过实际进程和私有接口核对，不能因旧错误 mode 字段认作 fixture。

用户当前实例不自动重启。新记录写入在下一次正常启动；端口冲突给独立端口/state 的操作提示，不结束陌生进程。B 可在私有实例使用 doctor，或参考 `tests/integration/local-operations.case.mjs` 的零模型真实启动验收。

## 验收与剩余

已执行 workspace 模块 18 项（原十项及新增八项）通过，覆盖完整 staged/untracked/binary patch roundtrip、双方 index 保持、当前/index/base/HEAD 跟踪保护、路径/外链拒绝、环境漂移、重建与环境身份绑定。typecheck 通过。

操作诊断 12 项通过，包含真实 launcher/API/Vite 临时实例的启动与关闭、错误进程/模式/凭据拒绝、重定向不转发凭据、响应大小/超时、旧记录、私有导出不覆盖。对当前 5180/8796 实例另做只读核对通过；依赖准备明确 NOT_TESTED，未运行任何模型。

完整产品回归与本批源码证据在发布记录中单列。本批不宣称完成 M2/M3、环境准入、完整 G2、中途故障矩阵或新执行器兼容。A/B 按原扩展队列继续，不需要等待该检查点才完成各自独立任务。
