# Mauritius Payroll — Regulatory Audit Dossier

**Version:** mission 15, 31 October 2026.
**Purpose:** give a single expert accountant everything needed to review the payroll statutory engine in one pass.
**No legal compliance is claimed.** Implementation, source identification and tests are not expert approval.

For each rule the dossier separates: (1) the official source, (2) what was verified, (3) the implemented formula, (4) tests, (5) applicability, (6) approval. The canonical row-level evidence is in `docs/regulatory-sources-register.md`.

---

## 1. Scope and exclusions

In scope: PAYE (cumulative), EDF, CSG (private sector), NSF, HRDC Training Levy, Additional Remuneration 2026, statutory bonus simulation, preparation-only MRA summary, bilingual simulation payslip, audit trail.

Out of scope and explicitly not implemented:
- MRA submission, MRA credentials, MRA file-format acceptance.
- Public-sector/PRB CSG rates, CSG Income Allowance.
- Fair Share Contribution.
- Director/board-member flat PAYE.
- NPF before September 2020, historic CSG/NPF re-computation.
- Wages Regulation Orders 2026 (33 sectoral orders).
- IFRS, statutory accounts, tax returns, bank payment.
- Final payslips: finalisation is blocked in this mission.

## 2. Status vocabulary (non-interchangeable)

| Status | Meaning |
|---|---|
| `SOURCE IDENTIFIED` | An official URL is recorded; content may not be read. |
| `CONTENT CHECKED` | The relevant table/article was read and transcribed. |
| `DIVERGENCE DOCUMENTED` | Official or secondary sources conflict; no silent choice was made. |
| `IMPLEMENTED` | A deterministic function exists. |
| `IMPLEMENTED + TESTED` | Automated tests pass on the implemented formula. |
| `APPLICABILITY NOT REVIEWED` | Nobody has approved that this rule applies to a given employer/employee. |
| `EXPERT VALIDATED` | A recorded admin action with source, URL and fingerprint; **not reached in this mission**. |
| `APPROVED_FOR_TEST` | Reviewer approved a calculation for testing only; net payable stays null. |

Rule lifecycle: `UNVERIFIED → RESEARCHED → REVIEW_REQUIRED → EXPERT_VALIDATED → DEPRECATED`. Seeds are created as `RESEARCHED` only.

## 3. Payroll pipeline

`employee/contract → period → validated variables → base and earnings → Additional Remuneration → PAYE → CSG employee → NSF employee → other deductions → net after statutory → CSG/NSF employer → Training Levy → employer cost → controls → simulation payslip preview`.

Each calculation stores: contract, period days, proration, base, earnings, gross, deductions, net arithmetic, taxable emoluments, basic wage, PAYE basis, CSG/NSF employee and employer, levy, employer cost, net after statutory, net payable (null unless fully approved), missing rules, review reasons, rule snapshot with versions, input hash, engine version, calculation version, actor and timestamp.

## 4. PAYE

- Source: MRA Guide on PAYE, December 2025; cumulative table July Rs 38,462 → June Rs 500,000 (separate bonus row not implemented).
- Verified: 0/10/20% bands, monthly scaling, 1/13 monthly reliefs, no-EDF flat 15%, down-to-rupee rounding, no refund of excess.
- Formula: `chargeable = max(0, cumulative emoluments − cumulative reliefs)`; band tax on scaled cumulative thresholds; `paye = max(0, roundDown(cumulative tax) − previous withheld)`.
- Tested: July example Rs 100,000 → 8,461; bands 38,462/230,772/461,544/500,000; no negative refund.
- Applicability: NOT REVIEWED. 2026/27 and the 13th-month bonus rule need confirmation.
- Approval: PENDING.
- Blocking: FSC threshold, director/board, half-monthly, non-MUR currency, missing date of birth for NSF, public sector CSG.

## 5. EDF

- Source: Employment Guide December 2025 and MRA EDF page.
- Verified: dependent deductions 0/110,000/190,000/275,000/355,000; EDF at the beginning of the income year; revisions; non-resident receives no reliefs.
- Implementation: revisioned declarations with `submitted`/`superseded`, one active row, unique `(company, employee, tax year, revision)`, backdating blocked, effective date must be within the tax year.
- Never inferred: medical insurance, solar/rainwater, carer, disability, tertiary education, “other reliefs” are employer-entered evidence only.
- Tests: revision 2 supersedes revision 1; backdating → 409; tax year before 2025/26 → 400.
- Applicability/approval: NOT REVIEWED / PENDING.

## 6. CSG (private sector)

- Source: MRA CSG page (Social Contribution and Social Benefits Act 2021).
- Verified: ≤ 50,000 → 1.5% employee / 3% employer; > 50,000 → 3% / 6%; no cap; CSG ≠ CSG Income Allowance.
- Base: basic wage including AR 2026.
- Not implemented: public/PRB, CSG Income Allowance, prescribed-bonus cumulative rate.
- Rounding: no official text found; exact 4 decimals, flagged in the rule.
- Tests: boundary 50,000/50,001; API private employee.
- Applicability/approval: NOT REVIEWED / PENDING.

## 7. NSF

- Source: MRA NPF/NSF page and October 2025 employer guide.
- Verified: 1%/2.5%, dated min/max per frequency, household minimum, no NSF from 65, under-18 exemption.
- Implementation: table selected by frequency and date; no universal monthly cap; missing DOB blocks.
- Tests: monthly 29,710 cap; weekly 6,856; daily 1,143; household floor 2,910.
- Applicability/approval: NOT REVIEWED / PENDING.

