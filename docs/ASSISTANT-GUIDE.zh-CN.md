# 个人开发助手：使用指南

更新：2026-11-16。先读本页区分版本，再使用。[整体进度](product/STATUS.zh-CN.md) · [当前架构](product/ARCHITECTURE.zh-CN.md) · [创新现状](product/INNOVATION.zh-CN.md)。

这个助手把需求讨论、明确开发委托、Agent问题、检查、变更和人工接受放在一个工作台。**普通发送只讨论；确认委托才开始编码；接受交付不自动合并或push。**

## 先选对版本

| 入口 | 有什么 | 当前证据 |
| --- | --- | --- |
| 当前源码，产品303b2c6a | 流式对话、项目/工作/问题/来源/决定、模板、7/30观察、新JSON下载 | 干净源码受控网页13观察+8模板；历史Codex正常链另有实测 |
| R1安装包8296720 | 当前普通安装/启停、上下文/模板/窗口等；没有新观察下载 | E已独立测准确R1；普通/功能记录通过，两项目交付与Work重开结论须收窄 |
| R2安装候选4dcd28f | main303b2c6a时点的功能，包括新观察下载 | D完整包和受控开发验收；E尚无同R2独立结果 |
| 5180–5191历史实例 | 各自启动时的代码、独立会话与任务 | 保留不升级，不能因仓库更新就称它们是最新版 |

本轮A/C/F/G/J新分支不等于已进入当前main/R2。比如F的新支持面板、J迁移比对是候选能力，不能在旧包里找不到就当配置错。当前是个人受控试用阶段，尚未达到可给内部人员普遍分发的稳定Beta。

## 最短源码使用方式

在本仓、Node24/pnpm依赖已就绪时，另选一个私有state和空闲端口，避免复用旧5180实例：

```sh
cd /Users/hh/Desktop/joker/superagent
pnpm -r --workspace-concurrency=2 run build
pnpm start --discussion-only --port 5200 --api-port 8816 --state .local-state/manual-20261116
```

打开终端实际打印的网页地址，示例为http://127.0.0.1:5200/。端口被占用会拒绝，换空闲端口即可，不结束占用者。本段命令供你手动操作，本次文档验收没有执行启动。

仅对话模式适合先检查页面、模型连接和历史。要在同一个新state启用开发，先停止**这个指定实例**，再去掉discussion-only重开：

```sh
pnpm stop --state .local-state/manual-20261116
pnpm start --port 5200 --api-port 8816 --state .local-state/manual-20261116
pnpm doctor --state .local-state/manual-20261116
```

当前准入针对macOS arm64的Codex0.164.0。缺少Codex、版本不符或认证未就绪时，可以保留对话/审阅，开发委托会明确禁用；不会静默回退固定流程。不要通过改全局账号、强制放行或临时借用另一个Agent的凭据绕过。正常启动本身不发送模型任务。

## 使用安装包而不是开发仓

当前可优先个人试用的准确R1：

- tar：`/Users/hh/Desktop/joker/pa-artifacts/wave30-target/wave30-target-8296720.tar.gz`
- SHA256：`04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543`
- 平台：darwin/arm64；冻结环境Node24.21.0、ABI137、SQLite3.53.4。
- 解包后有`install/`，入口是`install/bin/pa`，不是解包根下直接的bin/pa。

先核对摘要，再解到新目录；五个私有root要在后续命令中保持一致：

```sh
shasum -a 256 /Users/hh/Desktop/joker/pa-artifacts/wave30-target/wave30-target-8296720.tar.gz
PA_TRIAL_EXTRACT=$(mktemp -d "$HOME/superagent-r1.XXXXXX")
tar -xzf /Users/hh/Desktop/joker/pa-artifacts/wave30-target/wave30-target-8296720.tar.gz -C "$PA_TRIAL_EXTRACT"
PA_TRIAL_BIN="$PA_TRIAL_EXTRACT/install/bin/pa"
PA_TRIAL_ROOT=$(mktemp -d "$HOME/.superagent-trial.XXXXXX")
export PA_CONFIG_ROOT="$PA_TRIAL_ROOT/config"
export PA_DATA_ROOT="$PA_TRIAL_ROOT/data"
export PA_CACHE_ROOT="$PA_TRIAL_ROOT/cache"
export PA_LOGS_ROOT="$PA_TRIAL_ROOT/logs"
export PA_WORKSPACE_ROOT="$PA_TRIAL_ROOT/workspaces"
export PA_MODEL_CONFIG="$PA_CONFIG_ROOT/model.json"
"$PA_TRIAL_BIN" first-run --json
"$PA_TRIAL_BIN" doctor --json
"$PA_TRIAL_BIN" start --discussion-only --port 5200 --api-port 8816 --open
"$PA_TRIAL_BIN" status --json
```

