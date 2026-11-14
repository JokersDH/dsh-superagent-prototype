# 0068：通信模块与项目声明的实施输入

2026-11-14。基于 main `6787bd09c83916a1a3551908598344f36194653e`，服务第二十七轮正常节奏的十路开发。本文发布小接口和现有能力的复用约定，不表示通信模块、业务恢复或项目模板已经实现。完整派工见后续 0069；不设当日完成期限。

## 1. 为什么拆出 I

B 的 runner-service 目前分别管理 factWaiters、payloadWaiters、writeWaiters。三个回调共同承担连接、关联、超时与晚到回复判断，恢复连接却仍未接管这三条实际路径。I 在独占子树实现一个具体 CoordinatorChannel，把这些复杂度集中起来；B 负责实际服务接入并删除旧 maps。原执行生命周期、物理进程、journal、dispatch 和权限仍归原模块。

共享入口是 `packages/contracts/src/coordinator-channel.ts`，导出 producer/request/reply/limits schema、身份比较/请求解析和 CoordinatorChannel/Lease/Options 类型。新增生成资源是 coordinator-channel schema/manifest；它们是本地 adapter 的校验输入，不新增公开端点或改变冻结 Runner v1 hash。五项接口测试验证正常旧帧、相关 ID、完整 producer 和上限；实际模块必须由 I 实现并经 B/H 消费。

## 2. 不可变身份与绑定

constructor 从原可信登记接收并校验完整 producer：attempt 的 contract/work/revision/digest、ticket/assignment/attempt/fenceEpoch，加 runnerIdentityRef/source。固定深拷贝后的身份，不从收到的 frame 推断所有者。parseCoordinatorChannelRequest 的 producer 参数必须来自该登记，不可取请求自己声明的身份；payload 的 reference 也仍须由原 responder 核对权限和内容。

初始 generation 为 0；首次 bind 要求 expectedGeneration=0 并返回 generation=1。以后每次成功 bind 都以当前 generation 作 CAS 并递增，不重用、不溢出安全整数。connectionId 通过 IdSchema，expectedGeneration 是非负安全整数；身份/CAS/参数失败不改变原 lease。connectionId 不是认证凭证，generation 也不代替 fenceEpoch 或业务授权。

bind 只接受 B 已认证的连接，send 注入原 transport。每个连接只将回复交给它原来取得的 lease.receive，不能把旧 socket 的消息转交“当前 lease”。替换原子失效旧 receive/close；旧 lease.close 不得关闭新连接或 attempt。module.close 只结算通信 pending，不证明物理 writer 已停。

## 3. 三种回调与断开

| 回调 | 原 v1 请求/回复 | 断开或重绑后的语义 |
| --- | --- | --- |
| recordFact | fact / receipt 或 ack-failed | 可在剩余有界期限内重送原 factId/原 body 等原 A durable ACK；A 原幂等与冲突拒绝仍是依据 |
| readPayload | payload-read / payload | 可重读原 immutable reference，使用新 lease 关联；原 Store/responder 继续核对内容与权限 |
| beforeNativeWrite | native-write-intent / write-admission | 原未决 promise 拒绝/indeterminate，不自动迁移，不重放旧 allowed；caller 回原 command 恢复语义核对后才可发起新的 fresh 意图 |

成功写许可只结算原本次意图，不能缓存、转移或自动重发 answer/begin。若 native 是否已写无法确定，保留 unknown/indeterminate，交 B/A/main 的原 request/command reconciliation。上述本地接口不承诺 exactly-once 原生执行；事实重传也不等于业务命令重试。

I 必须明确抛出的 failure code（共享类型已列出 identity_mismatch/stale_connection/closed/timeout/capacity/protocol_error/indeterminate），不把拒绝或超时包装为成功。write-admission=false 拒绝原 promise；true 仅允许该原本次 hook 继续，main/Broker 当前版本/target/权限仍在真实写前核对。

## 4. 上限与具体实现

使用共享 limits 的 pending facts/payloads/writes、pending bytes、payload bytes、request timeout 和有界 settled IDs。bounds 在注册/发送/接受前执行，deadline 不因反复重绑无限刷新；实际 payload framing/分块协议仍 B-owned。now/schedule 可注入，测试以有界时钟观察同步 send/reply、失败、晚到、容量回收和 close 竞争。无需暴露 private maps 给 caller。

