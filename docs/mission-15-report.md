# Mission 15 Report — Mauritian Statutory Payroll Engine

Date: 31 October 2026. Branch: `arena/b0b62798-mauritius-compta`. Draft PR #1 (not merged).

## 1. Objective and boundary

Extend mission 14 payroll into a dated, auditable statutory engine covering PAYE, EDF, CSG, NSF, HRDC Training Levy, Additional Remuneration 2026 and a statutory-bonus simulation, while keeping every output a simulation and never claiming legal compliance. Mission 14 was extended, not rebuilt: the existing employee, contract, time, variable, period, payslip, PDF and audit code remains in place.

## 2. Delivered code

- `apps/api/sql/migrations/0015_statutory_engine.sql`: EDF declarations with revisions and one active row; employee statutory profile and CHECK constraints; structured rule parameters/source metadata; statutory calculation columns; new status CHECK; settings switches; tenant guard trigger for EDF.
- `apps/api/src/modules/payroll/statutory.ts`: pure BigInt functions — band scaling, cumulative PAYE, no-EDF PAYE, CSG, NSF, Training Levy, AR 2026, bonus simulation, rupee rounding.
- `apps/api/src/modules/payroll/service.ts`: effective-rule selection, official rule seeds (RESEARCHED), EDF service, statutory pipeline in `calculatePeriod`, rule version overlap prevention, `approveCalculationForTest`, `requestExpertReview`, MRA preparation summary/CSV, test-approval gate.
- `apps/api/src/modules/payroll/routes.ts`: EDF routes, calculation review routes, MRA preparation and CSV routes, statutory profile fields on employees, settings switches.
- `apps/api/src/modules/payroll/pdf.ts`: bilingual simulation with statutory totals, employer cost, rule snapshot and “NOT FOR PAYMENT”.
- `apps/web/src/demo/payroll.ts`: demo now uses the same pure formula module, official registered rules, AR 2026, statutory values and the expert-review status.
- `apps/web/src/pages/payroll/Payroll.tsx`: new PAYE/CSG/NSF/net-after-statutory/net-payable columns, “approve for test”, rule validation action, official source links and MRA preparation download.

## 3. Official sources

The register contains row-level evidence and official URLs. Principal sources: MRA Guide on PAYE (Dec 2025), MRA Employment Guide (Dec 2025), MRA CSG page, MRA NPF/NSF/Levy page, MRA Guide to Employers (Oct 2025), Additional Remuneration (2026) Regulations GN No. 7 of 2026 (Gazette No. 4, 17 Jan 2026), WRA 2019 consolidated v8, MRA PAYE employer FAQ.

## 4. Formulas implemented (with source)

| Area | Formula | Official source |
|---|---|---|
| PAYE | cumulative progressive bands; per-period threshold `ceil(annual/13)` to the rupee × elapsed periods, capped at the annual threshold, and `periods ≥ 12` uses the annual threshold; down-to-rupee; no refund | MRA Guide on PAYE Dec 2025, cumulative table |
| No EDF | 15% flat above 38,462 monthly | MRA PAYE rates table — https://www.mra.mu/download/PayrollTaxes.pdf |
| EDF | 1/13 monthly, 1/28 fortnightly, 1/56 weekly; dependent table 0/110/190/275/355 k | MRA Employment Guide Dec 2025; EDF page |
| CSG | ≤ 50,000: 1.5%/3%; > 50,000: 3%/6% | MRA CSG page |
| NSF | 1%/2.5% on dated min/max per frequency | MRA NPF/NSF page; Oct 2025 guide |
| Training Levy | 1.5% employer-only, full basic wage, no cap | MRA NPF/NSF/Levy page |
| AR 2026 | 635 full-time; 3.7% rounded up below 17,110; 635 to 50,000; piece-rate capped | GN No. 7 of 2026 |
| Bonus | 1/12 of annual earnings (simulation only) | WRA s.54 per secondary reading — divergence documented |

## 5. Verification per rule

Every rule row stores authority, URL, article, publication date, effective period, scope, base, thresholds, rounding policy, exceptions, access date, source fingerprint, implementation status and version. The register adds a visible `Expert approval = PENDING` for all. No rule is silently presented as verified.

## 6. EDF

- Declarations are revisioned; a new declaration supersedes exactly one active row.
- Backdating before the active declaration is refused; a tax year before 2025/26 is refused.
- Cumulative reliefs are rebuilt period by period; no historical period is rewritten.
- No relief is inferred; only dependent count and explicit other reliefs are stored.
- Non-residents get no reliefs and a review reason.

