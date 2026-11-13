# D：选择真正生效与同字节个人交付完整包

原D目录/分支，仅launcher/distribution/portability，旧tar/state保留。读README/0057，合并mainf856；新e4e入口首次startup实际可用，但live reuse忽略新选择，先关该独立路径。

## D1 复用前比生效选择

actualstartInstance遇未绑定daemon却带新reviewfile时当前reusedtrue，文件没消费。用实际daemon已验证health摘要与请求规范化摘要匹配，检查独立于port/access条件，缺/不同selection拒绝且不stop/改旧实例。
## D2 同一加载结果身份

mainf856 loadWithIdentity由同一完整验证文件返回摘要；health只personal+readonly、仅opaque digest非grant。不要重新读另一份文件制造record/daemon分歧，record不能代替actualhealth。
## D3 有界复用矩阵

完整unbound正对照、samevalidselection reuse、differentvalid/narrow selection/no-file、变port/login、旧包缺摘要均精确拒绝/允许，正常模式/fixture不能借selection升级。第一里程碑交mock与实际own进程。
## D4 依赖完整新包

合main标准entry/healthidentity/launcherconsumer，变化运行字节准确freeze source/build/tar/hash/size/schema/ABI/mode/闭包；e4e旧包不重贴新reuse修复，docs-only不重冻，早交E。

同时交实际包内scope准备命令（如pa子命令或完整staged CLI），直接调用main prepareRestoredReview，不靠源码checkout工具给包签配置，也不新增签发权威。prepare producer和startup consumer都记录同包文件来源。
## D5 双格式真实同数据

SDK/context/candidate与真实Work/Broker/answer/native_applied同Store，defaultv1/explicitv2都恢复到第二rootpersonal审阅，oldqueueheld/provider0/业务422，拒用fixture替personal。
## D6 选择失效和重开

合法scope缩小、过期/源/marker/key/root变化及文件权限/FIFO明确拒绝，stop后源变化必须重新准备；同live实例reuse不重签/刷新窗口。第二里程碑交同包核心用户流程。
## D7 普通部署

新私有install/data/config根cold/reuse/并发/无执行器/双state，精确probe出生资源清理，unknown不归零，十二旧实例不动。
## D8 升级保护

安全ee/e4e基线到新包与16→18，status/exit/presentpointer/operation/数据一致，升级后写入不静默回退；旧97只mock。
## D9 用户与支持recipe

命令可直接执行，CLI选择/拒绝/重新准备步骤和support600/去敏/nooverwrite齐全，短稳定序列不称soak，不自签target许可。
## D10 最终交接

写`tools/distribution/reports/wave21-status.json`，第三source/准确same-package recipe，goal所有独立阶段持续完成，显式ownedpaths推原分支，预算0/所有历史保持。

## 独立备选队列

E未到早交不可变bytes继续自测；B恢复/私有许可未到不阻个人读取/普通安装；不单拷upgrade漏依赖，不globalcleanup。
