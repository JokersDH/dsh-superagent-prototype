# 产品进度、完成度与当前可用范围

日期：2026-11-19。本次只核主动B/H固定交付并继续原主线；其余八位待命，不为用满人数扩任务。读者入口：[如何使用](../ASSISTANT-GUIDE.zh-CN.md)、[架构](ARCHITECTURE.zh-CN.md)、[创新](INNOVATION.zh-CN.md)。

选项A收尾清单当前 **4/6（第4项为UNKNOWN，里程碑不关闭）**：受控三窗口/2&4、finalize受控流程、主线H消费者清理、一次真实Codex短任务已完成；隔离coordinator SIGKILL探针在发信号前因探针配置错误失败，按用户规则不重试；原12项计分待清单闭合后执行，当前不新开wave。

当前新增结果：[11-19验收](../../reports/releases/recovery-milestone-01/admission-2026-11-19.json)。main **6d309128**已通过2/4同run原Work故障恢复→检查/人工接受→自身槽归还→原第3/5项前进，UNKNOWN其余槽保留，42测试/strict。H原next-slot失败是测试factory禁止排队Work首次spawn，生产容量无需放松。B postcommit组件已被主线接入，Store屏障提交后以完整manifest digest和同confirmationId finalize；相关回归通过。剩余是finalize响应丢失同ID调和、H测试UNKNOWN清理和真实native/物理未测，历史最近估算不自动上调。以下旧日期结果按当时范围阅读。

此前[11-18验收](../../reports/releases/recovery-milestone-01/admission-2026-11-18.json)的三种受控故障窗口及独立容量测试保留；11-19已进一步组合成同run。真实Runner EOF的fake-driver组件与virtual ProcessHost组合仍不是同一真实物理消费者，不能据此宣称完整真实原生恢复。

**用户已确认：本阶段不推进复核价值试点、依赖它的第二协议复核和路由收益研究，价值未测。** 原协议、ledger、fixture、报告保留，不重置/退款/补样/研究计价；自动模型/native仍0。此范围决定不自动改变既有分母和历史最近评估。

## 现在到哪一步

本轮重点是main/B/H同一个终态生命周期的持久确认和独立验收。D/E固定W36七项安装子集已独立核验，来源audit199/199匹配、归档未变，本项结束待命；它不认证当前6d恢复source。未采用的B信号工具/I host/G身份模块缺陷继续禁用并登记，不自动加入当前前置或新任务线。

用户目标仍是完成方案B整体工程（CAC暂不包含），最终提供本机可用、可分享同事的安装交付。当前按关键路径顺序完成已有目标，仅main/B/H主动，其余按具体阻断调用；不以全员并行或扩大功能范围代替进度。M系列Mac是先支持的平台，当前不追移动main突击ZIP。

已经是有真实产品流程的**本机个人开发助理预览**：主对话、显式委托、隔离工作区、问题中心、检查/patch/人工接受、会话项目管理、受限上下文与来源、明确决定、模板和使用观察。不是只有聊天页面，也不是八/十个生产执行器已经接入。

仍未达到稳定广泛内测/Beta。主要缺口是：同一原任务的中途故障恢复、完整原生控制/版本覆盖、准确新版安装包独立验收，以及真实两项目完整重开。创新机制有治理/接口基础，学习和复核收益尚未兑现。

## 完成度如何算

本机内测沿用2026-11-12冻结的12项权重。2026-11-16用户明确将CAC留待后续独立实验，当前完整方案B移出原CAC的5权重，保留其余70:15:10的相对权重，以95为分母归一化。历史含CAC口径保留，不把范围调整当新增实现。这里是工程估算，不是测试通过率、投入工时、稳定性概率或发行授权。

| 口径 | 原估算 | 当前估算 | 解读 |
| --- | --- | --- | --- |
| 首期稳定本机内测目标 | 69/100，约70% | **76/100，约75%**；工程区间70–80% | 基础功能较齐，关键恢复/控制/当前发行仍不能按完成计 |
| 当前完整方案B（不含CAC） | 同范围折算约53.5%（原含CAC为50.8/100） | **55.7/95 = 58.6%，约60%** | 包含多协议与创新收益；CAC不占当前交付、验收或完成度分母 |
| 最终发行准入 | 未通过 | **仍未通过** | P1/原恢复/新版同包与长期证据不能由平均分抵消 |

