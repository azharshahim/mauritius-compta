# Mission 44 — Accountant Workspace (COMPTAI Cabinet)

Report written by the implementation agent at the end of the mission. Every
figure below comes from a command executed in this sandbox; anything that could
**not** be executed is stated as such (section 8). No regulatory, tax or
statutory claim is made anywhere in this document.

---

## 1. Executive summary

COMPTAI now has a firm-facing workspace: a cabinet portfolio, a guided
six-step client creation assistant, and a per-client workspace organised in the
fourteen requested sections around eight functional domains. The accounting
engine, payroll, VAT calculation, fixed assets, inventory, bank reconciliation
and OCR were **not** rewritten: the new layer reads and writes through the
existing services (`apps/api/src/lib/client-file.ts` creates the `companies`
row and its accounting scaffolding).

Honesty rules were treated as functional requirements: the onboarding engine
never claims a legal or regulatory validation, KYC documents are references
only (no upload), MRA e-invoicing is a reserved slot, and module availability is
stated as `available` / `partial` / `prepared`.

## 2. Branch, commits and base

| Item | Value |
| --- | --- |
| Base | `main` @ `cc5698457061dc2618a3b9b83967098840bb87ec` |
| Working branch | `arena/b8889b50-mauritius-compta` |
| Final code commit | `71c4201` (Mission 44.1 audit) — first functional commit `71247a6` |
| This report | committed immediately after the code commit (branch head) |

Nothing was merged into `main`, no production deployment was performed, the
OVH VPS, its SSH access and its credentials were never touched, and Pull
Request #23 (Mission 42) was neither modified nor integrated.

## 3. Pull request

**PR #24** — https://github.com/azharshahim/mauritius-compta/pull/24
(`draft`, `arena/b8889b50-mauritius-compta` → `main`, opened 2026-11-01).
The pull request stays in draft: merging is an owner decision after the review
listed in section 15. Its status is visible on the PR page; a check that is
still running is not reported as passing here.

## 4. Features — done, partial, missing

### Done (P0)

* **Cabinet dashboard** — header with firm name, signed-in user, client search,
  language selector, settings and `+ Create New Client`; eight indicators
  (total clients, active, onboarding in progress, pending reviews, missing
  documents, accounting exceptions, upcoming tax tasks, overdue tasks); client
  portfolio table (business name, BRN, sector, assigned accountant, onboarding
  status with progress, accounting period, outstanding tasks, last activity)
  with search, sector filter, reset, empty state and per-row actions
  (*Open client*, *Continue onboarding*, *View tasks*, *Edit client details*
  gated by `cabinet_access`).
* **Six-step creation wizard** — Company information (registered/trading name,
  BRN, CRN, legal form, incorporation date, address, country, contact e-mail
  and phone, primary contact, description) with per-step validation and
  human-readable field errors; KYC checklist; sector and module proposals;
  accounting setup; module selection; review and activation with back
  navigation.
* **Draft save and resume** — `POST/PATCH /cabinet/workspace/drafts`, resume via
  `/cabinet/clients/new?draft=<id>`, drafts are private to their author and
  never appear in the portfolio.
* **KYC checklist** — 12 template items, five statuses (`not_started`,
  `in_progress`, `received`, `verified`, `needs_correction`, plus
  `not_applicable`), derived review status (`not_started` → `in_progress` →
  `pending_review` → `approved` / `rejected`), per-item reference and note.
* **Business sector configuration** — 9 sectors, each with a label, a
  description, two practical notes and a proposed module list that stays
  editable.
* **Accounting setup** — currency, financial year, basis (accrual only, with the
  cash-basis absence stated), chart-of-accounts choice, opening balances,
  customers/suppliers, bank accounts, VAT registration, permissions note. The
  wizard reuses the existing company creation service instead of duplicating
  it.
* **Module selection** — the eight domains with their real availability and a
  short description; a module marked `prepared` can be recorded as a future
  need but is never presented as working.
* **Review and activation** — summary of every step, permission-gated
  activation, `409 ONBOARDING_INCOMPLETE` when a prerequisite is missing,
  `cabinet.onboarding.activate` written to the audit log in the activation
  transaction.
