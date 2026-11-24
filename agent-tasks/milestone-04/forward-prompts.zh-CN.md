# 里程碑04：可分别转发的开工话术

2026-11-24。现在只给 **B、D、E** 下发；main同时实施公共接线。四个角色共同推进两个结果，不启用十路wave。A/F遇具体阻断再参与；C等第二协议真实出口通过后启动创新，G/H/I/J待命。

所有角色先读根AGENTS.md、START-HERE.zh-CN.md、product-spec/README.md、[本次唯一实施计划](../../docs/product/MILESTONE-04.zh-CN.md)和[RFC0096](../../docs/rfcs/WP-16/0096-milestone-04-protocol-admission-and-target-authorization.md)。任务是从早交源码持续到同一个结果验收，不能做完探针或组件测试就停工。不要执行原wave队列。原目录/分支和dirty保留，不新建替代仓库，不整枝夹带旧候选。

如果当前分支未包含本次文档，可以先fetch origin，并用git show origin/main:<文档路径>读取；保留本地改动后再按原所有权合入必要基线，不reset/clean，不自动整枝导入未准入历史候选。每次交接给出最小精确commit/路径/消费命令和限制，推到自己原origin分支，不推main或upstream。

## 发给 Agent B

```text
你负责里程碑04“共享兼容探测 + 第二真实协议”的一块完整工程，持续做到原工作台真实交付、权限允许/拒绝及运行中停止，不只交研究报告或Driver包。

仍用 /Users/hh/Desktop/joker/superagent-agent-b，分支 codex/g1-runtime。先核对branch/status，保留历史/dirty。读 docs/product/MILESTONE-04.zh-CN.md 和根AGENTS；新方向已重开第二协议，旧wave和研究试点不恢复。

先从你拥有的Codex Driver、Catalog、DriverKit中实现一份可复用的零模型版本/schema/能力判定，尽早交main/D消费：已验证版本、未验证但兼容、不兼容、探测未知分开；检查实际使用字段/枚举/通知/ID，不只方法名。源码核到configuration的dispatch与native_test_passed规则，需要main先审RFC，不得私改contracts或把兼容伪标真实通过。这个小闭包交出后不停工，继续下面的ACP整条链。

用目标明确的零模型探测实际claude/opencode是否提供ACP，记录准确CLI/适配器版本与schema/initialize结果。文档中的版本只是线索，不是假定事实。Claude的headless JSON不是ACP；若需适配器，给main准确依赖与版本，不改根锁、不临时安装全局工具、不借账号。无真实prompt的握手/版本检查才算零模型。先确认可执行的工作区/网络/凭据策略，不能以“会弹审批”替代真实enforcement。

在 packages/drivers/acp-v1/ 实现原AgentDriverV1.inspect/serve/reconcile，复用AttemptIO、原问题target/answer身份、原持久事实和OwnedProcessHost。修改你的Runner可信工厂使它能创建该Driver；不改I拥有的attach-channel子树，不改冻结Runner wire v1。main负责多profile默认产品/策略构造/恢复解析/UI，你负责给出实际consumer和共享语义缺口，让main集中审RFC，不复制私有公共类型。

inspect不发送prompt；serve仅在原合法begin后发送；reconcile只核对原journal/owned运行，不重发业务。ACP响应只写出不等于native_applied。没有steer/恢复/澄清就逐项降级，不能用新turn假装steer。cancel确认不等于资源静止，原物理屏障确认后才能释放。

真实验收只有一个共享上限6次新prompt/turn，你是唯一发送者、单在途，main/D/E没有各自6次。先完成受控默认消费者、策略/问题/检查/接受/停止资源检查，经main确认就绪后再开始发送并在你的原native验收路径登记新grant。准备失败且证明确未发不计；实际发出即计1，UNKNOWN先占额核对，不能换ID重发或挪历史预算。禁止额外主对话模型请求和故障信号。

优先三个真实短任务：交付兼一次允许审批、一次拒绝审批、一次运行中停止；其余最多三次只修具体未达，不用满也行。必须通过正常工作台进入原Ticket/Assignment、原注册检查、current candidate和人工接受；组件模拟不能替代真实。权限未出现、提前自然结束或证据未知如实未达。把可读原证据交main/E零发送审计，拿不到token/cost写unknown。

持续责任到L2七项结论和一次简短抽象复盘。早交源码后继续联调，不等下一轮派工；只修本目标阻断，P0立即，其他新问题进backlog。检查点三行：L1/L2进度、剩余与下一consumer、需要用户决定的事。不要每轮造新JSON/派工文档，不提前启动创新复核。
```

## 发给 Agent D

