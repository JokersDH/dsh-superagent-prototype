# Agent F：完整日常助手体验的三个连续工程包

日期：2026-11-16。继续 `/Users/hh/Desktop/joker/superagent-agent-f`。
原分支 `codex/g4-trial-experience`；保留六张未跟踪截图、全部dirty、原状态/报告/历史。
先读 AGENTS、START-HERE、product-spec/README、现有DESIGN、[本轮 README](README.zh-CN.md)。
再读 [0089 主线实际配置消费者](../../docs/rfcs/WP-16/0089-main-model-configuration-consumer.md)、[0090 架构复审](../../docs/rfcs/WP-16/0090-wave-35-reviewed-architecture.md)、[0091 连续子系统程序](../../docs/rfcs/WP-16/0091-wave-35-continuous-subsystem-program.md)。
保留改动后同步 `origin/main`，继承实际集成修复；只推owned路径到原origin分支。

## 一个 Whole Goal，三个连续工程包

建立或延续一个goal：把已落主线的配置、日常工作、真实历史来源和支持做成连续可持续的actual App体验。
三包各三个完整产品成果，共九个；不是九个按钮、小fix、截图或重复套件。
每成果交实现、actual consumer、必要正负与source handoff，early/intermediate/final后继续三包及独立队列。
无同日、工时、持续时长或token承诺，不在candidate组件或一次source检查点结束goal。

- 固定起点 `d03a7872`，旧组件/39 pure和受控旅程有用，但原form的StrictMode/identity问题已由main修复。
- main `4cde5883` 已交原PrivateModelProvider私有原子configure→认证POST/严格DTO→typedtransport→原ModelPanel。
- 实际App六StrictMode HTTP场景通过；`c544781b`仅加强手机测试，后续launcher小修不代表新安装版。
- main表单已修effect replay/旧identity回包/独立secret脱敏/重复提交，保存是saved，不冒供应商连接验证。
- main有显式HTTP开关，保存不发模型/命令/事件；先继承这条链，不再把main写成只欠backend/data port。
- HistorySourcePanel是ContextHistory/ContextSources候选，不等A completion-history；原主线context历史不要盲目替换。

## 工程包一：真实日常、配置与身份恢复

### 成果 F1：多项目多 Work 的连续日常体验

实施范围：

- 在原主对话/侧边工作区完成多个项目、会话、Work、问题、检查、候选与人工接受的连续使用。
- pending/批准请求/机器FAIL/待审阅/已接受/unknown各自准确，原对象和下一动作不混。
- 模板继续main原preview/apply/edit/revalidate/explicit create，不本地拼全套创建fields或第二导航。
- 原Work/contract/conversation/问题/产物ID、未发送草稿和返回路径稳定，不以新Work补原链缺口。

实际 consumer：

- actual App使用同批非空双项目原数据和原HTTP/Application/Broker，F仅交owned组件/typed callbacks。

必要正负：

- 正常交付、多个pending/FAIL/当前候选可并存，用户能回原问题、证据、对话和草稿。
- 旧主体/候选、取消、重复点击和unknown不隐式创建、批准或接受，readonly无写入口。

Source 交接：

- 早交完整日常组件、原IDs/实际consumer与必要main补线，发布后继续F2，不只重跑已有10场景。

### 成果 F2：已接主线的模型配置完整产品

实施范围：

- 在原ModelPanel继续完成当前配置/编辑/保存/失败/缺API/旧服务和明确HTTP opt-in的完整体验。
- 继承main保存链和生命周期修复，不重新实现RootHTTP、私有writer、transport或另一设置中心。
- key只在组件瞬时state/请求引用，提交完成/失败、身份变化、卸载清理；不进浏览器storage/URL/log/普通DTO。
- server可在原0600私有配置保存，网页不回显key；saved不等真实连接验证，配置不等native执行器准入。

实际 consumer：

- actual App原设置表面使用当前typed callbacks和脱敏服务器结果，不再只有独立harness的Form。

必要正负：

- 当前保存/缺输入/旧API/manual fallback和显式HTTP选择可用，保存本身0模型/业务命令。
- StrictMode、身份切换/旧echo、无message saved、双击/失败和卸载回归保持，输入与反馈不泄密。

Source 交接：

