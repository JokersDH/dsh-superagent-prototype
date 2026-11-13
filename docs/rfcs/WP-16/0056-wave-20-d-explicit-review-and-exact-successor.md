# WP-16/0056：第二十轮 D 显式 personal 只读入口与准确后继包

日期 2026-11-13；基线 `35925dd`，合并 main `e5d89bb`（含 773b34d）。仅动 launcher/distribution；真实 vendor/model/native 0；十二服务未动。

- 稳定 ee 输入（E 先验）：`ee7fbd8`/build`90e81429079a7d50`/sha`b0990149…`/20236793B/6742；它早于773，不具备 review 绑定入口，不重贴。b911 为已准入 ordinary personal 安全基线；97 仅 mock。
- launcher 显式接线：`pa start --discussion-only --review-restored-scope <0600 regular file>` 仅在 restored personal 只读启动时把参数透明传给 main demo；不自动扫描/加载旧 file，不解析授予权，不接受 fixture/normal 借用。启动前校验当前 uid、0600、非符号链接、regular；缺失/宽权限/符号链接/篡改明确拒绝。
- 实际 HTTP：未绑定 403；main `prepareRestoredReview` 配置（protocol restored-personal-review/1，300000ms 窗口）后候选2×200、history/source 200、业务422、模型/native0；负例 fixture/缺失/0644/符号链接/篡改全部拒绝。
- 格式：真实 B normal 数据上实际调用 workflow-evidence 默认/1、显式2（13/21 families，非法3 拒绝），portability create/verify 得到 personal-evidence formatVersion2；两协议分层。
- 真实业务：B normal Work/Broker/Q&A/native_applied 数据 backup→第二 root readonly→source facts 通过；SDK candidate/review personal 是分开 scope，未伪称同 Store。
- 冻结：build `637ed44e850f447a`、source `e4e0623` clean、schema18、tar sha `1f78e38b…dfc1`、20,237,580 B、6,743 files。ee/b911/651/97 原样保留。
- 冻结复跑：nonempty12、real4、matrix19/19、multi8/8、cross3/3、data5/5、personal7/7、noexec4/4、source5/5、b911→new3/3、backup6/6、portable5+1NT、dual6/6、material8/8、smoke52/52、launcher60/60、portability52/52。
- 限制：A v2、历史 Work actor 授权、同 Store 合并、private activation/target、跨平台/ABI、真实计费、逐步 SIGKILL。E 配方 `tools/distribution/recipes/wave20-e-acceptance.zh-CN.md`；状态 `tools/distribution/reports/wave20-status.json`。
