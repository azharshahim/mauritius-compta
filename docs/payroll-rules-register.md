# Mauritian Payroll Rules Register

Status: mission 16, 31 October 2026. **No rule is expert-approved.** The detailed source evidence is in [`regulatory-sources-register.md`](regulatory-sources-register.md); the audit narrative is in [`mauritius-regulatory-audit-dossier.md`](mauritius-regulatory-audit-dossier.md).

## 1. Registry contract

Each rule stores: `rule_code`, names EN/FR, legal source, source reference, official URL, article, publication date, access date, SHA-256 source fingerprint, effective `from`/`to`, employee/employer category, calculation basis, rate, threshold, cap, exemption, structured parameters, formula, rounding policy, implementation status, version, test cases, notes, reviewer and validation date.

Lifecycle: `UNVERIFIED → RESEARCHED → REVIEW_REQUIRED → EXPERT_VALIDATED → DEPRECATED`.

Only `EXPERT_VALIDATED` allows `statutory_complete = true`. A required rule that is missing or unusable blocks the calculation and sets all statutory values to `null`; zero is never used as a silent substitute.

## 2. Seeded rules (per company, status `RESEARCHED`)

| Rule code | Scope | Version/effective | Structured parameters | Blocks when absent? |
|---|---|---|---|---|
| `PAYE` v1 | Cumulative progressive PAYE 2025/26 | 2025-07-01 → 2026-06-30 | bands 0/10/20%, monthly scaling, FSC applicable | yes |
| `PAYE` v2 | Cumulative progressive PAYE 2026/27 | from 2026-07-01 | bands 0/10/20/35%, monthly scaling, no individual FSC, no-EDF rule unavailable | yes |
| `PAYE_NO_EDF` | Flat 15% without EDF, 2025/26 only | 2025-07-01 → 2026-06-30 | threshold 38,462; election 20% not implemented | only for 2025/26 periods |
| `CSG_PRIVATE` | Private-sector CSG | from 2021-09-01 | 1.5/3/3/6%, threshold 50,000 | yes |
| `NSF_RATES` | Employee 1% / employer 2.5% | from 2021-09-01 | rates | yes |
| `NSF_LIMITS` v1 | Min/max by frequency | 2025-07-01 → 2026-06-30 | five frequency tables | yes |
| `NSF_LIMITS` v2 | Min/max by frequency | from 2026-07-01 | five frequency tables | yes (latest) |
| `TRAINING_LEVY` | Employer-only 1.5%, no cap | from 2021-07-01 | rate, employer only | yes |
| `ADDITIONAL_REMUNERATION` | AR 2026 | from 2026-01-01 | 635 / 17,110 / 3.7% / max 635 / 50,000 | only when AR switch is on |
| `EOY_BONUS` | Bonus simulation | to confirm | 1/12, no automatic posting | no |

Each row carries `source_url`, `source_reference`, `article`, `publication_date`, `accessed_at`, `source_fingerprint`, `rounding_policy`, `implementation_status` and `version`.

## 3. Versioning and non-retroactivity

- A calculation selects the latest rule effective on the period **end date**.
- A new version cannot start before or on the previous version: `PAYROLL_RULE_VERSION_OVERLAP`.
- The previous `effective_to` is closed the day before the new start; historical calculations are never rewritten.
- Each calculation stores a snapshot of rule code, version, status, source and rounding.
- Changing a rule never recalculates a past period automatically. Recalculation requires an explicit administrative action with a new calculation version and audit event.

## 4. Validation action

An administrator may mark a rule `EXPERT_VALIDATED` only with:

- explicit `confirm: true`;
- a review note;
- legal source and reference;
- official URL and source fingerprint for required rules;
- an explicit documented rate **or** structured parameters.

The action is audited with reviewer id and timestamp. It is a local review record, not a legal opinion. No seed is pre-validated.

## 5. Rounding policy

| Rule | Policy | Official support |
|---|---|---|
| PAYE | Down to the rupee on cumulative tax | MRA PAYE guide |
| AR part-time 3.7% | Up to the rupee, capped | GN No. 7 of 2026 |
| CSG | Exact to 4 decimals | **No official text found — review required** |
| NSF | Exact to 4 decimals | **No official text found — review required** |
| Training Levy | Exact to 4 decimals | **No official text found — review required** |

## 6. Leave rules and pay items

Leave types exist but no entitlement is seeded. Without a validated rule, the API returns `CONFIGURATION_REQUIRED` and `balance: null`. Every pay item starts `UNVERIFIED`; taxable/accountable treatment is not inferred.

## 7. Grouped questions for one professional review

1. PAYE 2026/27 bands (Finance Act 2026 s.7 not read verbatim), monthly cumulative withholding table (not located) and 13th-month/bonus scaling.
2. Fair Share Contribution replacement by the 35% band in 2026/27.
3. Director/board/pensioner PAYE.
4. Public-sector/PRB CSG and CSG Income Allowance.
5. CSG/NSF/levy rounding.
6. WRA s.54 bonus and EOYGA 2001.
7. AR piece-rate schedule and atypical workers.
8. MRA Joint Monthly Return specification and deadlines.
9. Overtime/leave valuation under WRA and Wages Regulation Orders 2026.
