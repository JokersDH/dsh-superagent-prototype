# 跨项目注意力待办：主线限定交接

日期2026-11-10。分支codex/g2-execution-integration，起始基线a70db20。共享接口提交a01ca01、功能提交73f8446、标签/浏览器定位修正e937dbe。最后的f571531增加旧后端回退兼容与独立回归输出路径，内容另经旧fixture UI验证；截图及六条新浏览器证据绑定e937dbe，不把测试当时的未提交修改冒充干净提交。

## 已交付

- 原“待我决定”升级为跨项目/会话待办，列出当前可答问题、可接受候选、明确验证/资源/暂停阻断。
- 项目、类型和文本筛选；显示真实等待/业务截止/问题失效，缺失保持unknown，不将expiresAt当业务deadline。
- 使用A现有工作索引分页，默认10/最多20个work，显示本页计数、后续工作和问题读取上限；原会话快照不充当全局数据。
- 回原会话读取精确work，重开保留work深链接；支持上一项/下一项审阅，每项单独接受，未新增批量权限或自动接受。
- 模型不可用不影响新读取；旧接口缺失时退回当前对话问题，隐藏回退不重复挂载问题；所有业务动作复用原gate。

当前排序只在本页按已知等待时间排列，未知时间后置且同分稳定。C候选已提交，尚未准入/接线；没有宣称全局最优优先级、测量收益或异构复核成立。deadline和已知阻塞关系的纯排序由C提供，main不另写一套优先级引擎。

## 代码与消费

| 路径 | 内容与归属 |
| --- | --- |
| packages/contracts/src/attention.ts | 唯一AttentionItem/Page/Query/Ranker，main拥有；frozen Runner/data hash不变 |
| apps/coordinator/product/attention.ts | 已配置项目范围、A索引游标转换、当前工作/问题/可信候选与阻断聚合 |
| apps/coordinator/http/app.ts | 既有认证与Origin/Host约束下的GET /v1/attention，无执行写入口 |
| packages/application/src/service.ts | 指定work读取时限制该work的问题，避免全局200条造成跨项目饥饿 |
| apps/console/src/AttentionInbox.tsx、attention.css | 延续既有设计的列表、筛选、分页与降级 |
| apps/console/src/App.tsx、transport.ts | 精确原会话/工作导航、深链接、逐项队列、公共schema消费 |

接口与C下一消费见 [0022](../../../docs/rfcs/WP-16/0022-attention-inbox-consumer.md)。不改C/B模块或A索引/生产迁移；本批无root lock变化。C现有签名与共享输入之间尚需适配，并独立验证未知等待、真实截止、混合项目及稳定排序；普通推荐/复核默认入口仍受R0闸门。

## 实际验证

精确命令/状态见 [integration.json](integration.json)。共享契约206、后端43、前端18项通过；43包含旧38与新5，18包含旧16与新2，不重复累计。typecheck、console build、generated与规格/本地链接检查通过；构建仍有原有的大于500KB chunk咨询警告，本批不宣称性能优化。

| 浏览器范围 | 结果 | 证据 |
| --- | --- | --- |
| 实际HTTP/SQLite/受控进程新待办 | 6 PASS，e937dbe干净源码 | [browser-report.json](browser/browser-report.json) |
| 持久会话/草稿/归档/手机导航 | 4 PASS，含未提交的输出目录参数 | [catalog-regression](catalog-regression/browser-report.json) |
| 验证阻断/重开/恢复/遥测失败不阻止接受 | 4 PASS，e937dbe干净源码 | [recovery-regression](recovery-regression/browser-report.json) |
| 旧fixture界面/回答/草稿/抽屉/私有设计文件边界 | 8 PASS，含后续兼容分支 | [legacy-ui-regression](legacy-ui-regression/report.json) |

新浏览器首次停在测试标题选择器，随后停在把本地化“未通过”误写为原始FAIL的选择器；均修复定位且保留“没有接受动作、接受记录不增加”的业务断言，最终六条全部通过。没有把测试工具失败计为产品缺陷，也没有降低机器FAIL门槛。

截图为1440×900、1280×800测试尺寸与390×844，全部来自本机隔离fixture；没有新增商品图或宣传数据。独立 [界面复核](ui-finish-review.zh-CN.md) 最终仅对其唯一标签修复评分resolved/ship；[设计一致性核对](design-consistency.zh-CN.md) 限既有系统扩展。两者均不授予整产品发布准入，不把截图或schema当原生兼容证明。

## 预览与限制

[http://127.0.0.1:5184/](http://127.0.0.1:5184/)；API 8800，私有state为.local-state/attention-preview。健康为personal/local-development，新attention资源200，初始无工作。真实Codex配置沿用已准入路径；本批没有启动任何真实Codex模型任务。该实例是独立状态，可导入项目后使用；原5180–5183及其历史/任务保留，未复制旧队列或自动迁移历史。

已知范围：页内排序与有界问题覆盖，不保证全库每条待办均已一次读取；来源可在读取后变化，打开原工作及实际命令会重新核对；sinceAt和跨工作阻塞缺失不补造；活动时间仍是0021定义的UI代理。真实复核、价值pilot、第二Driver、完整R0/发行准入都未由本批完成。
