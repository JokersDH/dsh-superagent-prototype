# 第十轮：已验收事实、上下文使用与恢复发行闭环

2026-11-11。审视主线 `2caee2e`（产品源码 `32fc7ae`），保留[0032](0032-context-evidence-product-checkpoint.md)的所有已测范围。用户要求先验收，再给A–E可长时间连续执行的大颗粒任务；本轮不把分支自报完成当作产品准入。

## 本次独立验收

| 角色 | 固定候选 | 实际复验与结论 |
| --- | --- | --- |
| A | `7f7e83e0d82b26c33eace6a516cf791e4f970767` | 与上轮同一source，原相关10/10 PASS；新准入仍1 PASS/3 FAIL，未接入reader。 |
| B | `1175053d1598cd981a1bb20812d56a61fd4be277` | 相关68/68 PASS，B11为10 PASS/1 NOT_TESTED；新probe3 PASS/4 FAIL，公共模块strict TS有76错误，暂不集成新index。 |
| C | `e58cf258351afc094adbb86e048b1ad48d2a1c54` | context59/proposals30/knowledge71通过，旧两组probe各4/4；45f4a1b后无新生产src。新helper/recipe probe1 PASS/3 FAIL，不涉及main已接入安全adapter。 |
| D | `25e564315d11432b7932ef336d2122df119f88c0` | 相关11/11 PASS；新probe1 PASS/6 FAIL，资源误归属与材料不兼容仍拒绝准入。 |
| E | `57f5d19daf033bbf021083440d56ff06979508bf` | runner selftest66/66 PASS，费用缺项保留unknown；报告实际source4c38bd6，安装仍旧schema13 pair，不是D新schema15或main新UI验收。 |

精确命令、源码摘要和观测在[本轮证据](../../../reports/releases/wave10-admission/README.zh-CN.md)。A–D审视源码均与origin一致且干净；E测试源码干净，已有未跟踪runs报告保留。候选大多仍基于531c6b6，没有消费随后发布的32fc7ae，相关“main缺context HTTP”结论已过期。

### 当前阻断按影响区分

1. D `apps/launcher/lib/upgrade.mjs:418`用共同install路径或state路径认领进程：同安装不同state也被列为owned；`:468`发现processStart不符后又被journal PID/扫描重新认领。若调用后续stop可能误停另一实例。独立probe仅执行只读accounting，未调用候选stop，所有临时进程由本次probe自行清理。
2. A `target-inventory.ts:183/:56/:160`三个已知问题未变化：缺表仍complete、任意FTS前缀表被算metadata、摘要与实际检验快照不一致。不能用空表或目录代替当前资源校验。
3. D材料返回`sha256:`前缀，shared DigestSchema要求裸hex；忽略确认target.stateRoot和configurationDigest；构造后parent替换为symlink可重定向写入；同步read不满足共享Promise port。主线合法DTO消费者必须通过，不能以包内测试替代。
4. B新四个公共TS模块独立strict编译76错误，不是旧dist缺导出。实验sender还允许await期间input变化、同对象替换方法；E实际guardedSend要求module-level send/回显reservation，而B只交factory。后两类是实验接口问题，main尚未消费，不宣称当前个人主链权限漏洞。可信工厂注入costBound本身也不等于用户越权。
5. C未入main的confirm helper相同effect ID换profile后返回replayed及不同命令；推荐测试recipe没有筛同会话其他项目/权限展示，且枚举全局artifact registry。composer明确依赖已授权provider，修复应在adapter/helper；main现有adapter及原事务命令路径不受影响。
6. D新tar实际为source6830e38/schema15/build f2390ffd1b87b79a，sha256与大小匹配；它仍没有main的context/evidence源码。E实际报告消费9b75c2a/schema13，脚本硬编码两端schema13和5571/8971；跨schema回退应精确拒绝，不能要求旧binary继续启动新库。

已上线个人路径保留原准入。main context实际HTTP14项复验PASS；本次未增加真实native或模型调用，也未跑全量新安装矩阵。上述FAIL只阻断各自未接入候选，不回写历史PASS或夸大全产品失败。

C probe的recipe两项是带原始source hash的固定历史复现，不能用来准入后来修复的adapter。`--helper-only`动态验证候选helper，可随修复或移除通过；新adapter必须由main追加实际导出消费者。此限制已反映到C1任务，不设置无法被正确实现关闭的门槛。

## 两条产品线并行

第一条交付用户可直接使用的上下文对话：选项目/工作/来源 → 有界预览 → 用户明确选择用于本条消息 → 发送前重授权和验源 → 现有AssistantModelPort流式回复 → 可查本条消息用了哪些来源。默认不附加，不自动上传仓库，不让正文变成工具权限，不新建LLM loop。

