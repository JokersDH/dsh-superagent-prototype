# 原Runner端口与真实工作台消费者

2026-11-16。运行sourcefc38bf65b6a05a7771fc58829152c512255a6a29，已推origin/main。[设计与内部接口](../../../docs/rfcs/WP-16/0083-main-registered-port-and-workbench-consumers.md)、[机器状态](status.json)。

## 实际变化

NativeProductAttempt在原register/ready/current通过后返回原endpoint/producer clone到`RunningAttempt.attachPort`；B附着caller按原payload reference/body服务，原freshguard不变。不自动attach、不加HTTP/新Work/新credential/第二执行状态机，内部端口不意味着恢复完成。

F六源进入实际App：空项目操作、导出中/禁用/重试、观察时间和支持折叠摘要。原模板读取hook加入同scope reload revision，App明确传retry；一次重试只重读当前三个readonly previews，旧project/config/auth范围隐藏并中止。支持包/源码标识缺失仍未知，没有将Git HEAD伪作运行包。

## 验证

- attached-port4：全部main source+真实ProductStore/storedIngress，allow/deny/missingguard与foreignfact；原payload/receipt seq/hash匹配，未种造成功回执。fixture预置合法ticket/binding，不叫原Application/QuestionBroker恢复。
- trial20、console/coordinator和actualNative/caller strict、UIbuild通过。首次19过1失败是新recipes source和旧测试错配；导入F对应测试后20过，新增排除不能通过受限选择保留就拒，未放宽实现。
- [实际项目网页9项](recipes-browser/browser-report.json)：新增503脱敏、三preview重试、支持折叠/未知身份和0业务副作用；原两项目模板检查/当前候选/人工接受、已record丢响应同commandId重试保留。两Work明确接受，3create请求仅2个不同commandId。
- [观察网页13项](observation-browser/browser-report.json)：7/30、project/late、错误/legacy、实际下载与坏digest、切范围取消、桌面/手机。业务POST0/eventDelta0，21readonly preview POST单列，不误算业务写入。
- 原backend13项过。浏览器在所有构建结束后运行，报告都为干净fc38，pageerrors0。1440×1000/390×844截图实看，无横向溢出。保留已有CSS advisory和>500KiB bundle提示，不作附带重设计。

本轮没有新增wire schema/迁移/外部依赖/rootlock，没有生成新tar或persistent服务，没有重启十二用户实例/改候选工作树。真实vendor/model/native0；同原Work完整恢复、原2/4槽、actualnative/独立installed/value/private-target仍未达。上述四回调和网页正证只按相应层支持结论，原完成度口径不因用例数自动改变。
