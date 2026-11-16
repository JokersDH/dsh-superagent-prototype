# J：原项目声明、明确委托与迁移重识别完整工程

2026-11-16。原目录 `/Users/hh/Desktop/joker/superagent-agent-j`，原分支 `codex/g5-project-recipes`，固定提交 `f6a1bf59db7461772661e51d1ac05702788004c0`。保留dirty/history，fetch并merge origin/main，不reset。

先读 AGENTS、START-HERE、product-spec/README、本轮[README](README.zh-CN.md)、[0086主线已交](../../docs/rfcs/WP-16/0086-main-native-callbacks-and-support-consumer.md)、[0087验收](../../docs/rfcs/WP-16/0087-wave-34-reviewed-architecture.md)、[0088工程程序](../../docs/rfcs/WP-16/0088-wave-34-two-package-engineering-program.md)。

一个whole goal覆盖两个连续工程包、六个完整产品成果。每项包含生产实现、实际consumer、正负验收、可运行source交接。早交source后连续推进两包/联调/独立队列，不逐fix等派工；无同日deadline/工时/token承诺。

## 本轮起点

main原preview→NewWorkForm→current-input重验→原create/check/candidate/manualaccept已经实现，本轮干净9App场景仍过。J新两个真实注册根的受控交付/原产物重开有实质进展；21项freshness/rebind/module/CLI/two-project独立复验通过。

rebind/module仍候选，不是main默认迁移页面；不能把CLI或helper结果写成安装迁移准入。原项目根重新登记必须由main原授权路径，report是data-only，不能携带旧grant或使恢复只读可执行。

## 工程包一：日常项目到原交付

### 成果一：普通Node/npm/pnpm项目声明的完整生产适用性

完善三类recipe的合法输入/观察/匹配/fields闭包，支持当前已承诺的单包Node/npm/pnpm范围。profile/check/Scope必须来自同一当前项目配置；保留原声明atoms/exclusions/expiry/externalActions，不推断新权限。

目录、文件/链接替换、大小/总预算、缺lock/未知manager/不支持workspace给needs_input或unsupported及可行动缺项。scripts仍是数据，不自动安装/运行/注册check，未知语言不虚构支持。

实际consumer消费main认证preview和原Application，逐项核对显示scope与effect fields一致。正例三kind×支持栈可选有限代表组合；负例跨项目/旧配置/过期/隐藏excluded/未登记root必须拒。

交接：精确source与最小依赖闭包、原DTO对照、独立复现，不以新增schema替代原Application授权。

### 成果二：两个原项目完整日常交付与失败回路

以各自真实登记root/ID/scope/check/profile走preview→原form明确确认→原Work→问题/回答或受控执行→check→currentCandidate→available.accept→人工接受→delivered→原ID/全产物重开。

扩充可修复FAIL、missing input、项目切换/重读配置、旧draft重新应用；不为通过而替换为project-atlas或另一个新Work。候选ready与action可用分开，不抢跑人工接受。

实际consumer继续原main类/HTTP，main/F接真实App；J不改它们文件，不修改Eoracle。受控fixture协议明确标controlled，无realvendor/native。

交接：两个不同项目的原Work/contract/criteria/验收/bytes列表及有限负例；stale、foreign candidate、unknown commandId保留原语义。

### 成果三：当前配置/元数据变化下的可解释重验

完成生成/应用/确认之间的facts/config/catalog/version/clock变化政策。稳定content digest不含观测时间；相同内容重读不无故失效，内容/当前配置变化必须失效；未来/非法clock不当current。

对每种变化给结构化reason而非拼字符串决定权限；当前字段重验复用原assertDraftCurrent，main保持fresh server clock和registered root，public input不注入任意facts。

实际consumer：编辑中的原draft遇配置/脚本/manager/lock/Scope变更，拒旧apply/create且允许重新读取/确认；不静默扩大fields。recipe适用不表示check命令安全或grant通过。