## 7. CSG, NSF, Training Levy

- CSG uses basic wage + AR; private sector only; public sector blocks.
- NSF applies the correct dated table per frequency; no universal monthly cap; missing DOB blocks; no NSF from 65.
- Training Levy is employer-only, uncapped, 1.5%; household/age exemptions produce zero.
- Rounding for these three has no identified official text; the rule says so explicitly and keeps four decimals.

## 8. Additional Remuneration 2026

Dated from 1 January 2026, opt-in, part of the basic wage. Full-time/part-time/piece-rate paths are distinct; piece-rate is not valued without the sector schedule. AR is included in PAYE, CSG, NSF and levy bases.

## 9. Bonus

Implemented only as a simulation of 1/12 of earnings. The engine does not default to “one month of salary”, does not post to accounting, and blocks finalisation. Section 54 needs verbatim confirmation and the EOYGA 2001 reading before any payment.

## 10. Calculation statuses

`SIMULATION`, `RULES_INCOMPLETE`, `CALCULATED`, `REVIEW_REQUIRED`, `EXPERT_REVIEW_PENDING`, `APPROVED_FOR_TEST`, `FINALISATION_BLOCKED` are modelled. A calculation can be computed and still keep `net_payable = null`. Period finalisation is always refused in this mission.

## 11. Payslip and declarations

- Bilingual simulation payslip: base, taxable emoluments, PAYE, CSG/NSF employee, other deductions, net after statutory, net payable (NOT CALCULATED), CSG/NSF employer, levy, employer cost, period, rule versions, status.
- All PDFs and CSVs carry “SIMULATION / DRAFT — NOT FOR PAYMENT”.
- MRA summary/CSV is preparation only, marked `NOT SUBMITTED`; no MRA credential, no submission, no accepted-format claim.

## 12. Tests

- Full API suite: **396 passed, 11 skipped** (407) across 21 files; the skipped
  file is the PostgreSQL concurrency suite, which only runs in CI.
- 22 new mission 15 API tests (`payroll-statutory.test.ts`), including the block
  for any period after 30 June 2026.
- 48 mission 14 payroll tests, re-dated to January 2026 so they stay inside the
  verified income year.
- 6 migration tests, including migration 0015 on a fresh PostgreSQL database.
- Full web suite: **182 passed** across 21 files (demo payroll A→R, payroll UI,
  i18n, bank, cabinet, offline and security tests).
- Root typecheck and production builds (web + API) pass locally.
- CI runs API, web, typecheck, builds, PostgreSQL job and Pages.
- Physical Samsung/Android, real Chrome and screen reader remain unverified; no claim is made.

## 13. Audit and security

- Tenant isolation on EDF rows via company FK and guard trigger.
- No salary or identifier in logs; bank accounts masked; no real personal data in demo or tests.
- Rule validation requires admin plus source/URL/fingerprint; creation of overlapping versions is refused.
- Every action writes a payroll event and audit record.

## 14. Blocked cases (honest limits)

Income year 2026/27 PAYE: the official 2026/27 withholding schedule was not verified; secondary sources mentioning a 35% band and FSC abolition were deliberately not used, and the engine blocks instead. The demo and statutory API tests therefore use January/March 2026, inside the verified 2025/26 year.

FSC; director/board/pensioner PAYE; public-sector/PRB CSG; CSG Income Allowance; prescribed bonus cumulative CSG; half-monthly PAYE; non-MUR payroll; piece-rate AR; bonus eligibility; MRA submission; final payslips; overtime/leave valuation; Wages Regulation Orders 2026.

## 15. Open points for the single expert review

1. PAYE 2026/27 and 13th-month scaling.
2. FSC.
3. Director/board flat PAYE.
4. Public-sector CSG and CSG Income Allowance.
5. CSG/NSF/levy rounding.
6. WRA s.54 and EOYGA 2001.
7. AR piece-rate schedule.
8. MRA return specification and deadlines.
9. Overtime/leave sectoral rates.
10. Android/assistive-technology verification.

## 16. Acceptance and non-claims

Delivered: complete register; dated PAYE with explainable trace; EDF history; dated CSG/NSF/levy; NSF limits by date and frequency; AR by category; documented bonus; blocking missing rules; no unverified rate used silently; unofficial payslips; English audit dossier; demo; open draft PR.

Not claimed: legal or MRA compliance; correctness of applicability; final payslips; submission of any return; approval by an expert accountant; physical-device verification.

PR #1 remains **open and unmerged**. `main` untouched.
