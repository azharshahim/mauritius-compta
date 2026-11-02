# Mission 45.1 — M42/M43 + M44 integration

Date: 2 November 2026 (Europe/Paris).

## Candidate and provenance

- Repository: `azharshahim/mauritius-compta`.
- Branch: `integration/m42-m43-m44`.
- Draft PR: https://github.com/azharshahim/mauritius-compta/pull/25
- Base main: `cc5698457061dc2618a3b9b83967098840bb87ec`.
- PR #23: `b352a534c40a0a73ca65518d51452ad85c41c7ae`.
- PR #24: `f370e28c775347e8834ed8869aa24be4238a7f44`.
- Integration merge: `2232ef4aeb849f66acd907ec172a09cbae714cdc`.
- Code candidate: `ff4917c9878740603d24cefd0cfb7b9b2700347f`.
- The report commit is identified by the PR head; a report cannot contain its own commit hash.

Initial connector inspection confirmed both source PRs open, draft, unmerged,
with successful quality, PostgreSQL API, PostgreSQL migration and demo checks;
Pages deployment was skipped. The remote integration branch did not exist.
Reports M42, M43 and M44 (including its M44.1 audit) were read. The M45 report
was absent from all fetched repository histories; the two findings supplied
in the mission were independently reproduced.

## Integration and corrections

M42/M43 was integrated first from the latest main, then M44.1. Both source
histories remain parents of the integration commits. Original branches and
PRs were not modified. The CLI could clone but could not authenticate a push;
the GitHub connector uploaded the exact Git blobs and tree instead. The remote
tree matched the locally tested tree (`03eb8c901a643c41603053bfbe6a4ff76c76a36e`
before the E2E-only extension). No force push or history replacement was used.

The only Git conflict was the additive tail of `apps/web/src/styles.css`.
Both the M42 payment `.allocation-item` selector and the complete M44 CSS block
were retained. No `ours`/`theirs` strategy was used. M44 selectors have their
own namespace and use the existing theme palette. No accounting calculation
or tax rule was changed.

An additional client-context bug was found: `ClientWorkspace` tested membership
in `companies` instead of comparing with the current session company. A member
of multiple companies could therefore open a module with the wrong active
company. Navigation now switches to the workspace company first. A regression
journey opens another client and checks the stored company before opening its
chart. The browser extension covers accounting, purchases and banking in both
themes on desktop and Pixel 7.

## Migrations

The M44 compatibility assertion now requires the actual M42/M43 files, rather
than asserting their absence. The production migration runner and all three
SQL files are unchanged.

| File | SHA-256 |
| --- | --- |
| `0025_mission42_purchase_sales_integrity.sql` | `14c26039b728d5453943c7452559d0ceb12d54ff964e6442fb8d9ea185ea0b2e` |
| `0026_mission43_bank_reconciliation_periods.sql` | `a62425a3a46f85c4b634cf69e7c4e4463d2dd3092dbe39c2fe91a679c256ee13` |
| `0027_cabinet_onboarding.sql` | `72cfb0b7ffaa6aa7b6e8847d71cd189347186ec5ca96b803b89f9ca171ef48fb` |

Six compatibility tests cover unique numeric prefixes, a fresh full chain,
M42/M43 already applied, M44 applied before M42/M43, the historical old M44
filename, and checksum tampering. The reverse-order scenario checks every
recorded checksum and preservation of company identity/trade name. Repeated
migration runs are no-ops. M43's two legacy-data tests additionally preserve
payment `1234.5678`, its reference, custom account 1150 labels and additive
columns. Migration order is lexicographic; tracking uses full filenames.

The new CI migration job runs these compatibility tests on a disposable
PostgreSQL 16 database. The test refuses a server URL unless its database is
named `mauritius_compta_m45_test`; only this explicit opt-in path resets its
schema. The ordinary test path continues to use isolated PGlite instances.
No production database or real customer data was used.

## Locally executed checks

