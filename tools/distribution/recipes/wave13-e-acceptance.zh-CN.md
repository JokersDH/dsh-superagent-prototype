# 第十三轮 E 独立验收：可证明归属与当前 main 个人安装

E 在自己的 root 独立执行；仅证明安装/托管命令/只读材料，不构成恢复激活、真实模型计费或原生通过。

## 1. 冻结 tuple（以 `tools/distribution/reports/wave13/artifacts.json` 为准）

| 角色 | tar | sha256 | source | buildId | schema |
| --- | --- | --- | --- | --- | --- |
| target（current） | `pa-artifacts/wave13-target/wave13-target-99832f6.tar.gz` | `b7e9dec7d264f94cadda10c6624db582ddd477ff83a7a8816c6acf5f0c5237d4` | `99832f6`（clean） | `3ead6a26161f4c72` | 18 |
| legacy16 | `pa-artifacts/wave11-target/wave11-target-a22d3a4.tar.gz` | `a10f6274…` | `a22d3a4` | `3311a04bd20ed7f9` | 16 |
| baseline | wave06 `…7e8f6ce6.tar.gz` | `0fe0ed53…` | `e10bfdb7…` | `7e8f6ce6fa2e2633` | 13 |
| 同schema双binary（历史） | wave07/wave08 | 见 artifacts | `76f26a66…`/`9b75c2a1…` | `9120a5ed…`/`cd0ecc29…` | 13 |

target tar 20,167,862 B、6,713 files / 67,256,832 B；能力含 context history、frozen sources、A18 replyResults、selected-context send、非空 backup/restore、16→18 升级。`020af82` 保留原标签，不称 current full。

## 2. 命令

```sh
# 归属：6 mock + 1 自有 legacy（无真实 OS 扫描/信号）
PA_ADMISSION_REPORT=/tmp/<role>-mock.json node --experimental-test-module-mocks \
  tools/bootstrap/probe-wave13-delivery.mjs <D> <unpacked-target>
PA_ADMISSION_REPORT=/tmp/<role>-legacy.json node tools/bootstrap/probe-wave13-delivery-legacy.mjs <D>

node tools/distribution/verify-multi-instance.mjs --install <target> --json
node tools/distribution/smoke-binary-upgrade.mjs --baseline <wave06> --target <target>
node tools/distribution/verify-cross-schema-upgrade.mjs --from <legacy16> --to <target> --json
node tools/distribution/verify-schema18-data.mjs --install <target> --legacy-install <legacy16> --json
node tools/distribution/verify-backup-schema16.mjs --install <target> --json
node tools/distribution/verify-portable-closure.mjs --install <target> --json
node tools/distribution/verify-personal-install.mjs --install <target> --json
node tools/distribution/verify-dual-binary.mjs --json
node tools/distribution/verify-target-material.mjs --trusted-parent <0700 private> --json
```

## 3. 预期

- probe 6/6 + legacy PASS；matrix 19/19；multi 8/8；cross 3/3；data 5/5（含 main history/source 读取与搬根保持）；backup 6/6；portable 5+1 NOT_TESTED；personal 7/7；dual 6/6；material PASS；smoke 52/52。
- 归属：缺 start/UID/复用/扫描失败/部分 manifest 一律 UNKNOWN 且 proven=false，不发信号；legacy record 只有自身 argv 精确命名 config/data/install 才接受；复制 record/错 config/错 install/错 data 均拒绝；recover 只有 journal old/new 角色可确认，第三角色确认拒绝。
- 数据：A18 完成回复/context binding/history/frozen sources 在 Store 重开与搬根后保持；损坏/未来 schema 精确拒绝；16→18 由 A 公开入口迁移。
- 禁止：pkill、共享路径认领、删 marker/record、手改 release、自写 SQL/授权、旧 tar 重标 current。

## 4. 清理

只停止命令行/记录可证明属于本次临时 root 的进程；十组用户服务 5180/8796–5189/8805 及其 state 不动。
