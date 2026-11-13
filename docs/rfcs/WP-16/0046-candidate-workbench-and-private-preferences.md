# 0046：回复建议工作台与私有偏好

2026-11-13。继续wave15 M1–M3，源码`65ac737`、`eb96c3e`、`104b7a0`与布局修正`1169535`。这是实际React/HTTP/SQLite/SDK消费者，不增加模型循环、迁移、执行生命周期或确认权威。

## 用户流程

模型设置中的“提案建议”默认关闭，用户显式启用后，下一条原SDK请求可返回0045定义的数据函数。普通文字继续流式显示；只有结构化正文时，验证完整后才一次展示。无效建议不会丢弃已有普通文字。

助手回复下的建议按需读取，每项指向原普通用户消息、原结果artifact及原index/digest。读取与准备不产生业务操作。原内容不可编辑；创建工作仍由用户选择scope、已注册检查和profile，修订则读取精确当前合同并要求新目标。实际确认/拒绝复用原`ProductProposals`与A事务；来源变化不能改贴另一个payload，旧回执仍可核对。

准备/确认丢响应时保留原command与preview，刷新后“创建提案”可核对相同请求。确认前后的来源、授权和合同守卫保留。关闭模态框回到发起按钮，切会话清除尚未确认的候选草稿。

## 私有设置兼容

旧运行实例对`model.json`采用strict schema，因此新偏好不能作为默认字段写回该文件。`PrivateModelProvider`在`${modelConfigPath}.assistant-settings.json`保存`assistant-suggestion-settings/1`，以私有原子写、fsync及rename落盘；读时检查普通文件、owner、600权限和4KiB上限。旧配置字段仍兼容读取，缺省为关闭，选模型不会凭空加新偏好字段。

新版使用相同私有模型路径时共享这份偏好，准备好的单次请求已经固定模式/配置，不受中途修改影响。设置不含key；前端不接收凭据。不支持tools的网关只失败当前一次，不自动补发plain或更换模型。用户网关兼容性保持NOT_TESTED。

## 流健壮性

建议delta先经有界runtime schema验证，再计算字节或拼接。对象/数字arguments、非数组calls、null call等禁用建议通道，保留已收到的正文；null delta可忽略。收集仍限一个数据函数、8个共享proposal及262144字节，没有工具回调、工具结果或下一轮模型请求。

## 验证范围

- SDK/候选/真实进程恢复/原提案/回复/模型/context product组合91项通过，其中SDK20、候选11、SIGKILL5。实际网络只有私有本机mock，真实模型/native0。
- console transport34、coordinator product/http strict、console strict/build与生成规格检查通过。构建仍有原有大chunk提示（约613KiB未gzip），不据此宣称性能完成。
- clean`104b7a0`候选网页8项通过，走真实React→HTTP→A18 SQLite/artifact→C→原业务事务；一次结构化回复中完成明确记录决定、丢响应/刷新重放、真实受控Work创建及修订。mock SDK5次，无真实vendor/native。
- clean`104b7a0`factory6项证明实际运行路径调用C两类factory、cutoff/600上限、publication receipt守卫、跨会话拒绝；新source不只停留在import。
- 原提案网页8及所选上下文网页9通过；保留历史报告，复跑输出写入本轮独立目录。
- `1169535`布局后独立无截图网页回归包含桌面/390×844/720×450的动作完整可见、滚动内容与footer矩形不相交及实际overflow检查。结果见本轮证据；功能通过不改称视觉整体准入。

## 有界视觉收尾

沿用impeccable已有Operate方向，context/detector只各跑一次；既有DESIGN/sidecar无需新token。首轮九张截图，finish reviewer判`fix`：移动端按钮被裁切。一次确认轮的九张截图显示原项resolved，但发现正文透入footer，视觉裁决仍为`fix`。之后按具体反馈将滚动从fieldset移到普通div并保留不透明独立footer，仅作功能/DOM确认，不再扩大截图/设计检测循环。

原截图、失败脚手架记录、检测器91项建议及两次审阅结论均保留。最终修正没有另一轮视觉`ship`证据，不将功能PASS当作视觉批准，也不以这轮feature发布整个Alpha。

## 运行与剩余范围

新个人预览`http://127.0.0.1:5191/`、API8807，state`.local-state/wave15-candidates-preview`。从`104b7a0`启动，后端在`1169535`未变化，Vite消费新UI。启动实际识别native可用和模型已配置，建议关闭；没有自动发送消息或任务。原十一实例、数据库及profile未重启/迁移。

下一阶段仍是M4 source确认消费者及M5私有本机许可。服务端必须签发而非采信客户端intent/host/resource digest；同一UoW复核完整源，精确ignoreCommitted只能排除这一笔已核实回执，重放不重新授权。它们与B真实业务重连、D完整进程身份、当前安装独立验收及target activation分别过门；本检查点不开放上述能力。A–E继续原wave15十阶段包。
