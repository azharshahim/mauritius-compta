# Multi-currency user guide

## Before you start

1. Open **Accounting → Multi-currency → Configuration**.
2. Check the functional currency. It becomes **locked** as soon as an entry is
   posted; the post-posting change procedure is not implemented.
3. Select the currencies you allow (MUR, EUR, USD, GBP by default).
4. Choose an FX **gain** revenue account and an FX **loss** expense account.
   Without both, realized differences can be computed but not posted.
5. Leave revaluation *simulation* enabled unless you do not want the report.

## Enter a rate

1. Go to **Rates & conversion**.
2. Enter the base currency, quote currency, exact date, rate, origin and source.
3. Imported rates require a reference.
4. The rate is saved as a **draft**. It is not usable yet.
5. Click **Validate**, read the pair/date/source, tick the confirmation and
   validate. The screen states that the rate is not official.

If no validated rate exists for the exact date, any conversion or posting is
blocked. Enter a sourced rate for that date; do not use a nearby date.

## Post a realized difference

1. Go to **Realized differences** and click **Find realized differences**.
2. Open the proposed line: the calculation, both carrying values and direction
   are shown.
3. Tick the confirmation and post. Posting is refused if the FX accounts are not
   configured or the period is closed.

Partial payments only generate a difference on the settled amount.

## Simulate a closing valuation

1. Go to **Latent valuations**, choose a date and click **Simulate**.
2. Lines without a validated rate are shown as blocked.
3. A simulation with blocked lines cannot be validated.
4. Posting is deliberately blocked: only simulation and validation are available.

## Transfer between currencies

1. Go to **Transfers**, choose two distinct bank accounts, the amount, date and
   any bank fee.
2. The preview shows the explicit rate, converted amount and fee separately.
3. Posting is blocked until an accounting policy is validated. An internal
   transfer creates neither income nor expense.

## Reports

The **Reports** tab separates every currency and never adds currencies together.
Download the CSV to keep the same separation. Blocked operations are listed so
that missing rates can be corrected.
