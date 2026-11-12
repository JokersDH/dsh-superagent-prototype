# 上下文消息与恢复目标准备实测

产品源码 `4140cac15f4ab9c4f5027d96fbee99edb22347be`；核心实现a6a33db，A准入86c692f/869716b，数据schema16。用户预览[5188](http://127.0.0.1:5188/)，独立state，不迁移原八组历史。见[0034组合说明](../../../docs/rfcs/WP-16/0034-context-use-and-target-preparation.md)。

## 复跑

先完成构建，再跑浏览器；不要同时重建Vite正在使用的contracts/dist。

```sh
pnpm --filter @personal-agent/contracts build
pnpm --filter @personal-agent/storage --filter @personal-agent/workflows build
pnpm --filter @personal-agent/contracts check:generated
pnpm --filter @personal-agent/coordinator typecheck:product
pnpm --filter @personal-agent/coordinator typecheck:http
pnpm --filter @personal-agent/console typecheck
node --test tests/integration/assistant-context-use.case.mjs tests/integration/assistant-context-product.case.mjs tests/integration/recovery-target-service.case.mjs tests/integration/recovery-target-http.case.mjs tests/integration/recovery-target-initializer.case.mjs
node tests/integration/assistant-context-workbench-browser.mjs --no-capture
node tests/integration/recovery-target-d-consumer.mjs /Users/hh/Desktop/joker/superagent-agent-d
node tools/bootstrap/probe-wave09-target-inventory.mjs /Users/hh/Desktop/joker/superagent --output reports/releases/wave10-integration/storage-main.json
```

新集成95/95、既有回归36/36、storage85/85、workflows58/58、contracts222/222、console28/28，类型/生成/构建通过。provider全部mock；启动实际个人预览只读配置和版本，本轮真实模型/native0。

## 证据范围

- [status.json](status.json)：按模块/产品层记录实际通过与剩余项。
- [context-browser/browser-report.json](context-browser/browser-report.json)：clean4140cac，A真实SQL port，9/9；包括服务端过期+provider未配置的原请求核对。
- 同目录六张PNG：实现阶段pre-A fixture捕获，1440×900/390×844；不是clean源码或真实模型的截图。
- [ui-finish-review.zh-CN.md](ui-finish-review.zh-CN.md)、[design-consistency.zh-CN.md](design-consistency.zh-CN.md)：增量ship及限定原pending修复resolved，未重写既有设计体系。
- [backend-review.zh-CN.md](backend-review.zh-CN.md)：独立审视发现的自然到期guard问题、实际修复和限制。
- [storage-main.json](storage-main.json)：clean a6a33db，A旧三个反例及空库正对照4/4，schema16。
- [storage-checkpoint.json](storage-checkpoint.json)：A仍在写v16草稿时的初探，sourceWorktreeClean=false，不作为固定source准入；正式准入取main clean报告和8a91958路径源码。
- [distribution-checkpoint.json](distribution-checkpoint.json)：D先前六反例关闭，7/7，仅材料和只读资源accounting，不执行candidate stop。
- [recovery-d-consumer.json](recovery-d-consumer.json)：真实D TS/material + main exclusive Store初始化 + A readonly reader，7/7；未变source、未启动target。
- [preview-check.json](preview-check.json)：新个人预览功能开关/空状态，原八组及新实例健康。

恢复跨source测试的D候选路径需要本机存在；它不是已打包安装依赖。当前source校验只覆盖临时marker/root/config，不构成真实host/profile/旧writer屏障。target操作需显式配置可信ports，默认未开放；所有状态固定not_granted/startupAvailable=false，未实现恢复激活。新native/control、当前安装包和研究收益均未在本轮准入。
