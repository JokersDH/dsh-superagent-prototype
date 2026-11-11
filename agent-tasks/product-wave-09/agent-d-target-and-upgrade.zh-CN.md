# Agent D：私有目标准备与全进程升级整包

继续`/Users/hh/Desktop/joker/superagent-agent-d`、`codex/g3-local-distribution`。读本轮[README](README.zh-CN.md)、[0031](../../docs/rfcs/WP-16/0031-wave-09-admission-and-target-boundaries.md)及recovery-target.ts。仅launcher/distribution/portability，真实模型0；不改A SQL、main授权或E断言。

firstRun和真实两tar已交，不重造框架。当前升级不能准入：孤儿apiPid漏检、空集合停止证明、spawn身份未持久化和假record_missing窗口。大成果是完整进程一致性 + 实际RecoveryTargetMaterializer，供main直接组合恢复。

## D1 先闭合全部登记资源的升级屏障

upgrade/recover/rollback不能只看record.pid；launcher已死但apiPid/consolePid或已知子孙还活时，必须核对/停止已证明归本操作的资源，未知活资源阻断。复用已有stopInstance孤儿API验证，不以过滤掉不匹配者来证明停止。

保留mode/项目/state/profile/端口身份，personal不默默变fixture。交launcher死/API活、命令不匹配活target、PID复用/错root与正对照，先push真实可运行checkpoint。

## D2 持久化启动身份并做真正的缺记录窗口

spawn/进程组/操作/root/cleanup状态在可能副作用前后有明确持久时序。重启无instance record但journal有在途启动时，不能用空候选集合宣布proven。未匹配活进程应保留unknown，不能退指针/重启旧writer。

真正阻止record落盘后让health成功，注入协调器退出再recover，断言PID树/模式/指针/数据。不能先等record存在再删除，或仅在测试finally扫掉残留。成功binary_rolled_back终态与doctor/recover语义一致、建议可执行。

## D3 实现无启动权的私有目标材料准备

按共享RecoveryTargetMaterializer实现prepare/read/discardStaging。消费main已绑定的source/config，自己再核对配置摘要、activation/generation/目标root，在构造时配置的可信private parent内创建全新目标，不接受任意caller父目录。

不复制旧DB、queue、native session、账号或凭据；新凭据仅本机生成不进入portable材料。读材料验证真实manifest/字节/owner/links；startupAvailable固定false，不启动任何进程。清理只移除可证明归该activation的staging，不删除source或完整运行target。先给main可调用库，不等HTTP。

## D4 与A只读inventory及main实际协议组合

用A真实Reader验证新目标业务为空、metadata准确、schema兼容，覆盖部分写入、重复prepare、已有陌生目录、错摘要/路径/权限、symlink/hardlink、配置漂移和中断重入。

main source事实/当前资源校验后才可能授权activate，客户端source audit/空表/目录名不构成权限。未发布activate时保持启动拒绝，给准确fixture/缺口，继续D1/D2/D5；不扩展自己的模拟授权状态机。

## D5 从真正集成source构建可验安装物

修复源码先给main准入，拿实际冻结commit后构建schema15或当前版本target；不能继续用仅含5d4065b的schema13包叫最新main。保留已有历史tar，新增pair显式列tar/hash/source/build/schema/平台/ABI/闭包。

验证冷启动、配置根、托管升级/rollback/恢复、准确schema拒绝和升级后数据保留。personal模式检查可做不发送turn的启动/health，若只测fixture或参数则照实限定；不升级全局runtime/重置账号。坏数据不能通过静默旧备份恢复变绿。

## D6 交E实际托管recipe与操作说明

E使用真正upgrade/--recover/rollback，不只两次start。交完整输入tuple、故障窗口、预期code、进程/指针/数据断言与仅本操作清理步骤；E独立最终准入在交付bytes之后，不做循环等待。

维护`tools/distribution/reports/wave09-status.json`，source/fixture/personal/native/target分列，删除过期来源描述。先D1后连续整包，只push原分支，保留七组用户服务和原账。
