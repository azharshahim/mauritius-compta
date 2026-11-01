# COMPTAI — Accountant demonstration guide (English)

**Version:** COMPTAI 0.1.1 — demonstration build
**Date:** 1 November 2026
**Audience:** Mauritian chartered accountant / reviewer
**Data:** fictitious only
**Status:** demonstration, not a production release

---

## 1. What you are about to review

COMPTAI is a bilingual (French/English) accounting application. This guide
covers the **browser demonstration**: a self-contained, fictitious Mauritian
trading company named **Island Trading Ltd — DEMO COMPANY**.

The demonstration is not an empty shell. It contains a chart of accounts, 59
journal entries, customers and suppliers, sales and purchase documents, two
fictional bank accounts, fixed assets, one inventory item, employees, previous
financial years and financial statements. Every amount is stored in your own
browser. Nothing is sent to a real bank, the Mauritius Revenue Authority, an AI
provider or another company.

The demonstration opens **in English** when no language has been saved. If you
already chose French, COMPTAI keeps your choice; use the language switch to
return to English.

> **Important:** this is a review of a demonstration, not a production
> acceptance. Please record what you can test and what you cannot test. Do not
> infer statutory compliance from any screen.

## 2. Before you start

### 2.1 Run the published demonstration

If a demonstration URL has been supplied by the COMPTAI team, open it and use
the pre-filled demonstration sign-in button. The demonstration credentials are
injected at build time and are **not production credentials**. Do not reuse
them anywhere else.

This mission did not deploy or publish the build. If no URL is available, use
the local procedure below.

### 2.2 Run it locally (optional, for a technical reviewer)

From the repository root:

```bash
npm ci
npm run build:demo
npm run preview -w @mc/web -- --host 0.0.0.0
```

Then open the URL printed by Vite (usually `http://localhost:4173`) and add
`#/demo` to reach the guided tour directly.

The demonstration stores its state in `localStorage` under
`mc.demo.state.v1`. It does not need a database, an API server, an internet
connection or a bank connection.

### 2.3 Choose the company

After signing in, use the **Company** selector in the top bar and select:

**Island Trading Ltd — DEMO COMPANY**

You should see:

| Field | Expected |
|---|---|
| Financial year | 1 July 2025 – 30 June 2026 |
| Functional currency | MUR |
| BRN | `DEMO-BRN-0001` (obviously fictitious) |
| VAT number | `DEMO-VAT-0001` (obviously fictitious) |
| Registered address | fictitious Port Louis address |
| Accounting standard label | `Other` — informational only |

Four other demonstration companies are present (one archived). They are used to
check that data does not leak between companies. They are all fictitious.

## 3. The guided route: `/#/demo`

Open **Guided demo** in the **Home** navigation group, or go directly to `#/demo`.

The page is a reviewer workspace, not a new accounting engine. It contains:

1. the active company’s identification and financial year;
2. **eight live health checks** — trial balance, balance sheet, fixed assets,
   inventory, sales ledger, purchase ledger, bank reconciliation and payroll;
3. **fourteen direct destinations** for the review;
4. the **sixteen-step accounting scenario**;
5. the known limitations, written on the page;
6. **Reset demo data**.

No figure on this page is hard-coded. If you change a report, the health row
changes with it.

### 3.1 The fourteen destinations

| Destination | What it is for |
|---|---|
| Dashboard | Overall position, profit and balance-sheet control |
| Chart of Accounts | 38 demo accounts, types and statement mapping |
| Journal Entries | 59 entries, one draft, unique entry numbers |
| General Ledger | Account movements and entry drill-down |
| Trial Balance | Opening, movements and closing debit/credit |
| Bank Reconciliation | Two fictional accounts, CSV import and matching |
| Sales Invoices | Quotes, invoices, credit note and payment status |
| Bills | Supplier bills, credit note, payments and aging |
| Fixed Assets | Six assets, depreciation, disposal, reconciliation |
| Inventory | One FIFO item, movements and subledger reconciliation |
| Payroll | Blocked simulation period and simulated payslip |
| Profit & Loss | Revenue 355,500, expenses 353,900, profit 1,600 MUR |
| Balance Sheet | Assets 797,080 = liabilities and equity 797,080 MUR |
| Year-End Closing | Opening balances, checklist, adjustments and archives |

