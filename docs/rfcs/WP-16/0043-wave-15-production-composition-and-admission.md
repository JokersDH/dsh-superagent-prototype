# 0043：第十五轮生产组合与范围验收

2026-11-12。本轮审查基线`6d245194bdf345bf0d7511671e6468cded3b215c`；主线新增实际source预检检查点`697efdc`，范围见[0042](0042-logical-source-preflight-checkpoint.md)。这不是稳定Alpha发布批准。

## 已确认的成果

| Owner / 固定source | 本次独立验证 | 准确范围 |
| --- | --- | --- |
| A `3121ec46126a8579b45c7d128ee1700df4c82978` | 旧4/4、storage87/workflows105、build通过 | 64位rowid、payload_ref、扫描成本补齐；reader/strict事实最小源码已集成main。新actual inspect/prepare已交，confirm/许可仍未接通 |
| B `cfe6a3a39250b196c7cdc93349c794161591b958` | 旧4/4及wave13旧5/5、strict/exactOptional、helper68；B13正常纵向6PASS+1NT | 保留真实Work/Effects/Runner/Broker/answer/accept范围；B14独立认证服务重连只是substrate，不能覆盖实际业务恢复 |
| C `2e1c0950f29c3236433e1485011e1f0738554145` | 旧6/6、四包285、当前main组合11、strict/build通过 | 遗漏真值、绝对路径、artifact顺序旧问题关闭。factory/typed候选可按范围集成，main默认接线仍欠缺 |
| D `e9f8aff8c6ec71009879ca0c744a1b1e5c06149e` | 旧probe返回6PASS；新6714-entry tar核验通过且含M1 | 旧UID分支因未mock新增读取而在不可读处拒绝，不能算完整UID证明；生产journal形状及停止后UNKNOWN仍P1 |
| E `d0d1159fb3a936bd37b0960655f76c7dfe29031b` | 旧5个证据变异被拒绝；等价subject控制2项拒绝成立 | 实质evidence存在性、五字段subject、`:id`与personal helper有修复；实际行为/模式/ABI关系仍缺，installed tier仍FAIL |

主线`697efdc`的恢复新8项与旧恢复组合共66PASS，contracts228/storage87/workflows93及strict通过。它实际改变现有HTTP预检的source判断，不再只新增未消费helper。未接A整包历史工具或迁移，没有把候选测试数当主线已集成数。

## 本轮仍需处理

### B：把实际产品接到独立Runner

B14实跑exit1：5PASS、1FAIL、1NT。其中两个PASS只由begin/delivery receipt推导，receiver实际begin=0/answer=0。独立服务没有实际Runner host/子writer，`writer-${pid}`和writer状态只是合成数据。新的独立认证inspect服务确实存活并可重连，这个局部结果保留。

stop失败根因已隔离：fixture固定epoch5，导入producer的当前epoch1；所谓stale也发1，实际拒绝合法当前身份。epoch匹配后同一cancel可接收。最后一行crash marker还覆盖了cancelError，需使用结构化分阶段结果。原B13曾因陈旧contracts dist缺新enum而直接导入失败，source loader后6PASS+1NT；不记为新源码回归。

建议先复用已有`NativeProductAttempt → RunnerLink → apps/runner/src/runner-service-entry.ts`以及B-owned fake app-server，驱动真实Application/Effects/AttemptRunner/Broker；不要创建第三套receipt-only coordinator。当前main有意将重开后的业务发送保留unknown；若接新business recovery能力必须给最小真实port/RFC，由main接产品授权，不能在测试里写回执冒充。

### D：身份必须由真实producer保存，停止后仍须三态观察

`upgrade.mjs:709`实际onSpawn仅保存pid/start/time；`:518/:524/:526`只在argv/root/operation存在时检查，调用者也未传expected operation。生产形状journal对无关同根worker仍SIGTERM/proven=true，实际recover也SIGTERM后REVERTED。另`:433/:596`的二值alive将signal后stat失败当成dead，mock仍活但proven=true。

本轮新完全mock工具加入**完整身份正对照**，再单独制造signal后未知，避免“先因缺身份拒绝，碰巧让UNKNOWN测试通过”。结果1PASS/3FAIL，实际OS扫描/信号/启动0。必须贯穿birth→journal→record→caller→recover，使完整身份必填并真实产生；不能靠测试手填可选字段完成。

### E：证据存在不等于行为成功

旧空evidence检查已修；此前五个拒绝被这个共同前置挡住，因此本轮保留真实evidence和canonical artifact case另测。格式合法的foreign source两项正确拒绝。仍接受：BLOCKED/null health仅改PASS、fixture instanceMode、copy缺exit/code、fault只剩PASS step名称、linux/x64/ABI999的current subject。

新五个接受观测对应真实无效证据。当前baseline的current-install本身BLOCKED，后续复验必须有一致的成功正对照，并验证各变异的具体失败原因，不能让另一个坏前置再次掩盖目标条件。`release.mjs:369/:376/:387/:788`需核对实际observed/exit/health/operation/API结果与完整subject。

### C：小的防御性问题不应阻断可信集成

`reviewVerifiedReplyCandidates(input:unknown)`在schema验证前访问body/identity/principal，三种空输入抛TypeError，正对照正常。是P2未知输入健壮性问题，不是已准入权限绕过；main可先在实际CompletedAssistantReplies读验后构造typed输入集成。

目前main保存回复仍`suggestions:[]`，模型port只返回text/model；导入validator不能称非空候选功能已完成。main必须沿原SDK/Reasoner单次请求接合法结构化结果，无格式支持时仍普通回复，不新增LLM loop或自动补发。

## 包字节与发行范围

新tar`/Users/hh/Desktop/joker/pa-artifacts/wave14-target/wave14-target-114b73c.tar.gz`：source`114b73c2723c3ec862f5ae199dc35e0152fbafed`，build`a7df2b225a8c5c42`，SHA256`246fd80ded7b5d2445890a7854dbc6261a71c1c4456f3ee2f41404b9b6e3c785`，20177745 bytes。6693文件和21内部symlink核验通过，schema18、Node24.21.0、ABI137、SQLite3.53.4、darwin/arm64。

包确有discussion-only/DiscussionEffects/context/history/source/replyResults，不再沿用“缺M1”的旧结论。E的161PASS/17NT仍test source ab73af5和旧99832f6 subject，未验收新包；current-install仍NT，完整installed tier诚实FAIL。114b73c也没有main新增697efdc的逻辑预检，不能称含此新功能。普通M1安装仍独立于恢复授权；安全运行字节改动后需新冻结，文档HEAD变化不强迫重打包。

## 下一轮出口

原A–E目录/分支/拥有路径与每个账本保持。每人十阶段、早/中/最终三个可运行source，交检查点后继续独立队列。A以697efdc实际预检/非空恢复做组合；B先交真实产品→独立Runner；C交实际来源/候选消费数据；D交producer完整身份及三态停止；E交真实动作与准确subject的same-package验收。main继续默认C factory、非空候选、source confirm/许可及恢复控制接线。

不新增模型/native allowance。B旧cap4 UNKNOWN不可用，E原24turn/200000token/USD5/单在途pilot仍BLOCKED；无reset/refund/补样本/新价格研究、Driver/CAC/桌面/自动接受。保留十一组服务与所有state/tar/profile。逻辑source完整、局部认证重连、mock PASS和静态派工均不授物理停止或发行准入。详细任务见[wave15](../../../agent-tasks/product-wave-15/README.zh-CN.md)，证据见[本轮验收](../../../reports/releases/wave15-admission/README.zh-CN.md)。
