# B：真实终态端点到原恢复消费者的生命周期闭合

原目录 `/Users/hh/Desktop/joker/superagent-agent-b`，原分支 `codex/g1-runtime`。保留dirty后fetch/merge origin/main。读AGENTS、共同README和[本轮续验](../../reports/releases/recovery-milestone-01/admission-2026-11-18.json)的continuation。main source **e2261ef5**，本轮B4703a11c。

**主动，只闭合同原恢复的真实Runner生命周期。** b38旧stdin EOF/关闭stdout→同PID新lease→原命令→正常无信号退出，已在实际main entry复验4PASS/1NT；不重复修这项。mainRunnerService不是默认启动入口，其新增防护不当产品默认行为。main只采用原receiver诊断片段，未采用旧scenario-env/SpawnedRunner工具候选；不要要求main补未用spawnIntent类型。

1. 先修本次实际b38失败收尾：exited仍UNKNOWN就不得rm root/journal/credential。未知保留、精确报告、无信号、不全局清理；不能以这个改动扩成通用process工具工程。
2. 下一实际缺口是**原真实entry的终态endpoint寿命**：main现在可用原terminal receipt+仍可认证的terminated/quiescent endpoint继续检查/接受，但真实runner-service-entry在done后shutdown会关endpoint。用同一个实际原Runner复现“terminal事实已ACK、coordinator尚未确认屏障就退出”的窗口；不能用父host人为保流替证明。
3. 在你owned原service/entry/transport生命周期内给出可运行修复与原consumer，覆盖普通结束、意外旧连接断开、新连接原cancel/proof和正常退出。不要让ended复活、丢原IDs、重begin、迁移批准或据旧terminal事实虚构新物理证明。若必须变共享语义，交最小实际repro/所需不变量给main，不另造protocol/ledger/宿主。
4. 与main/H把同一真实Runner的原业务/终态消费者联调到结果闭合，不仅写export或状态汇总。先交最小source后持续同结果复验；预算下无法证明的物理/原生层明确NOT_TESTED。

只用受控fake/protocol peer、纯transport fault或Node进程自行退出；真实vendor/model/native/信号0，无危险RunnerLink.close fallback/global discovery。B排除I子树，其他八位待命；只推原origin分支，原历史/dirty/十二实例及全部state/profile/tar/ledger保留。无新Driver/框架/队列/独立维护线或打包。
