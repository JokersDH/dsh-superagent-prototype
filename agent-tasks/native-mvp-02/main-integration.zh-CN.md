# 主线：环境产品化与独立验收消费

基线 `1f3229f`；保护未跟踪的 `ARCHITECTURE-NOTES.zh-CN.md`，不修改外部 A/B checkout。当前 native MVP 继续可用；未通过的环境候选不提前启用。

同时执行 [持续开发队列](extended-run.zh-CN.md)。下文稳定接线、贯穿产品和消费复现仍是核心出口；扩展后的 M1–M6 不依赖用户逐项转述。

## 第一段：稳定接线接口

1. 消费 A 的 package-local API 检查点。优先让环境准备使用 independent Runner 的同一 owned-process inventory/取消通道，通过可注入 process port 包装环境模块；不在 coordinator 藏一个登记不到的 detached installer。
2. 环境准备发生在 native begin 前，安装可能写入之前就需稳定意图/资源归属。暂停、停止、重启和 preparing 未决时不重复安装、不启动第二 writer；不能只靠 worker 可写 marker 判定 ready 或清理。
3. WorkspaceManager 增加 trusted environment attachment/exclusion port。只接受调用方验证的环境凭证，拒绝 tracked 业务文件、任意 source path、归属替换和不安全符号链接。manifest/digest 同时绑定环境指纹及排除策略；完整 patch 在 Git 临时 index 阶段就排除已准入的环境文件，不改用户 index/ignore/config，不重引入 mixed staged/untracked 和 reserve-base 漏交付。
4. 新接口未消费前可用同一 port fixture 开发；只能在 A 的独立准入通过后进入真实产品 lane。公共 wire/hash、root lock 和迁移仍单一 owner。

## 第二段：贯穿编码与验证

- 项目导入允许明确选择现有环境/离线安装策略与授权缓存，默认不联网、不升级、不运行项目钩子或 lifecycle；单包支持范围写清楚。新增 HTTP read DTO 独立生成，不破坏 frozen Runner/data wire。
- reserve → 环境准备/复验 → native metadata/policy → 一次 begin → 当前候选冻结 → 环境再复验/注册检查 → 人工接受。package/lock 或依赖内容改变时明确重新准备/阻断，不把修改依赖绕过检查的结果当成可复现交付。
- 环境变量只给相应安装/检查子进程；不要把 installer 的私有 HOME 覆盖给 Codex，或复制 native auth。
- ready/blocked/preparing 是资源准备投影，不新增 Work 执行状态机。缺缓存、坏版本、钩子、环境漂移、清理未知在工作台可理解、可操作；失败保留输入，不回退 fixture。
- 原项目保持，环境文件不进交付；接受后仍按既定 patch/worktree 交付语义，不自动 merge/push。

## 第三段：按独立复现修产品

消费 B 的真实停止、重启、当前候选、必需 FAIL 与问题回执证据。修复归属在主线，不让 B 修改测试期望或复制运行时。安全性和可恢复性分别验收，未知结果不重派。

统一验收：保留现有内核/367 主线/262 运行时及旧八项准入范围（随实际新测试更新计数）；A 新环境准入全部通过；无依赖原生正常链路保留；再新增一个真实离线 pnpm 项目的 UI→环境→Codex→检查→完整 patch→接受/重开。检查 marker/依赖/缓存/本机路径未泄漏到业务 patch。

更新用户指南、当前入口、进度和代码位置。每个报告区分 readonly、fixture、actual native 和 NOT_TESTED，不用测试数计算产品完成率，不在证据未闭合时升级完整 G2。

## 扩展执行顺序 M1–M6

1. **M1 / P0 可信接口**：先交 workspace 环境附件/排除、Runner owned-process adapter 的最小接口和回归，复用公共类型及 A 已提交 package API；没有 API 就先做现有 workspace 边界，不复制环境实现。安装之前持久登记写意图与资源归属，取消/恢复必须纳入现有屏障。
2. **M2 / P0 产品闭环**：接 A 的准备/复验，贯穿 native begin、freeze、check、accept；处理 manifest/lock 改变和环境漂移。只启用独立准入通过的单包策略，workspace opt-in 不能自动扩成默认产品能力。
3. **M3 / P0 工作台**：导入时展示受支持检查与环境策略，预检/准备/blocked 的可操作状态、来源明确的诊断、失败保留输入、实际代码位置/验证/patch。只消费服务端投影，不引入第二生命周期；真实未就绪不显示 fixture 成功。保持现有专业浅色风格。
4. **M4 / P1 故障修复**：在阶段边界读取 A/B 已提交的进度/最小复现，优先修数据错误、误交付、重复 writer、停不下和无法恢复的问题，再处理可用性。每个产品修复先保留对应失败回归，发 main 后由 B 消费复验；不为通过测试放宽事实/身份/资源权限。
5. **M5 / P1 自助诊断**：新增或复用只读 doctor/status 入口，检查实际服务身份、Node/包管理器、原生版本/准入、项目/环境状态及恢复阻断。复用现有 launcher；端口被别的进程占用给出可用替代和准确入口，不杀陌生 PID。诊断导出排除 key、账号 home、数据库及 session 原文。修改启动行为只在私有实例验证，现有用户服务不自动重启。
6. **M6 / P1/P2 发行与扩展**：保留既有回归，统一独立验收门槛和用户指南，消费 B 的接入工具并给下一执行器最小实现清单。先用零模型 fixture 验新公开接口，再在最多两个小型私有项目原生任务内完成带依赖 UI 闭环；失败不无限重跑。新协议仅准备经过公共契约验证的接入点，实际 ZCode/DSH/CAC 未测不宣称可用。

等待 A 期间优先 M1 的既有边界、M4 已有故障、M5；等待 B 期间继续 M2/M3。主线进度与可消费检查点随发布记录，不把“任务已分配”写成代码完成。只有全部可执行队列结束或剩余确实阻断时统一收尾。
