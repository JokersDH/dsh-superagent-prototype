# Wave-31 E 双候选验收输入

R1（锁定，不移动）：source `82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2` / build `8296720d8a25f38c` / tar `wave30-target-8296720.tar.gz` / SHA `04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543` / 20481470B / 6849 files / 7405 tar entries / closure197。
R2（新字节）：runtime `303b2c6a`，build checkout `c0a1f897`（仅 D tools/reports）/ build `4dcd28f758bbb265` / tar `wave31-target-4dcd28f.tar.gz` / SHA `405ecd02fcbf288bac0855e17911ec4035521b54fe27d81fa0b28feaf5addcc6` / 20540568B / 6864 files / 7421 tar entries / closure209。

只读复现：
```bash
node tools/distribution/verify-frozen-manifest.mjs --manifest tools/distribution/reports/wave31/R1-manifest.json --tar <R1>
node tools/distribution/verify-frozen-manifest.mjs --manifest tools/distribution/reports/wave31/R2-manifest.json --tar <R2>
```
负例：篡改 SHA/size/build 均 REFUSED，不提取/不启动。

R1: actual 5 modes + review, v1/v2 verified-flow, cold/personal/same/upgrade/backup/noexec/portable, support0600。
R2: installed window+export13/13（2downloads/6exportReads/POST0）、J6/6、F8/8；R1→R2 upgrade7；personal7、backup6、noexec4、portable5；real business relocation4（v1/v2 evidence、bundle、second-root readonly、source facts）；D11 exact parent SIGKILL→child alive→cleanup UNKNOWN retained→child stopped after fresh proof。
边界：E 尚未对 R1/R2 产生 independent verdict；真实 native/vendor=0；private/target/value/cross-machine/48h 未测；D selftest 非 release admission。
