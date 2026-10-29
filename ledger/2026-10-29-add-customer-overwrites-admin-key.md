# The owner's Add New Customer writes a new key over an admin's Assistant key, so that Assistant loses its identity

**Id:** 2026-10-29-add-customer-overwrites-admin-key
**Type:** bug
**Opened:** 2026-10-29 (memory sweep; found in the code on 2026-09-22)
**Status:** OPEN
**Done:** —

An admin's Assistant key lives in the slot customers' keys use. `POST /api/assistant/provision-key` stores it with
`SecureKeyStorage#storeRelayKeys(<admin pubkey>, …)` (`src/api/assistant/index.js:527`), which is the
`<pubkey>.json` file a customer's relay (Assistant) key goes in.

`POST /api/add-new-customer` (`src/api/customers/commands/add-new-customer.js`) refuses a pubkey only when a
*customer record* already exists (409). An admin has none, so the handler creates the record and calls
`createSingleCustomerRelay` (`src/utils/customerRelayKeys.js:57-67`). That generates a fresh key, and
`storeToEncryptedFile` writes it over the slot with `fs.writeFileSync` (`src/utils/secureKeyStorage.js:296-302`).
The admin's Assistant pubkey changes. Everything the old key signed now names an author no account has, and the old
private key is gone unless a backup holds it.

The two other paths into that slot already guard it: sign-up refuses the owner and admins
(`src/api/auth/signUpNewCustomer.js`), and provision-key refuses a second key (409 "Assistant key already exists for
this user").

**Fix shape:** in `handleAddNewCustomer`, refuse when the slot already holds a key, as provision-key does; that also
covers a pubkey with a key and no customer record. Refusing the owner and admins as sign-up does is the narrower
alternative. Underneath is the one-classification model (row `2026-10-29-one-classification-per-user`).

**Pointer:** `src/api/customers/commands/add-new-customer.js:40-102`; `src/utils/customerRelayKeys.js:57-67`;
`src/api/assistant/index.js` (`handleProvisionAssistantKey`, from `:483`).
