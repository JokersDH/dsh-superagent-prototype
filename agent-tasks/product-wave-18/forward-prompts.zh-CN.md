# 分别转发：第十八轮完整长任务

每段只发给对应Agent。为整个包建立或沿用一个goal（不设token预算）；没有goal工具就维护完整阶段队列。每包十阶段、早/中/最终三个可运行checkpoint，提交后继续独立阶段，不把第一个修复或partial当整包结束。任何goal都不改变真实model/native额度0。

## 发给Agent A

继续`/Users/hh/Desktop/joker/superagent-agent-a`、原分支`codex/g2-workspaces-verification`。保留旧数据/历史并合并最新origin/main，读START-HERE、product-spec/README、wave18 README/0050/0051，完整执行`agent-tasks/product-wave-18/agent-a-data.zh-CN.md`。

旧混版本/缺表反例与196包、source确认14已通过。新关键问题是真实main旧v1生产的非空binding备份，你的verifier拒绝：旧族不含work_id、新配方含work_id；旧legacy单测只是新v2重标并截两族，不能代替历史golden。先用`probe-wave18-context.mjs`建立真实旧producer正对照，按版本保留准确字段/排序/digest和完整已知family集合，不能任意子集降格。随后用同一份实际候选/决定/工作/context/问答数据贯通snapshot→第二根readonly HTTP→held queue/无重发→source原回执。main e438ab5已只接schema guard并保留v1，没有整包接v2。

只改storage/workflows及自有测试/报告，迁移append-only；三个source checkpoint交后继续，写`packages/workflows/reports/wave18-status.json`。D/E拿可运行同一数据recipe，不手写SQL/verified marker。十二服务、全部旧tar/profile/ledger保持，真实model/native0，显式owned paths推原origin分支。

## 发给Agent B

继续`/Users/hh/Desktop/joker/superagent-agent-b`、原分支`codex/g1-runtime`。保留两份旧report diff与untracked real-begin，同步最新main，读START-HERE/product-spec、wave18 README/0051，完整执行`agent-tasks/product-wave-18/agent-b-runtime.zh-CN.md`。

1e1f82a已有App→原ProductDriver→子进程→A失败事实接线，但尚未prepared/begin。首缺口是.mjs含`as Uint8Array`连--check/--version都失败；其次thread/start及现代approval字段不合原Driver；不要查不存在的fact_receipts.kind/binding.fence_epoch并吞错，已有observations.forAttempt/binding API。主线已给可运行起点：`PA_ADMISSION_REPORT=/tmp/pa-b-wave18-goal-start.json node tools/bootstrap/diagnose-wave18-b-preparation.mjs /Users/hh/Desktop/joker/superagent-agent-b`，输出必须是尚不存在的新路径；固定本地fake通过prepared→begin1→Broker question1/A事实4，不计你交付。

先将该协议对齐到你自己提交的producer并完成正常问题/回答/停止，再连续推进child完整身份、业务reconnect adapter/RFC、begin/answer/cancel故障、有效旧epoch、恢复交付/检查/人工accept和2/4槽归还。保留原guard，不造ledger/coordinator；normal main接口已存在，别先等待新normal port。三个可运行source交后继续goal，写`tests/native-acceptance/reports/wave18-status.json`；不要以B1 partial再结束完整包。只本机fake、无真实CLI/网关fallback，旧UNKNOWN不可花，十二服务/账本保留，显式拥有路径推原分支。

## 发给Agent C

继续`/Users/hh/Desktop/joker/superagent-agent-c`、原分支`codex/g3-assistant-context`，保留root lock diff，合并最新main。读START-HERE/product-spec、wave18 README/0051，完整执行`agent-tasks/product-wave-18/agent-c-context.zh-CN.md`。

旧getter与305包、实际候选/同根readonly/source确认都通过。本包不是重修getter：把同根切换和第二根复制两个分散用例合成一条真实数据链。同一份SDK候选/决定/context/问答/held工作→实际snapshot/verify→第二根recovery_readonly HTTP→原frozen body/identity/history可读、业务变更拒绝、old queue held、model不重发，再核对source事实不授grant。用main现支持的真实v1或已准入A格式；A v2未到只阻该格式，不阻这个完整readonly流程，不跨await持SQL事务。

只改context/proposals/knowledge/routing，不写SQL/HTTP/第二确认或LLM loop。交早/中/最终source后继续goal，写`packages/context/reports/wave18-status.json`及一致来源/reader成本/consumer映射；root lock不提交，E断言不改。十二服务、历史数据/预算保留，真实model/native0，显式owned paths推原分支。

## 发给Agent D

继续`/Users/hh/Desktop/joker/superagent-agent-d`、原分支`codex/g3-local-distribution`，保留所有旧tar/state，同步最新main，读START-HERE/product-spec、wave18 README/0050/0051，完整执行`agent-tasks/product-wave-18/agent-d-delivery.zh-CN.md`。

65102f7本身冻结helper已独立5/5通过，旧97同测仍失败，child修复scope保留。本包沿已过资源门，完成实际同包personal非空建议/明确确认/原请求核对、同一数据搬根和source确认、冷装/无执行器/多state/不同binary及跨schema升级。现成SDK fixture/verified candidate接口都存在，不再把main/C fixture未到当理由；工作确认前先持久暂停并assert native0。合入e438 schema guard，保留真实v1旧digest，A v2未准入就不声称支持。必要运行字节变化后准确新freeze早交E，helper/API/tuple必须来自同包，docs-only不重冻。

三个可运行source检查点交后继续整个goal，写`tools/distribution/reports/wave18-status.json`；只改launcher/distribution/portability。只在独立证明probe出生资源上做有限live，旧97危险路径仅mock，不碰十二实例/旧tar/profile/ledger；真实model/native0，显式owned paths推原分支。

## 发给Agent E

继续`/Users/hh/Desktop/joker/superagent-agent-e`、原分支`codex/g3-product-acceptance`，保留所有runs，合并最新main，读START-HERE/product-spec、wave18 README/0051，完整执行`agent-tasks/product-wave-18/agent-e-acceptance.zh-CN.md`。

旧exit/pointer等反例已过，但177PASS的installed-alpha PASS不能采信：安全case import当前D checkout修复，却给旧97cace7包补证；旧97冻结helper实际2PASS/3FAIL，新651才5/5。先让E5-D-OWNERSHIP-MOCKS从同一不可变包加载helper并核对文件hash/source/tuple，再把每个required case纳入subject关系。保留完整原report正对照，只换新651 helper provenance但旧97安装subject不变必须拒绝；不能用新源码为老binary认证安全。

然后消费准确651或后继安全包，完成同包personal SDK非空候选/context/history/source/reply、source确认、同一非空快照第二根readonly/held/无重发、升级/故障/数据保护与有界稳定性。fixture/source Hono通过不能写成installed；工作先真实持久暂停，私有mock绝不触发厂商native。三个source/证据检查点交后继续goal，写`tests/product-acceptance/reports/wave18-status.json`，明确纠正旧跨subject放行范围但保留历史。只改product-acceptance，不改生产/放宽required集；pilot BLOCKED、无新额度、十二服务/tar/账本/runs保留，显式拥有路径推原origin分支。
