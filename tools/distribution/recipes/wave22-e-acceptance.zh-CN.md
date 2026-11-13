# 第二十二轮 E 独立验收：595 准确输入与同 Store 普通发行

E 独立执行；不构成私有启动许可、target/native/真实模型证明。

## 1) 先验准确 595（不可变输入，不重贴旧 e4e）

| 项 | 值 |
| --- | --- |
| source | `595b3f1` clean |
| buildId | `cc16eca05e4da244` |
| tar | `pa-artifacts/wave21-target/wave21-target-595b3f1.tar.gz` |
| sha256 | `e875b9b90445db5826bf01d72d710fd55b208309598347ca45be618773ae026d` |
| bytes/files | 20,242,124 B / 6,744 |

包内 prepare/start、same valid selection **REUSED 是成功终态**；different/no-file/port/login 必须拒绝且保留 PID。旧 e4e 的 installed FAIL 不得贴到 595。

## 2) 本轮后继（同 Store + main712 可选诊断实际装入）

| 项 | 值 |
| --- | --- |
| source | `a9b155c` clean |
| buildId | `9fdc283f55927f6f` |
| tar | `pa-artifacts/wave22-target/wave22-target-a9b155c.tar.gz` |
| sha256 | `413dee2fb2692334a519899fc9298fd0771b5c865a34a595d1efc3b4b3b1d650` |
| bytes/files | 20,246,850 B / 6,747 |
| schema/ABI | 18 / darwin-arm64 |

```sh
node tools/distribution/verify-same-store-dual-personal.mjs --install <target> --business <retained-B-state> --json # 3/3
node tools/distribution/verify-nonempty-personal-http.mjs --install <target> --json                      # 12 步
node tools/distribution/verify-real-business-relocation.mjs --install <target> --business <B-state> --json # 4/4
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>                  # 19/19
node tools/distribution/verify-multi-instance.mjs --install <target> --json                             # 8/8
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json          # 3/3
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json  # 5/5
node tools/distribution/verify-personal-install.mjs --install <target> --json                           # 7/7
node tools/distribution/verify-personal-no-executor.mjs --install <target> --json                       # 4/4
node tools/distribution/verify-source-confirmation-http.mjs --install <target> --json                   # 5/5
node tools/distribution/verify-same-schema18-upgrade.mjs --from <ee> --to <target> --json              # 3/3
node tools/distribution/verify-backup-schema16.mjs --install <target> --json                            # 6/6
node tools/distribution/verify-portable-closure.mjs --install <target> --json                           # 5+1 NT
node tools/distribution/verify-dual-binary.mjs --json                                                  # 6/6
node tools/distribution/verify-target-material.mjs --trusted-parent <0700> --json                      # 8/8
node tools/distribution/smoke.mjs --keep-root <new>                                                    # 52/52
```

## 3) 同 Store 断言

B real normal Store 先复制再追加受控 SDK context send（fake 本地 endpoint，vendor/native0）：同 Store 同时有真实 Work/Broker/Q&A/native_applied 与 2 个 candidate；backup→第二 root→explicit review：Work≥1、候选2、source/history200、业务422、old queue held、fake 请求不增；v1=13 families、v2=21 families；实际安装含 main712，`?scopeReview=1` 返回 `context-scope-review/1`（理由0/withheld null），默认接口不变。若未观察到可选诊断则 NOT_TESTED，不借后到 API 认证旧字节。

## 4) 完整依赖交接

`tools/distribution/reports/wave22/ordinary-source-closure.json`：launcher bin/lib/test/package 40 文件、portability src/test/package/tsconfig 23 文件、distribution build/stage/freeze+3 recipes 7 文件、根配置5文件，全部 sha256/bytes；根配置要求、installClosure、runtimeDependencies 与边界。不得只拷 upgrade.mjs 或整包历史报告。

## 5) 限制

A v2、private startup permission/target、真实 vendor/model/native、跨平台/ABI、逐步 SIGKILL 未测；同 Store 追加的是受控 SDK 数据，不冒充外部真实供应商；97 不 live；十二服务不动。
