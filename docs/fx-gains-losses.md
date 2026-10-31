# Exchange differences: realized and latent

## Realized differences

A realized difference appears when a foreign-currency invoice is settled at an
exchange rate different from the rate used when it was posted.

For a settlement of `S` currency units and rates `r_settle` and `r_invoice`:

```
invoice carrying value      = S × r_invoice
settlement carrying value   = S × r_settle
difference                  = S × (r_settle − r_invoice)
```

The calculation uses the **settled amount only**, so a partial payment produces
a partial difference. The commercial balance (in the invoice currency) and the
accounting balance (in the functional currency) are reported separately.

Direction by side:

| Side | Settlement rate higher | Settlement rate lower |
| --- | --- | --- |
| Customer receivable | gain | loss |
| Supplier payable | loss | gain |

### Human validation

1. `POST /fx/realized/scan` creates `proposed` rows. It never posts.
2. The UI shows the invoice rate, settlement rate, settled amount, both carrying
   values, the difference and its direction.
3. Posting requires `confirm: true` and **both** FX accounts configured in
   `fx_settings`:
   * `fx_gain_account_id` must be an active revenue account;
   * `fx_loss_account_id` must be an active expense account.
4. Without configuration the API returns `FX_ACCOUNTS_NOT_CONFIGURED` and blocks.
   No account is invented, not even the seeded `6300` provisional account.
5. One adjustment per invoice/payment pair and one accounting entry per
   adjustment; retries return `reused: true`. The period must be open.

The seeded chart contains `6300 — Écarts de change (provisoire)` but **no gain
account**. The dossier must therefore choose its accounts explicitly before any
posting; this is deliberate.

## Latent differences (revaluation)

`POST /fx/valuations` simulates the revaluation of open foreign-currency
receivables and payables at a valuation date, using only validated rates for that
date.

* Re-simulating the same date returns the existing valuation (`reused: true`);
  no double evaluation.
* A line without a validated rate is stored with a `blocked_reason`; it is never
  silently skipped or valued at 1.
* Validation of a simulation with blocked lines returns `409
  FX_VALUATION_RATE_MISSING`.
* `valuation_posting` is constrained to `false` in the database, and
  `POST /fx/valuations/:id/post` returns `409 FX_VALUATION_POSTING_BLOCKED`.
  Only the simulation and its validation are available.

The reprise (reversal of a previous revaluation) is not implemented as an
accounting entry: it remains a configurable question for the expert accountant
(see `fx-validation-register.md`). No Mauritian revaluation rule is stated as
official.

## Internal transfers

A transfer between two bank accounts of the same company must create neither
income nor expense. The preview:

* requires two distinct accounts;
* records the explicit rate and its date;
* computes `to_amount` with exact arithmetic;
* keeps `fee_amount` in a separate field, in the source currency;
* returns `postingBlocked: true`; posting returns `409
  FX_TRANSFER_POSTING_BLOCKED`.

An exchange difference is never reclassified as a bank fee, and vice versa.
