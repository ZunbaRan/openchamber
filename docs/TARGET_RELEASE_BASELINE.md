# P0 Target Release Baseline

> Status: frozen for execution
>
> Date: 2026-08-08
>
> Scope: upstream UI realignment with full OpenChamber fork-feature preservation

## Immutable target releases

| Repository | Official stable release | Commit | Source |
| --- | --- | --- | --- |
| OpenChamber | `v1.18.1` | `ce5192197b34aaa9501fffebe9d5e485d8d63507` | `openchamber/openchamber` GitHub Release, published 2026-08-04 |
| OpenCode | `v1.18.15` | `d7b115f623760e68a4749d16508a9eca350f246f` | `anomalyco/opencode` immutable GitHub Release, published 2026-08-07 |

The integration branches are rooted directly at these commits. Moving branches such as
`main`, `dev`, and `beta` are not migration inputs.

## Donor and rollback references

| Purpose | Reference |
| --- | --- |
| OpenChamber committed donor | `docs/interactive-ui-mcp-apps` at `870cc00cb471743795d2a8c9746247951e78f931` |
| Host Confirmation carry-forward donor | detached `7cc78008607d17e65210c62363f322f39d65677b` plus the uncommitted diff in `.worktrees/host-confirmation-integration` |
| OpenCode committed donor | `openchamber-apps` at `f263f908da3f71aa637ddb356328901b6ce231f2` |
| Existing OpenChamber integration branch | `integration/p0-upstream-ui-v1.18.1` |
| Existing OpenCode integration branch | `p0-opencode-realign` |

The donor branches and worktrees remain untouched. If the migration is rejected before
cutover, abandoning the new integration branches restores the previous product tree without
rewriting donor history.

## Current fork facts

- The committed OpenChamber donor reports version `1.17.1` and consumes
  `npm:@zunbaran/opencode-sdk@1.18.10-oc.1`.
- The OpenChamber donor differs from the target release in 1,079 files. This is evidence
  against broad revert/rebase and for feature-owned forward-porting.
- The OpenCode donor differs from the target release in 604 files. The fork contracts are
  concentrated in MCP Apps 2026, Generative Widget prompt/skill injection, capability
  provenance, HTTP enforcement, and release scripts.
- `459e27ad` and `999d4761` are ancestors of the committed OpenChamber donor. The Host
  Confirmation donor `7cc78008` is a descendant and therefore must be inventoried separately.
- The Host Confirmation worktree remains uncommitted and not merge-ready. Its three final
  review findings remain explicitly `SUSPENDED` and must not be silently repaired or dropped
  during P0.

## Clean upstream verification

### OpenChamber `v1.18.1`

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | passed with Bun 1.3.14 |
| `bun run type-check` | passed for all workspaces |
| `bun run lint` | passed for all workspaces |
| `bun run build:web` | passed; existing KaTeX resolution and chunk-size warnings only |
| `bun run build:electron` | passed; upstream script is an intentional no-op build gate |

### OpenCode `v1.18.15`

| Check | Result |
| --- | --- |
| `bun install --frozen-lockfile` | passed with Bun 1.3.14 |
| `packages/opencode: bun run typecheck` | passed |
| `packages/opencode: bun run build` | passed after allowing access to `models.dev`; Darwin smoke test passed |
| `bun run lint` | baseline failure: 4,846 warnings and one error in `packages/session-ui/src/v2/components/prompt-input/index.tsx:163` for deprecated legacy octal syntax |

The OpenCode lint error is outside the fork migration ownership and exists on the exact
release tag. P0 acceptance therefore requires no new lint errors in changed files and must
continue to record this baseline failure; Pi must not repair the unrelated upstream file.

The OpenCode build populated registry URLs in `bun.lock` because of the local npm mirror.
That generated-only mutation was restored to the exact release-tag file after the successful
build and is not part of the migration.

## Phase gates

1. A Pi lane may start only for an existing `READY` issue in the consuming repository's
   root `issues.md`.
2. Feature-owned modules are forward-ported; upstream-owned UI files start from the target
   release and receive only narrow adapters.
3. A lane is accepted only from host-observed diff evidence and primary reruns, not Pi prose.
4. Accepted patches are applied to the dedicated integration worktree in dependency order.
5. Every accepted/aborted Pi lane is cleaned promptly after its immutable diff and evidence
   are integrated or explicitly preserved.
6. No push, PR, merge, or donor-branch cutover is part of Phase 0.