详细机器记录：[progress.json](../../reports/releases/wave32-admission/progress.json)的`currentSchemeB`为当前口径，`fullSchemeB`保留此前含CAC的55.7/100评估。历史[旧记录](../../reports/releases/wave13-admission/progress.json)保持不改。此前约55%变约59%来自移出CAC分母；此后新增功能单独列证据，尚未据此重新计分。本机内测仍76/100，约75%。

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
| 当前个人安装、升级与多实例 | 10 | 7 | W35独立子集和W36静态/开发安装有新证据；W36未E同包/跨机长期未达，待统一重评 |
| 独立当前版本验收与稳定性 | 8 | 4 | E已W35子集，非所有要求同包；W36独立/原项目/长期未测，待统一重评 |
| 缺执行器退化与接入收口 | 3 | 3 | main显式unavailable/discussion-only，正常讨论审阅可启动，不静默fixture回退 |
| 合计 | 100 | 76 | 仅四项因新实际证据增加7分，不按commit/人数/用例数加分 |

当前完整B：稳定内测70×76%=53.2分，多协议15×10%=1.5分，创新收益10×10%=1分，共55.7分；总权重95，归一化为58.6%。多协议和创新的10%只是既有接口/试验准备，不是第二协议或收益通过。CAC只保留未来适配可能性，当前不实施、不验收、不占排期，也不阻塞当前完成。

## 代码、安装包和运行实例不是同一个版本

| 层 | 准确身份 | 已证范围 | 未证范围 |
| --- | --- | --- | --- |
| main运行代码 | 6d309128，继承e226/83b3 | 三受控窗口、原2/4同run故障交付/UNKNOWN占位/第3&5项前进，42测试/strict | 虚拟host组合不等真实native/物理通过；B终态持久确认未闭，新source未安装独立验 |
| R1 | source82ee5b8f / build8296720d8a25f38c / tarSHA04926739… | E最新290PASS/0FAIL/20NT，recorded普通197/功能198过；合法启停保留，同fixture Work真重开found=true新增 | 两原project完整旅程仍未达，oracle仍会接不足材料；新ZIPcase实际只用R1tar；无新观察download，非全原生/全产品 |
| R2 | source c0a1f897 / build4dcd28f758bbb265 / tarSHA405ecd02… | 6864清单项/209closure，实际包含main303严格导出；D开发受控证据 | E尚无同R2独立结果；不含本轮新A/C/F/G/J候选 |
| W32候选 | sourcee8348a86 / build88eb8c69b0671171 / innerSHA65c386d1… / outerSHA0a46cd36… | 全量静态；E新actual ZIP包内Node/启动/非空原Work备份/readonly HTTP读取是真实进展 | E306/20NT、普通199/功能200是R1+W32 aggregate，不是W32全套或W33；未含fc38 |
| 已测子集W33 | source048f0184 / buildf880e5bc9c6c1c57 / innerSHAee45c92c… / outerSHA46e01c8c… | 原静态不变；D两Work/8产物bytes与真实rollback retry；E同W33 outer/非空recovery/upgrade子集 | E336/21NT、普通204/功能205仍mixed legacy范围，full206native拒；未含23d/4cde新功能 |
| W35已测子集 | sourceedfe5e14 / build599de3e98c02de0b / innerSHA11027a37… / outerSHA39c0fff0… | E真实同W35 outer/model-save/非空恢复/upgrade；D原重试CONFIRMED。聚合347PASS/22NT、普通212/功能213通过 | 聚合还含R1/W33/W32，不是所有要求同W35；full214native拒，历史404属时间范围 |
| 固定W36已测子集 | source087a598e / build14a6b457ea285988 / innerSHA13798190… / outerSHA43e06d5b… | D199/199来源匹配，原包未变；E七项同包安装/配置/非空恢复/受控交付/三kind点击成立 | 聚合219/220非全部同W36，full221native拒；不认证d624新恢复，不含新同包managed upgrade |
| 十位候选 | 固定HEAD见[清单](../../reports/releases/wave37-admission/workspaces.json) | 真实source/受控修复见最新分报告 | 候选/静态/正常链不等完整恢复或安装准入 |
| 用户旧5180–5191实例 | 每个实例独立state与启动代码 | 保留原历史 | 不自动升级/迁移，不据仓库HEAD推它们的能力 |

