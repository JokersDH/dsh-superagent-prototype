# Agent E：试点预算拒绝与独立产品准入整包

继续`/Users/hh/Desktop/joker/superagent-agent-e`、`codex/g3-product-acceptance`。读本轮[README](README.zh-CN.md)、[0026](../../docs/rfcs/WP-16/0026-wave-07-integration-and-admission.md)、修订01与冻结protocol。仅改`tests/product-acceptance/`，不改产品实现、B运行器、公共wire或别人断言。

3cfe445已有131条记录、真实pilot执行链及独立review-value tier；不要再重做tier拆分。实际试点仍0/24，旧预检只报告pricing_unavailable不足以授予执行。新发现runner的损坏账回退0、字节估算/裁小预留、缺B接口fallback CLI必须先纠正。

整包结果：试点使用唯一经准入的实际adapter并保留原账，能跑才做原8例三组；同时独立验证主线提案/恢复和D双binary安装，不让研究阻断产品验收。

E3现在可消费main源码627ef0d的真实提案prepare/confirm/reject HTTP，见[0028](../../docs/rfcs/WP-16/0028-wave-07-proposal-http-and-admission.md)，已有工作/修订/决定三种效果及同事务回执。网页尚待M3，恢复target启动尚未交；A/C/D独立失败分列，不能用本批79项后端/受控通过覆盖。原预算/统一adapter前置不变，main未消费任何pilot额度。

## E1 先修ledger与执行准入的fail-closed检查点

readLedger区分原始未创建与已有文件损坏/字段错/历史缺失；已存在但损坏不得回退全零。原授权累计账及unknown/reservation保留，写入/并发/重放/结算幂等，任何错误不得创造可用额度。

移除以bytes/4+padding和Math.min裁小作为硬上界的执行权限；允许估算展示但不可用来授权。mandatory B adapter缺失/版本漂移/证据过期拒绝，禁止fallback直连CLI；价格、整turn可执行上界、隔离、session与材料缺项分别报告。

验收：负数/NaN/无限/截断预算、坏JSON、伪造空账/旧账身份、重复预留/结算、unknown退款、价格单独补齐、B接口缺失/布尔伪证均不发送。使用本包fake发送计数，必须为0。先push这一可运行检查点，再继续独立项。

## E2 有条件执行原试点或交明确可行性阻断

前置为B1–B4实际同路径证据、E1持久账、冻结protocol与main明确准入，不因本任务下发或pricing文件出现自动满足。B给NO_SUPPORTED_BOUNDED_RECIPE时保留BLOCKED，不用CLI替代或更改样本；这不是“复核无收益”。

条件满足后仅消费原wave05-independent-review-pilot-01：总24原生turn启动=8作者+16复核、200000累计计费token、USD5任一先到停，一个在途。核对原实际ledger，作者同样预留，unknown不退款/换ID/补样本。所有底层输入/输出/reasoning/cache/多步请求计费纳入真实上界。

按冻结的作者检查点和候选材料运行不复核/续会话自查/新会话复核，保留原阈值、封存、结果盲法和等预算规则。promising/no-go/inconclusive/BLOCKED分清；不从合成数据推真实收益，不将缺样本自动补齐。变更recipe/协议必须main在保留原账条件下先版本化。

## E3 独立验收上下文与提案实际产品闭环

先从main已交决定/待办/Outcome/evidence做现有负例，main发布新入口后加上下文来源/窗口/失效与提案确认/拒绝/重放。必须走真实认证HTTP/SQLite，库导出或schema fixture不能算网页产品完成。

覆盖未确认无执行、原命令失败无confirmed半状态、响应未知保持同命令、source/actor/grant/scope/profile/版本漂移、撤销后上下文失效、跨项目隔离和重开。真实模型0，以已有controlled输入测产品编排，实际模型范围单列。

## E4 独立验收两个真实二进制的安装升级

拿D冻结的两份实际不同source/binary产物，在新根实际安装/启动/doctor/备份/升级/失败恢复/停止。优先复现PA_CONFIG_ROOT可信release.json初始化，核对执行进程/端口/安装根/配置根及作者checkout独立性。

升级后新增数据再测试旧binary拒绝/兼容；不得把静默恢复旧备份当无损rollback。tag-only产物、缺第二binary、source不匹配均不能PASS。记录原始命令/退出码、source/build/tar摘要和实际数据状态，不由D自测替代。

## E5 独立覆盖恢复授权与有界稳定性

main恢复commit实际发布后，结合A事实/D启动在隔离实例验证：源历史只读、旧queue/marker保留、新执行state初始空、source提交为唯一权威、错路径/摘要/期限/目标拒绝、响应丢失/重启不重复授权。

覆盖source提交前后/目标半准备/激活指针切换的受控中断；未知物理writer不因旧ended/PID缺失/新state而获准。再备份恢复不继承可执行权限。用有限时长/次数稳定性测试，不无限轮询；未交实际入口保持NOT_TESTED并指main，不能用prepare预检代替。

## E6 出分层结论并关闭过时阻断

权威`tests/product-acceptance/reports/wave07-status.json`分列module/controlled-product/actual-native-control/installed-alpha/review-value，每项source/evidence/owner明确。review-value不要求第二协议；安装/产品不依赖E2收益，原生未测不能被controlled PASS遮住。

交branch/base/tested source、冻结artifact、实测命令/退出码、实际grant reserved/used/unknown、失败最小复现和下一动作。先E1后连续E3/E4准备/预算负例，不在pilot阻断后结束整包；只push原分支，不动六组用户服务、不刷新预算或更改断言使产品变绿。
