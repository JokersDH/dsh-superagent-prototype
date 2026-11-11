# 第八轮：把现有能力接成可用的个人版

新派工已由[第九轮](../product-wave-09/README.zh-CN.md)接续，原工作区/分支和所有预算不变。实际验收与新共享target接口见[0031](../../docs/rfcs/WP-16/0031-wave-09-admission-and-target-boundaries.md)。本页及旧结果保留历史，不重跑旧阶段刷新额度或把旧安装pair改标签当新结果。

日期2026-11-11；派工基线436dc02，审视输入见[0029](../../docs/rfcs/WP-16/0029-wave-08-product-closure-and-reviewed-inputs.md)。A–E继续原目录/分支和代码归属，wave05修订01、全部grant和旧实测范围保留。本轮每人六阶段，先交可运行checkpoint，再连续完成独立阶段，无需每修一处等下发。

主线新实际检查点：[0030](../../docs/rfcs/WP-16/0030-wave-08-proposal-workbench-and-source-audit.md)，源码b436fde。明确提案网页8场景通过，A schema15生产facts及只读审计GET已集成；旧A读回/接口对齐阻断关闭。C可消费实际UI/HTTP，D/E可核对source记录但不能启动target；自动context/结构化reasoner和target激活仍待后续。新隔离预览5186/8802也须保留。

## 本轮出口

1. 主对话里的真实日常闭环：提案预览/确认/拒绝、明确范围的上下文预览、工作/决定/交付证据，刷新与响应未知可恢复。
2. 恢复旧历史只读、新空执行state明确激活：source事务事实/回执、目标准备、物理资源复验和启动中断重入。main负责关键路径，A/D/B分别提供事实、启动消费和资源支持。
3. 同一来源的可安装升级候选：保留personal模式、失败进程/指针/数据一致，E对确切新目标独立验收。

pilot在当前Codex recipe下封存BLOCKED，本轮不重复整turn上界调查，不新增模型额度或Driver。没有收益结论不阻断个人版推进；无法执行实验也不证明复核没有价值。

## 原工作区和整包

| 角色 | 目录 / 分支 | 大成果 |
| --- | --- | --- |
| A | /Users/hh/Desktop/joker/superagent-agent-a · codex/g2-workspaces-verification | [生产激活事实、历史分页与迁移](agent-a-durable-activation.zh-CN.md) |
| B | /Users/hh/Desktop/joker/superagent-agent-b · codex/g1-runtime | [运行诊断、控制恢复与单一拒绝入口](agent-b-runtime-operations.zh-CN.md) |
| C | /Users/hh/Desktop/joker/superagent-agent-c · codex/g3-assistant-context | [有授权的上下文和提案消费者](agent-c-authorized-context.zh-CN.md) |
| D | /Users/hh/Desktop/joker/superagent-agent-d · codex/g3-local-distribution | [保留个人版模式的升级与恢复](agent-d-personal-upgrade.zh-CN.md) |
| E | /Users/hh/Desktop/joker/superagent-agent-e · codex/g3-product-acceptance | [同源网页、安装和恢复独立验收](agent-e-same-source-acceptance.zh-CN.md) |
| main | /Users/hh/Desktop/joker/superagent · codex/g2-execution-integration | [网页、目标激活与集成发布](main.zh-CN.md) |

先读AGENTS、START-HERE、product-spec/README、本页、0029及专属任务。A唯一storage/workflows/生产迁移；B原execution/catalog/policy-preparation/driver-kit/testing/runner/drivers/native-acceptance；C context/proposals/knowledge/routing；D launcher/distribution/portability；E仅product-acceptance；main contracts/application/questions/coordinator/console/root lock和共享文档。不要用private schema绕过main已发布接口。

## 已有输入如何接续

A旧plan读回失败和0027port对齐仍未关；C旧决定复活已修、主线仅接该精确改动，但composer三项独立授权probe仍FAIL；D fresh-source null已修、真实两tar存在，升级实际模式/进程清理尚需修；E默认拒绝改善但v1迁移/缺模型身份/未知费用与双运行路径仍需补。

main提案HTTP已在627ef0d交付，不再列“main没提案入口”；上下文HTTP/网页和恢复target启动确实还缺main。E旧版本安装结果不可映射到D新两tar。各owner合并当前main后更新一个权威wave08-status，保留原报告；不要带过期阻断进入新状态。

## 开始顺序

所有人可立即开始第一阶段，B/D的生产修复、C授权反例、A事实对齐、E预算与来源检查互不等待。main复用0027/0028实际接口先做提案网页和恢复协议组合，不等全部整包。

组合验收依赖见[dispatch.json](dispatch.json)，依赖是最终验收前置，不禁止阶段的独立准备。A/C先交最小可消费源码，main逐段准入；D先交升级修复源码，拿main冻结集成source后构建新目标；E拿字节产物就测，最终报告才等待结果。不得形成“先E通过才给E产物”的循环。

## 预算与实例

本轮newModelAllowance=0。main/A/C/D、E非原pilot均真实模型0；B wave03-b-native cap4余量UNKNOWN不可花。E原grant仍wave05-independent-review-pilot-01：24 turn=8作者+16复核、200000计费token、USD5、一个在途，任一先到停；原账保留，不重置/转移/退款unknown/补样本。当前recipe不可运行，所有本轮阶段模型发送0；未来改变recipe需另行明确版本化/准入，不能因本轮编号刷新。

保留用户六组5180/8796至5185/8801，所有probe使用临时端口、新state和项目。只push原分支到origin；不切别人工作区、不清理用户文件/会话/全局runtime。依赖未到时留source/最小复现/owner后转独立项，不无限轮询或补无关平台。

## 验收与交接

每阶段给实际命令/退出码、source/层级和证据，不用报告存在或非零退出代替业务断言。A/C给真实SQLite消费者，B分受控与真实native，D给进程/指针/数据/模式和artifact身份，E逐项独立验收。主线网页须实际浏览器检查，不以后端通过代替。

最终交branch/base/source、拥有路径、已push checkpoint、结果/未测/阻断、预算reserved/used/unknown、下一consumer recipe。源码/产物/证据不混版本，不扩大module/controlled/installed/native/value任一层范围。root lock仅main更新。

只读计划检查：`node agent-tasks/product-wave-08/verify.mjs`。计划36阶段初始NOT_STARTED，不代表当前整个产品从零，也不是本轮执行结果。主线实际审视/集成结果另见[wave08状态](../../reports/releases/wave08-integration/status.json)。
