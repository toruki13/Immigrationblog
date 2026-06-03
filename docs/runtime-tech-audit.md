# Runtime Tech Audit — Post-Postgres Migration

_Date: 2026-06-02_ · _Scope: leftover DB/runtime tech after migrating from MySQL to Postgres and adding R2 storage._

This audit follows the `runtime-tech-audit` skill: every finding lists the evidence and a decision (**REMOVE** / **KEEP** / **FLAG** = needs owner decision). Nothing is deleted on suspicion.

## Summary

The database migration to Postgres was done **cleanly and defensively** at the code level — MySQL is fully removed as a dependency and actively guarded against at the config/connection layer. The remaining MySQL references fall into three buckets: intentional guard rails (keep), historical migrations (keep), and explanatory comments (cosmetic).

The real leftover tech is in **CI and docs**, not the application: CI still provisions MySQL 8 containers and runs `testing-mysql` matrix legs that can no longer pass, while no Postgres test leg exists despite Postgres being the production database.

## Findings

### 1. MySQL driver dependency — already removed ✅ KEEP (no action)
- **Evidence:** No `mysql` / `mysql2` in any `package.json`. `ghost/core` depends on `pg ^8.13.0` and `sqlite3 5.1.7`; `e2e` depends on `pg ^8.13.0`.
- **Decision:** Clean already.

### 2. Connection / config MySQL guards — KEEP
- **Evidence:** `ghost/core/core/server/data/db/connection.js:34` and `core/shared/config/utils.js:73` both throw `"MySQL is no longer supported in this fork. Configure database.client as 'pg'."`. `connection.js` only accepts `pg` and `sqlite3`.
- **Decision:** KEEP — these are deliberate, helpful errors for anyone with a stale MySQL config. Removing them would worsen DX.

### 3. `sqlite3` dependency — KEEP
- **Evidence:** `sqlite3` is a fully supported client in `connection.js`; it backs the test config (`config.testing.json`) and the `pnpm dev:sqlite` lighter dev flow. `DatabaseInfo.isSQLite(...)` is used at runtime in `services/members/service.js:42` and throughout `data/schema/commands.js` (SQLite-specific foreign-key/PRAGMA handling).
- **Decision:** KEEP — actively used for tests and local dev.

### 4. `@aws-sdk/client-s3` + `S3Storage.ts` — KEEP
- **Evidence:** `ghost/core/core/server/adapters/storage/S3Storage.ts` is the R2 adapter (R2 is S3-compatible) added alongside the default `Local*Storage` adapters. `@aws-sdk/client-s3 3.1025.0` is its dependency.
- **Decision:** KEEP — this is the new storage tech, intentionally added.

### 5. MySQL references in runtime files — KEEP (optional cosmetic cleanup)
- **Evidence:** `models/base/plugins/{crud,events,data-manipulation}.js`, `services/stats/mrr-stats-service.js`, `services/members/{jobs/clean-tokens,exporter/query}.js`, and `data/seeders/importers/table-importer.js` mention "mysql" only in **comments** explaining cross-DB behaviour; the surrounding code is live and supports sqlite + pg.
- **Decision:** KEEP code. Comments could be updated to say "pg" instead of "mysql" but this is cosmetic, not dead tech.

### 6. `DatabaseInfo.isMySQL` in migrations — KEEP
- **Evidence:** `isMySQL(knex)` appears only in historical migration files (e.g. `versions/5.x`, `6.0/...`). `@tryghost/database-info` is still required at runtime for `isSQLite`.
- **Decision:** KEEP — migration history must remain intact and the util is still needed.

---

### 7. ⚠️ Broken MySQL CI matrix legs — REMOVE (dead tech + wasted CI)
- **Evidence:** `.github/workflows/ci.yml`
  - `job_acceptance-tests` (lines ~408–490): a `mysql:8.0` service container plus matrix leg `DB: mysql8 / NODE_ENV: testing-mysql`.
  - `job_legacy-tests` (lines ~492–551): same `mysql:8.0` service + `mysql8` leg.
  - **There is no `config.testing-mysql.json`** — only `config.testing.json` and `config.testing-pg.json` exist in `ghost/core/core/shared/config/env/`.
  - The app **throws** on a MySQL client (finding #2), so these legs cannot pass.
- **Impact:** Each push spins up MySQL containers and runs matrices that are broken/no-op — wasted minutes and noise.
- **⚠️ Trap:** the coverage upload step is gated on `if: ... contains(matrix.env.DB, 'mysql')` (ci.yml:478). Removing the MySQL legs without re-targeting this condition would silently disable coverage artifact upload.
- **Decision:** REMOVE the MySQL service containers and `mysql8` matrix legs, and re-point the coverage upload to the surviving leg. **See open decision below — pending owner approval since CI is outward-facing.**

### 8. Missing Postgres CI parity — FLAG (gap, not leftover)
- **Evidence:** `config.testing-pg.json` exists but no CI job sets `NODE_ENV: testing-pg` or provisions a Postgres service. Integration/e2e/legacy tests run only on SQLite, while production runs Postgres.
- **Decision:** FLAG — recommend replacing the dead `mysql8` legs with a `testing-pg` leg + `postgres` service so integration/e2e run against the production engine (keeps matrix size constant → no CI slowdown).

### 9. Stale docs — REMOVE/UPDATE
- **Evidence:** `docs/README.md:11` — "**Docker** - For MySQL database and development services". `.github/workflows/migration-review.yml:42` — checklist item "Tested in MySQL and SQLite".
- **Decision:** UPDATE wording to Postgres. Low risk; safe to do anytime.

## Recommended order of action
1. (Safe, anytime) Update stale docs — finding #9.
2. (Pending approval — CI) Replace MySQL CI legs with Postgres legs — findings #7 + #8 together, which removes dead tech, closes the parity gap, and keeps CI fast.
3. (Optional cosmetic) Refresh "mysql" comments to "pg" — finding #5.

## Verification checklist for any CI change
- `config.testing-pg.json` connection details match the chosen `postgres` service container.
- Coverage upload condition points at a leg that actually runs.
- A trial push shows acceptance/legacy/e2e/integration green on Postgres + SQLite.
