# Wave22主线：冻结来源的可选Scope说明

源码712e191，2026-11-13，完整范围见[0058](../../../docs/rfcs/WP-16/0058-optional-frozen-source-scope-diagnostics.md)。最小取C纯projection接实际sources reader，只有`?scopeReview=1`才附加reasons/partial/withheldSourceCount/authnone，默认shape保持。

原principal/project/binding/receipt/Scope/state与artifact规则保持，scope_changed不读取artifact、不额外枚举candidate/history/work；未观察counts为null且不公开。解释不授权、不改变正文释放，sharedoptionalDTO有上限和state一致性校验，非法/重复query拒绝。

clean contextrecords15/selectedcontext21/personal12组合48PASS，context78、contracts230及补充schema断言、product/httpstrict、generated通过；独立review新2/2无实质问题。wirehash保持74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d。

UI尚未消费新query，不宣称已显示理由；旧595字节不含此后续可选诊断，不重贴source结果。没有UI改动/迁移/队列/模型/target动作，十二旧实例未重启、预览不自动更新。A–E固定scope另见[admission](../wave22-admission/README.zh-CN.md)，普通发行/private许可/业务attach各自推进。

[wave22派工](../../../agent-tasks/product-wave-22/README.zh-CN.md)静态校验通过：六个owner、60阶段、31依赖节点、136本地链接，无循环或拥有路径重叠；三个新有限复验工具语法、JSON和diff检查通过。这些静态检查不授runtime/native/release准入。分别转发[五段话术](../../../agent-tasks/product-wave-22/forward-prompts.zh-CN.md)，每个goal覆盖完整结果包，三个可运行里程碑提交后继续独立队列。
