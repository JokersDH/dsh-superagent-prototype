# D：多实例隔离、便携个人安装与升级长整包

原目录`/Users/hh/Desktop/joker/superagent-agent-d`，原分支`codex/g3-local-distribution`，仅launcher/distribution/portability。读README/0035，合并最新main。保留旧upgrade/material修复与tar；通用stop跨state的P1必须先关。模型/native0，只能停止本次可证明自有资源。

## D1 统一requested-root校验并早交

复跑main probe-wave11-delivery。start/reuse/status/stop/doctor/recover/rollback等所有路径统一核对requested install/config/data与record/实际进程；不能只验证record自己正确。请求A、记录B时不signal、不删B record、不切pointer。优先交公共身份检查模块及matching/mismatch/orphan正反例source，类型/相关tests通过后push早期checkpoint。

## D2 多state完整副作用矩阵

同install两个state覆盖活launcher/API、launcher死/API活、陈旧record、PID复用/start不符、record缺失、unknown listener、错误config根与空/中文路径。先只读accounting验证集合，仅对本次自有进程调用stop；检查未操作state的PID/API/DB/record保持。此前upgrade/accounting7/7保持，通用命令不能绕过该边界。

## D3 真实spawn/journal/record故障窗

将operation/nonce/pid/start/root在真实时序持久化，注入spawn前后、写record前后、health前后和清理前后崩溃；使用本次独立进程SIGKILL/异常重启，不靠事后删record伪造窗口。来源不明保留unknown并可诊断；terminal journal可重入，pending清楚给恢复动作。

## D4 合并当前schema并补备份闭包

main现为schema16且已交context send/audit、新A数据接口。用A实际snapshot/reader处理context bundle/后续reply-result artifact，新族/缺引用/损坏/未来schema准确拒绝。restore仍只读，不复制账号或私有启动许可，不从历史binding恢复模型发送。迁移由A公开入口做，D不写SQL。

## D5 便携路径与本地运行时闭包

真实搬到另一临时根，验证有空格/中文路径、相对资产、Node/ABI/SQLite native依赖、缺失/不兼容runtime与权限。闭包来自声明的stage资源，不能回读作者checkout/node_modules/HOME缓存；不升级全局环境。平台不支持明确报告；目前macOS结果不变成其他平台native认证。

## D6 当前源码普通personal安装

给main最小可准入的launcher/portability源码和依赖，直接使用共享schema/canonical API/public子入口，避免私有替代DTO。main冻结后从准确clean source构建含context-use/history可用部分的新包；列tar/hash/bytes/source/build/schema/platform/ABI。原schema15 cf7a3cf不可改标签称schema16。

## D7 个人冷启动、配置与只读诊断

临时同事环境一条入口安装/启动/复用/stop/doctor，保留personal mode和准确state/profile/端口。复用主线私有模型配置格式/入口，不把key放argv/Git/tar或支持包；只校验配置，不发真实模型。配置迁移与默认权限、静态资源、端口冲突及多实例反馈全面覆盖。

## D8 真实双binary升级与回退

同schema成功rollback、schema变化后旧binary精确拒绝、target不健康、指针半切换、子进程失联、重复操作和恢复均跑真实managed命令。断言pointer/process/data/mode/journal一致，不用两次start称upgrade，不静默回滚数据。阶段4–8交中期可运行source及准确配方，build不等E最终verdict或恢复activate。

## D9 主线恢复与脱敏支持材料

main真实activation消费者到达后，消费其准确许可握手并做source/target/root/host/resource/期限变更拒绝；材料JSON/空库/旧备份不自授权。未到达继续普通安装、只读恢复、sourceCheckpoint消费者和脱敏诊断包：仅白名单状态/版本/摘要/错误，不导出会话/结果正文、key、IPC nonce或账号目录。

## D10 冻结、独立配方与交接

运行完整owned typecheck/build/tests及有界实际安装矩阵，维护`tools/distribution/reports/wave11-status.json`。交原/新tar字节、exact源码、支持范围、schema/ABI、故障注入方式、E独立步骤与限制；only push原分支，root lock交main，E断言不改，九组用户服务不动。

## 独立备选队列

- requested-root统一模块、只读归属和自己spawn的两state正反例。
- 便携stage、空格路径、运行时缺失/ABI和静态资源闭包，不等恢复。
- 普通personal安装/doctor/配置/支持包/同schema升级，不等研究或E verdict。
- 已有main target prepare/read与A实际Store/reader消费者，不自造activate。
