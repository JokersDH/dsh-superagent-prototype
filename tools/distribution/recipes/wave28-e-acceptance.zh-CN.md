# Wave-28 E 验收输入

稳定后继：source `1ba0032` / build `67abd96690030eb7` / schema18 / Node24.21 / ABI137 / darwin-arm64；tar `pa-artifacts/wave28-target/wave28-target-1ba0032.tar.gz`，sha256 `504dfdc1ceb191828d3836017cc47d9d0023dc27cc1291e6caf28e08aafcfb9e`，20,333,302 B / 6,778 entries，closure `109/109`。
ce64 `d4b1780d999a4b74` 与 1cd `ecffaa6d3f784426` 保留。

必跑：本目录 `startup-mode-consistency.json`（四类实际启动：normal discussion personal/normal、restored no review personal/recovery、restored with review personal/recovery、fixture/normal；每类 STOPPED 且 record removed）、`installed-trial-workbench.json`（8/8）、`readiness.json`、`personal.json`、`same-store.json`、`multi/matrix/noexec/samebase/upgrade-artifact/data/backup/portable`。
统计：安装包实际含 `packages/usage-insights` 且 coordinator 有 usage-insights API 路由；J recipes 不在本包。
未达：J 配方组合、A/C 精确 FTS/event 例外（继承 wave27 缺口）、E independent verdict、B/private/target、真实供应商。
