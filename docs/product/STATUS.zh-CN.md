# 产品进度、完成度与当前可用范围

日期：2026-11-16。本次核对十位A–J的固定最新提交、主线代码、必要正反例和准确安装字节；不是按“Agent说完成”统计。读者入口：[如何使用](../ASSISTANT-GUIDE.zh-CN.md)、[架构](ARCHITECTURE.zh-CN.md)、[创新](INNOVATION.zh-CN.md)。

## 现在到哪一步

用户当前优先交付为：M系列Mac上本机可用、能分享同事的安装预览。先闭合安装/模型配置/项目导入/正常委托/检查/人工接受/数据保留/准确停止，不等待多协议、创新收益实验或完整活动恢复。体验和高级能力后续迭代；凭据、数据、写入授权与未知进程边界不降低。当前首版包与后续完整B目标分别验收。

已经是有真实产品流程的**本机个人开发助理预览**：主对话、显式委托、隔离工作区、问题中心、检查/patch/人工接受、会话项目管理、受限上下文与来源、明确决定、模板和使用观察。不是只有聊天页面，也不是八/十个生产执行器已经接入。

仍未达到稳定广泛内测/Beta。主要缺口是：同一原任务的中途故障恢复、完整原生控制/版本覆盖、准确新版安装包独立验收，以及真实两项目完整重开。创新机制有治理/接口基础，学习和复核收益尚未兑现。

## 完成度如何算

本机内测沿用2026-11-12冻结的12项权重。2026-11-16用户明确将CAC留待后续独立实验，当前完整方案B移出原CAC的5权重，保留其余70:15:10的相对权重，以95为分母归一化。历史含CAC口径保留，不把范围调整当新增实现。这里是工程估算，不是测试通过率、投入工时、稳定性概率或发行授权。

| 口径 | 原估算 | 当前估算 | 解读 |
| --- | --- | --- | --- |
| 首期稳定本机内测目标 | 69/100，约70% | **76/100，约75%**；工程区间70–80% | 基础功能较齐，关键恢复/控制/当前发行仍不能按完成计 |
| 当前完整方案B（不含CAC） | 同范围折算约53.5%（原含CAC为50.8/100） | **55.7/95 = 58.6%，约60%** | 包含多协议与创新收益；CAC不占当前交付、验收或完成度分母 |
| 最终发行准入 | 未通过 | **仍未通过** | P1/原恢复/新版同包与长期证据不能由平均分抵消 |

详细机器记录：[progress.json](../../reports/releases/wave32-admission/progress.json)的`currentSchemeB`为当前口径，`fullSchemeB`保留此前含CAC的55.7/100评估。历史[旧记录](../../reports/releases/wave13-admission/progress.json)保持不改。此前约55%变为当前约59%只来自移出CAC分母，本次新增功能为0；本机内测仍76/100，约75%。

### 同一分母的12项

| 能力 | 权重 | 当前计分 | 证据与扣分原因 |
| --- | ---: | ---: | --- |
| 主对话、流式与日常工作台 | 8 | 8 | HTTP/SSE、有限上下文、消息目录、桌面/手机已有消费者 |
| 项目导入、目录与设置版本 | 7 | 7 | 明确Git导入、会话目录、设置修订与归档 |
| 委托与版本化合同 | 8 | 8 | project/profile/scope/criteria确认、修订与旧身份守卫 |
| 隔离工作区与依赖准备 | 8 | 7 | worktree与授权单包pnpm离线缓存有实测；非任意monorepo/环境 |
| 检查、patch与人工接受 | 10 | 9 | 历史真实Codex正常链与当前受控交付通过；非全场景正确性 |
| 提问、回答与原生控制 | 10 | 6 | Broker/逐target记录/工作台已有，审批/steer/真实控制覆盖仍不足 |
| 回执、回复结果与审计持久化 | 10 | 8 | 原ID/事务/来源/未知结果不重发；完整恢复另计 |
| 活动任务恢复与资源屏障 | 10 | 4 | actual通信和Store ingress组件有进展，原Work故障到接受/原槽归还未达 |
| 非空备份、搬根与新授权 | 8 | 5 | v1/v2/非空/搬根只读恢复新增证据；目标执行新授权未闭合 |
| 当前个人安装、升级与多实例 | 10 | 7 | 准确R1普通启停/静态包有独立证据；R2未E同包/跨机长期未达 |
| 独立当前版本验收与稳定性 | 8 | 4 | E确已切R1；旅程oracle范围不足/R2未独立/长期未测，不能高计 |
| 缺执行器退化与接入收口 | 3 | 3 | main显式unavailable/discussion-only，正常讨论审阅可启动，不静默fixture回退 |
| 合计 | 100 | 76 | 仅四项因新实际证据增加7分，不按commit/人数/用例数加分 |

