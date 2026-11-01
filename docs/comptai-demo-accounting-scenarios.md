# COMPTAI demonstration — accounting scenarios (16 steps)

**Version:** COMPTAI 0.1.1 — demonstration
**Date:** 1 November 2026
**Company:** Island Trading Ltd — DEMO COMPANY
**Currency:** MUR unless stated otherwise
**Data:** fictitious only

---

## Purpose and rules

This document gives a reproducible route through the demonstration. It is the
detailed companion to the **Guided demo** page (`#/demo`) and to
`docs/comptai-expert-demo-guide-en.md`.

Rules for the reviewer:

1. Do not enter real personal, bank, BRN, VAT or MRA data.
2. Do not change a tax, payroll or accounting rule to obtain a result.
3. If a step cannot be completed, record **Not Available** or **Not Tested**;
   do not force an amount or create a plug entry.
4. Amounts below are the seeded values. If your session has already been
   modified, click **Reset demo data** before starting.
5. A screen that displays a blocked or empty workflow is not proof that the
   statutory function exists.

## Starting point

After sign-in, select **Island Trading Ltd — DEMO COMPANY**.

| Item | Expected value |
|---|---|
| Financial year | 2025-07-01 → 2026-06-30 |
| Functional currency | MUR |
| Accounts | 38 |
| Journals | BQ, CA, OD, PUR, SAL |
| Entries | 59 (58 posted, 1 draft) |
| Customers / suppliers | 2 / 2 |
| Fixed assets | 6 |
| Inventory | 1 item, 110 units, 1,080 MUR |
| Employees | 18 |
| Bank accounts | 2 (MUR practice, EUR) |
| Previous years | FY 2023/2024 closed, FY 2024/2025 closed |

---

## Step 1 — Open the company

**Where:** Dashboard / company selector.

**Action:** select Island Trading Ltd — DEMO COMPANY and confirm the company
header.

**Expected:** exercise 2025/2026, MUR, `DEMO-BRN-0001`, `DEMO-VAT-0001`,
fictitious Port Louis address, accounting standard label `Other` with an
informational note.

**Do not accept:** a real BRN, a real VAT number, an IFRS compliance claim or a
blank company.

**Evidence to record:** company name, year, currency and the standard note.

---

## Step 2 — Share capital and opening balances

**Where:** Year-End Closing → Opening Balances; Trial Balance.

**Action:** open the opening balances for FY 2025/2026 and the trial balance.

**Expected:**

- opening debit = opening credit = **165,000 MUR**;
- opening bank 150,000 MUR and opening trade receivable 15,000 MUR;
- opening share capital 150,000 MUR;
- during the year, a 500,000 MUR capital contribution is posted, so closing
  share capital is **650,000 MUR**;
- the ledger is continuous: no duplicate opening entry is created.

**Do not accept:** an unexplained opening difference, a negative opening
balance with no explanation, or a capital amount that contradicts the balance
sheet.

**Evidence:** opening row for account 3000, opening total, closing capital.

---

## Step 3 — Customer and supplier

**Where:** Sales → Customers; Purchases → Suppliers.

**Action:** open both customer records and both supplier records.

**Expected:**

- customers: Rivière Noire Supplies Ltd and Mahébourg Consulting Ltd, marked
  fictitious;
- suppliers: Atelier Rivière Ltda and Oceanic Supplies SARL (foreign, EUR);
- no real bank details, no real personal data, no real registration number.

**Do not accept:** a real company name, a real IBAN, or a supplier with an
unexplained currency.

**Evidence:** name, currency and contact domain.

---

## Step 4 — Sales invoice

**Where:** Sales → Sales Invoices.

**Action:** open `FAC-DEMO-0002`.

**Expected:** total **5,000 MUR**, status `issued`, exact line arithmetic, and a
visible posting state. The seeded sales documents are workflow records, not
posted ledger entries.

**Do not accept:** a total that differs from the sum of lines, a hidden tax
amount, or an automatic posting claim.

**Evidence:** document number, total, status, posting state.

---

## Step 5 — Supplier bill and partial payment

**Where:** Purchases → Bills; Purchases → Supplier payments.

**Action:** open `FAC-DEMO-1001` and its payment allocation.

**Expected:** invoiced **80,000 MUR**, paid **30,000 MUR**, outstanding
**50,000 MUR**. Payment `RF-2026-0001` is visible and must not exceed the
outstanding amount.

