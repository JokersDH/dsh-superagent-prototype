# Wave21主线：标准启动与读取选择一致复用

源码f856fa5，2026-11-13，完整规则见[0056](../../../docs/rfcs/WP-16/0056-standard-start-reviewed-instance-identity.md)。`pnpm start`支持显式reviewfile；同一次完整验证的文件产生projects+opaqueidentity，actualpersonal readonly health/record声明其摘要，标准start在验证进程/listener/认证configuration后独立核对选择。

samefile live实例复用，未绑定/不同/缺selection拒绝并保留PID，port/login差异不能绕过到build/start；review+restart/stop提前拒绝。原loadRestoredReview数组接口保持，normalfreshbuild无reviewflag不加载新依赖。摘要只是匹配实际进程，不是grant，复用不重新授权/重置时效。

clean review12/localops12/startup2/source14组合40PASS，product/http strict通过；原标准fixture启动/复用/停止也实际回归。独立review发现access/port分支gap后修复，原同端口/不同端口模块复现resolved，无build。实际受控SDK快照第二根standardstart/真实personal API/Vite中，读原candidate/history/frozensource200，业务422、heldqueue1/provider原2不增。

当前D e4e未含f856，D独立launcher复用缺口须自己接；E source-main通过不认证旧ee。旧十二服务未重启，无DB迁移/新ledger/执行权/target动作，真实model/native0。业务attach/private许可/target仍独立未交，A–E结论见[admission](../wave21-admission/README.zh-CN.md)。
