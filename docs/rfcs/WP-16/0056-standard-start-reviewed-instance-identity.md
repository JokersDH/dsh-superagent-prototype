# 0056：标准启动与只读选择的一致复用

2026-11-13，延续773b34d显式personal恢复入口。此前工具只在demo/workbench支持新参数，标准`pnpm start`尚未接入；本检查点补齐实际入口，并防止重复启动静默复用另一份读取选择。

## 当前操作

先以0054的`review-restored.mjs`生成新600配置，再使用标准入口：

```sh
pnpm start --discussion-only --state /absolute/restored-state --port 5192 --api-port 8808 --review-restored-scope /absolute/new-review.json
```

路径、projectId与空闲端口由操作者选择，本次实现不创建示例实例。normal无review参数的初次构建路径不预加载依赖该模块；显式review是本机选择，不能与fixture/stop/restart合并。重开应先明确停止，重新按当前源准备配置，再启动，避免停止动作使刚绑定的源过时。

## 生效选择的身份

loadRestoredReviewWithIdentity对同一次读取且完整验证的文件返回projects及规范化摘要，原loadRestoredReview数组接口保留。实际personal恢复HTTP health可携带64位hex restoredReviewDigest，仅此mode/startup组合允许；不公开payload、文件路径、project列表或key。

workbench记录actual health返回的摘要，start在验证原launcher/两listener/认证configuration之后，比较本次文件摘要与actual health。摘要是观察身份，不是授权token：新的进程仍完整验证HMAC/source/root/principal/host/窗口；复用同一已授权存活进程不会重做授权或刷新时间。

已有实例无选择、本次有选择；已有选择、本次缺失；或两份不同有效选择，均拒绝复用且不停止/改动原实例。相同已生效选择可复用URL。旧服务器没有摘要时视为未声明选择，不可拿它认证新的读取请求。私有record只作记录，不能替代actual health匹配。

## 不改变权限范围

五分钟仍是新进程使用配置的窗口，不是运行中定时撤权。相同活实例复用即回到该已授权进程，未延长授权；进程重开必须重新验证当前源。恢复始终只读，chat/model/业务queue/target不启动，所有业务POST保持拒绝。

这只修改main tools/dev标准入口和actual demo/health，不自动修改D独立launcher。D此次实际reuse忽略新review选择的缺口在下一包独立修复；不能用主线已修覆盖旧安装包结论。

## 验证

实际SDK→快照→第二根数据，首次标准start完成包构建与真实personal API/Vite，读取候选/history/frozen原文；相同文件再次start复用同PID，另一有效窄Scope文件、缺文件及review+restart均拒绝且PID未变。业务422、heldqueue1、provider仍原2次。健康摘要仅在personal+recovery_readonly接受，非hex/普通/fixture状态拒绝。

新personal/review12项、原local operations12、startup2和source14组合按最终integration记录；product/http strict通过。旧local operations包含真实临时fixture启动/复用/关闭，证明原默认启动未回归。没有修改用户十二实例、DB迁移、ledger、profile或旧tar，真实vendor model/native0。

主要源码：`tools/dev/start.mjs`、workbench、restored-review/demo/HTTP。旧可用API和defaultv1/explicitv2保持。D/E下一包按准确新运行字节接同一身份匹配，不以source级测试认证旧artifact。
