# 明确提案网页与生产source审计

实现source：`b436fde158a8dd14015c3705550bd3ff0d0fd307`，包含A schema15生产facts集成；交接见[0030](../../../docs/rfcs/WP-16/0030-wave-08-proposal-workbench-and-source-audit.md)。这是分范围检查点，不是完整产品/原生/安装/恢复target准入。

## 可复跑

```sh
pnpm --filter @personal-agent/contracts build
pnpm --filter @personal-agent/storage --filter @personal-agent/workflows build
pnpm --filter @personal-agent/console typecheck
pnpm --filter @personal-agent/console test
pnpm --filter @personal-agent/console build
node tests/integration/proposal-workbench-browser.mjs --no-capture
node --test tests/integration/recovery-activation-record.case.mjs
```

截图运行可去掉--no-capture，使用临时Git项目、私有SQLite、实际loopback API/Vite与浏览器；effects不启动，不调用模型。原六组用户服务不参与测试。

## 实际证据

- [browser-report.json](browser/browser-report.json)：clean source b436fde，8/8 PASS，page errors为空，modelCalls0。
- [desktop.png](browser/desktop.png)、[mobile.png](browser/mobile.png)：创建工作确认。
- [desktop-revision.png](browser/desktop-revision.png)、[mobile-revision.png](browser/mobile-revision.png)：同会话两工作中显示目标与预期版本。
- [desktop-blocked.png](browser/desktop-blocked.png)、[mobile-blocked.png](browser/mobile-blocked.png)：过期授权原因及禁用。
- [design-consistency.zh-CN.md](design-consistency.zh-CN.md)：incumbent体系比对及检测advisory。
- [review-verdict.json](review-verdict.json)：两项独立审查修复的限定ship，非全产品认证。
- [preview-check.json](preview-check.json)：personal预览初始健康/空状态，以及键盘打开、无外部页面控件焦点、Escape关闭/焦点返回和320px顶栏无重叠的额外实测。

截图来自feature提交前的相同功能工作树，最后将未定义CSS背景变量显式改成transparent，保持当时透明回退的实际外观。feature提交后以--no-capture在干净source重跑8项通过；两种来源不可混称截图在干净checkout重新拍摄。

## 当前限制

预览/确认/拒绝是用户明确操作；普通模型文本没有自动产生可执行提案。未发送实际native/model turn，未验证新增原生控制，也未解除restore readonly。source audit记录固定not_granted/startupAvailable=false，不能当启动target的权限。完整snapshot/target/安装验证仍分别推进。

本机预览5186/8802使用新私有state；启动检查为personal模式、初始works/messages0、proposalsAvailable=true。原5180–5185未重启/迁移，预览不是冻结发行物。
