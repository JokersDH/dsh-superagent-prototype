# 分别转发给A–E

原目录/分支不变，十阶段整包，早/中/最终source发布后继续独立队列。真实模型/native0，账本不刷新，十组用户服务保留。

## Agent A

```text
继续第十三轮A整包。目录 /Users/hh/Desktop/joker/superagent-agent-a，原分支 codex/g2-workspaces-verification。保留改动，fetch合并最新origin/main，读AGENTS.md、agent-tasks/product-wave-13/README.zh-CN.md、agent-a-data.zh-CN.md和WP-16/0039，连续执行A1–A10。
旧4例/87+94回归保留，A18 reply/history main已经使用；先关probe-wave13-storage新3例：负rowid逻辑变化漏读、ignore的activation索引与body不符、command event改为rejected仍被忽略。复用严格A fact mapper，完成真正一致完整源，再接main真实baseline消费者、B既有控制数据、非空备份/进程故障/规模和schema安装输入，不重做已交表。
阶段1–2、4–6、最终各push可运行source后继续；缺main激活仅该消费者NT，转独立队列。仅storage/workflows、append-only迁移，不建授权/第二发送生命周期。共享probe用PA_ADMISSION_REPORT=/tmp/pa-wave13-a.json。只push原origin分支，模型/native0。
```

## Agent B

```text
继续第十三轮B真实产品控制整包。目录 /Users/hh/Desktop/joker/superagent-agent-b，原分支 codex/g1-runtime，保留两个共享报告差异。fetch合并最新main，读AGENTS.md、本轮README、agent-b-runtime.zh-CN.md和WP-16/0039，连续B1–B10。
第一出口必须用createProductRuntime+原create_work/Application/Effects/Runner feed/QuestionBroker/answer delivery；参考main tests/integration/product-execution.case.mjs与production-runtime.case.mjs。新版B13虽有真实Store/独立协调进程/认证cancel，但Work/Ticket/effect/fact/dispatch/question/answer表全0，只写receipt，不能再称生产begin/question/answer恢复。先交一个真实纵向生产checkpoint，再做SIGKILL窗口、回答/stop/steer/epoch、2/4槽位和资源上限。
同时关probe-wave13-runtime的嵌套BigInt/NaN/Symbol key和版本/嵌套诊断路径5例，用结构化JSON核对实际payload，别reserve后才序列化。缺接口给最小RFC后继续其他真实路径，不造第二ledger/测试权威表或凑recover方法。阶段早/中/最终push后继续，原cap4 UNKNOWN不可用，模型/native0，不做费用/recipe研究，不扩Driver。共享probe报告放/tmp，仅原B路径与分支。
```

## Agent C

```text
继续第十三轮C可替换来源整包。目录 /Users/hh/Desktop/joker/superagent-agent-c，原分支 codex/g3-assistant-context。保留root lock差异不提交，fetch合并最新main，读AGENTS.md、本轮README、agent-c-context.zh-CN.md和WP-16/0039，连续C1–C10。
旧8+17和269包回归/当前main组合9项通过保留。先关probe-wave13-context新6例：trusted Scope缺失/Composer scope泄漏、上游coverage在Composer丢失、历史附加foreign完整回复身份、5000 omissions无限输出、detail路径泄漏。授权与完整性要贯穿actual composer，不只selector；元数据预算和脱敏覆盖所有字段。再交可被main真正替换的factory/guard接口、完整候选数据、真实A18/history/source/reply组合与规模失效矩阵。
main e1e0c97历史HTTP/UI和A work修复已交，不再报泛化missing；旧私有路径正常回归不能称新factory已消费。只改四owned包，不写SQL/HTTP/签名授权或新LLM loop。早/中/最终push后继续独立阶段，共享probe报告放/tmp；模型/native0，原分支/服务/账本保留。
```

## Agent D

```text
继续第十三轮D所有权到当前安装整包。目录 /Users/hh/Desktop/joker/superagent-agent-d，原分支 codex/g3-local-distribution。保留改动，fetch合并最新main，读AGENTS.md、本轮README、agent-d-delivery.zh-CN.md和WP-16/0039，连续D1–D10。
旧6例通过、020af82/schema18真实tar成立，但新P1还在：legacy copied record凭launcher.json自证能停原API；record/journal PID缺start或复用仍SIGTERM；ps失败/pidReused返回proven空集；recover错install确认或cleanup停复用PID。先统一完整PID/start/UID/root/operation及old/new install角色，unknown绝不signals或proven。运行新6个mock+1个自有legacy probe，修好后才跑新鲜自有真实进程矩阵。
之后消费当前main history/source/reply与启动readiness，交非空backup、当前clean源码新tar、personal冷安装及legacy16→18/同schema双binary升级/故障重入。旧020af82没有新history/sources API，不能重标current full；普通安装不等激活/研究。早/中/最终source push后继续，只原D路径/分支，不清用户state/ledger、不全局kill；模型/native0，十组服务保留。
```

## Agent E

```text
继续第十三轮E真正发布gate整包。目录 /Users/hh/Desktop/joker/superagent-agent-e，原分支 codex/g3-product-acceptance。保留全部runs，fetch合并最新main，读AGENTS.md、本轮README、agent-e-acceptance.zh-CN.md和WP-16/0039，连续E1–E10。
先修installed-alpha必测：E7-OWNERSHIP-COPY、E4-UPGRADE-FAULTS、声明的E6-CURRENT-MAIN-INSTALL不能在gate外；补required FAIL/UNKNOWN/NT/错source的evaluateRelease负例。target建库同18不能强制要求schema变化，legacy16迁移独立；去掉无条件NT与build-handoff固定旧阻断。已过A18真实进程回复4项保留，再独立消费当前main e1e0c97 history/source/SSE/UI、多tab、B真实生产恢复和D新所有权负例。
你的旧143PASS/1FAIL/18NT仍是a22/schema16；D有新020af82/schema18但缺新history，不能混source。等安全fix和准确新tar后测personal模式（不要强制fixture冒充）、非空搬根、真正升级/故障矩阵和50操作稳定性。缺单个入口仅该项NT继续独立队列。早/中/最终push后继续，仅product-acceptance，不改生产/放松断言，模型/native0、pilot账不变，十组服务保留。
```
