# Additional Remuneration 2026 (GN No. 7 of 2026)

Status: **implemented and tested, expert approval pending.** This note is not legal advice and is not an MRA ruling.

## Source

- Additional Remuneration (2026) Regulations, **GN No. 7 of 2026**, Government Gazette No. 4 of **17 January 2026**.
- Official PDF read: https://www.mra.mu/download/GN15WRA.pdf
- Effective date: **1 January 2026**.

## Entitlement table implemented

| Worker category | Monthly basic wage | Additional Remuneration |
|---|---|---|
| Full-time | ≤ Rs 50,000 | **Rs 635 per month** |
| Part-time | < Rs 17,110 | **3.7%** of basic wage, rounded **up** to the rupee |
| Part-time | Rs 17,110 – Rs 50,000 | **Rs 635 per month** |
| Piece-rate | any | 3.7% of piece-rate earnings, **capped at Rs 635** — but the sector rate schedule is not transcribed, so the engine returns zero and flags a review reason |
| Any | > Rs 50,000 | Zero |

- The AR is treated as part of the **basic wage** for CSG, NSF and Training Levy.
- It is taxable emoluments for PAYE.
- The provision is **opt-in** per company (`payroll_settings.statutory_ar_enabled`). It is never backdated silently: the rule has an effective date and the engine returns zero before 1 January 2026.
- Employees can be excluded only with an explicit declaration and reason; the engine stores the flag and reason.
- Excluded groups: PRB/public officers and local officers as stated in the regulations. The engine does not try to infer public-officer status beyond the employee’s declared public-sector flag.

## Why there is no single amount

The regulation has at least three different outcomes (Rs 635, 3.7% rounded up, and zero above Rs 50,000), plus a piece-rate path. Applying “Rs 635 to everyone” would be wrong for part-time low earners, high earners and piece-rate workers.

## Interaction with statutory contributions

| Contribution | Base includes AR? | Note |
|---|---|---|
| PAYE | Yes | AR is an emolument of the month. |
| CSG | Yes | The regulation makes AR part of basic wage. |
| NSF | Yes | Same basic wage, then apply the dated min/max for the frequency. |
| Training Levy | Yes | Employer-only 1.5%, no cap. |

## Open points

1. Confirm the piece-rate sector schedule and whether the cap is monthly or per payment.
2. Confirm treatment of atypical workers not covered by the four categories.
3. Confirm the exact 17,110 threshold boundary (the engine applies Rs 635 at 17,110 exactly).
4. Confirm interaction with a thirteenth-month bonus and with partial months.
