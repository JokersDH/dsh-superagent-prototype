# 第三轮工作台与五通道产品化检查点

日期：2026-11-10。实施基线 `c3f018e`，派工检查点 `85922fd`。本批完成用户确认的主对话中心 UI，并建立 A–E 五条独立实施通道；排期中的能力不算已实现。

## 已实现界面

- 石墨导航、白色对话、青绿操作、语义状态色和本地字体；固定工具尺寸、零字距和独立滚动。
- 主对话、当前对话的工作/交付目录、集中问题、执行器连接四视图，消费实际 configuration/snapshot。
- 工作搜索/状态筛选，切换视图保留草稿。服务端完整会话目录和跨历史搜索仍由 A 补齐。
- 阶段条显示工作入口、该工作的问题数量和阶段；有问题时不把执行误标为已结束。
- 桌面 1440px、笔记本 1280px、窄屏 390px 的底部导航与互斥抽屉，Escape 和明确关闭操作。
- 原生执行器与固定流程分列；空/加载/失败状态不显示假成功。

原委托、问题答案、检查、产物预览/下载、接受和重开行为保留。设计记录经 Vite deny 隔离，不进入客户端 bundle；本地 Inter/OFL 不依赖字体 CDN。最终标题零字距已用实际 computed style 核对。

## 设计与验证

使用 Impeccable 的产品记录、方向 contract、两轮有界截图、独立 finish review 和设计系统提取。初评三项 material fixes 均已修复；独立 reviewer 逐项评分 resolved，返回 `ship`，结论仅覆盖该修复评分，不扩成原生或全产品认证。

前端单测 12 项、新工作台受控交互 8 项、原 HTTP/SQLite/受控执行器浏览器流程 11 项通过；typecheck/build 通过。detector 对 Inter 有两项“常见字体”建议，作为明确保留的操作界面选择记录，不称全绿。本 UI/规划轮应用网关和原生模型调用均为 0。证据在 `reports/releases/ui-wave-03/`。

后续 UI 以 `apps/console/PRODUCT.md`、`DESIGN.md`、`.impeccable/design.json` 和 surface brief 为输入。方向 contract 不复制到组件、props、隐藏 DOM 或打包输出。

## 当前进度

现有真实开发闭环是单用户、单 Codex、普通 pnpm 单包的可用预览；完整个人助理、内部发行和异构执行器仍未完成。原 434 项受控回归、132 项 Runner、六项真实成功路径保留各自范围，不转换成整体完成率。

下一步优先：会话/项目管理、可操作验证/环境错误、原生活动停止/问题/恢复、授权读上下文/提案/明确决定。统一待办还需继续整合原生问题与候选人工接受；当前问题数量不当作所有待办的永久分母。发行随后，CAC 后置。

## 五通道集成

| 角色 | 拥有范围 | 出口 |
| --- | --- | --- |
| 主线 | console、contracts、application/questions、coordinator、root lock | UI、公共资源/命令、确定性接线 |
| A | storage、workflows，唯一 SQL 迁移 owner | 会话/项目工作流、版本设置、读索引、快照 port |
| B | Runner、Codex Driver、DriverKit/testing、native-acceptance | 原生控制/问题/恢复和资源证明 |
| C | context、proposals、knowledge | 有界上下文、受校验提案、明确决定 |
| D | launcher、distribution、portability | 本机发行、first-run、完整迁移和回滚 |
| E | product-acceptance | 独立产品/UI/安装验收与最小复现 |

每人五阶段，先提交稳定 interface 检查点再继续整包。公共 DTO 仅主线生成，迁移仅 A，root lock 仅主线；C/D 不自建 writer，主线不并发改 B 的 Runtime 源码，E 不改生产实现来通过测试。依赖未到时按同一 port 推进 fixtures、负例和工具。

A/B 原 checkout 保留；C/D/E 已从派工检查点创建并设置同名远程 upstream。开工在自己的目录保存改动、合并最新 main。入口见 [第三轮派工](../../../agent-tasks/product-wave-03/README.zh-CN.md)。

## 迁移与未来接入

内部试用先每人本机静态网页+daemon、独立目录/账号/项目；现有单用户服务不直接开放为 LAN 多人系统。SQLite ABI、进程/socket 机制需平台实测；完整备份包含引用产物，不能改旧 PID/inode/签名来恢复写权限。

网页/daemon 稳定后再冻结桌面壳；Electron + 标准 Node sidecar 是保守候选，Tauri 为对照。CAC 经现有 Driver/问题/验证 interface 接入，原生 sub-team 留给 CAC，不增加第二生命周期。详见 [迁移、部署与 CAC](../../roadmap/portability-and-cac.zh-CN.md)。
