# 2026-11-10 收尾批次：带依赖项目的可用预览

本批继续第二轮，收敛已有功能到可重复验收的产品出口。当前集成基线 `origin/main` / `908c129`；A 最新候选 `b6dd261`，B 最新候选 `e392fc5`，fetch 后没有发现更新的修复。已知失败见 [0011 复核](../../docs/rfcs/WP-16/0011-extended-checkpoint-review.md)。本页是当前执行优先级，优先于扩展队列里尚未完成的 P2；不是新完成报告。

## 产品目标与阶段

本批交付：一个干净、已提交、有依赖的普通 pnpm 项目，从工作台导入，明确选择环境策略与离线缓存，在受控工作区完成准备、Codex 编码、注册检查、完整 patch 审阅和接受，重开保留；停止/故障能看见可信结果和可操作限制。

不按小时或测试数量承诺进度，以以下三个出口决定是否继续：

| 阶段 | 出口 | 消费顺序 |
| --- | --- | --- |
| R1 模块可接入 | A 关闭八项现有准入并交稳定接口；B 关闭两项工具误报且能严格失败 | 主线可消费已提交的接口，B 的其余验收同步继续 |
| R2 产品可使用 | 主线接通环境、Runner、验证/接受与工作台，完成带依赖单包链路 | A 复验包消费，B 用公开产品入口独立检查 |
| R3 结果可复现 | 完整 patch、检查失败拒交付、真实停止、故障不重派和浏览器有明确证据 | 发布单执行器本机预览及限制；未测能力不升级完整 G2 |

现有无依赖 MVP、原生证据和 387 项受控回归保持其原范围。跨 harness、学习系统、第二生产执行器，以及扩大任意 monorepo 支持暂不进入本批出口。A 已做的受限 workspace 代码保留，但先证明单包主路径。

## Agent A：环境模块交付包

继续 `/Users/hh/Desktop/joker/superagent-agent-a` / `codex/g2-workspaces-verification`。仅拥有 `packages/environment-preparation/`。先正常保存本地工作，再合并最新 main；本地临时 root lock 差异不提交，不 reset/clean。新增依赖仍交主线统一生成锁。

### A-R1 先关闭三项失败并交检查点

原五项已通过，必须保留；新增三项是当前阻断：

- blocked.cleanup、stale/reuse、重新准备和丢失 ref 恢复等所有入口，不从 worker 可写 marker 取得删除/认领权限。未知目录保持，真正拥有的部分才可清理；有效 authorityRoot 不代表 workspace 内任意旧 marker 都可信。
- 进程组观察只在明确不存在时确认停止；EPERM/其它观察错误保留 active 或 indeterminate/unknown，不给 confirmed。测试异常观察、正常后代、取消和超时。
- stdout/stderr 按合并字节预算捕获与终止，包含交错输出及多字节文本；结果不能超过声明上限，超限必须可观察。

提交源码、包内回归、接口/依赖请求并 push 检查点，然后继续 A-R2–A-R4。不要等主线集成才做后续。

```sh
node /Users/hh/Desktop/joker/superagent/tools/bootstrap/review-environment-preparation.mjs --environment "$PWD" --candidate <已提交修复commit>
```

八项全通过只证明现有准入范围，不取代下面的消费和恢复验收。

### A-R2 完成生产调用方需要的接口

- 普通单包为默认、受限 workspace 为显式 opt-in；prepare/inspect/verify/cleanup 的调用样例准确，结果由 parser 校验。主线要求 authorityRoot 和可序列化 ref，不使用无凭证 legacy 模式。
- receipt 绑定实际工作区/请求/输入/依赖/版本和归属；所有复验路径遇到丢失、替换或漂移必须 blocked。只把实测证据所支持的目录作为排除项，目录不存在时不凭默认清单制造拥有权。
- 稳定 process port 的取消、输出、退出与 quiescence 语义，供主线在独立 Runner 中复用。主线负责进程库存/持久意图/屏障，不在包内另建产品状态机。
- 权威记录采用已有可靠写入方式，清楚说明重开所需持久性；缺失/损坏不能恢复成 ready 或自动删除。继续保持原项目、index、lock 与已有依赖不变。

