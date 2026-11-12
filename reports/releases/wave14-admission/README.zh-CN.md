# 第十三轮成果独立验收与下一轮入口

2026-11-12，主线固定`1453cf279b872eb99116547f1b4ce77867b74880`。本次是实际源/探针/包字节的范围验收，未运行厂商模型任务，未批准稳定Alpha发行。下一任务见[wave14](../../../agent-tasks/product-wave-14/README.zh-CN.md)与[分别转发文本](../../../agent-tasks/product-wave-14/forward-prompts.zh-CN.md)。

## 先保留已经成立的成果

| Owner | 固定HEAD | 本次独立运行 |
| --- | --- | --- |
| A | 278b665 | 旧source probe4/4；storage87/workflows100；storage strict、storage/workflows build通过 |
| B | aacc342 | 旧5/5；四公共模块strict/exactOptional；helper/resource68；真实产品正常纵向6PASS+1NT |
| C | 83ac3e1 | 旧6/6；四包118+34+80+44=276；strict/build；当前main A18/runtime/HTTP/CompletedReply组合9；consumer strict |
| D | d833d0f | 旧6个mock通过；缺legacy绑定纯谓词拒绝；新tar全闭包校验通过 |
| E | 3dfdcbd | 旧3个required分类通过；动态schema同值错误与旧分类缺口已修 |

A source旧三问题不再列为未修；其实际main baseline消费者仍未实现。B正常纵向确有Work1/Ticket1/question1/answer-delivery1/fact7/dispatch2，不再沿用“全空”结论。重开进程只读取行仍存在，未做恢复后answer/stop、独立Runner服务重连或receiver真实次数，不能称活动任务恢复完成。

C旧Scope/coverage与回复边界已经修复，最小conversation/Composer/candidate切片可供main消费；本次当前main组合没有读取SSE，不声称新factory已替换默认HTTP路径。source-review/排序新问题不影响main现用私有guard。

## 阻断与范围

| Owner | 本次新反例 | 结论 |
| --- | --- | --- |
| B | 4个FAIL：getter实值变BigInt、数组Symbol键丢失、Map变空JSON、Windows路径尾部泄露 | 实验helper/诊断P2，未作为main现用产品漏洞；恢复后实际控制仍欠缺 |
| C | 6个FAIL对应3类：遗漏抑制真值、4种路径、artifact recent顺序 | 暂不默认公开投影/直接替换artifact排序；过期候选展示和私有reader标记另列说明，不计权限漏洞 |
| D | 6个纯mock FAIL：record身份、foreign journal、逐PID stat失败、malformed清单、父install角色、实际recover清理 | P1，任何广泛live cleanup/stop矩阵前必须关闭；实际OS扫描/信号/进程启动0 |
| E | 5个FAIL：required空evidence、正确格式foreign source/SHA/build-size/installed tuple | P1验收缺口；固定NT/fixture模式及route正则另有P2；完整installed tier仍FAIL |

D旧live legacy脚本没有独立operation拥有证明，本次未运行。未将未运行写成PASS；旧纯谓词拒绝只证明该范围。所有十一组用户实例、账号/state/队列/native profile、历史tar/账本保留。B原两份report差异、C root lock差异、E原有runs未清理。

定位到固定source的关键位置：D `apps/launcher/lib/upgrade.mjs:429`逐PID扫描、`:462`清单过滤、`:491`身份、`:807`角色扩大；E `tests/product-acceptance/lib/release-requirements.mjs:158`缺实质evidence、`lib/release.mjs:369`tuple只验格式、`cases/e4-install.mjs:85`route检测、`:1303`固定NT；B `packages/driver-kit/src/review-sender.ts:240`/`:263`与`runtime-diagnostics.ts:113`；C `packages/context/src/source-review.ts:132`/`:271`及`scoped-adapters.ts:270`。行号仅对应上表固定source。

## 包字节核验

[artifact.json](artifact.json)：D包source99832f6，build3ead6a26161f4c72，tar SHA256`b7e9dec7d264f94cadda10c6624db582ddd477ff83a7a8816c6acf5f0c5237d4`，20167862 bytes；6692文件/21内部symlink、67256832展开字节、manifest/release/closure digest全部通过。实际schema18、Node24.21.0、ABI137、SQLite3.53.4、darwin/arm64。只导入实际Store模块并打开临时内存SQLite，没有启动安装daemon。

包有context prepare/send、history、sources与持久reply消费者；不含M1仅对话/无执行器runtime。E当前153PASS/0FAIL/18NT仍test source b8661f0、旧020af82/build1a2f34ac359a5739/tar96d32fb…；不能认证此新包或当前1453cf2。仅文档commit变化不构成运行字节变化，后续验收需要冻结tuple与明确产品来源切片，不能任意换一个合法commit。

## 可复验与下一交付

旧probe继续使用原工具，但所有输出指定`PA_ADMISSION_REPORT=/tmp/pa-wave14-<role>-previous.json`，本轮新证据保存在独立目录。新B/C/D/E反例由本轮`tools/bootstrap/probe-wave14-*.mjs`重现；D只使用mock inventory/signals及已核验解包目录，不启动候选真实cleanup。E按实际installed-alpha中对应条目做有界变异，不合成整层PASS。

[0041](../../../docs/rfcs/WP-16/0041-wave-14-reviewed-inputs-and-product-exits.md)给出具体文件/源码范围与五个十阶段包。main必须交真实A source baseline、C来源/候选消费者和授权组合；D/E普通personal包可以立即以已交M1基线1453cf2继续，不等target激活或BLOCKED研究。

完成度仍采用69/100、完整B50.8%的冻结工程快照，不从包内测试数量自动加分。新的正常纵向、数据与字节进展成立；P1、实际恢复控制、当前personal安装及独立release gate没有整体准入。自动真实模型/native0，原预算不刷新。