* **Client workspace** — header (client, BRN, sector, onboarding status, role)
  and 14 sections (Overview, Tasks, Onboarding & KYC, Accounting, Sales,
  Purchases, Banking, Payroll, Fixed Assets, Inventory, Tax, Reports,
  Documents, AI Assistant) filtered by selected modules and permissions, with
  deep links to the existing screens.
* **Eight domains** — Onboarding & KYC, Sector/instances, Checks & balances,
  Sales & e-invoicing, Purchases & OCR, Tax management, Accounting & tax
  reports, Knowledge repository + AI assistant.
* **Task and progress engine** — deterministic, documented
  (`docs/cabinet-onboarding.md` §3), unit-tested (12 cases). No fake percentage:
  the value is `round(completed / 6 × 100)` over six boolean steps.
* **Bilingual UI** — 389 new FR keys and 389 new EN keys (parity verified), all
  new labels translated, English primary / French secondary; light and dark
  themes reuse the existing tokens; Android/phone layout uses the existing
  breakpoints (900 px / 640 px) and bottom-nav contract.
* **Demo backend** — full in-browser implementation for `/cabinet/workspace*`
  with three fictional clients, one fictional draft, schema version 18 and
  forward migrations from the previous demo schemas. No network call.

### Partial (honest status)

* **Documents** — the checklist records a reference and a note; **no upload**
  exists. Secure deposit remains to be built (section 11).
* **MRA e-invoicing** — a slot in the Sales domain, explicitly "no
  transmission".
* **"Instances" (domain 2)** — the requested wording is kept with a note that
  the concept still needs clarification with the firm; only the extensible
  structure exists.
* **AI assistant** — the existing governance is reused unchanged; no new
  provider, no new key, no new prompt surface.
* **Advanced search and enriched sector templates (P2)** — basic search/filter
  only.

### Not done (explicitly out of scope)

* Real MRA transmission, statutory KYC validation, OCR changes, bank
  reconciliation changes (Mission 43 stays separate), payroll, VAT and fixed
  assets changes.

## 5. Screens

| Screen | Route | Source |
| --- | --- | --- |
| Cabinet portfolio | `/cabinet` | `apps/web/src/pages/cabinet/CabinetDashboard.tsx` |
| Guided creation (6 steps) | `/cabinet/clients/new`, `?draft=<id>` | `apps/web/src/pages/cabinet/CreateClient.tsx` |
| Client workspace | `/cabinet/clients/:companyId/workspace[/:section]` | `apps/web/src/pages/cabinet/ClientWorkspace.tsx` |
| Onboarding focus | `/cabinet/clients/:companyId/onboarding` | same page, `sectionOverride="onboarding"` |
| Existing cabinet screens (preserved) | `/cabinet/companies`, `/cabinet/companies/:id`, `/cabinet/tasks` | unchanged |

Shared UI: `apps/web/src/components/cabinet/StepList.tsx` (step rail,
progress bar), `apps/web/src/cabinet/workspace.ts` (types, label helpers,
module catalogue view, availability badges). Styles are an additive block at
the end of `apps/web/src/styles.css`.