当前完整B：稳定内测70×76%=53.2分，多协议15×10%=1.5分，创新收益10×10%=1分，共55.7分；总权重95，归一化为58.6%。多协议和创新的10%只是既有接口/试验准备，不是第二协议或收益通过。CAC只保留未来适配可能性，当前不实施、不验收、不占排期，也不阻塞当前完成。

## 代码、安装包和运行实例不是同一个版本

| 层 | 准确身份 | 已证范围 | 未证范围 |
| --- | --- | --- | --- |
| main运行代码 | 303b2c6a（其后8deda18d为派工文档） | 原模板/观察下载/实际通信已集成；13观察+8模板干净网页，两受控Work明确接受 | 新A/C/F/G/J分支不自动在main；本轮未执行真实native |
| R1 | source82ee5b8f / build8296720d8a25f38c / tarSHA04926739… | E实测288PASS/0FAIL/19NT，记录的普通195/功能196门槛过；合法正常/恢复只读启停事实保留 | 两项目旅程/原Work重开范围不足；无新观察download；非全原生/全产品 |
| R2 | source c0a1f897 / build4dcd28f758bbb265 / tarSHA405ecd02… | 6864清单项/209closure，实际包含main303严格导出；D开发受控证据 | E尚无同R2独立结果；不含本轮新A/C/F/G/J候选 |
| 十位候选 | 固定HEAD见[清单](../../reports/releases/wave32-admission/workspaces.json) | 每位各自source/受控结果 | “提交了12项材料”不等于12项真实产品闭合 |
| 用户旧5180–5191实例 | 每个实例独立state与启动代码 | 保留原历史 | 不自动升级/迁移，不据仓库HEAD推它们的能力 |

R1 archive有6849个manifest项，R2为6864；目录tar entries与文件/链接manifest项不是同一计数，不能混成“漏文件”。准确路径/SHA/大小/环境见[发行验收](../../reports/releases/wave32-admission/delivery.json)。

R2已经真实产出，因此其它候选文档中的“还没有R2包”和“E仍ce64/1fba”是陈旧说明。本次以实际字节与E最终run为准。反过来，R2存在也不代表E已经验过。

## 十路验收后的真实结论

| 角色 | 已交与本次复验 | 仍未闭合 |
| --- | --- | --- |
| A 数据 | 历史originalbinding保持，新增source available计数；7项/严格检查过 | 每ticket50上限尚非源continuation；新计数未合main，A明确wholePackageComplete=false |
| B 执行 | spawn-intent工具、新attach caller有源码；诚实将后两包标未达 | 新caller payload协议错；numericPID仍可取得工具signal authority；原Store/Broker完整恢复未达 |
| C 上下文 | 51→50上游truncated旧P2真关，实际分页消费者2项过 | 缺旧coverage时unknown仍被包装为complete的新P2；开发工具不等main公共入口 |
| D 发行 | 准确R1/R2完整字节/closure、新根备份只读恢复、普通生命周期 | E R2独立、跨机/长期/部分故障；旧指南须按本页纠正 |
| E 独立验收 | R1同tar已验；旧knownchild/ppid/空after问题真关 | 缺fixed资源集合仍早clean；两项目/Work重开oracle会误接不足材料 |
| F 体验 | 导出loading/错误/重试/支持候选、20纯测试/组件状态/strict过 | 新支持面板等未进main/R2；候选受控截图不算已安装 |
| G 观察 | 实际主线下载/展示/未知/截断/CLI，19+2有限复验过 | 新support/CLI未合main/R2；无真实操作者收益或价格baseline |
| H 故障支持 | UNKNOWN出生失败直接kill旧问题关闭，7内置pure过 | 原launch/fullargv未和登记command核对；完整故障工具仍不准live |
| I 通信 | 原Store ingress与等价guard组件8项、通信模块和有限队列确有实现 | 非原Application/Broker整个恢复；terminal lease与原调度槽归还不由module tests证明 |
| J 项目声明 | freshness/rebind/CLI16项有限复验过 | rebind仅数据/CLI候选，未进main/R2；不自动改项目授权或恢复执行 |

