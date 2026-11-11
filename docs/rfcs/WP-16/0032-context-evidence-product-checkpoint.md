# 上下文预览、交付历史与恢复验库准入

2026-11-11。产品实现 `32fc7aee99b30b49030208d6bac95e843cc38d9c`；基线 `531c6b6`，C种类边界先以 `339ae56` 接入。此检查点完成wave09的M2/M3，M1/M4/M5仍分段推进，不代表完整恢复或发行准入。模型和native turn均为0，旧额度不刷新。

## 使用入口

新隔离个人预览：[http://127.0.0.1:5187/](http://127.0.0.1:5187/)，API8803，私有state `.local-state/wave09-context-evidence-preview`。原5180/8796至5186/8802均健康，未重启、迁移或替换。新实例是当前源码开发预览，初始工作/消息为0；不继承旧实例历史，也不是安装包。

1. 在一个项目下开始或打开对话，顶栏“上下文预览”选择项目及当前会话内的工作。
2. 勾选当前工作、项目决定、项目信息、当前会话、交付元数据，按需调整读取预算，点击“生成预览”。
3. 结果可展开内容与两种摘要，查看分组计数、截断/遗漏、注入标记和有效期。复制只复制本次预览，不会启动工作或发送给模型。
4. 打开工作详情，在“交付记录”查看接受来源、当前与历史合同/验证/Outcome，加载较早记录。检查FAIL仍不能人工接受。

## 实际组合与接口

C固定来源边界候选 `45f4a1b1da2a112a8c0d21ec769dc0697a8f505c` 的context源码/导出/分组测试通过独立四项probe后按路径接入；不引入可选proposal confirm helper，main原事务计划/提交实现保留。

| 入口 | 生产实现与边界 |
| --- | --- |
| `POST /v1/context/preview` | main签发会话用途的短期只读grant，actor来自HTTP身份；body仅项目、原会话、可选work、固定来源选择、相关问题与数量预算。不能提供actor、raw grant、自定义provider或任意文件路径。 |
| C `ContextComposer` | 固定分组，按选择过滤来源族、归一预算份额，再执行C统一授权与种类边界。没有另建LLM循环。 |
| 工作/项目事实 | `StaticContextPort`承载A/main真实生产读取的不可变快照，不是合成业务数据。工作与原会话、项目、当前合同绑定；项目名称读取当前版本。 |
| 有效项目决定 | C `DecisionGovernance`/`decisionContextProvider`读取A真实assistant port并复验源文；撤销、替代、过期或失效来源不进入。完整扫描失败直接拒绝，不返回成功的空知识。项目决定按项目共享，不冒充仅本会话知识。 |
| 当前会话 | 最多扫描最近3×200条，限定项目、原会话和可选work，仅可信用户讨论与reasoner回复；问题答案展示、问题锚点、其他work补充与系统提示排除。未扫完明确partial。 |
| 交付 | 只读取当前work已发布artifact ID的registry元数据，无文件内容、宿主路径、网络或凭据读取。 |
| `GET /v1/works/:id/evidence/history` | 消费A `evidencePage`，默认20条，最多100；签名游标绑定work、当前合同、配置项目范围和5分钟期限。区分complete/caller_limit/storage_cap。 |
| `GET /v1/works/:id/evidence` | 当前接受投影必须匹配accepted Outcome、当前合同及当前verification。历史记录不是新执行授权。 |

预览实例上限32条、131072字节、32768估算token、5秒；超额请求收紧并显示，估算不是计费承诺。全部正文是`untrusted_data`。授权有效期最多5分钟；返回前复验源文、决定、工作、验证、项目、artifact registry及事件变化。当前使用全局事件游标作保守并发保护，其他工作同时产生事件也可能要求重试。未自动扫描仓库、读取文档正文或注入模型；后续真正消费预览时仍须重新授权/验源，不能将旧预览作为行动token。

分页是每次读取观察到的keyset窗口，不是跨请求冻结快照；新历史与source cap需刷新核对。游标不绑定全局event cursor，避免审阅活动元数据持续使翻页失效。前端按work/合同/验证隔离结果，丢弃旧工作迟到响应。

计时保留ready-to-acceptance等待及部分UI可见/聚焦区间，未知显示“未记录”。新context对话框遮挡工作详情时暂停采样；真实浏览器驻留5.5秒跨采样回归已通过。两种测量都不是质量、权限或真实思考时间。

共享DTO在`packages/contracts/src/context-preview.ts`和`work-evidence.ts`；各自生成JSON/manifest，冻结Runner/data hash仍为`74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`。

## 实测范围

| 命令/范围 | 结果 |
| --- | --- |
| contracts test / build / generated check | 220/220，构建与生成一致性PASS |
| console test / typecheck / build | 25/25，类型与构建PASS；现有单chunk大于500KB警告保留 |
| coordinator product/http typecheck | PASS |
| context-preview + evidence-history + proposal-commands integration | 28/28，真实SQLite/A/C/main HTTP |
| context-preview + product-execution integration | 34/34，含20项既有受控子进程与恢复回归 |
| context browser `--no-capture` | 干净`32fc7ae`，6/6，page errors0 |
| evidence browser `--no-capture` | 同一干净source，8/8，page errors0；包含新弹窗计时回归 |
| 独立UI审查 | 修正缺失状态截图后，本次增量`ship`；非全产品/辅助技术认证 |

截图来自实现阶段；证据panel样式/内容不变，主线随后接入context工具入口和非视觉计时门控。干净源码复跑不重新截图，两种来源分开记录，不把旧图片声称为clean source新拍。截图覆盖1440×900与390×844；后端身份/变更/失效反例见测试和报告，不由截图证明。

## 恢复仍拒绝准入

A新候选 `7f7e83e0d82b26c33eace6a516cf791e4f970767` 的reader没有进入main。独立probe直接加载该干净TS源码；当前空库正对照PASS，以下三项FAIL，命令exit1：

1. 仅`schema_meta(product_schema=15)`、缺少业务表仍报complete。必须核对该schema的完整预期table集合，不能只分类存在的表。
2. 任意`conversation_search_*`表被算作metadata，未知表和遗留行漏检。必须使用精确FTS主表/shadow manifest，未知表拒绝。
3. 摘要先算、验库副本后复制；两者间一次提交后仍报complete，摘要没有绑定实际检验的同一快照。必须同一一致快照绑定，或报告busy_or_changed。

定位为候选`packages/storage/src/target-inventory.ts:183/:56/:160`。复跑：

```sh
node tools/bootstrap/probe-wave09-target-inventory.mjs /Users/hh/Desktop/joker/superagent-agent-a
```

D远端仍为`50c3471`，目标materializer尚无可消费的固定wave09检查点。等待其发布owned源码后再逐段准入；不复制其他agent工作树的未提交草稿。A正确验库、D私有目标准备、B可信资源、main source/receipt/host授权组合和E实际安装仍各自需要证据。

现有source audit固定`not_granted/startupAvailable=false`；本轮未新增恢复commit/activate或将旧库切成normal。A/D继续原wave09整包，修复反馈是既有验收补充，不创建第十轮或扩大模型预算。

## 下一消费者

A复跑上述三个反例并保留完整库存/table/快照证据；D发布可调用materializer固定源码并对齐本次source；E可直接从`32fc7ae`开始用真实HTTP/UI审查M2/M3，不需要等恢复完成。main继续接A/D检查点、完成实际source→私有空target→明确激活，再冻结准确安装source给D/E。第二Driver、CAC和桌面壳仍排在现有可靠性与恢复闭环后。
