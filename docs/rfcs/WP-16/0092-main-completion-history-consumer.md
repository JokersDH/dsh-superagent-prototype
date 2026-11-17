# 0092：原工作详情的生产分类历史

2026-11-17，基线main5860da13。消费A固定eac2c9d8的原只读WorkflowIndex事实，不新增历史ledger、candidate表或执行生命周期。准确source/干净App证据见 `reports/releases/wave36-integration/`。

## 已实现链路

原ProductStore/A completionHistory→原Application.inspect当前授权→严格metadata投影→认证GET `/v1/works/:id/completion-history`→typedtransport→原WorkDetail内独立工作历史。原WorkEvidencePanel/timeline、当前检查/产物/人工接受入口保持原协议，不把F的旧WorkEvidenceHistory组件改名为A新协议。

首个默认消费者支持合同版本、检查记录、人工标准验收三kind；该acceptances是人工criterion验收，不是所有交付接受事件，机器标准为主的已接受Work也可能没有该类row。整体接受仍见原时间线/ExecutionOutcome。attempts/reviews仍不公开。每页1–20，默认10，浏览器最多显示200；内部A页最终4MiB预算，公共响应128KiB，transport按流计字节。原同步读取/解析不是可抢占硬deadline；不以最终响应界限声称全读取成本已证明。

## 历史与当前分开

header `currentContract`仅是当前读取/游标围栏，不把旧verification或acceptance强贴新合同。合同row保留原revision/digest，检查/接受row来自原ticket/assignment/generation/digest及原时间。响应不含results正文、环境/host/argv/rawbinding/actor/private路径，metadata不提供发送/执行/批准权限。

`available`表示本类原表来源总量，返回数/显示数各自明确，不表示当前可接受或已完成所有历史。页面是live keyset，非冻结跨页snapshot。首条超过源预算返回显式blocked/entry_too_large，hasMore但无cursor，界面明确较早数据暂不可达；普通ok空more/重叠/无进度拒绝。

## 授权与游标

当前principal、授权project与当前scope/settings身份由main原组合根产生；Work归属和当前合同在原UoW内重新核。外部cursor以独立namespace HMAC绑定principal/scope、Work/project、kind/limit、currentContract和五分钟有效期；内部base64游标不裸透传，不是grant。

API拒重复/任意参数、0/超过20页长、不支持kind和外来Work；恢复只读可读，不写事件。public schema严格投影/字节/identity/progress，transport再核work/kind/limit并取消过大流。新视图按transport-auth/config/work/contract/kind隔离，旧响应与跨kind迟到不进当前视图；旧服务404/unsupported回退保留原交付记录。

## 最小源码导入

exact A workflows.ts及storage/index必要completion exports、workflows ReadIndexPort类型/方法。没有复制A content-proof未闭依赖或旧recoverySource累计hunks，没有迁移/新依赖。B控制/工具、新SlotScheduler、C同步绑定guard、Gidentity helper均未导入本次默认流程。

## 独立静态发行兼容

D新W35启动helper实际与已审main8cd同bytes。verifier改为原8de31与已审339b两个明确hash集合，仍要求actual==manifest声明且在集合中，返回实际匹配值。第三digest/伪声明仍拒，原command exact/Node/LICENSE/inventory/身份核对保持；不从输入学习hash、不跳检查、不修改W33/W35归档、不启动包。该修复可对已有准确W35独立静态验，不要求重打包。

## 验证与未达

新4 backend真实Store/Application/HTTP回归：65条分页、原合同/空接受、认证/Scope/游标tamper-kind-limit-principal-expiry、readonly、超大首条/坏producer。transport1覆盖strict元数据/流上限取消/旧404；wrapperreview1与原staticselftest10保留拒绝。contracts241、生成、strict/build和干净实际App另记录准确结果，不以本文替运行证据。

实际App使用两个原受控Work→注册检查/currentCandidate/available.manualaccept→delivered；另14行是明确的历史metadata复制fixture，不是14次真实模型执行。source/受控/安装/native/原恢复/value分层。

没有新tar、用户实例升级/重启、真实vendor/model/native或危险信号。十二服务/状态/资料/旧预算保持。独立W35静态通过不等E新版安装通过，原Work/Broker故障恢复/原2&4资源仍须实际consumer。
