# 0083 已登记Runner端口与工作台真实消费者

2026-11-16。基线58b4e4c8。沿完整方案B工程推进，CAC不含；不是临时打包冲刺。

## 原Runner内部端口

`RunningAttempt.attachPort`是可选Node内部字段，包含该host已经登记的endpoint与producer。main的`NativeProductAttempt.launch()`在原register、policy ready和current检查通过后，将现有`this.endpoint/this.producer`的独立clone放进原返回对象；没有RFC示例中并不存在的`this.handle`字段。

这只是让B不再等待main提供原登记。没有新attempt/Work/credential/ledger/HTTP DTO，不自动绑定/启动attached consumer。原`beforeNativeWrite`、答案write admission和原Store ingress不变；缺guard不能授权。

B f4a99ce1的`packages/execution/src/attached-attempt.ts`精确导入，原`reference`和原payload body协议修复已实际复验；contracts使用既有RuntimeProducer同构类型，未导入B index的无关resource-facts/新source或冗余service修改。

`tests/integration/attached-port.case.mjs`四项消费全部main source：真实ProductStore/createStoredRuntimeIngress和实际service/caller。allow、deny、missingguard保留原payload/receipt，foreign fact先拒绝且无row/guard/effect。场景预置合法ticket/binding，不是原Application/QuestionBroker端到端恢复，不能据此认定同原Work crash-to-accept或原2/4scheduler槽归还。

原endpoint被销毁后持有clone不会产生新权限；模块producer/currentlease及main当前授权仍各自验证。端口不进入公开配置、健康或网页支持信息。

## 实际App工作台

F fae41f8c的TrialWorkspace/insights/recipes/support/CSS/index六源进入main；除删去一条带内部owner名称的可见文案，其余按准确源码保留。原readiness hook、主线7/30窗口、observation download、server fields映射、原委托表单和人工接受保持。

新增空项目就地导入、导出中/禁用原因/错误重试、可展开支持摘要、真实观察时间及模板重试。包/源码身份尚未由服务器提供时显示未提供/未声明，不用当前Git hash假装实际安装版本。

主线原`useProjectRecipeSuggestions`增加同scope刷新revision，纳入其身份key并清理旧请求；App传`onReloadRecipes`。点击重试只重读当前选中项目三个现有readonly preview，之后仍在原表单预览/应用/明确创建，没有业务命令或新执行权限。

新浏览器场景验证实际App的503错误脱敏、三preview重试、支持折叠/展开、无编造版本以及0业务命令/事件。原八模板场景仍包含两个原受控Work检查/候选/人工接受和post-recorded unknown同ID。观察13场景覆盖项目/窗口隔离、导出与digest、错误/legacy和桌面/手机。

## 验证与保留范围

- 主线attached-port4、trial20、console/coordinator及actualconsumer strict通过；UI构建保留既有bundle-size提示。
- 初始trial19PASS/1FAIL是只导入新recipes源而尚未带上对应F测试：旧断言允许无法表达的新增排除。导入匹配的F测试后20PASS，保留更严格scope/effect一致性，未为变绿放宽权限。
- 最终干净source实际网页及截图、命令计数见[主线结果](../../../reports/releases/wave33-integration/README.zh-CN.md)。不以WIP或旧包截图冒充最终source。
- B工具伪造spawn对象、C草稿/expiry/strict、E缺完整集合/旅程oracle等剩余按[独立验收](../../../reports/releases/wave33-admission/README.zh-CN.md)处理，不随这组source混合准入。

本轮没有root lock、外部依赖、公共wire/SQL迁移变化，没有改候选工作树或十二用户服务。真实vendor/model/native0，不创建新安装包，不增加预算或授予native/恢复/收益/target/发行准入。运行source早发布后，继续完整工程的真实消费者与整链联调。
