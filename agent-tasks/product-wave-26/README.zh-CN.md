# 第二十六轮：真实工作台与可靠交付收口

2026-11-14。沿A–H八个原工作树/固定分支，main继续集成。每人16阶段、4/8/12/16四个可运行完整结果，发布后持续整个goal，不设token预算。验收见 [0067](../../docs/rfcs/WP-16/0067-wave-26-integrated-product-packages.md)，main实际接线见 [0066](../../docs/rfcs/WP-16/0066-main-trial-workbench-integration.md)。

## 本轮事实

main `a302ddc1963e9d20ada2cbba4f5cf317f041e78f` 已把F六源/一测试按原字节接入App：新增“试用准备”导航、按认证/可见性读取真实readiness，四按钮打开原模型设置/项目导入/执行器/主对话。默认主对话和原草稿保留，readonly/legacy/坏schema/错误重试有实际浏览器覆盖。12项纯映射/传输、strict/build、8项干净source App浏览器场景通过，POST/model/event增量0，桌面/手机截图无横向溢出与导航重叠。F不再只是独立harness。

A生产build通过，但新增测试有重复import和类型错误；新restore reverify对合法目标内容变更仍ok。B大首fact引用发现/foreign payload拒绝已关，但合法中间chunk被新判断拒绝，原五块大payload回归。C完整PID/APIstart已关，当前唯一driver真正调用A manifest并对准确0ede包完成v1/v2两根实际恢复/读取/STOPPED，provider2→2；目标额外合法数据变化仍被路径root-map误当验证通过。

D旧逐次信号fresh/child config argv/mixedunknown反例已关，新a826包6754项及closure87/87通过；E准确3b162required、227PASS/0FAIL/17NT和五HTTP负例通过。新a826及本次F App尚无E最终结论。

G有实际模块与CLI、33+23基线通过，但独立项目/窗口/未知来源/记录限制/流式bytes反例失败，不把它的complete summary接进默认UI。H实际工具和600/1800秒原始fixture观察成立；preflight REFUSED后仍执行包命令、token symlink、semver上界和时间矛盾checker需修，工具不进默认产品。旧成功范围和新阻断分别记录。

## 八路完整结果

| Owner | 第一结果 | 第二结果 | 第三结果 | 第四结果 |
| --- | --- | --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | 新测试/strict及内容reverify | 真snapshot→target身份与变更拒绝 | 同C同包双恢复正负 | 原B结果与公开数据工具交接 |
| [B](agent-b-runtime.zh-CN.md) | 合法多chunk完整传输 | actual统一dispatch/三类重绑 | 同Runner交接与SIGKILL原问答 | 原Work验证接受与2/4资源 |
| [C](agent-c-context.zh-CN.md) | 真实restore/root-map内容绑定 | 新F App/readiness准确包双链 | 独立drift/故障/全局deadline | 完整可复用consumer交付 |
| [D](agent-d-delivery.zh-CN.md) | 当前主线完整clean包 | 同target fingerprint/两格式链 | 普通安装升级重开 | 准确冻结和支持交接 |
| [E](agent-e-acceptance.zh-CN.md) | 准确a826/必要新包输入 | 实际F App/readiness用户流程 | A/C真实target drift与同包链 | 独立required/安装/有界观察 |
| [F](agent-f-experience.zh-CN.md) | 实际App反馈与hook身份边界 | 两项目日常用户journey | 合格scoped指标/移动键盘错误 | 指南和准确同包体验交接 |
| [G](agent-g-insights.zh-CN.md) | 全输入scope/unknown/硬上限 | 真实两项目/事件/timing采集 | 可信summary与隐私报告 | CLI日常性能和交付 |
| [H](agent-h-trial-operations.zh-CN.md) | preflight/token/semver/rawchecker | 准包只读诊断正负 | 合法零模型恢复consumer/fixture | 有界观察、原始材料和同事指南 |

所有目录/分支见 [workspaces.json](workspaces.json)，分别转发 [八段话术](forward-prompts.zh-CN.md)。本轮没有新建工作树或代发用户聊天。开工保留原改动后fetch并合并origin/main，root任务和真实App源码已发布；不要等待整个团队同时结束才提交稳定源码。

## 整链与ownership

A清单与C唯一driver、真实两格式及同包消费已有成功，后续补完整target内容验证；不能再把它说成三条孤立链。合法目标数据变化必须有明确预期/拒绝，DBintegrity、schema和路径相等不足以证明恢复subject。数据核验不是启动许可/物理静止证明，不能忽略任意writer变化或新建授权。

B先交实际可运行端口与合法journal/harness；H在独立operational目录给受控consumer/故障recipe，复用原ProductRuntime/Broker/A Store和已准入port，不改B源、不造第二coordinator/ledger。B通道未合格只阻真实恢复，H独立数据/负例继续，不能伪造重绑成功。

F试用准备已由main接入，F仍拥有trial三个子树/用户指南/独立报告。main保留App/transport/全局CSS/API/contracts/授权及组合；F不得改这些根文件。G仅usage-insights三路径，H仅trial-kit/operational-soak/internal-trial/report四路径；E独占product-acceptance assertions，A独占追加迁移。main对console的显式trial子树排除继续有效。

G错误scope或坏来源不能变完整零值；硬上限在采集/接受前生效，HTTP按流累计并abort，不先完整buffer。H preflight拒绝必须在包代码/命令前终止，凭据不跟symlink/hardlink，成熟semver需求交main锁；原600/1800真实观察保留，纯parser修补不机械再跑40分钟。

## 持续执行和门槛

四个检查点是可运行结果，提交后继续16阶段与独立备选队列。整包未齐不把PARTIAL或小修标goal complete，不用文档/测试数凑完成。每个请求、子进程和总流程有期限；合法输入/完整positive和单变量negative一起保留。

原十二服务5180/8796至5191/8807及所有state/profile/tar/ledger/B旧diff+b16/C lock/E runs/用户日志保持。精确probe出生PID/start/UID/fullargv/root/config/operation并逐次fresh后才信号；unknown保留，禁global扫描、其他credential、真实CLI回退。

全员自动真实vendor/model/native0。B cap4 UNKNOWN不可花，E原pilot24turn/200000token/USD5/单在途BLOCKED，无reset/topup/refund/补样/新价格配方研究。普通App/安装/观测独立于B/private/target/试点；变运行字节先freeze再E最终验，docs-only不重冻。无新Driver/CAC/桌面/autoaccept/动态DAG，人员/阶段/测试数不增加完成度。

`node agent-tasks/product-wave-26/verify.mjs`静态检查结构/预算/路径/依赖/证据；`--workspaces`只读核原九个目录/分支，外部树开工时自行合并任务文件。静态结果不是runtime/native/release准入。
