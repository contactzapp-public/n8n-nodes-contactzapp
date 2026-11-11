# n8n-nodes-contactzapp

[ContactZapp](https://contactz.app) keeps your contacts in step across Google, Microsoft, Apple and CardDAV.
This package adds two nodes to n8n:

- **ContactZapp** finds, adds and updates contacts, and starts a sync.
- **ContactZapp Trigger** starts a workflow when a contact is created, changed or merged, when ContactZapp finds a possible duplicate, or when an account needs attention.

Both use ContactZapp's public API: <https://app.contactz.app/api/v1/openapi.json>.

## Install

In n8n, open **Settings › Community nodes**, choose **Install** and enter `n8n-nodes-contactzapp`.
For other ways to install, see n8n's [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/).

## Authentication

The nodes sign in with a ContactZapp API key. There is no OAuth2 sign-in.

1. In ContactZapp, open **Settings › Advanced** and create an API key. Every plan can.
2. Give it the permissions the workflow needs (below).
3. In n8n, create a **ContactZapp API** credential and paste the key. n8n tests it with `GET /api/v1/me`.
   A key that is not valid shows "The API key is not valid. It may have been revoked. Create a new one in ContactZapp."

| What the workflow does | Permission the key needs |
|---|---|
| Get, Get Many, Account Get | `contacts:read` |
| Create, Update | `contacts:write` |
| Sync Start | `sync:trigger` |
| ContactZapp Trigger | `contacts:read` and `webhooks:manage` |

A key without the permission an operation needs gets "This API key or connected app does not have the permission this request needs" (code `insufficient_scope`).

You can make 60 requests a minute, across all your keys and connected apps. Over that, the node stops with the API's own message, which says how long to wait.

**Why no OAuth2?** ContactZapp's sign-in server does not register apps on the fly, and every n8n instance has its own callback address. An API key works everywhere today. OAuth2 may follow once there is a way to register an n8n callback.

## ContactZapp node

| Resource | Operation | What it does |
|---|---|---|
| Contact | Create | Adds a contact. If you already have this person, ContactZapp may add the values to that contact instead. The result says which (`created`, `merged` or `needs_review`). |
| Contact | Get | Gets one contact by its ID or by the short ID ContactZapp shows, such as `CS-0042`. |
| Contact | Get Many | Lists contacts, or finds them by email address, phone number or search text. Use one filter at a time. Return All follows the pages until the last. |
| Contact | Update | Changes only the fields you add. A list you add (emails, phone numbers, addresses, websites) replaces the whole list. An empty text clears the field. |
| Sync | Start | Starts a sync now. The answer is `queued`, or `running` when a sync is already going. |
| Account | Get | Gets the account the key belongs to: its email, plan and permissions. |

**There is no Delete.** The ContactZapp API cannot delete a contact, so the node does not offer it.

Notes:

- **Simplify** (Get and Get Many, on by default) returns the ID, name, company, job title, first email address and first phone number. Turn it off for every field.
- A **phone number** filter needs the country code: `+12025550108`.
- A **birthday** is `YYYY-MM-DD`, or `--MM-DD` when the year is not known.
- **Idempotency Key** (Create and Update, under Options) makes a retry safe: run it again with the same key within 24 hours and nothing is written twice.
- Errors show the API's own message and its code (for example `unknown_field`, `contact_pending_review`). Turn on **Continue On Fail** to send the message down the workflow instead.

## ContactZapp Trigger

Choose **Trigger On**: Contact Created, Contact Updated, Contacts Merged, Match Needs Review or Account Needs Attention.

- When you activate the workflow, the node subscribes its webhook address to that event (`POST /api/v1/webhooks`). When you deactivate it, the node removes the subscription (`DELETE /api/v1/webhooks/{id}`). You can have up to 25 subscriptions.
- **The address must be public HTTPS.** ContactZapp refuses addresses on a private network. An n8n that runs only on your computer or your office network needs a public address first: set `WEBHOOK_URL` to it, or use a tunnel.
- Each delivery carries a signature. The node checks `ContactZapp-Signature` (the HMAC-SHA256 of the timestamp, a full stop and the raw body, with the subscription's secret) with a constant-time compare, and refuses a timestamp more than 5 minutes from the clock. A delivery that fails the check gets a `401` and starts nothing.
- The workflow gets one item per event, the same item the API's event list returns. An event can arrive more than once. The item's `id` never changes, so add n8n's **Remove Duplicates** node to skip an `id` you have seen.
- The node never writes a delivery's body or the signing secret to n8n's log.

## Example workflows

Import them with **Import from file** in the workflow menu, then pick your credential.

- [`examples/add-and-find-a-contact.json`](examples/add-and-find-a-contact.json): adds a person, then finds them again by email.
- [`examples/start-on-a-new-contact.json`](examples/start-on-a-new-contact.json): starts when a contact is created and skips events it has already seen.

## What was run

Run on 2026-11-11 against ContactZapp's test deployment (devapp, API 2.1.1), in n8n 2.47.4 in Docker, with the packed package (`npm pack`) mounted as a custom node.

- Contact Create (with an Idempotency Key), Get (by ID and by `CS-` ID, Simplify on and off), Update, Get Many (email filter, phone filter, limit, and Return All across 592 contacts), Sync Start and Account Get all returned what the API returned.
- A repeat of Create with the same Idempotency Key returned the first result and wrote nothing twice.
- Credential test: a valid key passes. A key that is not valid fails with the message above. A read-only key passes the test.
- Errors: a bad key (401 `api_key_invalid`), a key without the permission (403 `insufficient_scope`), an unknown contact (404 `not_found`), two filters at once and a birthday that is not a date (both stop before any request), and the 429 `rate_limited` answer all showed the API's own message, its code and the item index. With Continue On Fail the message went to the output and the next item still ran.
- Trigger: activating a workflow for each of the five events created five subscriptions on the test deployment. Deactivating them removed all five. Restarting n8n with the workflows active created no second subscription. A key without `webhooks:manage` or with a bad key could not activate.
- Trigger deliveries were signed with the subscription's own secret and sent to n8n's webhook address, using a real item from the API's event list for each of the five events. All five started the workflow with that item. A wrong signature, a wrong secret, a changed body, a missing header, a malformed header and a timestamp more than 5 minutes old or ahead were refused with `401`, and started nothing. A timestamp 290 seconds old was accepted. A repeated event `id` was skipped by Remove Duplicates.
- Not run: the test deployment cannot reach an n8n on a private network, because it refuses private addresses, so its own deliveries could not be sent to this n8n. The signed deliveries above were sent by hand instead.
- n8n's log held no API key, no signing secret and no contact data. n8n's own execution history does store what a workflow received, as it does for any node.

## Develop

    npm install
    npm run build      # compile
    npm run lint       # n8n's linter, the same one the verification scan uses
    npm test           # build, then unit tests: request building, errors, the trigger, the signature check

`nodes/ContactZapp/contract.ts` is the one place that names the API's operations, paths and fields. `npm run contract` writes `contract-uses.json` from it. ContactZapp checks that file against the API's published spec, so a change in the API shows up before it breaks a workflow.

Releases are made by the `Publish` workflow when a version tag is pushed (`npm run release`), with an npm provenance statement.

## Licence

[MIT](LICENSE.md)