## 8. HRDC Training Levy

- Source: MRA NPF/NSF/Levy page.
- Verified: employer-only 1.5% from July 2021, full basic wage, **no cap**; 1% history July 2019–June 2021.
- Tests: Rs 1,000,000 → 15,000; exemption → 0.
- Applicability/approval: NOT REVIEWED / PENDING.

## 9. Additional Remuneration 2026

- Source: Additional Remuneration (2026) Regulations, GN No. 7 of 2026, Gazette No. 4 of 17 January 2026, effective 1 January 2026.
- Verified: full-time ≤ 50,000 → Rs 635; part-time < 17,110 → 3.7% rounded up; 17,110–50,000 → Rs 635; piece-rate cap Rs 635; exclusions.
- Implementation: opt-in, dated, part of basic wage, no backdating; piece-rate blocked with review reason.
- Tests: full-time, part-time low/high, before effective date, piece-rate.
- Applicability/approval: NOT REVIEWED / PENDING.

## 10. Statutory end-of-year bonus

- Source: WRA 2019 s.54 per secondary reading; the consolidated extraction read in this session stopped at s.22, so **s.54 was not re-read verbatim**.
- Implemented simulation: `1/12 × earnings for the year`; no automatic posting; multiple payments not implemented.
- Divergence: entitlement period, qualifying service and EOYGA 2001 interaction are unresolved.
- Finalisation is blocked; no bonus is paid or posted.
- Applicability/approval: DIVERGENCE DOCUMENTED / PENDING.

## 11. Employment-law inputs (not statutory amounts)

Hours, overtime hours, leave days and public holidays are recorded. The engine **does not value** overtime premiums or leave because no verified sectoral rule is loaded. It emits `OVERTIME_PREMIUM_NOT_CONFIGURED` and `LEAVE_NOT_VALUED` warnings. WRA 2019 sections 20–27 and the 2026 Wages Regulations were not converted into rates.

## 12. MRA returns — preparation only

`GET /periods/:id/mra-return` and `.csv` produce a local summary: gross, PAYE, CSG employee/employer, NSF employee/employer, Training Levy, employee count, incomplete calculations, approval count. Every output carries:

`PREPARATION ONLY - NOT SUBMITTED TO MRA`

There is no MRA credential, no endpoint, no submission and no claim that the CSV is an accepted MRA format. Deadlines and file specifications remain open.

## 13. Rule engine and versioning

- Dated rules with `effective_from` / `effective_to`, source URL, article, publication date, access date, SHA-256 fingerprint, formula, structured parameters, rounding policy, implementation status, version and required flag.
- Rule selection: latest applicable version on the calculation end date; expired rules excluded.
- Creating a new version that starts before or on the previous version is rejected (`PAYROLL_RULE_VERSION_OVERLAP`); previous `effective_to` is closed the day before, never rewritten on historical calculations.
- Existing calculations store a snapshot (`rules_applied`) so later rule changes do not mutate history.
- BigInt fixed point: amounts scale 4, rates scale 8. No JavaScript floating point touches money.

## 14. Controls and blocking

| Control | Behaviour |
|---|---|
| Required rule missing/unusable | `rules_incomplete`; all statutory values null |
| Public-sector CSG | blocked |
| Currency not MUR | blocked |
| Director/board/pensioner | blocked |
| Half-monthly PAYE | blocked |
| Daily PAYE | zero with exclusion reason (official exclusion) |
| FSC threshold | blocked |
| Missing DOB | blocked |
| Prior calculation without statutory result | blocked |
| Expert review absent | `expert_review_pending`; `net_payable = null` |
| Final slip / final period | always refused |

## 15. Tests and evidence

- API: 48 mission 14 tests + 21 mission 15 tests.
- Migrations: 6 tests applying all migrations, including 0015, on a fresh database.
- Web: 181 tests including 9 demo payroll tests and 5 payroll UI tests.
- CI: API tests, web tests, typechecks, builds, PostgreSQL job and Pages deployment.
- Not verifiable here: physical Samsung device, real Chrome, screen reader, MRA acceptance, real PostgreSQL locally (CI only).

## 16. Open issues and divergences

1. PAYE 2026/27 rates and the 13th-month bonus scaling.
2. FSC not implemented; blocks above the scaled threshold.
3. Director/board flat-rate PAYE.
4. CSG public/PRB, CSG Income Allowance, prescribed bonus cumulative rate.
5. Statutory rounding for CSG/NSF/levy absent from official text.
6. Bonus s.54 text not re-read; EOYGA 2001 not read.
7. AR piece-rate schedule and atypical workers.
8. MRA return file specification and deadlines.
9. Wages Regulation Orders 2026 and overtime/leave rates: not loaded.
10. Physical Android and assistive technology not tested.

## 17. Approval record

No expert approval exists. The database has zero `EXPERT_VALIDATED` seeded rules. An administrator may explicitly validate a rule with a note, but such an action is a local review record, not a legal opinion. The finalisation gate is intentionally not opened.

## 18. Accounting regulatory index (separate from payroll)

Company law and financial reporting are maintained in a separate index: `docs/accounting-regulatory-index.md` (Laws of Mauritius, Companies Act 2001, Financial Reporting Act 2004, FRC, MIPA). **No IFRS is used in this payroll workstream.** Payroll accounting entries are never generated automatically; the accounting preview is read-only and blocked.
