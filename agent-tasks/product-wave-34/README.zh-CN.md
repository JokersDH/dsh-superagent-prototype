# Wave34：十路双工程包，完整方案B持续交付

2026-11-16。上一轮十路已[独立验收](../../reports/releases/wave34-admission/README.zh-CN.md)。本轮将每位从三个扩大为**两个连续工程包、六个完整成果**，每个成果都包含实现、实际consumer、必要正负验收、source交接。一个goal连续覆盖两包/联调/独立队列，source早交后继续，不在小fix处结束；无同日/工时/token承诺。

仍是完整方案B（CAC后置）工程。功能、原执行恢复、数据/上下文、日常工作台、发行独立验收并行；安装纳入完整工程，未切回临时ZIP冲刺。六个成果不是六个微阶段，静态计划66项也不增加产品完成率。

## 主线已交与本次验收

main `23d5a98e` 已交[0086](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)：原NativeProductAttempt三回调与原stdio共用fresh guard/载荷/Store；Gmetadata support认证GET→严格DTO→真实App按scope下载。15callbacks/5support/4原导出/241contracts/strict/build通过，干净16观察+9模板网页过，两个受控Work人工接受；桌面/手机已检查。`233fb217`仅增加实际support视口截图，不改产品字节。

A生产历史continuation、D/E非空业务和包内ZIP、H真正available后接受重开均是实质进展。B rawcontrol/工具、A all-kind预算、C完整snapshot、E caller finally/oracle及D rollback主张仍需收口，详见[0087](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)。旧已修问题不重复派工，新问题修复只是各完整成果的一部分。

## 原目录、原角色、六个成果

| Owner | 第一工程包 | 第二工程包 | 任务书 |
| --- | --- | --- | --- |
| A | 全kind有界历史/授权reader/原bytes | 非空恢复/规模故障/正式数据交接 | [A](agent-a-data.zh-CN.md) |
| B | spawn能力/原三回调/受限feed-cancel | 原Work恢复/原2&4资源/重启兼容 | [B](agent-b-runtime.zh-CN.md) |
| C | 完整snapshot/选定capture/新Work前确认 | 来源决定治理/私有draft/实际API | [C](agent-c-context.zh-CN.md) |
| D | 普通CLI/非空搬根/真实升级回退 | 可迁移MacARM/唯一closure/固定包交接 | [D](agent-d-delivery.zh-CN.md) |
| E | caller安全/完整oracle/两原项目旅程 | 固定安装/非空升级恢复/最终分层 | [E](agent-e-acceptance.zh-CN.md) |
| F | 日常多Work/首次连接/错误保草稿 | 真实history-source/支持/访问质量 | [F](agent-f-experience.zh-CN.md) |
| G | 观察语义/完整诊断/有证据身份 | 实际反馈定位/审阅事实/兼容交付 | [G](agent-g-insights.zh-CN.md) |
| H | current实际consumer/可接受状态/原run资源 | 非空持续/现场支持/同cohort E交接 | [H](agent-h-trial-operations.zh-CN.md) |
| I | solechannel/原freshguard/RPC边界 | detach-terminal/背压/原run交接 | [I](agent-i-coordinator-channel.zh-CN.md) |
| J | 普通项目/原交付/currentfacts重验 | 重识别/恢复后登记/同版本发行 | [J](agent-j-project-recipes.zh-CN.md) |
| main | 原Broker/原Work恢复/真实history消费者 | 决定-rebind/配置支持/整链同版本 | [main](main.zh-CN.md) |

逐位转发[十段话术](forward-prompts.zh-CN.md)，路径/分支/任务见[workspaces](workspaces.json)，机读依赖与ownership见[dispatch](dispatch.json)。当前只已生成任务，没有代发十个外部chat或创建新worktree。

## 持续交付约定

读取AGENTS/START-HERE/product-spec/README、自己的完整任务和0086/0087/[0088](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。保留dirty后fetch/merge origin/main；原分支推origin，main HEAD:main，neverupstream/reset。早期可运行source先交，main及时消费，随后继续剩余工程包，不等一次小修新派工。

外部缺输入仅阻相应项：保留HELD和最小actual consumer/RFC，转向独立队列，不复制对方模块或编另一状态机。普通UI/数据/模板/配置/安装不依赖B活动恢复或blocked研究。新公共契约由main冻结，A唯一append-only生产迁移，E唯一产品oracle，I唯一通信，B排除I/main排除Ftrial。

D固定W33 `048f/f880` inner`ee45` outer`46e`静态通过、尚无E同W33；E修自己的caller/oracle后先对此固定包下结论。新main真实runtime变化的successor另subject，Dfreeze先于Efinal，无环/移动目标；文档或测试变化不refreeze。

## 保留与验收

自动真实vendor/model/native0；Bcap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED，不reset/topup/refund/借凭据/price-recipe研究。source/controlled/installed/native/recovered/value分开，未知usage/time/收益不填0，不增加新Driver/CAC/desktop/autoaccept/writerracing/dynamicDAG/第二生命周期。

十二5180/8796至5191/8807及全部state/profile/tar/ledger/dirty/history/runs/五用户日志保持；完整originalspawn birth/UID/start/orderedargv/root/config/op/fullresources先验并逐signal fresh，UNKNOWN保留材料。不全局发现/substringkill/绕产品拒绝清理或真实CLI fallback。

静态检查 `node agent-tasks/product-wave-34/verify.mjs --workspaces`，只验证source/证据链接/ownership/DAG/预算/原目录，不启动runtime/native或授予发行。当前stable76/100、不含CAC完整B55.7/95=58.6%沿用，计划数量不加分。
