# Wave35：原设置面板的真实模型配置

2026-11-16。模型产品source `4cde58832f2287a26e2f65a4a30ed01b5cb9f56c`，截图测试增强`c544781b`，目录竞争修复source `8cd709ca57acb0ba8064e2ec3cc98f4369a46c60`；后发测试/文档不改当前App字节。准确结果见[status](status.json)、[0089实现](../../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)、[本轮验收](../wave35-admission/README.zh-CN.md)。

## 实际进入产品

原ModelPanel嵌入F固定d03a表单/helper及model CSS最小片段，保留原导航/模型选择/提案设置。主线修复候选StrictMode mounted、identity迟到/redaction问题，加入saved语义和HTTP明确选项；原F树未改。没有导入其不相容A completion的另一context history面板。

新的严格 `AssistantConnectionInputSchema`→原认证 `POST /v1/assistant/connection`→PrivateModelProvider.configure→原私有write/rename/fsync，路径始终是当前实例已经选择的本机路径。0700目录/0600文件，旧链接/公共权限/格式拒覆盖，网页不能指定path。typedtransport核对返回端点/模型、配置状态并拒key回显，App和form分别隔离旧identity/promise。

保存不发模型请求，状态只为configured；原后续讨论仍经原SDK流式/no-retry。HTTP需要用户明确勾选，恢复只读拒配置POST；旧服务返回unsupported保留原手动配置。密钥输入提交即清，不写local/sessionStorage，不显示在状态/错误/URL；JavaScript字符串物理擦除未作承诺。

## 验证

- 新5 backend/privatefile + 原10 provider =15 PASS，真实原模块、临时私有文件、固定local provider回归；无外部vendor。
- transport1 PASS：同body保存、错端点/模型/配置状态/secret echo拒绝。
- contracts241/生成可重复/冻结Runner hash不变；coordinator/Console strict、Console build PASS。既有684.12KB bundle告警保留。
- [实际App6](model-browser-final/browser-report.json)：真实StrictMode入口/API/privateprovider、保存/重开/HTTP明示/失败与旧服务/关后迟到/桌面手机。5保存请求（含拒绝/拦截），0业务命令/0events/0模型请求/native。
- [原观察16](observation-browser/browser-report.json)：4下载、2support、27只读recipe previews，0business POST/events/model/native。
- [原模板9](recipes-browser/browser-report.json)：两个受控原Work/candidate/check/manualaccept，record后丢response重试同commandId仍一个Work。
- 独立实际React控例复验main修后form的StrictMode、identity旧echo与缺省消息，通过；见[源审计](../wave35-admission/data-experience.json)。

桌面/手机截图已检查：[desktop](model-browser-final/desktop.png)、[mobile](model-browser-final/mobile.png)。第二轮只补滚动到保存按钮并断言其在底部导航之上；无产品布局修饰或第三轮。输入16px沿原手机策略，原表单配色/平面侧栏不变。机械detector一次仅advisory，旧字号/sidecar色阶及16px输入不触发无关设计重构。

初始非法schema输入曾503，已用本route safeParse固定400再通过；生成器重复import/row在产品提交前移除。首次截图截到手机按钮边缘，后用同App字节的test-only脚本验证完整可达。真实旧结果保留，不混入最终PASS。

## 启动目录竞争

E实际W33首次Start/status记录EEXIST；主线8cd709ca只容忍mkdir EEXIST，随后仍核private directory/type/owner/mode。3 actual-function VM控制通过，含race合法、symlink/foreign/public/type拒绝、其他创建错误保留。没有运行新包/启动器、修改旧W33或新tar，必要runtime successor再由D冻结。

## 准入范围

这不是模型连接验证、Codex认证、当前安装或原Work恢复通过。原callbacks已提供，但B新raw控制/source工具、A/C新断言、G不可信静态runtime identity均未合；默认support origin仍null。

无新依赖/迁移/Driver/ledger/lifecycle，候选树/dirty和十二用户服务及状态保持。受控browser服务均按finally关闭，自动真实vendor/model/native0，不重置B/E预算，无新增release/value/恢复或完成率准入。
