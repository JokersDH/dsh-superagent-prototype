# R1 固定准确包（8296720）能力基线

日期：2026-11-15。F 只读核对，不修改 RC 字节、不启动用户实例。

## 包身份

| 项 | 值 |
| --- | --- |
| artifact | `/Users/hh/Desktop/joker/pa-artifacts/wave30-target/wave30-target-8296720.tar.gz` |
| source | `82ee5b8f1bc3e4b76233268fe61e4ebfd2f514b2` |
| build | `8296720d8a25f38c` |
| tar SHA256 | `04926739f491c34e9a093b2fc3edff2f85243e4a232af46c7a2430cf13687543` |
| bytes | 20,458,670 |
| entries | 6,849 |
| schema / Node / ABI / platform | 18 / 24.21.0 / 137 / darwin-arm64 |

## 包内 console bundle 实际字符串（只读 grep）

bundle：`install/app/apps/console/dist/assets/index-DTOhkXHZ.js`

| 能力 | 观察 |
| --- | --- |
| 试用准备导航/视图 | 存在（“试用准备”） |
| 使用观察 | 存在（“使用观察”“观察窗口”，bundle 含 `[7,30]` 控件） |
| 项目模板（J/0073/0077） | 存在（“配方草案”“打开原表单模板”“模板草稿”） |
| 观察导出（0080/WP-31 R2） | **不存在**（无 `/insights/export`、无 `导出当前范围观察`） |
| 主对话/原表单/待决定/交付 | 沿用原工作台 |

结论：R1 的日常入口包括 readiness、7/30 观察、模板建议→原表单；**导出是 R2 source 新增能力**，不得描述成 RC 已安装；本包不把 R2 的 source 通过贴到 RC。

## 本包对 R1 的处理

- 组件在缺少 `onDownloadInsights`（旧包/旧 transport）时不渲染导出按钮，观察行仍可读；这是 F5 的准确降级。
- 支持/诊断面板只显示 RC 派生事实（模式/启动方式/项目/对话/窗口/配置 revision/观察时间）；包/来源标签缺失时写“未提供/未声明”，不伪造 RC 版本。
- R1 的真实安装/用户流由 E 独立验证；F 的 RC 证据仅为 artifact 元数据与 bundle 字符串核对，未启动实例。

## R2 与 successor

- R2 source：main `303b2c6a`（0080 导出/runner 通道），本包 source consumer 已由其真实 App/transport 提供。
- R2 新 tar：`pa-artifacts/wave31-target/` 当前为空，D 尚未冻结准确 successor；因此 R2 的 **installed 验收 NOT_REACHED**，只记录 source/controlled 证据。
- 导出/模板/窗口的 source 验证见 main `usage-observation-browser` 13/13、`project-recipes-browser` 8/8 与本包 e2e。
