# Wave36：原工作详情的真实分类历史

2026-11-17。API核心effe85c2、人工标准语义f71cad58、视觉b454c0fd、最终malformed-ID400与单测f32a64ff。准确[status](status.json)、[0092实现](../../../docs/rfcs/WP-16/0092-main-completion-history-consumer.md)、[本轮验收](../wave36-admission/README.zh-CN.md)。不同source的证据按下面范围组合，不重贴同一HEAD。

## 已交产品

byte-exact A workflows.ts、storage必要exports和ReadIndexPort方法进入main，无content-proof/旧recoverySource累计依赖。原Application当前授权/UoW→三kind metadata→HMAC当前principal/Scope-settings/合同/Work/kind/limit/五分钟游标→认证GET→原WorkDetail独立分类历史。合同/检查/人工标准验收三类可翻页；新header当前合同只作读取围栏，旧row不冒当前候选。

原timeline/上下文历史/当前检查/产物/人工接受保持；未公开rawbinding/attempt/resources/argv/results/actor/private路径。原4MiB精确producer预算保留，public128KiB和流读取取消独立核；不声称同步读/解析有硬抢占deadline。

机器-only Work可以被整体接受而没有human criterion验收row，故新分类明确“标准验收”，整体交付接受仍看原timeline/Outcome。超大首条显式blocked/无继续cursor，用户能区分受限与真正空历史。旧服务404/unsupported保留原记录界面，跨kind/身份/Work/config迟到不覆盖当前数据。

## 实际验证

| 项目 | 结果 |
| --- | --- |
| 新HTTP/原Store/Application | 4 PASS，65源metadata测试行、Scope/cursor/kind/limit/expiry、readonly、badframes/blocked |
| 既有evidence history | 4 PASS，原时间线/旧游标/覆盖和HTTP保持 |
| 既有上下文预览 | 14 PASS，A WorkIndex新增事实后原授权/预算/来源/决定失效和readonly组合保持 |
| 新transport | 1 PASS，strict身份/元数据/旧404/流上限取消 |
| wrapper policy/selftest | 1+10 PASS，两已审hash、实际声明一致、第三digest拒、原CRC/inventory/command/credential控制 |
| contracts/生成/strict/build | 241 PASS、可重复、Runner hash不变、Console/coordinator exit0、build0 |
| 新真实App分类历史 | [8 PASS](history-browser-confirm/browser-report.json)，11reads/0businessPOST/0event，2受控原Work接受 |
| 原模板/配置App | [9模板](recipes-browser/browser-report.json)/[6配置](model-browser/browser-report.json) PASS，均f71干净源码 |

新历史8项覆盖按需读取/两页、合同和真实人工标准接受、外来Work拒绝、迟到kind、超大首条、旧服务、换Work、桌面手机。两原Work走原检查/currentCandidate/available.accept/manualaccept到delivered；14附加行明确为metadata fixture，不是14次模型运行。

初始[失败1](history-browser/browser-report.json)/[失败2](history-browser-recheck/browser-report.json)保留：原测试误把machine-only接受当criterion验收；修正界面语义和真实human正向后[f71首过](history-browser-final/browser-report.json)。不是修改生产完成gate或伪造接受记录。

两轮截图已检查：[最终桌面](history-browser-confirm/desktop.png)/[最终手机](history-browser-confirm/mobile.png)。首轮只发现分类select原生尺寸偏小，按现有token/手机16px统一，确认后停止修饰。旧ramp与bundle689.99KB advisories保留。

最终f32只在b454上改malformed ID safeParse→400与该负例，4backend重跑通过；前端字节与b454完全相同，f71→b454只有新控件class/CSS。原9/6有效路径证据不冒称后发非法路径测试。当前source/unit/截图身份见status字段。

## 发行静态准入

main verifier把原8de31和已审339b列为显式允许集，仍actual==manifest且第三hash拒；不从输入学习hash、不放宽Node/LICENSE/command/完整清单。独立实际W35 599d/11027/39c静态已VERIFIED，旧W33不动，无新归档或包内执行。E安装仍R1/W33，W35独立安装不由静态通过推断。

## 未达与保护

B新终态physical quiesce与PID工具、C sync superseded/digest、E未知资源查询等仍hold；没有导入它们，原Work/Broker恢复和原2/4未达。G当前identity缺可信原start输入保持unknown；J新源没有本轮默认导入。source/受控/安装/native/recovery/value分层，完成率不自动调整。

候选/dirty、12用户实例/全部状态、原B/E预算保持，0真实vendor/model/native，无globaldiscovery/unsafe信号/新tar/用户实例重启。临时浏览器/HTTP/Vite均正常finally关闭。
