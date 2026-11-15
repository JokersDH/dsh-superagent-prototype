# 0073：项目模板接入原委托表单

2026-11-15，沿wave28主线M5–M12继续。J路径兼容修复已独立验证，main现在实现实际readonly preview→原NewWorkForm预填→明确创建前重验→原Work/检查/候选/人工接受。没有新执行生命周期、SQL/审批账本或模型提案；后续十路仍沿原目录/分支。

## 实际复用与接口

按J `448a414ed116e4db33b4e23d0ff1a2283cfe4b23` 原字节接入project-recipes package/config/README与8个src，含runtime registered-root observer。Node侧复用matchRecipe/parseProjectRecipeDraft/previewInputs/catalogDigest/createProjectFactsObserver，不在浏览器导入该Node包或重新实现matcher。root仅增加workspace importer与coordinator dependency，没有新增外部依赖。

共享 `packages/contracts/src/project-recipe-preview.ts` 发布严格input/fields/result schema与独立生成资源，frozen Runner v1 hash不变。实际认证入口是 `POST /v1/projects/:id/recipes/preview`：JSON仅projectId、三类kind、显式已有allowedPaths atoms与profileId，拒绝query/私有root/命令/额外字段/path-project mismatch。读取走原认证与Origin，恢复只读按原POST guard拒绝，不借read标签绕过。

main从当前ApplicationConfiguration核项目/profile/dispatch/expiry，root只由当前configured project和原NativeProjectRegistry内部lookup取得。J observer只读该root白名单元数据，不递归、不执行scripts/版本命令/安装、不读取home/env/凭据。失败返回固定脱敏code/message，不输出绝对root、metadata原文、stack。无root/缺库诚实unavailable，普通启动不因新可选package缺失而失败。

结果 `project-recipe-preview/1` 包含原input、config revision、逻辑facts digest、catalog digest、观察时间、draft/needs_input/unsupported/unavailable、完整goal/scope/criteria/profile或明确问题，authorization始终none。facts digest排除本次观察时间，使相同字节重复观察稳定；meta内容变化仍改变digest。digest只是观察身份，不是命令token或执行许可。

## 原表单完整预填

原“新建委托”增加可选任务模板选择，默认手动填写；三模板沿J原catalog。范围checkbox只列当前project已声明atoms，不做prefix授权或推断更小路径。预览只读、不写Work；“应用草稿”才更新goal并保留完整scope/criteria/profile，未应用不能以模板模式创建。

用户仍可编辑goal。创建前再次读取同一preview，比较当前configuration/facts/catalog与原fields；变化时要求重新应用，不偷偷回项目更宽默认scope。观察key包含配置和完整原选择，晚到/取消不覆盖当前；配置删除路径时选择与当前atoms相交，旧applied失效，不能留下不可取消的隐藏旧atom。此边界由独立review发现并纳入实际网页测试。

创建仍发送原create_work，trusted actor由原HTTP补充、scope/criteria/profile由原Application再次检查。相同表单的未知网络重试保持同一commandId，仅明确rejected后换新id；提交ref阻止同一帧重复操作。关闭重开/跨reload的未知结果仍须原reconcile，不宣称前端提供durable exactly-once。

原preview读取不执行任务；创建、检查和人工接受仍是原明确动作。验证跟进的machine-only criteria也走原候选/明确accept，未自动接受。编辑goal不会改变prepared字段核对，F展示层的applicable和草稿digest均不是授权。

## 体验与所有权

沿现有精密浅色工作台、原平面表单、原button/label/checkbox，使用lucide Eye/SquarePen，不新增卡片导航或营销区。局部CSS仅模板原子列表/长文/状态；配置版本标签缩短适应侧栏，观察数据与main原主对话保持。保留手动模式、取消、旧404/unsupported与脱敏错误回退。main未改F trial子树，也尚未把F的recipe reconstruction用于创建。

F下一步直接消费本实际input/fields/HTTP与原表单，不再只交演示props。F当前来源/project-local旧反例已改，但disabled project和缺失grant exclusions仍有展示P2，先修再合；main不信任这些展示结果。J继续当前runtime metadata/draft版本/异常和同包closure，不重做HTTP或构造模型Proposal。

## 发行与验证范围

D后继需要在contracts后构建并打包project-recipes和Node依赖closure，再包含main新HTTP/App源码。当前D1ba包含统计但没有J，不认证本模板新功能。普通旧包/旧入口保持原scope；运行字节改变后先freeze，E再对准确successor作installed验收，docs/test-only不重冻。

已执行J61库/20工具与实际same-config Application consumer、main5新增集成（原登记root→facts→三个模板、schema/auth/scope/过期变化、两个项目到原候选/人工accept）、241contracts、原统计/readiness14回归、strict/generated/build。首轮实际App6场景通过，含预览零业务写、事实变化拒绝、配置路径替换、legacy/错误回退、编辑goal、两明确创建/两人工接受和desktop/mobile。最终源码提交后独立保留clean-source确认与截图，不重标旧报告。

所有vendor/model/native0，使用私有controlled fixture，不重启十二用户实例、不新增持久preview、不修改A迁移/B-I生命周期/D工具/E断言。不宣称恢复/native/installed/效率收益/target activation通过。准确source与证据见本轮集成报告。
