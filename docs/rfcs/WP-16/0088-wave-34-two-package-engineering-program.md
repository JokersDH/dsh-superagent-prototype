# 0088：十路双工程包持续交付程序

2026-11-16。用户要求验收后继续明显扩大任务颗粒度，减少反复交互。保持完整方案B（CAC后置）、十位原owner和main；在[0087实际输入](0087-wave-34-reviewed-architecture.md)上安排一个整块goal覆盖两个连续工程包，每包三个完整成果，共六成果/owner。范围从上一轮三个扩大到六个产品成果，不按小fix加阶段数。

## 怎么连续工作

每位一次接完整任务，建立或延续一个goal覆盖全部六成果、集成与独立队列。source早交，不等六项全完再给main；main持续审入实际消费者。早/中/终检查点是可运行源码与证据，不是停工询问节点，下一包已授权连续做。

每个成果必须同时包含生产实现、实际consumer、必要正负验收、最小依赖/source交接。单独的文档、孤立helper、复制状态机、green测试或“接口已提供”不是完整成果。有外部依赖时标该项HELD、给最小实际输入/RFC，然后推进同包/下一包独立工作；不无限轮询或反复长soak。

不承诺当天、工时/持续时长/token预算，不以增加人数或任务数抬完成率。没有新增模型/native额度；不能把“持续工作”理解为自动做真实vendor试点或危险故障操作。

## 十路责任与两个连续包

| Owner | 第一包：完整可用生产能力 | 第二包：日常持续与完整交接 |
| --- | --- | --- |
| A | 全kind有界可继续历史；principal/Scope/cursor实际reader；canonical历史/原bytes | 非空v1/v2语义恢复；规模故障/同Work读回；main/F/C正式消费 |
| B | 不可伪造spawn/fullresources；原Broker三回调；原账本下feed/cancel | 同原Work恢复到检查/接受；原scheduler2/4归还；原状态重启兼容 |
| C | canonical完整snapshot；有界显式选择；新Work前prepare/assert确认 | 来源/决定治理；私有draft/两项目重开；实际API/兼容交接 |
| D | 普通配置/原CLI；非空备份搬根readonly；真实upgrade/rollback或HELD | MacARM可搬迁；唯一closure/manifest支持；固定W33及必要successor交E |
| E | caller finally保留；所有cohort完整资源oracle；两个原项目scoped旅程 | 固定actualZIP普通产品；非空恢复/升级/回退bytes；完整tier/独立负例 |
| F | 多项目多原Work日常；安全首次模型连接表单；错误/身份/草稿恢复 | 实际历史/来源body；真实支持反馈；移动/无障碍/WebKit/性能 |
| G | 观察全语义/边界；诊断文件完整可信边界；受验证身份组合 | 真实反馈到定位；等待/人工代理事实；长期兼容可维护交付 |
| H | 当前exact原consumer；available接受/交付；同原run问答/回执/物理证据 | 非空持久/恢复/升级；现场诊断/支持；同cohort独立E交接 |
| I | 唯一channel真三回调；原guard void/throw；RPC与原command权限 | detach/terminal继任；有界压力/背压；同原run物理/持久交接 |
| J | 普通项目三recipe；两原项目交付/FAIL回路；facts/config变化重验 | 当前root重识别；非空恢复后新登记/旧历史；模块/同版本交接 |
| main | 原Broker回调与lease控制；同原Work恢复交付；实际history reader | 决定/rebind原确认；私有配置/support错误恢复；同source整链/发行 |

## 关键接线与准入次序

1. main `23d5a98e` 已提供原attachCallbacks/port和真实support消费者；B/I可立即消费，不再等只有data接口。rawfeed/cancel/prototype工具先修、原command/当前lease在effect前核。
2. A全kind预算/推进修后接public history；C完整snapshot修后接create前决定确认。主线独占principal/Scope/schema/HTTP；不会拿候选valid或cursor当grant。
3. J/F普通原项目/App、G支持、D发行、Eoracle独立推进，不等B原故障恢复/第二协议/blocked研究。不存在“所有人都等B”的DAG。
4. D已有W33完整字节，E修自身caller/oracle后先给准确W33独立结论。之后必要runtime successor才另freeze，D不等Efinal才能产包，E不跟随每次main移动。
5. 原恢复最终使用原Store/Application/Broker/问题/候选/原2&4，H/E独立消费；新normalWork、JSONregistry、channel slots和新SlotScheduler均不能替代。

## 完成与交接记录

各owner在原owned reports写wave34-status：测试source/dirty、实际生产/consumer源、command/exit、原object IDs、必要正负、已main/候选/已安装边界、完整依赖闭包与remaining。真实失败保留，修复后可追加新结果，不能把先前FAIL重标PASS。

同包consumer绑定准确build/source/archive/runtime/schema，不能借另一包结果。未知usage/成本/效益保持未知，UIactiveReview只是代理；研究价值没有预算/有效arm不出收益结论。

任务完整说明/目录/话术/静态检查均在[wave34](../../../agent-tasks/product-wave-34/README.zh-CN.md)。话术由用户转发，生成任务不声称已经自动启动十个chat。

## 永久边界

原十roots/branch/ownership与全部dirty保留，A sole迁移、E sole产品断言、I sole通信，B排除I/main排除Ftrial；main导入审核最小source不改候选树。没有新checkout/新线程/额外共享schema grant/第二生命周期。

自动realvendor/model/native0；B原cap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED，不重置/补额/退款/借凭据/price-recipe研究。

十二5180/8796至5191/8807及state/profile/tar/ledger/历史/dirty/runs/五用户日志保留。完整originalspawn birth/fullargv/UID/start/root/config/op/fullresources先验、逐次fresh，UNKNOWNretain，不globaldiscovery/substringkill/绕产品拒绝清理/真实CLI回退。

无新Driver/CAC/desktop/autoaccept/writerracing/dynamicDAG；CAC留后续独立实验。显式ownedpaths推原origin，main HEAD:main，neverupstream/reset/clearstate。静态计划66成果不证明产品完成、稳定或发行通过。