| Check | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run typecheck` (API + both Web configs) | exit 0 |
| API suite | 41 files passed, 1 skipped; 570 tests passed, 11 skipped |
| Web suite | 60 files passed; 397 tests passed |
| M42 API / UI | 10 / 3 passed |
| M43 API / demo / legacy migrations | 5 / 3 / 2 passed |
| M44 onboarding / progress / compatibility | 14 / 12 / 6 passed |
| M44 Web including context regression | 9 passed |
| Security M35 | 14 passed |
| `npm run build` (Web + API) | exit 0 |
| `npm run build:demo` | exit 0 |
| `verify-demo --dist apps/web/dist --base /mauritius-compta/` | 50 passed, 0 failed |
| `VITE_DEMO_MODE=false vite build --outDir dist-real` + real-bundle verifier | 5 passed, 0 failed |
| `git diff --check`, tracked environment/key-file scan | clean |

The local API skips are existing PostgreSQL-only concurrency/lettering cases;
they are not claimed as passed locally. Real PostgreSQL CI is the authority
for those paths. An initial real-bundle check accidentally inspected the demo
output after concurrent builds shared `dist`; it correctly failed. Rebuilding
the real bundle into separate `dist-real` passed all five controls.

## Browser and CI validation

Local `playwright install chromium` failed because the browser download was
truncated/invalid. The package-manager fallback failed on the environment's
setgroups/setuid restrictions. No jsdom test is described as a real-browser
result. `.github/workflows/integration-e2e.yml` installs Chromium on GitHub's
runner and executes the actual desktop 1440x900 and Pixel 7 projects, with a
15-minute timeout and failure traces/screenshots. It cannot deploy Pages.

Browser harness corrections: the demo preview must inherit `VITE_DEMO_MODE=true`
so its `/mauritius-compta/` base matches the build. The first valid Chromium run
then passed nine journeys but failed two portfolio assertions because the same
client also appeared in the upcoming-tasks area. Assertions are now scoped to
the portfolio container; the filter itself was not changed. The desktop skip
is intentional: the phone-only overflow case runs in the Pixel 7 project.
The harness uses a bounded 30-second test timeout and GitHub diagnostic output.
Successful light/dark accounting, purchases and banking screenshots are saved
as CI artifacts for inspection.

CI on code candidate `ff4917c` (PR-triggered workflows):

| Job | Result | Evidence |
| --- | --- | --- |
| Typecheck, tests and build | pass | [CI](https://github.com/azharshahim/mauritius-compta/actions/runs/41365217064) |
| API tests against real PostgreSQL 16 | pass — 42 API files, 581 API tests; 60 Web files, 397 Web tests; no skipped test in the server API suite | [job](https://github.com/azharshahim/mauritius-compta/actions/runs/41365217064/job/125023948842) |
| Fresh PostgreSQL migrations, repeat run, fictional seed/schema audit | pass | [job](https://github.com/azharshahim/mauritius-compta/actions/runs/41365217064/job/125023948765) |
| Build demo, verify-demo, real build/separation, secret-pattern scan | pass | [demo build](https://github.com/azharshahim/mauritius-compta/actions/runs/41365217035) |
| Chromium desktop + Pixel 7 | pass | [browser gate](https://github.com/azharshahim/mauritius-compta/actions/runs/41365217085/job/125023833487) |
| PostgreSQL migration compatibility (all six scenarios) | pass | [migration gate](https://github.com/azharshahim/mauritius-compta/actions/runs/41365217085/job/125023833726) |
| Deploy to GitHub Pages | skipped, as required | [demo workflow](https://github.com/azharshahim/mauritius-compta/actions/runs/41365217035) |

The custom integration workflow is restricted to this integration PR and relevant
code/workflow paths. It no longer runs duplicate push and PR jobs; superseded
runs were cancelled while iterating. Only the completed candidate runs above
are evidence for the verdict. The existing Pages workflow is unchanged.
Browser final results on `ff4917c`: **11 passed, 1 intentional desktop skip,
0 failures**. Actual Chromium ran desktop 1440x900 and Pixel 7. The phone-only
overflow assertion passes on Pixel 7; it is intentionally skipped on desktop.
Creation, KYC change, activation, draft save/resume, portfolio search/sector,
and accounting/purchases/bank navigation with company-context retention pass.
Both light and dark journeys pass on both device profiles.

Evidence: https://github.com/azharshahim/mauritius-compta/actions/runs/41365217085

The predecessor run (`df2e232`) had nine passed journeys and two failures due
to an incorrect sector assumption in the old browser spec: Case Noyale Retail
is seeded with `professional_services`, not `trading_retail`. The filter test
now uses Belle Mare and `hospitality_tourism`, matching the existing Web test
and stored fixture. No seed data or product filter was changed. Twelve module
screenshots were generated. The mobile light banking and desktop dark purchases
captures were downloaded and visually inspected: readable layouts and theme
palette, with the correct client shown in the company selector.

### Final delivery CI and intermittent-test follow-up

The report-only delivery `b96b02f57420d52b05e4c8fa2691bca774ba9be9` also
passed every PR gate: [quality/PostgreSQL](https://github.com/azharshahim/mauritius-compta/actions/runs/41365894988),
[demo/separation](https://github.com/azharshahim/mauritius-compta/actions/runs/41365895060),
[Chromium + migration compatibility](https://github.com/azharshahim/mauritius-compta/actions/runs/41365894957).
Pages deployment was skipped. Its only diff against `ff4917c` is this report.

One parallel **push-triggered** run on `ff4917c` initially failed a Web test
inside the job named “API tests against real PostgreSQL” (that job runs root
`npm test`, including Web). The API suite itself passed. The failing assertion
was `demo-app.test.tsx`, assistant suggestion journey: heading “Assistant
comptable” was not found within Testing Library's asynchronous wait. That
same file passed locally, 11/11, and the PR-triggered full suite passed. Only
the failed job was re-run; [attempt 2 succeeded](https://github.com/azharshahim/mauritius-compta/actions/runs/41365213188/attempts/2).
No product code, expected amount or timeout was changed to get that retry green.
Timing sensitivity under CI load is a plausible inference, not a proven root
cause. Keep this intermittent jsdom navigation assertion as a residual test
stability risk; a future repeat must be investigated rather than hidden by
blanket retries. The independent Chromium onboarding/module journeys passed.

## Functional and security scope

The integrated API/Web suites retain equity closing, fixed assets, inventory,
purchases, sales, advances and payment allocations, OCR/import, VAT/reports,
ledger/customer/supplier controls, bank imports, reconciliation periods and
customer receipts from banking. No second accounting engine was introduced.
The Cabinet portfolio, six-step onboarding, draft save/resume, KYC checklist,
sector/setup/module selection, activation and client workspace coexist with
these modules. Automated module tests are evidence of covered scenarios, not
an expert accounting acceptance of every possible workflow.

M44 API tests cover cross-cabinet isolation, private drafts, write/admin
permissions, invalid activation, duplicate BRN, audit and concurrent activation
(exactly one company). M35 covers authentication, cross-site writes, roles,
IDOR/company isolation and cookie defaults. M42/M43 cover transaction integrity,
no automatic posting from bank validation or receipt creation, and duplicate
prevention. Demo verification scans public resources for secret patterns;
real-bundle verification excludes demo runtime, credentials and fictional data.
These checks are not an independent penetration test.

## Residual limits

- No secure KYC document repository and no legal KYC certification.
- No real MRA transmission; e-invoicing remains outside the operational scope.
- P0-03 independent security review, P0-04 MRA and P0-05 payroll acceptance remain
  open. This integration cannot authorize operational production use.
- Account 1150 and Mauritian accounting/tax treatment require expert review.
- Bank-created supplier payment remains partial (existing-payment link only).
- Validated bank periods export CSV; no PDF period export.
- OCR rescanning/multiple-invoice separation and unposted-sales presentation
  retain the source reports' limitations.
- Draft retention has no automatic purge policy; no load test was performed.
- Both bundles retain Vite's large-chunk warning.

## Verdict and recommended merge plan

**READY FOR MERGE — integrated development/demo candidate only.**

All mandatory technical gates passed on code candidate `ff4917c`. This verdict
does not clear the production gaps above or authorize a merge/publication.
The final follow-up adds only this report; its PR head is the latest delivery
commit, while the immutable code-validation evidence remains linked above.
Documentation-only CI may re-run automatically; do not confuse that re-run
with a change to the tested application. Before an eventual authorized merge,
recheck that main/source heads have not moved and that no new check has failed.

After all gates pass and the owner explicitly authorizes the operation,
merge only PR #25 using a merge commit to preserve both source histories.
Do not separately merge #23 or #24, and avoid squash/rebase if preserving their
ancestry is required. Close the original PRs as superseded only after owner
authorization. Inspect Pages publication separately: existing Pages workflow
publishes on a push to main, so merging is also a publication trigger and must
remain withheld until both actions are explicitly authorized.

No merge, Pages publication, VPS access, real-data import, rebranding or
regulatory change was performed by this mission.
