# Wave-20 A recipe: explicit personal readonly over real business data

A owns `packages/storage`/`packages/workflows`; main owns contracts/HTTP/UI/CLI. This recipe does not
grant execution, private startup permission or target activation.

## Format and schema

- Default `readWorkflowEvidence`/`create` is workflow **v1** (13-family historical recipe); only explicit
  `formatVersion:2` writes workflow-v2 (21 families, `familySetVersion:2`).
- Both formats retain non-null/safe-integer/≥1 schema, required tables/indexes and unknown-table
  checks. Mixed versions, subsets, duplicates, future versions and a v1 label downgrade are blocked.
- Genuine old producer compatibility: `probe-wave18-context.mjs` (2/2) and
  `wave19-golden.case.ts`/`wave19-unified-data.case.ts`.

## Real business + personal readonly chain

```sh
node --test packages/workflows/test/wave20-personal-business.case.ts
node --test tests/integration/restored-personal-review.case.mjs
```

`wave20-personal-business`:
1. actual controlled Application/Effects/Broker/fixture Runner creates Work/Ticket/question/answer and
   `native_applied` delivery with dispatch receipts;
2. the same Store receives local SDK chat/candidate and real HTTP context prepare/send;
3. a v1 snapshot is copied to a second root, marker + private credentials are created there;
4. explicit `tools/dev/review-restored.mjs --state <restored> --project ... --allow-path src/ --output`
   produces a 600 startup config;
5. actual `apps/coordinator/product/demo.ts --discussion-only --assistant --review-restored-scope`
   starts personal `recovery_readonly`; candidate GET, history and frozen sources are 200;
6. `/v1/snapshot?workId` reads the real Work, `/v1/questions/:id/deliveries` shows native_applied;
7. business `answer_question` is 422, held queue remains, provider request count is unchanged; the
   restored Store still has the original Work/answer/delivery.

Main `restored-personal-review` covers 403 before explicit selection, source/root/principal/host/key
mismatch, expiry, unsafe paths/files, FIFO/symlink, and the 600 private config load. It is explicit
startup consent, not an executable grant.

## D/E inputs and negatives

- D may call the CLI with its actual restored state/project/paths; the config is a 600 private file,
  five-minute startup-use window, never copied credentials or automatic discovery.
- E negatives: missing artifact/table/index, mixed v1/v2, subset/duplicate/future version, reduced
  scope, foreign principal/root, expired file, unsafe file type; restored data never refreshes source
  or private permission.
- default workflow-v1/v2 is distinct from portability personal-evidence 1/2.

Exact source/commands/exits: `packages/workflows/reports/wave20-status.json`.
