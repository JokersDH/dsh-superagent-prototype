# 0078：完整子系统交付前的已验输入

2026-11-15，main输入fb3d671d。固定A c80ec34c、B695efad8、Ce1a486ec、Df87034dd、E6369eea9、F901090ac、Ge7aec80e、Hf8cf5713、I861c03ed、Jbd027a44。十位原工作树/分支保持，main负责架构/公共接口/实际集成。详细source/命令/范围见本轮验收，不把新文档或“已import”替代实际采用。

## 已关闭的基础缺口

B与I核心coordinator/attach代码已是最终版本，actualRunnerAttachChannel替换本地pollqueue；missing/deny/throw守卫0写，合法两意图2次freshguard/2写，direct实际consumer strict通过。预算/五chunk/CAS原进展保持。I新sinkresponder/refusal模块尚未进B不是旧P1重现，B自己的responder已按 examined scope正确；以后只要一个真正执行的入口，不能为接口名字复制策略。

A严格canonical review key/schema/fullwork分类旧P2已关，6例/strict通过。C原Completion事实/J普通流3例/strict过。F blocked/discussion/expired和排除方向旧P2已关，8例/strict过，不再重建fields，只回传main0073受限selection。H已真实绑定当前B/I生产consumer（12I/5B positive）；其exit1是仍期待旧sink缺陷的stale assertion，不应继续叫“没有current消费者”。

D按requestedmode的六种argv兼容源修复成立，personal/fixture/恢复/惰性assistant各保原语义。新包1fbaf940d426fa34ff6289304e073b9159586ed9/build2d94a7c31ef97b57、SHAdaee1a94b43156cec659f7df2a3b08e1ecb89b645fde1ea81c35a81d75b47d7a，20458656B/6849项（6826files+23links）/schema18/ABI137，closure120/120全核。含J/G及实际安装包J6/6、2原Work人工接受，但缺main0076 7/30控件，不能称最新UI包。

E已从ce64切准确1ba，274PASS/0FAIL/20NT；普通186/functional187 required独立复算通过，完整188仍native未达。包内normal/restoredpersonal/start/stop STOPPED无fallback是实质功能进展，不能再说E永远旧包或functional失败；但未独立验D1fba/J或本轮main。

## 新运行时接管缺口

B remotelease收到native-write-intent时，同一frame仍经旧stdio pump发送到原连接，违反接管后的单owner通信。remote deny仍生效/旧reply拒绝，未证明当前main授权被绕过；但意图不能双发给旧coordinator。先保证同request只有当前lease/transport owner，再在一个真实原A/Broker sameRunner run中证明三callback，不以两个独立fixture拼结果。

原A/Broker sameWork崩溃后检查/currentCandidate/人工accept/2或4槽真归还仍未交。普通delivery5/5和controlled callback/SIGKILL素材是真进展，但JSONregistry/合成receipt不代替原Store/Broker。下一整包B必须把原三callback、safeSIGKILL、ACK未知和原Completion连到同一个Work的最终资源归还，而不在source/小测试检查点停工。

B信号工具仍可缺fullargv/用任意PID空args构造birth，默认first=false绕过完整resourceplan。Hregistry虽然拒普通JSON/psUNKNOWN，内部却保存返回给caller的同一可变record；caller改foreignPID和birth即可使原handle给新PID发signal（本轮只mock、无真实signal）。必须私有不可变出生事实、不可伪造handle、精确整组计划和每次fresh；UNKNOWN不是退出。不得为了跑恢复测试扩大工具停止权。

## 历史事实与当前权限

A新classifier把所有历史review按当前runtimebinding核验。真实原review在同ticket注册epoch+1后变0reviews/unclassified foreign_work_or_binding，coverage仍complete。应按原review attempt的历史binding验证历史事实，另以显式current标记核对现任，不把“旧事实有效”变旧执行权，也不因新的current抹掉旧事实。原ProductCompletion.current/metadata仍是当前完成依据，不新表/接受authority。

F新generic建议可声明scope.src而preview选择test（两者都在project grant）仍applicable且回调test，展示与作用不一致。main0077把scope和selection映射自同一serverfields，当前产品输入没有该矛盾，但F通用interface要核一致或无法表达时拒绝；不能把原完整fields重构搬回来。

J generic assertDraftCurrent允许同内容future观察，age只测过去未测未来；main每次freshfacts时间由服务器生成，当前没有外部facts输入。其metadata更强inode/size/mtime修复已合main，未来/格式currentconfig等通用重用边界交J完整治理，不把hash或timestamp当授权。

## E缺记录分支与发行证据

E已关闭known-live-birth/no-record默认两路误clean，默认retain正确。新forceproof分支引入ps -ax全局发现，失败返回空children被当clean，且未复用全record的birth/config核对，错config可TERM后release（仅mock）。hold该分支，不扩大“发现并强清”权限；基于spawn时完整已知birth集合/UNKNOWN处理，缺record不证明没有进程。

Efunctional记录resourcesAlive=[]从stop后已删除instance.json提PID得出，不能外推独立物理静止。必须在stop前固定资源，stop后逐个独立观察退出，无法观察保留UNKNOWN。这个是证据范围缺口，不是新产品stop功能失败；E1ba ordinary/functional实际STOPPED进展保留。

Dfixture-mode原raw中的restoredFixture却仍personal，与当前正确source/pure6不一致，重绑实际新运行记录而非贴标签。latestf870 installedJ6/6已取代旧中间NOT_REACHED报告，修文档不要求重冻同bytes。只有main新0076/0077确实改变runtime时冻结successor，然后E同tar独立验，不再互相用错版本循环。

## 主线此次合成

[0077](0077-main-workbench-product-composition.md)已把F受限建议/J稳定facts/当前原表单与Ddaemon/start/build接到main；保留原7/30窗口、未知响应同ID、原Scope/criteria/profile与人工接受。实际8模板/9观察/13后端/20纯state及mode/strict/build验证，准确clean source见报告。未合未准入B/I恢复、A历史classifier或Eforceproof。

四大出口是：当前项目日常交付、同包内部试用、同原Work恢复交付、可信数据/支持交接。每owner四个完整deliverable而非24/32小阶段，交运行source后继续整包。普通功能与native/value/private-target/blockedpilot分开，未测不补绿。

全部真实vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilotBLOCKED，无reset/topup/refund/补样/价格配方研究。原十二实例/全部state/profile/tar/ledger/dirty保持，无global发现/substring强杀/他人credential。原所有权不变，无新Driver/CAC/桌面/autoaccept/动态DAG/第二生命周期，不按人数/任务数重算历史完成度。
