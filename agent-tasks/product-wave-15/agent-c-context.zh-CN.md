# C：实际来源与非空候选的数据闭环

继续原C目录/分支、四owned包，保留root lock差异。读README/0043并合并最新main。旧6/四包285/main组合11/strict通过已承认；main需要实际接线。模型/native0。

## C1 完整验证未知wrapper输入

修reviewVerifiedReplyCandidates在校验前解引用null body/identity/缺principal的问题。三负例返回声明invalid_body，合法typed正例仍正常；不把该防御性问题夸大为已准入权限绕过。

## C2 精确迁移与早期source

给main最小factory/Composer Scope+coverage/候选导出及准确输入类型，不整体要求manifest新API。清楚说明typed私有verified reader与普通unknown输入差异。阶段1–2交可运行修复source，旧脱敏/遗漏/排序不重复报未修。

## C3 实际默认factory消费

消费main发布的默认conversation/artifact替换checkpoint，真实A Store/HTTP显示factory实际调用计数与来源。保留cutoff、600扫描边界、published ID集合、原metadata/message指纹及最终assertCurrent；旧私有路径PASS不能算新factory消费。

## C4 非空候选数据正对照

给main现有SDK/Reasoner一次返回的合法结构化数据fixture，至少一个真实建议从完整completed body被读验。只提供纯数据/validator，不自己调模型。main现suggestions固定[]，空候选测试不能算非空功能完成；入口未到对应项NT。

## C5 原payload/index/digest关系

使用candidate.index取原body.suggestions[index]，校对原payloadDigest/request/message/model/principal/artifact。不得从summary重建，公共请求不得赋verifiedBy/actor/tool授权；损坏或异步漂移拒绝。

## C6 原提案事务消费者

接main原ProductProposals prepare/confirm/reject与A事务，缺输入、源漂移、拒绝和丢响应回执准确。格式不支持只保留普通回复，不补发或重试修JSON。阶段4–6交真实消费者组合source和调用图。

## C7 来源失效与历史隔离

正文改变、决定撤销/替代、授权收缩/到期、页间新增、跨会话/work不符、损坏结果分别配正例。新发送需复验，历史仍读原冻结正文；manifest比较不替代外层Scope与最终guard。

## C8 公开审阅真值

公开wire投影由main映射；对items/bytes/omissions、suppressed/truncated、缺失/不可读分别保持准确。任意POSIX/Windows/UNC及嵌套detail继续脱敏，新增类型不能把私有路径带回公开输出。

## C9 有界规模和兼容

600消息、多artifact、10000历史、5000遗漏，读量/输出上限/排序/tie-break稳定。当前main strict/exactOptional及实际A ports通过；新reader调用数验证，旧已删选项被忽略不算覆盖。

## C10 最终消费数据出口

维护`packages/context/reports/wave15-status.json`与actual consumer map，四包/真实调用/非空候选/失效/规模有限回归。main尚未发布的入口单列，不自建HTTP/SQL/确认权威/LLM loop。早中最终push原origin后继续。

## 独立备选队列

- wrapper输入、原payload/digest、失效和规模不等main UI。
- 给SDK/Reasoner纯fixture与真实completed-reader组合，不启动模型。
- 明确main实际接线欠项，不以更多recipe代替产品完成。