第二条收口恢复与内部试用：源确认 → D可信parent准备材料 → main用A公开ProductStore在全新目标初始化空schema → A完整只读验库 → 当前host/profile/resource再验 → main明确激活。D的材料port不承诺自行创建SQL库，不能让A去证明manifest-only目录已有数据库。source库/queue/marker/session/凭据不复制到新执行state。

普通个人安装可以独立验证，不必等恢复激活或研究试点完成。恢复路径仍单独保持readonly/blocked；只有承诺包含恢复的发行scope才需要恢复出口。新包构建先于E最终verdict，避免依赖循环。

## 已发布上下文绑定接口

单一来源在[assistant-context.ts](../../../packages/contracts/src/assistant-context.ts)，生成schema/manifest独立于冻结Runner/data hash。

- `AssistantContextBinding`是只增审计记录：原command/message/request、项目/会话/可选合同、原用户文本摘要、principal、5分钟内scope/来源选择、已冻结bundleRef/digest和每项原始/预览摘要。它没有状态机、tool grant或重发权。
- A公开 `store.workflows.assistant.contextBindings`，实现 `AssistantContextBindings.forMessage/forCommand/put`，同步加入既有chat/receipt UoW；两种identity同body重放，任一种identity异body冲突。迁移与备份family只有A写。
- main拥有签名确认、HTTP与provider消费，bundle通过既有ArtifactStore内容寻址保存；产生孤儿文件可由现有GC处理，事务失败不能留下binding/消息/执行效果。
- C产出受限adapter、source manifest再验证和纯数据prompt投影，不保存确认、不签grant、不写SQL/HTTP。新增字段或实际调用行为由main发布，不得让C/A猜一个私有wire版本。
- 新schema/port只是下一轮稳定输入，当前没有context-use HTTP或自动模型附加功能。main必须交实际实现，不能拿此接口标M2完成。用户原有普通对话不受新port等待影响。

发送前任何来源变化、撤销、合同变化、scope/期限失效需重新预览，不能静默放宽或悄悄降为无上下文。具体用户选择为单条消息；未确认的草稿不进队列。首次可能发出请求前保留既有持久request记录；未知结果不自动重发，已完成重放不再次调用provider。来源记录只说明用了什么，不证明模型遵循了它。

## 交付顺序与并行边界

| 早交检查点 | 随后连续完成 | 主线消费 |
| --- | --- | --- |
| A：三反例修复reader | 空目标重开/恢复、context binding唯一迁移、备份分页与失败窗 | 先准入reader，再接目标与绑定，无需等整包 |
| B：四模块strict与公共类型 | 当前执行器诊断/真实proof消费者、受控持久control；sender有限收尾 | 诊断与资源观察先消费，实验sender不进入默认路径 |
| C：受限adapter和manifest比较 | prompt数据投影、main真实HTTP/mock provider复验、移除危险recipe | 主线接现有provider，默认不附加 |
| D：归属与合法DTO消费 | parent生命周期与staging安全、main/A实际目标、当前source普通安装与升级 | 先read-only accounting准入再运行有停止行为的安装矩阵 |
| E：当前UI/backend独立矩阵 | 新tuple/schema参数化安装、实际多state/崩溃负例、待恢复consumer | 前置跑用户流程，不等pilot；安装字节先到再最终verdict |
| main：共享绑定输入已交 | 真正目标consumer/HTTP、上下文单条发送、分段集成和安装冻结 | 不把main欠项转派给C/D，不再仅交下一轮文档 |

每人完整六阶段；一个早期可运行checkpoint后继续独立项。外部依赖只阻断相关验收，不暂停整个工作包；报告最小复现/精确source/owner后做下一独立阶段。不能用无限重试、扫描新费用方案或反复重跑同一矩阵消耗时间。

main接A/D目标及A/C上下文都按实际接口做生产组合，不能用JSON mock通过宣称恢复完成。B资源summary仍只作读模型，现有认证proof/current-binding/完整manifest保持唯一屏障。D新target启动授权必须绑定准确source/receipt、target字节、machine/profile/policy、当前资源和短时确认；复制材料或恢复bundle仍无启动权。

## 不变约束

本轮开发/验收模型/native均0，不刷新B旧cap4 UNKNOWN余额或E旧24-turn/200000-token/USD5账；研究保持BLOCKED，不新增费用调查、样本替换、新Driver、CAC、桌面壳或自动接受。内部用户未来手动正常使用不等于开发Agent获准运行付费回归。

保留八组用户实例5180/8796至5187/8803及所有state；只用临时自有端口和进程。共享安装目录不是停止权，PID不等于start身份。仍由main管contracts/application/questions/coordinator/console/root lock，A管storage/workflows/migrations，B管runtime/driver区域，C管context/proposals/knowledge/routing，D管launcher/distribution/portability，E只改product-acceptance。仅push各自origin分支。

完整可下发文本在[第十轮任务包](../../../agent-tasks/product-wave-10/README.zh-CN.md)。静态计划检查仅证明链接/归属/无环/预算，不证明产品、模型或安装兼容。