### A-R3 用独立消费和实际进程证明行为

使用公开导出，准备→序列化 ref→第二个 Node 进程复验→可信清理；覆盖 forged marker/receipt、工作区替换、依赖/manifest/lock 改变、无缓存与项目钩子拒绝、同 workspace 并发、旧 preparing 及中途取消。只操作自有临时 fixtures，不读账号、不联网安装、不启动模型。

保留两份可重建的离线单包 recipe（普通依赖、开发依赖与实际测试），不提交依赖或缓存目录。源文件、依赖版本、测试命令与如何生成本地缓存写清楚，供主线/B 重建。没有主线接线的范围明确 package-local，不自报产品通过。

### A-R4 配合集成并交准确范围

在主线发布接口消费者后，于安全阶段合并并复验包的受影响范围；消费约定见 [0010 interface](../../docs/rfcs/WP-16/0010-main-environment-operations-checkpoint.md)。不改主线 workspace/Runner/UI。若主线尚未就绪，继续恢复、路径、诊断和性能的已有待办；不要再扩大包管理器或 monorepo 范围。

更新本包 `reports/execution-status.json` 和交接：branch/commit/base、实际命令、八项准入及包测试结果、独立消费证据、依赖请求、生产未测项。最终出口是主线可以消费且复验通过的模块，不是仅有 final 状态文件。

## Agent B：独立产品验收包

继续 `/Users/hh/Desktop/joker/superagent-agent-b` / `codex/g1-runtime`。仅拥有 `tests/native-acceptance/`，保留本地报告改动，先合并最新 main。默认自测/只读零模型；需要写入/故障的测试必须使用自己创建的临时项目、state、端口和明确归属进程，不对用户 5180/8796 实例运行变更测试。

### B-R1 先使工具能准确失败

- 关闭 NATIVE-LINK 过早终结：没有候选、patch 无效、检查未过、请求拒绝等不能保持 PASS；全部必需断言后只终结一次。共享 parser 验证每个命令/响应，合法业务拒绝与 schema 400 分开。
- create_work 已排执行 effect，去掉非法/额外 continue；continue_work 只能在已结束工作、expected 合同和明确意图下使用。对不确定受理核对同 commandId，不偷偷新建任务。
- 原生报告从实际 attempt/begin 事实记账，并校正旧状态。当前报告声称用了两个、额度总计四个；先核对能证实的消耗与不确定发送，不能因新日期/修工具重置额度。
- 严格模式对必需项 FAIL/NOT_TESTED/缺报告/旧基线均非零。默认 readonly 允许诚实未测，但不能拿它充 release PASS。

```sh
node /Users/hh/Desktop/joker/superagent/tools/bootstrap/review-native-acceptance.mjs --acceptance "$PWD" --candidate <已提交修复commit>
```

此两项复现通过后提交并 push 检查点，随后继续 B-R2–B-R4。

### B-R2 补真实交付、停止和重开

优先复用已有临时候选/凭证完成 patch→接受→重开，不为补下载反复调用模型。新 manifest 的 `patch.artifactId/sha256/bytes/format` 指向真实 bytes，旧候选仍可读取既有第二项 patch；base=head 不证明没有改动。clone 必须置于实际 baseCommit，校验 patch 字节再 apply，对比业务输出/执行注册测试，核对原项目不变。

对工作区位置为 null 的问题保留准确 source commit、workId、合同/候选和公开响应，先验证候选是否真的存在。不以自己的错误调用为主线缺陷；其它场景继续。

在剩余已核对预算内优先真实“运行中停止”和“coordinator SIGKILL/重启”：先证实 owned 进程/持续工作，再发停止或故障，核对实际写入结束、资源屏障、没有第二 begin/writer，并报告之后可进行的操作。静态 phase、ACK 或永久卡住均不足以证明完整恢复。真实机器 FAIL/权限问题仅实际触发才 PASS，未完成范围准确单列，不越额度。

