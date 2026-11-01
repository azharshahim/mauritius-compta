# COMPTAI — Accountant review questionnaire (40 questions, English)

**Version:** COMPTAI 0.1.1 — demonstration
**Date:** 1 November 2026
**Company under review:** Island Trading Ltd — DEMO COMPANY
**Data:** fictitious only
**Purpose:** help a Mauritian chartered accountant decide what can be trusted in
the demonstration, what is incomplete, and what must be fixed before any
production discussion.

> This is not a production acceptance certificate. A “Pass” below means that an
> automated test or a verified API response supports the expected result. It
> does **not** replace your own observation. Record your own status in the
> right-hand column if you test it manually.

## How to use this questionnaire

1. Open the demonstration, select **Island Trading Ltd — DEMO COMPANY** and open
   **Guided demo** (`#/demo`).
2. Work through the questions by domain. Each row names the screen or route, the
   action, and the expected result.
3. Use only these statuses:
   - **Pass** — expected result observed;
   - **Fail** — wrong result, blocked action or unexplained amount;
   - **Not Tested** — you did not exercise it;
   - **Not Available** — the function does not exist in this build.
4. For every **Fail**, record the route, document number, amount, currency,
   exact wording, screenshot and whether it reproduces after **Reset demo
   data**.
5. Do not mark a preparatory screen as operational. A screen that displays an
   empty or blocked workflow is not a Pass for the underlying statutory
   function.

### Suggested severity

| Severity | Meaning |
|---|---|
| **Blocking** | Prevents the review or produces a materially wrong accounting figure |
| **High** | Statutory, reconciliation or data-integrity area not reliable |
| **Medium** | Function incomplete or workflow awkward, with a stated workaround |
| **Low** | Presentation, terminology, export or convenience issue |
| **—** | No failure identified in the pre-filled review |

### Pre-filled status: what it means

- **Pass** is pre-filled only where an automated test in this repository
  verifies the claim. It is evidence, not a manual sign-off.
- **Not Available** is pre-filled where the repository audit confirms that no
  implementation exists. No button was invented for this review.
- **Not Tested** is pre-filled where the feature exists but was not exercised
  end-to-end in this mission.
- **Fail** is deliberately not pre-filled. Only the reviewer can record a
  failure observed in their own session.

---

## A. Navigation and terminology

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 1 | Navigation / terminology | Identify the fictitious company and its exercise | Select **Island Trading Ltd — DEMO COMPANY**. Expected exercise 2025/2026, MUR, `DEMO-BRN-0001`, `DEMO-VAT-0001`, address marked fictitious. No real registration number should appear. | **Pass** | `mission37-demo-coherence.test.ts` verifies company identity, currency, standard label and 38 accounts. | — |
| 2 | Navigation / terminology | Open the guided route and its destinations | Open **Guided demo**. Expected 14 destination links and 16 numbered steps, all usable without network. | **Pass** | `mission37-guided-demo.test.tsx` verifies 14 quick links, 16 steps, 8 health rows and no `fetch` call. | — |
| 3 | Navigation / terminology | English default with a preserved French choice | On a clean browser, open the demo: English. Choose French, reload: French remains. | **Pass** | `ensureDemoLocale()` tests in `mission37-guided-demo.test.tsx`; French preference is never overwritten. | — |
| 4 | Navigation / terminology | Recognisable accounting navigation | Check groups and labels: Dashboard, Chart of Accounts, Journal Entries, General Ledger, Trial Balance, Bank Reconciliation, Sales Invoices, Bills, Fixed Assets, Inventory, Payroll, Profit & Loss, Balance Sheet, Year-End Closing. | **Pass** | Mission 36 navigation tests (`mission36-navigation`, `mission36-ui`, `i18n-quality`). | — |
| 5 | Navigation / terminology | Company isolation | Switch to another demo company; expected different accounts and documents. Return to Island Trading. | **Pass** | M37 test verifies isolation and reproducible reset; one company is archived. | — |

## B. Chart of accounts

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 6 | Chart of accounts | Completeness and coherence | Open **Chart of Accounts**. Expected 38 accounts with code, name, type and statement mapping. No duplicate code. | **Pass** | M37 test verifies count, required core accounts and unique codes. | — |
| 7 | Chart of accounts | Obvious demo marking | Open any account. Expected description “DEMO account — not an official chart of accounts”. | **Pass** | Seed accounts carry the DEMO description; 38 accounts counted. | — |
| 8 | Chart of accounts | Search a specific account | Use the assistant or account search for `1200`. Expected `1200 — VAT recoverable (preliminary)` and an explicitly non-official status. | **Pass** | `demo-assistant.test.ts` verifies account search after the English rename. | — |
| 9 | Chart of accounts | Create or edit an account | Create a new account with a unique code, then edit its name. Expected validation and persistence. | **Not Tested** | Function exists; no manual review in this mission. | To assess |
| 10 | Chart of accounts | Export the chart | Look for an export action. Expected a CSV/Excel export if the product claims one. | **Not Available** | Mission 36 audit confirmed no chart export; no button was invented. | Medium |

