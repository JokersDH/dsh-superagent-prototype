# F2 模型连接表单：main 最小接线与秘密生命周期

日期：2026-11-16。source：`apps/console/src/trial/ModelConnectionForm.tsx`、`apps/console/src/trial/model-connection.ts`，均从 `apps/console/src/trial/index.ts` 导出。只读取 props、只调用 `onConnect`；不 fetch、不读本机文件、不调用模型/native、不写 storage 或 DOM 文本。

## Props

- `availability: { enabled: boolean; reason?: string }`：main 决定原设置表面是否提供入口。`enabled:false` 只显示脱敏原因，不渲染表单。
- `identity?: string | number`：认证/传输身份。变化时清空 endpoint/model/key、取消旧 callback 的本地引用并不提交。
- `onConnect(draft): Promise<{status:'connected'|'failed'|'unsupported'; message?: string}>`：唯一副作用。`draft` 为 `{endpoint, model, apiKey}`；main 必须自行完成服务端私有保存、RootHTTP/auth/origin 检查与脱敏，不得回显 key。
- `onCancel?`：只导航；不产生连接副作用。
- `initialEndpoint?`/`initialModel?`：允许 main 从原设置带入非秘密字段；不接受任何 secret prop。

## 秘密生命周期与校验

- key 只保存在组件 state 与一次 callback 的局部 draft 中；input 为 `type=password`、`autocomplete=new-password`、`data-1p-ignore`。
- 提交时先清空输入，再 await；成功后不保留 key；失败只显示经 `trialConnectionMessage(raw, secret)` 处理的文案。若文案包含刚提交的 secret、token 形状、绝对路径或 stack frame，则整体退回固定文案，不做部分替换。
- 身份变化同步使当前 key 不可见，并通过 effect 清空全部字段与 draft 引用；卸载尽力清空 draft 引用。JS 字符串不能物理清零，界面与文档都明确这一点。
- 校验：endpoint 必须 http(s)，带账号/密码的 URL 拒绝，远程 http 拒绝（loopback 允许）；model ≤128；key ≤4096 且去除 CR/LF。`配置存在` 不会在 UI 画成 native 准入或执行授权。
- 缺 callback/旧 API：main 不要挂载本组件，继续原模型设置路径；不得以本地表单伪造连接成功。

## 必要验证

```sh
cd apps/console
node --test test/trial/model-connection.case.ts
node e2e/trial/model-connection.mjs
```

受控结果：单元 9/9；浏览器 12/12（字段/密码、无 premature fetch/storage/url、提交清空、泄漏文案拒绝、失败可重试、身份切换清空、卸载不提交、unavailable、取消、键盘、390 布局）。未接 main App，未验证真实 provider；自动模型/native 调用为 0。
