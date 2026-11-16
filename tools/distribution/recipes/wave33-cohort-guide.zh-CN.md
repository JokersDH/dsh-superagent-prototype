# Wave-33 准确 cohort：普通生命周期、非空迁移与升级回退

## cohort
- runtime source `fc38bf65`；build checkout/source `048f0184606202b0b39e7426b7747f3fe57541c1`
- inner build `f880e5bc9c6c1c57`；tar `pa-artifacts/wave33-target/wave33-target-f880e5b.tar.gz`
- inner SHA256 `ee45c92c7c5a8f2caa0449572b14bf97175b0392f1fd92c6f89d7a19464604e8`；20,547,728 B；6,867 项（7,424 tar entries）
- outer ZIP `pa-artifacts/wave33-preview-f880e5b/PersonalAgent-Preview-f880e5b.zip`
- outer SHA256 `46e01c8c7b79818d19e019f6d2208ad54c5c9538674218f85455434eff8207f9`；63,481,603 B；7,435 archive entries
- 唯一 source closure：192 唯一路径（分组原始 204，有跨组重叠，canonical 已去重）；旧 209 是陈旧计数，不是缺文件
- macOS Apple Silicon / Node24.21.0 / ABI137 / schema18 / SQLite3.53.4；未签名、未公证

## 普通生命周期（外圏实际）
独立 `HOME` 解压后：
```
HOME=/tmp/w33-home-run ./Start.command --discussion-only --port 58500 --api-port 58501
HOME=/tmp/w33-home-run ./runtime/bin/node personal-preview-launcher.mjs status
HOME=/tmp/w33-home-run ./Stop.command
```
实测：首次 RUNNING，health personal/local-development；第二次同 tuple Start 复用同一 PID 13026，无第二实例；Stop 后 STOPPED/recordRemoved；再次启动新 PID14468 后正常停止。config/data/cache/logs/workspaces 均为 0700；已有私有 model.json 0600 可作为“已配置”启动，仅对话模式不发送模型。`status` 在 STOPPED 返回 2 是原 CLI 状态码。
负向：config 改 0755 时启动/读取拒绝并保留 state；错误 outer build 命中 exit1。

## 非空业务与搬根只读
当前 W33 controlled Product/Application（真实原 Work 流程，零 vendor/model/native）生成：
- Work `e9c9a0de8048124ad16d7a04bd979024`
- accepted event seq49；backup eventSeq51；contract 1；completion acceptance 1；4 个 artifact（1143/187/24/380 B，id=sha256）
- bundle SHA `be40f037fe85e1328e07183bef014a40b1ae9c1af11d3a41f4b3b09396d48d21`；38,939 B；artifacts20
命令（同 W33 包）：
```
pa backup --json --out <private>/backup.tar
pa verify-backup --json --bundle <backup.tar>
pa restore --json --bundle <backup.tar> --to <new-private-root>
```
restore 后不启动也由 W33 ProductStore 读取同一 Work/合同/接受/4 artifact 字节；实际恢复实例以 `recovery_readonly` 启动，`/v1/health` 显示 recovery_readonly，未审阅候选读取返回 403，随后原 `pa stop` 正常 STOPPED。目标父目录必须是私有真实目录；不能覆盖活跃 state。
负向：同长度改一个 artifact 字节 exit1；删除 artifact exit1；非私有父目录 restore 早拒。

## 升级/回退（同 schema，非空数据）
- baseline W32 `88eb8c69b0671171`；目标 W33 `f880e5bc9c6c1c57`；`pa upgrade` 状态 CONFIRMED，pre-backup evidence digest 与原非空一致，health ok。
- 升级后读取同一 Work、contract1、acceptance1、4 artifact 字节。
- `pa rollback-install` 返回 BINARY_ROLLED_BACK，pointer 回 `88eb8c69...`，数据未回滚；W32 installed ProductStore 读取同一 Work/artifact 字节。
- 没有用旧快照覆盖新写入；本 cohort 不声称生产 schema migration。
- 升级命令在无运行实例时需显式 `--mode personal --access local-development`，backup 父目录必须私有。

## 支持/限制
`support-bundle` PASS，0600、新路径、拒绝已有输出。未达：E 独立 W33 verdict、显式 allowed-model 切换、跨机、签名/公证、长期/native/private/target/value；真实 vendor/model/native=0。
