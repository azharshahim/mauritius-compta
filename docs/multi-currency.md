# Multi-currency architecture (mission 13)

Status: **implemented on the development branch, not merged**. No exchange-rate
provider is connected, no official rate is embedded, and no Mauritian tax rule is
asserted.

## Design principle

The general ledger is not rewritten. Currency information already existed on
`companies`, `accounts`, `journal_entries`, `journal_lines`, `billing_documents`,
`billing_payments`, `purchase_documents`, `purchase_payments`, `bank_accounts` and
`exchange_rates`. Mission 13 adds a controlled layer around it:

| Layer | Table | Purpose |
| --- | --- | --- |
| Company settings | `fx_settings` | Functional lock, validated-only policy, FX gain/loss accounts, valuation simulation switch |
| Allowed currencies | `company_currencies` | MUR, EUR, USD, GBP by default, extensible ISO 4217 |
| Rate register | `fx_rates`, `fx_rate_events` | Dated, sourced, versioned rates with human validation and audit trail |
| Realized differences | `fx_realized_adjustments` | One proposed adjustment per invoice/payment pair, explicit calculation |
| Latent differences | `fx_revaluations`, `fx_revaluation_lines` | Simulations only; posting is blocked by database constraint |
| Internal transfers | `fx_transfers` | Preview only; fails or fee amount kept distinct from the FX difference |

Additive migration: `apps/api/sql/migrations/0013_multi_currency.sql`. The
`journal_entries_source_check` constraint is extended with `'fx'`.

## Stored versus computed values

* Document and payment amounts remain stored in their **original currency** at
  four decimals, with the agreed `exchange_rate` at eight decimals.
* Journal lines keep `txn_currency`, `txn_amount`, `fx_rate` and the functional
  `debit`/`credit`.
* Functional values are computed with exact integer arithmetic (`BigInt`,
  scale 10^4) and rounded half away from zero **once**.
* Presentation rounding (two decimals) never feeds back into storage.

A posted document is never updated when a later rate changes. A new rate is
stored as a new version and only becomes usable after explicit validation.

## API surface

All routes are scoped to `/api/companies/:companyId/fx`:

* `GET/PATCH /config`
* `GET/POST /rates`
* `POST /rates/:id/validate`, `POST /rates/:id/reject`
* `GET /resolve` (exact pair and date only)
* `GET /realized`, `POST /realized/scan`, `POST /realized/:id/post`, `POST /realized/:id/reject`
* `GET/POST /valuations`, `GET /valuations/:id`, `POST /valuations/:id/validate`, `POST /valuations/:id/post` (blocked)
* `GET/POST /transfers`, `POST /transfers/:id/post` (blocked)
* `GET /report`, `GET /report.csv`

Permissions: `viewer` can read; `accountant` can create and validate rates and
post realized differences once accounts are configured; only a dossier
administrator can change allowed currencies, lock the functional currency or
validate a revaluation simulation.

## Reports

The report separates every currency. It **never adds amounts across currencies**:

* receivables and payables per currency, with the functional carrying value;
* bank balances per account and currency;
* realized gains/losses per currency, direction and status;
* the latest latent valuation, including blocked lines;
* operations blocked because no validated rate exists for their date.

CSV uses `;`, a UTF-8 BOM and formula-injection escaping. It contains an explicit
line « Aucun total inter-devises ».

## Demo

`apps/web/src/demo/fx.ts` reproduces the flow in the browser (localStorage schema
11). All seeded rates are fictional, marked `demo`, and labelled « non officiel ».
Nothing is sent to a server. The scenarios A→J are described in
`docs/mission-13-report.md`.

## Not implemented

* Changing the functional currency after posting (the database trigger
  `mc_guard_functional_currency` returns `FUNCTIONAL_CURRENCY_LOCKED`; a future
  migration and accounting procedure are required).
* Automatic revaluation posting and automatic cross-currency transfer posting.
* Any market-data or central-bank feed.
* Multi-currency consolidation between companies.
