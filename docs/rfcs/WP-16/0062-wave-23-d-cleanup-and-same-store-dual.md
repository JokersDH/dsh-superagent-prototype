# WP-16/0062：第二十三轮 D 安全清理、同 Store 双版本与普通发行

日期 2026-11-13；基线 `ab16943`，合并 main `03f7b7e`（含 8c8fdef）。仅动 launcher/portability/distribution；真实 vendor/model/native 0；十二服务未动。

- 清理：新增 `live-cleanup`，按出生 PID/start/UID/argv/install/config/data/operation 验证；launcher 要求 install/config/data/start，API/console 子资源要求精确父 PID、start、UID、install/state。CLI stop 失败时仅对这些已证明 PID 直接信号；任何缺失/不符/停止未确认 → UNKNOWN 并保留私有材料。same-store、nonempty、real 的 finally 不再先删根。
- 故障窗口：same-store 在 seed 启动、review 启动、候选读取、断言处有界注入；nonempty/real 有启动后注入。4 个 same-store 故障均 FAIL + CLEAN，controls 6/6 覆盖 positive/foreign root/start mismatch/missing/cleanup failure/repeated finally。
- 帮助：`pa --help`、`pa help review-restored`、`pa review-restored --help` 均0退出，列出 prepare/start/reopen 与重复 `--project`；不创建 state/config/进程。
- 同 Store：复制 retained B state（原目录只读），真实 Work/question/answer/attempt/native_applied + 受控 SDK context/candidates；双版本 `workflow-snapshot/1|2` create/verify，bundle restore 后 DB sha 等于两快照 DB sha；原 IDs/digests/attempt 全保留；review candidates2/history/source200/business422/fake请求不增；`scopeReview=1` 实际返回 context-scope-review/1。
- 完整 source closure：`tools/distribution/reports/wave23/ordinary-source-closure.json`，launcher40/portability23/distribution9/root5，含环境24.21/ABI137/SQLite3.53.4/18 与 build/stage/freeze 依赖。
- 冻结：source `0ede11d` clean、build `1eb8733c8b1729bc`、schema18、tar sha `d0398897…bf21`、20,247,278 B、6,747 files。595/a9b/e4e/ee/b911/651/97 保留。
- 冻结复跑：same3、controls6、nonempty12、real4、matrix19/19、multi8/8、cross3/3、data5/5、personal7/7、noexec4/4、source5/5、ee→new3/3、backup6/6、portable5+1NT、dual6/6、material8/8、smoke52/52、help1、launcher60/60、portability52/52。首次 smoke 在旧残留探针并发下超时失败；清理旧探针后独立重跑52/52，旧失败保留。
- 限制：A/C 独立 driver 未入包；A v2、private permission/target、真实供应商、跨平台/ABI、逐步 SIGKILL。E 配方 `recipes/wave23-e-acceptance.zh-CN.md`；状态 `reports/wave23-status.json`。
