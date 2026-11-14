# Wave-27 E 验收输入

稳定后继：source `1cdab25` / build `ecffaa6d3f784426` / schema18 / Node24.21 / ABI137 / darwin-arm64；tar `pa-artifacts/wave27-target/wave27-target-1cdab25.tar.gz`，sha256 `dcfda014ce0ac04ff4a78ebcf27cea9c3659e12bc3156583c985b869401fa86e`，20,283,738 B / 6,759 entries，closure `96/96`。
历史基线 ce64/build `d4b1780d999a4b74`/tar `8c36aae…` 保留，不与后继混淆。

必跑：本目录 `installed-trial-workbench.json`（8/8）、`readiness.json`、`personal.json`、`same-store.json`、`matrix/multi/noexec/samebase/upgrade-artifact/data/backup/portable`。
精确内容：`content-exception-controls.json` 与四个 mutation 文件。已确认 artifact bytes/missing 拒绝；FTS 外来行与 event_log 外来行仍被接受（A/C 例外未精确化），E 不得将本包精确内容证明视为通过。
双格式：`v1-verified-flow.json`、`v2-explicit-format.json`；`v2-default-format.json` 记录 C 默认标签仍为 v1 与实际 report workflow-snapshot/2 不符。

未达：A/C FTS/event 精确允许清单、C 默认 v2 元数据、E independent required、B/private/target、真实供应商。
