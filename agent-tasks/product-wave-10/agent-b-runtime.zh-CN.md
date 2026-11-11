# B：可集成运行时诊断与持久控制整包

继续原`/Users/hh/Desktop/joker/superagent-agent-b`、`codex/g1-runtime`，只改原runtime/driver拥有区。读本轮README/0033，合并最新main。1175053旧反例修复保留，但四模块strict76错误和B/E消费缺口仍未准入。真实模型/native0，不再做费用上界调研。

## B1 交能被主线严格编译的公共模块

给resource-facts/runtime-diagnostics/send-admission/review-sender补完整public类型和错误/可空结果，不能用关闭strict、any大逃生或移除有用导出来消掉问题。复跑main `probe-wave10-runtime.mjs <B> <E>`及独立strict编译，重建依赖后再跑包typecheck/build与coordinator product消费者；旧dist缺export与实际源码错误分开。

立即push可运行checkpoint，列最小源文件/导出；已有个人链保持原认证proof，不能因新index导出把未测sender接进默认路径。

## B2 运行时诊断与当前资源消费者

用原VerifiedRunnerInspection单一proof WeakMap/current-binding/完整registered set实现真实只读消费；summary只观察，不授予release。保留served/closed/admission/coverage/attempt/host/时效规则；默认脱敏路径，不读凭据。给main/D一组可调用公开函数和真实认证socket正反例，而非普通JSON称可信。

## B3 有限关闭实验sender接口缺口

不重新研究价格或扩大pilot。冻结send输入与实际调用方法，reserve await前后保持同一subject/material/body/transport实现；未知、拒绝和并发不返还token。和E选择一个实际factory/adapter消费约定并给可运行跨worktree fake consumer，reservationId由同一owner保留及回显；不得另建CLI sender。可信构造参数与用户输入边界写清，不伪称能防御持有任意宿主代码的调用者。

只证明blocked研究的拒绝链与fixture一次发送，不证明真实review/native。默认缺bound仍0 sends，不刷新账，不以descriptor或override解锁。

## B4 持久控制与重启受控矩阵

沿用现有Runner和持久队列，用受控子进程/协议fixture验证stop、answer、steer、disconnect/reconnect及unknown send的原identity保持、重启不重复begin。重点跨进程epoch和原问题指向，旧proof不能释放新attempt。若高水位持久化缺A/core port，发最小RFC/复现，不私建第二数据库，继续其他独立控制窗口；真实vendor仍NOT_TESTED。

## B5 给主线恢复与诊断实际消费

消费main source/target preparation入口，提供旧资源仍active/unknown时拒绝、新空state不能遗忘旧writer的真实受控证据。与D资源归属核对exact root/profile/start/resource集合，观察不成为清理其他实例的权。异常要有可操作原因，不吞成空集合或PASS。

## B6 全部回归与范围交接

维护`tests/native-acceptance/reports/wave10-status.json`，交strict、owned、B/E实际consumer、受控control/recovery分层结果与source。B9协议历史不必为凑通过重跑，真实native/value仍未测。只push原分支，不改coordinator/console/contracts/root lock/E断言；八组服务保留。
