# WP-16/0048：第十六轮 D 资源边界与当前建议版个人交付

日期 2026-11-13；基线 `0b9481c`，合并 main `a9f1234`（含 a64a127/1169535、87d548c）。仅动 D 路径；模型/native 0；十二服务未动。

- 父/子边界：祖先/共享路径不再继承 owned；每个后代独立核对 OS uid，foreign-UID 子进程保持 unknown、0 信号，父 stop 不 proven。完整父身份正对照仍 SIGTERM 父且 proven。
- 全局发现三态：discovered 进程 `ps stat=` UNKNOWN 不再被跳过成 proven empty；actual recover 遇 unknown discovered writer 返回 BLOCKED，journal/pointer/进程不变、0 信号。
- recover CLI：成功终态 NO_OP/RECOVERED/RECOVERED_PREVIOUS/REVERTED/CONFIRMED 统一 exit0；BLOCKED exit2；失败不再以成功 status 配 exit1。
- 当前 main 个人 HTTP：provider status 默认 suggestions off；私有偏好 sidecar 0600 且 legacy model JSON 字节不变；候选路由实际 wired（403 forbidden 非 unsupported）；runtime recovery inspect/prepare 继续真实（commitAvailable=false、normal prepare 422）。
- 冻结：build `8a5a0a85631f22ca`、source `97cace7` clean、schema18、tar sha `6b6517c4…46c3`、20,218,294 B、6,731 files。旧 8962d10/114b73c 原样保留。
- 测试：probe4/4、matrix19/19、multi8/8、cross3/3、data5/5、personal7/7、noexec4/4、recovery HTTP3/3、current HTTP4/4、same18 3/3、backup6/6、portable5+1NT、dual6/6、material8/8、smoke52/52、launcher60/60、portability52/52。
- 限制：非空建议正文/已确认决定 fixture 受限（需真实返回请求或 main/A 决定 API）；activation confirm 未实现。E 配方 `tools/distribution/recipes/wave16-e-acceptance.zh-CN.md`；状态 `tools/distribution/reports/wave16-status.json`。
