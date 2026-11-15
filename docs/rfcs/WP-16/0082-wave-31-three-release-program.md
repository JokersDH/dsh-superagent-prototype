# 0082 三倍完整范围的连续实施程序

2026-11-15。用户要求每位任务为上次三倍，减少交互。保留十位A–J和main原目录/分支/所有权，将上轮每位4个完整成果扩大为**三个连续交付包，每包4个完整成果，共12个**。不是把同一小修拆成更多阶段；不承诺工时、同日完成或新增模型预算。

## 产品出口

| 连续包 | 用户得到什么 | 关键协作 |
| --- | --- | --- |
| 一：当前产品真正可试用 | 准确829包独立普通/功能准入；数据/上下文真实覆盖；原恢复从实际Store/Broker入口开始 | D锁R1，E先修纯工具再验同tar；A/C/F/J基于原consumer；B/I/H先安全出生+原三回调，不只修helper |
| 二：完整交付与后继集成 | 新导出/当前输入/通道在固定R2可安装；同原Work一次恢复走check/candidate/manualaccept | main唯一组合，B/H原run纵链，D确定source后freeze、E绑定同包；ordinary不等native/private |
| 三：反复使用和同事支持 | 两/四槽完整生命周期、原状态重开；迁移/备份只读恢复；长用可诊断与诚实观察 | A/C数据保真、F工作台、G展示导出、J项目适配；D/E/H支持证据；不新建账本/权限/调度系统 |

各角色并行推进自己的三个包，不要求全体一起过完第一包才开始第二包。外部依赖只阻相应验收项；同一模块先交接口/真实positive/必要negative和source，再继续下一成果或独立队列。

## 每个成果的完成定义

必须包含实现、实际消费者、必要合法正向和独立负向、兼容/失败处理、可运行源码交接。helper/test/文档只能是其中一部分；源码待消费写SOURCE_READY，受阻写PARTIAL/NOT_REACHED，不能结束整个goal。主线负责集成最终结论。

三次连续交付包各可发布早/中/晚source检查点，检查点不是等待用户重新发指令的暂停点。若另一个owner先交可用source，立即按公开接口消费；不复制别人的实现或越权改其文件来消除等待。

wholegoal覆盖12个成果，无token预算，源码提交后继续；只在真实所需用户决定或整条独立队列穷尽时交准确依赖。不无限轮询、反复长soak、无意义全测来填执行时间。

## 固定安装目标

R1是现存8296720d8a25f38c，完整tuple见[0081](0081-wave-31-reviewed-architecture.md)。E仍1fba旧结论，必须真正切R1；同包独立当前window/J/App/lifecycle不能由D自测替代。E工具/断言修正无需D重冻R1。

R2接本次303b2c6a运行source，后续确有运行变更才选择新source，由D固定后E独立验。不要要求E追main，不要因README/testhash变化反复发tar。R3可复用已通过R1/R2做反复使用/支持，不强制多造包。

## 并行边界与交接

所有目录、分支、owned/excluded路径沿[dispatch](../../../agent-tasks/product-wave-31/dispatch.json)，无新checkout或用户chat。main负责root/contracts/config/lock/HTTP/provider/App/transport/globalCSS/集成，F trial与I attach-channel为明确排除子树；main仅做已验源码集成。A唯一append-only生产迁移，E唯一产品验收assertions。

角色状态文件按本轮dispatch的evidencePath，注明source/dirty/命令exit/实际对象/模型与native计数/准确tar或未安装/剩余依赖；保留失败，不把旧scope重贴新hash。提交显式owned路径到原origin分支，main推HEAD:main，永不upstream/reset/清用户状态。

**不新增预算或执行权限。** 真实vendor/model/native0；Bcap4UNKNOWN与E原blockedpilot保持。停止/材料保全规则沿0081；没有安全纯证据不能跑live故障。普通UI/安装不等被阻原恢复或研究，但完整产品也不能跳过它们宣称完成。

入口：[任务总表](../../../agent-tasks/product-wave-31/README.zh-CN.md)、[十段转发话术](../../../agent-tasks/product-wave-31/forward-prompts.zh-CN.md)。静态`verify.mjs`只查派工/依赖/ownership/预算/证据一致性，不运行产品、不授予发行或native准入。
