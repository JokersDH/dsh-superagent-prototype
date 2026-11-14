# 项目配方 → 现有确认流程：接线说明（main / F）

面向 main 的 App/HTTP 组合与 F 的体验组件。这里只给**已验证可编译**的数据与调用方式，不新增端点、不改 `App.tsx`、不碰 transport。

## 1. 依赖与构建

```sh
pnpm --dir packages/contracts build            # 已存在依赖
pnpm --dir packages/project-recipes build      # 产出 dist/index.js 与 .d.ts
```

root 的 `pnpm-workspace.yaml` 已用 `packages/*` 覆盖本包；`pnpm-lock.yaml` 由一个 importer 组成，**由 main 运行 `pnpm install` 写入**（J 不改根 lock / deps）。需要新增的 importer：

```yaml
  packages/project-recipes:
    dependencies:
      '@personal-agent/contracts':
        specifier: workspace:*
        version: link:../contracts
      zod:
        specifier: 4.4.3
        version: 4.4.3
    devDependencies:
      '@types/node':
        specifier: 24.10.0
        version: 24.10.0
      typescript:
        specifier: 6.0.3
        version: 6.0.3
```

## 2. 服务端（main）：从草稿到命令候选

```ts
import {
  matchRecipe, parseProjectRecipeDraft, previewInputs, toCreateWorkCommand,
} from '@personal-agent/project-recipes'

// 1) 生成：facts 优先复用已有公开观察，配置用当前 ApplicationConfiguration 投影
const raw = matchRecipe({
  facts,                          // 见第 4 节事实来源
  configuration,
  kind: body.kind,                // 'regression_fix' | 'scoped_change' | 'verification_followup'
  selection: { paths: body.paths },   // 用户显式选择
  now: new Date().toISOString(),
})

// 2) 校验并落成预览数据；needs_input / unsupported 直接回给 UI 解释
const draft = parseProjectRecipeDraft(raw)
if (draft.status !== 'draft') return reply(draft)   // 不要替用户猜 profile/路径

// 3) 过期保护：配置或观察变化后必须重新生成
const fields = previewInputs(draft, { configuration, facts })

// 4) 交给原有确认流程：commandId/conversationId 由应用会话提供，
//    之后仍走既有授权、预览、用户明确确认与执行
const command = toCreateWorkCommand(draft, { commandId, conversationId })
```

要点：

- `toCreateWorkCommand` 的返回对象**已通过 `UserCommandSchema` 校验**；`projectId === scope.projectId`，`profileId` 来自项目已启用 profile。
- 不要把 `fields` 直接当作已确认：它没有 token、actor、批准状态；草稿成功 ≠ 可执行。
- 若产品要求“模型提案”路径（`ProposalPrepare`/`ProposalPreview`），那需要真实 `sourceMessageId` 与模型来源，不能用配方伪造。
- 拒绝状态请把 `needsInput[].code/field/message` 原样展示或映射成 UI 文案；`unsupported` 不要静默降级到 fixture/其他 agent。

## 3. 前端（F）：表单预填

`CreateWorkFields` 是稳定数据结构，可直接映射到既有委托表单：

```ts
const fields = previewInputs(draft, { configuration, facts })
form.goal.value = fields.goal
form.scope.allowedPaths = fields.scope.allowedPaths   // 项目相对路径
form.scope.excludedPaths = fields.scope.excludedPaths
form.criteria.selected = fields.criteria.map((criterion) => criterion.id)
form.profile.selected = fields.profileId
```

- 用户仍可编辑；提交走原有创建/确认动作。
- 展示时请标明来源：`recipe.id@version` 与 `provenance.facts.observedAt`，以及 `authorization: "none"`。
- `notes[]` 是给用户的解释（例如「未观察到 packageManager 声明」），不是授权。
- 输入过期（`PreviewError: stale_inputs`）时不要提交，提示重新生成。

## 4. 事实来源

优先注入已有观察：

```ts
import type { ProjectFacts } from '@personal-agent/project-recipes'

const facts: ProjectFacts = {
  protocol: 'project-facts/1',
  projectId,
  observedAt: new Date().toISOString(),
  provenance: { source: 'injected', provider: 'coordinator-project-settings/1', authority: 'none', scope: 'package', inputs: [] },
  stack: { kind: 'node', packageManagerField, enginesNode },
  manager: { kind: 'pnpm', declaredVersion },
  locks: [{ name: 'pnpm-lock.yaml', digest }],
  workspace: { declaration: 'none' },
  scripts: ['build', 'test'],           // 只有名字
  languages: ['node', 'typescript'],
  missing: [],
}
```

没有现成观察时用只读 CLI/读取器（不执行项目、不读 home）：

```sh
node tools/project-recipes/cli.ts --config <config.json> --root <绝对项目根> --project <id> --paths src --now <ISO>
```

## 5. 已消费与未消费

| 项 | 状态 |
| --- | --- |
| 纯库 `matchRecipe` / 结果 schema / revision 校验 | 已实现并通过 35 项测试 |
| 只读 facts 读取器 + CLI（含退出码、拒绝边界） | 已实现并通过 20 项测试 |
| `create_work` 命令候选 + 过期保护 | 已实现并通过 6 项测试 |
| main 实际 HTTP/App 组合 | **未接**（由 main 完成，需要 root deps/lock） |
| F 实际表单呈现 | **未接**（F 消费 `CreateWorkFields`） |
| 模型提案路径复用 | 不适用：配方不是模型提案 |
| monorepo 成员枚举 / manager 版本探测 | 明确不做 |

草稿生成成功不代表环境已准备、检查已通过、任务已执行或可计费；这些仍由原有检查与人工确认决定。
