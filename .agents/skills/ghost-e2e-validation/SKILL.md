---
name: ghost-e2e-validation
description: Write, run, and debug the Playwright end-to-end tests in the `e2e/` package against a running Ghost stack. Use this skill whenever the task involves browser/end-to-end testing, the Playwright suite, the `@tryghost/e2e` package, `playwright test`, bringing up e2e infrastructure (Postgres/Tinybird via docker), flaky e2e failures, or validating a user-facing flow end to end. This is distinct from the mocha `test/e2e-*` suites inside ghost/core.
---

# Ghost E2E Validation

## Overview

The `e2e/` package runs Playwright tests against a real Ghost instance backed by Postgres (the migrated DB) and, for analytics, Tinybird. Tests are split into Playwright projects: `main` and `analytics`. Always make sure infrastructure and the app are up before running, or every test will fail at navigation.

## Prerequisites

Before running any e2e test, the stack must be running. Two options:

1. **Full dev stack** (recommended while developing): `pnpm dev` from the repo root (Docker compose + apps via Nx).
2. **Infra only**: `pnpm --filter @tryghost/e2e infra:up` (and `infra:down` to tear down). This brings up the backing services the tests need (Postgres, etc.).

The package's `pretest` hook prints this reminder when `$CI` is unset.

## Running tests

Run from the repo root:

| Goal | Command |
| --- | --- |
| Main suite | `pnpm test:e2e` |
| Analytics suite | `pnpm test:e2e:analytics` |
| Everything | `pnpm test:e2e:all` |
| Debug a single test (headed, 60s) | `pnpm --filter @tryghost/e2e test:debug "<name pattern>"` |
| Single test by name | `pnpm --filter @tryghost/e2e test:single "<name pattern>"` |
| Verbose debug logging | `pnpm test:e2e:debug` (sets `DEBUG=@tryghost/e2e:*`) |

All test scripts go through `scripts/run-playwright-host.sh`, which wires up the host networking to the dockerized stack — call them via pnpm rather than invoking `playwright` directly.

## Writing tests

- Tests live under `e2e/` and use `@playwright/test` plus `@faker-js/faker` for data.
- DB access in tests/fixtures uses `knex` + `pg` (Postgres) — match existing fixture patterns rather than hand-rolling SQL.
- Type-check before running: `pnpm --filter @tryghost/e2e test:types` (alias `build:ts`).
- Lint: `pnpm --filter @tryghost/e2e lint`.

## Debugging flaky / failing tests

1. Confirm infra is actually up (`infra:up`) — most "instant" failures are a down stack, not a real bug.
2. Re-run the single test headed: `pnpm --filter @tryghost/e2e test:debug "<pattern>"` to watch it.
3. Turn on debug logging: `DEBUG=@tryghost/e2e:* ...`.
4. For analytics tests, ensure Tinybird state is synced: `pnpm --filter @tryghost/e2e tinybird:sync`.
5. Prefer Playwright auto-waiting/locator assertions over fixed timeouts to remove flakiness.

## Rules

- Never run e2e tests against a stack you haven't confirmed is up — false failures waste a full suite run.
- Always invoke via the pnpm scripts (they go through `run-playwright-host.sh`); don't call `playwright` raw.
- Tear down infra with `infra:down` when finished to free ports/containers.
