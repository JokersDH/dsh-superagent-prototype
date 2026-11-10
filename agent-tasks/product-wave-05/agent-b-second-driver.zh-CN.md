# Agent B：第二真实协议与可证明的只读复核

沿用B目录/分支；本轮拥有execution、driver-kit/testing、catalog、policy-preparation、runner、drivers和native-acceptance。main不并发编辑这些源码；你不改coordinator、console、contracts/root lock。输入`56b1e61`及最新main，先保留旧账。

## B1 复验旧缺口与第二协议选择

先交wave04修复的可重跑证据，保持schema400/业务拒绝、真实begin/process/屏障、重复command及预算反例。未出现的真实question窗口保持NOT_TESTED。

零模型检查实际可获得的ZCode/DeepSeek Harness：正式协议/SDK、安装/版本、认证需求、是否能可靠禁写、问题/停止/未知发送和产物接口。优先选择一个真实可验证的不同协议；若ACP符合条件复用官方SDK，不手写整套协议。只换Codex模型或把假server改品牌不算第二执行器。

提交选择表、限制和稳定消费接口：catalog/resolver接受shared ExecutionProfileRef，解析到该精确已准入profile、driver及政策能力；不返回一个“最新同名”替代。不新增另一套Work/调度引擎。先交checkpoint继续后续。

## B2 Registry/Driver与版本化准入

在`packages/drivers/acp/`实现共享ACP transport；若实际协议不支持ACP，可在`packages/drivers/zcode-native/`或`dsh-native/`实现一个窄Adapter并说明理由，先交接口RFC。pkg-local依赖可安装，权威root lock由main生成。

使DriverResolver/Catalog支持多个精确身份，Codex已有路径保持；main拥有NativeProductConfiguration的产品组合改造。能力区分schema/protocol_fixture/controlled/actual_native；只读inspect/握手不是实际模型复核已通过。证据漂移使旧准入失效，缺功能清楚拒绝。

## B3 只读执行与封存输入

消费shared ReviewSubject/ReviewReport：作者已停止并冻结，复核者获得独立、最小的sealed patch/注册检查资料及明确授权；默认不拿作者完整session、不共享可写项目根/账号权限。worktree或提示“别写文件”不算只读证明。

用native verified policy或真实host sandbox证明读写限制，绑定policy/config/attempt/资源身份。测试写项目/父目录/配置、修改候选或联网扩大scope均按实际授权拒绝；只有advisory无法进入production reviewer候选。无法证明就保持unsupported，不伪造readOnlyProofRef。

原生run使用现有RunnerCommand/AttemptRef，独立辅助Work/Ticket由main创建；reviewer不能占作者assignment/epoch/current pointer。异步报告绑定subjectDigest，非结构化/坏JSON/错subject退为inconclusive或拒绝，不能猜PASS。报告内reproduction只作为文本。

## B4 问题、停止与恢复

复核问题仍逐native target进入既有Broker；权限/认证不跨target合并。停止取消自己的owned resources，不杀共享服务。writer未知不当quiescent，不重发未知begin/answer，不以换profile作为重试。

controlled真实进程覆盖begin前后、问题持久/答案待投、报告返回、取消未齐等崩溃窗口，按receipt和进程开始身份判断无重复。保留一个recovery transport/proof实现和protocol-v1语义，不能复制WeakMap。

## B5 原额度内真实试点与recipe

所有真实入口先使用持久预留账，含直接SDK/CLI，不只HTTP create_work。原wave03 grant最多4且不刷新；按实际used/unknown核对，预算不足就不跑。优先一次必要Codex控制、一次第二协议只读review、一次拒写/停止目标，未出现目标事件如实未测，不反复碰运气。

交精确native/driver/SDK/模型已知身份、policy/readonly证据、report产物/摘要、资源停止证明、费用与unknown账，以及main/E可运行的零模型recipe。实际没有完成第二协议不得宣称异构收益；实现/受控可整包交付，真实部分单列缺口。
