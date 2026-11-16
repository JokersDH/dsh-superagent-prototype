# Wave-34 E 交接：先锁 W33 `f880/46e`

## 固定 cohort（不变）
- source/build checkout `048f0184606202b0b39e7426b7747f3fe57541c1`；runtime `fc38bf65`
- inner build `f880e5bc9c6c1c57`；tar `pa-artifacts/wave33-target/wave33-target-f880e5b.tar.gz`
- inner SHA256 `ee45c92c7c5a8f2caa0449572b14bf97175b0392f1fd92c6f89d7a19464604e8`；20,547,728 B；6,867 清单项；7,424 tar entries
- outer ZIP `pa-artifacts/wave33-preview-f880e5b/PersonalAgent-Preview-f880e5b.zip`
- outer SHA256 `46e01c8c7b79818d19e019f6d2208ad54c5c9538674218f85455434eff8207f9`；63,481,603 B；7,435 archive entries
- canonical source closure 192 unique（grouped 204 去重；W32 197/192 与旧 209 只是历史，不用于本 cohort）
- schema18 / Node24.21.0 / ABI137 / darwin-arm64 / SQLite3.53.4；未签名/未公证

复核：
```
node tools/distribution/verify-frozen-manifest.mjs --manifest tools/distribution/reports/wave33/manifest.json --tar <W33.tar.gz>
node tools/bootstrap/verify-personal-preview.mjs --zip <W33.zip> \
  --expect-source 048f0184606202b0b39e7426b7747f3fe57541c1 \
  --expect-build-id f880e5bc9c6c1c57 \
  --expect-zip-sha256 46e01c8c7b79818d19e019f6d2208ad54c5c9538674218f85455434eff8207f9
```
外圏错误 build/SHA 及 cross-artifact 已独立 exit1。

## 真实业务 recipe
原 Work `e9c9a0de8048124ad16d7a04bd979024`（accepted49，4 artifact bytes），以及重复使用新增 Work `76a82043b8c7e1495e27748f4381e5d1`（accepted101，4 artifact bytes）；第二次 bundle eventSeq103、projects1、defects0、artifacts36、acceptedEvents2。第二个 bundle SHA `c98f946738f41d62b346025162efa4feb33cc0ad2cab53b6d721bd118b490c68`，restore 后由两 Work reader 逐项核对 contract/acceptance/artifact bytes。
两份 recipe 与 reader：`reports/wave34/second-work.json`、`tools/distribution/verify-wave34-two-works.mjs`。原始 W33 首份 Work 仍为 `reports/wave33/nonempty-recipe.json`。

## 重要纠正
- 第一次 raw rollback 的真实回执是 `reports/wave33/rollback.json`：**BLOCKED unknown_live_resource**。
- 干净 parent retry 的原回执 `reports/wave33/rollback-retry.json`：exit0、BINARY_ROLLED_BACK、pointer `88eb8c69...`、dataRolledBack false；retry 不覆盖 raw。
- 第二次 W32→W33 upgrade CONFIRMED 后新增 Work 仍在；binary rollback 后 W32 installed ProductStore 读回两个 Work 与8个 artifact 引用。没有用旧 snapshot 覆盖新写入，也没有生产 schema migration。

## 未达
- E 对 W33 outer/new inner 的 independent required 仍待；旧 E306/20NT 是 R1+W32 aggregate，不能贴 W33。
- public review 文件已生成、health 显示 review digest，但本次 candidate source 仍 403（不是 ordinary configured user message）；无授权的 403 已证，授权后 200 未证。业务写入422未测。
- main `23d5a98e` callbacks/support 是 W33 之后的新 runtime；如需要 successor 必须另 freeze/subject，不能移动本 W33 或重贴本 handoff。
- 跨机/签名/公证/长时/native/private/target/value 未测；真实 vendor/model/native 0。
