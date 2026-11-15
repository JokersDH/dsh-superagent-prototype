# 0076：工作台7/30天观察窗口

2026-11-15，wave29 main M9续交，输入79525b6。不改变A–J当前整包，不新增派工轮次或预算。本次实际接通原GET `/v1/insights` 的7/30天选择、当前key隔离与错误/加载/重试；后端早已支持两窗口，这次补齐真实网页控制。

## 实现与复用

main App持有selected days，useUsageObservation默认仍7天，新增可选days/configurationRevision。key完整包含transport/auth观察identity、配置revision、project、days和timezone。新key在render立即隐藏旧data，旧controller abort；即使transport不配合，旧signal也阻止晚响应写回。返回结果再过公共schema并核对days/timezone与所选单project。

同key刷新失败只保留标明上次观察的旧结果；换窗口/项目失败不得把上一范围的数值作为当前数据。加载标记属于当前key，disable/旧请求结束不能关掉新loading。legacy404/optional absence仍隐去该可选观察区，不影响原对话/委托。仅试用准备可见且认证完成时读取，默认对话无新增请求。

F固定f7d80b9a3c31c47ef97cbb1c8031d64f27a2135f已有window/error/loading/admission/CSS片段，本轮最小集成该部分；保留主线原header work样本显示，未引入recipes.ts、recipe props或不合格重建字段。selected window用aria-pressed表达，仍可keyboard focus；同值setState不新增请求，不用disabled低对比度表达当前位置。长stale说明可换行，短标题保持单行。

F组件只接数据/导航，仍不自行fetch/dispatch/创建任务。I/B/runtime、J模板、A数据、D工具和E断言没有并改；F当前候选工作树保持。后续F/G按该实际source继续其余工作台/窗口/export，main保留App/transport/globalCSS和授权组合。

## 验证与限制

14条纯state/admission/transport通过，console strict/build通过，main目标文件机械扫描无发现；既有单bundle>500KB提示仍在。实际App/React/原Product-Broker-SQLite/HTTP/GNode私有controlled场景扩成9项：默认按需、精确7/30服务端跨度、old-window立即隐藏/late拒绝、新窗口失败不复用旧行及retry、真实project筛选、old-project late、同范围dated错误、legacy缺失与桌面/手机/键盘。

首次实际9项通过，POST/event增量0、真实模型/native0。数据是当前三条受控工作，不冒充真实操作者30天历史或效率收益；窗口本身绑定服务端rolling168/720小时和明确timezone。提交后以准确干净source再确认，并记录最终desktop/mobile截图。原项目模板用户流也单独回归，不以只读统计的0写结论替代创建/接受业务动作。

无contracts/SQL/schema/根lock/外部依赖/后台任务变更，无持久preview、旧12实例重启或新tar。installed/native/recovery/value/private-target准入仍分开；D后继需真实运行字节freeze再E独立验。本轮M9完成不等于main24阶段或全产品goal完成。
