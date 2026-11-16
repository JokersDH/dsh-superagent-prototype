# W32 项目上下文、明确决定与来源手册

适用：普通安装实例（同一台机器、同一个 `pa` 实例）。客户端：
`packages/context/tools/assistant-context-cli.mjs`，只走产品公开 HTTP，不读 SQL、不持 token 文件。

## 认证
- 已安装实例：`--install <app> --state <state>`，由包内 `local-state` 读取本机 api key。
- 本机受控联调：`--api http://127.0.0.1:<port> --api-token <bearer>`。

## 日常流程
1. `preview --project P --conversation C --select conversation[,project][,decisions]`
   返回 `status/trust/groups/sources(sourceId,path,sourceDigest,bytes)/omitted/issues`，
   `authorization` 恒为 `none`；不会创建 Work。
2. `candidates --message M` 查看候选 index/payloadDigest。
3. `propose --message M --index 0 --project P --conversation C`
   先 prepare 再 confirm（`--reject` 拒绝，`--prepare-only` 只看）；重复确认被原产品拒绝。
4. `send --project P --conversation C --content <文本> --select conversation`
   选择来源并发送；返回 `commandId/messageId/receiptStatus`，冻结原文可随后查看。
5. `sources --message <contextMessage>`：返回 `bundleDigest/scope/sources`；
   加 `--include-content` 才显示原文。重开实例后仍返回同一原始来源。
6. `draft save|load --file <0600 文件>`：保存本次 preview 选择（含 requestId/expiresAt/
   sourceDigest），`load` 只读回数据，`usable` 仅表示未过期；权限非 0600 或结构不符会被拒绝。
7. `decide ... --message M --content <决定>` 记录明确决定；`decide ... --revoke <id>
   --expected-version N` 撤销。撤销/替代后历史仍可审计，冻结原文不变。
8. `history --work W`、`observe --project P --days 7|30 [--export]`、`status`。

## 语义边界
- unknown/stale/partial 不变成 complete 或授权；preview/draft/decision 都是数据。
- 跨项目、未登记消息、readonly 实例：拒绝（exit 3），不会写业务。
- 模型与 native 自动调用 0；真实厂商/原生未测。
- 未达：main 的 App/UI 集成、多协议、native、CAC、长期 soak。
