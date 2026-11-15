# 0080 主线观察导出与实际通信集成

2026-11-15。基线6f385a545d8ae38fcdaa494a0fd0646f45721a15。本检查点属于后继R2源码，R1固定8296720安装包不因本次新源码或文档改变。R1的独立安装验收仍由E完成。

## 交付行为

现有工作台的使用观察增加下载工具，沿当前项目、7/30天、时区、配置和transport身份重新认证读取新快照，生成JSON文件。按钮tooltip明确重新读取；不把这次新快照冒称点击前屏幕上那一版数据。未切项目/窗口的页面数据继续按原读取逻辑显示。

`GET /v1/insights/export`复用原项目授权和有限证据reader，由G的`buildDisplayExport`生成展示数据；没有新collector、私有SQL、持久账本或执行授权。导出保留formatted字符串、样本、未知、层、单位和覆盖，不反解析数值，不把UI审阅活动代理叫作人工时间/收益。

新增`usage-observation-download/1`外壳，包含同次`observation`、固定文件名、JSON文字、SHA256和mediaType。正文必须严格符合展示文档形状；行全字段/header/window/scope/snapshot/时间与DTO一致，数量和真实UTF-8字节数匹配。声明bytes截断时，下一完整行确实不能放入64KiB。无关字段、伪层/单位/样本、隐藏遗漏、虚假截断和错误文件名均拒绝，即便重算摘要仍拒绝。

浏览器再次验证schema、当前范围和WebCrypto摘要。项目/窗口/配置/transport身份切换或页面退出取消下载；重复点击仅一个在途请求。旧服务404、缺可选模块、不可用数据和错误保留原工作台，错误不暴露源路径。只有明确点击才产生文件。Node观察/分析模块不进入browser。

## 复用来源

J `e640042948c04dd0eb33b310a09c75dba211b5f7`的draft/facts/match/observe/preview五源精确合入；保留当前server now、内容digest、原Scope与当前输入重验。75库/26工具/strict通过，原委托入口保持。

G `1f2964558e21061402f0217e2cca37308e9776f0`的facing/index/report/export/display-export/crosscheck六源精确合入。22针对性导出/交叉核验用例与strict通过。数值分析导出和本次展示导出仍是两种明确协议。

B `fbc933166758f446ba8907ce93795d04d34d11d7`的Runner service/endpoint、execution recovery transport及I attach-channel四个核心源组成实际最小闭包。I新可选business-attach/reconnect、DriverKit计费review模块及B信号工具不在这个生产闭包。

RunnerLink还合入fixture producer/v1 shutdown兼容；main补pre-ready拒绝时发送原IPC shutdown并结束原stdin、清readiness计时器。最初逐项20PASS但测试文件超时的结果保留：拒绝路径未关闭桥而遗留子进程，使用精确exec会话中断后修复，最终28测试正常exit0/cancelled0。没有用全局进程发现或新增OS信号补清理。

这是实际通道接线和失败路径修补，不代表原Store/Broker同Work崩溃恢复到交付已通过。NativeProductAttempt原fresh guard不变；仅sink、缺guard、deny、throw不能授权写入。B/H独立信号工具的新问题仍留在对应owner，不随源码一起准入。

## 验证与限制

- 导出后端/transport5项，包含认证/范围/隐私/旧服务/schema/digest/重算字节后的独立反例。
- 原项目模板5与观察8集成通过；两个受控原Work明确check/candidate/manualaccept，非原生恢复。
- Runner/endpoint/adapter/native admission/sink admission28项正常结束；实际消费者strict通过。
- contracts241、生成检查通过，Runner v1 hash仍为`74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`。
- 真实App13项观察/下载网页场景通过，业务POST0/事件增量0；readonly recipe preview POST单列，不能叫所有POST都写业务。
- 原模板网页8项回归及最终干净source结果见[集成报告](../../../reports/releases/wave31-integration/README.zh-CN.md)。桌面/手机截图检查，无横向溢出；下载工具与窗口同一行。保留旧CSS detector advisory与bundle-size提示，未扩大成重设计。
- 独立[导出复审](../../../reports/releases/wave31-admission/main-export-review.json)确认旧正文P2及虚假截断均关闭；[Runner窄审](../../../reports/releases/wave31-admission/main-runner-cleanup-review.json)限定为原拒绝路径。

无外部依赖/迁移/root lock变化，无candidate工作树改写、用户十二实例重启或新tar。真实vendor/model/native0；旧B/E预算不改变。source/受控/installed/native/recovered/value/private/target逐层保留，不由本次测试数提升产品完成度或发行准入。

## 给下一位消费者

公共浏览器接口是可选`ConsoleTransport.downloadUsageObservation(query, signal)`；后台read port是`usageObservationDownload(query)`。旧版本缺接口时保持原能力；不新增别名/权限/第二生命周期。后继D只在R2确定运行源码时冻结，E绑定一个准确tar；不要用本次source结论替代R1或R2独立安装结果。

下一轮范围和依赖见[0081](0081-wave-31-reviewed-architecture.md)、[0082](0082-wave-31-three-release-program.md)与[任务包](../../../agent-tasks/product-wave-31/README.zh-CN.md)。