### B-R3 完成无模型的执行与浏览器矩阵

- 受控 product/SQLite/Runner 的实际任务生命周期，覆盖 question→合法答案→native_applied、旧版本/旧 attempt 拒绝、机器 FAIL 不可接受、停止、刷新/断线重连、两个项目/会话身份隔离及可触发的重启窗口。使用合法字段；400 不证明正确拒绝业务上的 stale answer。
- 浏览器桌面 1440×900 与窄屏 390×844，验证导入、明确委托、问题、错误、完整下载、接受、重开和关键按钮/焦点可达。使用已安装的 `apps/console` 的 `@playwright/test`，不新增根依赖；参考已有 native-workbench 的同源代理，CLI 顶层付费入口不能被 import 自动执行。
- 有界稳定性至少跑完“实际执行→问题/完成/失败/停止→重开”的混合周期；按最多 30 周期或 45 分钟任一先到停止，首次未解释的不变量破坏就留复现。创建/重放 API 压测只能单列为命令测试，监听端口数不证明没有泄漏子进程。
- 记录自己实例的 begin/回执、实际 owned 进程、可观测资源前后值，清理后核对无遗留写进程。主线环境尚未启用时先完成这些任务，不等待 A。

### B-R4 交发布矩阵并等待明确接线复验

主线环境接线发布后，用公开界面/接口重建 A recipe，补无模型环境正反例和已有额度内可执行的原生验收；原生额度已用完则交主线独立预算。不要复制生产实现或自建私有执行接口。

报告按 actual native、controlled fixture、readonly、未测分列，每个 PASS 对应真实断言、源码及证据；产品缺陷给最小复现后继续其它工作。Driver conformance 可保留为后续，不把 profile 元数据检查命名为协议/生命周期通过。本批发布矩阵优先于新增执行器工具。

## 主线工作包

主线继续 primary checkout，保留自身现有代码与 A/B 分支，不写对方工作区：

1. 准入 A 修复检查点，只消费本包提交及必要依赖；生成唯一 root lock。将授权缓存/策略与私有 ref 绑定本次 attempt，Worker 输入不决定可信权限。
2. 由独立 Runner 在现有 owned-process inventory 中运行安装；安装前保存稳定意图。停止/重启/未知安装状态进入既有物理屏障，不在 coordinator 私下启动无法登记的 installer。
3. 接 WorkspaceEnvironmentPort 与验证/接受前后复验，处理 manifest/lock/依赖漂移。环境变量只作用于相应子进程，不覆盖 Codex 账号 HOME，不改变核心生命周期和冻结 wire。
4. 接项目导入与工作台的环境预检、策略、准备/blocked 状态和可操作诊断，保持表单输入；实际未准备好不伪装成功。单包默认，受限 workspace 不提前产品准入。
5. 消费 B 有效复现修产品，先零模型回归，再在主线剩余两个原生任务上限内跑带依赖完整 UI 链路。当前已有服务不自动重启，开发/故障验证用独立实例。
6. 更新使用指南和发布证据，交付一条启动、一条只读诊断、一条零模型回归入口。环境失败可诊断、机器失败不可绕过、patch 完整且可应用、重开不重复执行；未测 native 问题/恢复平台保留限制，不宣布完整 G2。

## 协作与停工条件

每人交一个早期可消费检查点后连续完成整个包，不逐缺陷等用户确认。仅在阶段边界合并 main；报告具体接口/产品阻断后先执行独立部分。A/B 只 push 自己分支；主线独立复验后集成，final 不代表已准入。

全部可执行项完成或仅剩明确外部阻断时交最终范围并结束；不通过不断扩需求、空轮询或重复跑模型来延长工作。涉及账号、用户真实项目或未授权操作的问题保留待用户处理，不影响已授权的独立开发。
