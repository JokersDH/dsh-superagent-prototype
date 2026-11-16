# Wave34：主线已交原回调与诊断摘要

2026-11-16。产品source `23d5a98e6e75a3b0fb08168431260a9935cf5674`，后续测试视口截图source `233fb217a088faab1c4f9fb8abb7b4239e5bffa2`只改一个browser脚本，apps/packages字节完全相同。[机读结果](status.json)、[实现与接口](../../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)、[十路验收](../wave34-admission/README.zh-CN.md)。

## 真正进入main的能力

原NativeProductAttempt的readPayload/recordFact/beforeNativeWrite同时服务原stdio和新attachCallbacks，来自同原attempt对象、相同payload/source/registration/Store ACK和一次性answerWrites。只有原fresh guard成功wrapper才显式allowed。没有自动attach、B新rawfeed/cancel/内存SlotScheduler导入，也没有原launch/恢复通过主张。

从固定G导入support.ts/support-port.ts/必要exports，以原当前授权观察生成无values/label/detail/用户目标/私有路径的metadata摘要。严格public DTO、认证GET `/v1/insights/support`、独立G reader、浏览器WebCrypto和当前scope abort都已用实际consumer验证。支持详情的下载按钮已实际出现在工作台，当前无受验证安装身份，所以origin:null/exportCapability:unverified。

没有公共任意文档上传/通用passthrough handler，不新建collector/状态机。观察导出仍为展示数据，不反解析数值/当收益证明。

## 必要验证

| 验证 | 结果/范围 |
| --- | --- |
| 原类/Store callbacks | 新11 + 原4 =15 PASS；原方法/fresh guard、真实Store，无Native.launch |
| 新诊断HTTP/独立file/transport | 4+1=5 PASS；auth、scope、canary投影、hash、旧404 |
| 原观察导出回归 | 4 PASS |
| 契约/生成 | 241 PASS/可重复；冻结Runner v1 hash不变 |
| coordinator/Console | strict exit0，Console build exit0；既有bundle673.97KB告警保留 |
| 干净实际App观察 | 16 PASS；两个真实support文件/两个原观察文件，0business POST/0event/model/native |
| 干净实际App模板 | 9 PASS；两个受控Work原candidate/check/manualaccept，服务端record后丢response重试同commandId |

[首次观察16](observation-browser/browser-report.json)、[模板9](recipes-browser/browser-report.json)、[最终视口观察16](observation-browser-final/browser-report.json)分别绑定准确clean source。只读recipe preview POST单独记：观察27/模板40，不能算业务写；观察businessPOST0/event0。

截图已检查：[桌面](observation-browser-final/support-desktop.png)/[手机](observation-browser-final/support-mobile.png)、[观察桌面](observation-browser/desktop.png)/[观察手机](observation-browser/mobile.png)。新按钮可见、无横向溢出或遮挡，项目/窗口切换拒旧下载，坏hash不生成文件。第二轮只补此前视口未包含的实际新按钮截图，不改产品布局。

初始TS2684来自union方法调用，已改显式可选分支并在产品commit前strict通过；不以失败结果充通过。source/browser最终均干净。

## 未达与保护

类级callback可用≠原Broker sameWork恢复；原SIGKILL/currentCandidate/原2&4资源、当前samepackage/native/value仍需独立验。A/C新候选断言未导入，F新两row不作本轮新完整UX主张，J新rebind仍候选。

没有新依赖/迁移/tar/持久服务/用户实例重启，候选树及用户状态/预算保持，自动真实vendor/model/native0。临时受控browser服务均关闭；未执行全局发现或unsafe信号。完成率/发行权限不因这些用例自动上升。
