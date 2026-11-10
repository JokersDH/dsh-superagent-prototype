# 第四轮：稳定接口、已复现阻断与并行消费

日期2026-11-10；输入main `a42924a`。这次用户要求A–E完成上一包后继续并行，执行入口为 [product-wave-04](../../../agent-tasks/product-wave-04/README.zh-CN.md)。主线先交可直接消费的公共持久接口和恢复只读入口，再继续项目设置/助理/UI组合。

## 实际复核的候选

| 角色 | 候选 | 已确认范围 / 新阻断 |
| --- | --- | --- |
| A | c74f2c6 | 旧storage75/workflows9和主线会话纵向已通过；决定缺来源元数据、提案仅内存、会话成员仍扫描，需下一持久接口 |
| B | 549c57b | wave03报告0真实native；14项harness自测通过但B2/3/4有假通过与证据不足；真实入口尚未接持久预算 |
| C | 2441281（已进入main） | 包内53项不覆盖三项独立准入失败；生产助理仍关闭 |
| D | 73cafed | 包内28+15+28-step范围保留；独立tmp探针确认活跃回滚、同大小漂移；恢复后start及实例复用也有阻断 |
| E | 6dee03f | controlled流程/浏览器/有限稳定性为限定证据；独立纯gate探针确认未执行native仍可full-product PASS |

并行审查只读外部checkout/源码；独立probe只写自有tmp或主线reports，未修改A–E源码、锁、状态，未发模型请求。没有将B/D/E未修复候选合成可用发布入口。

## A/C共同持久接口

单一来源：`packages/contracts/src/assistant-state.ts`，导出 `PersistedDecisionSchema`、`PersistedProposalSchema` 与 `AssistantStatePort`。这是内部服务/持久化约定，未扩大frozen Runner/data wire和HTTP命令集合。

决定记录保留frozen UserDecision、sourceMessageId/sourceTextDigest/conversationId、actorRef/recordedAt和可选revokedBy。提案记录保留完整source/grant/project/contract/payload/digest/时间/状态/version；confirmed版本含effectCommandId，superseded版本含supersededBy。用户和模型不能通过这些字段授予执行权限；值由可信组合产生。

```ts
interface AssistantStatePort {
  decisions: {
    get(id: string): PersistedDecision | undefined
    list(query: AssistantStateQuery): AssistantStatePage<PersistedDecision>
    put(record: PersistedDecision, expectedVersion: number): {record: PersistedDecision; replayed: boolean}
    history(id: string, limit?: number): readonly PersistedDecision[]
  }
  proposals: {
    get(id: string): PersistedProposal | undefined
    list(query: AssistantStateQuery): AssistantStatePage<PersistedProposal>
    put(record: PersistedProposal, expectedVersion: number): {record: PersistedProposal; replayed: boolean}
    history(id: string, limit?: number): readonly PersistedProposal[]
  }
}
```

真实类型以contracts源码为准。A从`createWorkflowPorts(store).assistant`暴露；C导入同一port，不复制私有替代版本。所有方法同步并加入调用者现有UnitOfWork；put创建expectedVersion0/version1，后续CAS+1，同版本同完整body重放、不同body冲突。旧缺来源决定保留审计但不伪造有效来源。

C的prepare异步阶段只读并返回不可变候选/来源快照，commit同步阶段在main事务中重新检查source digest、actor/grant/合同/版本与物理条件，经A port落记录；main在同事务写确定性命令、receipt/event/effect。任何commit失败全部回滚。普通reply没有执行效果；提案确认不是另一个Work生命周期。

本检查点提供schema/port及2项契约测试，A的持久实现和C的prepare/commit消费者尚待本轮实现；不能称决定或提案产品功能已可用。

## D/main恢复启动接口已实现

`apps/coordinator/product/demo.ts`新增`--startup-mode recovery_readonly`；state根存在`restore-report.json`时即使传normal/native/assistant也强制恢复只读。不调用nativeStartup，不创建PrivateModelProvider，不调用product.start，因而不消费execution/answer/assistant/verification等Effects。

