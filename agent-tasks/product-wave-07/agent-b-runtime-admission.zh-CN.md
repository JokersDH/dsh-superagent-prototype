# Agent B：统一运行准入、宿主隔离与有限可行性整包

继续`/Users/hh/Desktop/joker/superagent-agent-b`、`codex/g1-runtime`。读本轮[README](README.zh-CN.md)、[0026](../../docs/rfcs/WP-16/0026-wave-07-integration-and-admission.md)及修订01。拥有execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance原路径；不改E断言、公共schema、coordinator/console/root lock。

6890fe8已有真实app-server transport、同协议假服务流程和Seatbelt探针，不能当作还没实现重做。当前核心阻断是整turn费用上界与实际provider/model价格，而非再导出一次协议。原wave03-b-native limit4历史保留，剩余UNKNOWN视为不可花；本包默认真实模型0，E的grant只由E调用。

整包结果：给E一个强制准入的同路径adapter和可核验事实，或对当前版本交有限、有证据的NO_SUPPORTED_BOUNDED_RECIPE结论；同时补齐既有控制/隔离/安装消费的零模型证据。不得新增第二Driver或计费代理平台。

## B1 固定实际执行身份与统一准入输入

核对exact executable/version/config/profile/model/provider，当前transports、session/capsule和预算ledger来源；发布可运行入口及main所需共享schema请求。明确非计费initialize/thread-start/read可以证明什么，真实作者checkpoint仍需付费turn。

交统一准入结果的版本、适用路径、证据摘要和拒绝原因；价格、全部计费组件、可执行限制、隔离和session事实缺项分别列出。E缺接口不得fallback直连CLI，单独canStopWithinQuota=true也不构成证明。先push这一检查点，继续后续阶段。

## B2 把会话与宿主隔离绑定到同一运行器

在E真正采用的launch路径组合当前transport、密封字节副本builder、宿主政策和子进程工具树。作者续会话与新会话复核严格区分；原作者目录/凭据/会话内容不可被复核工具读取，scratch可写，模型服务传输所需凭据不暴露给工具。

验收：同一路径下拒读作者秘密、拒写作者项目、拒未授权网络、允许scratch，并证明子进程继承限制。材料前后摘要变化令证据失效；只按真实vendor握手/受控工具探针的实际层级报告，不将独立Node sandbox或假server当真实模型成功。

## B3 关闭副本构建与隔离的具体反例

现有sealed-copy 8 PASS/1 FAIL保留原始事实：OS允许故意unsafe hardlink不是要求全OS禁止hardlink的新阻断。证明生产builder复制字节、不共享inode/Git/链接；故意替换为hardlink builder必须在生产准入/校验处被拒绝。

验收：symlink/目录逃逸/父目录/共享inode/原候选改动、错误或缺失隔离证据、版本漂移均fail closed。不要仅将旧FAIL改PASS；报告区分unsafe负对照和安全builder结果。网络/凭据限制不能被“丢弃scratch”替代。

## B4 在有限调研内给出费用上界可行性决定

只检查当前安装版本的正式协议/配置/官方SDK及实际供应商限制，列出输入历史、系统输入、reasoning/cache、工具往返和多次推理如何全部有界。字节/4估算、固定padding、Math.min裁小、timeout、turn后usage或输出限制都不能单独作为整turn硬上界。

能提供上界：交可重复的零模型验证、实际限制作用点、价格出处和剩余额度算式，由main/E联合准入后才由E消费原pilot。不能提供：交NO_SUPPORTED_BOUNDED_RECIPE/BLOCKED及精确缺失，不继续无限重复同一导出/自测。

允许最多两个零模型核验的具体替代recipe建议，说明会改变的变量、兼容性及需要main先版本化的内容；不自行换provider/model/实验协议、加预算或实现另一Driver。缺价格修好也不自动解除runtime_bound_unavailable。

## B5 保持原控制、恢复与发行消费不回退

在不发送模型的受控现有Runner链验证命令持久化、stop/answer/steer身份、unknown send核对、资源屏障和重开。给main/D提供精确runtime/profile诊断、所需可执行依赖和现有可信资源查询，不改main恢复策略。

验收：原grant重建空账不变成4次余量；损坏/未知账、重放、假结束和旧机器证明均不增加权限。实际原生运行中控制仍未测就保留NOT_TESTED，不能通过E试点额度补做B付费control测试。新state不意味着旧writer已停止。

## B6 向E/D/main交单一路径与结论

交真实可执行recipe、mandatory admission输入、launch/host证据、单turn上界可行性决定、全部命令/退出码、source/version与账状态；E无需猜入口或复制另一套运行器。

权威状态为`tests/native-acceptance/reports/wave07-status.json`，列真实/受控/非计费握手/未测边界。先交检查点再连续完成可独立阶段；实际计费阻断后转B2/B3/B5，不以新Driver/无限研究填时间。只push原分支，保留所有服务、会话与历史ledger。
