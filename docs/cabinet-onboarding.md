# Cabinet onboarding — Accountant Workspace (Mission 44)

Technical reference for the client-file onboarding introduced by Mission 44.
It documents what exists, what is deliberately absent, and how to roll it back.
Business copy lives in `apps/api/src/i18n/index.ts` and
`apps/web/src/i18n-m44.ts`; nothing here is regulatory advice.

## 1. Scope of the module

`apps/api/src/modules/cabinet-onboarding/` owns the *client file journey* of an
accounting firm:

| File | Responsibility |
| --- | --- |
| `catalogue.ts` | Pure data: 9 business sectors, the 12-item KYC template, the 8 functional domains with an honest `availability` (`available` / `partial` / `prepared`), legal forms, accounting setup normalisation. |
| `progress.ts` | Pure, deterministic progression engine (no I/O, no clock, no randomness). |
| `routes.ts` | HTTP layer: portfolio, client-file detail, onboarding/KYC updates, drafts, activation, options. |

What it does **not** do: it never posts an entry, never computes tax, never
creates a chart of accounts or opening balances. Those services already exist
and are reused through `apps/api/src/lib/client-file.ts` (which creates the
`companies` row plus the accounting scaffolding in one transaction).

## 2. Data model (migration `0027_cabinet_onboarding.sql`)

Additive only; no existing table is rewritten and no existing row is updated.

* `companies` gains 8 **nullable** descriptive columns: `trade_name`,
  `contact_name`, `contact_email`, `contact_phone`, `legal_form`,
  `incorporation_date`, `business_description`, `country`.
* `client_onboarding` — one row per client: `sector`, `sector_notes`,
  `modules` (jsonb), `setup` (jsonb), `status`, `kyc_review_status`,
  `current_step`, `assigned_accountant_id`, `notes`,
  `activated_at`/`activated_by`.
* `client_kyc_checks` — one row per (client, checklist item): `status`,
  `document_ref` (a **reference string only**, never a file), `note`,
  `checked_at`/`checked_by`.
* `cabinet_client_drafts` — a draft belongs to the user who typed it, not to a
  company, so an incomplete file never pollutes the portfolio.

`companies` remains the single client repository: there is no second client
master file and no second accounting engine.

### Down migration

```sql
ALTER TABLE companies
  DROP COLUMN IF EXISTS trade_name,
  DROP COLUMN IF EXISTS contact_name,
  DROP COLUMN IF EXISTS contact_email,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS legal_form,
  DROP COLUMN IF EXISTS incorporation_date,
  DROP COLUMN IF EXISTS business_description,
  DROP COLUMN IF EXISTS country;
DROP TABLE IF EXISTS client_kyc_checks;
DROP TABLE IF EXISTS client_onboarding;
DROP TABLE IF EXISTS cabinet_client_drafts;
```

The `IF EXISTS` forms make the rollback idempotent. Removing the columns also
removes the Mission 44 descriptive data — export it first if it matters.

## 3. Progress engine (`progress.ts`)

Six fixed steps, equal weight:

`company_information → kyc → sector → accounting_setup → modules → activation`

`percent = round(completed / 6 × 100)` — never weighted by hand, never derived
from a document count, so the same file always shows the same number.

Step statuses: `not_started`, `in_progress`, `pending_review`, `completed`,
`blocked`.

Invariants enforced by tests (`tests/mission44-progress.test.ts`, 12 cases):

1. A KYC item explicitly rejected (`needs_correction`) puts the KYC step and
   every later step in `blocked`; nothing downstream is counted as complete.
2. `pending_review` is **not** completion: the step is waiting for a human.
3. `not_applicable` items never block and never count as missing documents.
4. Steps above the first incomplete step are never reported as completed.
5. `legalValidation` is always `false`; the engine states the file is *ready for
   review*, never *validated by an authority*.

## 4. HTTP surface

All routes require a session and are mounted under `/api`.

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/cabinet/workspace` | cabinet read — portfolio, indicators, drafts, upcoming tax tasks, activity |
| `GET` | `/cabinet/workspace/options` | catalogue for the wizard |
| `GET` | `/cabinet/workspace/clients/:companyId` | cabinet read — detail, KYC checklist, checks, availability, tasks |
| `PATCH` | `/cabinet/workspace/clients/:companyId/onboarding` | cabinet **write** — sector, modules, setup, review status |
| `PATCH` | `/cabinet/workspace/clients/:companyId/onboarding/kyc/:key` | cabinet **write** — one checklist item |
| `GET` | `/cabinet/workspace/drafts` | own drafts only |
| `POST` | `/cabinet/workspace/drafts` | create/update a draft |
| `PATCH` | `/cabinet/workspace/drafts/:draftId` | own draft |
| `DELETE` | `/cabinet/workspace/drafts/:draftId` | own draft |
| `POST` | `/cabinet/workspace/drafts/:draftId/activate` | cabinet **write**, admin-level for activation |

Activation is refused with `409 ONBOARDING_INCOMPLETE` unless a sector is set,
at least one module is selected and the accounting setup is complete. It writes
`cabinet.onboarding.activate` to `audit_log` in the same transaction that
creates the company file. KYC updates write `cabinet.kyc.update`.

## 5. Permissions

Access is decided by the existing module ACL (`requireModuleAccess(..., 'cabinet', level)`),
not by a new role system:

* `read` — see the portfolio, the client file, the checklist.
* `write` — edit onboarding, tick KYC items, save drafts, activate.
* The `cabinet_access` field returned on each row lets the UI hide edit actions
  instead of discovering the refusal after a click.

Multi-company isolation is enforced by filtering every query on the companies
the user is a member of; the tests create two firms and assert that a client of
one never appears for the other (`tests/mission44-onboarding.test.ts`).

## 6. Demonstration backend

`apps/web/src/demo/cabinet-workspace.ts` mirrors the API in the browser for the
GitHub Pages demo (`schema: 18`). It contains three fictional clients, one
fictional draft and one client per onboarding status. It performs no network
call, stores nothing outside `localStorage`, and is excluded from the real
bundle (verified by `scripts/verify-demo.mjs --real-dist`).

## 7. Deliberate limitations

* No document upload: `document_ref` is a free-text reference and the UI states
  that secure deposit remains to be built.
* No MRA e-invoicing transmission; the domain reserves a slot only.
* All eight domains exist at least partially, so the wizard shows `Available`
  or `Partial`; `Prepared — not available` is reserved for future sub-features.
* The word “instances” (domain 2) is kept as the firm phrased it, with an
  explicit note that it still needs clarification.
