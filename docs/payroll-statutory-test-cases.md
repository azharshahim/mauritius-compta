# Payroll Statutory Test Cases (Mission 15)

All identities, wages and documents are fictional. Automated tests are in:

- `apps/api/tests/payroll-statutory.test.ts` — 22 tests (pure formulas + API pipeline).
- `apps/api/tests/payroll.test.ts` — 48 tests (mission 14 regression).
- `apps/api/tests/migrations.test.ts` — 6 tests (fresh database applies 0003→0015).
- `apps/web/tests/demo-payroll.test.ts` and `apps/web/tests/payroll-ui.test.tsx` — demo and UI.

## A→R case matrix

| Case | Scenario | Expected result | Covered by |
|---|---|---|---|
| A | Monthly employee, no EDF, Rs 40,000 | Flat 15% PAYE = 6,000; CSG 600/1,200; NSF 297.10/742.75; levy 600; net after statutory 33,102.90; net payable null | API statutory `S002` |
| B | Monthly employee with EDF (1 dependant) at Rs 40,000 | Relief 8,461.5385/month; chargeable below 38,462; PAYE 0; net 39,102.90; net payable null | API statutory `S001` |
| C | EDF amendment effective 1 August, second dependant | Revision 2, first declaration `superseded`, history preserved, new reliefs only for later periods | API EDF amendment test |
| D | EDF backdated before active declaration | 409 `PAYROLL_EDF_EFFECTIVE_DATE` | API EDF test |
| E | EDF for a tax year with no verified table | 400 `PAYROLL_EDF_RULE_NOT_AVAILABLE` | API EDF test |
| F | Missing date of birth | `rules_incomplete`, `DATE_OF_BIRTH_REQUIRED`, all statutory values null | API `S003` |
| G | Public-sector employee | `rules_incomplete`, `CSG_PUBLIC_SECTOR`, no private-sector rate applied | API `S004` |
| H | Threshold boundary CSG Rs 50,000 / Rs 50,001 | 1.5%/3% then 3%/6% | Pure CSG test |
| I | NSF monthly Rs 100,000 | Assessable capped at 29,710 | Pure NSF test |
| J | NSF weekly Rs 30,000 | Assessable capped at 6,856 (not 29,710) | Pure NSF test |
| K | NSF daily Rs 1,500 | Assessable capped at 1,143 | Pure NSF test |
| L | NSF household wage below minimum | Assessable floored at 2,910 | Pure NSF test |
| M | Training Levy on Rs 1,000,000 | 15,000, no cap | Pure levy test |
| N | AR full-time Rs 30,000 | 635 | Pure AR test |
| O | AR part-time Rs 10,000 / Rs 20,000 | 370 / 635 | Pure AR test |
| P | AR before 1 January 2026 | Zero | Pure AR test |
| Q | Bonus based on Rs 120,000 annual earnings | 10,000 simulation only; no automatic posting | Pure bonus test |
| R | Reviewer approval without a note / review request | 400 `PAYROLL_REVIEW_REQUIRED`; valid note → `approved_for_test` but net payable null | API review gate |

## Additional coverage

- July PAYE table: 8,461 on Rs 100,000.
- Band scaling: 38,462 / 230,772 / 461,544 / 500,000.
- No negative PAYE refund.
- Round down and round up at the rupee.
- FSC threshold blocks the calculation instead of adding an invented 15%.
- Rule registry seeds are `RESEARCHED`, never `EXPERT_VALIDATED` without an explicit admin action.
- Rule validation requires source, reference, URL and fingerprint.
- A new rule version cannot overlap a historical effective date (`PAYROLL_RULE_VERSION_OVERLAP`).
- Finalisation is refused even after a test approval; no final slip is produced.
- A 2026/27 period is blocked rather than reusing 2025/26 PAYE rates.
- MRA summary and CSV are marked `PREPARATION_ONLY` / `NOT_SUBMITTED`.
- Simulation PDF displays statutory values and “NOT FOR PAYMENT”.

## Not testable in this environment

- Real PostgreSQL behaviour is exercised by CI (`postgres-tests`); local tests use PGlite.
- A physical Samsung Android device, real Chrome, and a screen reader were **not** available. Responsive/Android checks remain CSS/unit-level only and are documented as unverified.
- MRA file acceptance cannot be tested without official specifications and credentials; none is used.
