# 第八轮交付的独立验收与第九轮输入

完整结果：[status.json](status.json)，共享边界与下一包：[0031](../../../docs/rfcs/WP-16/0031-wave-09-admission-and-target-boundaries.md)、[wave09](../../../agent-tasks/product-wave-09/README.zh-CN.md)。审视基线7027d31，实际集成/接口source e95544f，A备份集成为63cc3da。

## 通过与接收

- A：activation快照family、原source事实/分页回归；主线storage75/workflows45通过。
- C：旧四项授权probe通过；按文件接入context模块和knowledge adapter，56/54包测试通过。没有接入confirmWithCommand或开放context HTTP。
- main：提案/决定/source审计22项、target配置binder2项，以及相关构建/typecheck/契约生成通过。Target输入/输出和port已发布，startupAvailable固定false，不代表实际target已经能准备或启动。

## 仍阻断

C自定义group可用artifact grant读decision，辅助确认记录与返回command ID不一致。可运行：

```sh
node tools/bootstrap/probe-wave08-context-grant.mjs /path/to/checkout
node tools/bootstrap/probe-wave09-context-proposal.mjs /path/to/agent-c-checkout
```

前者原四项PASS；后者两个正对照PASS、两个新反例FAIL。main未使用unsafe helper，context仍无产品入口。

B普通JSON资源描述可放行、单token可重复fake发送，E还可绕开B sender；E实际costOf→settle链可把缺计费明细解释成0并清unknown。D漏孤儿API、过滤未知活target后可空集合证明停止，缺record启动身份和终态建议仍不一致。

这些B/D/E结果来自精确Git源码和隔离内存fake probe，不是实际模型或真实PID操作。没有改账、发信号或运行其整套安装/native测试；不把源码自报矩阵当main通过。

## 安装证据的边界

D最新真实pair是schema13 build7e8f6ce6→cd0ecc29，hash已只读核对；其目标没有main7027d31的UI/schema15。E实际产品source8195d31；安装仍是dirty12 buildb0f87c88→schema13 build9120a5ed，操作为两次fixture start，不是D托管upgrade/rollback。

保留旧cold-install/数据迁移结果，但不能据此宣布当前个人版升级准入。E下轮必须显式输入完整artifact tuple并执行真正托管命令。

## 继续推进

A做真实只读目标验库，D做私有材料准备/全进程停止，B复用旧可信proof并绑定一次性sender，C修两个反例后给产品consumer，E验当前网页/托管升级/target窗口；main实现context/evidence与最终target授权。原七组实例、所有ledger和研究BLOCKED状态保留，真实模型新增0。
