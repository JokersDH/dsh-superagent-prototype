# Wave15主线：实际来源与回复候选闭环

日期2026-11-13。实际运行源码检查点`65ac737/eb96c3e/104b7a0/1169535`；早期恢复预检`697efdc`继续保留。A–E仍执行原wave15整包，本页不重新派工。

## 现在可用

[个人预览5191](http://127.0.0.1:5191/)使用独立`.local-state/wave15-candidates-preview`，API8807。模型设置启用“提案建议”后，同一回复可生成工作/修订/决定建议，经原数据读取、补输入、预览及明确确认产生业务操作。默认关闭，用户网关tools能力未实测。启动只检查本地配置和准入版本，无模型任务。

核心源码：`apps/coordinator/product/{model-provider,assistant-suggestion-data,proposals,context-preview}.ts`，`apps/console/src/{ReplyCandidates,ProposalWorkspace,App}.tsx`，公共schema在`packages/contracts/src/assistant-candidates.ts`。C最小scoped factory/composer和typed candidate validator已按路径接入；未知输入wrapper未接。

## 证据

| 范围 | 结果 | 来源 |
| --- | --- | --- |
| SDK/HTTP/SQLite/候选/回复/SIGKILL/原提案/context product | 91PASS | `checks.json`，本地mockSDK，后端bytes随后提交104b7a0 |
| console transport | 34PASS | `checks.json` |
| product/http/console strict、console build、generated | PASS | `checks.json`；bundle大小提示保留 |
| 实际C factory消费者 | 6PASS | `context-factory-final/report.json`，clean104b7a0 |
| 候选完整网页流程 | 8PASS | `candidates-browser-final/browser-report.json`，clean104b7a0 |
| 原提案网页 | 8PASS | `proposal-browser-regression-clean/browser-report.json` |
| 现有selected-context网页 | 9PASS | `context-browser-regression/browser-report.json`，eb96c3e+working UI |
| 最后布局与流程确认 | 8PASS | `candidates-layout-confirmation-clean/browser-report.json`，clean1169535；无新增截图 |

截图保留在`candidates-browser-round1/`和`candidates-browser-final/`；后一目录名称是第二轮截图位置，不代表最终视觉批准。初始脚手架selector/checkbox race失败和修正后的功能报告也保留。详情见[0046](../../../docs/rfcs/WP-16/0046-candidate-workbench-and-private-preferences.md)。

## 视觉结论

`ui-review.md`记录独立finish reviewer：首轮`fix`，确认轮原按钮裁切resolved，但正文/动作区隔离仍`fix`。针对该反馈的1169535修正已通过功能/DOM矩形和滚动规则确认，没有新增视觉批准。documenter确认现有设计体系一致、不需修改DESIGN。检测器仅一次，91项包含既有/样式建议，未发现ReplyCandidates组件项；不把检测结果冒充可用性准入。

## 没有新增的准入

公共恢复source confirm、私有主机许可、B真实业务重连、target启动及当前安装发布仍未实现/未准入；逻辑complete不证明writer停止。普通安装可以继续消费准确冻结字节，不等研究或激活。真实模型/native turn0，旧预算/账本及原十一用户实例全部保留；十二组服务目前并存。整体releaseApproved=false，旧完成度快照不按测试条数增加。
