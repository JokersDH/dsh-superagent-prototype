# 0064：八人并行开发的实际只读输入

2026-11-14。主线提供实际 `GET /v1/readiness`、`TrialReadinessSchema` 和 `ConsoleTransport.readiness()`，供F接入体验、H内部试用预检消费。G可独立消费既有证据和明确输入文件，不因本接口等待。接口不新增执行、存储或授权生命周期。

## 已实现入口

接口经过原本机鉴权、Host/Origin和只读恢复守卫，不接受query。输入来自同一主线公开配置投影及现有provider status，不调用reply/probe/driver或任何命令。配置缺失明确unsupported，status缺失为unknown，schema/鉴权错误保留，不把故障伪装成准备完成。

输出只含配置revision、观察时间、mode/startupMode、discussion配置观察、execution原公开状态、development分项、项目/profile计数和少量既有功能标记。没有项目名称/路径、provider endpoint/model、原生配置、credential或principal。`authorization`恒为none。

`configuration_present`表示配置事实，不能渲染成连接已验证、原生任务必成功、物理writer静止或发布已通过。fixture显示fixture_only；旧配置缺证据显示unknown；恢复只读会清空dispatchable/admitted计数并关闭决定/提案写能力，模型配置不因此自动变为不可读。

原 `/v1/configuration` 与新入口复用同一个恢复只读投影，防止两个入口对执行能力给出矛盾解释。Runner/data wire hash不变，readiness是独立additive HTTP schema，生成产物单独追踪。

## F组件输入约定

F只在 `apps/console/src/trial/` 交 `TrialWorkspace.tsx`、样式及相关组件，在对应trial测试目录交行为/浏览器测试。main保留App、transport、全局样式、路由与实际命令组合。建议稳定入口如下，具体新增props先给main最小调用需求：

```ts
import type { ApplicationConfiguration, TrialNavigationAction } from '@personal-agent/contracts'
import type { ConsoleTransport } from '../transport.ts'

interface TrialWorkspaceProps {
  transport: Pick<ConsoleTransport, 'readiness'>
  configuration?: ApplicationConfiguration
  onAction(action: TrialNavigationAction): void
}
```

四个action仅是打开原模型配置、项目导入、执行器检查和会话的导航回调，不能作为HTTP命令或直接授权执行。用户动作仍走原确认和写前守卫。旧后端无readiness时返回暂不可用/未观察，不能由UI猜profile readiness。F早交可严格编译组件与可运行私有样例，main即接真实入口，检查点不是等待点。

## G效率观测输入

复用现有 `ExecutionOutcome`、`ReviewTiming`、`AttentionPage`、`WorkEvidence` 及原公开HTTP，不新SQL或第二ledger。ready-to-acceptance是实际等待区间，activeReview只是partial UI visibility proxy；无观测为null，不能称完整人力工时。usage按completeness与币种分开，未知成本不填0、不额外调查价格。受控/厂商原生/operator-note分别统计，裁剪/扫描窗口要公开coverage。

G拥有新 `packages/usage-insights/` 和 `tools/usage-insights/`，提供纯分析API、脱敏只读采集/CLI报告和F可展示的稳定summary。先用实际可得记录或明确声明样例；不足数据准确insufficient_data，不能凭新功能或少量样本宣称提升效率。正式计费收益试验仍按原BLOCKED门槛，不借G刷新预算。

## H内部试用与运维输入

H拥有 `tools/trial-kit/`、`tests/operational-soak/` 与内部试用文档。明确输入准确tar/install和自有状态根，优先复用D/portability的结构化格式；不可自造archive parser、SQL或生命周期权威。默认只读机器/包/配置预检，不自动安装、升级、停个人实例、搬根、取其他home credential。

H有界运行只使用独立证明的自有probe资源与现有已准入操作，逐个信号前fresh核完整身份，unknown保留现场。有限10/30分钟观察可以与独立开发阶段并行，报告真实场景/时长和输入subject，不当作48h soak或发布结论。E继续独占required assertions，H原始观测由E独立核验。

## 验证与限制

新增协议/投影/鉴权/只读/传输测试通过，真实A Store和Node HTTP验证只读GET无事件或模型增量；原HTTP/恢复启动回归、contracts全套、strict/generated亦通过，准确计数见本轮integration报告。本轮没有F UI、G分析包或H工具的完成声明，三者是下一长包的实际输入消费者。

没有迁移、模型/native、queue消费、私有许可、target激活、CAC/新Driver或自动接受。十二用户服务、state/profile/tar/ledger保持。运行字节改变后需准确新包再E独立验收，docs-only不重冻。
