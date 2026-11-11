# Agent D：真实双二进制升级与恢复切换整包

继续`/Users/hh/Desktop/joker/superagent-agent-d`、`codex/g3-local-distribution`。读本轮[README](README.zh-CN.md)、[0026](../../docs/rfcs/WP-16/0026-wave-07-integration-and-admission.md)及修订01。仅launcher/distribution/portability；不改main认证/恢复授权、A迁移、E断言或root lock。真实模型0。

4a0ea7f已有干净schema13产物，buildId 7e8f6ce6fa2e2633，源码e10bfdb；这不是旧dirty/schema12候选。本轮补的是PA_CONFIG_ROOT可信manifest首次初始化、两个真实不同源码的binary切换，以及main新恢复入口消费，不重复整套安装器。

整包结果：E拿到同一来源链的基线/目标两个真实安装物，在新根独立安装、升级、诊断、失败恢复；恢复历史始终只读，新工作仅按main持久权威激活。不能只改tag或删除marker获得通过。

## D1 先修覆盖配置根的首次运行并交源码检查点

复现E的PA_CONFIG_ROOT覆盖后release.json丢失/未初始化问题。实际发行入口从已验证安装manifest初始化对应私有配置根，拒绝不匹配/被篡改/错实例来源，不借用作者checkout或默认根伪装成功。

验收：默认/覆盖根、全新/已有根、空格/Unicode路径、manifest缺失/漂移、错端口/进程/安装根。给main最小可集成源码和E可运行recipe，先push检查点；不等待恢复commit才修first-run。

## D2 准备两个真实不同来源的冻结安装物

保留已交wave06-alpha2基线的source/build/tar摘要；主线准入D1及A/C后从干净目标集成source构建第二个binary/artifact。两者的实际可执行内容/源码不同，改tag重打包只能作为负对照。

交两个artifact路径/sha256/buildId/source、schema范围、Node/ABI/依赖闭包/平台、构建命令及检查结果。安装物不入Git、凭据/本地DB不打包；生成物不得混入另一未提交工作树的源码。可先交基线与target预备检查点，最终target等待main发布。

## D3 实现并验证二进制切换与数据保护

在两个安装物上实测升级前备份、staging校验、准确停止目标实例、切换安装指针、健康核验和失败恢复。只控制自己拥有的进程/端口/根，错误实例不得误停，升级期间不能同时运行两个writer。

数据迁移兼容与binary回退分别判定。升级后写入新记录，再测旧binary兼容/不兼容拒绝；不得静默恢复旧备份或删除新数据。用户若明确选择备份恢复，标为数据恢复并保留原state，不称无损binary rollback。

验收：摘要错、运行中切换、停止失败、半写指针、健康检查失败、响应丢失和重复请求；失败前后source/build/process/state精确对应。只有数据版本变化不算二进制升级证据。

## D4 组合main发布的新工作激活协议

main发布实际接口前可准备威胁/失败fixture，不能自行定义授权JSON。消费source已提交激活事实与绑定目标描述，只为匹配的新空执行state启动；历史源继续只读，旧queue/marker不删、不重放。

验收：计划过期/摘要漂移、source未提交/已提交响应丢失、目标半准备、错根/链接/权限、重复激活/重启/再恢复。备份不得携带可自动启用的新本机权限。未知影响资源的writer仍阻断，新state标签不证明安全。

## D5 交可重入操作、诊断与独立失败recipe

从脱离作者checkout的新目录执行install/start/status/doctor/backup/restore/upgrade/stop，记录命中实例、实际binary/source/schema和拒绝原因。结合A快照覆盖Outcome/决定/提案/激活历史，验证再恢复只读。

诊断输出可定位缺输入与下一动作，不输出凭据。覆盖配置根与安装根独立迁移、路径变化、备份损坏、缺依赖、孤儿staging和受控SIGKILL窗口；仅清理可证明属于当前操作的临时产物，不扫描/删除用户目录。

## D6 冻结给E并闭合安装证据

交两个确定字节产物、对应干净source、完整独立recipe和分层manifest，E可复用原验收框架实测。E发现失败给最小source修复；修复后重新冻结目标，不能拿旧tar/main新源码拼PASS。

权威`tools/distribution/reports/wave07-status.json`列source/artifact/data/binary/recovery各范围。E准入是最终证据，不作为拒绝先给E产物的前置。等main恢复入口期间继续D1–D3/D5，不停在报告；只push原分支，保留六组用户服务。