R1 archive有6849个manifest项，R2为6864；目录tar entries与文件/链接manifest项不是同一计数，不能混成“漏文件”。准确路径/SHA/大小/环境见[发行验收](../../reports/releases/wave32-admission/delivery.json)。

E已完成固定W36七项独立子集，D来源报告修正没有重包，双方此项结束待命。旧W35 upgrade及聚合/未测仍各守范围，见[当前发行验收](../../reports/releases/recovery-milestone-01/install-admission-2026-11-18.json)。主线恢复稳定后才明确后继，不追移动HEAD。

## 此前Wave31验收快照

以下为上一版计分对应的历史快照，部分问题已关闭，不能作当前缺口清单；最新十路结论以[Wave33提交验收](../../reports/releases/wave34-admission/README.zh-CN.md)和0086主线实际接入为准。

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

## 此前阻断与当前收口

以下编号原问题保留来由，按历史范围读。当前C草稿/expiry/strict、Eparentdead缺set/helper及actual ZIP旧问题也已关闭；新B原型spawn/foreigncancel写后拒绝/旧leasefeed、A总预算、C完整snapshot、Ecaller finally/oracle仍需完成。原Work/Broker恢复与原2/4槽未达；H已真正等待available后接受重开，不能再据旧抢跑松gate。

1. **审查时主线P1：terminal shutdown后remote lease仍接迟到receipt。** 在303b源码实际service纯受控消费者复现；随后b72e935d已用现有attach.close关闭终态lease与pending，18项针对性回归和strict通过，仍running时临时断连接管保留。该修复不等于同原Work完整恢复已通过，也不把旧R2重标为含修复。
2. **未合B caller P1：payload-read字段/返回协议不对。** 新caller把reference当ref，且将chunk envelope当原payload返回，三回调尚未准入。
3. **B/H工具P1：完整独立出生身份仍有洞。** B可用numericPID和观察到的argv收编；H缺原launch与登记command一致性。仅mock验证，未对用户资源演示。
4. **E工具P1：known birth但缺完整fixed set时可被packageSTOPPED误当clean。** 该残余不否定带完整集合的实际正常stop事实，但禁止用它清理未知材料。
5. **E旅程P2：两个人项目preview均needs_input，实际交付落同一project-atlas；重开两Work found=false。** oracle仍过，故仅保留注册/context、单fixture两Work交付和消息持久化，不声称两项目全链重开。
6. C开发工具unknown覆盖、B复制handle及D陈旧指南等P2详见分报告。不能因为主线没用到某个候选工具，就把它算修完；也不把它们全混作默认网页漏洞。

## 下一步应该集中做什么

先收口以上实际缺口，减少继续造helper/接口/大包。三个完整产品结果优先：

1. **固定包本项结束，保留准确范围。** W36七项独立子集与selected audit更正已通过，D/E转待命；完整原项目、原生及新source不借此准入。恢复稳定后才选明确后继，不追移动main重包。
2. **继续同原Work恢复的剩余窗口。** 受控问题窗口接管到交付已实现，只main/B/H补真实stdio断连、业务ACK未知、terminal故障和原2/4槽/完整资源归还；未用候选工具不作为前置，不增加功能线。
3. **现有能力的维护与准确观察。** 保留质量、等待、人时代理和费用unknown的真实记录；本阶段不推进复核价值、第二协议复核和路由收益研究，不为研究退出宣称负结论或新增完成分。

当前只派[恢复里程碑01](../../agent-tasks/recovery-milestone-01/README.zh-CN.md)，source早交后持续集成/联调/复验和包内维护，不逐小修重派；由用户转发，不声称自动启动外部chat。未重启实例、执行真实模型、替换包或刷新预算。CAC/桌面/自动接受后置；暂停的研究保留历史设计，当前不扩第二协议功能。

## 查阅完整材料

- [使用指南](../ASSISTANT-GUIDE.zh-CN.md)：源码/安装、配置、第一次交付、故障与备份。
- [架构说明](ARCHITECTURE.zh-CN.md)：进程、七个模块组、请求/数据/执行/恢复、代码位置。
- [创新状态](INNOVATION.zh-CN.md)：原I1/I2/I3、独立复核、路由/注意力，怎样证明价值。
- [最新验收总表](../../reports/releases/wave37-admission/README.zh-CN.md)：命令、反例、准确source/tar及限制；原计分来由保留在wave32报告。