## C. Journal entries and journals

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 11 | Entries / journals | Entry population and unique numbers | Open **Journal Entries**. Expected 59 entries, unique `entry_no`, 58 posted and 1 explicit draft. | **Pass** | M37 test verifies 59 entries, unique numbers, one draft, balanced lines. | — |
| 12 | Entries / journals | Draft excluded from posted ledger | Identify the single draft. Expected it not to affect posted trial balance or statements. | **Pass** | M37 test checks the draft separation and ledger continuity. | — |
| 13 | Entries / journals | Filter by journal and date | Filter the entries by SAL/BQ/PUR and by a date range. Expected a coherent subset and visible active filter. | **Not Tested** | Filtering exists; not manually exercised. | To assess |
| 14 | Entries / journals | Create, post, reverse a manual entry | Create a balanced entry, post it, then reverse it. Expected debit = credit and traceable reversal. | **Not Tested** | Workflow exists; no manual test in this mission. | To assess |
| 15 | Entries / journals | Audit trail | Open the audit trail tab and find an entry event. Expected actor, timestamp and action. | **Not Tested** | Audit trail exists from mission 36; not manually reviewed. | To assess |

## D. Financial statements

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 16 | Financial statements | Trial balance | Open **Trial Balance**. Expected opening 165,000 = 165,000; closing 1,584,480 = 1,584,480; `balanced = true`. | **Pass** | M37 test verifies opening, movement and closing equality. | — |
| 17 | Financial statements | Profit & Loss | Open **Profit & Loss**. Expected revenue 355,500, expenses 353,900, profit 1,600 MUR. | **Pass** | M37 test compares P&L with ledger and dashboard. | — |
| 18 | Financial statements | Balance Sheet | Open **Balance Sheet**. Expected assets 797,080 = liabilities 133,000 + equity 662,480 + result 1,600. | **Pass** | M37 test verifies `balanced = true` and the equation. | — |
| 19 | Financial statements | Drill-down and export | From a statement line, open the underlying account/ledger; export the statement. Expected traceability and a usable file. | **Not Tested** | Drill-down/export exist for several reports; not manually exercised. | To assess |
| 20 | Financial statements | Cash-flow statement | Look for a cash-flow statement. Expected a real statement or an explicit absence. | **Not Available** | Verified absent in mission 36; not simulated. | Medium |

## E. Bank and reconciliation

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 21 | Bank | Two fictional accounts | Open **Bank Reconciliation**. Expected a MUR practice account and an EUR account, both marked DEMO, with masked fake numbers. | **Pass** | M37 test verifies two accounts and currencies; UI test verifies masked labels. | — |
| 22 | Bank | CSV import and duplicate detection | Import `releve-bancaire-fictif.csv` in preview. Expected errors/duplicates flagged and no automatic posting. | **Pass** | `bank-ui.test.tsx` imports the sample without network and checks the flow. | — |
| 23 | Bank | Match a receipt / partial settlement | Match `Encaissement client FA-2025-001` or the scenario B partial receipt. Expected confirmation and no over-allocation. | **Pass** | `bank-ui.test.tsx` covers scenario B and supplier-linked payments. | — |
| 24 | Bank | Reconciliation report explains the difference | Open the bank report. Expected status `differences`, matched/unmatched counts and explicit causes; no forced zero. | **Pass** | M37 test checks 1 matched, 16 unmatched, difference 1,191,500 and explanation codes. | — |

## F. Sales and purchases

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 25 | Sales / purchases | Sales invoice arithmetic | Open `FAC-DEMO-0002` (5,000 MUR). Expected exact line arithmetic and a visible posting state. | **Pass** | M37 test recomputes every sales document total. | — |
| 26 | Sales / purchases | Partial customer payment | Open a partially paid invoice (`FAC-DEMO-0001`, 24,000 total, 6,000 outstanding). Expected allocation never above the total. | **Pass** | M37 test verifies document totals and outstanding amounts; payments total 10, unallocated 0. | — |
| 27 | Sales / purchases | Supplier bill and partial payment | Open `FAC-DEMO-1001`. Expected 80,000 invoiced, 30,000 paid, 50,000 outstanding; `RF-2026-0001` allocated. | **Pass** | M37 test checks aging and allocation; purchases UI test checks the reference. | — |
| 28 | Sales / purchases | Multi-currency aging | Open **Bills → Aging**. Expected MUR 95,000 and EUR 1,000 shown separately, never summed. | **Pass** | M37 test filters by currency and checks the two aging totals. | — |
| 29 | Sales / purchases | Post a sales invoice to the ledger | Open a seeded sales invoice and use the posting workflow. Expected a balanced ledger entry and a posted state. | **Not Tested** | Posting capability exists with `human_validation_required`, but **0 of 12** seeded sales documents is posted; the workflow was not manually exercised. | To assess |

