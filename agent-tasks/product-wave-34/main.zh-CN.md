# main：原执行、日常工作与数据消费者持续集成

2026-11-16。原目录 `/Users/hh/Desktop/joker/superagent`，原分支 `codex/g2-execution-integration`。读AGENTS/START-HERE/product-spec/README、本轮[README](README.zh-CN.md)、[0086](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)、[0087](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)、[0088](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。

一个whole goal覆盖两连续工程包、六个完整成果。已交source不等整goal完成；早/中/终发布后继续联调及独立队列，不按每个小fix派新轮，不承诺同日/工时/token。

## 已交检查点

`23d5a98e`：原NativeProductAttempt共用fact/payload/一次性fresh native guard，随原RunningAttempt提供Node attachCallbacks；Gmetadata support→严格DTO→认证GET→实际App有界下载。15原类/Store回归、5support、4原导出、241contracts/strict/build通过。真实App16观察/9模板过，两受控Work人工接受。0086为准确接口和边界。

无自动attach/新feed/cancel/newSlotScheduler；没有Native.launch/原Work故障恢复准入，A有界历史/C完整快照仍待准入。origin未知保持null，G通用上传handler没有挂公共HTTP。

## 工程包一：完整原执行和当前数据的生产消费

### 成果一：原Broker三回调与当前租约控制接线

消费B/I修复后的原RunnerLinkClient/service控制，复用已交attachPort/attachCallbacks，保持同Work/contract/attempt/producer/原问题/原命令及Store ACK。

先修B外来cancel先副作用、旧lease/stopped feed和不可伪造spawn来源；只导入审过的最小闭包。每native effect走原fresh guard、显式allowed；数据ACK与write permission分开，detach后unknown不自动重发。

实际consumer在原ProductExecution/NativeProductAttempt/Application/QuestionBroker，先同进程重接，再原登记恢复；不以等价guard/新coordinator/ledger替代。补合法原Q&A与foreign/stale/missing/deny/throw/void负例。

交source让B/H独立消费，保留source层与native/launch层差别；小接口缺口及时给出可编译加法port，不让B整包等主线。

### 成果二：同原Work故障续接到可信交付

从原已登记attempt/producer接续事实、immutable payload、问题答案/unknown reconciliation；原Store/当前binding/Scope/合同版本分别核对，旧允许不迁移，原end_turn不自动交付。

通过原check/currentCandidate/actions.available/manualaccept→delivered→原ID/全产物重开，再由原scheduler观察2/4资源归还。模块close、JSONregistry或独立内存队列都不是物理quiescence/原槽证明。

本地受控故障必须先有完整knownspawn不可伪造出生/全资源先验，逐signal fresh；不能安全执行就保留相应HELD，不用unsafe live补证。main/B/H消费同一实际路径。

交接原对象/receipt、时间/故障窗口、所有资源结果、独立consumer命令。真实vendor/native保持0，受控恢复不借用为native能力通过。

### 成果三：原Work可用的完整历史与来源体验

A修全kind编码预算和oversized不可推进后，再接严格public history DTO、认证principal/current project/Scope和签名当前filter cursor。内部cursor不是授权；不把raw attempt binding送浏览器，不把physical available当authentic reviews。

F呈现非空历史/current/partial/omitted与逐页浏览，保持原evidence/产物权限和历史validity原binding。A live keyset不是冻结多页snapshot，追加语义需诚实。

实际consumer覆盖两原项目的历史/验证/合同/复核分类、跨filter/tamper/零进度/超界/旧模块兼容；点击回原对象而不是新history应用。没有新candidate表/迁移/ledger。

交接API/schema/生成、实际App与A/C/F consumer，原Completion/current/preflight/accept不因历史列表变化放松。

## 工程包二：日常产品、部署与完整交接

### 成果四：当前决定和项目重识别进入原确认流程

C修完整Scope/来源/时间/version/shape快照后，main用当前trusted records与原prepare/assert/explicit confirmation接新Work选定决定。选择发生在create之前，version/source变化要求重预览；不接受客户端valid作为权限。

接J最小rebind/module闭包到原注册/metadata reader与原form，current/changed/unbound/reidentified仅数据。旧Work历史不改，新root/新项目仍走原授权；恢复readonly不被match解除。

实际App包含选择/预览/取消/编辑/显式确认/迟到response/撤销/过期/配置变更与旧模块fallback。取消/预览0business writes，unknown commandId保持原ID。

交接C/J/F/H实际consumer以及同一source的必要正负；先发布接口，再持续联调完整工作。

### 成果五：本机配置、支持与错误恢复的完整体验

在原认证本机入口完成模型连接配置/验证表单，key私有0600不回显/不写浏览器持久储存；保存不自动发模型任务。使用当前明确配置，不访问其他credentials或真实CLI回退。

复用已交support导出，D有可信runtime identity时才接真实build/source/archive/capability投影；当前未知保持未知。F完成首次使用、missing executor/auth/输入/失败恢复及手机键盘focus，原用户草稿不丢失。

实际consumer由真实App/API/private config组成，有限mock网络正负、不发实际vendor；当前身份变更取消旧downloads/观察，错误不回显secret/私有路径。

交接同事可操作的日常使用/诊断/修复路径，及无配置也能讨论/审阅的退化行为；不新建桌面端或第二设置中心。

### 成果六：同一工程版本的独立日常交付与可维护发行

main持续导入各owner可审稳定源码，真实App/core/Broker/SQLite/Workspaces/check/accept联调。两原项目分别受控完成/失败修复/重开、非空history/来源/支持与恢复层逐项记录。

D先给固定W33旧cohort供E独立结论，必要新runtime再冻结一次完整successor；E只用准确包内source，main不改其断言。docs/test-only不refreeze，不把多个cohort计数说成单包全过。

更新使用/架构/创新/进度，source/controlled/installed/native/recovery/value分别说明。不能因六成果/66计划/测试多就自动上调76/58.6%或发行授权。

交接实际可用源码、完整代码地图、准确可重复验证与当前包限制；安装是完整工程一部分，CAC后置不占当前验收分母。

## 独立备选队列

外部输入只阻对应项；继续owned公共DTO/当前授权/错误/配置/观察/原form/整链consumer与文档。不改候选工作树、不写第二reader或状态机、不重复长soak。先给源码接口，后续集成保持同一真实生命周期。

## 所有权和边界

main拥有root/contracts/config/lock/HTTP/provider/App/transport/globalCSS/跨模块集成，排除F trial src/test/e2e；导入固定审过源码不修改其候选树。A唯一生产迁移，E唯一productassertions，I唯一communication，B runner排除I。

状态 `reports/releases/wave34-integration/status.json`，显式路径push `origin HEAD:main`，neverupstream/reset/清状态。

自动真实vendor/model/native0；Bcap4UNKNOWN不可花、E原24turn/200000token/USD5/oneflightpilotBLOCKED，不重置/补额/退款/借凭据/price研究。十二5180/8796至5191/8807和全部state/profile/tar/ledger/dirty/runs保持。

不global discovery/substringkill/绕产品拒绝清理。完整原spawn/PID/start/UID/fullargv/root/config/op/fullresources先验并逐次fresh；UNKNOWNretain。无新Driver/CAC/desktop/autoaccept/writer racing/dynamicDAG/第二生命周期。

## 整包完成条件

六成果均有实现、真实consumer、必要正负、source交接与准确未达层。已交回调/support不是整个main goal完成；发布后继续两包/联调/独立队列，不以文档/孤立helper算整链，不等待一次小修重派。
