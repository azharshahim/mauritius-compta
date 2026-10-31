# Payroll security and privacy

**Mission 14.** Applies to the API, database, web UI, demo and exports.

## 1. Tenancy and permissions

- Every query filters by `company_id`; cabinet ownership is re-derived server-side.
- A valid identifier from another company returns 404/403, never data.
- Payroll permissions are distinct from accounting: `accountant` has no payroll
  access; `payroll_manager` can read accounting but cannot write it.
- Writers: owner, admin, cabinet admin, payroll manager. Other roles are denied
  before any salary or bank field is selected.
- The web menu is not a security boundary; each route calls
  `requireModuleAccess` and, for mutations, re-checks the role.

## 2. Salary and bank confidentiality

- Bank account numbers are truncated to `last4` and hashed (SHA-256 fingerprint)
  before insertion. Full numbers are never stored.
- Responses expose `bankAccountMasked`, never `bank_account_last4` in employee
  views; calculation detail also masks it.
- Statutory identifiers use the same treatment.
- Audit payloads contain amounts and reasons but no full bank number.
- PDF payslips show only the masked account; no date of birth or statutory id.
- CSV exports include no bank number and flag every net as simulation.
- Unauthorised users cannot see salary, bank or contract data because the service
  and route guards run before the query.

## 3. Integrity and history

- Contracts are versioned; supersession is explicit; change reasons are mandatory.
- Periods are locked from `approved`; calculations are versioned.
- Duplicate period, time entry and import keys are rejected by unique indexes.
- Transactions wrap contract supersession, leave decisions, rule validation,
  calculations, payslip creation and settings updates.
- `payroll_events` and `audit_log` record actor, action, entity and details.
- Database triggers refuse a final payslip while its calculation is not finalised,
  and a finalised period containing non-final calculations.
- Nothing is posted to accounting automatically; bank transfers do not exist.

## 4. Exports and documents

- CSV uses UTF-8 BOM, `;` separator and formula-injection escaping.
- PDFs are generated server-side for authenticated users; the demo uses browser
  printing and is labelled as such.
- Payslip PDF metadata is minimal (title/author); no tracking, no external call.
- A simulation payslip cannot be re-labelled final through the API.

## 5. AI assistant guardrails

The assistant is read-only for payroll. It can count employees, contracts,
periods, variables, pending leave and missing rules, and explain an existing
calculation from stored lines. It **must not**:

- invent a rate, threshold or entitlement;
- modify a salary or contract without human validation;
- approve, finalise or post anything;
- send personal data to a third party;
- create a fictitious statutory declaration.

No paid provider is enabled. The deterministic router selects one tool; tool calls
are logged; provider routing remains optional and disabled by default.

## 6. Demo boundary

The GitHub Pages build uses localStorage only. It never calls a server, never
contains real personal data, keeps the permanent demo marker, and can be reset.
The demo PDF is a browser print, not a generated official document.

## 7. Verified and unverified

Verified locally: role denial tests, cross-company tests, duplicate prevention,
masked responses, PDF bytes, CSV escaping, audit rows, migrations on PGlite.
Not verified: a physical Samsung/Android device, a real screen reader, penetration
testing, production PostgreSQL backup/restore beyond CI migrations, legal
retention requirements.
