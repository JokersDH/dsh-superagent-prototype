# 分别转发给A–E：第十六轮完整长包

每段单独发给对应Agent即可。原工作目录、分支和拥有模块不变；任务文件已包含验收、三个检查点及外部依赖时的独立队列。早期提交后继续，不用逐项等待回复。本轮真实模型/native新增额度0。

## 发给Agent A

继续在`/Users/hh/Desktop/joker/superagent-agent-a`、原分支`codex/g2-workspaces-verification`工作。保留所有本地历史/改动并同步最新`origin/main`，阅读根`START-HERE.zh-CN.md`、`product-spec/README.md`、`agent-tasks/product-wave-16/README.zh-CN.md`、`docs/rfcs/WP-16/0047-wave-16-reviewed-deliveries-and-long-packages.md`，完整执行`agent-tasks/product-wave-16/agent-a-data.zh-CN.md`十阶段。

这次是“完整备份证据与真实非空业务恢复”整包，不只修一个测试。旧source/实际预检和87+106测试已承认；新snapshot兼容允许删effect_queue family或只留1family仍通过，先用版本化完整清单纠正，并保留历史快照正对照。之后消费main现有SDK非空候选/GET/prepare/明确确认，完成跨根只读恢复、真实问答/队列/resource、进程中断和D/E数据配方。main source确认没到只阻对应项，继续其余独立阶段；合并当前contracts再测试，不能用旧dist误判新回复字段。

只改storage/workflows及自有测试报告，不动HTTP/UI/共享contract/E断言。交早期可运行source、中期真实组合、最终包三个checkpoint，每次提交push后继续下一阶段；不要修A1就结束。状态写`packages/workflows/reports/wave16-status.json`，附实际命令/退出码/source/未到项。原迁移/账本/十二服务/所有tar保留，真实模型/native0；只push原origin分支明确owned paths。

## 发给Agent B

继续在`/Users/hh/Desktop/joker/superagent-agent-b`、原分支`codex/g1-runtime`工作。保留两份旧报告diff和全部ledger，同步最新`origin/main`，读根`START-HERE.zh-CN.md`、`product-spec/README.md`、wave16 README/0047，完整执行`agent-tasks/product-wave-16/agent-b-runtime.zh-CN.md`十阶段。新提交c7f7e77已纳入本轮复验，不重复原epoch/crash修复。

本包围绕“真实产品到独立Runner的业务恢复”连续开发。你的真实normal B13范围保留；但B14仍begin=answer=0、业务表空、writer合成，不能扩大receipt-only演示。第一个源码checkpoint必须让原Application/create_work/Effects/Broker经现有RunnerLink/runner-service-entry和本机fake app-server实际begin并产生question；再交最小B-owned业务重连port/RFC，接恢复后的真实answer/cancel、实际子writer和完整资源、原command/attempt/有效旧epoch与丢ACK窗口，最终原身份交付/检查/人工accept及2/4槽归还。

不得并发改main产品类/共享contracts，不能另建ledger、coordinator或生命周期；需要main可信回调时交可运行port并继续独立阶段。早/中/最终三个可运行checkpoint，push后继续，不修fixture一个点就结束。必须写`tests/native-acceptance/reports/wave16-status.json`，列实际receiver计数、业务行、资源和recovered exit。真实模型/native0，旧UNKNOWN额度不可花；只用私有本机fake，不研究价格/新Driver，不碰十二实例，显式owned paths推原origin分支。

## 发给Agent C

继续在`/Users/hh/Desktop/joker/superagent-agent-c`、原分支`codex/g3-assistant-context`工作。保留root lock diff，同步最新`origin/main`，读根`START-HERE.zh-CN.md`、`product-spec/README.md`、wave16 README/0047，完整执行`agent-tasks/product-wave-16/agent-c-context.zh-CN.md`十阶段。

main现已实际实现默认C factory、单次SDK非空建议、原回复候选GET/指针prepare及确认UI，旧报告缺入口描述已过时。unknown-wrapper4/4、四包291及当前main组合已承认。本包改为消费真实当前入口：不手造verified wrapper/任意artifact tuple、不用泛提案prepare代替原回复origin绑定；从本机SDK返回到A18结果读验，贯通work/revision/decision确认/拒绝/重放，加入原文/artifact/授权/合同漂移、实际默认factory覆盖、公开遗漏诊断、非空跨根历史和决定失效解释。

只改context/proposals/knowledge/routing，不写SQL、HTTP、第二确认权威或LLM loop。早期真实consumer、中期组合、最终包三个source检查点，交后继续，不等target激活。写`packages/context/reports/wave16-status.json`和当前consumer map，明确module-only与实际调用。真实模型/native0，所有旧证据/账本/十二服务保留；只push原origin分支owned paths，root lock不提交。

## 发给Agent D

继续在`/Users/hh/Desktop/joker/superagent-agent-d`、原分支`codex/g3-local-distribution`工作。保留全部旧tar/state，合并最新`origin/main`，读根`START-HERE.zh-CN.md`、`product-spec/README.md`、wave16 README/0047，完整执行`agent-tasks/product-wave-16/agent-d-delivery.zh-CN.md`十阶段。

旧birth/journal及signal后UNKNOWN四项已真通过，8962d10新tar6719项也已核对；这些成果保留。本包先关新资源边界：完整父身份下foreign子进程仍按路径继承owned、全局discovered UNKNOWN被过滤成proven empty并actual recover REVERTED；同时统一recover成功终态和CLI exit。先完整mock正负对照，再独立出生owned资源有限live，不能在门未过时广泛stop/cleanup。

安全修复后整合main建议版1169535，交实际personal HTTP/默认off/私有偏好兼容、准确干净schema18 tar给E，继续冷装/无执行器、非空搬根、18→18不同binary及16→18、故障重入与支持材料。普通安装不等激活，旧8962d10不改名成当前建议版。只改launcher/distribution/portability，早/中/最终三次source与准确tuple，交后继续；写`tools/distribution/reports/wave16-status.json`。模型/native0，十二服务/全部profile/ledger/tar保留，显式owned paths推原origin分支。

## 发给Agent E

继续在`/Users/hh/Desktop/joker/superagent-agent-e`、原分支`codex/g3-product-acceptance`工作。保留所有untracked runs，同步最新`origin/main`，读根`START-HERE.zh-CN.md`、`product-spec/README.md`、wave16 README/0047，完整执行`agent-tasks/product-wave-16/agent-e-acceptance.zh-CN.md`十阶段。

旧五项行为/模式/ABI及source控制已7/7通过，真实personal HTTP正对照也成立，不重新称未修。本包先补新恢复证据：actual recover=BLOCKED/exit2/unknown_live_resource仍能过gate，成功status/exit1也被忽略。绑定真实exit/status/code/operation/pointer/data，用同一一致正对照逐项变异并核对具体原因。先独立复验D后代/发现UNKNOWN纯mock安全门，再做允许的live矩阵。

其后消费main现有SDK候选GET/prepare/confirm和HTTP/SSE，同时按D确切新tar完成同subject的personal/context/history/reply/候选、非空搬根、不同binary/跨schema和有界稳定性。167PASS/16NT对应旧114b73c，不能认证8962d10或新main。用私有本机mock；personal创建held工作前先真实持久暂停派工，native发送必须0，不得误落用户账号。只改product-acceptance，不改生产或放宽required集。早/中/最终三次source/证据，交后继续独立队列，写`tests/product-acceptance/reports/wave16-status.json`。原pilot保持BLOCKED、无新额度，十二服务/账本/旧runs和tar保留，只push原origin分支明确owned paths。
