# PAYE Calculation Specification (Mauritius, 2025/26 and 2026/27)

Status: **implemented and tested for income years 2025/26 and 2026/27; expert approval pending.** The 2026/27 bands come from the MRA EDF 2026/27 and the communiqué of 5 August 2026; the Finance Act 2026 sections on PAYE were **not read verbatim**, and no monthly cumulative withholding table was located (`monthlyWithholdingTableVerified: false`). This is not a legal opinion and does not assert MRA compliance.

## 1. Tax year and pay periods

- Tax year: **1 July to 30 June**.
- Supported PAYE frequencies: monthly, weekly, fortnightly.
- Half-monthly and daily-paid workers do not go through the PAYE formula: daily-paid workers are excluded from PAYE operation, and half-monthly is blocked until a verified EDF divisor is documented.
- The engine never assumes a frequency: `payroll_employees.pay_frequency` is mandatory evidence.

## 2. Official cumulative bands

### 2025/26

Official table (MRA Guide on PAYE, December 2025):

| Period | 0% band | 10% band | 20% |
|---|---|---|---|
| July (1st month) | First Rs 38,462 | Next Rs 38,462 | Remainder |
| August | First Rs 76,924 | Next Rs 76,924 | Remainder |
| … | cumulative Rs 38,462 per month | same width | Remainder |
| 12th month (June) | First Rs 500,000 | Next Rs 500,000 | Remainder |

### 2026/27

MRA Employee Declaration Form 2026/27 (01/07/2026 – 30/06/2027), note 2, read on 31 October 2026:

| Annual chargeable income | Rate |
|---|---:|
| First Rs 500,000 | 0% |
| Next Rs 500,000 (up to Rs 1,000,000) | 10% |
| Next Rs 11,000,000 (up to Rs 12,000,000) | 20% |
| Above Rs 12,000,000 | 35% |

The individual Fair Share Contribution is not seeded for 2026/27: a secondary source states that the 35% band replaces it. This replacement awaits professional confirmation.

For both years, the engine computes a per-period threshold as `ceil(annual / 13)` rounded **up to the rupee**, then `perPeriod × periodsElapsed`, capped at the annual threshold. This gives July 38,462 and June 500,000 for 2025/26, and the corresponding cumulative values for 2026/27. The official table also prints a **prescribed end-of-year bonus** row that shifts the later cumulative rows; that 13th-period path is **not implemented** and requires the expert decision described below. This is implemented in `scaleBandThreshold()` in `apps/api/src/modules/payroll/statutory.ts`.

## 3. Formula

```
chargeable        = max(0, cumulativeEmoluments − cumulativeReliefs)
cumulativeTax     = roundDownToRupee(Σ band tax on chargeable)
payeThisPeriod    = max(0, cumulativeTax − payeAlreadyWithheld)
```

- Cumulative emoluments include gross taxable earnings of previous validated periods of the same tax year.
- Cumulative reliefs are rebuilt period by period from the applicable EDF version, using **1/13 monthly, 1/28 fortnightly, 1/56 weekly**. A fresh EDF only affects later periods; earlier periods are not rewritten.
- PAYE is rounded **down to the rupee once** on the cumulative liability.
- A negative difference is **never refunded**: it becomes zero and the excess remains carried in the cumulative comparison, consistent with MRA guidance.

## 4. No EDF

**2025/26 only.** In 2026/27 no official no-EDF rule was located, so an employee without EDF is blocked with `NO_EDF_RULE_NOT_VERIFIED_FOR_PERIOD`. The 2025/26 threshold is never reused.

If no submitted EDF exists (2025/26):

- monthly emoluments ≤ Rs 38,462 → PAYE = 0;
- monthly emoluments > Rs 38,462 → flat **15%** of the monthly emoluments, rounded down;
- the 20% employee election is **not implemented**; it must be an explicit evidence-backed employee choice, never inferred;
- weekly/fortnightly no-EDF is blocked.

## 5. EDF and reliefs

The EDF table is stored with revision history. The engine accepts only the dependent count and explicit “other reliefs” entered by the employer. It never invents medical, solar, carer, disability or tertiary-education reliefs.

Dependent deductions used: Rs 0 / 110,000 / 190,000 / 275,000 / 355,000 for 0 / 1 / 2 / 3 / 4+ dependants.

Non-resident employees get **no reliefs**: the EDF relief amount is ignored and a review reason `NON_RESIDENT_NO_RELIEFS` is recorded.

## 6. Fair Share Contribution (FSC)

2025/26 only: not implemented. If cumulative taxable emoluments exceed the scaled Rs 12,000,000 threshold, the employee calculation is blocked with `FAIR_SHARE_CONTRIBUTION_NOT_IMPLEMENTED`. PAYE is not silently increased by 15%. For 2026/27 the PAYE version carries `fscApplicable: false`; the 35% band applies instead, pending expert confirmation.

## 7. Director and board fees, other categories

Director, board member and pensioner categories are blocked (`DIRECTOR_OR_PENSIONER_PAYE_NOT_IMPLEMENTED`). Their flat 15%/20% treatment and annual adjustment require a separate verified path.

## 8. Sources and audit trail

- Rule row: `PAYE`, `PAYE_NO_EDF` with official URL, article, publication date, access date, SHA-256 source fingerprint, parameters, version and effective dates.
- Each calculation stores `paye_basis` (`EDF_CUMULATIVE`, `NO_EDF_FLAT_15`, `NON_RESIDENT_NO_RELIEFS`, `DAILY_PAY_EXCLUDED_FROM_PAYE`), the rule snapshot (`rules_applied`), the cumulative context used, and `statutory_status`.
- The calculation status remains `expert_review_pending` until every required rule is `EXPERT_VALIDATED`. Even then, `net_payable` stays null until the finalisation gate is explicitly opened; it is not opened in this mission.

## 9. Income year 2026/27

The `PAYE` 2025/26 version is dated **1 July 2025 → 30 June 2026**. The 2026/27 version is dated **1 July 2026 → 30 June 2027** and carries the 0/10/20/35 bands, `fscApplicable: false`, `noEdfRuleAvailable: false` and `monthlyWithholdingTableVerified: false`. `PAYE_NO_EDF` remains closed at 30 June 2026.

A calculation for a period after 30 June 2027 reports `PAYE` as missing and becomes `rules_incomplete`; it never carries the 2026/27 rates forward silently. The 2026/27 version is dated, so no historical calculation is rewritten.

## 10. Open points

1. Verify the 13th-month bonus rule against the Income Tax Act and the MRA table.
2. Verify 20%/15% director and board-member treatment.
3. Verify FSC and its interaction with the 20% band.
4. Confirm the 2026/27 bands against Finance Act 2026 s.7 and the monthly cumulative table (not located).
5. Confirm the 35% band replaced the individual FSC and how the 13th month interacts with it.
