import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { tasks, sharedReadOnly, sharedForbidden } from './task-source.mjs';
import { cases } from './acceptance-source.mjs';
import { chapters } from './spec-structure.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = new Map(cases.map(item => [item.id, item]));
const renderList = items => items.map(item => `- ${item}`).join('\n');
const asCodeList = items => items.map(item => `- \`${item}\``).join('\n');
const packages = tasks.map(task => ({
  ...task,
  ownedPaths: [...task.ownedPaths, `docs/rfcs/${task.id}/`],
  status: 'PLANNED',
  readOnlyPaths: [...new Set([...sharedReadOnly, ...task.readOnlyPaths])].filter(path => !task.ownedPaths.includes(path)),
  forbiddenPaths: [...sharedForbidden, ...task.forbiddenPaths]
}));

writeFileSync(resolve(root, 'work-packages.json'), JSON.stringify({
  schemaVersion: 1, designVersion: 'B-1.0-draft', asOf: '2026-11-07',
  pathBase: 'repository root of JokersDH/dsh-superagent-prototype unless explicitly marked as an optional external reference',
  statusMeaning: 'PLANNED is specification only; no production module is implemented by this artifact',
  packages
}, null, 2) + '\n');
writeFileSync(resolve(root, 'acceptance-catalog.json'), JSON.stringify({
  schemaVersion: 1, asOf: '2026-11-07',
  statusMeaning: 'All cases are NOT_TESTED implementation requirements. Static spec verification is separate.',
  cases
}, null, 2) + '\n');

mkdirSync(resolve(root, 'tasks'), { recursive: true });
for (const task of packages) {
  const requirements = task.acceptanceIds.map(id => {
    const item = catalog.get(id);
    if (!item) throw new Error(`${task.id}: unknown ${id}`);
    return `| ${id} | ${item.layer} | ${item.expected} |`;
  }).join('\n');
  const prompt = [
    `请实现个人 Agent 助理方案 B 的 ${task.id}：${task.title}。`,
    '方案 B 是本地独立 coordinator，首批目标 ZCode / DeepSeek Harness / Codex，CAC 后接。优先复用 superagent core；Ticket/Assignment 是唯一执行生命周期，Work 仅身份/合同索引和投影。',
    '先读 product-spec/README.md、03-contracts-and-data.zh-CN.md、08-multi-agent-development.zh-CN.md、本任务包和相关专题，并核对实际 contracts release/hash。不要把设计草案当已实现 API。',
    `开始前置：${task.startAfter.join(', ') || '无'}；最终验收前置：${task.acceptAfter.join(', ') || '无'}。fixture 开发不代表 native 兼容，mock 通过不代表产品完成。`,
    `仅拥有：${task.ownedPaths.join(', ')}。共享契约、DB 迁移、根 lockfile 和其他模块只由对应 owner 改；变更需求先 RFC，除本包明确拥有的部分。`,
    `对外 interface：${task.interface}`,
    ...task.steps.map((step, i) => `${i + 1}. ${step}`),
    `使用 mock：${task.mocks.join('；')}。`,
    `交付：${task.deliverables.join('；')}。`,
    `验收：${task.acceptanceIds.join(', ')}；按 catalog 的 Given/When/Expected/Evidence 执行，报告 PASS/FAIL/SKIPPED/NOT_TESTED。`,
    '禁止读取/复制私有凭据、reset 用户原生 profile/原工作区、盲目重试 unknown native send、把 prompt 当权限强制、以旧报告完成新候选、模型伪造 human 授权。',
    task.notes,
    '先检查工作区已有改动并保留。只运行本包合理范围的测试；真实付费 native smoke 使用明确的 scratch 项目和预算。完成报告包括 commit/contractsHash、路径、interface、实际命令、caseId->evidence、原生兼容限制、未决 RFC 和下游步骤。'
  ].join('\n\n');
  const text = `# ${task.id} ${task.title}

生成自 [任务源](../tools/task-source.mjs)。状态 PLANNED；本包是开发指令，不是实现报告。

## 目标与阶段

${task.interface}

目标 gate：${task.gate}。估算：${task.effort}。估算不是交付承诺。

开始前：${task.startAfter.join(', ') || '无'}。最终接受前：${task.acceptAfter.join(', ') || '无'}。

startAfter 约束共同基线；acceptAfter 约束真实集成。上游未接受时只能用冻结 fixture，报告不能冒充运行验收。WP-16 可按 gate 分段集成。

## 必读输入

- [产品总览](../README.md)
- [契约与数据](../03-contracts-and-data.zh-CN.md)
- [运行时](../04-agent-runtime-and-extension.zh-CN.md)
- [可靠性](../05-reliability-and-operations.zh-CN.md)
- [实施验收](../07-implementation-and-acceptance.zh-CN.md)
- [多 Agent 开发规则](../08-multi-agent-development.zh-CN.md)
- [公共类型候选](../contracts/contracts.ts) 与 G0 实际冻结的 contracts release/hash

## 路径所有权

下列实现路径相对于用户 fork 的仓库根目录；原 superagent/CAC 源文件仅为标明的只读输入。新代码位于本仓 packages/apps/tools，位置说明见根 START-HERE.zh-CN.md。不能自行扩大路径权限。

Read-only 的父目录若包含本包明确列出的 owned 子路径，仅该 owned 子路径可编辑；其余仍只读。RFC 只写本包的 docs/rfcs/WP-XX/ 目录。

Owned：

${asCodeList(task.ownedPaths)}

Read-only：

${asCodeList(task.readOnlyPaths)}

Forbidden：

${asCodeList(task.forbiddenPaths)}

## 实施步骤

${task.steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}

## Mock 与测试依赖

${renderList(task.mocks)}

测试通过公共 interface，不 import 下游私有 implementation。每条 native 报告固定产品/Driver/SDK/schema/config/权限/OS 身份，未知或未测不填 PASS。

## 验收与证据

完整 Given/When 与证据要求见 [验收目录](../acceptance-catalog.json)。本包负责自己的适用断言；跨包场景由 owner 提供材料，集成人最终执行。

| ID | 层次 | 必须观察到的结果 |
| --- | --- | --- |
${requirements}

每次报告保存 caseId、实际命令、commit/contractsHash、版本与输入、结果、evidence 路径、费用/限制。所需能力若未测或失败，不能宣布稳定支持；可以提交明确受限的 spike 结果供决策。

## 交付物

${renderList(task.deliverables)}

${task.notes}

共享语义不足时写 RFC：具体失败场景、最小 fixture、拟议变更、兼容/迁移/恢复影响和验收 ID。不得复制私有 types、额外任务引擎或私有 DB writer。

## 可复制派工指令

\`\`\`text
${prompt}
\`\`\`

## 交接检查

- 只改 owned paths，保留用户既有修改。
- 提供公开 interface、配置/调用样例与冻结 fixture。
- 列出实际执行命令和所有失败/未测，不以 catalog 条目当已跑测试。
- 说明与 acceptAfter 下游的集成步骤、风险和未决 RFC。
`;
  writeFileSync(resolve(root, 'tasks', `${task.id}.md`), text);
}

