# 后端独立审视归档

范围为本次main context-use、原provider消费、source guard、recovery-target service/独占初始化、HTTP及共享DTO；不是全产品/native/安装审计。独立审查者只读源码与受控测试，未改生产或用户服务。

发现并关闭P2：有效决定自然到期没有事件写入，原同步guard仅看全局event cursor和项目期限，可能在provider.status推进时钟后继续发送旧决定。main将预览/binding期限收紧到项目、所选合同与实际纳入决定的最早期限；新增真实HTTP/Effects/mock provider测试使时钟越过决定期限，确认provider0次、inference reservation0、明确notice。独立审查复验通过。

后续限定复核也通过：provider未配置时，新准备/发送拒绝并持久保存确定rejected receipt；原成功或拒绝receipt仍优先重放，不让配置变化阻止核对或造成第二请求。审查者复跑对应测试1/1通过。

当时context use/product全组45/45、相关恢复组合61/61及product类型检查通过，当前最终主线五组统一95/95。独立意见在其检查范围内无剩余可确认缺陷，不声称排除了所有bug。

生产D整个发行包、真实机器/profile/resource revalidation和恢复activate仍需独立准入。可信构造器可注入fixture并不等于证明用户可以越权；本轮报告明确区分实际生产A持久化、mock模型、跨source D材料与未开放授权。