**Do not accept:** an outstanding amount different from 50,000 MUR, a duplicate
payment, or a payment allocated twice.

**Evidence:** bill number, invoice total, paid amount, outstanding amount,
payment reference.

---

## Step 6 — Customer receipt

**Where:** Sales → Payments; Sales → Sales Invoices.

**Action:** trace a receipt to its invoice. Use `FAC-DEMO-0001` (24,000 MUR,
18,000 paid, 6,000 outstanding) as the readable partial case.

**Expected:** allocation ≤ invoice total; the invoice status becomes
`partially_paid` or `paid`; the outstanding amount decreases by the allocated
amount.

**Do not accept:** an allocation above the invoice total, a negative
outstanding, or an unallocated receipt presented as settled.

**Evidence:** receipt number, invoice number, allocated amount, new outstanding.

---

## Step 7 — Supplier payment

**Where:** Purchases → Supplier payments.

**Action:** open `RF-2026-0001` and its allocation to `FAC-DEMO-1001`.

**Expected:** **30,000 MUR** allocated; the bill remains partially paid with
50,000 MUR outstanding. A second payment for the same amount must not silently
settle the bill twice.

**Do not accept:** a double allocation, an allocation to a cancelled document,
or a payment with no reference.

**Evidence:** payment number, allocated bill, amount, remaining balance.

---

## Step 8 — Fictitious bank statement

**Where:** Bank → Import a statement.

**Action:** select `apps/web/public/samples/releve-bancaire-fictif.csv` and use
the preview before importing.

**Expected:** the CSV is accepted; errors and duplicates are flagged in the
preview; the import alone posts no accounting entry. The sample is a
French-language fictitious statement from the repository.

**Do not accept:** a silent import that posts entries, a duplicate accepted
without warning, or a real bank statement.

**Evidence:** file name, import preview counts, duplicate/error messages,
whether any entry was posted.

---

## Step 9 — Bank reconciliation

**Where:** Bank → Reconciliation; Bank → Report.

**Action:** match the `Encaissement client FA-2025-001` transaction
(125,000 MUR) to its ledger line, or exclude an unexplained transaction with a
reason. Reopen the report.

**Expected:** the match requires confirmation; the report shows status
`differences`, one matched item initially, sixteen unmatched bank transactions,
unmatched ledger lines and a reported difference of **1,191,500 MUR**. The
difference is explained by the report, never forced to zero. Matching one item
does not magically reconcile the account.

**Do not accept:** an automatic “all reconciled” status, a difference hidden
behind a plug entry, or a match without confirmation.

**Evidence:** before/after matched and unmatched counts, difference, reason for
any exclusion.

---

## Step 10 — Fixed-asset acquisition

**Where:** Fixed Assets.

**Action:** open `FA-2025-0001` (utility pick-up) and the register/ledger
reconciliation as of 2026-06-30.

**Expected:**

- cost **480,000 MUR**;
- accumulated depreciation **8,000 MUR**;
- net book value **472,000 MUR**;
- register cost 648,000, depreciation 21,000, impairment 2,000, CWIP 500,000;
- all differences **0.00 MUR**.

**Do not accept:** a register/ledger difference, a duplicate asset code, or a
depreciation calculated outside the displayed method.

**Evidence:** asset code, cost, accumulated depreciation, NBV, reconciliation
rows and difference.

---

## Step 11 — Inventory movement

**Where:** Inventory.

**Action:** open the FIFO item and its movement history; open the subledger
reconciliation.

**Expected:** quantity **110 units**, value **1,080 MUR**, reconciliation
difference **0.00 MUR**. Opening stock, purchase and sale movements are
traceable to journal entries.

**Do not accept:** a value that differs from quantity × cost without an
explanation, or a subledger difference hidden by a manual adjustment.

**Evidence:** item code, quantity, value, movement references, reconciliation
difference.

---

## Step 12 — Payroll simulation (if the engine allows it)

**Where:** Payroll; Payroll → Accounting transfer.

**Action:** open the January 2026 period and the simulated payslip
`SIM-202601-0001`; open the accounting-transfer preview.

**Expected:**

- period status **`blocked`**;
- 18 employees and 18 calculations;
- payslip status `simulation`, statutory status `EXPERT_REVIEW_PENDING`,
  mention **NOT FOR PAYMENT**;
- net payable **empty** — no amount is presented as payable;
- transfer preview is balanced but requires human approval; no automatic
  posting or payment.