B 的所有 begin/prepared/stdio/HTTP dispatch 仍由一个原业务入口管理。I 不创建 server/socket/数据库/账本/Driver/执行生命周期，不持有凭据；B 验证原连接后才 bind。I 实现路径只有 `apps/runner/src/attach-channel/` 和 `apps/runner/test/attach-channel/`，文档/报告在 `docs/runtime-channel/`、`reports/runtime-channel/`。B 的 apps/runner 所有权显式排除这两个子树。B 原 runner-service、RunnerLinkClient、routes/auth/dispatch/lifecycle 仍唯一归 B。H 在自己的测试目录独立消费。

## 5. J 复用原项目、检查与确认流程

J 的 project recipes 指项目任务/检查声明模板，不是计费模型或 native bounded-recipe 调研。现有项目登记已支持 Node/npm/pnpm，CheckRegistry/Verifier 已拥有固定检查执行，Scope/RequiredCriteria/WorkDraft 和 ProposalPrepare/confirm 已拥有委托与确认。J 改善从明确授权项目元数据到结构化草稿的选择，不能另建 runner/verifier/install engine/gate/ledger。

J 独占 `packages/project-recipes/`、`tools/project-recipes/`、`docs/project-recipes/`、`reports/project-recipes/`。先交纯 typed matcher/result schema 与只读预览 CLI，结果为 draft/needs_input/unsupported，携带明确 provenance、版本、适用范围、缺失项和 authority=none。root workspace/dependency/lock 和 App/HTTP 由 main 消费最小 source 后接入；J 不先发明另一个公共执行契约。

只读取显式授权 root/相对清单，结构化解析 JSON，约束文件数/字节/深度和 symlink/边界。不得扫描 home/env/凭据、执行 scripts 或安装依赖。清单里的脚本名/命令是未可信数据，不能自动注册为 CheckRegistry 命令。输出引用已有可选检查；未知 stack/工具/monorepo root 要请求输入或 unsupported。先覆盖真实 Node/npm/pnpm 正常与多根负例，再按现有输入扩展，不用猜测自动补齐权限。

main/F 后续把合格草稿放回原模板/委托表单，经原明确确认和原授权执行。匹配成功不是可运行、检查通过或可计费证明。B/H 的合法协议 fixture 继续复用原 controlled/Driver 资产，不再另派一个平行协议实现。

## 6. 本次实际主线修复

按 F `3037cbe756795726a74bc657d6e5bab55b433788` 导入四源与一测试，App 以 transport/auth 的稳定观察 identity 调用 hook。切换 identity 立即隐藏旧观察并忽略晚到，失效鉴权错误脱敏；identity 仅是 UI 观察键，不含 token 或权限。同一 transport 对象内部替换后端时，caller 仍须更新 identity 或 remount，不能隐式猜测。

F 可选指标现在要求项目 scope/aggregation、窗口和 coverage 声明。G Node 分析包尚未进入默认产品，其旧 compact projection 不能直接当作兼容输入；后续 main 在 Node 侧以授权 public DTO、有界嵌套总量和唯一 work→project mapping 分析，再显式映射 F DTO。指标缺失保持 unknown，ReviewTiming 仍是部分可见性代理，不是人力工时或收益证明。

已执行：contracts 237/237、生成一致性与冻结 hash、console/coordinator strict、console build、trial 13/13、实际 App 8/8 与 desktop/mobile 截图。首次浏览器记录为修改中 source；发布后以干净 source 复验并单独存证。无迁移、默认 G 指标、H 工具、真实模型/native 或已安装新版本准入。

## 7. 原门槛保留

普通个人安装的 ce64 精确 tar 与 D/E 已验范围保留，不因本文重冻或外推为本次新修复已安装。十二服务、全部数据/profile/tar/ledger/dirty 保持；所有自动真实 vendor/model/native=0。B 旧 cap4 UNKNOWN 不可花；E 原 pilot24turn/200000token/USD5/单在途 BLOCKED，不 reset/topup/refund/补样。无新 Driver/CAC/桌面/autoaccept/动态 DAG。接口、阶段和静态检查都不增加产品完成度。
