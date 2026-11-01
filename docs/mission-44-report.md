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
| Final code commit | `71247a676064b215ce9fb5478d3f2ae1a7e065c6` |
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

Access is decided by the existing module ACL; every query is filtered on the
companies the signed-in user belongs to. Activation additionally requires
admin-level access to the cabinet module.

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
| `npm run test -w @mc/api` | **37 files passed, 1 skipped; 546 tests passed, 11 skipped** |
| `npx vitest run tests/mission44-progress.test.ts tests/mission44-onboarding.test.ts --root apps/api` | 2 files, **25 tests passed** |
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
  same firm cannot list or open them.
* **Activation gate** — server-side prerequisites (sector, ≥ 1 module, complete
  setup, non-blocked KYC) plus admin-level access; the UI cannot bypass it.
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
3. **Decide the cabinet access model**: activation currently requires
   admin-level cabinet access. If a firm wants senior accountants to activate,
   that is an ACL rule change, not a UI change.
4. **Plan secure document deposit** (storage, virus scan, retention, access
   log) before any KYC reference becomes a file.
5. **Consider extracting the shared catalogue** into a workspace package to
   remove the `apps/web → apps/api/src` import.
6. **Then merge** — after a green CI run on the branch and an owner review of
   this report.
