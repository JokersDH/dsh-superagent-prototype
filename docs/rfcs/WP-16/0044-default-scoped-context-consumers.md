# 0044：默认上下文入口实际使用C factory

2026-11-13，基于main53b1598，消费已独立审阅的C固定source2e1c095。继续wave15 M1，不新派工，不增加模型额度。

## 实际接线

`ProductContextPreview`的默认runtime/HTTP路径改为调用C的`createScopedConversationProvider`和`createPublishedArtifactProvider`。只接scoped-adapters、Composer Scope/coverage部分及对应导出/测试，没有整体引入C manifest/history/review API或改root lock。

main reader仍固定原conversationThrough cutoff，每页200、最多3页/600条；C负责conversation/project/work/provenance/question边界及覆盖状态。main保存扫描到的原消息指纹，原授权、decision窗口/期限、work/verification/evidence和最终同步assertCurrent仍保留。C manifest不能替代这些守卫。

Artifact只从当前work的已发布ID读取metadata，不读文件或全局registry。main额外核对既有`product-artifact`原发布receipt的id/work/status/digest，并在最终同步守卫核对原receipt和完整metadata。未发布、撤销或缺失的记录不会作为可用资料。单次最多查256个发布ID；更大集合明确不完整，不声称在未查全集中找到了全局最新项。

Composer传播provider coverage，预算、扫描或缺失造成的不完整资料不能呈现为完整上下文。公开wire沿用原context-preview；新增缺失/未完成状态通过原issues/omitted/group状态表达，不增加执行权限或默认上传资料。

## 验证

- context包69项及现有HTTP/context use/history组合74项PASS，coordinator product strict PASS。
- `node --experimental-test-module-mocks tests/integration/context-factory-consumer.mjs`六项PASS。spy包装实际C factory而非替代数据实现，证明默认runtime/HTTP确实调用它们。
- 六项覆盖实际只读HTTP、原cutoff、新消息排除、无event的publication receipt变化、未发布/缺发布资料、坏跨会话page以及真实600条扫描边界。临时产品先通过现有受控执行发布artifact，所有context读动作不读artifact bytes/不改DB。
- 原指纹、授权与原request发送/重放负例保持通过。自动真实模型/native turn0，十一组用户服务/数据/账号/账本未重启或修改。

这是默认来源factory消费者，不表示非空候选、恢复许可、target启动或当前安装包已经完成。本轮继续同一次SDK响应的候选数据和原提案确认链。
