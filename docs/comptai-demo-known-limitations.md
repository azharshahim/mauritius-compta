# COMPTAI demonstration — known limitations

**Version:** COMPTAI 0.1.1 — demonstration
**Date:** 1 November 2026
**Company:** Island Trading Ltd — DEMO COMPANY
**Scope:** browser demonstration, fictitious data only
**Status:** not a production release

---

## 1. Why this document exists

A professional demonstration must not hide an unreliable figure behind a green
badge. This register lists what the demonstration does **not** do, what is only
partially reconciled, and how to describe it honestly to an accountant.

Two rules apply:

1. A limitation is not a defect to be “fixed” by inventing an amount or changing
   an accounting rule.
2. If a report cannot be reconciled from the data shown, it must say so. The
   Guided demo page currently marks the sales and purchase ledgers as workflow
   data and the bank as a warning.

## 2. Summary of limitations

| ID | Limitation | Area | Severity | Status |
|---|---|---|---|---|
| L01 | Sales documents are not posted to the ledger; the sales subledger is not reconciled | Sales | **High** | Intentional demo state |
| L02 | Purchase documents are not posted; the purchase subledger is not reconciled | Purchases | **High** | Intentional demo state |
| L03 | Bank practice account is deliberately unreconciled | Bank | **High** | Intentional exercise |
| L04 | Bank ledger balance is negative (−404,500 MUR) | Bank / statements | **Medium** | Explained, not corrected |
| L05 | Payroll is a blocked simulation, not statutory payroll | Payroll | **High** | By design |
| L06 | VAT is not computed; account 1200 is preliminary | Tax | **High** | By design |
| L07 | MRA e-invoicing and VAT returns are not implemented | Tax | **High** | Not available |
| L08 | No cash-flow statement | Reporting | **Medium** | Not available |
| L09 | No cost-centre accounting or consolidation | Reporting | **Medium** | Not available |
| L10 | No chart-of-accounts export | Reporting | **Medium** | Not available |
| L11 | No live bank feed; CSV only | Bank | **Medium** | Not available |
| L12 | Demonstration runs only in localStorage | Architecture | **Medium** | By design |
| L13 | Some source-document labels remain French in an English UI | Presentation | **Low** | Documented |
| L14 | Bundle size above 500 kB | Performance | **Low** | Warning |
| L15 | No manual phone/tablet or real-browser test by the team | Validation | **Medium** | Not performed |
| L16 | Production readiness is not established; P0-03 remains open | Release | **Blocking for production** | Open |

## 3. Detail

### L01 — Sales subledger is not reconciled to the ledger

**Observed:** 12 sales documents (1 quote, 10 invoices, 1 credit note). Open
receivables are **61,000 MUR** (aging: 5,000 current, 6,000 at 61–90 days,
50,000 over 90 days). `postedDocuments = 0`: no seeded sales document has a
posted accounting entry. The trade receivable account in the ledger is
**81,500 MUR**, so the difference against open receivables is **20,500 MUR**.

**Why:** the documents are workflow data used to test numbering, allocation,
aging and posting controls. Posting them automatically would change every
financial statement and would bypass the human-validation rule.

**What the screen says:** the sales health row is informational and includes
“Workflow data — not a reconciled subledger”.

**What not to say:** “the sales ledger reconciles to the general ledger”. It does
not.

**What to test:** the posting workflow itself (Q29), then record whether the
resulting entry is balanced and whether the subledger and ledger then agree.

### L02 — Purchase subledger is not reconciled to the ledger

**Observed:** 9 purchase documents (7 invoices, 1 credit note, 1 draft), 3
payments and 1 advance. Aging is **95,000 MUR + 1,000 EUR**, shown separately.
The trade payable account is **128,000 MUR**. Seven documents are awaiting
accounting; one invoice is already posted through the ledger. The difference is
therefore not a single clean reconciliation.

**Why:** same as L01 — the purchase module is a workflow layer, not a fully
posted subledger in the seeded data.

**What not to say:** “supplier balances are fully reconciled”. They are not.

### L03 — Bank practice account is intentionally unreconciled

**Observed (MUR practice account):**

| Item | Value |
|---|---:|
| Status | `differences` |
| Matched | 1 |
| Unmatched bank transactions | 16 |
| Bank statement balance | 787,000 MUR |
| Ledger balance | −404,500 MUR |
| Reported difference | 1,191,500 MUR |
| Explanation codes | `UNMATCHED_BANK_TRANSACTIONS`, `UNMATCHED_LEDGER_LINES`, `BALANCE_DIFFERENCE` |

The EUR account has a separate 1,000 EUR difference.

**Why:** the account is a practice dataset. It contains grouped transfers,
partial settlements, duplicate attempts, an internal transfer and an unexplained
transaction so that matching and exclusion can be tested. Forcing the
reconciliation to zero would make the exercise meaningless and would hide a real
control failure.

**What to test:** matching one item, excluding one item with a reason, and
checking that the report still lists every remaining difference.

**What not to say:** “the bank is reconciled”. It is not.

### L04 — Negative bank ledger balance

The MUR bank account shows **−404,500 MUR** at the ledger level. In the balance
sheet it is presented as a negative cash line. It can be read as an overdraft,
but the demonstration does not model an overdraft facility or interest. It is a
consequence of the practice transactions, not a proof that the account is
coherent.

**Reviewer action:** record the presentation; do not “correct” it by posting an
invented cash entry.

### L05 — Payroll is a simulation