交接：稳定reason/vocab、main可用的小interface、正负观察与兼容策略，避免新collector/ledger。

## 工程包二：迁移、重开与同版本交付

### 成果四：有当前登记依据的项目重识别产品

完善 `rebindRegisteredProject` 的current/changed/unbound/reidentified状态、差异归因与完整shape/边界。只有当前trusted rootFor可观察，旧facts只是比较输入，不自行注册、移动、修改授权。

明确root变化但内容相同、不同ID但内容相同、相同ID内容变、不可读/越界/metadata替换等政策。差异含unknown时不宣称无变化；不能仅改ID就宣称迁移成功。

实际consumer给main原注册/预览路径可组合接口；main/F将status/reasons呈现在原流程并要求原确认。缺公共surface时交source/RFC继续独立队列，不另起HTTP/App或临时UI。

交接：最小rebind/module/index闭包、正确新旧project身份、report不含私有root/key/grant的证明，及主线consumer准确source。

### 成果五：非空恢复后的重新登记与原历史连续性

与A/D保留同schema真实非空数据：旧Work/合同/候选/验收/产物仍是旧身份，恢复先readonly；新项目登记与新scope授权后创建新工作，不把旧结果复用为新项目权限。

测试新root/新ID与原history之间可解释导航和original bytes核验，旧draft不能跨id应用。明确搬根/恢复/运行接管是不同层，不能用metadata match代替原Work恢复。

实际consumer：同一冻结cohort的backup/restore→readonly原数据→受信登记→fresh recipe→原确认；授权执行未达保留HELD，普通readonly/声明工作继续。

交接：D/E可独立运行的非空样例、准确subject/边界/旧格式与新source差异，禁止复制state获得新授权或清除marker。

### 成果六：项目能力模块的可维护发行与同事交接

完善deterministic module description、版本/exports/catalog/contract digest、schema兼容和最小runtime依赖。旧包缺rebind时应明确不可用，普通manual delegation仍可用，不能启动崩溃或回退真实CLI。

D固定W33独立验收不被J新source追着改；必要runtime successor按源闭包另冻结，E只用该包内实际模块。npm pack dry-run不是整产品可部署证明。

实际consumer：CLI/main/D清单各核同一模块身份，H/E独立读包内字段/版本和有界report；给同事明确支持栈/需输入/不可用/旧授权策略。

交接：可运行source、精确构建顺序contracts→project-recipes、只列必要新文件、失败不阻主程序的兼容回归；不是新tar冲刺。

## 独立备选队列

等待main rebind UI/D/E时继续owned匹配、边界、CLI权限/错误、实际preview消费者与兼容文档；不无限轮询/重复soak/自行编辑别人的主线。避免扩新语言/新Driver掩盖当前普通项目未闭合。

## 所有权与运行边界

仅 `packages/project-recipes/`、`tools/project-recipes/`、`docs/project-recipes/`、`reports/project-recipes/`；状态 `reports/project-recipes/wave34-status.json`。main独占root/contracts/HTTP/App，A sole migration、E sole assertions。显式owned路径推原origin分支，不upstream/reset/清状态。

自动真实vendor/model/native0；B cap4 UNKNOWN不可花，E原24turn/200000token/USD5/oneflight pilotBLOCKED，不重置/补额/退款/借凭据/price或native billing-recipe研究。项目recipes不扩模型额度。

十二5180/8796至5191/8807、state/profile/tar/ledger/dirty/history/runs全保留。不global discovery/substringkill/绕产品拒绝清理，不新Driver/CAC/desktop/autoaccept/writer racing/dynamicDAG/第二生命周期。

## 整包完成条件

六项都有生产行为、真实consumer、正负与可运行source交接；独立区分source/受控/安装/native/原恢复/value。每次source发布后继续整个goal/联调/独立队列，不能只完成报表或等一次主线回复就结束。