**Do not accept:** a final payslip, a payable net, a PAYE/CSG/NSF compliance logo
or an automatic transfer.

**Evidence:** period status, payslip number, statutory status, net payable,
transfer status.

---

## Step 13 — General ledger

**Where:** General Ledger.

**Action:** filter over the full financial year and open a posted entry.

**Expected:** each movement has a journal, an entry number and balanced
debit/credit lines. The single draft entry does not appear as posted. Entry
numbers are unique across all journals and sources.

**Do not accept:** a movement without a journal, a duplicate entry number, an
unbalanced line, or a draft included in posted totals.

**Evidence:** account, entry number, journal, debit, credit, status.

---

## Step 14 — Trial balance

**Where:** Trial Balance.

**Action:** compare closing debit and credit.

**Expected:** closing debit = closing credit = **1,584,480 MUR**; opening
165,000 = 165,000; movements 3,026,880 = 3,026,880; `balanced = true`.

**Do not accept:** a one-sided adjustment, a rounding plug, or a total that does
not match the general ledger.

**Evidence:** three pairs of totals and the balanced indicator.

---

## Step 15 — Profit & Loss and Balance Sheet

**Where:** Profit & Loss; Balance Sheet.

**Action:** open both statements and compare with the dashboard and the trial
balance.

**Expected:**

- revenue **355,500 MUR**;
- expenses **353,900 MUR**;
- profit **1,600 MUR**;
- total assets **797,080 MUR**;
- liabilities **133,000 MUR**, equity **662,480 MUR**, unappropriated result
  **1,600 MUR**, total **797,080 MUR**;
- balance sheet `balanced = true`.

**Do not accept:** a result different from the P&L, an asset total different from
the ledger, or a hidden “suspense” line used to balance.

**Evidence:** P&L totals, balance-sheet totals, result.

---

## Step 16 — Coherence control and year-end closing

**Where:** Guided demo; Trial Balance; Year-End Closing.

**Action:** return to the Guided demo, read the eight health rows, then open
Year-End Closing and its checklist.

**Expected:**

- the trial balance, balance sheet, fixed assets and inventory are green;
- sales and purchase ledgers are explicitly marked as workflow data, not
  reconciled subledgers;
- the bank row is a warning because the practice account is intentionally not
  reconciled;
- payroll is blocked;
- FY 2023/2024 and FY 2024/2025 are closed; FY 2025/2026 is open;
- the closing checklist is explicit and does not apply a statutory rule
  automatically;
- **Reset demo data** restores the starting point without touching the server.

**Do not accept:** a green bank row that hides the difference, a green sales row
that ignores the 0 posted documents, or an automatic legal closing.

**Evidence:** eight health rows, period statuses, checklist state, reset result.

---

## Expected figures — quick reference

| Check | Expected |
|---|---:|
| Opening trial balance (debit = credit) | 165,000.0000 |
| Movements (debit = credit) | 3,026,880.0000 |
| Closing trial balance (debit = credit) | 1,584,480.0000 |
| Revenue | 355,500.0000 |
| Expenses | 353,900.0000 |
| Profit | 1,600.0000 |
| Total assets | 797,080.0000 |
| Liabilities | 133,000.0000 |
| Equity (excluding result) | 662,480.0000 |
| Share capital | 650,000.0000 |
| Open receivables | 61,000.0000 |
| Supplier outstanding | 95,000.0000 MUR + 1,000.0000 EUR |
| Fixed-asset cost (excluding CWIP) | 648,000.0000 |
| Accumulated depreciation | 21,000.0000 |
| Accumulated impairment | 2,000.0000 |
| CWIP | 500,000.0000 |
| Inventory | 110 units / 1,080.0000 MUR |
| Bank difference (MUR practice) | 1,191,500.0000 |
| Payroll period | blocked / simulation / NOT FOR PAYMENT |

## What to do when a step fails

1. Record the exact route, document number and amount.
2. Take a screenshot before and after the action.
3. Click **Reset demo data** and reproduce once.
4. If it reproduces, mark **Fail** in the questionnaire with severity.
5. Do not create a balancing entry, do not change a rule and do not edit the
   seeded data to make the step pass.

## Related documents

- `docs/comptai-expert-demo-guide-en.md` — non-technical demonstration guide;
- `docs/comptai-accountant-review-40-questions-en.md` — 40-question review;
- `docs/comptai-demo-known-limitations.md` — limitations and wording;
- `docs/mission-37-report.md` — implementation and test report.
