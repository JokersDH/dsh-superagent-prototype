# 0058：冻结来源的可选Scope诊断

2026-11-13，基于main a92bb9e/f856与已审C e82901a最小切片。消费C explainRestoredReviewScope纯投影，不引入新检索、SQL writer、推理循环、执行/启动授权或UI改动。

## 实际接口

既有`GET /v1/messages/:id/context/sources`默认保持原响应。显式`?scopeReview=1`才附加可选scopeReview：protocol、去重reason、partial、withheldSourceCount、authorization=none。未知/非1/重复query拒绝；客户端不能提供当前Scope或可信身份。

原principal、project、message、command receipt、binding和artifact校验及scopeWithin判断保持唯一正文释放规则。诊断从已核验的历史binding.scope、当前已配置project.scope、实际state与原source IDs计算，不能改变state/正文或令partial变充分。scope_changed仍在artifact读取之前返回空，不额外扫描candidate/history/work来填“可读数量”。

支持有限reason：project_changed、selection_narrowed/broadened/replaced、exclusion_added/removed及selection_validity_changed。字段最多7个去重理由、遮蔽计数≤64，shared schema核对partial与实际state、遮蔽数与原binding一致。reason用于解释声明路径差异，保守Scope授权仍由原atom规则决定，不把路径前缀分析升级为授权。

## C接口适配与兼容

只取C restored-review.ts、两行导出和小测试，原pathWithin依赖已有。四类可读数量输入改为可选，未观察时返回null；本次公开DTO完全不公开这些计数，因此没有“未读即0”假覆盖率或额外全库成本。

旧query默认不新增字段，旧前端不请求新诊断仍获得原shape；shared ContextSourcesSchema仅加optional字段。原read port增加可选options，旧一参数实现兼容；未实现附加字段的旧port不冒充诊断完整性。UI尚未消费这个选项，不能宣称用户页面已显示新理由。

## 验证与限制

- 新两项实际HTTP/SQLite消费者验证默认shape、窄Scope理由/遮蔽数、零artifact额外读取/零event/provider、严格query、verified正文不变、新exclude/validity、foreignprincipal及readonly读取。
- 原context-records共15项、selected-context产品21、personal恢复12组合48PASS；C最小module5与现有context包共78PASS，contracts230及补充共享schema断言、product/http strict和generated检查通过。
- 狭窄独立review定向新2/2通过，未见实质问题；新增validity路径也已单列定向通过。冻结Runner/data hash仍74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d。
- 全部本机受控fixture，真实vendor/native0。无迁移、queue/target/启动权变化，旧十二实例/数据/profile/tar/ledger未重启或更新。

主源码：context-records产品reader、HTTP opt-in组合、shared optional DTO与C最小投影。D下一必要运行字节冻结后E按同包consumer测，不将main新source结果认证旧包；下一用户界面消费由main明确排期，不能要求C/E越权改UI。