| Item | State |
|---|---|
| Period | January 2026, `blocked` |
| Employees | 18 |
| Calculations | 18 |
| Payslip | `SIM-202601-0001`, `simulation` |
| Statutory status | `EXPERT_REVIEW_PENDING` |
| Net payable | `null` |
| Mention | **NOT FOR PAYMENT** |

No PAYE, CSG, NSF or MRA compliance is claimed. The accounting transfer is a
balanced preview pending human approval. The demonstration must not be used to
pay anyone or to file a statutory return.

### L06 — VAT is not computed

`billingSettings.vat_enabled = false`. Account `1200 — VAT recoverable
(preliminary)` exists for chart completeness only. No invoice in the demo carries
a VAT amount, and no VAT return can be produced. Do not test a tax calculation as
if it were operational.

### L07 — MRA e-invoicing and VAT returns are absent

The billing capabilities expose `mraEInvoicing: false` and a notice that MRA
e-invoicing is not implemented. There is no submission button, no e-invoice XML,
no VAT return and no MRA acknowledgement. This is a deliberate absence, not a
hidden feature.

### L08 — No cash-flow statement

There is no statement of cash flows in the reports. The balance sheet and P&L
exist, but cash-flow reporting does not. Do not infer it from the bank module.

### L09 — No cost centres, departments or consolidation

There is no cost-centre accounting, no departmental P&L, no consolidation of the
five demo companies and no elimination entries. The five companies are isolated
demos, not a group.

### L10 — No chart-of-accounts export

The chart can be viewed and used, but there is no export action. This was
verified during the mission 36 audit; no button was invented for mission 37.

### L11 — No live bank feed

Only a CSV import of a fictitious statement is available. The demonstration
never contacts a bank. There is no Open Banking, PSD2, direct debit or automatic
feed.

### L12 — Browser-local architecture

All demo data is in `localStorage` under `mc.demo.state.v1`. It is not
multi-user, not server-side, not durable across browsers and not a database
demonstration. **Reset demo data** deletes only this key and the selected demo
company; it does not touch the API database or another environment.

This is suitable for a guided review, not for a multi-user pilot.

### L13 — Mixed language in source data

The interface, accounts, journals and most seeded documents are in English. The
fictitious bank statement and some bank transaction labels remain in French
because the CSV is the source document and its labels are used for duplicate
detection. A reviewer switching to French will also see English document
descriptions. This is a presentation limitation, not an accounting error.

**What not to say:** “the whole demonstration is fully bilingual”. The UI is
bilingual; user/source data is not translated.

### L14 — Bundle size warning

The production build is 1,256.88 kB (311.79 kB gzip); the demo build is
2,001.23 kB (519.90 kB gzip). Vite warns above 500 kB. No functional failure was
observed, but no performance optimisation was performed in this mission.

### L15 — No manual device or real-browser test

The team did not perform a manual review on a physical phone, tablet or a real
desktop browser. Interface tests run under jsdom with React Testing Library.
They check behaviour and accessibility queries, not visual layout, touch
scrolling or browser-specific rendering. If you test on a device, you are the
first reviewer doing so.

### L16 — Production readiness is not established

COMPTAI 0.1.1 remains a demonstration. P0-03 is open; P0-04, P0-05 and P1-16 are
not closed. This mission does not authorise production, a real client file, a
real bank connection, a statutory payroll run or a tax filing.

## 4. Data-integrity checks that do pass

These are the counterbalances to the limitations above. They were verified by
automated tests, not by manual inspection:

- every journal entry has equal debit and credit;
- all 59 entry numbers are unique;
- exactly one entry is a draft and it is excluded from posted totals;
- opening, movement and closing trial balances are equal on both sides;
- balance sheet: assets 797,080 = liabilities 133,000 + equity 662,480 + result
  1,600;
- P&L: 355,500 − 353,900 = 1,600;
- fixed-asset register vs ledger: 0.00 difference for cost, depreciation and
  impairment; CWIP 500,000 on both sides;
- inventory subledger vs ledger: 0.00 difference;
- sales and purchase document arithmetic is exact;
- the two currencies in purchase aging are not added together;
- company isolation and reset reproducibility are tested.

Passing these checks does **not** turn an unreconciled subledger into a
reconciled one. Both statements must be kept together.

## 5. Wording for a client conversation

Use plain, non-defensive wording:

- “The demonstration contains a deliberately unreconciled bank account so that
  you can test matching. The report shows every difference; it does not pretend
  the account is balanced.”
- “Sales and purchase documents are workflow records in this demo. They are not
  posted to the ledger by default, so the subledger and the ledger do not
  reconcile. You can test the posting workflow, and we will record the result.”
- “Payroll is a blocked simulation. It is not a payroll product and makes no
  statutory compliance claim.”
- “VAT, MRA e-invoicing, cash flow, cost centres and consolidation are not
  implemented. We are not going to demonstrate them as if they were.”
- “This is a demonstration, not a production acceptance. A production decision
  requires the open P0 items to be closed and a separate validation.”

## 6. What would be required before a production claim

At minimum:

1. close P0-03, P0-04, P0-05 and P1-16;
2. decide and implement the posting model for sales and purchase documents, or
   explicitly keep them as non-posting workflow records;
3. provide a reconciled bank scenario with a deliberate difference policy;
4. validate payroll rules with a qualified Mauritian payroll specialist;
5. implement and verify MRA e-invoicing/VAT requirements before any claim;
6. provide a real multi-user, server-side persistence and backup story;
7. perform manual browser and device testing;
8. obtain explicit authorisation before any deployment or publication.

No such claim is made in this mission.
