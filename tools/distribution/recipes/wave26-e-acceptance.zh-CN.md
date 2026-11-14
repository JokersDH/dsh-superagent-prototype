# Wave-26 E 验收输入

冻结 source `ce64fc1` / build `d4b1780d999a4b74` / tar `8c36aaeb472263bbb7c6ab5e4dafb3e9394306c83b3b6e1ab257d8770480c33a` / 20,272,436 B / 6,754 files / schema18 / Node24.21 / ABI137 / darwin-arm64。

包内含 main `a302ddc` 的实际 F Trial App（六源 + App 组合）与 `fdb3f16` readiness；G insights / H toolkit 未导入。

必跑：本目录 `installed-trial-workbench.json`（真实安装静态 App + 真实 HTTP/SQLite，8/8：默认对话保留、四项 callback 打开既有目标且不发送、readiness 读一次、失败/404/readonly/fixture、桌面/移动无溢出）、`readiness.json`（GET 200 trial-readiness/1 auth none）、`help.json`、`personal.json`、`same-store.json`、`matrix/multi/cross/data/backup/portable`。

未达：C 未内部逐字段重校 A manifest；A target-content/fingerprint 真实证明未提交，D2 第二结果 NOT_REACHED；E independent required 未执行；G/H 未导入；private/target/真实供应商未测。
