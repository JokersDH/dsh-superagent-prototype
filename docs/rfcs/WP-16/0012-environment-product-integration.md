# 单包依赖环境的产品接线与验收

日期：2026-11-10。主线分支 `codex/g2-execution-integration`，实施基线 `f2ca26c`。A 的 `c005820` 仅按 `packages/environment-preparation/` 导入；未整枝合并 A/B 的旧产品源码。B `2d71382` 的两项防误报复核通过，整包的实际测量范围仍单列。原有 MIT 来源保留。

## 用户出口

工作台导入已提交且干净的普通 pnpm 单包项目，选择离线准备和项目之外的授权缓存；独立 Runner 完成环境准备后，Codex 在隔离 worktree 开发，执行注册检查，提供完整 patch、人工接受和重开保留。旧的无依赖 Node 项目不要求新环境策略。

新版本机预览使用 `http://127.0.0.1:5181/`、API 8797 和 `.local-state/environment-preview`。旧 5180/8796 实例没有自动重启或覆盖。新版实例的启动、只读诊断和停止均支持 `--state`；使用指南记录完整命令。

## 实现与归属

| 路径 | 本批职责 |
| --- | --- |
| `packages/environment-preparation/` | A 的签名凭证、依赖解析/离线准备、复验、可信清理及受限 workspace 模块；产品默认只接单包 |
| `apps/runner/src/command-process.ts` | 使用现有 ProcessHost 运行准备命令，合并输出预算、超时/取消和实际进程组停止 |
| `apps/runner/src/environment-preparation.ts` | 验证内容寻址计划和完整 attempt 身份，调用权威准备入口，持久保存结果；不打开产品数据库 |
| `apps/coordinator/product/environments.ts` | 在既有命令账本记录准备意图/ready 证明，向 workspace、检查和状态查询投影，不新增 Work 生命周期 |
| `native-attempt.ts`、`execution.ts` | 注册恢复端点后才回应准备计划读取；policy 和 begin 前复验环境，停止仍走现有资源屏障 |
| `runner-registry.ts`、`reconcile-runner.ts` | 从已登记的同一认证端点吸收后产生的 owned 子进程，保留已知资源，拒绝来源/归属替换和不完整清单 |
| `packages/workspaces/`、`packages/verification/` | 可信依赖目录排除与环境摘要绑定；检查使用该候选环境且继续执行变量白名单 |
| `packages/contracts/src/projects.ts`、HTTP、console | 独立的项目/环境 DTO、授权离线配置、工作详情状态；原 Runner/data wire hash 未改变 |

准备顺序：已有 core 执行意图 → worktree reserve → 持久准备计划/attempt binding → Runner 公开认证恢复端点 → 主线登记该端点并授权读取不可变计划 → Runner 准备 → 私有结果与签名 receipt → policy 准备 → begin 前复验 → 一次业务 begin。旧/未知发送和中途故障不能通过新 commandId 重派。

ready 不是文件名或 workspace marker 的结论。主线验证计划、完整 attempt、authorityRoot、workspace 和签名 receipt，才记录 ready；freeze/digest、注册检查前后及接受前重新验证。worker 修改依赖、manifest/lock、工作区身份或凭证后会受阻。installer 私有 HOME 只用于安装/检查；不覆盖 Codex 的既有认证环境。

准备命令在同一个 ProcessHost inventory 中。取消会关闭 admission，包括仍在等待准备授权的请求；迟到 payload 不会再写进已结束的桥接输入。恢复可以从已 pin 的认证 Runner 观察到登记后产生的安装进程，必须先补齐可信清单，再确认完整停止；缺失已知资源仍受阻，普通 driver 报告不能获得此权限。

## 实测结果

- A 当前模块的 37 项测试、typecheck/build，以及主线八项准入通过。证据见 [environment-closure-review.json](../../../reports/releases/native-followup/environment-closure-review.json)。
- B 的“无候选不得 PASS”和“不得发非法继续命令”通过，见 [acceptance-closure-review.json](../../../reports/releases/native-followup/acceptance-closure-review.json)。这不认证其全部生命周期/原生停止结论。
- 新增 Runner 命令八项及独立准备/取消三项通过；Runner 整包范围和当前受控工作台结果见发布报告。独立环境产品三项使用真实 pnpm 离线安装、签名凭证、真实 Git 和实际检查，native driver 在该三项里是明确的受控测试实现。
- 一项真实 Codex 任务完成代码与依赖准备。首次运行发现 `.gitignore` 已忽略的 node_modules 与排除 pathspec 冲突，冻结失败并保留验证意图。修复后改为向临时 index 传入 literal 业务文件清单，新增真实 Git 回归；同一候选恢复验证、patch 下载/应用、接受和重开均通过，未重派模型。首次失败与恢复报告保留在 [环境浏览器证据](../../../reports/releases/environment-mvp/browser/)。
- 桌面与窄屏截图已检查。已有专业浅色工作台风格保持，新增配置沿用表单，环境状态来自服务端投影。

本批受控回归不依赖模型。真实 native lane 使用显式命令，模型预算本扩展轮总计最多两个；各运行报告分别记录实际开始数、是否复用候选和源码身份。最终冷启动复验如已执行，以 `browser/report.json` 为准，不把恢复拼接结果称为一次全新任务通过。

## 运行与下一消费者

```sh
pnpm start --port 5181 --api-port 8797 --state .local-state/environment-preview
pnpm doctor --state .local-state/environment-preview
pnpm stop --state .local-state/environment-preview
pnpm check:g2-workbench
pnpm --filter @personal-agent/runner test
```

`pnpm check:environment-native` 会启动一个真实模型任务；不是日常自动回归命令。测试项目和服务必须私有，不能对用户现有服务做 SIGKILL 或变更验收。

A 可消费主线已集成结果做包级兼容复验；不再重交旧 workspaces/console 源码。B 合并本批 main 后可继续 B-R4：通过真实公开导入与环境状态接口跑受控正反例、原项目保持、patch 排除和浏览器；在已核对的剩余额度内才运行新模型。上轮已用额度不因新提交重置。

## 限制

单执行器、本机 macOS arm64 / Codex 0.164.0、普通 pnpm 单包和授权离线缓存是本批产品范围。npm 离线安装、任意 monorepo、跨平台、全 SIGKILL 窗口、对抗性脱离进程树、真实原生运行中停止/提问/审批和长时间 soak 没有因此变成 PASS，不声明完整 G2。

`.gitignore` 冲突已修复，但所有确定性验证异常的用户恢复动作仍有待扩大：失败不会接受或重复 begin，部分验证错误会保留原意图并按既有队列策略重试，尚无统一的用户恢复入口。缓存需操作者提前预热；产品不会隐式联网补包、运行安装脚本或自动把接受的 patch 合回原项目。