保存终端打印的安装/私有根位置，后续在同一环境调用`"$PA_TRIAL_BIN" stop --json`。新终端需重新设定同一bin和五个root，不能只传config-root就假定data等自动跟随。first-run在新配置下自动核对并接纳本包manifest，不需要强行adopt别的配置。

doctor可在仅对话范围DEGRADED：区分“开发执行器不可用”和“安装/ABI/状态身份阻断”。若start或stop报告BLOCKED/UNKNOWN，保留现场并查status/doctor，不删数据库、record或强杀未知进程。不要把示例根换成十二个旧实例的state。

R2新版下载候选位于`/Users/hh/Desktop/joker/pa-artifacts/wave31-target/wave31-target-4dcd28f.tar.gz`，SHA256为`405ecd02fcbf288bac0855e17911ec4035521b54fe27d81fa0b28feaf5addcc6`。需要新导出时可另开全新根个人试用，明确这是尚缺E同包独立验收的版本；不复用R1配置悄悄升级。其它机器/平台还需自己的安装和原生兼容验证。

## 对话模型怎么配置

主对话模型连接和Codex执行认证是两件事。主对话的私有配置默认`~/.config/superagent-personal/model.json`，也可用`PA_MODEL_CONFIG`选择新试用的文件。配置文件目录0700、文件0600。格式示例，实际key只放在本机私有文件：

```json
{
  "baseURL": "https://your-gateway.example/v1",
  "apiKey": "<your-private-key>",
  "model": "<configured-model-id>",
  "allowedModels": ["<configured-model-id>"],
  "allowInsecureHttp": false,
  "maxOutputTokens": 1024
}
```

对话网关是OpenAI兼容接口；如确实选择HTTP地址，需显式allowInsecureHttp且传输不加密。模型名以网关真实支持与allowedModels为准，不沿用旧手册中不一致的DeepSeek型号。

当前网页可切换已配置允许的模型、控制提案建议；**尚不是GUI任意编辑API key/Base URL的配置器**。没有配置模型也可启动/审阅，发送讨论时才会提示未配置。不要把key发进对话、提交Git或打包给同事。

开发执行器用本机Codex既有认证和工具循环，不会因为填了对话key就自动获得开发能力。ZCode、DeepSeek Harness、CAC尚非生产执行路径。

CAC已移出当前完整方案B的交付与验收范围，后续另做实验；当前使用和交付不需要安装或配置CAC。

## 第一次完成开发交付

1. 看“试用准备”和“执行器连接”，确认处于个人模式、开发执行器已准入；“固定流程”只证明测试流程，不是通用编码。
2. 导入有提交且工作树干净的本地Git仓库根目录，选择服务端注册的检查，例如node --test/pnpm test/npm test。首次试用建议无外部依赖的小Node项目。
3. 在主对话讨论需求，写好具体目标；点击“委托执行”，核对项目、执行器、允许/排除路径和验收标准，再明确创建。
4. 在“工作与交付”看执行进展，遇到问题到“待我决定”或工作详情回答。已记录、已写到原生、原生确认是不同状态。
5. 机器检查通过后看完整patch、检查输出和代码位置，确认满足目标，再“接受当前候选”。机器FAIL不能被人工接受绕过。
6. 下载patch，在原项目审阅和应用，再提交为下一轮基线。助手不会自动覆盖原仓库、merge、push或部署。

可用于小Node项目的明确委托：

> 增加src/slugify.mjs，导出slugify(text)：字母转小写，保留数字，连续其他字符合为连字符，去掉首尾连字符。补边界测试并用node --test验收，不新增依赖。

默认项目为`~/.local/share/superagent-personal/projects/starter`。自己的原仓库保留；实际修改在独立Git worktree，位置和基线从工作详情读取。不要将开发资源A–J工作目录误认为产品的十个运行时执行器。

