# Runtime 规格自检

日期：2026-11-07。对象：`04-agent-runtime-and-extension.zh-CN.md`。本记录是设计检查，不是运行兼容报告。

## 已约束的高风险点

- 不建立第二份 Work/Ticket 生命周期；Driver 不直接写核心状态。
- 核心 Decision、UserQuestion、UserDecision 名称与存储职责分开。
- 核心 legacy report 缺 assignmentId，所有 runtime report 必须在同一事务 fence 后调用。
- native turn 结束不直接变成核心 ready；最终验证/接受仍属 Kernel。
- B 版个人 Ticket 必须开启 external completion mode；最终确认检查当前 Assignment 与 candidateGeneration，不使用假 GitHub Thread。
- 授权撤回和物理 writer 静止分开，UI 不由 Ticket.ended 推断完全停止。
- prepared native policy 落盘并与当前 attempt 匹配前，不发送 begin。
- SDK、wire、schema、engine、projection、profile、权限版本分开记录。
- 配置/HMR 漂移使准备和兼容记录失效，不仅核对 binary。
- 问题原生来源、权限和认证分开；response 写出不伪造持久消费确认。
- 不跨连接复用 request ID；旧 epoch 事实只进 runtime 审计。
- 不确定发送先核对；新目录不能隔离旧 agent 的远端副作用。
- 共享服务 ownership 限于自己 session，不能 kill 其他工作。

## 需要共享契约所有者确认

1. CriticalFact 的 ticketId/assignmentId/attemptId/fenceEpoch/factId 为强制字段。
2. runtime binding、inbox receipt 与核心 mutation 需要同一个事务存储，不跨两个 DB 许诺原子 fence。
3. `begin.preparedPolicyRef` 必填；policy.prepared 绑定全部身份、权限 revision 与有效配置摘要。
4. Driver 仅发 candidate/turn/runtime 事实；candidateGeneration 由 Kernel 分配，最终确认检查当前 Assignment/合同/generation 后才完成。
5. staged/unknown、部分已测试、可交互、batch-only 的任务就绪判定不能压成一个 supports boolean。

若现有共享契约不支持上述字段，应提交单独 RFC，而不是由三个 Driver 各自补私有字段并绕过 core ingress。

## 当前未完成验证

Codex 只完成前期 schema 导出；DSH 的安装版 profile/capability 与 ZCode 安装版 wire 对齐均待 spike。没有运行模型、安装外部依赖、读取认证材料或执行 native runtime API。

原生安全停止、后台资源清理、鉴权重连、HMR、权限映射和多 target 答案应用都需真实 scratch 验收。文档及 fixture 全绿不代表这些能力已被产品证明。
