# A signed-in account gets exactly one classification, so an account that is both an admin and a customer is handled as only one of them

**Id:** 2026-10-29-one-classification-per-user
**Type:** feature
**Opened:** 2026-10-29 (memory sweep; first raised 2026-05-25 while testing the Assistant Profile editor on staging)
**Status:** OPEN
**Done:** —

`src/api/auth/getUserClassification.js` checks owner, then admin, then an active customer, and answers the first
match as `classification` (`owner | admin | customer | guest | unauthenticated`). Nothing reports a second role.

- **A customer later added as an admin** reads as `admin` from then on, and the answer drops `customerName` and
  `customerId`. No page in `ui/src` reads those two fields today, but every check of
  `classification === 'customer'` now treats the account as not a customer.
- **An admin who also becomes a customer** keeps reading as `admin`, so the customer record never surfaces in
  `/api/auth/user-classification`. Sign-up refuses admins, but the owner's Add New Customer does not, and that path
  also replaces the admin's Assistant key (row `2026-10-29-add-customer-overwrites-admin-key`).
- **The owner in the admin list** is fine: the owner is checked first.
- **The assistant roster already meets it** and settles it locally: an account in more than one role is listed once,
  under the most privileged (owner > admin > customer). ADR `author-scoped-inspection/0001` (Implementation notes,
  `listInstanceAssistants`) calls the multi-role gap "a known limitation".

**Fix shape:** answer `roles: string[]` alongside `classification`, and keep single-role callers on an adapter.
Until then, work that branches on `classification` (auth, settings, role-gated UI) should ask whether a multi-role
account can reach it.

**Pointer:** `src/api/auth/getUserClassification.js`;
`engineering-team/decisions/done/author-scoped-inspection/0001-instance-assistant-roster-and-delegate-resolver.md`
§ Implementation notes.