writeFileSync(resolve(root, 'tasks/README.md'), `# 可独立派发的实现任务包

17 个包，按 [多 Agent 开发规则](../08-multi-agent-development.zh-CN.md) 派发。先 WP-00，通过 G0 后再并行；各包的最后一节包含可复制指令。无需把整个对话历史给实现 agent。

| 包 | 任务 | Gate | startAfter | acceptAfter |
| --- | --- | --- | --- | --- |
${packages.map(t => `| [${t.id}](${t.id}.md) | ${t.title} | ${t.gate} | ${t.startAfter.join(', ') || '无'} | ${t.acceptAfter.join(', ') || '无'} |`).join('\n')}

公共契约只有 WP-00 可改，core 规则只有 WP-01 可改，迁移只有 WP-02 可改，根 lock/组合根只有 WP-16 可改。模块 owner 可提出 RFC。WP-16 的最终 acceptAfter 是 G4 汇总依赖，G1/G2/G3 按阶段增量接受。

任务源为 [task-source.mjs](../tools/task-source.mjs)，验收源为 [acceptance-source.mjs](../tools/acceptance-source.mjs)。修改源后执行 \`node product-spec/tools/generate-spec.mjs\` 和规格校验；不要单改生成结果造成漂移。
`);

const full = ['# 个人 Agent 助理方案 B：完整阅读版',
  '生成日期：2026-11-07。此文件合并总览和九个专题，方便连续阅读；拆分实施请使用 [任务包索引](tasks/README.md)。当前是设计基线，尚未实现或通过 native 验收。',
  readFileSync(resolve(root, 'README.md'), 'utf8'),
  ...chapters.map(name => readFileSync(resolve(root, name), 'utf8'))
].join('\n\n---\n\n');
writeFileSync(resolve(root, 'FULL-BLUEPRINT.zh-CN.md'), full);
console.log(`Generated ${packages.length} task packets, ${cases.length} acceptance requirements, JSON catalogs and full blueprint.`);
