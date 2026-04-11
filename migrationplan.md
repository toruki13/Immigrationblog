# Migration Plan: MySQL → PostgreSQL (Railway) + Cloudflare R2 + No Redis

## Context

Migrate this Ghost instance from MySQL/Docker/Redis/local-filesystem-storage to:
- **PostgreSQL** hosted on Railway (managed DB)
- **Cloudflare R2** for image/media/file storage (S3-compatible)
- **No Redis** — comment out, fall back to built-in `MemoryCache` (already the default in `ghost/core/core/shared/config/defaults.json`)

---

## Step 1: Add `pg` Driver Dependency

**File:** `ghost/core/package.json`

The Knex query builder supports PostgreSQL via the `pg` npm package. Ghost currently only ships `mysql2` (line 202) and optional `sqlite3` (line 231).

- [x] Add `"pg": "^8.13.0"` to `dependencies` (after `mysql2` on line 202)
- [x] Run `pnpm install` from the repo root to regenerate the lockfile
- [ ] Verify `pg` resolves: `cd ghost/core && node -e "require('pg')"`

---

## Step 2: Update Database Connection Handler

**File:** `ghost/core/core/server/data/db/connection.js`

Currently has two branches: `client === 'sqlite3'` (line 20) and `client === 'mysql2'` (line 48). Need a third branch for `pg`.

- [x] Add a `client === 'pg'` block after the `mysql2` block (after line 60), containing:
  ```js
  if (client === 'pg') {
      // Railway provides DATABASE_URL as a connection string
      if (process.env.DATABASE_URL) {
          dbConfig.connection = process.env.DATABASE_URL;
      }
      // SSL config for Railway (when using object-style connection)
      if (typeof dbConfig.connection === 'object') {
          dbConfig.connection.ssl = dbConfig.connection.ssl || { rejectUnauthorized: false };
      }
      dbConfig.searchPath = ['public'];
  }
  ```
- [x] Verify the `configure()` function returns `dbConfig` correctly for all three client types
- [ ] Ensure `knex(configure(...))` creates a valid Knex instance with `pg` client

---

## Step 3: Fix MySQL-Specific Raw SQL in Migration Utils

**File:** `ghost/core/core/server/data/migrations/utils/schema.js`

### 3a: `isColumnNotNullable()` (lines 182–193)

The `else` branch on line 190 uses `SHOW COLUMNS FROM ??` — this is MySQL-only syntax. PostgreSQL will throw `syntax error at or near "SHOW"`.

