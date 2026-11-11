# 第六轮主线检查点：明确决定与共享待办排序

日期2026-11-11。分支codex/g2-execution-integration，输入派工82db295。当前生产源f638fe0；明确决定HTTP检查点d1e704c已先发布供其他Agent消费。本报告是M1-M3的有限纵向交付，不是整轮完成或个人Alpha发布准入。

## 实际新增

- A的v13持久证据、来源和时间线port进入主线；C的决定事务、真实SQL重放修复与共享AttentionRanker进入主线；B exact profile resolver进入主线，仅按模块验证。
- POST /v1/decisions/prepare只读生成5分钟签名预览；明确确认后决定、事件和回执同事务，source/grant/身份/范围/期限变化拒绝。GET目录与record/revoke命令均用companion schema，frozen Runner/data wire不变。
- 用户消息旁可记录为项目决定，编辑后先预览再确认；顶栏可查询项目来源/范围、逐条明确撤销，历史保留。未知响应保存原command，刷新后仍核对原请求，不重建身份。确认期限不等于决定范围到期。
- 原跨项目待办默认消费C确定性排序与共享理由；页内有界范围不变，不新增权限、批量接受或新执行器。

详细公共输入与消费步骤见 [0024](../../../docs/rfcs/WP-16/0024-wave-06-decisions-http-checkpoint.md)。决定记录是审计事实，不是native授权，尚未自动注入reasoner；通用proposal确认HTTP、恢复新授权、A后续Outcome生产消费者和D/E发行准入都仍单列。

## 证据与限制

精确命令、来源和检查数见 [integration.json](integration.json)。模块/SQL/HTTP/受控进程/浏览器分层，不把包内通过当实际原生或发布通过。

| 范围 | 结果 | 说明 |
| --- | --- | --- |
| A storage/workflows | 75 / 21 PASS | v13、不可变记录、事务/重开/快照 |
| C knowledge/routing | 38 / 40 PASS | 决定事务与共享排序；不是复核收益 |
| B catalog | 41 PASS | 含12个exact profile反例，非原生控制 |
| 公共契约 | 208 PASS | companion与frozen identity/generated |
| 后端组合 | 51 PASS | 旧应用/HTTP/执行、attention、计时及决定8项 |
| 前端单测 | 19 PASS | 含预览/回执的来源和command身份 |
| 真实SQLite消费者 | 7 PASS | [assistant-sql.json](assistant-sql.json)，旧决定重放失败已通过 |
| C旧领域准入 | 3 PASS | [c-domain.json](c-domain.json) |
| 决定HTTP浏览器 | 4 PASS | [report](decisions-browser/browser-report.json)，f638fe0干净源码 |
| attention受控浏览器 | 6 PASS | [report](attention-browser/browser-report.json)，6076d00干净源码 |

四条决定浏览器实际验证：预览无数据库/事件写；明确记录/刷新/撤销留审计；服务端已提交但响应丢失后刷新并原command重试只落一条；决定不创建Work或native效果。首次浏览器暴露StrictMode effect清理提前关闭dialog，已修复并在干净提交通过。

截图为1440×900与390×844的实际HTTP/SQLite确认态，最终同f638fe0。旧“有效至”容易被误认为决定到期，已明确为“确认期限”并补齐外部动作；范围本身有到期时间时另列。独立界面评审及设计一致性报告限定于当前界面扩展，不能推广为整产品/原生/研究准入。

typecheck/build/generated与静态文档检查通过；Vite仍有现有大于500KB chunk咨询警告，未宣称性能优化。所有命令未启动真实模型/native任务，外部B/E的ledger未在本报告重置或消费。

## 预览

[http://127.0.0.1:5185/](http://127.0.0.1:5185/)，API8801、私有state `.local-state/decisions-preview`，已核对网页200、decisionsAvailable=true、decision-catalog/1与deterministic_priority。初始无旧工作或决定；使用正常消息来源再明确记录，不需要模型回复才能使用该入口。

原5180–5184及各自历史/业务队列保留，没有自动迁移或合并私有DB。开发预览不是D的可迁移安装物，也不代表恢复后新授权已开放。

## 下一消费者

| 角色 | 现在可消费 | 仍要完成 |
| --- | --- | --- |
| A | 主线真实accepted事件、当前v13/shared契约、决定HTTP | 后续接受Outcome消费者的独立准入与接线 |
| B | exact resolver已进入主线 | 原生控制、真实session/usage/胶囊与E前置 |
| C | A真实routingEvidence已进主线，共享ranker已默认接线，record/revoke HTTP存在 | 真实A-port组合和通用proposal/context消费者；旧“main无接口”阻断需更新 |
| D | knowledge/routing runtime依赖和新HTTP/静态console | 新来源安装物、恢复/重绑定消费；恢复新授权仍待main |
| E | 两项目待办/决定/计时公共入口，新的精确来源 | 独立新基线验收与原预算内pilot，不能复用旧不存在结论 |
| main | M1源码与明确决定/待办纵向已交 | 恢复inspect/prepare/commit、新提案HTTP、A新投影、D/E准入与价值决策 |

继续原第六轮整包，不需要重新派一轮小修。本批没有新协议Driver、默认路由/复核、自动接受、自动知识推广、CAC或桌面壳。
