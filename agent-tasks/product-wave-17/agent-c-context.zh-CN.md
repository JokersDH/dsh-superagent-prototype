# C：一致来源与恢复只读用户流程整包

继续原C目录/`codex/g3-assistant-context`，只改context/proposals/knowledge/routing，保留root lock。读README/0049，合并main e32a3fc。f56f17c真实SDK→candidate GET/prepare及三kind确认/重放已承认，301包回归成立；无需再证明入口不是手造wrapper。模型/native0。

## C1 未知数据的完整异常边界

将nested body.replyMessageId/principal等getter访问也纳入有界invalid_body边界，保留typed非空正对照和既有outer getter控制。仅helper健壮性，不标为主线HTTP权限绕过；不因这一个小点结束整包。

## C2 来源一致性与异步重核

复用main完整reader/A公共port，在一个逻辑读阶段获取一致身份与manifest，异步处理后再核对来源。不能把不同时间的body/index/artifact/Scope混成verified，也不能跨await持SQL事务。C不写SQL、新grant或第二确认权威。

## C3 真实恢复只读HTTP

由实际候选/context/决定数据快照或一致copy恢复到第二root，启动main recovery_readonly runtime和HTTP。核对候选/原文/history为审阅数据、authorization none/不可执行；prepare/confirm业务变更拒绝，old queue held，无模型重发。打开第二Store并读数据不足以记本阶段完成。阶段1–3交早期source。

## C4 当前source确认消费者

main e32a3fc已提供source prepare/confirm，消费原token/fact/audit数据，区分源事实确认与业务候选确认。来源/marker/Scope变化对新准备/确认的影响要准确；source确认不令恢复候选可执行，不提供target grant。

## C5 冻结来源与缺件

恢复后当前源改动不能替换frozen历史body；缺artifact、derived work_id漂移、partial manifest或授权缩小分别呈现真实拒绝/partial状态。不要把A尚未修的格式/缺表反例通过copy成新fixture掩盖；新scope明确依赖A安全版本。

## C6 决定失效与候选重放

在真实GET/prepare/原confirm/reject中测revocation/supersession/expiry、合同修订和原结果变化。新确认拒绝而已记录原receipt仍可审计核对，不复活旧决定、不产生第二工作。阶段4–6交中期实际consumer。

## C7 可解释公开状态

沿main现有DTO/adapter输出真实omitted/suppressed/truncated/partial状态与有限原因，不展示本机root/credentials或虚构充分性。对未消费moduleOnly projection保留明确说明，不要求main为测试新建一套投影/权限。

## C8 成本与懒读边界

对本轮恢复/一致读增加实际reader次数/bytes、8候选/长正文、600扫描与失效重核的有界检查。旧1万规模证据可引用，不能每个预览读全库/所有artifact正文。

## C9 兼容与最小源码切片

当前main严格/exactOptional编译、A当前source及C数据消费者兼容；给main需要集成的最小source/test清单。不把文档import、任意verifiedBy或module-only helper说成实际产品接入；不改HTTP/provider/UI/root lock。

## C10 最终交付

写`packages/context/reports/wave17-status.json`和source/consumer/readonly/replay映射，交第三可运行source。恢复source确认已实现，private permission/target/native/value仍分别标范围。早/中检查点push后继续，原分支显式owned paths。

## 独立备选队列

- A新snapshot安全版本未到：一致copy仅作受控数据前置，真正snapshot项注明NOT_REACHED；当前readonly HTTP仍可继续。
- target/native未到：不阻数据/原请求/source确认/状态解释；不自建启动权威。
- 新UI需求交main具体consumer，不并发修改主线UI或E断言。