## G. Fixed assets and inventory

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 30 | Fixed assets / inventory | Fixed-asset register | Open **Fixed Assets**. Expected 6 assets with unique codes, including an in-service pick-up, a disposed machine, a fully depreciated printer and a CWIP. | **Pass** | M37 test verifies count, unique codes and key assets. | — |
| 31 | Fixed assets / inventory | Register vs ledger reconciliation | Open the reconciliation report as of 30/06/2026. Expected cost, depreciation and impairment differences all 0.00; CWIP 500,000 both sides. | **Pass** | M37 test verifies cost 648,000, depreciation 21,000, impairment 2,000 and zero difference. | — |
| 32 | Fixed assets / inventory | Run depreciation for a new asset | Create an asset, set a method and useful life, run a depreciation batch. Expected a balanced expense/accumulated-depreciation entry. | **Not Tested** | Function exists; no manual run in this mission. | To assess |
| 33 | Fixed assets / inventory | Inventory subledger reconciliation | Open **Inventory**. Expected 110 units, 1,080 MUR and a 0.00 reconciliation to the inventory account. | **Pass** | M37 test verifies quantity, value and zero difference. | — |

## H. Payroll

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 34 | Payroll | Blocked simulation period | Open **Payroll**. Expected January 2026 period `blocked`, 18 employees, 18 calculations and no final payroll run. | **Pass** | M37 test verifies 18 employees, blocked period, simulated payslip and unique names. | — |
| 35 | Payroll | Payslip is not payable | Open `SIM-202601-0001`. Expected status `simulation`, `EXPERT_REVIEW_PENDING`, **NOT FOR PAYMENT**, net payable empty. | **Pass** | M37 test verifies the snapshot status and the absence of a payable net. | — |
| 36 | Payroll | Accounting transfer is a preview | Open **Payroll → Accounting transfer**. Expected a balanced preview requiring human approval, with no automatic posting or payment. | **Pass** | `payroll-ui.test.tsx` verifies a balanced transfer, test approval and no active posting button. | — |

## I. Multi-company and practice

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 37 | Multi-company / practice | Five demo companies, one archived | Use the company selector. Expected 5 companies, one archived; data and balances do not leak between them. | **Pass** | M37 isolation test and demo inventory; no cross-company figures. | — |
| 38 | Multi-company / practice | Consolidation and cost centres | Look for consolidated statements or cost-centre reporting. Expected an explicit absence if not implemented. | **Not Available** | Verified absent in mission 36; not simulated. | Medium |

## J. Gaps against QuickBooks / Sage / Xero

| # | Domain | Feature to test | Action and expected result | Pre-filled status | Evidence / comment | Severity |
|---:|---|---|---|---|---|---|
| 39 | Gaps vs competitors | MRA e-invoicing and VAT returns | Look for an MRA e-invoice submission and a VAT return. Expected an explicit “not implemented” statement; no fake submission. | **Not Available** | API exposes `mraEInvoicing: false`; VAT is not computed (`vat_enabled = false`). No conformity is claimed. | High |
| 40 | Gaps vs competitors | Live bank feed | Look for a bank connection or automatic feed. Expected an explicit absence; only CSV import is supported. | **Not Available** | Only fictitious CSV import exists; the demo never contacts a bank. | Medium |

---

## Summary sheet

| Domain | Questions | Pass | Not Tested | Not Available | Fail |
|---|---:|---:|---:|---:|---:|
| A. Navigation and terminology | 5 | 5 | 0 | 0 | 0 |
| B. Chart of accounts | 5 | 3 | 1 | 1 | 0 |
| C. Journal entries and journals | 5 | 2 | 3 | 0 | 0 |
| D. Financial statements | 5 | 3 | 1 | 1 | 0 |
| E. Bank and reconciliation | 4 | 4 | 0 | 0 | 0 |
| F. Sales and purchases | 5 | 4 | 1 | 0 | 0 |
| G. Fixed assets and inventory | 4 | 3 | 1 | 0 | 0 |
| H. Payroll | 3 | 3 | 0 | 0 | 0 |
| I. Multi-company and practice | 2 | 1 | 0 | 1 | 0 |
| J. Gaps vs competitors | 2 | 0 | 0 | 2 | 0 |
| **Total** | **40** | **28** | **7** | **5** | **0** |

## Reviewer sign-off

| Field | Value |
|---|---|
| Reviewer name | |
| Date | |
| Build / commit reviewed | |
| Browser and device | |
| Questions passed / failed / not tested / not available | |
| Blocking issues found | |
| Overall opinion (demonstration only) | |
| Signature | |

**Reminder:** no result in this questionnaire authorises a production release.
P0-03, P0-04, P0-05 and P1-16 remain open in the project register.
