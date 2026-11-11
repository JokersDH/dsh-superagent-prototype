# Wave09主线上下文与交付证据

产品source：`32fc7aee99b30b49030208d6bac95e843cc38d9c`，C边界准入 `339ae56`。使用及组合说明见[0032](../../../docs/rfcs/WP-16/0032-context-evidence-product-checkpoint.md)。预览[5187](http://127.0.0.1:5187/)，新私有state；原七组服务保留。零真实模型/native turn。

## 可复跑

```sh
pnpm --filter @personal-agent/contracts build
pnpm --filter @personal-agent/context build
pnpm --filter @personal-agent/contracts check:generated
pnpm --filter @personal-agent/coordinator typecheck:product
pnpm --filter @personal-agent/coordinator typecheck:http
pnpm --filter @personal-agent/console typecheck
pnpm --filter @personal-agent/console test
node --test tests/integration/context-preview.case.mjs tests/integration/evidence-history.case.mjs tests/integration/proposal-commands.case.mjs
node tests/integration/context-workbench-browser.mjs --no-capture
node tests/integration/evidence-workbench-browser.mjs --no-capture
```

浏览器测试创建临时Git/SQLite/HTTP/Vite。context网页effects不启动；context后端和evidence网页包含真实受控子进程验证/接受，均不调用native agent或模型。不带`--no-capture`会更新截图。

## 证据

- [status.json](status.json)：已测范围与剩余owner。
- [context-browser/browser-report.json](context-browser/browser-report.json)：干净source6/6，来源/预算/会话/过期/键盘恢复。
- [evidence-browser/browser-report.json](evidence-browser/browser-report.json)：同源8/8，真实接受/部分与空测量/分页/迟到响应/FAIL/reopen/弹窗计时。
- 两个browser目录的PNG：实现阶段1440×900与390×844截图，不冒称来自clean-source回放。evidence unknown/fail已重拍以露出实际被核对状态；其他panel视觉不变，外层toolbar随后增加context入口。
- [ui-finish-review.zh-CN.md](ui-finish-review.zh-CN.md)：八张证据有效后的五部分独立`ship`，限定本次UI增量。
- [design-consistency.zh-CN.md](design-consistency.zh-CN.md)：沿用既有设计体系及未修复的文档字号差异。
- [recovery-inventory-admission.json](recovery-inventory-admission.json)：A精确source正对照PASS、三个反例FAIL；不准入恢复目标。
- [preview-check.json](preview-check.json)：新个人预览功能开关/空初始状态及旧七组健康读取。

M2/M3可以使用；预览不自动注入模型或扫描仓库正文，历史为有界观察窗口，活动计时为partial元数据。M1/M4恢复目标准备/明确激活、当前source安装包及新原生控制准入尚未完成。所有自动接受、Driver扩展和试点额度均未启用或刷新。
