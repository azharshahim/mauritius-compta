# Mauritian payroll preparation — architecture

**Mission 14 — as built on 31 October 2026.** This document describes software
behaviour only. It makes **no claim of legal, tax or social-security compliance**.

## 1. Scope and non-goals

Implemented: employee master data, dated contracts, pay items, time and absences,
leave requests, monthly variables and idempotent imports, dated rules register,
payroll periods, deterministic arithmetic, blocked statutory result, simulation
payslips, audit, demo.

Not implemented: statutory PAYE/CSG/NSF formulas, any Mauritian rate or threshold,
overtime premium, leave entitlement, final payslip, statutory return, bank payment,
automatic accounting entry, E-Invoicing MRA.

## 2. Layers

```
apps/web  React 19 / HashRouter / i18n FR-EN
   │       pages/payroll/Payroll.tsx  (12 sections)
   │       demo/payroll.ts            (localStorage, no network)
   ▼
apps/api  Fastify routes → modules/payroll/service.ts → PostgreSQL
          modules/payroll/pdf.ts (PDFKit, watermark)
          modules/ai/tools.ts (read-only payroll tools)
   ▼
PostgreSQL  migration 0014_payroll_foundation.sql
```

Every payroll row carries `company_id` (and `cabinet_id` where relevant). Access is
re-verified on each request with the existing `requireModuleAccess`; hiding a menu
is never considered authorisation.

## 3. Data model (migration 0014)

| Domain | Tables | Key design |
|---|---|---|
| RH | `payroll_employees` (extended) | identity, contacts, status, hire/termination, currency, payment method, bank `last4` + fingerprint |
| Contracts | `payroll_contracts`, `payroll_contract_events` | dated versions, `superseded` instead of overwrite, mandatory change reason |
| Pay items | `payroll_pay_items`, `payroll_employee_pay_items` | category separates earning / reimbursement / deduction / advance / loan |
| Time | `payroll_work_calendars`, `payroll_holidays`, `payroll_time_entries`, `payroll_absences` | unique employee+date; overtime stored as entered |
| Leave | `payroll_leave_rules` | rule must be `EXPERT_VALIDATED` before a balance is shown |
| Rules | `payroll_rules` | dated, versioned, five statuses, legal source/reference/URL, reviewer, test cases |
| Periods | `payroll_periods` | unique company+year+month, state machine, version, reopen trace |
| Variables | `payroll_variables`, `payroll_variable_events` | draft/validated, unique `import_key` |
| Calculations | `payroll_calculations`, `payroll_calculation_lines` | version, input hash, blocked/simulated status, nullable statutory columns |
| Payslips | `payroll_payslips` | `simulation` only; DB trigger refuses `final` while calculation not finalised |
| Audit | `payroll_events` + existing `audit_log` | actor, action, before/after payload |

Guard triggers additionally refuse an early final period and validate company
existence. The migration is additive and idempotent; it does not alter previous
migrations.

## 4. Period state machine

```
draft → data_collection → ready_for_review → calculated → approved → finalised
             ↑                   │               │
             └───────────────────┴───────────────┘  (controlled reopen)
                         blocked ──────────────────┘
```

- A calculation is refused in `draft`.
- A second calculation is refused unless an administrator explicitly forces it;
  a new `version` is written and the input hash changes.
- `finalised` is **always refused today** with
  `PAYROLL_RULES_NOT_VALIDATED` or `PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED`.
- `finalised` is terminal; DB triggers protect the invariant independently of the API.

## 5. Deterministic arithmetic engine

All amounts are accepted as decimal strings, normalised to `numeric(20,4)` and
computed with integer BigInt helpers. No JavaScript float is used.

1. For each active/probation/suspended employee, select dated contracts covering
   the period.
2. Monthly salary is prorated by **calendar days** only when the employment or
   contract does not cover the whole period; each line states active days.
3. Hourly base = sum(time entry hours) × contractual hourly rate.
4. Daily base = active calendar days × contractual daily rate.
5. Fixed employee pay items effective in the period are added.
6. Only `validated` monthly variables enter the calculation; drafts are excluded.
7. `gross = base + earnings`; `deductions` include advances/loans;
   `net_arithmetic = gross + reimbursements − deductions`.
8. Approved absences and overtime generate **warnings**, not invented amounts.
9. Required rules are resolved on the period end date. Missing/unvalidated rules
   produce `status = blocked`, `statutory_complete = false`, `paye/csg/nsf = NULL`.
10. A SHA-256 `input_hash` captures contracts, variables, allowances, absences and
    rule statuses for reproducibility.

The result is explicitly labelled **arithmetic net**, never legal net.

## 6. Rules and statutory engine

The registry starts with placeholders `PAYE`, `CSG` and `NSF` only, with
`status = UNVERIFIED`, `rate = NULL`, no source. Validation requires an admin,
`confirm: true`, a legal source, a source reference, an effective date, and a
documented rate for a required rule. The action is audited. No demo path can
produce `EXPERT_VALIDATED`.

Even with a validated registry, the API deliberately answers
`PAYROLL_STATUTORY_ENGINE_NOT_IMPLEMENTED`: the formula engine, bands, thresholds,
caps and rounding must be separately implemented and tested.

## 7. Payslips and accounting bridge

- One simulation payslip per calculation, reused on repeat.
- Snapshot is immutable JSON, numbered `SIM-YYYYMM-NNNN`.
- PDF includes company/employee (masked bank), period, lines, totals, currency,
  version, missing rules and the watermark **SIMULATION / DRAFT — NOT FOR
  PAYMENT** on every page.
- `POST …/finalise` always returns `PAYROLL_PAYSLIP_FINAL_BLOCKED`.
- `accounting-preview` returns period totals and `postingBlocked: true`. No
  journal entry is created by any calculation. Future flow remains: validated
  payroll → proposal → human validation → posting; not implemented.

## 8. Failure behaviour

| Situation | Result |
|---|---|
| Rule missing or unvalidated | calculation blocked with explicit code |
| Statutory engine absent | blocked, statutory columns `NULL`, no zero substitution |
| Pay item treatment unknown | `treatment_status = UNVERIFIED` |
| Leave rule missing | `CONFIGURATION_REQUIRED`, balance `null` |
| Duplicate employee | 409 `PAYROLL_EMPLOYEE_DUPLICATE`, no merge |
| Duplicate import | existing row reused, `created = 0` |
| Final payslip / period | refused by API and DB trigger |
| Unauthorised role | 403, no salary or bank data in response |
| Another company id | 404/403, never cross-tenant data |

## 9. Deployment

Windows/Linux via Node and PostgreSQL; Android via responsive browser. No APK,
no iPhone-specific path, no PWA, no dark mode. The GitHub Pages build runs the
same React screens against `demo/payroll.ts` in localStorage; it is clearly
labelled as a demonstration and never reaches a server.
