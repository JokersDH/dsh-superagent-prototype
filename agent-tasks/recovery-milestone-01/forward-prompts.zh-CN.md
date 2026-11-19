# 下一阶段转发话术：一个生命周期结果持续做到验收

2026-11-19续交。仍是恢复里程碑01，不新开wave。main **bde57d42** 已接入B postcommit finalize：原Store屏障提交后传完整manifest digest和同confirmationId清退端点；27项主线回归、Runner direct strict和H/B受控证据通过。下一步只处理finalize响应丢失同ID调和、H UNKNOWN材料清理和真实层限制，见[本轮验收](../../reports/releases/recovery-milestone-01/admission-2026-11-19.json)。

## 发给B：主动，负责完整生命周期到集成验收

```text
继续 /Users/hh/Desktop/joker/superagent-agent-b、codex/g1-runtime，保留dirty后fetch/merge最新origin/main。读AGENTS、agent-tasks/recovery-milestone-01/agent-b.zh-CN.md和WP-16/0095末尾postcommit约定。
本轮粒度是同一个完整结果：原Runner终态证明在main持久确认前保持可恢复，持久确认后明确finalize才正常退出。源码、实际entry、类型、正负消费者、与main原Store适配及H独立复验都要做到，不在单fix/SOURCE_READY停止。
09216f组件已被主线采用，B direct strict和B40/B39受控负例已过；当前只补finalize响应丢失后的同confirmationId重试/调和、UNKNOWN失败材料保留、普通自然terminal/显式shutdown正负。不得用cancel200或50ms代替Store确认，不能重建第二协议/ledger/宿主。
最小source早交后持续这个结果联调/修复/复验，真实模型/native/信号0，原dirty/状态/预算及十二实例保留，排除I owned，不扩独立维护线。
```

## 发给H：主动，负责同run独立闭环到最终复验

```text
继续 /Users/hh/Desktop/joker/superagent-agent-h、codex/g4-trial-operations，保留成果后fetch/merge最新origin/main。读AGENTS和agent-tasks/recovery-milestone-01/agent-h.zh-CN.md。
combined consumer自阻已在main自有集成中修正：继任不得重spawn原target，但允许original.nextWorkId首次spawn，累计capacity+1。main6d309128已完成2/4同run恢复→检查/接受→原槽归还→原排队Work前进。继续修H自身清理：不要关闭/删除UNKNOWN filler的credential/root；按candidate+assignment+generation绑定检查/接受/产物和receiver完整命令。
随后持续负责同一个原Work结果的独立最终验收，结合B/main的postcommit终态清退：proof/cancel后回复丢失与提交前退出仍可恢复；提交后finalize前退出按原receipt继任；合法finalize丢回复可调和；UNKNOWN/foreign不能清退。B源码早交即采用并复验，不把分离PASS拼成同run物理证明。
只交H owned消费者，缺生产行为给最小repro，真实模型/native/信号0，不改他人源码/原表或新建框架。做到同结果闭合，无需逐fix重新派工，不扩安装/研究/独立维护队列。
```

## 发给其他八位：继续待命（同一段分别发送）

```text
继续按需待命。当前仍仅main/B/H闭合原恢复的同一个生命周期结果，D/E固定W36本项已验完，不追移动main重包。
保留所有成果、dirty、状态、归档和预算，不执行旧整包/备用职责/独立维护队列。只有main当前consumer出现涉及你owned模块的具体阻断时，再带最小复现激活；没有触发项就不新增任务或报告。
```

这些话术尚未代发外部chat。大粒度是负责到同一结果被实际采用和独立验收，不是增加范围、阶段或模型额度。
