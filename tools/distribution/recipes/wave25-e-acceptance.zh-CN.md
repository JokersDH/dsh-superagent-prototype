# Wave-25 E 验收输入

冻结 source `a826b5e` / build `fefd93219cea0d4a` / tar `d3e79749426c796085895abc73d76c4b26cd48427d8e6f748155bec00a103f3c` / 20,251,483 B / 6,754 files / schema18 / Node24.21 / ABI137 / darwin-arm64。main 含 `fdb3f16` readiness 与 `4b42a90` UI；F trial 未合入本分支。

必跑：controls（14）、same-store、nonempty、real、dual-snapshot-c、installed-ui、help、readiness、personal、matrix、multi、cross、data、backup、portable。证据在 `tools/distribution/reports/wave25/`。

限制：C 未直接消费 A manifest 对象；F 试用包未合入；E 独立 verdict 未产生；私有 permission/target、真实供应商/计费、跨平台未测；vendor/native 0。
