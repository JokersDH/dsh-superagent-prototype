# Wave-30 E 同 tar 验收输入

候选唯一：source `82ee5b8f` / build `8296720d8a25f38c` / schema18 / Node24.21 / ABI137 / darwin-arm64 / tar `pa-artifacts/wave30-target/wave30-target-8296720.tar.gz` / sha256 `04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543` / 20,481,470 B / 6,849 entries / closure197。

D 实测（同一 tar）：
- installed J UI 6/6（acceptedWorks2，preview13），installed J API draft；F 8/8；window static 9/9（7/30，POST0）
- actual modes 5/5：normal personal discussion、restored personal no-review/review、normal fixture、restored fixture；raw restoredFixture 已纠正为 fixture/recovery_readonly
- precise v1/v2：verified-flow，target ok/independent，21 assertions each
- cold4；personal7（backup→readonly）；same-store4；upgrade w29→w30 7；backup6；noexec4；portable5
- 负例：fixture+review `review_requires_restored_personal`；stale review `daemon_start_failed`

边界：normal personal native 未真实起 native；rollback 未声称；真实 vendor/model/native 0；E 独立 required 尚未对该 tar 产生。D 自测非 release admission。
