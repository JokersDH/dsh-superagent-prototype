# WP-16/0044：第十五轮 D 完整出生身份与 post-signal UNKNOWN

日期 2026-11-13；基线 `e9f8aff`，合并 main `2ec460c`（含 697efdc runtime recovery inspect/prepare）。仅动 D 原路径；模型/native 0；十一组用户实例未动。

- 真实 `startTarget` 出生即持久化 pid/start/UID/稳定 command/config/data/install/operation，并写入 journal；稳定 command 采集避免 wrapper→node exec 瞬时镜像。
- `accountRegisteredResources` 对 journal/spawn **必填**完整身份（argv/command、uid、config+data、operation，且 caller 必须传 expected operation）；缺失/外 root/错 uid/错 command/错 operation → unverifiable，零信号。record 仍保留 legacy 兼容，但 live API 必须通过 coordinator 验证。
- `stopRegisteredResources` 停止等待使用三态 vitality：SIGTERM 后 `ps stat=` 失败/空不当作 dead，保持 remaining/unverifiable，proven=false；只有确认 dead 才 proven。
- recover 使用 journal operation/角色，缺身份或 post-signal UNKNOWN → BLOCKED，不写 confirmed/pointer。
- 纯 mock probe 4/4：producer-shaped 缺字段、post-signal stat UNKNOWN、recover 缺身份、完整正对照。之后真实矩阵19/19、multi8/8、cross3/3、data5/5、personal7/7、noexec4/4、runtime inspect HTTP3/3、backup6/6、portable5+1NT、dual6/6、material8/8、smoke52/52、launcher60/60、portability52/52。
- 冻结：build `88df6d2eef1feeb7`、source `8962d10` clean、schema18、tar sha `11497980…f54b`、20,190,414 B、6,719 files。旧 114b73c/99832f6 保留历史。
- 未测：跨平台/ABI、真实个人计费 turn、逐步 SIGKILL 全枚举、main activation confirm、E verdict。E 配方 `tools/distribution/recipes/wave15-e-acceptance.zh-CN.md`；状态 `tools/distribution/reports/wave15-status.json`。
