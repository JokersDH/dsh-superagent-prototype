# E：当前同一包行为证据与独立验收整包

继续`/Users/hh/Desktop/joker/superagent-agent-e`和`codex/g3-product-acceptance`，只改product-acceptance及自有证据，保留全部runs。读README/0047，同步当前main。167PASS/16NT只代表77d59c2测试与旧114b73c subject；不认证D8962d10或main新候选。真实模型/native0，原pilot保持BLOCKED。

## E1 完整一致的行为正对照

保留本轮已经通过的真实RUNNING personal HTTP正对照与旧五项精确拒绝：mode、health/readiness、child exit/status、source/build/hash/bytes/schema/ABI/platform/arch及本次动作结果一致。本轮新缺口是fault recovery仍只核对status非空；逐步骤绑定真实recover的exit/status/code/operation、前后进程与pointer/data，不把旧已关闭项重新称未修。

## E2 逐项精确变异

保持上述同一正对照其他字段不变，新增actual recover BLOCKED+exit2+unknown_live_resource、成功status却exit1、错operation及pointer/data未到位的精确变异。兼容成功终态须与D真实CLI约定一致，E独立验证而非直接采信D自评。旧BLOCKED/null health、fixture mode、missing exit、step-only、foreign ABI等拒绝继续保留，不能让不相关前置掩盖新条件。

## E3 D归属纯mock独立门

自己导入当前D实际导出，完整mock身份读取和signals，复验0047所有旧/新反例及producer/record/后代/停止后三态。先有完整正对照再注入未知；拒绝时signal0。安全门未过不跑广泛live安装/cleanup。阶段1–3交早期assertion源码与门结果。

## E4 当前主线实际候选流程

消费main1169535及其SDK私有本机mock，独立测default-off→非空回复→GET/指针prepare→补输入→原confirm/reject、丢响应重放、修订目标变化与普通流式回归。不要手造verified wrapper或只跑main测试当独立结果。不改产品UI；必要截屏只核实当前实际页面与已知动作区，禁止重复全站设计检测。

## E5 当前新tar同subject安装

先按D已冻结8962d10准确字节测试其真实已有scope；D交新建议版tar后建立新的独立subject，不能重新贴旧结果。运行personal冷装/复用、mode、health/readiness与实际context/history/source/reply/候选能力，测试source和productsource分列。旧缺新功能是时间范围差，不自动称回归。

## E6 无模型的个人业务动作

用私有fixture模型配置指向本机mock，实际personal HTTP讨论/上下文/结果/候选读验，不读写用户全局模型配置。若当前personal profile会执行原生任务，须先通过真实持久派工暂停并核实再明确创建held工作；所有真实native发送断言0。无执行器实例保留discussion-only范围，不拿fixture mode冒充personal。阶段4–6交中期同包组合。

## E7 非空备份与搬根

消费A完整manifest修复与实际非空数据配方，至少含原reply body/index/digest、来源记录/决定、工作及held queue。恢复第二root后审阅正文与原命令、缺artifact和部分manifest应拒绝；只读marker/旧writer屏障保持。数据恢复PASS不是目标执行授权。

## E8 当前binary升级与故障

消费D安全门已过的不同binary18→18及legacy16→18，核验actual operation、spawn/record/pointer/ACK前后与退出码/实际数据。升级后写入保护和拒绝回退必须有具体证据。旧step PASS标签不替代真实过程，NT/UNKNOWN必须继续阻止其required tier。

## E9 有界稳定性与当前能力门

在新私有资源上进行有限时长SSE重连/刷新/服务重开/并发只读、候选重复确认和held queue归还，捕获一次关键负例及实际资源归还。只扩有风险的窗口，不循环凑48h或测试数。main source-confirm/许可或B业务port未到时准确NOT_REACHED；已有M1–M3不能继续写入口缺失。

## E10 最终独立交接

写`tests/product-acceptance/reports/wave16-status.json`，第三源码checkpoint与冻结subject/运行证据、required tier逐项结果一并交付。清理文档中的过时next/mainSource/currentMainInstall矛盾，不删除旧记录。禁止通过改断言、状态映射或放宽required集让本次变绿；完整release仍由main独立决定。

## 独立备选队列

- D新tar未到：当前main候选/HTTP/SSE独立验证、行为正对照/变异和D纯mock先做。
- D安全未过：不做live stop/install/cleanup矩阵；旧已测tar保留scope。
- 激活/pilot未到：继续普通安装与产品能力，禁止自动真实模型发送或旧预算重置。
