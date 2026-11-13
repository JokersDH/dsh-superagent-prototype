# WP-16/0058：第二十一轮 D 生效选择复用与同包准备

日期 2026-11-13；基线 `2350af2`，合并 main `5d0c623`（含 f856fa5）。仅动 launcher/distribution；真实 vendor/model/native 0；十二服务未动。

- 复用门：`pa start` 在已有实例分支、任何 port/access 判定之前，用 main 已验证的同一 parsed-file 摘要与 actual `/v1/health.restoredReviewDigest` 比较。unbound/different/narrow/no-file 全部 `restored_review_selection_mismatch`，不改/不 stop 旧 PID；same valid selection `REUSED`，不重签窗口；same selection 变 port/login 仍 `instance_conflict`。record 不能替代 actual health；health 不可得即拒绝。
- 新启动校验：health 必须 personal+recovery_readonly 且摘要等于请求摘要，否则停止本进程并拒绝。
- 同包准备：launcher 新增 `pa review-restored`，直接调用安装包内 main `prepareRestoredReview`/localCredentials 写新 0600 文件；不依赖源码 checkout，不新增签发权威，不覆盖既有文件。prepare 与 start consumer 均来自本冻包。
- 实际行为：未绑定候选403；review 后候选2×200、history/source200、业务422、model/native0；unbound/same/different/no-file/port 矩阵保留 PID；B 真实 Work/Broker/Q&A/native_applied 搬根/source 通过，SDK candidate 为独立 scope（未伪称同 Store）。
- 格式：workflow-evidence默认/1 13 families、显式2 21 families；personal-evidence formatVersion2 + bundle formatVersion1 独立协议。
- 冻结：source `595b3f1` clean、build `cc16eca05e4da244`、schema18、tar sha `e875b9b9…026d`、20,242,124 B、6,744 files。e4e/ee/b911/651/97 保留。
- 冻结复跑：nonempty12、real4、matrix19/19、multi8/8、cross3/3、data5/5、personal7/7、noexec4/4、source5/5、ee→new3/3、backup6/6、portable5+1NT、dual6/6、material8/8、smoke52/52、launcher60/60、portability52/52。
- 限制：同 Store 合并、A v2、private startup permission/target、跨平台/ABI、真实计费、逐步 SIGKILL。E 配方 `tools/distribution/recipes/wave21-e-acceptance.zh-CN.md`；状态 `tools/distribution/reports/wave21-status.json`。
