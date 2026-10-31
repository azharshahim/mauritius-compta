# FX validation register — questions for the expert accountant

This register lists every accounting or regulatory point that the application
**does not decide by itself**. Items stay open until a qualified professional
validates them for the dossier. The software never fills these answers with an
invented rule.

Language note: this file is mainly in English, with French UI wording quoted
where relevant.

| # | Question | Current behaviour | Status |
| --- | --- | --- | --- |
| 1 | Which revenue account receives FX gains? | Must be selected in `fx_settings`; no default | À VÉRIFIER / OPEN |
| 2 | Which expense account receives FX losses? | Must be selected; seeded `6300` is only a provisional account and is never applied automatically | À VÉRIFIER / OPEN |
| 3 | Is the gain/loss presented in finance costs or operating result? | Not asserted; depends on the chosen accounts and chart mapping | À VÉRIFIER |
| 4 | Which rate date is required for a transaction: invoice date, due date, payment date? | Document rate is stored at invoice date; settlement rate at payment date; no policy imposed | À VÉRIFIER |
| 5 | Is the use of a reverse pair (MUR/EUR derived from EUR/MUR) acceptable? | Only an explicit exact reciprocal, recorded as such; no market convention assumed | À VÉRIFIER |
| 6 | Is a rounding difference of one cent on conversion posted separately? | Functional rounding is performed once, half away from zero; no residual account is invented | À VÉRIFIER |
| 7 | Must latent revaluation be recognized at closing? | Simulation only; posting is blocked by design | NON IMPLÉMENTÉ / À VÉRIFIER |
| 8 | How should a prior revaluation be reversed (reprise)? | Not implemented as an entry; must be configured explicitly | NON IMPLÉMENTÉ |
| 9 | Should unrealized gains and losses be presented gross or net by currency? | Report shows both directions per currency, never netted across currencies | À VÉRIFIER |
| 10 | How should cross-currency internal transfers and bank fees be recorded? | Preview only; fee kept distinct from any exchange difference; posting blocked | NON IMPLÉMENTÉ |
| 11 | Which document proves an imported rate? | `reference` is mandatory; document retention policy is not asserted | À VÉRIFIER |
| 12 | Who may validate a rate in a two-person firm? | Role-based: accountant may validate; dossier admin for configuration and valuation validation | À VÉRIFIER (segregation of duties) |
| 13 | Is a change of functional currency permitted after posting? | Forbidden by trigger; migration procedure not implemented | NON IMPLÉMENTÉ |
| 14 | Which currencies are authorised for the dossier? | MUR, EUR, USD, GBP by default; dossier administrator may extend within ISO 4217 support | À VÉRIFIER |
| 15 | Does the MRA require a specific FX disclosure or e-invoicing field? | Not asserted; MRA e-invoicing remains disabled | À VÉRIFIER / NON IMPLÉMENTÉ |
| 16 | Are IFRS or Mauritian GAAP revaluation rules applicable to this entity? | The application stores `accounting_standard` but applies no rule automatically | À VÉRIFIER |

## How to close an item

1. Record the decision, its source and its date in the dossier's accounting
   policy file.
2. If the decision implies a code change (for example enabling revaluation
   posting), open a new migration and test; do not change a validated rate or a
   posted entry.
3. Never treat this register as evidence of regulatory compliance.

No Mauritian tax, PAYE, CSG, NSF or MRA rule is implemented or claimed by
mission 13.
