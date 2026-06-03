---
name: test-coverage-workflow
description: Run, measure, and raise test coverage for the Ghost monorepo (unit, integration, e2e-style server tests). Use this skill whenever the task involves writing or running tests, checking or improving code coverage, picking the right test command/scope for a package, interpreting c8/Nx output, or deciding which coverage thresholds a change must meet. Applies to ghost/core (mocha + c8) and to Nx workspace packages run via `pnpm test`/`pnpm test:unit`.
---

# Test Coverage Workflow

## Overview

This monorepo runs tests two different ways depending on where the code lives. Pick the right runner first, then scope the run as narrowly as possible while iterating, and only widen to the full suite for final verification.

## Decision tree: which runner?

- **Code in `ghost/core`** → mocha-based suites with `c8` coverage. Run from `ghost/core`.
- **Code in another workspace package** (`ghost/*`, `apps/*`) → Nx targets: `pnpm nx run <project>:test:unit` or workspace-wide `pnpm test:unit` (Nx caches results, so unchanged projects are skipped).
- **Browser end-to-end behaviour** → use the `ghost-e2e-validation` skill (Playwright in `e2e/`); that is a different stack from the mocha "e2e-*" suites in core.

## ghost/core test commands

Run all from inside `ghost/core`:

| Goal | Command |
| --- | --- |
| Single file or pattern (fastest loop) | `pnpm test:single <file-or-substring>` |
| Unit tests | `pnpm test:unit` |
| Integration tests (DB-backed) | `pnpm test:integration` |
| Server e2e (`test/e2e-*`) | `pnpm test:e2e` |
| Legacy suite | `pnpm test:legacy` |
| Everything + lint | `pnpm test:all` |
| Find slow tests | `pnpm test:unit:slow` / `test:int:slow` / `test:e2e:slow` |

`pnpm test:single` accepts either a path or a bare substring of the test name; it sets a 60s timeout automatically.

## Coverage

`ghost/core` wraps suites in `c8`. Coverage is produced automatically by `pnpm test:unit` (which is `c8 pnpm test:unit:base`). For CI-equivalent runs with enforced thresholds use the `test:ci:*` scripts. Current enforced thresholds (from `test:ci:integration`):

- lines ≥ 52, functions ≥ 47, branches ≥ 73, statements ≥ 52

When adding code, run the relevant `test:ci:*` script locally before pushing so you fail fast on the same thresholds CI uses. c8 config lives in `ghost/core/.c8rc*.json`; reports land in `coverage*/`. Open `coverage/lcov-report/index.html` to see uncovered lines.

## Workflow for raising coverage

1. Identify the file under-covered (c8 report or the CI failure message naming the metric).
2. Run only that file's test with `pnpm test:single <file>` while writing cases.
3. Cover the missed branches first (branches has the strictest threshold here).
4. Re-run the matching `test:ci:*` script to confirm thresholds pass.
5. Final check: `pnpm test:unit` (or `pnpm test:all` for a full pass) before handing off.

## Workspace-wide (Nx)

- `pnpm test` / `pnpm test:unit` run across all projects via `nx run-many` with `parallel: 4` and caching (`.nxcache`).
- Use Nx affected to test only what a change touches: `pnpm nx affected -t test:unit`.
- A cached PASS means the project is unchanged — force a real run with `--skip-nx-cache` when you suspect a stale result.

## Rules

- Never lower a coverage threshold to make CI pass — add tests instead.
- Always scope down (`test:single` / affected) while iterating; only run the full suite for final verification.
- Don't add `.only` / `.skip` and commit it; CI lint will not catch a forgotten `.skip`.