## 6. API routes

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/api/cabinet/workspace` | portfolio, indicators, metric details, drafts, upcoming tax tasks, activity |
| `GET` | `/api/cabinet/workspace/options` | sectors, KYC template, modules, legal forms |
| `GET` | `/api/cabinet/workspace/clients/:companyId` | detail: onboarding, KYC checks, checks & balances, availability, tasks, members, audit excerpt |
| `PATCH` | `/api/cabinet/workspace/clients/:companyId/onboarding` | sector, notes, modules, setup, status (`write`) |
| `PATCH` | `/api/cabinet/workspace/clients/:companyId/onboarding/kyc/:key` | one checklist item (`write`) |
| `GET` | `/api/cabinet/workspace/drafts` | own drafts |
| `POST` | `/api/cabinet/workspace/drafts` | create or update a draft |
| `PATCH` | `/api/cabinet/workspace/drafts/:draftId` | own draft |
| `DELETE` | `/api/cabinet/workspace/drafts/:draftId` | own draft |
| `POST` | `/api/cabinet/workspace/drafts/:draftId/activate` | creates the client file, `409` if incomplete, audited |

Access to an **existing** client file is decided by the existing module ACL
(`requireModuleAccess(..., 'cabinet', 'read' | 'write')`) and every query is
filtered on the companies the signed-in user belongs to. Draft activation has
the same authorisation model as `POST /companies`, which is open to any
authenticated user: the draft must belong to the caller, the server re-checks
every prerequisite, and the creator becomes owner of the new dossier only. No
existing dossier can be modified through this route. (Mission 44.1 corrected an
earlier draft of this report that described activation as "admin-gated".)

## 7. Migrations

One migration: `apps/api/sql/migrations/0027_cabinet_onboarding.sql`
(112 lines, additive, reversible). Renumbered from `0025_…` by the Mission 44.1
audit: Mission 42 owns migration 0025 and Mission 43 owns 0026 on their own
branches (section 16).

* 8 nullable columns on `companies` (`trade_name`, `contact_name`,
  `contact_email`, `contact_phone`, `legal_form`, `incorporation_date`,
  `business_description`, `country`).
* 3 new tables: `client_onboarding`, `client_kyc_checks`,
  `cabinet_client_drafts`, with their indexes and unique constraints.
* Down migration documented in the file header and in
  `docs/cabinet-onboarding.md` §2 (`IF EXISTS` forms, idempotent).
* No `DROP`, no `UPDATE`, no data backfill; existing dossiers keep working.

PostgreSQL coverage: `apps/api/tests/migrations.test.ts` applies the whole
chain on a fresh database (6 tests, all passing).

## 8. Exact test and build results

Executed in this sandbox on the branch head's parent (identical source):

| Command | Result |
| --- | --- |
| `npm ci` (root) | success |
| `npm run typecheck -w @mc/api` | exit 0 (no error) |
| `npx tsc -p apps/web/tsconfig.json --noEmit` | exit 0 |
| `npx tsc -p apps/web/tsconfig.test.json --noEmit` | exit 0 |
| `npm run test -w @mc/api` | **38 files passed, 1 skipped; 552 tests passed, 11 skipped** (re-run during 44.1) |
| `npx vitest run tests/mission44-progress.test.ts tests/mission44-onboarding.test.ts --root apps/api` | 2 files, **26 tests passed** (25 + the 44.1 double-submission case) |
| `npm run test -w @mc/web` | **58 files, 390 tests passed** |
| `npx vitest run tests/mission44-workspace.test.tsx` | **8 tests passed** |
| `npm run typecheck -w @mc/web` (both tsconfigs) | exit 0 |
| `npm run build -w @mc/api` | success |
| `npm run build -w @mc/web` | success — `index.html` 1.41 kB, CSS 88.21 kB, JS 1 388.03 kB (gzip 342.22 kB) |
| `npm run build:demo -w @mc/web` | success |
| `node scripts/verify-demo.mjs --dist apps/web/dist --base /mauritius-compta/` | **50 controls, 0 failures** |
| real bundle build + `verify-demo.mjs --real-dist` | **5 controls, 0 failures** |
| Playwright e2e (`apps/web/e2e/mission44-workspace.spec.ts`) | **NOT EXECUTED** — no Chromium binary and no browser-download network access in this sandbox. The spec is written for both declared projects (desktop 1440×900, Pixel 7) and the exact commands are in its header. |

CI on PR #24 (`gh pr checks 24`, after the second push):

| Check | Result |
| --- | --- |
| Typecheck, tests and build | **pass** (2m56s) |
| API tests against real PostgreSQL | **pass** (3m5s) |
| Migrations against real PostgreSQL | **pass** (41s) |
| Build demo bundle | **pass** (1m57s) |
| Deploy to GitHub Pages | skipped — expected, the job only runs on `main` |

New tests added by this mission:

* `apps/api/tests/mission44-progress.test.ts` — 12 cases (step statuses,
  blocking, `pending_review` ≠ completed, percent arithmetic, readiness).
* `apps/api/tests/mission44-onboarding.test.ts` — 13 cases (portfolio scoping,
  KYC derivation, onboarding update, activation guard, audit, multi-tenant
  isolation, drafts).
* `apps/web/tests/mission44-workspace.test.tsx` — 8 journeys (portfolio and its
  seven-plus-one indicators, search/sector filters, full six-step activation,
  draft save/resume, KYC update in the workspace, fourteen-section navigation,
  EN switch, mobile card layout without a network call).

Existing suites were updated in exactly one place: the navigation inventory in
`apps/web/tests/mission38-navigation.test.ts` moves from 60 to 61 destinations
because Mission 44 adds the `Create New Client` entry. The test now also
asserts that the new destination exists exactly once.

## 9. Security controls

* **Session + module ACL** — every route requires an authenticated session and
  passes through `requireModuleAccess(..., 'cabinet', 'read' | 'write')`; the
  demo date/locale helpers never bypass it.
* **Multi-tenant isolation** — all reads and writes are filtered on the
  companies of the signed-in user; a test creates two firms and asserts that
  neither sees the other's client, checklist or draft.
* **Draft privacy** — drafts are scoped to `user_id`; another accountant in the
  same firm cannot list, open or activate them (404, not 403, so the existence
  of another user's draft is not disclosed).
* **Activation gate** — server-side prerequisites (sector, ≥ 1 module, complete
  setup, valid financial year, unique BRN/client code, non-blocked KYC) are
  enforced by the API, not by the UI; the route mirrors `POST /companies`'s
  authorisation (authenticated caller + draft ownership) and grants rights on
  the newly created dossier only.
* **Double-submission guard (44.1)** — activation locks the draft row
  (`SELECT … FOR UPDATE`) inside the transaction and re-reads it, so two
  concurrent activations of one draft produce exactly one dossier and one
  `404 DRAFT_NOT_FOUND`.
* **Audit trail** — `cabinet.onboarding.activate`, `cabinet.onboarding.update`
  and `cabinet.kyc.update` are written to `audit_log` in the same transaction
  as the change.
* **No document storage** — `document_ref` is a string reference. The UI states
  that secure deposit does not exist yet; no binary, no path, no signed URL.
* **No secrets** — no provider key, no credential, no personal document in the
  repository. The demo bundle secret scan (part of the Pages workflow) and
  `verify-demo.mjs` (local run) both pass.
* **Demo/production separation** — the demo backend is compiled only when
  `VITE_DEMO_MODE=true`; the real bundle check proves that the demo chunk,
  demo state and fictional samples are absent. Demo credentials exist only in
  the demo build and cannot authenticate against the API.

## 10. Demonstration limitations

1. Three fictional clients, one fictional draft, no real accounting data. Every
   company name ends with `(DEMO)` and every label says "démonstration".
2. The demo runs entirely in the browser: no API, no database, no MRA, no
   e-mail, no file upload.
3. The demo resets on reload only when `localStorage` is cleared; otherwise the
   state survives a refresh (schema 18 with forward migrations).
4. Percentages are computed by the same deterministic rule as production; they
   are not crafted to look good.
5. KYC items can be ticked but no document is stored; **secure document deposit
   is not built**.
6. The e-invoicing domain is a slot: nothing is transmitted to the MRA.
7. Real-mode users with no cabinet access see the existing screens unchanged;
   the portfolio is empty rather than invented.

## 11. Screenshots

Not produced: this sandbox has no browser binary, so no genuine screenshot
could be captured, and a fabricated image would be a false artifact. The demo
build is served live (section 12) for the owner to capture the screens. Nothing
in this report claims a visual that was not observed.

## 12. Preview

The demo build of the branch is served from this session:

* Live preview: **https://4173-i5te6xkqxc2lvbrxxub2f.e2b.app/mauritius-compta/**
* Local equivalent: `http://localhost:4173/mauritius-compta/`

