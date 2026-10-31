# Exchange-rate policy

## Three origins, one rule

| `source_kind` | Meaning | Can be used? |
| --- | --- | --- |
| `manual` | Entered and validated by a human | Only when `status = 'validated'` |
| `imported` | Imported from a file or statement, pending confirmation | Only after human validation; a reference is mandatory |
| `demo` | Fictional rate for the browser demonstration | Only inside the demo; never presented as official |

No provider, API, scraper or central-bank feed is connected. **The application
never invents a rate** and never fills a missing rate with `1`.

## Resolution rules

`resolveFxRate(company, from, to, date)`:

1. returns `1.00000000` only when `from === to`;
2. looks for **one validated rate for the exact pair and exact date**;
3. accepts a reverse pair only by explicit inversion recorded by the service
   (exact reciprocal, no market convention is assumed);
4. if a rate exists for the pair and date but is not validated, returns
   `FX_RATE_NOT_VALIDATED`;
5. if a direction mismatch exists, returns `FX_RATE_DIRECTION_MISMATCH`;
6. otherwise returns `FX_RATE_MISSING`.

There is **no fallback to the latest available rate**. A conversion at another
date requires an explicit rate for that date. A missing rate blocks the operation
and lets the user enter and validate a sourced rate.

## Creation and validation

* A rate is always created as a **draft**.
* `rate` must be a strictly positive decimal with at most eight decimals
  (`FX_RATE_INVALID` otherwise). Zero, negative, absent and malformed values are
  rejected before storage.
* `imported` rates require a `reference` (`FX_RATE_REFERENCE_REQUIRED`).
* Validation requires `confirm: true`. Replacing an already validated rate for
  the same pair and date requires `supersede: true`; the previous row becomes
  `superseded` and a new version is recorded.
* A validated rate is immutable at database level (`mc_guard_fx_rate_immutable`);
  every change creates a new version and an event in `fx_rate_events`.
* Rejection requires a reason and keeps the rate unusable.

## Date and precision

* The rate date is a calendar date (`YYYY-MM-DD`), not a timestamp.
* The rate is stored as `numeric(20,8)` and handled as an integer scaled by 10^8
  in the application. JavaScript floating-point numbers are never used for
  amounts or rates.
* Functional conversion: `amount(scale 4) × rate(scale 8)`, rounded half away
  from zero to four decimals, **once** at posting time.

## Presentation wording

Every screen and report states that rates are entered and validated by the
company and are **not official**. No Mauritian regulatory rate, central-bank
publication or statutory valuation rule is asserted.
