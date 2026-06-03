# Ember Admin Upgrade Plan (3.24 → 6.x)

_Started 2026-06-02._ The Ember app (`ghost/admin`) is the **host admin application** — it owns posts, pages, the editor, members, tags, dashboard, setup, and auth. The React `admin-x-*` apps are embedded *inside* it via the `react-fallback` catch-all route, so Ember **cannot be removed**; the realistic legacy/build-speed win is upgrading it LTS-by-LTS.

## Why upgrade
- `ember-cli` 3.24's Broccoli pipeline is a major build-speed cost. Modern Ember (4.x+/Embroider) builds materially faster.
- 3.24 is ~2021-era; staying current reduces addon-compat debt.

## Starting-state assessment (good news)
- Already **Octane** (`ember.edition: octane`): **123 Glimmer components vs 22 classic**.
- `ember-auto-import@2`, `@embroider/macros`, webpack 5, `ember-cli-babel@8` already present.
- **Real jQuery footprint is 1 file** (`app/components/gh-token-input/select-multiple.js` uses `this.$()`), not the ~36 a loose grep suggested. The main 4.0 blocker is nearly trivial.
- `ember-cli-deprecation-workflow` already configured (`config/deprecation-workflow.js`).

## Environment requirement (discovered)
The Ember build's own guard (`ghost/admin/lib/check-node-version.js`) **rejects node 22.10.0–22.17.x** (an `esm` module incompatibility) and requires **node ≥ 22.18.0**. Use 22.18.0+ even though the `engines` field says `^22.13.1`.

## Plan (LTS hops)

### ✅ Step 1 — 3.24 → 3.28 (final 3.x LTS) — DONE
Bumped in `ghost/admin/package.json`:
- `ember-source` 3.24.0 → **3.28.12**
- `ember-cli` 3.24.0 → **3.28.6**
- `ember-data` 3.24.0 → **3.28.13**

**Verification:**
- `pnpm install` resolves cleanly — no new peer-dependency conflicts referencing ember-source/cli/data (only pre-existing react/codemirror/vite/knex warnings).
- `ember build` (node 22.18.0) compiles the full app: ember-cli 3.28.6 + Broccoli + webpack built **4173 modules** and emitted `app` + `tests` bundles. No 3.28 / addon / template compile errors — only normal deprecation warnings (`has-block`, `jquery-integration`, Ember Global via old `ember-cli-babel@6`).
- The build's only hard error is `Can't resolve '@tryghost/admin-x-framework/hooks'` — **unrelated to Ember**; it's the pre-existing Windows blocker where the `admin-x-*` Vite packages don't build (posix-only `__dirname`/glob assumptions). A green end-to-end Ember build needs those packages built (CI/Linux, or the cross-platform Vite fix).

### ⬜ Step 2 — 3.28 → 4.x (the big one)
Blockers to clear first (surfaced by the deprecation output):
- Remove jQuery: migrate the 1 `this.$()` usage; remove `@ember/jquery`; set `jquery-integration: false` via `@ember/optional-features`.
- Remove `ember-cli-shims@1.2.0` (incompatible with 4.x).
- Replace/upgrade addons still pulling `ember-cli-babel@6` (Ember Global deprecation): `ember-power-datepicker@0.8.1` (→ `ember-power-calendar@0.15`), `ember-drag-drop@0.4.8`, `ember-mocha@0.16.2`.
- Bump `ember-data` to 4.x; clear Classic/array-prototype-extension deprecations via the workflow.

### ⬜ Step 3 — 4.x → 4.12 LTS → 5.x → 5.12 LTS → 6.x
Each: bump `ember-source`/`ember-cli`/`ember-data`, update addons to compatible versions, clear deprecations, keep the Ember test suite (`ghost/admin` `pnpm test`) green. Adopt Embroider/Vite build for the main build-speed payoff.

## How to verify each step locally (Windows)
1. Use node ≥ 22.18.0 (see above).
2. `pnpm install` — confirm clean resolution.
3. Build admin-x deps first (CI/Linux, or fix the Vite configs), then `pnpm --filter ghost-admin exec ember build`.
4. Run `pnpm --filter ghost-admin test` and keep it green.