- [x] Change the `else` block to detect `pg` vs `mysql2`:
  ```js
  async function isColumnNotNullable(table, column, knex) {
      const client = knex.client.config.client;

      if (client === 'sqlite3') {
          const response = await knex.raw('PRAGMA table_info(??)', [table]);
          const columnInfo = response.find(col => col.name === column);
          return columnInfo && columnInfo.notnull === 1;
      } else if (client === 'pg') {
          const response = await knex.raw(
              `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
              [table, column]
          );
          const columnInfo = response.rows[0];
          return columnInfo && columnInfo.is_nullable === 'NO';
      } else {
          // mysql2
          const response = await knex.raw('SHOW COLUMNS FROM ??', [table]);
          const columnInfo = response[0].find(col => col.Field === column);
          return columnInfo && columnInfo.Null === 'NO';
      }
  }
  ```

### 3b: `isColumnNullable()` (lines 203–214)

Same issue — `SHOW COLUMNS FROM` in the `else` branch.

- [x] Apply identical fix: add `else if (client === 'pg')` branch using `information_schema.columns`
  ```js
  // PostgreSQL branch
  const response = await knex.raw(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = ? AND column_name = ?`,
      [table, column]
  );
  const columnInfo = response.rows[0];
  return columnInfo && columnInfo.is_nullable === 'YES';
  ```

### 3c: `SET FOREIGN_KEY_CHECKS` (lines 117, 124, 247, 254)

Used in `createSetNullableMigration` and `createDropNullableMigration`. This is MySQL-only syntax.

- [x] Guard all 4 occurrences with a MySQL check. Replace:
  ```js
  // Before (line 117):
  await knex.raw('SET FOREIGN_KEY_CHECKS=0;').transacting(knex);
  // After:
  if (!DatabaseInfo.isSQLite(knex)) {
      await knex.raw('SET FOREIGN_KEY_CHECKS=0;').transacting(knex);
  }
  ```
  **Better approach:** wrap in `DatabaseInfo.isMySQL(knex)` check since this is MySQL-only. PostgreSQL doesn't need this — its `ALTER TABLE` is transactional.
- [x] Apply to all 4 locations: lines 117, 124, 247, 254

---

## Step 4: Fix MySQL Error Codes in Schema Commands

**File:** `ghost/core/core/server/data/schema/commands.js`

Multiple catch blocks check MySQL-specific error codes. PostgreSQL uses different codes.

### 4a: `addIndex()` (lines 206–216)

- [x] Add PostgreSQL duplicate relation error code `42P07`:
  ```js
  if (err.code === 'SQLITE_ERROR' || err.code === 'ER_DUP_KEYNAME' || err.code === '42P07') {
      logging.warn(`Index for '${columns}' already exists for table '${tableName}'`);
      return;
  }
  ```

### 4b: `dropIndex()` (lines 233–243)

- [x] Add PostgreSQL undefined object error code `42704`:
  ```js
  if (err.code === 'SQLITE_ERROR' || err.code === 'ER_CANT_DROP_FIELD_OR_KEY' || err.code === '42704') {
  ```

### 4c: `addUnique()` (lines 260–269)

- [x] Add PostgreSQL codes `42P07` (duplicate relation) and `23505` (unique violation):
  ```js
  if (err.code === 'SQLITE_ERROR' || err.code === 'ER_DUP_KEYNAME' || err.code === '42P07' || err.code === '23505') {
  ```

### 4d: `dropUnique()` (lines 287–296)

- [x] Add PostgreSQL code `42704`:
  ```js
  if (err.code === 'SQLITE_ERROR' || err.code === 'ER_CANT_DROP_FIELD_OR_KEY' || err.code === '42704') {
  ```

### 4e: `addForeign()` (line 379)

- [x] Add PostgreSQL duplicate FK error code `23505` and `42710`:
  ```js
  if (err.code === 'ER_DUP_KEY' || err.code === 'ER_FK_DUP_KEY' || err.code === 'ER_FK_DUP_NAME' || err.code === '23505' || err.code === '42710') {
  ```

### 4f: `dropForeign()` (line 428)

- [x] Add PostgreSQL constraint not found code `42704`:
  ```js
  if (err.code === 'ER_CANT_DROP_FIELD_OR_KEY' || err.code === '42704') {
  ```

### 4g: `addPrimaryKey()` (line 476)

- [x] Add PostgreSQL invalid table definition code `42P16`:
  ```js
  if (err.code === 'ER_MULTIPLE_PRI_KEY' || err.code === '42P16') {
  ```

### 4h: `getTables()` (lines 520–532)

- [x] Add `pg` branch (currently rejects with "no support for database client"):
  ```js
  } else if (client === 'pg') {
      const response = await transaction.raw(
          `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
      );
      return response.rows.map(row => row.tablename);
  }
  ```

### 4i: `getIndexes()` (lines 538–550)

- [x] Add `pg` branch:
  ```js
  } else if (client === 'pg') {
      const response = await transaction.raw(
          `SELECT indexname FROM pg_indexes WHERE tablename = ?`,
          [table]
      );
      return response.rows.map(row => row.indexname);
  }
  ```

### 4j: `getColumns()` (lines 556–568)

- [x] Add `pg` branch:
  ```js
  } else if (client === 'pg') {
      const response = await transaction.raw(
          `SELECT column_name FROM information_schema.columns WHERE table_name = ? AND table_schema = 'public'`,
          [table]
      );
      return response.rows.map(row => row.column_name);
  }
  ```

### 4k: `addColumn()` / `dropColumn()` (lines 102–170)

- [x] These already work for PostgreSQL — the `isSQLite` check uses Knex's default builder, and the `isMySQL` branch appends `algorithm=copy` (MySQL-only). For `pg`, it falls through to `transaction.raw(sql)` which executes the standard Knex-generated DDL. **No changes needed.**

### 4l: `renameColumn()` (lines 179–190)

- [x] Already works — the `else` branch (line 187) uses `table.renameColumn()` which is Knex-portable. **No changes needed.**

---

## Step 5: Fix MySQL-Specific Raw SQL in Data Generator

**File:** `ghost/core/core/server/data/seeders/data-generator.js`

The `#run()` method (lines 214–294) uses MySQL-only commands without checking the DB client:

### 5a: Lines 201–224 — MySQL-only raw SQL

- [x] Wrap the MySQL-specific raw queries with `DatabaseInfo.isMySQL(this.knex)`:
  ```js
  if (!DatabaseInfo.isSQLite(this.knex) && DatabaseInfo.isMySQL(this.knex)) {
      if (process.env.DISABLE_FAST_IMPORT) {
          await transaction.raw('SET FOREIGN_KEY_CHECKS=0;');
          await transaction.raw('SET unique_checks=0;');
      } else {
          await transaction.raw('ALTER INSTANCE DISABLE INNODB REDO_LOG;');
          // ... etc
      }
  }
  ```

### 5b: Line 202 — `SET autocommit=0`

- [x] Guard with `DatabaseInfo.isMySQL(this.knex)` (PostgreSQL manages autocommit differently)

### 5c: Lines 291–293 — `ALTER INSTANCE ENABLE INNODB REDO_LOG`

- [x] Change condition from `!DatabaseInfo.isSQLite(this.knex)` to `DatabaseInfo.isMySQL(this.knex)`:
  ```js
  if (DatabaseInfo.isMySQL(this.knex) && !process.env.DISABLE_FAST_IMPORT) {
      await transaction.raw('ALTER INSTANCE ENABLE INNODB REDO_LOG;');
  }
  ```

---

## Step 6: Verify `@tryghost/database-info` Compatibility

**Package:** `@tryghost/database-info@0.3.35` (from TryGhost/framework repo)

This package provides `DatabaseInfo.isMySQL(knex)` and `DatabaseInfo.isSQLite(knex)` used throughout the codebase. It checks `knex.client.config.client`.

- [ ] Verify that `isMySQL()` returns `false` for `client: 'pg'` (expected — it checks for `mysql2`)
- [ ] Verify that `isSQLite()` returns `false` for `client: 'pg'` (expected — it checks for `sqlite3`)
- [ ] Audit all code paths where both `isMySQL()` and `isSQLite()` return `false` — ensure the fallthrough behavior is correct for PostgreSQL (most use Knex abstractions, which are DB-agnostic)
- [ ] If needed, consider adding an `isPostgreSQL()` helper or patching the package

---

## Step 7: Comment Out Redis in Docker Compose

**File:** `compose.dev.yaml`

### 7a: Comment out Redis service (lines 24–40)

- [x] Wrap the entire `redis:` block in comments:
  ```yaml
  # --- Redis disabled (using MemoryCache) ---
  # redis:
  #   image: redis:7.0@sha256:...
  #   container_name: ghost-dev-redis
  #   ports:
  #     - "6379:6379"
  #   volumes:
  #     - redis-data:/data
  #   healthcheck:
  #     ...
  ```

### 7b: Remove Redis env vars from `ghost-dev` (lines 85–87)

- [x] Comment out:
  ```yaml
  # adapters__cache__Redis__host: redis
  # adapters__cache__Redis__port: 6379
  ```

### 7c: Remove Redis from `depends_on` (lines 91–92)

- [x] Comment out:
  ```yaml
  # redis:
  #   condition: service_healthy
  ```

### 7d: Comment out Redis volume (line 141)

- [x] Comment out:
  ```yaml
  # redis-data:
  ```

### 7e: Verify MemoryCache is the default

- [ ] Confirm `ghost/core/core/shared/config/defaults.json` has `"active": "MemoryCache"` under `adapters.cache` — **no code changes needed**, Ghost falls back automatically