Availability: the process runs for the lifetime of the session. The page is a
pure client-side demo (HashRouter, base `/mauritius-compta/`, 50/50 bundle
controls). The public GitHub Pages site is **not** updated by this branch: the
Pages workflow only builds and verifies for `arena/**` and deploys from `main`.

## 13. Technical risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Demo state and API drift | demo shows a field the API ignores | shared catalogue in `apps/api/src/modules/cabinet-onboarding/catalogue.ts`; demo mirrors the same shapes; web tests assert behaviour, API tests assert contracts |
| `%` interpreted as a KPI of quality | misleading management reading | rule is six boolean steps, documented and unit-tested; label says "parcours", not "conformité" |
| "Instances" ambiguity | the firm may mean something else | wording kept, clarification explicitly flagged in the domain description |
| KYC ticked without documents | false sense of compliance | UI and report state that no document is stored and that no authority validates the file |
| Cross-package imports (`apps/web` → `apps/api/src`) | coupling | used only for pure catalogue/progress modules with no I/O; flagged for extraction to a shared package before production |
| Bundle size | 1.39 MB single chunk warning | pre-existing; M44 adds ~30 kB. Splitting is a separate mission |
| Demo schema 18 | old local states need migration | forward migrations from 14/15/16/17 and a `resetDemo()` path, covered by web tests |