- 交实际设置组件/输入状态/兼容与明确秘密生命周期，保留main已修source，继续F3。

### 成果 F3：错误、身份与草稿恢复产品

实施范围：

- 区分未配置、未安装/认证/准入、loading、明确拒绝、网络未知及已记录后丢响应。
- 同identity旧可读内容与换identity隐藏策略一致，旧成功/错误不能覆盖当前配置/项目/窗口。
- 原输入/选择/焦点/commandId保留或准确失效，重试沿原幂等/核对，不能默认换ID重发。
- readiness/模板/观察/支持/保存共用现有main side effects，不建另一请求状态机或猜后端事实。

实际 consumer：

- actual App遇错后能回原设置/表单/Work继续，F通过正式DTO与main callbacks组合。

必要正负：

- 两项目来回、取消/重开、明确重试和known/unknown结果有连续正向路径。
- late/旧auth/配置改变、失败及缺callback不重复业务、不串秘密/草稿，也不把unknown画成成功。

Source 交接：

- 交包一实际用户链/错误不变量/命令exit与source，直接继续第二包，不等再派工。

## 工程包二：真实历史、决定与证据审阅

### 成果 F4：原 Work 的实际历史浏览

实施范围：

- 消费A正式completion-history公开DTO，做非空分页/当前关联/合同attempt/验证与review浏览，不止能力badge。
- 不把ContextHistoryPanel当A工作历史；新展示与既有消息上下文历史分清，仍在原App返回原对象。
- source/caller/物理候选数/真实review/unknown/truncated/blocked及live keyset语义准确。
- body/current/Scope/游标由main核对，F不fetch、读本机路径或公开raw binding。

实际 consumer：

- actual App通过main正式history callback/DTO读取原Work多页并回原对话/草稿，A/C共享真实原引用。

必要正负：

- 正常非空多页/末页/当前历史并列可用，已有ContextHistory不被重复或破坏。
- foreign、旧cursor/身份、过大/无进度/缺内容和late数据不伪造完整零值或批准。

Source 交接：

- 交真实Work历史组件/类型/原对象旅程，缺shared接口早交main，继续F5，不交静态示例当完成。

### 成果 F5：决定版本、来源与新工作确认体验

实施范围：

- 消费C当前决定/selection/preparation DTO，呈现显式选择、版本、适用Scope、来源和失效原因。
- 选择经main原表单/guard确认后才应用新工作，不把data-only valid或hash画成执行grant。
- 历史冻结版本与当前决定、撤销/替代/过期各自明确，不在UI自动学习、推荐后自动应用规则。
- 原来源选择/预览/确认/历史正文沿已授权ContextHistory/ContextSources与原viewer，不盲替现有可用面板。

实际 consumer：

- actual App原新工作流程使用明确所选引用，用户可返回原决定/来源/草稿，RootHTTP/App由main接线。

必要正负：

- 合法当前选择、无选择普通委托和原来源审计可用，版本引用能对回原Work。
- prepare后source/version/Scope变化、旧snapshot、未读选择和readonly不隐式创建或放宽权限。

Source 交接：

- 交实际选择/预览/失效组件和主线最小callback，继续F6，不只显示候选DTO。

### 成果 F6：证据、Patch 与人工审阅流程

实施范围：

- 让原artifact/check/patch/currentCandidate/历史证据可查、可返回，使用原冻结bytes与授权下载。
- 原机器FAIL、候选旧版、未满足人审、unknown和已接受区分，人工接受仍是明确原命令。
- 控件能定位检查失败/缺产物/摘要不符，保留当前原表单、工作目录和同一次审阅上下文。
- 复用已有可信viewer/结构化格式与typed数据，不新造verifier或用文本/颜色替代authority。

实际 consumer：

- 同一actual App从原Work进入真实证据/patch、核当前候选、明确接受后回原对象。

必要正负：

- 双项目正常审阅/失败修正/历史只读及实际下载可操作，原IDs/内容对应。
- stale/foreign candidate、机器FAIL、缺body/坏摘要和重复点击不能接受或串项目。

Source 交接：

- 交包二完整实际浏览/确认旅程、必要正负和source，继续第三包，不用截图代替正文消费者。

## 工程包三：支持、访问质量与持续交付