---

## Step 8: Replace MySQL with PostgreSQL in Docker Compose

**File:** `compose.dev.yaml`

### 8a: Replace the `mysql` service block (lines 4–21)

- [x] Replace with PostgreSQL 16:
  ```yaml
  postgres:
    image: postgres:16
    container_name: ghost-dev-postgres
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: ghost
      POSTGRES_PASSWORD: ghost
      POSTGRES_DB: ghost_dev
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ghost -d ghost_dev"]
      interval: 1s
      retries: 120
      timeout: 5s
      start_period: 10s
  ```

### 8b: Update `ghost-dev` environment variables (lines 75–79)

- [x] Change database env vars:
  ```yaml
  database__client: pg
  database__connection__host: postgres
  database__connection__user: ghost
  database__connection__password: ghost
  database__connection__database: ghost_dev
  ```

### 8c: Update `depends_on` (lines 88–90)

- [x] Change `mysql` → `postgres`:
  ```yaml
  depends_on:
    postgres:
      condition: service_healthy
  ```

### 8d: Update volumes (line 140)

- [x] Replace `mysql-data:` with `postgres-data:`

---

## Step 9: Create Railway Production Config

**File:** `ghost/core/config.production.json` (new — replaces the existing one at `ghost/core/core/shared/config/env/config.production.json`)

- [x] Create/update the production config:
  ```json
  {
      "database": {
          "client": "pg"
      },
      "storage": {
          "active": "S3Storage",
          "media": "S3Storage",
          "files": "S3Storage"
      },
      "paths": {
          "contentPath": "content/"
      },
      "logging": {
          "level": "info",
          "rotation": {
              "enabled": true
          },
          "transports": ["file"]
      }
  }
  ```

- [ ] Set these **Railway environment variables** (Service > Variables):
  ```
  NODE_ENV=production
  DATABASE_URL=<railway-provided-postgres-url>
  url=https://yourdomain.com
  storage__S3Storage__bucket=<your-r2-bucket-name>
  storage__S3Storage__region=auto
  storage__S3Storage__endpoint=https://<cloudflare-account-id>.r2.cloudflarestorage.com
  storage__S3Storage__credentials__accessKeyId=<R2_ACCESS_KEY_ID>
  storage__S3Storage__credentials__secretAccessKey=<R2_SECRET_ACCESS_KEY>
  storage__S3Storage__staticFileURLPrefix=https://<your-cdn-or-r2-public-domain>
  ```

---

## Step 10: R2 Storage Configuration

**No code changes needed.** The existing adapter at `ghost/core/core/server/adapters/storage/S3Storage.ts` already supports S3-compatible endpoints (R2).

### Cloudflare R2 setup checklist:

- [ ] Create an R2 bucket in Cloudflare dashboard (e.g., `ghost-media`)
- [ ] Create an R2 API token with read/write permissions for the bucket
- [ ] Note the `Account ID` (used in the endpoint URL)
- [ ] Optionally configure a custom domain for public access (for `staticFileURLPrefix`)
- [ ] Optionally enable R2 public access if not using a CDN domain
- [ ] Set all `storage__S3Storage__*` env vars in Railway (see Step 9)

---

## Step 11: Verify MigratorConfig

**File:** `ghost/core/MigratorConfig.js`

- [ ] Confirm it exports `database: config.get('database')` (line 32) — this passes whatever DB config is set, so `pg` works automatically
- [ ] No changes needed — `knex-migrator` uses Knex internally which supports `pg`

---

## Step 12: Audit Raw SQL in Individual Migration Files

**266+ migration files in:** `ghost/core/core/server/data/migrations/versions/`

Most migrations use Knex schema builder (portable). ~35 use `.raw()`. Most are guarded by `DatabaseInfo.isMySQL()` / `isSQLite()`.

### Files requiring manual review:

- [x] `versions/5.14/2022-09-02-12-55-rename-members-bio-to-expertise.js` — Already guarded with `DatabaseInfo.isMySQL(knex)`. Else branch uses Knex abstraction. **Safe for pg.**
- [x] `versions/6.0/2025-06-30-14-00-00-update-feature-image-alt-length.js` — Uses Knex schema builder (`alterTable`). Skips SQLite. **Safe for pg.**
- [x] Any migration using `knex.raw('CURRENT_TIMESTAMP')` — **works in pg**, no changes needed
- [x] Any migration using `.unsigned()` — **silently ignored by pg/Knex**, no changes needed
- [x] Grep for unguarded MySQL-only SQL — **completed, all issues found and fixed**

### Critical migrations fixed:

- [x] `versions/5.97/2024-10-09-14-04-10-add-session-verification-field.js` — **FIXED**: `JSON_SET`/`JSON_VALID`/`JSON_REMOVE` guarded with `isMySQL()`, JS fallback for pg
- [x] `versions/6.0/2025-06-24-09-19-42-use-object-id-for-hardcoded-user-id.js` — **FIXED**: `JSON_SET`/`JSON_EXTRACT`/`JSON_VALID` guarded with `isMySQL()`, JS fallback for pg
- [x] `versions/5.21/2022-10-26-04-50-member-subscription-created-batch-id.js` — **FIXED**: `TIMESTAMPDIFF` replaced with `EXTRACT(EPOCH FROM ...)` for pg
- [x] `versions/5.59/2023-08-07-11-17-05-add-posts-published-at-index.js` — **FIXED**: `SHOW INDEX` replaced with `pg_indexes` query for pg
- [x] `versions/5.0/2022-03-14-12-33-delete-duplicate-offer-redemptions.js` — **FIXED**: Multi-table `DELETE` replaced with subquery `DELETE FROM ... WHERE id IN (...)` for pg

---

## Known Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| `@tryghost/database-info` doesn't recognize `pg` | `isMySQL()`/`isSQLite()` return `false`, code falls to else branches | Most else branches use Knex abstractions — test thoroughly |
| Unguarded raw MySQL SQL in migrations | Migration failures on first boot | Audit with grep (Step 12), fix before deploying |
| PostgreSQL is case-sensitive (MySQL uses `utf8mb4_general_ci`) | Slug/tag/email lookups may behave differently | Add `CITEXT` extension or use `LOWER()` in queries if issues arise |
| Boolean handling: MySQL stores as `tinyint(1)`, pg has native `boolean` | Raw `WHERE col = 1` fails on pg | Knex handles this in schema builder; audit raw queries |
| `unsigned` integers don't exist in PostgreSQL | No impact — Knex `.unsigned()` is silently ignored on pg | No action needed |
| Data Generator uses MySQL-only `ALTER INSTANCE`, `SET autocommit` | `pnpm reset:data` will fail | Fix in Step 5 |

---

## Verification Checklist

### Local Development (Docker)
- [x] `pnpm install` completes without errors
- [ ] `docker compose -f compose.dev.yaml up` starts PostgreSQL (no MySQL, no Redis)
- [ ] `docker compose -f compose.dev.yaml ps` shows `ghost-dev-postgres` healthy
- [ ] Ghost boots without errors (`docker compose logs ghost-dev`)
- [ ] All 266+ Knex migrations run successfully
- [ ] Admin UI accessible at `http://localhost:2368/ghost/`
- [ ] Can create a post with an image upload (tests local storage still works in dev)
- [ ] `pnpm reset:data` works (data generator with PostgreSQL)

### Railway Production
- [ ] Railway service deploys with `Dockerfile.production`
- [ ] `DATABASE_URL` env var connects to Railway PostgreSQL
- [ ] Ghost boots and migrations run on Railway
- [ ] Image/media uploads store to R2 bucket
- [ ] Uploaded images accessible via `staticFileURLPrefix` URL
- [ ] Admin UI loads and CRUD operations work
- [ ] Member signup/login works
- [ ] Email sending works (configure mail transport)

### Regression Testing
- [ ] `cd ghost/core && pnpm test:unit` — unit tests pass
- [ ] `cd ghost/core && pnpm lint` — no lint errors from changes
- [ ] Verify no Redis connection errors in logs (MemoryCache should be transparent)