报告中的“Broker-equivalent guard”“四个channel槽”“两个fixture Work”分别是组件证据，不能改写为原QuestionBroker完整流程、原scheduler四槽归还、两个真实项目旅程。

## 验收发现的阻断

1. **主线P1：terminal shutdown后remote lease仍接迟到receipt。** 已在实际service纯受控消费者复现；不能把close当所有业务回调静止。影响远端重接/恢复路径，不抹除已验证普通安装结果。
2. **未合B caller P1：payload-read字段/返回协议不对。** 新caller把reference当ref，且将chunk envelope当原payload返回，三回调尚未准入。
3. **B/H工具P1：完整独立出生身份仍有洞。** B可用numericPID和观察到的argv收编；H缺原launch与登记command一致性。仅mock验证，未对用户资源演示。
4. **E工具P1：known birth但缺完整fixed set时可被packageSTOPPED误当clean。** 该残余不否定带完整集合的实际正常stop事实，但禁止用它清理未知材料。
5. **E旅程P2：两个人项目preview均needs_input，实际交付落同一project-atlas；重开两Work found=false。** oracle仍过，故仅保留注册/context、单fixture两Work交付和消息持久化，不声称两项目全链重开。
6. C开发工具unknown覆盖、B复制handle及D陈旧指南等P2详见分报告。不能因为主线没用到某个候选工具，就把它算修完；也不把它们全混作默认网页漏洞。

## 下一步应该集中做什么

先收口以上实际缺口，减少继续造helper/接口/大包。三个完整产品结果优先：

1. **一个准确新版可重复用。** 修旅程断言和清理边界，独立验R2；两个不同原项目各自preview/apply/create/check/candidate/manualaccept，再在同安装实例重开读到原Work。不要用fixture代替原项目。
2. **一条同原Work恢复到交付。** 修terminal lease/newcaller和工具出生边界，使用原Store/Application/QuestionBroker，从同一Work故障接管到检查/候选/接受及原2/4槽实际归还。
3. **小规模日常使用与创新验证。** 有了稳定普通出口后，用真实任务记录质量、等待、人时代理和费用unknown；原复核试点依原预算/可行性门槛，不靠继续研发自动变出收益。

这三项是方向和验收出口，**本次没有新派发十位任务、重启实例、执行真实模型、替换包或刷新预算**。CAC移出当前完整B，留待后续独立实验；第二真实协议和创新验证仍属当前完整B，在可靠普通链收口后推进。桌面/自动接受仍后置。

## 查阅完整材料

- [使用指南](../ASSISTANT-GUIDE.zh-CN.md)：源码/安装、配置、第一次交付、故障与备份。
- [架构说明](ARCHITECTURE.zh-CN.md)：进程、七个模块组、请求/数据/执行/恢复、代码位置。
- [创新状态](INNOVATION.zh-CN.md)：原I1/I2/I3、独立复核、路由/注意力，怎样证明价值。
- [本次验收总表](../../reports/releases/wave32-admission/README.zh-CN.md)：命令、反例、准确source/tar及限制。
