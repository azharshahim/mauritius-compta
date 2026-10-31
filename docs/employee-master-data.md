# Employee master data and contracts

**Mission 14 reference.** All examples are fictional. Fields marked
`configuration-dependent` must be verified for the employer before production use.

## 1. Employee record

| Group | Fields |
|---|---|
| Identity | employee number, first/last/preferred name, full name |
| Birth & nationality | date of birth, nationality, country of residence |
| Contact | address, e-mail, phone, emergency contact (name, phone, relation) |
| Employment | status (`active`, `probation`, `suspended`, `terminated`), hire date, termination date, department, job title, work location, manager, cost centre |
| Payroll | currency (default MUR), payment method (`bank_transfer`, `cheque`, `cash`) |
| Protected | bank name, account `last4`, account fingerprint, statutory id `last4` + fingerprint, statutory reference `last4` |
| Notes | free text |

Both Mauritian and foreign employees use the same record. Nationality and country
are descriptive, not a tax-status determination. Statutory identifiers are collected
**only according to a verified configuration**; the software does not claim that a
given identifier is legally required.

### Bank data

The API accepts an account number, immediately strips spaces, stores only the last
four digits and a SHA-256 fingerprint, and returns `bankAccountMasked` (`•••• 1234`).
The full number is never written to PostgreSQL, logs, CSV, PDF or audit payloads.
Replacing the number creates a new fingerprint; no full number can be retrieved.

### Duplicates

Before creation, the service checks employee number, e-mail, and name + date of
birth. A match returns `PAYROLL_EMPLOYEE_DUPLICATE` with candidates. The user may
create a distinct record with `allowDuplicate: true`; **nothing is merged
automatically**. The employee number remains unique per company.

## 2. Contracts

A contract carries type (`permanent`, `fixed_term`), work pattern (`full_time`,
`part_time`), effective dates, base salary, salary period (`monthly`, `hourly`,
`daily`), currency, weekly hours, department, job title, location, probation end,
change reason and optional `amendment_of`.

Rules enforced by the service and database:

- effective end cannot precede effective start;
- one active contract per employee per company (partial unique index);
- creating a new active contract supersedes the previous one and closes it the day
  before the new effective date;
- `change_reason` is mandatory;
- every creation, amendment and termination writes a `payroll_contract_events` row
  and an audit event with actor and payload;
- termination requires a reason and a date;
- no update silently overwrites a salary: history remains queryable by date.

## 3. Dated salary history

For a period, the engine reads all contracts overlapping the period and applies the
contract effective on each calendar day. A mid-month amendment therefore produces
two prorated amounts. Example (fictional): 20,000 from 1 to 15 July and 24,000 from
16 to 31 July gives 22,064.5162 for a 31-day month. The calculation stores contract
ids, days, rates and amounts line by line.

## 4. What is not modelled

- statutory employee category or expatriate permit status;
- payroll group / collective agreement;
- bank mandate and payment file;
- document vault for contracts;
- retention and erasure workflow.

These are follow-up items, not silently assumed.
