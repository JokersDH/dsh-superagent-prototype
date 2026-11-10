# 跨项目注意力待办：主线/C稳定消费输入

日期2026-11-10，基线a70db20。执行wave-05修订01的首个产品阶段，不开启推荐/复核或额外模型任务。main负责contracts/coordinator/console及必要应用投影，C仍唯一拥有packages/routing的优先级规则，A仍拥有生产索引/迁移。

## 1. 共享输入与C消费

唯一类型为packages/contracts/src/attention.ts。AttentionItem绑定项目、原会话、完整合同；kind区分question/candidate/blocked。问题带精确id/version/kind；候选带精确candidate/verificationId。sinceAt缺证据保持null；deadlineAt只消费显式decisionDeadline，不把expiresAt当业务截止；blockedWorkIds只填写已证实关系，当前无此事实时为空。

C导出纯AttentionRanker：`({ items, now }) => readonly { id, reasons }[]`，顺序就是建议顺序。返回必须是输入id的完整排列，不能增删或重复；reasons用共享AttentionReason。main以AttentionPageSchema校验，随后展示确定性优先级；排序不产生执行或授权效果，不查询SQL或调用模型。需要新语义时提交RFC，不复制私有wire。

C尚未准入前main只提供waiting_order降级：已知sinceAt从早到晚，未知排后，同分按id稳定；说明是已读取范围内的等待顺序，不宣称“最优优先级”。这不是另一套优先级引擎，后续直接替换为C已验纯函数。

## 2. 有界读取与实际覆盖

GET /v1/attention使用现有loopback身份和配置项目范围，按A已有listWorks游标读取，默认每页10个工作、最多20。逐work读取当前应用投影，只保留当前可答问题、可接受候选以及明确验证/资源/派工阻断。不是从当前对话快照冒充全项目数据。

每个work最多200个问题；达到底层读取上限时questionCoverage=bounded，不声明已全部读取。hasMore/nextCursor表示还有更早的工作；空页不意味着全局没有待办，页面允许继续读取。计数仅为已读取范围。列表是观测，不授予权限；打开原工作重新读取，回答/接受/重试仍走既有命令和失效检查。

## 3. 页面与逐项审阅

扩展原“待我决定”入口，保持石墨/白色/青绿设计系统。按类型与项目过滤，显示来源、等待和明确截止，区分失效期限；支持加载更多及逐项打开。连续审阅只导航，不批量共享权限、不自动答题或接受。错误、缺接口、空页和部分覆盖明确显示；模型离线时读取与原动作独立可用。

## 4. 当前实际交付与限定验证

main已实现ProductAttention、认证HTTP、transport、跨会话待办视图、精确原工作深链接和逐项审阅队列。底层游标保持A现有格式，由main用JSON/base64url封装并绑定项目范围/页大小；不增加SQL writer或迁移。按work读取问题以避免另一项目的200条新问题挤掉旧工作，保留旧应用命令的身份、停止屏障和接受gate。

逐项导航不执行接受；队列可前后移动、回待办，完成一项后不自动接受下一项。页面对已验证候选的审阅活动继续沿用0021观测。旧后端无attention接口时保留当前对话问题视图，非活动回退不挂载，避免与右侧问题重复DOM身份。新入口只读，不隐式增加原生或复核任务。

共享契约206、后端43、前端18项通过；当前真实HTTP/SQLite/受控子进程浏览器6项，以及会话目录4、验证恢复4、旧fixture UI 8项分别通过。两次桌面1440/笔记本1280/手机390捕获完成；独立界面复核的唯一标签换行问题已评分resolved，设计文档保持既有系统。证据源e937dbe，后续旧接口兼容分支另有fixture回归；详见 [限定交接](../../../reports/releases/attention-inbox/README.zh-CN.md)。

C的9a39908候选已可获得，但本批尚未独立准入/集成。其纯排序现有签名和0022共享输入不同，后续适配须保持sinceAt=null与真实deadline语义，不能给未知时间补造历史；当前生产仍waiting_order。新Driver、推荐/复核默认入口、R0整体准入与E的价值pilot均不因本批通过而自动放行。

预览http://127.0.0.1:5184使用独立私有状态，原四组服务未重启，也没有把原历史/队列复制进新实例。主线本批真实模型任务0。