## 14. Scope compliance

* Accounting engine, payroll, VAT, fixed assets, inventory, bank reconciliation
  and OCR: **not modified**. The client creation path calls the existing
  service.
* Mission 42 (PR #23): untouched, not rebased, not integrated.
* Mission 43 (banking): the workspace links to the existing bank screens; no
  banking work was started or merged.
* GitHub Pages workflows: unchanged. They already build and verify `arena/**`
  without publishing; nothing was added to publish a draft PR.
* No `main` merge, no production deploy, no VPS change, no SSH, no credential.

## 15. Pre-merge recommendations

1. **Run the browser suite** where Chromium is available:
   `npm run test:e2e:install -w @mc/web` then
   `E2E_BASE_URL=… npm run test:e2e -w @mc/web`. It is the only unexecuted
   verification, and it covers the desktop and phone projects.
2. **Review the copy with an accountant**: six-step labels, the nine sectors,
   the "instances" wording, and the `checks & balances` list (only implemented
   controls are listed — confirm none is over-claimed).
3. **Decide the firm-level access model**: today any signed-in accountant can
   create a *new* client file from their own draft (parity with the existing
   company creation), while editing an existing file requires cabinet `write`
   and activating a file's onboarding requires `admin` (see the permission test
   in `apps/api/tests/mission44-onboarding.test.ts`). If a firm wants to
   restrict who may open new dossiers, that is a new ACL rule to decide and
   implement — the UI cannot enforce it.
4. **Plan secure document deposit** (storage, virus scan, retention, access
   log) before any KYC reference becomes a file.
5. **Consider extracting the shared catalogue** into a workspace package to
   remove the `apps/web → apps/api/src` import.
6. **Then merge** — after a green CI run on the branch and an owner review of
   this report.

---

## 16. Mission 44.1 — Final Pre-Merge Compatibility Audit

Executed on 2026-11-01/02 on `arena/b8889b50-mauritius-compta`, without
merging anything, without touching `main`, PR #23, the Mission 42 branch or the
Mission 43 work, and without any VPS access.

### 16.1 How migrations are discovered, ordered and tracked

`apps/api/src/db/index.ts` (`migrate`) is the only runner:

1. `readdir('apps/api/sql/migrations')`, keep `*.sql`, **sort lexicographically**.
2. `CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY,
   checksum text NOT NULL, applied_at timestamptz)`.
3. For each file: `version = <full filename>`, `checksum = sha256(content)`.
   Already recorded → **only** a checksum mismatch aborts (`checksum mismatch`);
   otherwise skipped.
4. Not recorded → executed in its own transaction with its `INSERT` of the
   version row.

Three properties follow and are now pinned by tests:

* **The version is the filename, not the number.** Two branches can therefore
  ship different files with the same numeric prefix without a primary-key
  clash — `0025_cabinet_onboarding.sql` and
  `0025_mission42_purchase_sales_integrity.sql` would both have applied, sorted
  `cabinet…` before `mission42…`.
