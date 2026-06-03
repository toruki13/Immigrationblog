---
name: dev-flow-optimization
description: Make local development and CI faster in the Ghost monorepo — Nx caching/affected, scoped test and build runs, Docker dev stack startup, and fast inner-loop commands. Use this skill whenever the task involves speeding up the dev flow, slow builds or tests, redundant work, Nx cache misses, "why is X slow", choosing the narrowest command for a change, or improving feedback loops locally and in CI.
---

# Dev Flow Optimization

## Overview

The repo uses **Nx 22** (caching + affected graph, `parallel: 4`, cache in `.nxcache`) over a **pnpm 10** workspace, with a **Docker compose** dev stack. Most slowness comes from running broad commands when a scoped one would do, or from cache misses. This skill is about always running the narrowest correct command and keeping Nx's cache effective.

## Inner loop: run the narrowest thing

| Instead of | Run |
| --- | --- |
| `pnpm test` (all projects) | `pnpm nx affected -t test:unit` (only changed) |
| `pnpm build` (all) | `pnpm nx affected -t build` |
| whole core suite | `cd ghost/core && pnpm test:single <file>` |
| full e2e suite | `pnpm --filter @tryghost/e2e test:single "<pattern>"` |
| `pnpm lint` (all) | `pnpm nx affected -t lint` |

`nx affected` diffs against the base branch and only runs projects whose inputs changed — this is the single biggest local speedup.

## Keep the Nx cache working

- `build`, `lint`, `test`, `test:unit` are all cached (see `nx.json`). A second run of an unchanged project is near-instant.
- A cache MISS means an input changed. If you see unexpected misses, check that you're not touching shared inputs (`{workspaceRoot}/ghost/tsconfig.json` is a `default` input — editing it busts everything).
- Force a clean run only when needed: `--skip-nx-cache`.
- Reset a corrupted cache: `pnpm nx reset` (or `pnpm build:clean` which also clears build artifacts).
- Inspect the task graph to understand why something reruns: `pnpm nx graph` / `pnpm nx show project <name>`.

## Docker dev stack

- `pnpm dev` starts the full compose stack + watches the front-end apps via Nx.
- Use the **lighter profiles** when you don't need everything — startup is much faster:
  - `pnpm dev:sqlite` — lighter DB for quick UI work (when Postgres isn't required for the change).
  - `pnpm dev` — default.
  - `pnpm dev:all` only when you actually need analytics + storage + stripe.
- Don't rebuild images unless dependencies changed; `docker:up` already only rebuilds on change.

## CI speed levers

- CI already runs **affected** lint/unit and matrixed acceptance tests; keep changes scoped so fewer projects are affected.
- Prefer adding tests to the right package so they run in the smallest matrix shard rather than the full suite.
- Use `test:unit:ci` (`--reporter=min`) style minimal reporters for faster, quieter CI logs.

## Diagnosing slowness

1. Time the command and check whether Nx reported cache hits or misses.
2. If misses: `pnpm nx show project <name> --web` (or `graph`) to see inputs/dependsOn causing reruns.
3. For slow individual suites, use the `*:slow` reporters in `ghost/core` (`test:unit:slow`, etc.) to find the worst offenders.
4. For Docker, prefer a lighter compose profile before optimizing anything else.

## Rules

- Default to `nx affected` and `--filter`/`test:single`; only run workspace-wide commands for final verification.
- Never edit shared root inputs (e.g. `ghost/tsconfig.json`) casually — it invalidates the entire cache.
- Don't disable the Nx cache to "fix" a problem; find the input that changed instead.
