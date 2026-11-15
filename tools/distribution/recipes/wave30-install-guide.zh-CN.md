# Wave-30 同事独立目录安装与支持

适用：darwin/arm64、Node 24.21.x、ABI 137、SQLite 3.53.4。候选 tar：`wave30-target-8296720.tar.gz`，sha256 `04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543`，build `8296720d8a25f38c`，source `82ee5b8f`，6,849 项。

## 1. 解包与私有根
```bash
mkdir -p /tmp/pa-new && tar -xzf wave30-target-8296720.tar.gz -C /tmp/pa-new
APP=/tmp/pa-new/install/app; R=$HOME/.personal-agent-wave30
mkdir -p "$R"/{config,state,cache,logs,ws}; chmod 700 "$R" "$R"/*
node "$APP/apps/launcher/bin/pa.mjs" first-run --json --install "$APP" \
  --config-root "$R/config" --data-root "$R/state" --cache-root "$R/cache" \
  --logs-root "$R/logs" --workspace-root "$R/ws"
node "$APP/apps/launcher/bin/pa.mjs" doctor --json --install "$APP" \
  --config-root "$R/config" --data-root "$R/state" --cache-root "$R/cache" \
  --logs-root "$R/logs" --workspace-root "$R/ws"
```

## 2. 普通使用
```bash
node "$APP/apps/launcher/bin/pa.mjs" start --json --install "$APP" \
  --config-root "$R/config" --data-root "$R/state" --cache-root "$R/cache" \
  --logs-root "$R/logs" --workspace-root "$R/ws" --discussion-only
```
浏览器打开返回的 console 地址。能用的普通范围：主对话/草稿、导入项目、任务模板 preview→apply→明确创建、检查候选/人工 accept、7/30 天观察窗口、来源审阅、只读 readiness。执行器缺失时项目不可委托，这是真实限制，不是故障。

停止：
```bash
node "$APP/apps/launcher/bin/pa.mjs" stop --json --install "$APP" \
  --config-root "$R/config" --data-root "$R/state" --cache-root "$R/cache" \
  --logs-root "$R/logs" --workspace-root "$R/ws"
```

## 3. 备份/恢复只读
```bash
node "$APP/apps/launcher/bin/pa.mjs" backup --json --install "$APP" ... --output "$HOME/pa-backup.tar"
mkdir -p "$HOME/pa-restored"; chmod 700 "$HOME/pa-restored"
node "$APP/apps/launcher/bin/pa.mjs" restore --json --install "$APP" ... --from "$HOME/pa-backup.tar" --data-root "$HOME/pa-restored"
```
恢复根是只读历史；不继承 native 认证、旧 session、grant 或队列执行权。

## 4. 可复现验证（作者侧）
```bash
node tools/distribution/verify-startup-mode-argv.mjs
node tools/distribution/verify-installed-project-recipes-ui.mjs /tmp/w30frozen/install/app /tmp/w30-jui
node tools/distribution/verify-installed-trial-workbench.mjs --install /tmp/w30frozen/install --output /tmp/w30-browser
node tools/distribution/verify-personal-install.mjs --install /tmp/w30frozen/install --json
node tools/distribution/verify-backup-schema16.mjs --install /tmp/w30frozen/install --json
```

## 5. 只读支持
```bash
node tools/distribution/support-bundle.mjs --install /tmp/w30frozen/install --output "$HOME/pa-support-1"
```
输出目录 0700、文件 0600、拒绝覆盖；只含 release 事实，不含 token/model key/credential/native profile/用户 state。它不是停止权或 release 授权。

## 边界
- 0076 窗口 selector 已在当前 source/包 console；source actual 9/9 通过，**同一 installed 静态包交互尚未单独重跑**。
- installed J 6/6、installed F 8/8 使用冻结包 actual static/runtime。
- E 尚未对 `8296720d/82ee5b8f/049267…` 出独立 verdict；D 自测不是 release 准入。
- 未做：真实 vendor/model/native、private/target、跨平台、48h/跨机、真实 native 成本。