```text
你负责里程碑04“同事能独立安装 + 非空备份新根继续使用”的分发整包，从入口实现持续负责到同一冻结包独立验收和具体阻断修复，不只交能打开的DMG。

仍用 /Users/hh/Desktop/joker/superagent-agent-d，分支 codex/g3-local-distribution，保留原dirty/历史。先读AGENTS和 docs/product/MILESTONE-04.zh-CN.md，不执行旧wave。原owned apps/launcher、tools/distribution、packages/portability不变。本轮临时委托你这几个main工具文件：tools/bootstrap/package-macos-app.mjs、package-personal-preview.mjs、personal-preview-launcher.mjs、verify-personal-preview.mjs、macos-app/Launcher.swift、macos-app/Icon.swift；仅这些文件，main会避免并写，产品手册与共享docs仍由main写。结束后临时工具所有权归回main。

现在可并行做安装/恢复/诊断消费者与必要修复，不等B完整ACP。消费B早交的同一兼容判定，在start/doctor/preview wrapper保持版本分类一致，禁止再维护独立版本白名单或fixture回退。文档中的Codex版本兼容不是把字符串比较删除，main会给公共分类与准入RFC。

沿现有非空bundle/restore/source确认/target材料接口准备新私有执行根。main负责显式新授权、原Application/HTTP/UI接线；你负责目标文件、普通启动、私有权限与旧原生任务不重放，不能删marker或把历史恢复库改成normal绕过。若遇A持久事实缺口交最小repro，由main激活A，不自建权限JSON或SQL写者。

现CLI support构造ProductStore可能触发迁移。把本轮要给同事的启动诊断入口改成真正readonly观测，并给E必要反例；进入网页后优先现有“试用准备→支持与诊断→导出诊断摘要”。只交metadata，不泄露源码、Key、account home、argv或绝对路径，导出由用户预览主动分享。不要广泛重做运维框架。

继续原build→preview→完整inventory验证→DMG流程；没有新桌面框架、证书工程或其他平台。验证M系列/macOS14+，中文locale、空格/重复目录、首次安装、停止重开、非空恢复、原Node身份不被签名改变。使用自己的私有测试实例，不碰十二用户实例，不升级全局runtime。

main点名准确source且版本兼容与新根授权所需运行源码都已集成后，冻结F0。把准确source/build/DMG SHA/闭包清单/Node身份和限制交E；E出结论前字节不变，不追HEAD、不为docs/tests重包。ACP只有已准入并实际入包才可声明包含。必要具体阻断或已准入ACP纳入最终包时，经main明确选择一次F1，保留两cohort，不能混旧PASS。

你没有真实模型额度；别代同事做真实开发。持续接main/E最小阻断至最终固定交付，同事联系由用户本人完成。没有同事反馈时等待并修同一结果已有阻断，不另开维护队列。检查点严格三行：清单进度、剩余与下一consumer、用户决定。完成只给一份同包交接，不每轮新增报告。
```

## 发给 Agent E

```text
你独立负责里程碑04最终准确安装包的验收，从现在的消费者准备持续到同事实测、迁移后新Work及最终结论；你保有断言权，不接受producer打印PASS代替事实。

仍用 /Users/hh/Desktop/joker/superagent-agent-e，分支 codex/g3-product-acceptance。只改 tests/product-acceptance/，保留历史/dirty/旧ledger，先读AGENTS、docs/product/MILESTONE-04.zh-CN.md、docs/COLLEAGUE-TRIAL.zh-CN.md。旧M03、W系列结论按准确cohort保留，不执行其旧队列。

现在先准备零模型独立消费者：版本/schema兼容分类与UI准入一致；未知或不兼容不伪标native_test_passed；无fixture回退；新鲜私有HOME/配置，中文locale、空格/重复路径、正常启停；包不依赖checkout/global Node/pnpm；非空恢复marker/旧业务保留，新根授权绑定当前principal/project/profile/generation；授权未知响应只核对同ID、不重放；源码/合同/资源changed或UNKNOWN要拒绝。通过原产品consumer观察，不给Store直接填造成功事实。

D冻结后只验给定准确DMG，自己核inventory/来源/SHA/运行身份，不跟HEAD。诊断必须真正readonly且脱敏；D尚未修复前不把CLI support说成只读，优先网页现有metadata摘要。不索取同事源码、数据库、完整日志或账号home。

你这条线真实模型发送为0；不能把代跑任务记成同事使用不计预算。另一台Mac必须由同事本人用自己的账号和真实项目完成首次交付、patch核对、正常重开，再非空备份/新根恢复/明确新授权/第二次新Work交付。用户联系和转交材料，你只按其主动导出的摘要、版本/包身份和问题描述做独立核对，缺证明确NOT_TESTED或“同事报告”，本机安装不冒充跨机。

main/B给第二协议原证据后，你可零发送核对原Ticket/Assignment/Question/answer/检查/接受/资源屏障，不能花B共享6次以外的新prompt。只看日志中“成功”不算身份/副作用证明。没有某项原始观察就记录局限，不强求上传同事私有内容。

把卡点分为阻断/体验/文档。只有直接阻断冻结出口的修复回main/D，普通候选缺陷进backlog，不开全面维护。F0结论前不换包；main明确F1后重新核影响旅程，旧包结果不能复制成新包结论。若无阻断可明确无需重包。最终一份同cohort独立结论和原12项计分依据，不生成每轮验收JSON，不混历史测试总数提高分数。

交源码后持续负责到这个结果关闭，不等用户每个小修重新派工。检查点三行：L1/L2进度、剩余与下一consumer、用户决定/所需同事反馈。
```

## main 同步执行，不用转发

main先提交共享兼容/准入和多Driver的最小RFC，尽早给B/D可消费接口；并行完成新根显式授权、默认普通入口与一页同事说明。接B的版本早交闭包和ACP默认消费者，逐profile恢复解析，不新增核心生命周期。稳定运行源码入main后点名D冻结，E出结论后给用户准确包/说明，请用户本人联系同事。按实际反馈闭环，不将同事等待变成新维护wave。

本文只完成了规划下发准备。未向外部B/D/E会话发消息，也没有替用户联系同事。创新C的开工包在L2出口成立时才激活，不要现在把十个agent全部启动。
