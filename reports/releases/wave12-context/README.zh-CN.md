# 上下文使用记录与原始来源交付

日期2026-11-12。后端检查点`e97e65a`，工作台`3d342fc`，独立审阅修正与最终网页source`eea5fa25a6df9bf921e3be3a57bb77d539194abd`。继续wave12整包，没有重新派工或增加模型预算。

## 实际实现

- 顶栏原上下文工具增加“使用记录”：按项目、会话和工作筛选，签名分页，选择记录查看原始来源并返回原会话。桌面列表/正文并列，手机单页切换并恢复焦点。
- 消息旁来源审计和历史正文都读取原绑定的冻结artifact；当前来源后来变化不会替换原文。常见对话、决定、目标和项目范围以可读形式呈现，原始JSON及摘要按需展开。
- 查询、cursor和body核对绑定当前principal/项目范围/会话/work及原receipt。历史到期仍可审阅，不授权新的模型或执行请求；缺失、损坏、超限、符号链接和Scope变化不会暴露未核对正文。
- A早期source`7a8e0995079d2d83b642195ead1a9b9d5658fcad`的三条旧反例已复跑为4/4。只接入其work_id校验和历史测试，生产contextHistory默认已连接；RecoverySourceStore仍未接入，不宣称恢复激活。

## 验证

| 检查 | 结果与scope |
| --- | --- |
| contracts全包 | 226PASS，含2项新schema测试，冻结wire hash不变 |
| assistant/context/进程/新历史HTTP | 88PASS，包含13项真实SQLite/HTTP读取负例 |
| storage/workflows | 87/73PASS，含work派生一致性及5000条分页 |
| console transport/fixture | 31PASS，含3项新增传输校验 |
| strict/build | coordinator product、console typecheck及Vite build PASS |
| [历史网页最终](history-final/browser-report.json) | clean source eea5fa2，8/8；真实A18/HTTP/React/SSE与mock provider |
| [原上下文流程回归](context-final-regression/browser-report.json) | clean source eea5fa2，9/9，含原请求丢响应核对、草稿/过期/SSE |
| [A范围准入](../wave12-integration/a-history-admission.json) | 新source旧probe4/4，只按上述路径集成 |

五组非浏览器测试共505PASS；网页为8+9个分范围场景，未混称native或installed准入。历史网页seed25次本地mock回复，所有读取动作触发额外mock回复0，真实模型/native turn0。

初版网页截图保留在history-browser（source3d342fc）；最终截图在history-final（sourceeea5fa2）。[首轮审阅](design-review-round1.zh-CN.md)列出三项material fixes；[最终verdict](design-review-final.zh-CN.md)将其逐项判resolved，disposition ship只覆盖这三项修正。detector只运行一次，exit0/12项字号文档advisory，保留现有设计体系。[文档核对](design-documentation.zh-CN.md)单列继承范围。

## 可用预览

[http://127.0.0.1:5189/](http://127.0.0.1:5189/)，API8805，新的`.local-state/wave12-context-history-preview`，personal模式、生产schema18、精确既有Codex0.164.0 profile。旧5180/8796至5188/8804均保留且健康200；没有复制旧DB/队列/会话/凭据或触发真实模型/原生任务。新根没有旧对话或使用记录，用户后续实际发送所选上下文后自然产生记录。

启动使用现有workbench入口，不使用尚未准入的D cleanup；实例进程/日志/凭据均在新私有state。API启动source为3d342fc，最终eea5fa2只修改前端和测试，coordinator/packages字节与启动时一致；Vite页面使用当前前端。页面可通过旧端口继续访问旧数据，新旧根没有自动迁移。此预览不表示D安装包、E独立验收或恢复target启动已通过。

## 运行上限

API单页最多50，工作台每页20、同一筛选最多展示200条；跨会话工作选择使用既有authenticated snapshot最近最多200项并显示上限/失败状态。来源单artifact最多1MiB，不读当前仓库文件。详情是原始输入审阅，不是回复正确性或新授权证明。下一主线继续实际恢复baseline/授权与当前安装组合。

记录的粒度是原chat确认的context binding，不单独证明供应商一定收到或使用了该内容；推理前拒绝、未完成等状态仍以原消息提示/请求结果为准。verified仅表示原始数据与绑定/摘要核对成功。