## 4. Suggested 60-minute review

### 0–10 minutes — orientation

1. Confirm the company and financial year.
2. Open **Dashboard** and note the profit (1,600 MUR) and total assets
   (797,080 MUR).
3. Open **Guided demo** and read the eight health rows. Two rows are deliberately
   informational rather than green: the sales and purchase ledgers are workflow
   data, not reconciled subledgers.

### 10–25 minutes — accounting records

4. Open **Chart of Accounts** and search for account `1200` (VAT recoverable,
   preliminary). Confirm that it is marked as a demo account and is not an
   official chart.
5. Open **Journal Entries**. Check that entry numbers are unique and that only
   one entry is a draft. Open a posted entry and confirm that debits equal
   credits.
6. Open **General Ledger** for the year and trace a movement back to its journal
   and entry number.
7. Open **Trial Balance**. Confirm closing debit = closing credit =
   **1,584,480 MUR**.
8. Open **Profit & Loss** and **Balance Sheet**. Confirm that the result agrees
   with the dashboard and that assets = liabilities + equity.

### 25–40 minutes — operational documents

9. **Sales Invoices:** open `FAC-DEMO-0002` (5,000 MUR). Check the line
   arithmetic and the posting state. The demonstration documents are workflow
   records; none of the twelve sales documents is posted to the ledger.
10. **Bills:** open `FAC-DEMO-1001`. Expected: 80,000 invoiced, 30,000 paid,
    **50,000 MUR outstanding**.
11. **Customer payments:** trace a receipt to its invoice. The allocation must
    never exceed the invoice total.
12. **Supplier payments:** open `RF-2026-0001` (30,000 MUR allocated to
    `FAC-DEMO-1001`). Try to allocate more than the outstanding amount; the
    application must refuse it.
13. **Bank Reconciliation:** import
    `apps/web/public/samples/releve-bancaire-fictif.csv` in preview mode. The
    sample is a French-language fictitious bank statement. Check that errors and
    duplicates are flagged and that the import itself posts nothing.
14. Open the bank **report**. It shows status `differences`: one matched item,
    sixteen unmatched bank transactions and a reported difference of
    1,191,500 MUR. The report explains the difference; it does not force it to
    zero.

### 40–52 minutes — assets, stock and payroll

15. **Fixed Assets:** open `FA-2025-0001` (utility pick-up). Cost 480,000,
    accumulated depreciation 8,000, net book value 472,000 MUR. Open the
    register/ledger reconciliation: all differences are **0.00 MUR**.
16. **Inventory:** open the FIFO item. Quantity 110, value 1,080 MUR.
    The subledger reconciles to the inventory account at 0.00 MUR difference.
17. **Payroll:** the January 2026 period is **blocked**. Open the simulated
    payslip `SIM-202601-0001`. It is marked **NOT FOR PAYMENT** and
    `EXPERT_REVIEW_PENDING`; net payable is empty. Open the accounting transfer
    preview: it requires a human decision and does not post automatically.

### 52–60 minutes — closing and reset

18. **Year-End Closing:** open the timeline, opening balances, checklist and
    prior-year adjustments. Previous years are closed; the current year is open.
    No statutory closing rule is applied automatically.
19. Return to **Guided demo** and use **Reset demo data**. Confirm that the
    demonstration is restored and that you are not asked to touch a server or
    another environment.

## 5. What to record

Use `docs/comptai-accountant-review-40-questions-en.md` for the structured
review. For each question record one status:

- **Pass** — the expected result was observed;
- **Fail** — the result was wrong or the application blocked you;
- **Not Tested** — you did not exercise it;
- **Not Available** — the function does not exist in this build.

For every Fail, record:

