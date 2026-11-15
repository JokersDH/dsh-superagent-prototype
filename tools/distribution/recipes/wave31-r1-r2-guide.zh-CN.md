# Wave-31 R1/R2 双候选使用与复现

R1（锁定，不因R2失效）：source `82ee5b8f` / build `8296720d8a25f38c` / tar `wave30-target-8296720.tar.gz` / sha256 `04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543` / 6849 files（7405 tar entries）/ closure197。E 当前 1fba subject 的独立 verdict 仍待新 R1。
R2（本轮新候选）：source runtime `303b2c6a`，D build checkout `c0a1f897`（仅D工具/报告差异）/ build `4dcd28f758bbb265` / tar `wave31-target-4dcd28f.tar.gz` / sha256 `405ecd02fcbf288bac0855e17911ec4035521b54fe27d81fa0b28feaf5addcc6` / 6864 files（7421 tar entries）/ closure209 / schema18 / Node24.21 / ABI137。

只读校验：
```bash
node tools/distribution/verify-frozen-manifest.mjs --manifest tools/distribution/reports/wave31/R1-manifest.json --tar /path/wave30-target-8296720.tar.gz
node tools/distribution/verify-frozen-manifest.mjs --manifest tools/distribution/reports/wave31/R2-manifest.json --tar /path/wave31-target-4dcd28f.tar.gz
```
负例：篡改 manifest SHA/size/build 会 REFUSED，不提取、不启动。

同事普通流程、平台/Node/ABI、backup→readonly、support 0600 见 `wave30-install-guide.zh-CN.md`；R2 用同一命令替换 APP/tar 即可。R2 新增已验 UI：7/30 窗口+导出下载13/13（2 downloads/6 export reads/POST0）、J6/6、F8/8，均为冻结包 static/runtime。

R1→R2：`verify-upgrade-artifact.mjs` 7/7；R2 personal7（backup→readonly）、backup6、noexec4、portable5。R1/R2 数据不互认，旧用户 state/profile/tar 保留。

未达：E 新 R1/R2 独立 required；真实 native/vendor、private/target/value、跨机、48h、rollback 未测。工具自测不是 release admission。
