# macOS 0.1.1：启动修复与安装交付

2026-11-21。针对用户报告的中文Terminal启动失败，交付M系列Mac的DMG和应用内离线产品手册。本次不新开工程wave，不发送模型任务，原M03完成汇总和预算记录保持原样。

## 安装与使用

- DMG：[Personal-Agent-0.1.1-arm64.dmg](/Users/hh/Desktop/joker/pa-artifacts/macos-0.1.1-e561bae/Personal-Agent-0.1.1-arm64.dmg)。约98.3MB。
- 使用：[产品使用手册](../PRODUCT-GUIDE.zh-CN.md)。安装、功能、首次配置、项目导入、委托、补充指令、审批、停止、patch接受和排查均在这一份文档中。
- 打开DMG，将Personal Agent.app拖到Applications，再从“应用程序”打开。窗口提供“打开工作台”“停止服务”“使用手册”“日志”。
- Node已内置；开发任务需要本机Git和自己的已登录Codex CLI0.164.0。macOS14及以上，Apple Silicon。应用采用ad-hoc签名，尚未Developer ID签名或公证，首次打开可能需在系统设置确认。
- 新数据根为`~/Library/Application Support/PersonalAgent/Desktop/`。旧Preview数据和运行实例保留，不自动迁移、停止或接管。分享DMG不含账号、Key或工作记录。

## 原因与修复

原记录`Fri Nov 20 16:19:06 2026`和中文观测`五 11月/20 16:19:06 2026`表示同一进程的同一启动时间，旧代码逐字比较，错误返回UNVERIFIED。

修复将精确PID的出生时间观测固定在C语言环境；严格解析旧中英文记录，核对日期、星期和秒级时间。不同出生时间、无法识别的格式和其他进程身份不放行。PID/UID、完整argv、cwd、安装身份、监听端口与健康检查仍保留。停止与升级使用相同的严格等价比较。

重复解压路径另有处理：只有原status完整核实、版本相同且入口相容时，打开原工作台；不创建第二个writer，不改原实例身份记录。桌面应用从稳定安装位置调用原CLI，不另建执行内核或生命周期。

## 准确产物

| 项目 | 身份 |
| --- | --- |
| 版本 | 0.1.1 / darwin-arm64 / macOS14+ |
| 产品源码 | `9cb4bb0097f7fb1ef42f54262ba683e515cc7219` |
| buildId | `e561bae3a0747acb` |
| Node | 24.21.0 / ABI137；原二进制未因应用签名改变 |
| DMG SHA256 | `702aaa52cfe6ffe4dd0c3a9f2f27005d8c6aaa895561e8893f0ae90df473c96d` |
| 内部tar SHA256 | `e7a16fc3969b9c9fbf510c52dbc15bacc78424bd214ff952f8bf9ce9c1ac3c8f` |
| 外层ZIP SHA256 | `1beefb34f72d5cc43dc9a0356714bc44d2f510923a22c1763e65453f718d476c` |

外层验证器后续只增加完整清单内的两份产品手册白名单，打包器补充错误输出；不改变已冻结引擎。DMG构建记录与SHA256SUMS保存在同一产物目录，构建工具及产品手册保存在仓库。

## 实际验证与边界

- 修复前同PID的中英文观测相等断言实际失败；修复后通过。新locale回归7/7，连同既有身份测试12/12，local-operations12/12，请求范围/升级身份/升级资源9/9。
- 针对用户原PID15710做只读身份核对，两个出生时间检查通过、整体VERIFIED；没有改记录或结束旧实例。
- 新预览完整字节清单、内嵌Node和应用签名验证通过，验证器自身10/10；DMG校验、只读挂载、从盘中复制.app成功。
- 在独立HOME/CODEX_HOME、中文locale、未配置模型和未登录执行器的实例，原生应用实际显示“工作台已就绪”；工作台可读，工作数0，配置入口可用，执行明确禁用，不回退fixture。
- 实际点击“停止服务”确认STOPPED，再点“打开工作台”重新启动，所有status身份检查通过。带空格及“2”的第二份.app打开同一个URL/PID，原instance.json字节不变。
- 实际点击“使用手册”在浏览器打开包内HTML，九个目录项和正文可读。菜单退出后应用exit0、原CLI status=STOPPED；测试库ticket/works/command_receipts/assistant_reply_results均为0。

这是新包的零模型安装与启动验证。真实开发、审批、steer、停止和两项目交付的已有证据仍属于M03原冻结包，不改写为本DMG的全流程复验。跨机与长期稳定性仍未认证，85/100与完整B65.3%不因封装自动提高。十二个用户实例及其状态未操作。

构建脚本：`tools/bootstrap/package-macos-app.mjs`；Swift入口：`tools/bootstrap/macos-app/Launcher.swift`；产品手册源：`docs/PRODUCT-GUIDE.zh-CN.md`。
