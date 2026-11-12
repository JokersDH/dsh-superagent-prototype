# C：可靠来源检索、审阅与提案数据长整包

原目录`/Users/hh/Desktop/joker/superagent-agent-c`，原分支`codex/g3-assistant-context`，仅context/proposals/knowledge/routing。读README/0035并合并最新main；原root lock差异保留不提交。main4140cac已有真实context-use/SSE，模型/native0，不写SQL/HTTP/LLM loop。

## C1 对齐现用会话边界并早交

关闭actual-export probe三条会话兼容：任意question anchor排除，未选work时工作补充不纳入，合法assistant/reasoner_reply按role/provenance保留；project/conversation/current work与permission display规则保持。cutoff通过可信reader wrapper或兼容API维持，不能把后来追加的本条消息重新纳入。早交真实adapter checkpoint，不在主线替换之前宣称用户路径已使用。

## C2 分开限制扫描、lookup与返回

artifact published IDs仍由main验证，adapter不得全registry枚举；maxIds必须限制尝试lookup数量，100个missing不能越过2次lookup。重复ID、oversized元数据、缺失和部分覆盖明确报告，返回数上限另算。消息分页同样检查非进展cursor/预算/扫描cap，不把incomplete标空且充分。

## C3 完整序列化预算与截断

bytes/tokens覆盖前后缀、分隔符和末尾newline；用UTF-8/中英/代理对/长标识的边界数据证明硬上限与estimate实际一致。上游slice已truncated必须传播到references及整体结果，不能因本层未再次截断变false。不可读/缺失来源仍显示原因，不静默drop所有证据。

## C4 完整manifest比较与失效

sourceId、kind/path、whole/visible digest、resolved budget、truncation、selection/contract/baseline和遗漏均参与相应比较；source替换和8192→4096不能unchanged。区分changed/missing/incomplete，纯函数不签grant/保存确认。保持main同步guard与最早source期限语义；阶段1–4全部probe关闭后交稳定组合source。

## C5 人可读来源审阅数据

提供title、来源类别、明确引用、visible excerpt、有效/历史/缺失/截断和遗漏的受限投影，供main从冻结bundle做消息审阅；保留digest但让开发者能辨认实际来源。标题/引用只能来自可信descriptor/实际记录，不从模型文字造真实链接，不返回host路径或actor/tool字段。

## C6 单项目确定性相关性检索

复用A已有会话/决定/工作read index及本包ranking，支持长会话/多work的相关来源选择，仍先授权scope与source族，再排序/预算。有效决定不复活旧项；原消息、权限展示和其他项目不得因高相关分数混入。无需embedding、向量库或模型调用；提供带期望命中/误混入的数据集与有界指标。

## C7 上下文历史与完成结果消费者

消费A新contextHistory/replyResults及main实际audit/history（到达后），构造当前讨论可复用的历史来源视图。历史完成结果是data，不能推导新grant或重复模型请求；scope/合同/原source变化需重新授权。缺新port只暂停对应组合，用实际A16数据集继续C5/C6。

## C8 明确提案候选的纯校验与投影

复用既有ReasonerProposalSchema和planProposalCommand，做model返回候选的有界解析/过滤、当前source/project/contract校验、显示所需输入和needs_user_input。正文没有合法候选时保持普通回复，不为修格式自动追加模型call；候选绝不自动创建Work/写policy或接受交付。main负责SDK/provider、原子结果发布、HTTP与明确用户确认。

## C9 当前产品与真实A数据回归

消费main prepare/send/audit/SSE，测试当前私有adapter替换为新export后：源撤销/自然到期、cutoff、原token重放、provider离线核对、预算与历史body引用保持。用mock AssistantModelPort核对准确prompt和数据角色，没有新循环。main未接新history/候选UI时如实NOT_TESTED该项，继续现有产品兼容。

实际coordinator替换仍由main完成；尚未替换时，该产品消费者记NOT_TESTED，继续真实export与当前main语义对照，C不自行改coordinator。

## C10 规模、兼容与完整交接

四owned包typecheck/build/test、actual-export probe、真实A16/后续schema、主线HTTP和有界长会话性能。维护`packages/context/reports/wave11-status.json`，阶段4–6交中期source，最终列导出/替换方法/数据集指标/命令/限制。清掉已移除helper残留imports/types，保留main事务确认，root lock仍main拥有。

## 独立备选队列

- 实际export九条负例、UTF-8/budget/truncation、source identity比较。
- 有限检索dataset、可读引用、missing/expired/permission区分，不等模型或HTTP。
- 既有main4140cac/mock-provider消费者，不等新history UI。
- 基于ReasonerProposalSchema的纯候选数据与current binding校验，不自建发送/存储。
