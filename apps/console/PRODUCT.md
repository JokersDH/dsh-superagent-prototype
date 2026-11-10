# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The owner is developing a personal coding assistant for sustained daily use. The next audience is internal developers trying the product on their own machines. A future standalone application is planned; shared multi-user hosting has not been approved as an existing capability.

## Product Purpose

Bring requirement discussion, explicit coding delegation, agent questions, verified changes and human acceptance into one workspace. Success means a developer can move a real local project from a request to an inspectable, verified patch, understand a blockage, and reopen without accidentally executing the task twice.

## Operating Context

The user confirmed on 2026-11-10 that the main conversation is the primary screen. Projects, tasks and deliveries should expand around it. The application is currently a browser console connected to a local coordinator and independent per-attempt Runner. Users work with local Git projects and existing agent accounts.

## Capabilities and Constraints

- Real Codex 0.164.0 has passed a scoped macOS arm64 product workflow, including a normal pnpm single-package project prepared from an authorized offline cache.
- Main dialogue is streamed; execution requires explicit delegation. Ordinary messages do not authorize coding.
- Ticket/Assignment own execution lifecycle. UI state comes from the application projection, not a second client-side execution engine.
- Questions and answers retain native request and attempt identities. Candidate completion requires current verification and any required human acceptance.
- Delivery is an isolated worktree and full patch. Acceptance does not merge, deploy, push or overwrite the original project.
- The user's priority is UI and missing product capabilities first, portable internal trials next, then CAC integration. CAC, other harnesses and a desktop shell are planned, not already available.
- Credentials, native profiles, databases and user workspaces must not enter source control or client responses.

## Brand Commitments

The current product is named "个人 Agent 工作台". The user requires a simple, refined, premium-feeling work interface and previously selected a professional light workspace. The voice is clear Chinese with concrete actions and honest status. No new brand name or commercial claims have been approved.

## Evidence on Hand

- `../../reports/releases/environment-mvp/integration.json`: latest scoped implementation and validation.
- `../../reports/releases/environment-mvp/browser/`: real screenshots, first failed run, resumed candidate and final clean-commit native acceptance.
- `../../product-spec/`: product architecture and staged acceptance requirements; these requirements are not all implemented.
- Existing React interface, lucide icon library, public transport schemas and controlled fixture workflow are reusable assets.

## Product Principles

1. Keep discussion, authorization and verified completion distinct.
2. Keep the main conversation useful while revealing operational detail on demand.
3. Make the next valid action and every blockage understandable.
4. Preserve user projects and account boundaries across retries, restarts and installation.
5. Measure actual workflows and capability limits before making compatibility claims.

## Open Decisions

The desktop packaging framework, supported operating-system matrix beyond measured macOS, and any future remote-team deployment remain open until the portability work supplies evidence.
