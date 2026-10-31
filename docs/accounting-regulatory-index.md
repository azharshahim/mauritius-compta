# Accounting Regulatory Index (separate from payroll)

Status: **index only — no IFRS, no statutory-account production, no payroll journal.** This file is deliberately separate from the payroll audit dossier. Mission 15 does not implement accounting standards or financial statements.

| Domain | Authority / source | Official URL | What this application does | What it does not claim |
|---|---|---|---|---|
| Company law | Companies Act 2001, Laws of Mauritius | https://lawsofmauritius.govmu.org | Company, BRN and statutory identifiers stored locally | Legal incorporation or filing compliance |
| Financial reporting | Financial Reporting Act 2004 | https://lawsofmauritius.govmu.org | Chart of accounts and bookkeeping data model | Statutory financial statements |
| Reporting authority | Financial Reporting Council (FRC) | Not fetched in this mission; no URL asserted | Reference only | FRC approval of any output |
| Professional body | Mauritius Institute of Professional Accountants (MIPA) | Not fetched in this mission; no URL asserted | Reference only for the single expert review | MIPA endorsement |
| Accounting framework | IFRS | n/a | **Out of scope** | Any IFRS compliance |
| Payroll accounting | Payroll module | `docs/payroll-existing-audit.md` | Read-only accounting preview; no automatic entry | Payroll journal posting |
| Bank payments | n/a | n/a | No bank connection, no payment file | Payment execution |

Open points: confirm which reporting framework each demo company would use; confirm FRC/MIPA references; keep payroll and financial-reporting approval separate.
