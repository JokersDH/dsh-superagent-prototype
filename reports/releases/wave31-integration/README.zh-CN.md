# 主线观察导出与实际通信检查点

2026-11-15，运行source303b2c6a974856661c21d0617bd710ebe87374d1，已推origin/main。完整[状态](status.json)、[设计与消费接口](../../../docs/rfcs/WP-16/0080-main-observation-export-and-runtime-checkpoint.md)。

原工作台现在可按当前项目/7或30天/时区重新认证读取并下载JSON新观察快照。只有展示数据，保留formatted字符串、样本/未知/层/单位/覆盖，绝不反解析数字。正文strict绑定DTO/真实UTF8 bytes/必要截断，browser校验digest和当前身份，旧scope回复不下载；legacy缺接口保持旧工作台。

J五源/G六源固定HEAD逐blob一致。B-I七源最小生产闭包和RunnerLink兼容进入实际consumer；旧nativeintent双transport问题已关，原freshguard保留。未合B/H信号工具、E清理工具或新计费review模块。原Store/Broker同Work恢复到接受仍未达，不能用本次普通链结论替代。

最终干净运行source：

- [观察网页13项](browser/browser-report.json)：两实际下载，错digest拒绝，项目/窗口切换取消；16GET观察/6GET导出/21readonly preview POST/0business POST/0event，pageerrors0。
- [模板网页8项](recipes-browser/browser-report.json)：两个明确受控Work原check/currentCandidate/manualaccept；服务端已record后丢响应，重试同一commandId，总共两Work。
- 导出后端与transport5项、原模板5+观察8、Runner/endpoint/admission/adapter28项exit0/cancelled0、contracts241/生成/frozen hash、console/coordinator/实际nativeconsumer strict、build通过。
- J75库/26工具、G22针对性与各自strict/build范围保留。独立[导出复审](../wave31-admission/main-export-review.json)确认合法多字节真截断仍过，伪metadata/隐藏遗漏/假bytes截断均拒。
- 桌面1440×1000与手机390×844截图实看，窗口与下载同toolbar，无横向溢出。已有14个CSS字号/颜色advisory和bundle>500KiB提示保留，未为本轮改旧样式系统。

初始失败没有抹除：RunnerLink旧兼容16过4失败，随后20项过但file超时cancelled1，精确exec会话中断后用原IPC+EOF修复；最终28项正常结束。首次干净browser与contracts构建同时跑，dist重写触发Vite页面热重载，两个套件中断，原[失败记录](initial-concurrent-build/observation-browser-report.json)与[模板失败](initial-concurrent-build/recipes-browser-report.json)保留。构建先结束，再同一source重跑两个套件均正常exit0，未修改产品来放宽断言。

这是source/受控App结论，不是同tar安装、原生控制、恢复交付、长期收益、private/target或全产品发行准入。真实vendor/model/native0；十二用户服务/state/profile/tar/ledger/dirty保持。本轮未新建persistent服务或tar。R1准确829仍待E独立验，R2新source随后D冻结/E同包验，见[下一轮](../../../agent-tasks/product-wave-31/README.zh-CN.md)。
