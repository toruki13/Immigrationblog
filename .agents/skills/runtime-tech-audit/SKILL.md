---
name: runtime-tech-audit
description: Safely audit and remove unneeded runtime tech, dependencies, and DB-specific code left over after the migration to Postgres (and R2 storage). Use this skill whenever the task involves finding dead or redundant dependencies, leftover code for the old database engine, unused config/services, "do we still need X", trimming the runtime footprint, or deciding whether a piece of tech is safe to delete. Focuses on evidence-based removal, not guesswork.
---

# Runtime Tech Audit

## Overview

This repo was migrated from its original database engine to **Postgres**, and added **R2** object storage. That kind of migration leaves behind dependencies, drivers, config branches, and dead code paths for the old stack. This skill is a disciplined, evidence-first workflow for finding what is genuinely unused and removing it without breaking the build, tests, or runtime config.

The golden rule: **never delete on suspicion.** Every removal must be backed by (1) no references in source, and (2) a green build + targeted tests afterward.

## Workflow

### 1. Establish the baseline
Before touching anything, capture a known-good state so you can prove you didn't regress:
- `pnpm lint` and the relevant `pnpm test:unit` (see `test-coverage-workflow`) pass.
- Note current install size / `pnpm why <pkg>` for anything you suspect.

### 2. Find candidates
- **Old DB engine remnants:** grep for the previous engine's driver name, dialect strings, and connection options across `ghost/core` config, knex setup, and migrations. Check `package.json` files for drivers that are no longer the active dialect.
- **Unused dependencies:** for each suspect, `pnpm why <pkg>` (who pulls it in) and `Grep` the source for actual imports/requires. A dependency with zero first-party imports and no transitive consumer is a candidate.
- **Dead config branches:** search for `if (config... === '<old-engine>')` style switches and storage adapters superseded by R2.
- **Orphaned services/compose files:** check `compose*.yaml` and `docker/` for services no longer referenced by the dev/test flow.

### 3. Verify each candidate is truly unused
For every item, require ALL of:
- No `import`/`require`/dynamic reference in source (Grep, case-insensitive, whole repo excluding `node_modules`).
- Not referenced in config, compose files, CI workflows, or scripts.
- Not a peer/optional dependency something else needs at runtime.

If any check is ambiguous, keep it and flag it in the report instead of deleting.

### 4. Remove incrementally
- Remove one logical group at a time (one package, or one config branch), then run lint + targeted tests.
- After dependency removals, run `pnpm install` to update the lockfile and confirm it resolves.
- Commit (or stage) each verified group separately so a regression is easy to bisect.

### 5. Verify
- `pnpm lint` + affected unit/integration tests green.
- For DB-related removals, run `ghost/core` integration tests (they actually hit Postgres).
- For storage removals, exercise the R2 path if a test exists.

## Output

Produce a short audit report: each candidate, the evidence (references found / not found), the decision (remove / keep / needs-owner-input), and verification result. Don't bury a risky deletion inside a large diff.

## Rules

- Evidence before deletion — two independent signals minimum (no source refs + green tests).
- One logical removal per commit/step; never a giant "cleanup" diff.
- Keep migrations history intact — old migration files are part of the schema's lineage; do not delete past migrations even if they reference the old engine.
- When unsure, KEEP and report. A wrong delete in runtime tech is expensive; a flagged keep is cheap.
