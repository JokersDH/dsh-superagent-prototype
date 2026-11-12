# 无执行器个人启动与网页交付

2026-11-12。后端早期源码`d9d347e`，实际网页/启动包装器固定源码`b2b1adbfc615d27ba4b0f9d9b623bf11c689a25d`，均已推送origin/main。继续wave13主线M1，A–E原整包不变。

## 已实施的产品出口

缺Codex、平台/版本未准入或版本检测失败时，实际personal coordinator和workbench仍可启动。普通对话、流式回复及持久结果、上下文选择/明确发送、使用记录/原始来源可用；模型配置仍单独要求。不会切换受控fixture，也不初始化Git starter或全局新工作区。永久“个人对话”工作区在执行器后续可用时仍保留，不能用于开发派工。

禁执行由Application可信启动配置实施，不能只靠隐藏按钮：新委托、修订/继续/重试、回答/停止/派工控制、验证/接受及工作锚定消息均拒绝，原回执仍可读取/核对。Unavailable组合根只启动已注册的assistant Effects，不构造ProductExecution，不消费旧业务effect，不改旧绑定、unknown writer或核心状态；未完成旧工作保守显示未知，无可执行动作。

原项目目录损坏会失败并释放本次writer lease，不用空目录掩盖损坏。恢复标记优先，仍关闭模型/业务队列，不授权恢复启动。逻辑退化不证明旧进程已经停止。

常用启动入口支持`pnpm start --discussion-only`。经身份验证的不可执行实例可复用；不能将仍启用执行的实例当成仅对话实例。页面显示安全原因和执行器诊断入口，修正旧“回答和停止仍可用”文案；较矮窗口保留完整发送操作。

## 代码位置

| 范围 | 主文件 |
| --- | --- |
| Codex检测/启动模式/永久工作区 | `apps/coordinator/product/native-startup.ts`、`demo.ts` |
| 无执行业务消费者 | `apps/coordinator/product/discussion-effects.ts`、`runtime.ts` |
| 服务端禁执行/历史投影 | `packages/application/src/service.ts` |
| 公开readiness | `packages/contracts/src/configuration.ts`、`apps/coordinator/product/configuration.ts` |
| 页面状态/禁用/短窗口 | `apps/console/src/App.tsx`、`configuration-labels.ts`、`workbench.css` |
| 实际启动/复用 | `tools/dev/start.mjs`、`workbench.mjs` |
| 进程/网页验收 | `tests/integration/{discussion-readiness.case,personal-readiness-process.case,personal-readiness-browser}.mjs` |

[0040](../../../docs/rfcs/WP-16/0040-personal-discussion-readiness.md)记录接口与授权边界。没有新增SQL迁移、账本或执行生命周期。

## 本次验证

| 检查 | 结果 |
| --- | --- |
| contracts/application | 228/20 PASS，冻结Runner/data hash不变 |
| 现有product/assistant/context/process六组 | 77 PASS |
| 新readiness运行时/实际CLI进程 | 7/9 PASS，包括真实旧Work/绑定/队列重开、原回执重放、新控制拒绝与start复用 |
| console transport/fixture与local operations | 31/12 PASS |
| strict/build/generated | coordinator product、console strict、Vite build和生成契约check PASS；Vite保留已有大chunk提醒 |
| [readiness网页最终](readiness-browser-final/browser-report.json) | 6/6，clean tracked source b2b1adb，真实CLI/workbench/SQLite/HTTP/SSE，2次本地mock回复 |
| [所选上下文回归](context-regression/browser-report.json) | 9/9，实际A18端口，3次本地mock；报告保留当时d9d347e+dirty标签 |
| [历史回归](history-regression/browser-report.json) | 8/8，实际A18端口，25次seed mock，读取新增回复0；同样为pre-commit dirty标签 |

非浏览器合计384项，网页为6+9+8个分范围场景，不是安装/native/整体release认证。新增18项测试是contracts2、runtime7、process9；已包含在总数内。全部自动真实模型/native turn0。

[界面复核](ui-review.zh-CN.md)：初轮指出720×450操作区被底栏遮挡，修复后复核为resolved，最终disposition为ship，仅覆盖该修复。机械detector只运行一次exit2：现有Inter warning、旧palette/type文档advisory和新增13px compact标题advisory，未改变用户已确认的设计体系。独立documenter确认现有DESIGN足以描述本次扩展，无额外设计文档改写。

## 可用预览与交接

[http://127.0.0.1:5190/](http://127.0.0.1:5190/)，API8806，独立`.local-state/wave13-readiness-preview`，actual schema18、personal discussion-only、已有私有模型配置，启动时工作/消息0。没有复制旧DB/队列/账号，也未发真实模型/native任务。[只读核对](preview-check.json)包含准确启动source和公开能力。

原十组API8796–8805均健康200，原十组实例未重启/迁移/清理。只读观察时旧UI5182/5183不响应，其余旧UI200；本次未尝试修复或重启旧实例。新预览和5189原生开发预览分别使用独立数据，前者不能编码派工。

D/E可消费固定source`b2b1adb`完成普通personal安装及准确字节验收；这一输入不等target激活或BLOCKED研究。main下一步仍是C实际来源/候选消费者、A逻辑源baseline及正确本机授权/target组合；B/D资源所有权与E最终发行gate分别验收。完成度保留此前69/100与50.8%冻结快照，不自动加分，稳定Alpha未获发布准入。
