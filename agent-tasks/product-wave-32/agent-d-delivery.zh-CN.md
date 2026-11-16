# D：可分享的 Apple Silicon 安装包生产线

2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-d`，原分支 `codex/g3-local-distribution`。
保留所有dirty/history/state/ledger，fetch并合并origin/main。读AGENTS、START-HERE、product-spec/README与[本轮交付约定](README.zh-CN.md)。
完整结果：交出同事解压后可启动/停止/配置的准确ZIP，内置Node，不依赖开发仓、pnpm或全局Node。

## 连续执行的整块范围

1. 用原build/stage/freeze保留source/build/inner tar字节/manifest/dependency licenses完整闭包；消费main tools/bootstrap portable packager作为唯一外层封装，不复制第二安装器。
2. 提供干净新根、首次启动、同包复用、准确停止、备份/只读恢复及普通升级/回退的产品路径；新包与旧包/旧state隔离，docs/test变化不机械refreeze。
3. 完善离线包结构、实际macOS最低要求、签名/未公证现实提示、移位/空格路径、版本识别、完整许可证和分享说明；不含任何构建者key/auth/home/native session。

## 实际交付与验收

确切ZIP与SHA可交同事，原CLI生命周期唯一，当前M系列Mac普通安装实际可复现；跨机尚未测明确标记。

交付必须包括实现、真正使用该接口的consumer、合法正向/必要独立负向、可运行source和简明操作/限制。源码先发布让main能渐进整合，随后继续本块联调/修复和独立队列，不在一次小修或测试绿灯处停工。
外部依赖只阻对应项；缺共享接口先交最小可编译约定与RFC，再推进owned实现/兼容/错误/数据/文档。不复制另一owner实现，不无限轮询，不以同一helper换编号凑任务量。

仍只拥有：`apps/launcher/`、`tools/distribution/`、`packages/portability/`。
状态：`tools/distribution/reports/wave32-status.json`，写清source/dirty、命令exit、实际对象/inner与outer精确身份、已合main与仅候选、余项和最小依赖。
提交显式owned路径到原origin分支；不upstream，不reset/清状态。source、受控、准确安装、native、恢复和收益分层，不用提交数或PASS数当产品完成率。

## 首包与后续边界

本轮围绕可分享的macOS Apple Silicon个人预览；不以多协议、创新收益或完整活动恢复作为首包门槛。当前完整B仍保留非CAC长期方向；CAC专属接入/subteam实验移出当前实现/验收/完成度，后续单独试验。
非关键体验先可用再迭代；凭据、用户数据、原写入批准、机器FAIL、来源/项目身份与未知资源边界不能延后修。不要将仅对话或固定fixture宣传为真实编码全能力。
自动真实vendor/model/native0；B旧cap4UNKNOWN不可花，E原24turn/200000token/USD5/oneflightpilotBLOCKED，不reset/topup/refund/补样/价格研究。真实用户在安装后的主动使用与本轮自动验收预算分开，不冒用账号补证。
保留十二5180/8796至5191/8807及所有state/profile/tar/ledger/B旧diff+b16/C锁/E runs/五日志。完整独立birth/UID/start/fullargv/root/config/op/full资源先验，每signal fresh，UNKNOWNretain；无global发现/substringkill/借凭据/真实CLI回退。
无新Driver/CAC/桌面/自动接受/writer racing/动态DAG/第二生命周期。I通信、B执行接线、A唯一生产迁移、E唯一产品断言、main共享契约/root/config/HTTP/App/transport/工具集成边界不变。

## 完成条件

能由main在一个准确安装候选中消费并给用户演示，必要正负/兼容/操作材料齐，再交最终结果；尚未安装就写SOURCE_READY，不能将整块称已完成。发布source后连续完成owned队列，可跨多个工作日，不设工时/同日deadline或token预算。

