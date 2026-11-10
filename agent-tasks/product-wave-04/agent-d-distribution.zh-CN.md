# Agent D：修复发行准入并交可搬迁安装物

沿用 D 目录/分支，拥有 launcher/distribution/portability。最终候选 `73cafed` 尚未准入；28 portability、15 launcher、28-step smoke 保留包内范围。main已提供 recovery_readonly 组合接口和自动 restore marker 检测，见0016。目标是普通同事在新目录真正安装运行、可核对恢复和回滚。

## D1 先闭合恢复与活跃回滚

已独立复现：保持 ProductStore+WriterLock 打开，对同一 roots.data 执行 rollbackState，仍返回 ROLLED_BACK 且移走活跃目录。所有 destructive rename 前核对目标实例、writer lock 和资源归属；active/unknown 必须拒绝。停止请求不等于物理停止；不能删除锁或移动 inode 绕开 writer。目标路径是当前 roots.data 同样适用。

恢复产物带 restore-report.json；main product/demo.ts 检测到 marker 自动只读，或可显式 `--startup-mode recovery_readonly`。D启动读取并核对 `/v1/health.startupMode`；marker即使传normal/native/assistant也不能开启业务。未重绑定/未重验不能提示“可继续执行”。D不得删除marker或单方面新增“允许续跑”开关；恢复准入和显式恢复新授权由main完成。

验收用带 queued begin/deliver、pending answer、assistant reply、verification/parked、不确定 writer 的库，不只空闲fixture；首次start后队列不消费、不启动native或provider。D restore函数不启动daemon只是前半条证明。先交修复检查点，继续D2–D5。

## D2 实例生命周期与真实身份

先解析本次期望的install/state/config/mode/access/ports/buildId/startupMode，再决定复用。不同state、fixture→personal、local-development→require-login、不同build/端口不能静默复用；给稳定冲突/明确操作提示。

记录并校验API子进程的开始身份、UID、精确argv结构及state参数，不用字符串includes把foo误认foo-other。复用、停止、失效记录处理使用同一身份语义；并发start只一个赢；PID复用、失效socket、未知孤儿不误杀，移除breadcrumb不表示进程消失。

## D3 真实运行闭包与摘要

startup必须核对实际执行字节的sha256，不只size。main已复现同长度改内容仍通过hash:false。发行清单覆盖真正执行的coordinator入口、运行依赖和资源，而不是仅包dist/网页dist后仍跑checkout源码。

交版本化staged install目录或归档：网页HTTP构建、daemon/launcher、runtime依赖/许可、平台/Node/ABI清单和可复制安装命令。可要求用户安装规定版本runtime，但不能依赖原checkout或构建者node_modules，不能宣称跨ABI复制即可。`--output`不能只是release.json。

consoleMode由实际构建配置与产物验证，skip-console不得把旧fixture bundle标成HTTP。新目录启动时让原checkout不可用/移开于隔离复制fixture，检查入口、资源、依赖确实从安装目录加载。未测平台准确NOT_TESTED。

## D4 采用A公共快照并证明完整迁移

main已有readArtifactRegistry/WorkflowSnapshots；移除临时私有SQL，使用A公开只读port。数据库与引用产物、非秘密配置、路径映射、完整性/版本清单同时验证。用完成交付的完整patch和检查证据做backup→restore→下载bytes/sha256 roundtrip，不仅state.sqlite可打开。

新目录默认只读；旧native session、密钥、socket、PID、authority证明不变新机器权限。路径重绑定保留实体ID和历史来源，A负责SQL迁移，main负责恢复授权，D不直接改库“补ready”。升级/回滚先验证快照，失败保留原目录与诊断，active/unknown拒绝。

## D5 本机试用包和E消费

交首次安装→配置→启动→复用→停止→doctor→备份→新目录只读恢复→显式重绑定/允许后才新工作→升级回滚的自动化零模型smoke。main最终准入未到的步骤标BLOCKED且给具体port；不能为完成整包退回自动执行恢复队列。

提供E可在其临时root运行的二进制/脚本入口、平台/依赖、bundle manifest及代码commit。根lock由main生成；D只报告新增依赖。保留旧报告、写wave04-status，模型预算0，不碰用户5180/5181/5182服务。CAC、远程多租户、桌面壳仍后置。
