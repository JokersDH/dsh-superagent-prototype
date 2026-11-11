# Agent B：现有运行时诊断与安全恢复整包

继续`/Users/hh/Desktop/joker/superagent-agent-b`、`codex/g1-runtime`。读[README](README.zh-CN.md)、[0029](../../docs/rfcs/WP-16/0029-wave-08-product-closure-and-reviewed-inputs.md)。原execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance归属不变，不改main公共schema/应用/UI或E断言。

B4有限调查已完成，本轮不再重复当前版本协议/goal预算探测。NO_SUPPORTED_BOUNDED_RECIPE保留，原grant cap4余量UNKNOWN不可花，本包所有真实模型发送0。大成果转为coordinator/launcher可消费的运行诊断、资源事实与受控恢复支持。

## B1 将既有诊断变成可消费的生产库接口

合并最新main，整理exact binary/version/digest/profile、支持/未测能力、当前缺口与证据层级，导出拥有包中的确定性只读接口，原CLI复用它。给main/D直接调用recipe；不是把tests目录report作为生产运行权威。

身份缺失/版本漂移/不支持平台不显示可执行绿灯，摘要/路径等私有信息由main决定公开投影。非计费version/握手只能按相应范围标注，不开启thread turn或修改用户profile。先push稳定检查点。

## B2 提供恢复与升级所需当前资源查询

复用唯一recovery transport/proof WeakMap与现有Runner控制，提供main/D现有attempt/资源绑定、当前可查询/未知/已核对的事实，明确证明的机器/进程/epoch/时效与失效条件。

受控验证旧ended、PID缺失、另一机器签名、错资源范围或失联不能证明当前writer停止。新execution state不释放旧资源。若main需要新共享DTO先给精确字段请求，再继续受控案例，不自己发明授权json。

## B3 补控制恢复失败窗口与产品消费

在现有受控Runner覆盖持久stop/answer/steer、同ID重放、unknown发送核对、重启前后旧epoch拒绝、资源不确定阻断。与main恢复/发行实例身份的既有接口组合，不改coordinator源码。

实际native控制无预算保持NOT_TESTED；fixture不能作为原生兼容证据。交可以从干净main复跑的最小recipe和故障owner，不因旧control矩阵通过就声称全部真实路径完成。

## B4 有限闭合B/E单一adapter拒绝路径

当前B admit固定审B grant，E guardedSend另spawn CLI，这不是同一链。改为显式由调用者提供完整grant身份/范围，B拥有唯一实际transport/launch实现，E只提供持久reservation hook。拒绝结果不能附可绕过的启动函数或被字符串descriptor解锁。

E侧缺model/provider、上界/价格/宿主或reservation的任一项必须拒绝；实际进程环境/工具树政策绑定同路径。当前无有界recipe，验证调用fake发送0即可；不跑模型、不研发新Driver/代理、不新增预算研究。E拥有断言/账本，你只改拥有运行代码。

## B5 交给main/D/E当前运行态消费清单

产品诊断清楚区分“可用执行器”“当前未准入复核”“真实控制未测”“资源待核对”。校验发行物能解析exact executable/profile与依赖，不携带作者账号或凭据；模式由D保留，不用fixture冒充personal。

消费main新入口时只做零模型准备/拒绝/受控回归，不能借E原pilot补B控制。main未发布的恢复目标路径先列NOT_TESTED并继续自身B2/B3。

## B6 冻结运行支持交接

维护`tests/native-acceptance/reports/wave08-status.json`，原B4 dossier/历史ledger不改账，标明仍封存BLOCKED、真实模型0。给导出/API、原控制实现身份、source/命令/退出码、证明范围及main/D/E步骤。

先B1后连续B2–B5，不在诊断报告后停止，也不无限重做B4可行性。只push原分支，保留用户六组服务和会话。
