# 0070：主线只读观测的实际产品组合

2026-11-14。沿 wave27/main M6–M8 推进，不新增派工轮次。外部十位 A–J 保持原完整包；main 负责契约、公开读接口与真实 App 组合，正常节奏发布稳定 source 后继续。设计输入沿 [0068](0068-coordinator-channel-and-project-recipe-inputs.md)/[0069](0069-wave-27-ten-agent-continuation.md)。

## 已实现的纵向链路

main 按 G `2adeeff67363d3e13ca6c4e623034c54a14c1e01` 原字节引入 usage-insights 的 package/config/九个源码文件，复用其纯统计实现，不修改 G 工作树或重写分析算法。coordinator 增加 workspace dependency，root lock 只增加两处 importer，没有新增外部依赖。

实际产品读取为：已配置项目 → 原 Store index.listWorks 的公开只读列表 → 原 read.workEvidence（继续经过 Application.inspect 授权与 outcome identity 核对）→ main 有界/归属检查 → G Node 分析 → main 展示 DTO → 认证 GET `/v1/insights` → HttpTransport → App identity/scope hook → F 现有使用观察区域。没有 SQL writer、新账本、模型或执行入口，浏览器不 import G 的 Node crypto/原始证据分析。

新增共享 `UsageObservationQuerySchema`/`UsageObservationSchema` 与生成资源，不改变 frozen Runner v1 hash。query 只接受 projectId、7/30天、IANA timezone；省略项目代表本次已配置项目，最多32个，超过时要求选择项目。窗口由服务端当前时间生成滚动168/720小时，返回精确from/to/timezone。拒绝未知/重复参数、外来项目和响应scope/天数/时区错配。

## main 独立落实的输入边界

只从已有原 public readers 获得项目和工作映射；项目/工作重复或冲突立即拒绝，不接受外部 file/bundle/workIndex。每次最多50个work、10000个总嵌套container/entry/outcome、2MiB证据、2秒读取期限，G 分析前再次验证 WorkEvidence 结构及 work/project subject。先计算所有子记录总量，再 schema/分析，避免 G 旧通用API的嵌套界限缺口；唯一映射避免 A→B→A复活。G结果有quarantine则不展示统计，通用API两缺口仍由G修复，未被本切片宣称全包准入。

原work列表hasMore、evidence.truncated、缺失来源或采集期间event cursor变化均传播partial/unknown。时间窗口外的合法历史记录在采集边界排除，不把正常窗口选择误判成来源冲突。完整枚举窗口里的真实空集合可以为零，缺失或截断不能补成完整零。恢复只读仍可读取，但响应authorization始终none，不产生新执行或迁移许可。

采集只调用当前scope已授权原reader，配置在采集中改变即拒绝。单个读取超时不伪造成功，整体缺失保持partial。原reader本身是只读操作；deadline只停止等待，不能被当成物理进程取消或写停止证明。

## 展示语义与体验

main 显式映射 F 要求的scope/aggregation/window/coverage。header样本数是完整枚举的work证据数；每条指标保留自己的样本数。未知总量未建立时unknownCount=null，不能把多个指标的未知数相加假充独立对象数。不同证据层、币种行分别保留；行内明确raw layer和未知/partial，UI活动仍是部分可见性代理，不称人工工时或效率收益。

App只在登录完成且试用准备可见时读取，默认主对话不触发统计。观察identity包含transport/auth、项目与时区；切换立即隐藏旧结果，旧请求abort且晚响应无效。同identity刷新失败保留带“上次观察”的数据与脱敏错误，原刷新按钮重读两类观察；旧404/unsupported保持可选缺失，既有工作台继续可用。沿原F组件/CSS，无新增全局样式或卡片布局。

第一轮实际桌面/手机检查发现长窗口/coverage文字挤压紧凑标题，main缩短展示标签并保留精确结构字段，交最终截图复验。没有越权修改F trial子树；后续F继续原任务的移动/键盘/数据体验，不重做一套工作台。

## 稳定性与发行输入

G由Node按需加载。普通启动不依赖可选统计包已经在旧安装闭包内；缺模块返回unavailable，不能阻主对话/原任务。独立临时Node闭包（只有contracts/application，无G）已验证先返回unavailable、不采集数据。此结果不是新整包installed准入。

D后续在自己拥有的发行build顺序/closure中加入usage-insights（在contracts之后、coordinator启动前），核准确source/dist/package/importer并冻结真正改变的后继字节。main不并改D的工具文件。当前ce64原包/164required普通scope继续有效，不贴本次新统计；E按准确successor独立验scope/window/partial/UI与无写，测试工具安全修复仍先于live矩阵。

F/G继续自己的原wave27长包：G交修复后最小source和稳定Node消费/投影，F沿此实际App继续两项目、30天选择与更完整错误/键盘体验。J/I/B等其余完整包不受本接线阻断，main下一步接J项目草稿与原确认链；真实运行时恢复由B/I的准入source逐渐组合，不造新生命周期。

## 验证范围

contracts239/239，生成一致性/frozen hash，console/coordinator strict、G build、console build通过；15条trial/传输测试通过。主线新增7条实际模块/HTTP/原Product-Broker-SQLite两项目提问→回答→检查→人工接受/重复读取与缺模块闭包测试通过，既有readiness6条一并回归通过。受控执行没有真实vendor/model/native发送；未知用量与原证据层保持。

实际App浏览器第一轮6项覆盖默认按需、两项目、旧响应晚到、脱敏失败/上次观察、legacy缺失和desktop/mobile；POST/event增量0，pageerrors0。源码提交后以准确干净source做一次最终截图/流程确认，报告独立保存。记录与限制见 [本次主线交付](../../../reports/releases/wave27-insights/README.zh-CN.md)。这些是source/controlled实际数据与UI范围，不是installed/native/recovery/value/target准入，也不按测试数调整完成度。