* **There is no "out of order" refusal.** A migration added later with a lower
  number still runs, because the loop only looks at files that are not yet
  recorded. Merging M42/M43 *after* M44 is therefore safe at runtime.
* **A recorded version whose file disappeared is ignored.** A stale row is
  inert, never an error.

### 16.2 Collision analysis and the renumbering decision

| Branch | File | Number |
| --- | --- | --- |
| Mission 42 | `0025_mission42_purchase_sales_integrity.sql` | 0025 |
| Mission 43 (same branch head) | `0026_mission43_bank_reconciliation_periods.sql` | 0026 |
| Mission 44 before the audit | `0025_cabinet_onboarding.sql` | **0025 (duplicate)** |
| Mission 44 after the audit | `0027_cabinet_onboarding.sql` | **0027** |

The duplicate number could not fail at runtime, but it made the shared sequence
ambiguous: the next feature would not know whether 0026 was free, and two files
claiming 0025 invite a future reader to assume they are alternatives.

**Correction applied:** `git mv` from `0025_cabinet_onboarding.sql` to
`0027_cabinet_onboarding.sql`. The SQL body is **byte-identical** (rename only,
plus a header comment recording the reason), so no operation, column, index or
constraint changed. References updated in `docs/cabinet-onboarding.md` and this
report; no test, script or CI file referenced the filename.

Why renaming an applied migration is safe here:

* Mission 44 has never been merged, deployed or applied to a shared database:
  only draft-PR environments exist, where a rename cannot break a release.
* The migration is fully idempotent (`ADD COLUMN IF NOT EXISTS`,
  `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`), so an
  environment that applied it under the old name simply applies it again under
  the new name without effect.
* The old row, if present, stays in `schema_migrations` and is ignored by the
  runner (property 3 above). No tracking row is ever deleted or rewritten.

### 16.3 Migration tests actually executed

`apps/api/tests/mission44-migration-compat.test.ts` (new, 5 cases):

1. One unique numeric prefix per file; 0025/0026 are not ours; files are
   already in lexicographic order.
2. Fresh database: the whole chain applies, `0027_cabinet_onboarding.sql` is
   last in version order and the three tables exist.
3. Database already migrated by **Mission 42 + Mission 43** (their versions
   recorded, all our other migrations applied): the merge applies **exactly**
   `0027_cabinet_onboarding.sql`, leaves the foreign rows untouched, creates the
   M44 objects next to theirs, and a second run applies nothing.
4. Database that applied the **old 0025 M44 filename**: the renumbering applies
   `0027` again (idempotent), the stale row stays inert, second run no-op.
5. Checksum guard: a modified applied migration still aborts with
   `checksum mismatch` (documented behaviour preserved).

Result: **5/5 passing.** The existing `migrations.test.ts` (6 cases, fresh
database + idempotence + recorded checksums) still passes, and CI's
"Migrations against real PostgreSQL" job applies the chain on PostgreSQL 16 —
**pass (30 s)** on commit `71c4201`.

### 16.4 Git compatibility with `main`, Mission 42 and Mission 43

Compared with `git merge-tree --write-tree` (read-only simulation, no merge
performed) against `origin/arena/e8400c4a-mauritius-compta` (whose head
`9dd1477` already contains the Mission 43 bank-period commit):

* **Migrations:** the simulated merge tree contains
  `0025_mission42…`, `0026_mission43…` and `0027_cabinet_onboarding` — three
  distinct versions, no path conflict, no duplicate number.
* **Common files:** 5 (`apps/api/src/lib/errors.ts`, `apps/web/src/App.tsx`,
  `apps/web/src/demo/runtime.ts`, `apps/web/src/i18n.tsx`,
  `apps/web/src/styles.css`) out of 30 M44 files and 45 M42/M43 files.
* **Only conflict:** `apps/web/src/styles.css` — both branches append a block
  at end of file (M42: one `.allocation-item` rule; M44: ~332 lines). The
  resolution is the union of both blocks; neither side touches the other's
  selectors (M44 defines no `.allocation-item`).