### 成果 F7：真实支持与可复现反馈

实施范围：

- 使用main已交支持GET、原scope hook/digest下载及G脱敏metadata，完成取得材料→理解缺证→回原工作的反馈流程。
- project/window/config/auth/observedAt和页面/文件范围一致，新snapshot与旧观察清楚。
- 无正式deployment身份保持未提供/未验证，不用Git HEAD或fixture伪造安装source。
- 默认不收集原文/目标/patch/key/私有路径，不自动上传或给外部发消息，不复制collector/下载pipeline。

实际 consumer：

- actual App沿现有support/download callbacks取得严格文件，用户主动使用材料，main/G/H可定位同一范围。

必要正负：

- 正常/partial/unknown/错误材料可取得或明确重试，页面仍保留原日常输入。
- late、旧API、错范围/坏schema/digest或缺callback不自动下载、不混文件或泄漏秘密。

Source 交接：

- 交支持完整组件/真实文件DTO/用户反馈操作和source，继续F8，不重做0086主线机制。

### 成果 F8：移动、无障碍、WebKit 与性能质量

实施范围：

- 在同一真实组成页面完成1440/390、键盘焦点、读屏语义、长中文/错误和稳定尺寸。
- 200%缩放/强制色彩/窄屏可读可操作，控制状态不抖动、不遮挡前后内容。
- 按现有DESIGN/前端skill局部改善，不新shell/导航产品、不全局换主题或堆嵌套卡片。
- 可用WebKit实测；缺binary/未测准确报告，有限大列表/长会话交互有界，不拿短测冒48h或收益。

实际 consumer：

- actual App贯穿前两包配置、工作、历史与审阅，组件/harness/browser/安装证据分别记录。

必要正负：

- 用户可完成进入/提交/错误/重试/展开/返回，长文本和数据量下无溢出/重叠/无界请求。
- 多identity、readonly、旧API和键盘/移动有必要对照，未测平台/读屏/长期auth不填PASS。

Source 交接：

- 交实际source/视口/浏览器/必要正负和限制，继续F9，不靠重复旧全套充时长。

### 成果 F9：默认产品与同事可操作交接

实施范围：

- 将三包组件/API/局部样式和真实数据接入main默认原表面，不留“source已交、主线未挂”当整块完成。
- 指南说明实际配置保存、日常委托、原问题/检查/接受、历史来源/支持和unknown错误返回。
- 说明saved非验证、配置非native准入，source/controlled/installed/native/recovery/value各自诚实。
- 正式选定集成版本后D/E独立验安装，不以临时ZIP、组件数量或更多截图代理完整工程。

实际 consumer：

- 新同事通过同一actual App既有入口完成真实普通路径，main/F/A/C/G/H使用相同正式DTO和原对象。

必要正负：

- 必要strict/真实组成页/完整旅程与可操作指南齐，未到层列清且原业务权限不放宽。
- 缺模块/旧后端/失效数据/秘密与错误路径无隐式任务、原批准或自动接受。

Source 交接：

- 后期写 `reports/trial-experience/wave35-status.json`，九成果source/consumer/对象/命令/已合/余项齐。

## 独立备选队列与完成条件

- A/C新DTO或main接线未到：交typed组件/真实输入与复现，继续日常/状态/访问性，不伪造数据或直接fetch。
- 包一后继续包二/三；研究/B/private受阻只阻对应层，不整goal停等，不复制其他owner实现。
- 九成果均有生产组件、actual App consumer、必要正负与handoff，且进入main实际版本，才完成whole goal。
- owned仅trial src/test/e2e、user-guide、trial-experience；main掌RootHTTP/App/transport/锁/授权，A sole SQL迁移，E sole产品断言。
- 自动真实vendor/model/native0，B cap4 UNKNOWN/E原blocked pilot不reset/topup/refund/补样或价格研究。
- 保留十二服务与全部state/profile/tar/ledger/dirty/runs及六未跟踪截图；仅独立birth/全资源且逐次fresh可受信号。
- 无global discovery、借凭据、真实CLI回退、新Driver/CAC/桌面/自动接受/第二ledger或生命周期，不新建checkout/线程。
- CAC排除，不做临时ZIP冲刺；继承main已修Form，不把旧候选故障或未测层重新当已完成成果。
