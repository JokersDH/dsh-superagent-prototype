# H：同事试用与故障支持工具

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-h`，原分支 `codex/g4-trial-operations`。
保留所有dirty/history/state/ledger，fetch并合并origin/main。读AGENTS、START-HERE、product-spec/README与[本轮交付约定](README.zh-CN.md)。
完整结果：提供新同事可直接运行的有界试用和排障流程，能保留现场、帮助定位阻断，减少主线交互。

## 连续执行的整块范围

1. 修原launch/fullargv与观测command不一致仍可登记的问题；只允许原spawn不变身份与完整资源集合，每次signal fresh；UNKNOWN/出生失败不kill，不用同UID或全局发现认领。
2. 独立消费确切安装包及当前原B/I端口，做首次配置、启动、可见能力、普通受控Work、重开、停止与支持材料；不要把四channel fixture叫原scheduler四槽或把新Work叫恢复旧Work。
3. 提供一页试用清单、knownissues/故障树、可分享脱敏摘要和明确重现步骤；必要有限repeat，不为填执行时长重跑大soak。恢复与native未达保留。

## 实际交付与验收

错误可定位，未知资源/用户修改保留，正常own集合可完成；试用脚本不复制第二daemon/registry/生命周期。

交付必须包括实现、真正使用该接口的consumer、合法正向/必要独立负向、可运行source和简明操作/限制。源码先发布让main能渐进整合，随后继续本块联调/修复和独立队列，不在一次小修或测试绿灯处停工。
外部依赖只阻对应项；缺共享接口先交最小可编译约定与RFC，再推进owned实现/兼容/错误/数据/文档。不复制另一owner实现，不无限轮询，不以同一helper换编号凑任务量。

仍只拥有：`tools/trial-kit/`、`tests/operational-soak/`、`docs/internal-trial/`、`reports/trial-operations/`。
状态：`reports/trial-operations/wave32-status.json`，写清source/dirty、命令exit、实际对象/inner与outer精确身份、已合main与仅候选、余项和最小依赖。
提交显式owned路径到原origin分支；不upstream，不reset/清状态。source、受控、准确安装、native、恢复和收益分层，不用提交数或PASS数当产品完成率。

## 首包与后续边界

本轮围绕可分享的macOS Apple Silicon个人预览；不以多协议、创新收益或完整活动恢复作为首包门槛。当前完整B仍保留非CAC长期方向；CAC专属接入/subteam实验移出当前实现/验收/完成度，后续单独试验。
非关键体验先可用再迭代；凭据、用户数据、原写入批准、机器FAIL、来源/项目身份与未知资源边界不能延后修。不要将仅对话或固定fixture宣传为真实编码全能力。
自动真实vendor/model/native0；B旧cap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED，不reset/topup/refund/补样/价格研究。真实用户在安装后的主动使用与本轮自动验收预算分开，不冒用账号补证。
保留十二5180/8796至5191/8807及所有state/profile/tar/ledger/B旧diff+b16/C锁/E runs/五日志。完整独立birth/UID/start/fullargv/root/config/op/full资源先验，每signal fresh，UNKNOWNretain；无global发现/substringkill/借凭据/真实CLI回退。
无新Driver/CAC/桌面/自动接受/writer racing/动态DAG/第二生命周期。I通信、B执行接线、A唯一生产迁移、E唯一产品断言、main共享契约/root/config/HTTP/App/transport/工具集成边界不变。

## 完成条件

能由main在一个准确安装候选中消费并给用户演示，必要正负/兼容/操作材料齐，再交最终结果；尚未安装就写SOURCE_READY，不能将整块称已完成。发布source后连续完成owned队列，可跨多个工作日，不设工时/同日deadline或token预算。