* **Auto-merged files verified semantically** on the simulated tree:
  `errors.ts` keeps all M42 error codes **and** `ONBOARDING_INCOMPLETE`; the
  `ErrorCode` union gains no duplicate member (`DOCUMENT_NOT_FOUND` is a
  pre-existing duplicate, unchanged); `App.tsx` keeps both route sets with no
  duplicate `path`; `i18n.tsx` keeps M42's keys and both `M44_FR`/`M44_EN`
  spreads with no key appearing more than once per language object;
  `runtime.ts` keeps both dispatch paths and no duplicate top-level identifier
  is introduced in any of the four files.
* **Demo schema:** `main` and the M42 branch are at demo schema 17, M44 at 18.
  M44's `17 → 18` upgrade keeps the parsed state by reference (`state =
  parsed`) and only adds `cabinetWorkspace`, so Mission 42's new fields survive
  the upgrade; M42's demo additions rely on `??` defaults rather than a schema
  bump.

### 16.5 Risks of integrating Mission 43

* No shared table, column, index or constraint: M43 owns
  `bank_reconciliation_periods`; M44 owns `companies` descriptive columns +
  `client_onboarding`, `client_kyc_checks`, `cabinet_client_drafts`.
* No shared API module, no shared route, no shared web page. The client
  workspace only deep-links to the existing bank screens.
* Ordering: if M43 merges **after** M44, its `0025`/`0026` are applied out of
  numeric order — supported by the runner (16.1) and asserted by test 3.
* The M42 branch head currently also carries a Mission 43 commit (`9dd1477`).
  It was read only, never modified. If M42 and M43 are eventually split into
  two PRs, the migration numbers 0025/0026 remain unique with respect to M44.

### 16.6 Corrections made by this audit

| Correction | Reason |
| --- | --- |
| Migration `0025_…` → `0027_cabinet_onboarding.sql` | duplicate number with Mission 42, ambiguous shared sequence |
| `SELECT … FOR UPDATE` + re-read inside the activation transaction | two concurrent activations of one draft could create two client files |
| Report/doc wording on activation permissions | the API does not apply an "admin-only" rule to creating a *new* file; it mirrors `POST /companies` (authenticated caller + draft ownership). Cabinet `write` is required to configure an existing file, cabinet `admin` to approve/assign/verify KYC |
| `.gitignore` gains `apps/web/dist-real/` | the CI real-bundle build left an untracked directory |
| New tests | 5 migration-coexistence cases + 1 double-submission case |

Nothing else was changed: no accounting module, no calculation, no route
signature, no UI behaviour.

### 16.7 Functional verification of the Mission 44 journeys

Automated (jsdom, in-browser demo backend, no network call) unless stated:

| # | Journey | Result |
| --- | --- | --- |
| 1 | Cabinet dashboard | pass — 8 indicators, portfolio, drafts, context |
| 2 | `Create New Client` | pass — sidebar entry + header button + empty-state button |
| 3 | Company information + validation | pass — required fields block the step, errors rendered |
| 4 | KYC checklist | pass — 12 items, statuses, "checklist only" disclaimer |
| 5 | Sector selection | pass — 9 sectors, mode apply/modify |
| 6 | Accounting setup | pass — accrual-only statement, defaults pre-filled |
| 7 | Module selection | pass — availability badges, at least one required |
| 8 | Draft save + resume | pass — save, cancel, resume, values restored |
| 9 | Activation with the right permissions | pass — API 201 for the draft owner, 403 for a viewer on an existing file, admin required to approve |
| 10 | Open the new client workspace | pass — redirected to `/workspace`, company listed, draft consumed |
| 11 | Navigate the eight domains | pass — 14-section nav + 8 domain cards, deep links |
| 12 | English and French | pass — full journey switched to EN in the test; FR default |
| 13 | Android/mobile display | pass in jsdom (card list replaces the table at 390 px, wizard single column). **No real browser rendering was executed** — see 16.8 |
| 14 | Rights and multi-company isolation | pass — API tests: two firms, no cross-visibility; drafts private (404) |

Error paths: empty name/address blocked client-side; incomplete draft →
`400` with the missing field; duplicate BRN → `409`; unknown sector/module →
`400`; viewer write → `403`; foreign draft → `404`; double submission → one
`201` + one `404` (new). Not exercised: simultaneous activation from two
different browser tabs in a real browser (covered at the API level only).

### 16.8 Tests and builds actually executed during this audit

| Command | Result |
| --- | --- |
| `npm run typecheck -w @mc/api` | pass |
| `tsc -p apps/web/tsconfig.json --noEmit` | pass |
| `tsc -p apps/web/tsconfig.test.json --noEmit` | pass |
| `npm run test -w @mc/api` | **552 passed, 11 skipped (38 files passed, 1 skipped)** |
| `npx vitest run tests/mission44-onboarding.test.ts` (API) | **14 passed** (incl. double submission) |
| `npx vitest run tests/mission44-migration-compat.test.ts` (API) | **5 passed** |
| `npm run test -w @mc/web` | **390 passed (58 files)** |
| `npm run build -w @mc/api` | pass |
| `npm run build -w @mc/web` | pass |
| `npm run build:demo -w @mc/web` + `verify-demo.mjs --dist` | **50 controls, 0 failures** |
| real bundle + `verify-demo.mjs --real-dist` | **5 controls, 0 failures** |
| Playwright (`e2e/mission44-workspace.spec.ts`) | **NOT EXECUTED** — no Chromium binary, no browser-download network access. The spec exists for desktop 1440×900 and Pixel 7 and its header lists the commands. |

### 16.9 CI on PR #24

Commit `71c4201` (code + tests + docs):

| Check | Result |
| --- | --- |
| Typecheck, tests and build | **pass** (4m5s) |
| API tests against real PostgreSQL | **pass** (2m43s) — includes the double-submission case on real PostgreSQL |
| Migrations against real PostgreSQL | **pass** (30s) |
| Build demo bundle | **pass** (1m46s) |
| Deploy to GitHub Pages | skipped — expected, `main` only |

The docs-only follow-up commit that adds this section re-ran the same four
checks on the final branch head: **all pass** (typecheck/tests/build,
PostgreSQL API tests, PostgreSQL migrations, demo bundle), Pages deploy skipped.

### 16.10 Residual risks

1. **The real browser suite has never run**: CSS/Android behaviour is asserted
   in jsdom only. The first merge candidate should run Playwright somewhere a
   Chromium download is possible.
2. **Web → API source import** (`apps/api/src/modules/cabinet-onboarding/*`
   from `apps/web`): pure data and pure functions today (no `node:*`, no `pg`,
   verified in the built bundles), and the repository already does this for
   `bank`/`migration` types. It couples the two builds; extracting a shared
   package is the clean fix.
3. **Draft retention**: drafts hold prospect contact data and are kept until
   activated or deleted by their author. There is no purge. A retention rule
   (e.g. delete after 90 days, or on firm request) needs a product decision.
4. **KYC references are free text**: no upload exists, so nothing can leak, but
   a reference can be meaningless. Secure deposit is explicitly not built.
5. **Styles conflict on merge** (16.4) is a two-minute manual resolution; it is
   the only expected conflict.
6. **UI permission hints** come from `cabinet_access` computed server-side; the
   server remains the authority (tested), the UI is only cosmetic.
7. **No `main` deployment of the demo** from this branch, so the published
   GitHub Pages site still shows the pre-M44 build until this PR merges.

### 16.11 Verdict

**READY FOR MERGE**, with two conditions:

1. the merge itself resolves the single `styles.css` conflict by keeping both
   appended blocks (16.4), and
2. the Playwright suite (16.8) is run once in an environment with a browser,
   as an explicit pre-merge gate.

No blocking defect was found in the accounting engine, the migrations, the
permissions or the demo/production separation. The one functional defect found
by the audit (double submission) is fixed and covered by a test that also runs
against real PostgreSQL in CI. Merging and publishing remain the owner's
decision: this branch did neither.