| Field | What to write |
|---|---|
| Question number | e.g. Q27 |
| Screen / route | e.g. `#/accounting/purchases?tab=payments` |
| Company | Island Trading Ltd — DEMO COMPANY |
| Action | exact click / value entered |
| Expected | what the guide or screen says should happen |
| Observed | what actually happened |
| Amount / document | number and currency |
| Severity | Blocking / High / Medium / Low |
| Evidence | screenshot name, export or exact wording |
| Reproducible after reset? | Yes / No |

Do not report a “Pass” based on this guide alone. The guide describes the
expected result; only your observation counts.

## 6. Reset and data safety

**Reset demo data** (Guided demo page):

- removes only `mc.demo.state.v1` in this browser;
- clears the selected demo company and reloads the guided page;
- does **not** touch the API database, another browser, another environment or
  the OVH server;
- restores the same fictional figures.

If you want a completely clean browser state, also clear site data for the
demonstration origin. This removes your language preference and session; it
does not affect the server.

## 7. Known limitations you should test explicitly

These are deliberate limits, not hidden defects. Record them as **Not
Available** or **Not Tested** where appropriate.

1. **Sales and purchase subledgers are not reconciled to the ledger.** The
   seeded documents are workflow records. No sales document is posted
   (`postedDocuments: 0`). Open receivables are 61,000 MUR while the trade
   receivable account is 81,500 MUR. Purchase outstanding is 95,000 MUR +
   1,000 EUR while trade payables are 128,000 MUR. The health rows say so.
2. **The bank account is intentionally unreconciled.** The practice account
   keeps one matched item, sixteen unmatched transactions and a reported
   difference. This is the scenario you are asked to work through, not a finished
   reconciliation.
3. **The bank ledger balance is negative (−404,500 MUR).** Read it as an
   overdrawn practice position, not as proof that the statement reconciles.
4. **Payroll is a simulation.** Period blocked, statutory rules incomplete, no
   net payable, no PAYE/CSG/NSF compliance claim, no payment file.
5. **VAT is not computed.** `vat_enabled = false`. Account 1200 is preliminary.
   Do not test tax calculations as operational.
6. **MRA e-invoicing, VAT returns and statutory filings are not implemented.**
   The API reports `mraEInvoicing: false`.
7. **No cash-flow statement, no cost-centre accounting, no consolidation.**
8. **No chart-of-accounts export.**
9. **No live bank feed.** Only CSV import of a fictitious statement.
10. **No manual device test was performed by the COMPTAI team.** If you open the
    demonstration on a phone or tablet, you are the first reviewer doing so;
    record what you observe.
11. **The demo is browser-local.** It never contacts a bank, the MRA or an AI
    provider.

The full register is in `docs/comptai-demo-known-limitations.md`.

## 8. Troubleshooting

| Symptom | Explanation | What to do |
|---|---|---|
| The company selector shows another company | The last demo company is remembered | Select Island Trading Ltd — DEMO COMPANY |
| The page is in French | A French preference is saved | Use the language switch; English is the default for a new reviewer |
| Figures look different after testing | Demo data is mutable and stored in the browser | Use **Reset demo data** |
| Bank report is not “reconciled” | Intentional practice difference | Read the explanations and unmatched counts |
| Payroll shows “blocked” | Intentional simulation | Do not expect a payment or statutory bulletin |
| No sales document is posted | Intentional workflow state | Use the posting workflow if you want to test it; record the result |
| A report export is missing | Not every report has an export | Record it as Not Available if the questionnaire asks for it |

## 9. What this demonstration does not claim

- It does not claim IFRS compliance. The accounting standard field says `Other`.
- It does not claim MRA e-invoicing or VAT compliance.
- It does not claim statutory payroll compliance.
- It does not claim production readiness or security certification.
- It does not claim compatibility with QuickBooks, Sage, Xero, Odoo or Zoho.
- It does not claim that every figure is a reconciled subledger. Where a
  reconciliation is not reliable, the screen says so.

## 10. After the review

Send the completed questionnaire and any evidence to the COMPTAI team. A
“Fail” is useful: the purpose of this demonstration is to find what an
accountant cannot trust before any production decision. No production release
will be made from this review alone.
