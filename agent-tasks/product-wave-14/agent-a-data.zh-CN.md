# A：恢复准备到非空搬根的可用数据链

原目录`/Users/hh/Desktop/joker/superagent-agent-a`，原分支`codex/g2-workspaces-verification`，仅storage/workflows和append-only迁移。读README/0041，合并最新main。当前278b665的旧4例与87/100回归已承认；不重做已交A18/history/reply。真实模型/native0。

## A1 固定可消费的source检查点

以现有RecoverySourceReader、RecoveryActivationFacts及既有Store/UoW为唯一输入，发布准确导出/recipe与最小生产数据示例。包含complete/bounded/unsupported、精确ignoreCommitted和heartbeat规则。main承担实际baseline接入；不要等待它才继续，也不再增加一个平行授权port。

## A2 完成一次性排除与扫描预算审视

对确切本笔confirmation的activation、receipt、两个event逐字段检查：body/index/mirror、payload及payload_ref、稳定元数据、原命令身份与后来相同body事件。确实不能证明的输入应拒绝或非complete，不能扩大排除集合。检查rowid边界、SQLite安全整数、总扫描/每族上限；每个反例先说明真实语义，不通过放宽完整定义消除失败。阶段1–2交早期可运行source。

## A3 与实际main baseline消费者组合

main发布实际入口后，用生产A port验证prepare前快照、本笔confirm后精确比较、其他业务/队列/资源/确认变化拒绝。两个真实连接与两个独立进程分别写入，保持单快照一致。实际入口未到时仅此项NT，执行A2/A4/A6；不得用noop revalidate自测声称消费者完成。

## A4 非空引用与原正文恢复

单一快照同时包含Work/合同/Ticket、上下文bundle/绑定/历史、实际completed reply artifact/result、决定/提案、回执/队列/资源。第二临时根由实际main读取原消息/来源/结果，证明原command身份与字节一致。缺表、缺artifact、坏引用、派生索引不符均准确失败；恢复不复制执行许可或清unknown。

## A5 控制数据支持独立Runner恢复

与B复用当前bindings/current/fenceEpoch/dispatch/answer/fact stores。证明重开前后target、session、attempt、epoch及原receipt可核对。优先使用既有公开读接口；确需新增字段/port给main最小RFC，由A唯一追加迁移，不建测试专用表或第二ledger。

## A6 备份登记与崩溃窗口

独立产品进程覆盖source确认、snapshot复制/登记、completed结果与message发布边界。实际SIGKILL后用同版/目标版重开；完成结果只补原正文一次，无结果保持unknown。备份中途损坏或缺文件不能留下可用完整manifest。阶段4–6交中期source和D/E可运行命令。

## A7 安装迁移与动态schema输入

v15/v16/当前schema分开验证，旧migration字节不改写。非空FTS、用户会话、回执、上下文与结果全部读回；同schema双binary升级无需伪造schema增长。给D/E动态schema、required families、artifact manifest和稳定公共函数，不能永远硬编码18。

## A8 规模与超限的实际成本

10000条binding、多个项目/会话/work、同时间分页、页间新写/撤销和非空快照。记录实际读取行/字节/耗时与截断，maxRows不只限制最终输出而任由扫描无界。来源正文按需读取，不因翻第一页读取全部大artifact；超限不complete。

## A9 对外依赖与消费者图

对main/B/D/E分别给最小准确调用片段、固定source、事务/同步约束与负例。只有实际被调用的函数记consumer PASS；未接入口列owner和具体缺项。保持源只读、逻辑完整与物理writer证明三者分离，不用数据snapshot发新授权。

## A10 最终数据出口交付

storage/workflows全回归、实际main组合、进程/快照/迁移/规模一次有界执行。维护`packages/workflows/reports/wave14-status.json`，十阶段逐项说明actual source/命令/exit/依赖/范围。push原origin分支并保留全部旧报告；不得把main target激活欠项写成A数据失败，也不得反过来称整个恢复已通过。

## 独立备选队列

- source精确排除、预算、坏引用与多连接一致性无需等HTTP。
- 已有main history/source/reply可直接做非空搬根与坏artifact读取。
- B真实传输未到时继续既有持久字段/原receipt的跨进程读验，不造新权威。
