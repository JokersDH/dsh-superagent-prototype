# C：同一快照到第二根只读用户流程整包

原C目录/`codex/g3-assistant-context`，context/proposals/knowledge/routing。保留root lock，读README/0051并合并最新main。旧getter/真实candidate/current source确认与305包测试已过，不重复称缺入口。真实model/native0。

## C1 固定一份数据与身份

实际SDK回复/候选确认、context使用及原frozen来源来自同一Store/项目/会话。使用main完整reader，不手写verified marker；读取一致性与异步前后重核沿原manifest/guard，不能跨await持SQL事务。

## C2 用实际snapshot恢复第二根

消费A已准入格式/正确producer（或main仍支持v1），验证后恢复该同一份快照到不同root。不能用原root关normal再手写marker的流程给第二根补证；cp数据测试只记前置。

## C3 第二根真实readonly HTTP

启动recovery_readonly runtime，在这同一root读原candidate/history/source/body，保持原digest/identity；所有业务准备/确认/发送拒绝、old queue held、model/native新增0。source prepare/confirm作为明确例外只记录源事实。阶段1–3交早期source。

## C4 主线原请求与原文核对

从实际GET/指针prepare/原proposal命令审阅normal已记录结果，跨root只能audit，不能把旧token/原credentials当新权限。变更source/artifact/scope/合同后，历史冻结内容不替换，新操作按当前guard拒绝。

## C5 问答与工作来源

把A真实Broker问答/held工作加入同一恢复场景，明确哪些消息可重用、哪些权限/认证问答被排除。不能拿空数组通过或拼几个不同fixture的报告宣称完整工作流。

## C6 格式与缺件诊断

真实v1旧binding与当前格式分层；A v2兼容未过只标相应依赖，不要求main接受坏版本。缺artifact/required schema/派生work_id漂移、partial/caller预算等在公开DTO准确反映，隐私root/异常不外泄。阶段4–6交中期source。

## C7 决定适用与可解释状态

实际决定revocation/supersession/expiry/Scope和原候选receipt重放保持，不复活旧项或自动推广。使用已有DTO/ports，module-only relevance/projection仍标module-only，不新建HTTP/SQL/确认层。

## C8 reader成本与并发

针对本轮新增跨root/异步重核测调用次数/bytes/稳定身份与bounded输出，8候选/长正文/600边界可引用旧证据；来源替换不能混合为一份已验证结果。无全库正文加载。

## C9 最小集成与文档

给main准确source/test切片、当前consumer地图，区分真正恢复和同根切换，当前main已有source确认与schema guard，不沿用旧mid-change依赖声明。strict/exactOptional/build及必要回归。

## C10 整包交付

写`packages/context/reports/wave18-status.json`，第三source与完整单链证据。goal覆盖所有可独立阶段，不修一个getter后结束；原origin分支显式owned paths，root lock不提交，E断言不改。

## 独立备选队列

- A新v2未到：用main真实v1生成同一快照与第二根readonly流程，v2单列。
- 私有许可/target/native未到：数据/source事实与变更拒绝仍能推进，不另签授权。
- UI需求交main具体消费者，不越界更改主线页面。
