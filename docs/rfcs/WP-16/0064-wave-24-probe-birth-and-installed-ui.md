# WP-16/0064：第二十四轮 D 出生登记清理与最新 UI 同包

日期 2026-11-14；主线 `4b42a90`（0062 UI + D help 窄合）已合并。仅改 launcher/portability/distribution；真实 vendor/native 0；十二服务未动。

- 出生窗口：spawn 后立即登记 launcher PID/start/UID/argv/root/config/operation，再等 health/instance；缺记录时保留非空 UNKNOWN，停止已证明的 detached spawn group 并保留私有根。修复旧工具先 waitHealth 才登记导致失败窗口漏记。
- 精确身份：每个 API/console child 独立 start/UID/role/argv/root；路径按完整 token 与规范化 `/private` 边界，拒绝 sibling/prefix；每次直接信号前 fresh 重读，拒绝 PID 复用/start 变化；僵尸视为已停止。
- 故障：九窗口覆盖 spawn 后 record 前、record 后 health 前、seed/review/reopen、候选读取、断言；`before-record` UNKNOWN retained，其余健康成功失败 CLEAN。10 控制覆盖 own positive/child start/sibling/wrong operation/PID reuse/missing/null/cleanup failure/repeat/stop-timeout。
- 同 Store：保留原 Work/question/answer/attempt/native_applied + SDK candidates；两 snapshot create/verify 且恢复 DB sha 等于两快照。**未完成**：两种格式各自独立 restore consumer；不能把单 bundle 字节等价称为双恢复。
- UI：安装包实际包含 `?scopeReview=1`、withheldSourceCount、reasons、context-scope-review/1；同 Store `scopeReview=1` 实测。CLI 三入口帮助仍通过。
- 冻结：source `3b2ff68`、build `470738fd33b22ff4`、tar `f04abb…0494`、20,248,077 B、6,748 files、schema18。旧 595/a9b/0ede/e4e/ee/b911/651/97 保留。
- 复跑：controls10、same4、nonempty11、real4、UI1、help1、matrix19、multi8、cross3、data5、personal7、noexec4、source5、samebase3、backup6、portable5+1NT、dual6、material8、smoke52、launcher61、portability52。E 终验待。
