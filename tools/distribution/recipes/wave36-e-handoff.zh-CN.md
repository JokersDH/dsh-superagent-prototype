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