认证HTTP健康投影包含`startupMode: recovery_readonly`；正常模式保留旧health形状，缺该字段表示normal。恢复只读允许认证查询与登录/退出；业务POST统一422 unsupported_capability/retry:none。configuration派工关闭、snapshot/work actions清空、verification.retryAvailable=false。鉴权、Host/Origin和schema防护保留。

这不是物理只读SQLite文件：正常启动仍可初始化凭据、升级schema、获取/心跳writer锁，并创建产品必要目录。它保证的是不发模型/原生业务、不消费旧业务队列、不对外授权写命令。若未来要求字节完全不变，需要另设纯离线查看器，不能与这个模式混称。

D负责把startupMode纳入期望实例身份与UI入口，不能删除restore marker或自建绕过开关。解除隔离尚未实现：main随后定义本地重绑定、当前环境/政策/原生认证和物理资源复验后的新授权；未准入前恢复实例只用于查历史/诊断，不承诺旧native session续跑。

独立进程测试：预存execute/assistant/answer队列→restore marker→normal+native+assistant启动→HTTP确认只读/拒绝命令→停止重开，比对队列完整行未改变。HTTP测试另覆盖恢复work动作关闭。不存在故障注入的生产API。

## 独立准入失败

可重复C/E探针（先正常build相应packages）：

```sh
node tools/bootstrap/review-wave04-admission.mjs --acceptance-root /Users/hh/Desktop/joker/superagent-agent-e
```

当前退出1，四项FAIL保存在`reports/releases/product-wave-04/admission.json`。前三项可不传acceptance-root只测main集成的C代码；E修复后指定其实际checkout消费同一纯gate接口。它不修改E报告、不启动服务、不请求模型。

| ID | 实际结果 | 必需结果 / owner |
| --- | --- | --- |
| C-MISSING-SOURCE-EFFECTIVENESS | source missing后effective=true/listCount1 | false/0；保留审计；C |
| C-CONFIRMED-REPLAY-STILL-AUTHENTICATES | 换actor仍取得确认intent | 未授权actor拒绝；C |
| C-PROPOSAL-SNAPSHOTS-GRANT | 修改原调用者scope能改变已存记录 | 记录独立不可变快照；C |
| E-FULL-PRODUCT-REQUIRES-EXECUTED-NATIVE | 全controlled、executed=false、dirty源码、空证据仍PASS | 发布非PASS；拆各独立变异；E |

B独立审查定位：b3-questions的unknown-target发旧非法字段且将400算业务通过，重复答案用新commandId并两分支PASS，legal答案0delivery也可过；b4以assignment不变代替begin/process证据，version1造出的“旧版本”仍是1且两结果PASS；b2手工杀进程而非生产stop，缺closeAdmission也PASS。budget.mjs仅自测调用，实际cases executeNativeLink未预留真实发送预算。B必须先修反例与记账，再使用原grant剩余次数，不刷新额度。

D独立审查定位：restore.mjs rollbackState在line184附近直接rename活跃target；start.mjs先复用后解析本次state/mode/access/build，大小检查hash:false可漏同长度漂移；daemon执行demo.ts却release只清点dist，output仅清单而非运行闭包。tmp实测活跃ProductStore+WriterLock未释放时rollback返回ROLLED_BACK且failedDir已移动；另同长度修改console内容，hash:false通过、hash:true报digest_mismatch。实例API子进程缺start identity、argv子串误认foo-other亦列D回归。

## 本轮完成判据

A/C：真实SQLite与原子命令消费者；B：生产控制和预算证据；D：新目录实际运行闭包与恢复门禁；E：可信失败门槛和独立纵向；main：工作台/模型/HTTP接通。每个包完整五阶段、早期checkpoint后继续，已知外部依赖通过同port fixture推进。

所有日期以2026-11-10记录。main/A/C/D/E模型预算0；B保留原wave03 grant及全部历史/未知发送，不在本轮新增额度。用户三组现有服务保持运行。最终个人Alpha与内部试用分别按证据准入，CAC/第二协议/桌面壳后置。