## 项目模板、窗口与下载

在选定项目的“试用准备”查看当前三类建议。点击只进入原委托表单并预选；仍需重新预览、应用完整字段、编辑目标、明确创建。项目、检查、scope或元数据变了要重新预览，取消不会创建工作。建议不可用时可手工填表，不扩权限凑适用性。

“使用观察”选择7天或30天，沿当前项目范围读取。缺用量显示未知，header工作样本与每行样本/层/币种不同，不是节省人时或费用的证明。

main/R2中点击下载图标，会重新读取当前范围的新快照并下载JSON，不保证等于刚才屏幕上的旧快照。切项目/窗口/配置会取消旧下载，错误可重读后重试；R1无新download入口属版本差异。导出formatted值不反解析为数值、也不携带执行权限。

## 上下文、提案与项目决定

“上下文预览”选择项目和来源，填写本条消息、核对预算/遗漏/期限，确认发送后才调用模型。默认不扫描整个仓库正文，不自动把所有历史塞进提示。来源/合同/范围变化会拒绝并保留草稿，重新预览即可。

“使用记录”按项目/会话/工作筛选，查看当时保存的来源、截断和原文，返回原会话。后来的来源变化不会替换旧记录；缺失/无法核对/范围收窄明确显示。记录证明当时的输入选择，不证明模型一定正确使用了它。

模型设置可显式启用“提案建议”（默认关闭）。回复建议先预览，再确认创建/修订工作或记录决定；没有建议时仍可普通讨论或手工创建。建议是数据，不是授权；未知回执先核对原请求，不能另造新ID补发。

明确的“以后这个项目都这样”可以记录为带来源/范围/版本的项目决定，也可撤销/替代。临时mock、一次人工修改或Agent偏离不会自动学成长期规则；自动推广和研究收益尚未完成。

“待我决定”按当前可核对的等待、业务deadline和阻塞等规则集中排序。缺deadline保留未知，授权问题仍逐项确认，不是一键批准所有Agent。

## 依赖、故障与重开

普通单包pnpm可在项目导入时显式选择授权store离线准备；store根在项目外、已预热，不是原项目node_modules。准备不联网升级、不执行安装生命周期脚本；任意monorepo/npm离线安装尚未准入。检查和接受继续绑定当前依赖/环境。

关闭网页不终止后台工作；已交付记录/产物和持久回执可重开查看。**运行中协调器崩溃后完整接管同原Work仍未验通**：未知状态先核对，不点新任务代替旧任务，不假定看到Runner就可安全重发答案。恢复只读能看历史，不等于恢复执行。

备份/恢复用原CLI；示例均需换成自己这一实例的路径：

```sh
"$PA_TRIAL_BIN" backup --out /absolute/new-backup.pab
"$PA_TRIAL_BIN" verify-backup --bundle /absolute/new-backup.pab
"$PA_TRIAL_BIN" restore --bundle /absolute/new-backup.pab --to /absolute/new-restored-root
```

输出与目标必须新建，不覆盖活跃state。恢复不自动启动/消费旧队列/继承认证；必要路径重绑定、当前源审阅与新执行授权分开。不要沿用旧指南中的backup --output或restore --from。

遇到来源403、模板needs_input、检查失败、执行器版本不符时，保留具体状态并回当前配置核对。不要把一次未就绪预览和另一个fixture项目的成功工作拼成“原项目端到端通过”。

## 文档、支持与已知范围

顶栏“使用指南”可下载实例自带的手册；冻结包内手册可能较旧，以本页版本表及实际状态为准。F新候选支持面板尚未进入main/R2，不要求用户在现包寻找该新面板。

主线诊断：`pnpm doctor --state <自己的state>`。安装诊断：同五个root调用`pa status / doctor / support --out <新文件>`。摘要不等于完整日志，未知项不能当作零。不要为诊断删除state或杀别的实例。

目前支持的是受限个人开发试用，未证明全面原生控制、中途恢复、两真实项目完整重开、跨机长期稳定或创新收益。历史真实Codex正常成功路径见`reports/releases/native-mvp/`和`reports/releases/environment-mvp/`；它们不能认证本次新包的全部原生行为。

`check:native-product`、`check:native-browser`、`check:environment-native`会启动真实任务，不属于普通零模型回归。本次验收没有运行它们。
