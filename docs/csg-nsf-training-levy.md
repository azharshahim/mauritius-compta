# CSG, NSF and HRDC Training Levy — Implemented Rules

Status: **implemented and tested, expert approval pending.** No MRA compliance is claimed.

## 1. CSG (private sector)

CSG replaced NPF contributions from September 2020. It is **not** the CSG Income Allowance, which is a separate income-tax measure and is outside the engine.

| Basic wage/salary | Employee | Employer |
|---|---|---|
| ≤ Rs 50,000 | 1.5% | 3% |
| > Rs 50,000 | 3% | 6% |

- Base used by the engine: **basic wage + Additional Remuneration 2026** (the AR regulation treats the AR as part of the basic wage).
- No cap is applied.
- The threshold comparison is strict: Rs 50,000 exactly is in the low band.
- No statutory rounding text was found. The engine keeps four decimals and marks the rule rounding policy `No statutory rounding rule found; review required`. This is an explicit open point, not a silent convention.
- Public-sector and PRB rates are **not implemented**; a public-sector employee blocks with `CSG_PUBLIC_SECTOR`.
- Prescribed bonus uses the rate determined by the **cumulative annual salary**; this version does not implement that cumulative selection and must not be used to claim a final CSG result on bonuses.
- Employer-declared exemptions require a reason; CSG is then zero with a review reason.

## 2. NSF (National Savings Fund)

Rates: **employee 1%, employer 2.5%**, employer also remits the employee share.

The assessable wage is clamped to a date- and frequency-specific minimum/maximum table. There is **no universal monthly ceiling**.

| Effective | Frequency | Household min | Other min | Maximum |
|---|---|---|---|---|
| 2025-07-01 → 2026-06-30 | Daily | 108 | 169 | 1,099 |
| | Weekly | 645 | 1,015 | 6,593 |
| | Fortnightly | 1,290 | 2,031 | 13,186 |
| | Half-monthly | 1,398 | 2,200 | 14,285 |
| | Monthly | 2,795 | 4,400 | 28,570 |
| From 2026-07-01 | Daily | 112 | 176 | 1,143 |
| | Weekly | 672 | 1,057 | 6,856 |
| | Fortnightly | 1,343 | 2,114 | 13,712 |
| | Half-monthly | 1,455 | 2,290 | 14,855 |
| | Monthly | 2,910 | 4,580 | 29,710 |

- Age is mandatory: no NSF from age 65 and under-18 employees are exempt. A missing date of birth **blocks** rather than assuming an age.
- NPF (before September 2020) is a separate historical domain; the engine does not apply NPF rates.
- Rounding: exact to four decimals, no official text found; open review point.

## 3. HRDC Training Levy

- Payer: **employer only**.
- Base: full basic wage/salary (including AR 2026).
- Rate: **1.5%** since July 2021 (1% from July 2019 to June 2021 is documented but only the current dated version is seeded).
- **No cap.**
- Household workers and declared exemptions produce zero with a review reason.
- Exact to four decimals; no statutory rounding text found.

## 4. Calculation order

```
basic wage = contractual base + Additional Remuneration 2026
CSG employee / employer = f(basic wage)
NSF employee / employer = f(clamped basic wage)
Training Levy = 1.5% × basic wage (employer only)
net after statutory = net arithmetic − PAYE − CSG employee − NSF employee
employer cost = gross + reimbursements + CSG employer + NSF employer + Training Levy
```

`net_payable` remains null until the review gate and finalisation gate are opened. They are not opened by this mission.

## 5. Open points for the expert review

1. Statutory rounding for CSG, NSF and levy.
2. Public-sector/PRB CSG rates and CSG Income Allowance.
3. Prescribed bonus: cumulative salary-based CSG rate.
4. Exempt categories and documentary evidence.
5. Confirmation of the 2026/27 tables before 1 July 2026 use.
