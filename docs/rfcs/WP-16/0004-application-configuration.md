# Application Configuration Read Interface

Date: 2026-11-09. Owner: main agent. Base: `4ecb4c5`. Status: implemented; native Catalog admission and browser integration remain separate.

## Purpose

The console needs a project grant, selectable execution profiles and registered checks to construct a valid `create_work`. Hard-coded `profile-codex-local` and unit-check IDs do not describe the controlled product entry. `GET /v1/configuration` supplies these values from the same trusted startup configuration used by application dispatch.

The query is authenticated by the existing local session/bearer middleware. It accepts no query parameters and has `Cache-Control: no-store`. It performs no native probe, model call, command dispatch, database write or credential read.

## Contract

Import `ApplicationConfigurationSchema` and `ApplicationConfiguration` from `@personal-agent/contracts`.

| Field | Meaning |
| --- | --- |
| `protocol` | Exactly `application-configuration/1` |
| `revision` | Digest of the public configuration projection; opaque refresh identity, never a grant or action token |
| `projects[].id`, `displayName`, `scope` | Configured project and supported initial scope; no absolute project filesystem path |
| `projects[].profileIds` | Profiles admitted by the trusted runtime for this project |
| `projects[].defaultProfileId` | Initial selection when the project allows dispatch |
| `projects[].defaultCriteria` | Structured initial criteria; each named machine check must be registered |
| `projects[].dispatchAllowed`, `blockedReason` | Derived availability, including expired scope; backend revalidates every actual command |
| `profiles[].id`, `revision`, `displayName`, `driverId` | Safe public profile identity, excluding executable/argv/native config/account references |
| `profiles[].kind` | `controlled_fixture` or `native`; a fixture never appears as a tested vendor |
| `profiles[].readiness` | `fixture_ready`, `not_tested`, or the existing probe readiness values |
| `profiles[].dispatchAllowed`, `blockedReason` | Runtime admission; native inspection alone does not permit dispatch |
| `checks[].id`, `revision`, `displayName` | Operator-registered checks; no shell commands, argv or environment values |

Collections are bounded to 128 entries and require unique IDs. Project scopes/defaults, profile references, check references and readiness/admission combinations are validated by the shared runtime parser. Structural JSON Schema validation alone does not prove these cross-field rules.

The controlled composition narrows its configured project grants to the supported fixed `src/` scope. An unsupported exclusion or grant is refused at construction. The same narrowed scope feeds both ApplicationService and the configuration projection; the UI cannot advertise a broader fixture operation that the execution consumer would subsequently park.

## Versioning

This is an additive, independently versioned HTTP read resource. It is defined in `packages/contracts/src/configuration.ts` and does not alter `Snapshot`, `UserCommand`, `ApplicationService`, `AgentDriverV1`, critical facts or the existing frozen wire schema.

The frozen runtime identity remains `1.0.0`, API major 1, hash `74ffd32d8eed4e88d8d4fdd98f6e84c3bf449a785f2c76ccffee56c0538ffa3d`. The existing generator additionally emits `generated/configuration.schema.json` and `generated/configuration.manifest.json`. The latter records the configuration source/schema hashes and its runtime-schema dependency. `check:generated` verifies both sets of artifacts. Old v1 clients remain covered by the frozen consumer fixture.

## Consumer Instructions

- **Agent A:** After successful session bootstrap, fetch `/v1/configuration` through the normal authenticated transport. Initialize the project/profile/scope/criteria controls from it. Filter by `dispatchAllowed`; preserve the profile attached to a running work. On load/parse failure disable new delegation and show the transport error; use the isolated fixture adapter only in fixture mode. Keep conversation/draft values when refreshing configuration. A metadata refresh does not authorize switching an existing work's executor.
- **Agent B:** The main-owned `ConfigurationSource` adapter can project accepted Catalog entries into this safe view. Keep draft, missing, unverified, inspection-only and tested-native states distinct. A tested profile still needs explicit trusted runtime admission; do not copy raw `AgentProfile`, `ProbeReport` or native diagnostics into the HTTP response. The current controlled entry lists only its four admitted fixture profiles. It does not claim that the committed B Catalog/native candidates are production-ready.
- **Main:** `LocalHttpOptions.read.configuration` is the HTTP injection port. `createControlledProduct().read` supplies it. Application startup arrays/principal are copied so later mutation by a caller cannot expand a profile/check/actor grant. Actual authorization remains in application/core and the physical write guards.

The older queue-only HTTP sandbox intentionally has no configuration port and returns `unsupported_capability`. It must not supply a fake Catalog readiness result.

## Validation

`pnpm check:g2-product` now runs 188 contract cases plus 140 application/recovery/workspace/verification/product/configuration cases (328 total, overlapping scope labels are not percentages). Newly added coverage is five configuration-contract cases, five HTTP/projection cases and one immutable-startup-authorization case. Existing product HTTP acceptance now constructs its command from the actual configuration resource and checks a broader fixture scope is refused.

Real loopback smoke:

```sh
pnpm --filter @personal-agent/coordinator dev:product --port 8793 --state /absolute/private/state
node tools/bootstrap/smoke-product-api.mjs --url http://127.0.0.1:8793 --state /absolute/private/state
```

The smoke fetches configuration, refuses to choose a vendor profile, uses the returned defaults, answers the original native question, reads verification/artifacts and accepts the current candidate. Browser integration, installed vendors and authenticated independent Runner reconnect retain their separate gates.
