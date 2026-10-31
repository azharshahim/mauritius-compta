# Mauritian payroll rules register — status and open points

**This register is intentionally empty of rates.** No Mauritian PAYE, CSG, NSF,
employer contribution, threshold, band, exemption, cap, leave entitlement or
overtime premium has been invented by this software.

## 1. Registry contract

Each rule stores:

- `rule_code`, `name_en`, `name_fr`;
- `legal_source`, `source_reference`, `source_url`;
- `effective_from`, `effective_to`;
- employee / employer category;
- calculation basis, rate, thresholds, cap, exemption;
- rounding policy;
- status: `UNVERIFIED`, `RESEARCHED`, `REVIEW_REQUIRED`, `EXPERT_VALIDATED`,
  `DEPRECATED`;
- reviewer, validation date, version, test cases, notes;
- `required_for_calculation`.

Statuses are not decorative: only `EXPERT_VALIDATED` counts for calculation. A
required rule that is `MISSING`, `UNVERIFIED`, `RESEARCHED`, `REVIEW_REQUIRED` or
`DEPRECATED` blocks the period.

## 2. Seeded placeholders

| Rule code | Name | Rate | Source | Status | Effect |
|---|---|---|---|---|---|
| PAYE | PAYE (placeholder) | `NULL` | none | `UNVERIFIED` | blocks calculation |
| CSG | CSG (placeholder) | `NULL` | none | `UNVERIFIED` | blocks calculation |
| NSF | NSF (placeholder) | `NULL` | none | `UNVERIFIED` | blocks calculation |
| STATUTORY_ENGINE | Formula engine | n/a | none | `NOT_IMPLEMENTED` | always blocks statutory totals |

No placeholder can be validated without an explicit source, reference, effective
date and documented rate. The validation action requires an administrator and is
audited with the reviewer id.

## 3. Leave rules

Leave types exist (`annual`, `sick`, `unpaid`, `maternity`, `paternity`, `other`) but
no entitlement is seeded. Without a validated rule, the API returns
`CONFIGURATION_REQUIRED` and `balance: null`. A rule created in the UI is
`UNVERIFIED` and grants nothing.

## 4. Pay items

Every pay item starts with `treatment_status = UNVERIFIED`. No taxable/accountable
treatment is inferred. Categories separate earnings, reimbursements, deductions,
advances and loan repayments. Amounts and rates can only come from a user entry.

## 5. Grouped questions for one professional review

These points should be answered in a single expert-accountant review, not asked
step by step during implementation:

1. Legal texts, official URLs and applicable dates for PAYE bands and allowances.
2. CSG employee/employer rates, ceilings and exempt categories.
3. NSF employee/employer rates, ceilings and contribution base.
4. Definition of taxable gross, treatment of allowances, bonuses, reimbursements,
   advances and benefits in kind.
5. Rounding rules per contribution and per payslip total.
6. Employee categories, expatriate and permit situations, and their evidence.
7. Statutory identifiers that are actually required and how consent/retention
   apply.
8. Annual/sick/maternity/paternity leave entitlement, accrual, carry-over and
   termination payout.
9. Overtime premium, rest-day and public-holiday treatment.
10. Payment-date, payslip-content and record-retention obligations.
11. Required statutory returns, their format, frequency and e-filing channel.
12. Whether and when a payroll accrual/provision entry may be proposed to accounting.

Until every required answer is translated into a dated, tested rule and a verified
statutory engine, the module remains a **preparation and simulation** tool.

## 6. Validation procedure (implemented)

1. An authorised payroll writer creates a rule: status `UNVERIFIED`.
2. A researcher adds source, reference, dates, basis and rate.
3. An administrator calls `POST /payroll/rules/:id/validate` with `confirm: true`.
4. The API checks source, reference, effective date and a non-null rate for a
   required rule; it stores reviewer and timestamp; audit event is written.
5. The rule version is retained; a change should create a new version, never mutate
   history silently.
6. Even then, calculations stay blocked until the statutory engine is implemented
   and tested. **No demo can bypass step 2 or 3.**
