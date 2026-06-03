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

### 🔶 Step 2 — 3.28 → 4.x (the big one) — IN PROGRESS (prep on 3.28)

Methodology: clear blockers **while still on 3.28** (verifiable), then bump core.

**Done (this branch):**
- ✅ Converted the one app-owned jQuery file `app/components/gh-token-input/select-multiple.js` from `$(window).on/off` to native `addEventListener`/`removeEventListener`. App-owned jQuery usage is now **zero**. (eslint clean.)
- ✅ **`ember-drag-drop` 0.4.8 → 1.0.1** — the v2-addon release keeps the same component API (`SortableObjects`, `draggable-object`, extendable classic `DraggableObject`) **and calls `sortEndAction` as a closure action instead of the removed `Component#sendAction`**. Upgraded with **zero app-code changes**: install resolves clean (no peer warnings), and `ember build` compiles past drag-drop (only the unrelated admin-x-framework/hooks Windows error remains). ⚠️ Runtime drag-to-reorder UX (tags/authors/labels + touch) still needs manual + acceptance-test verification on Linux/CI.
- ✅ **Removed `ember-cli-shims@1.2.0`** (incompatible with 4.x). The 5 files using `import Ember from 'ember'` are unaffected — that module is provided by ember-source, not the shim. Verified: install clean, `ember build` still reaches only the unrelated admin-x error (no `Module not found: ember`).

**Remaining blockers — evidence-based (these are real work + need manual UI/test verification, ideally on Linux/CI where the full Ember build runs):**

1. **`jquery-integration` can't be flipped off yet.** `config/optional-features.json` still has `jquery-integration: true` because **`liquid-fire` (2 files) and `liquid-wormhole` (2 files) use `this.$()`** internally (see `config/deprecation-workflow.js`). Used in: `editor/modals/publish-flow/options.hbs`, `gh-post-settings-menu.hbs`, `tag-form.hbs`. → upgrade liquid-fire/liquid-wormhole to jQuery-free versions (or replace) before setting the flag false.
2. ✅ ~~**`ember-drag-drop@0.4.8`** — uses removed `Component#sendAction`.~~ **RESOLVED** by bumping to `1.0.1` (API-compatible v2 addon, closure-action `sortEndAction`). No app-code changes. Still pending: runtime UX verification.
3. ✅ ~~**`ember-cli-shims@1.2.0`** — incompatible with 4.x.~~ **REMOVED** and build-verified (the `import Ember from 'ember'` module comes from ember-source).
4. **`ember-power-datepicker@0.8.1`** (1 file) → `1.0.7` (+ `ember-power-calendar@1.8.1`) to drop `ember-cli-babel@6`. Note: `ember-mocha` is already at latest (0.16.2); its `ember-cli-babel@6` pull is transitive via `ember-cli-test-loader` and only triggers a cosmetic Ember Global deprecation — no action available/needed for the 4.x bump.
5. Bump `ember-source`/`ember-cli`/`ember-data` to 4.x (target **4.12 LTS**); clear Classic/array-prototype-extension deprecations via the workflow.

**Why not bump core now:** blockers #1/#2 will break animations and drag-reordering until their addons are migrated, and that behaviour needs manual verification + a green `ghost/admin` test run — not reliably doable on this Windows box (full Ember build also needs the `admin-x-*` Vite packages, which don't build on Windows). Do the addon migrations + core bump where the test suite runs.

### ⬜ Step 3 — 4.x → 4.12 LTS → 5.x → 5.12 LTS → 6.x
Each: bump `ember-source`/`ember-cli`/`ember-data`, update addons to compatible versions, clear deprecations, keep the Ember test suite (`ghost/admin` `pnpm test`) green. Adopt Embroider/Vite build for the main build-speed payoff.

## How to verify each step locally (Windows)
1. Use node ≥ 22.18.0 (see above).
2. `pnpm install` — confirm clean resolution.
3. Build admin-x deps first (CI/Linux, or fix the Vite configs), then `pnpm --filter ghost-admin exec ember build`.
4. Run `pnpm --filter ghost-admin test` and keep it green.
