# Wave-36 E 交接（W33/W35/W36 分 subject）
## W33（E 已测 subset，先锁）
source `048f0184`, build `f880e5bc9c6c1c57`, inner `ee45c92c…64604e8`/20547728, outer `46e01c8c…8207f9`/63481603。旧两个 Work/8 artifact、W33 rollback exit0 与 W33 升级成功保留。
## W35（模型 GUI/launcher 后继）
source `edfe5e14f2f8fbc7f395a84520c781c7f07ce9e7`, build `599de3e98c02de0b`, inner `11027a37…50db`/20598155, outer `39c0fff0…f6c5`/63536701。Actual/static 已由 main 双 wrapper allowlist 验为 VERIFIED_STATIC（3,39bd wrapper）；E 仍无独立 W35 verdict。
原始 W35 upgrade 回执 `reports/wave36/w35-upgrade-raw-blocked.json` 是 **BLOCKED unknown_live_resource**；干净 retry `reports/wave36/w35-upgrade-retry.json` 是 **CONFIRMED**，随后 W35 读回两 Work，stop0。不得用 retry 抹掉 raw，也不得用 W33 成功代替 W35 raw。
## W36（必要 history consumer 后继）
source `087a598e5b6f357bd2cc40556cbf693257febc66`, build `14a6b457ea285988`, inner `13798190…a8af`/20625055, outer `43e06d5b…8995`/63565262。main verifier `VERIFIED_STATIC` 7,457 ZIP/6,889 inner；actual Start/status/stop0。source closure 199 selected audit（192+ModelConnection/CompletionHistory 7 files），不是全 runtime inventory。
## 边界
W35 installed UI 模型保存 1/0/0、private0600；alpha/beta 两 Work 各4 artifact 是两项目 ID/root，但同 fixture profile/check、两次单项目 runtime，不是默认双项目 dispatch。history source 尚未在实际 App 中独立 E 验收。跨机/签名/native/value 未测；真实 vendor/model/native 0。

## 固定 W36 E 复核（D 已交）
- source `087a598e5b6f357bd2cc40556cbf693257febc66`, build `14a6b457ea285988`
- inner `/Users/hh/Desktop/joker/pa-artifacts/wave36-target/wave36-target-14a6b45.tar.gz`, 20,625,055 B, `13798190ae43b28628eaf7131dfb8192bdb786b9bcfe4e1e0b6f9217ab33a8af`
- outer `/Users/hh/Desktop/joker/pa-artifacts/wave36-preview-14a6b45/PersonalAgent-Preview-14a6b45.zip`, 63,565,262 B, `43e06d5bc7606e8283c1c5f58463f402018d4c9c9b223a2c7c021d429ccb8995`
- D 已从 git087 重算并改正 5 条 selected source audit：App.tsx `1d6853b15abac1d2d069a8a863986e16796b5e8e924e4d7043030aa988fb0e5c`、evidence.css `4711d555f0ab5607b3a76ea7c6e9f9edd0e00099a99a8f39be545ccd5205604f`、transport.ts `67a0fdd73381ff8c1d442bb5f89dcdbf74fa4d5ebd9618d67c7a27ab7e1b6ed8`、coordinator/http/app.ts `9fb983f770a64494b5f01646e6a55cd39bfa470bb00550fb5e4677035a6ddb29`、coordinator/product/runtime.ts `1e890955f249d54560ec78976b7cc6e37c8858383fc3a035f9e8120afcf31629`；199/199 全记录对 git087 匹配，旧报告 `source-closure-pre-correction.json` 保留。未改动或重冻 archive。
- E 可复现：以恢复的 W33 非空 state 启动 W36 `--discussion-only --review-restored-scope <private review>`，在安装 App 点选 `Produce wave33 nonempty artifact` → 工作卡 `已交付` → `展开工作历史`，实际显示 `工作历史 / 检查记录 / 标准验收 / 合同版本`，本类来源 1 条、第3代检查记录；`reports/wave36/app-history-click.json` 与 `app-history.png`。API `GET /v1/works/<id>/completion-history?kind=verifications&limit=10` 亦 200。
- 当前包启停：start/status/stop 均 0；导入 W35 恢复 state 无迁移、无新 schema。W35 原 upgrade raw BLOCKED 与 clean retry CONFIRMED 两文件均在 `reports/wave36/`，不互相替代。
- 未测/未准入：实际 native crash recovery、原 Work Broker 2/4 槽、跨机、签名/公证、value。E 独立 verdict 是剩余项，不由 D 自授。
