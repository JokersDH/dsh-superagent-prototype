# Wave-28 D 发行与同事交接

## 固定候选
source `1ba0032` / build `67abd96690030eb7`；tar `pa-artifacts/wave28-target/wave28-target-1ba0032.tar.gz`，sha256 `504dfdc1ceb191828d3836017cc47d9d0023dc27cc1291e6caf28e08aafcfb9e`，20,333,302 B / 6,778 项，closure 109/109。ce64、1cd 和全部旧 tar 保留。

## 可重复检查
```bash
cd /Users/hh/Desktop/joker/superagent-agent-d
node tools/distribution/verify-wave28-release.mjs
node tools/distribution/reports/wave28/../../verify-startup-mode-argv.mjs
```
release check 只读校验 tuple、tar/sha、closure hash、recipe 与 J 缺失记录，不 build/install/start/signal。

## 本轮实测
- 四类启动：normal discussion、restored 无 review、restored 有 review、fixture；均 health/record/argv 一致，均 STOPPED 且 recordRemoved。
- 安装包 F App 8/8；readiness 200 `trial-readiness/1` auth none；personal7、same-store4、multi8、matrix19、noexec4、samebase3、upgrade7、data5、backup6、portable5。
- 精确 restore：FTS 外来行 / event_log 外来行 / artifact 字节篡改均 blocked；baseline `ok/independent`。
- 已安装包 C driver：v1 与 v2 均 `verified-flow`（target proof ok/independent、sources verified、history1、21 assertions、verified stop）；v1 target-only 消息 drift `target_subject_mismatch` 且不回正文。

## 未达/限制
- J recipes 不在当前 main/包；不能宣称已组合。
- E 对 `1ba0032/67abd96690030eb7` 的 independent required 未产生；本目录 E recipe 只交输入。
- C 已安装 driver 需显式 `--target-source-root` 原始 `/var/folders` 与 `--target-artifacts`，否则会因 `/private` 规范化出现 source-root mismatch；这是驱动参数边界，不是内容通过。
- B/private/target/真实供应商未测；vendor/model/native 真实调用 0。
- 十二用户服务 5180/8796–5191/8807、历史 state/profile/tar/ledger 全部保留。
