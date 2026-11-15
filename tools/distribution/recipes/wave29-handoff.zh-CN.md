# Wave-29 D 交接

候选：source `1fbaf94` / build `2d94a7c31ef97b57` / tar `pa-artifacts/wave29-target/wave29-target-1fbaf94.tar.gz` / sha256 `daee1a94b43156cec659f7df2a3b08e1ecb89b645fde1ea81c35a81d75b47d7a` / 20,458,656 B / 6,849 项 / closure 120/120。

## 复现
```bash
node tools/distribution/verify-startup-mode-argv.mjs
node tools/distribution/verify-installed-project-recipes.mjs /tmp/w29frozen/install/app
node tools/distribution/verify-installed-trial-workbench.mjs --install /tmp/w29frozen/install --output /tmp/w29-browser
```
真包解包：`tar -xzf pa-artifacts/wave29-target/... -C /tmp/w29frozen`。

## 结果
- fixture: restored fixture = fixture/recovery_readonly；normal fixture = fixture/normal + lazy assistant；四类 personal/fixture 实际 STOPPED+recordRemoved。
- J: installed package API 在 controlled fixture + registered root 下 `draft`、authorization none、events0；source actualApp J 6/6；CLI fixture 无根 unavailable / personal registered needs_input。
- F: installed static 8/8，readiness 200。
- A/C: installed package v1/v2 fresh restores 均 verified-flow（target ok/independent、sources verified、history1、21 assertions），v1 drift target_subject_mismatch 不回正文。
- 普通: cold4、noexec4、samebase3、upgrade7、data5、backup6、portable5、matrix19、multi8、personal7、sameStore4。

## 未在 D 内关闭
installed J UI apply/create static 重跑；E independent verdict；B/private/target。真实 vendor/model/native 0；历史资源/服务端口保留。
