# 第十八轮：真实旧数据、正常业务与同包验收长包

2026-11-13。继续原A–E工作树、分支、scope和所有ledger/tar/report。wave17验收见[0051](../../docs/rfcs/WP-16/0051-wave-18-admission-and-product-exits.md)。main新[0050](../../docs/rfcs/WP-16/0050-snapshot-schema-admission-checkpoint.md)检查点e438ab5只接required schema检查，保留现有v1备份及digest，A v2兼容未整包准入。

## 本轮已有输入

- source prepare/confirm/audit、默认factory、同次非空回复候选及明确确认已经实现，不再列main缺入口。
- A旧混版本/缺表反例和C getter已关闭。新问题是A用含work_id的新摘要验证真实旧v1，非空旧备份被拒绝。A/C只读测试有进展，但问答/来源/候选的统一第二根实际流程仍需补齐。
- B已实际接App/原ProductDriver/A失败事实与子进程；当前fake executable含.mjs语法错误及协议字段缺失。main给出可运行[正常准备诊断](../../tools/bootstrap/diagnose-wave18-b-preparation.mjs)，通过prepared→begin→问题，但**不计B提交交付**，不代表恢复能力。
- D65102f7准确包独立安全探针5/5；旧97cace7同样探针2PASS/3FAIL。E用当前D checkout安全结果给旧97安装包补证，因此installed-alpha PASS不能采信。下一步必须同一不可变包的helper与运行证据。

## 整包出口

| Owner | 完整目标 | 第一个可运行检查点 |
| --- | --- | --- |
| [A](agent-a-data.zh-CN.md) | 真实旧producer兼容→v2完整数据→统一恢复 | 原main非空binding v1能读，当前v2拒绝降格 |
| [B](agent-b-runtime.zh-CN.md) | 合规producer→正常问答→业务恢复交付 | 自己提交的fake通过语法/version/准备/问题/回答 |
| [C](agent-c-context.zh-CN.md) | 一致快照→第二根真实只读用户流程 | 同一份数据跨root，HTTP读验/held/无重发成立 |
| [D](agent-d-delivery.zh-CN.md) | 已过资源门上的非空personal与交付 | 当前同包非空候选、恢复与e438 schema检查 |
| [E](agent-e-acceptance.zh-CN.md) | 同包安全证据→真实installed verdict | 旧97不能借新651 helper证据过gate |
| [main](main.zh-CN.md) | 最小安全源码与可信产品接线 | 已交e438 schema guard及B正常准备诊断 |

## 连续工作方式

完整包十阶段、早/中/最终三个可运行source checkpoint。为整个包建立或沿用一个goal，目标是本包完整结果；检查点提交/push后继续，不结束在第一个修复。遇外部接口未到只标对应NOT_REACHED并转独立队列，不能把没有scope证据的阶段记PASS。Goal不改变任何执行预算，不能用重启goal重置ledger。

先同步最新origin/main，保留B两份历史report diff和untracked b16-real-begin、C lock diff、E全部runs及用户日志。只stage明确owned paths，push原origin分支，main推origin/main，不push upstream，不reset、不换工作树、不删除历史。

状态写各自owned目录`wave18-status.json`，区分submitted source/main诊断、module/source-fixture/installed/native/value。证据要有真实输入、行为、source/tuple、退出码、receiver/资源与未到项，不能靠测试总数或step标签。每个进程/网络/故障场景有有限deadline和准确自有资源清理，不无限等待或循环凑时长。

main独占contracts/config/root lock/HTTP/provider/UI；A独占storage/workflows及迁移；B独占原runtime/driver/runner/native-acceptance；C独占context/proposals/knowledge/routing；D独占launcher/distribution/portability；E独占product-acceptance断言。跨owner先交最小实际port/consumer/RFC，不另建ledger/确认权威/生命周期。

自动真实model/native turn0，B历史cap4 UNKNOWN不可花，E原24turn/200000token/USD5/单在途pilot保持BLOCKED，无reset/top-up/补样/未知退款或新价格研究。无新Driver/CAC/桌面/自动接受/动态DAG。fake必须固定Node与本机fixture，不回退真实Codex或用户网关。

十二组5180/8796至5191/8807及所有state/profile/tar/ledger保留。安全probe先纯mock；只对独立证明probe出生PID/start/UID/root/operation发信号，不按同UID/祖先/路径认领。普通personal安装独立于激活/试点；同一tar/hash/source/build/schema/ABI/mode的bytes先冻结，E再最终验，docs-only不重打包。

分别转发[五段话术](forward-prompts.zh-CN.md)。`node agent-tasks/product-wave-18/verify.mjs`只做静态分工校验，不授runtime/native/release权限。
