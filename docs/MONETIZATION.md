# How Flapper is monetized

Flapper is [Salable](https://salable.app)'s worked example: a real product,
built without a commercial model, having one fitted in public. This file is
the account of it — what costs money, how the code asks, and every decision
with its reason, including the ones that turned out to be wrong.

Its companion is the RFC, `rfcs/2026-08-25-flapper-monetization-example.md`
in `Salable/company`. Where this file and the RFC disagree, this file is what
the code does and says so.

---

## What's free, and what isn't

| | Free | Bespoke |
| --- | --- | --- |
| Boards | **one** | more, or unlimited |
| Board types | live queue | scheduled, shared screens |
| Private boards | no | yes |

Everything else is free and always will be, because it is what we most want
people to see: the design editor, every theme and per-character mark, the MCP
server, the REST API, the kiosk shell, the agent guide on every board.

**Free is a licence, not the absence of one.** Signing up creates a
[Salable Only Subscription](https://salable.app/docs/subscriptions-and-billing)
— no Stripe, no card, perpetual — on the free plan. Every account is a
Grantee from its first second, so going paid is a change of plan and nothing
else: no migration, no new code path, no "now you're a real customer" step.

**Paid is bought by asking.** There is no pricing page and no self-serve
plan. Hit a limit and Flapper says what you hit and that it needs a plan we
don't sell off the shelf; we clone the free plan into a
[Bespoke plan](https://salable.app/docs/bespoke-plans) and send a checkout
link. Every paying customer is one we chose to have.

## How the code asks

Three files, and nothing outside them knows there is a bill.

| | |
| --- | --- |
| `lib/salable/client.mjs` | the only module that knows Salable's HTTP surface. Two calls: check entitlements, create the free licence. Its `fetchImpl` is injected, so `tests/salable.test.mjs` asserts the request Salable actually receives. |
| `lib/salable/licence.mjs` | the vocabulary, and an *allowance* — `{licensed, maxBoards, types, privateBoards}` — derived from entitlement values by a pure function. |
| `lib/api/handlers.mjs` | the three enforcement points. |

The enforcement points are `createBoard` (licence at all, board count, board
type) and `boardPatch` (private). Both are shared by REST and the MCP tools,
so an agent and a curl and the dashboard button all meet the same gate.
**A greyed-out card in the UI is decoration.** The catalogue pages compute a
`locked` flag for the chip and that is all it is.

### The vocabulary

Entitlement *values*, configured on plans in the Salable dashboard:

| Value | Means |
| --- | --- |
| `board_create` | may create a board at all. This is the licence. |
| `boards_many`, `boards_unlimited` | a working number of boards, or no cap |
| `board_type_scheduled`, `board_type_shared` | a board type that isn't free |
| `board_private` | may make a board private |

**Entitlement names must match `^[a-z_]+$`** — lowercase letters and
underscores, no dots, no digits (`createEntitlement` in
[openapi.yaml](https://salable.app/openapi.yaml)). Every name above is held
to that in `tests/salable.test.mjs`, because the alternative is finding out
when somebody cannot create the plan.

That rule costs something worth naming. This started as `boards:1` /
`boards:25` / `boards:unlimited`, so the *number* lived on the plan and
changing it was a dashboard edit. No digits means that is impossible: an
entitlement is a boolean, and the check response has nothing to hang a
quantity on. So the cap is a named tier, and `BOARD_TIERS` in
`lib/salable/licence.mjs` is **Flapper** deciding that "many" is 25.

Salable still decides *which* tier an account is on — the part that has to be
commercial rather than a deploy. But "how many is many" is now a constant in
the application, and that is a step back from *Salable holds the answer*.
It is a gap in Salable worth filing (RFC chunk 13), not a design we chose.
Several plans granting a cap resolve to the most generous, which is how
Salable itself resolves a repeated entitlement's expiry.

A board type declares the value it needs, and that is Flapper's entire half
of the conversation:

```js
// lib/board-types/scheduled/definition.mjs
entitlement: 'board_type_scheduled',
```

Leave it unset and the type is free. A fork adding a type gets to decide.

### The other end of a 402

There is no checkout, so a limit ends in a conversation, and the code has to
carry that as far as it can.

Every refusal answers a machine as well as a person. Beside the sentence, a
402 carries `need` — the entitlement value — and `getInTouch`, the URL to go
about it:

```json
{
  "error": "this licence covers 1 board and 1 is in use. Delete one, or get in touch and we will cut you a plan.",
  "need": "boards",
  "getInTouch": "https://flapper-tan.vercel.app/account/licence?need=boards"
}
```

That matters most where there is no UI at all: an agent on the MCP path, or a
`curl`, gets the same two fields and can say something useful about them.

**Refusals are checked most-specific-first** — licence, then board type, then
board count. Somebody at their one-board limit asking for a scheduled board
is told about the type, because "delete one first" would send them to delete
a board and hit a second no.

In the app, a 402 opens the ask in place, under the create button, with the
need already chosen. `/account/licence` is the same form on its own page,
with what the licence covers above it and what you have already asked below.
Three questions, which is all a bespoke plan needs: what you hit, what you
need it for, where to reply.

`need` is a closed list (`REQUESTABLE` in `lib/salable/licence.mjs`), so an
ask arrives already sorted into the entitlement a plan would grant rather
than as prose someone has to read and classify. Asking twice for the same
thing is the same ask — told plainly, because a silent dedupe reads as the
form having done nothing.

**Answering them.** A row in Postgres nobody reads does not meet "within a
day or two", so an ask also goes wherever the people answering it already
are: `LICENCE_REQUEST_WEBHOOK_URL`, a Slack incoming webhook in our case.
Unset, it is a no-op. Either way the queue is read with:

```bash
DATABASE_URL=… node tools/licence-requests.mjs              # oldest first, overdue marked
DATABASE_URL=… node tools/licence-requests.mjs --handled ID # replied to, not merely read
```

Committed before announced, and the notification is best-effort: a webhook
that is down must never lose somebody's ask.

## Three states, and the difference matters

**Unlicensed** — no `SALABLE_API_KEY`. Every type, no cap, private boards on.
Not a broken configuration: it is how a fork of this repo runs, and it has to
be a whole product or the example is a brochure. The only limit left is
`MAX_BOARDS_UNLICENSED = 25`, an abuse ceiling for a build with nothing else
to stop a runaway script.

**Licensed** — Salable answered, or answered recently enough to reuse. A
per-process cache, sixty seconds, which on Vercel means per warm function
instance: enough that a dashboard render doesn't fan out into a dozen
identical checks, short enough that a plan change lands promptly.

**Degraded** — configured, but Salable didn't answer and nothing is cached.
Falls back to the **free** allowance. Never blocks a create; never hands out
what nobody paid for. The repo rule is *degrade, never break*; the money rule
is that an outage must not be a discount. If there *is* a cached answer, even
a stale one, that wins over free — four minutes ago is a truer picture of what
this account bought than the free plan is.

## Setting it up

1. In the Salable dashboard, create a Product and a **free plan** with no
   Stripe price. Give it the entitlement `board_create` — that alone is the
   free licence, and one board.
2. Set the env vars (see the table in [README](../README.md#deploy-it)):
   `SALABLE_API_KEY`, `SALABLE_FREE_PLAN_ID`.
3. Backfill the accounts that predate the licence, **before** the gate goes
   live:

   ```bash
   SALABLE_API_KEY=… SALABLE_FREE_PLAN_ID=… DATABASE_URL=… \
     node tools/backfill-licences.mjs --dry-run
   ```

   Idempotent: an account already holding `board_create` is skipped, so
   re-running never issues a second subscription. Existing accounts keep
   every board they have — an account over the free allowance is frozen where
   it is, still able to drive, rename and delete, just not to add another.
   Nothing is deleted and nothing is deactivated.
4. A bespoke sale is a clone of the free plan with a more generous cap and
   whichever type entitlements were asked for. No deploy.

`tools/salable-setup.mjs` does steps 1-3 for you. Put a **test-mode** key in
`.env.local` (gitignored), dry-run it, then run it:

```bash
echo 'SALABLE_API_KEY=<your test-mode SECRET key>' >> .env.local
node tools/salable-setup.mjs --dry-run
node tools/salable-setup.mjs
```

It creates all six entitlements, the Product, and the free plan granting
`board_create` alone, then prints the `SALABLE_FREE_PLAN_ID` to set. Listing
before creating, so re-running is safe. The paid entitlements are created but
put on no plan: a bespoke sale is a clone of the free plan with a cap and
whichever board types were asked for, which is a person's decision.

It finishes by **issuing a throwaway licence against the plan and reading the
entitlement back**, because "the plan saved" does not prove a licence can be
issued on it — see the handover log below for how that was learnt. If the
probe fails, the script says so and exits non-zero rather than handing you
env vars that will break at somebody's first sign-up.

To walk all of it locally with no Salable account, `tools/mock-salable.mjs`
serves the two endpoints and takes a `/grant` knob for opening the paid side:

```bash
node tools/mock-salable.mjs &
SALABLE_API_KEY=sk_test_mock SALABLE_FREE_PLAN_ID=plan_free \
  SALABLE_API_BASE=http://localhost:4000/api npm run dev
# then, to become a paying customer:
curl -X POST -H 'authorization: Bearer x' \
  'http://localhost:4000/grant?values=board_create,boards_unlimited,board_type_scheduled,board_private'
```

## Decisions, and what they cost

**One free board, not a few.** Neal's call, 2026-09-02: *"you give everyone
one board, and if they come and ask us for it we cut them a cheap license"* —
narrower than the RFC's "a few". One board is a real product for the person
who wants a sign on one wall, and the second board is exactly the moment
someone is getting value worth a conversation. The number lives on the plan,
so changing our minds is a dashboard edit.

**The tier ladder is gone, not wired up.** Flapper had a `TIER_LADDER`
(`standard < plus < pro`) and an `entitled()` in
`lib/board-types/contract.mjs`, with a `user.tier` column behind it. RFC 0003
Q4 had recommended keeping the check in Flapper and syncing the answer from
Salable. That is two sources of truth for one question, and it is precisely
the pattern this example exists to replace — so it went. The `user.tier`
column is read by nothing and is due to be dropped; it stays in the schema
only so a rollback has somewhere to land.

It also gated nothing. No board type ever named a tier, so the ladder had
never once refused anybody. Worth saying plainly: the paywall that was
"in place" was decoration too.

**Going private is entitled; coming back public never is.** An account whose
licence lapses can still undo what it did with it. Anything else means the
product holds your board hostage over a billing state.

**Sign-up must not fail because Salable is down.** The licence call is
best-effort, logged, and a failure is caught by the backfill. An account with
no licence still signs in and still sees its dashboard; it just can't create
a board until it has one, and the message says so rather than blaming itself.

**Every refusal ends in a conversation.** The 402 body names what was hit and
the entitlement value behind it, then says get in touch. Same words on the
REST and MCP paths, where there is no UI to explain anything.

### Ruled out

- **Free with no subscription.** Hides the thing worth showing: that a free
  user is a Grantee, and free-to-paid is a plan change.
- **An explicit "get your licence" step.** A step nobody needs.
- **A public self-serve paid plan.** Makes Flapper a business to market and
  support. It's a demo, and lead-gen.
- **Keeping the tier ladder and syncing it from Salable.** See above.
- **A seat as a board or a display.** Teaches the wrong thing about per-seat.
- **Gating the theme editor, MCP or the kiosk shell.** Hides what we most
  want seen.

## The handover log

The RFC's second outcome is *the agent gets better at monetizing a repo* —
which needs an honest record of where the tooling carried the work and where
a person had to step in. First entries:

**"Has to be true" 0 is true, and now proved against the running API, not
just read off the spec.** `POST /api/subscriptions` with
`{plans: [{planId, grantee}], owner, isPerpetual: true}` came back `201` with
`isSalableOnly: true`, `stripeSubscriptionId: null`, `status: "active"`, and
`GET /api/entitlements/check` then returned `board_create` with a null expiry
and a signature. A free licence can be issued from application code. **This
is the bet, and it is won.**

Everything below is what it cost to find that out, and all of it is a docs or
spec issue to file.

**A free plan cannot have no line items.** This is the one that would have
cost a day. Reasoning that a plan is free because there is nothing attached
to charge for, the setup script sent `lineItems: []`. The plan *saved*
happily — `201`, no complaint — and then subscribing to it failed with *"Some
plans were invalid: Plan is missing line items"*. What makes a plan free is
its line item having **no prices**, not the plan having no line items. One
flat-rate, one-off item with `prices: []` and quantity pinned to 1. Salable
mints a Stripe product for it and no price, so nothing can ever be charged.
Nothing in the guides or the spec says a plan needs one.

**`retrievePlan` reports a plan as having no entitlements unless you ask.**
`GET /api/plans/{id}` returns no `entitlements` field at all; you need
`?expand=entitlements`. Reading a plan back to check the setup worked, it
looked like the entitlements had silently not attached — they had. A field
that is absent rather than empty is the difference between "no entitlements"
and "not asked for", and it took a second call to tell them apart.

**`savePlan` wants entitlement ids, not names.** The spec says
`entitlements: array of string` and nothing more. Ids work; a name comes back
as *"Provided entitlements (board_create) does not exist"*, which at least
says so clearly.

**Two line-item fields the spec marks optional are required.** `tiersMode`
must be present as `null`, and `minQuantity` is required — the spec gives
both defaults. The API's own error message is clear about it, which is more
than the spec is.

**A plan cannot be re-saved with the same line-item slug.** *"The provided
line item slugs are in use: boards"* — a re-save has to carry the existing
line item's own id. So `tools/salable-setup.mjs` creates a plan if it is
absent and leaves it alone if it is not, and proves it works by issuing a
throwaway licence against it rather than by trying to repair it.

**There is no way to revoke a secret key through the API.** `listApiKeys`,
`createApiKey`, `retrieveApiKey` — and no delete. All three also refuse a
secret key (`401`), so they are dashboard-session endpoints; a secret key can
create and read everything in an organisation but cannot manage the
credentials that reach it. Verified against the spec and against the running
API. Whether the dashboard offers a revoke is unconfirmed, which is the part
somebody should check: creating a new key does not stop an old one working,
so without a revoke there is no way to respond to an exposed key at all.

**The docs and the OpenAPI spec disagreed, and the spec was right.**
[`subscriptions-and-billing`](https://salable.app/docs/subscriptions-and-billing)
says a Salable Only Subscription is created "from the Subscriptions page in
your dashboard" and documents no API. `openapi.yaml` has
`createSalableOnlySubscription` on `POST /api/subscriptions`. This was the
RFC's "has to be true" 0 — *test on day one* — and it resolved from the spec
alone, no key needed. **Docs issue to file.**

**`isSalableOnly` is a response field, not a request field.** The RFC's
Design 1 says sign-up "calls `POST /api/subscriptions` with `isSalableOnly`".
It doesn't and can't: the request schema is
`{plans: [{planId, grantee}], owner, …}` with `additionalProperties: false`.
A subscription is Salable-only because the plan it names carries no Stripe
price, not because the caller asked. Reasonable inference from the concept
name; wrong about the wire.

**The entitlement check is a `GET`, not a `POST`.** RFC Design 3 names
`POST /api/entitlements/check`; it is
`GET /api/entitlements/check?granteeId=…&owner=…`.

**Flapper's 402 didn't exist where the RFC thought.** The RFC's *"Hit a limit
and get Flapper's existing 402"* pointed at the board-count refusal, which
was a 403 (`MAX_BOARDS_PER_USER = 25`, described in its own comment as "a
flat abuse guard, not an entitlement"). The only 402 was the tier branch that
never fired. Both are now deliberate: 402 for anything a plan would fix, 403
for the abuse ceiling and for an account with no licence at all.

**Entitlement names cannot express a number, and the first vocabulary was
illegal.** `createEntitlement` takes `name` matching `^[a-z_]+$` — so
`board.create`, `board.private`, `board.type.scheduled` and `boards:1` could
none of them have been created, and nothing said so until a setup script was
written against the spec. Two consequences worth filing (RFC chunk 13): a
line item's `slug` allows digits (`^[a-z0-9_]+$`) while an entitlement's name
does not, which reads like an oversight rather than a decision; and there is
no way for an entitlement to carry a quantity, so a limit has to be a named
tier and the number ends up back in the application. `tests/salable.test.mjs`
now holds every name to the rule, and `tools/mock-salable.mjs` refuses an
illegal one the way the real API would.

**The walk found two things the tests could not.** Driven through the mock
against a real dev server: the board-limit 402 read as two half-sentences
spliced together (`…delete one, or this needs a plan we don't sell off the
shelf; get in touch`), because a shared constant was written to start a
sentence and then used mid-one. And a one-board account asking for a
scheduled board was told to delete a board — the count was checked before the
type, so the refusal named the less specific of two true problems. Both are
fixed; the ordering has a test now. Neither was visible from the unit tests,
which asserted status codes and `need` values rather than reading the
sentence.

**A first-run detail worth knowing:** two board creates in a row produce one
entitlement check, not two. That is the sixty-second cache doing its job, and
it means a plan change in the Salable dashboard takes up to a minute to reach
a warm function.

## What needs the owner

Handing this back at a pause-point, which is what the RFC asked for. Nine
things, none of which a Contributor can decide.

**1. Chunk 6 needs somewhere to live that isn't a personal account.**
`flapper-tan.vercel.app` is not in the Salable Vercel team. That is fine for
a demo and impossible for chunk 6: Live Mode settles to a company Stripe
account, and the Company Details document needs a registered name and number
that are not an individual's. Moving the project is a prerequisite for taking
money, not a tidy-up afterwards.

**2. "Has to be true" 3 has nobody's name against it.** *"Someone keeps
Flapper running after launch."* Everything else in the RFC has an owner or a
contributor; that one does not, and it is the one that decides whether any of
this survives the quarter.

**3. Salable is configured and the env vars are ready to set.** A test-mode
Product, a Free plan and all six entitlements exist, and a licence has been
issued against the plan and read back. Whoever holds the Vercel project sets
`SALABLE_API_KEY` and `SALABLE_FREE_PLAN_ID`; `tools/salable-setup.mjs`
prints the plan id, and the key belongs in Vercel, never in this repo.

**4. Six findings to file (chunk 13), one of them not like the others.**

**A Salable secret key appears to have no revocation path.** The API has
`listApiKeys`, `createApiKey` and `retrieveApiKey` and **no delete or
revoke** — and those three reject a secret key with a `401`, so key
management is dashboard-session-only. We could not find a revoke in the
dashboard either, though that is "could not find" rather than "is not
there". If it really is absent, then a credential documented as granting
*"full access to the Salable API"*, whose own docs say *"any exposure of this
key is a potential security risk for you and your users"*, cannot be turned
off by the person holding it. Creating a new key does not help: the old one
keeps working. That is a security property rather than a rough edge, and it
is worth someone checking before anything else on this list.

The other five are API-shape findings, all in the handover log below. All in the handover log below. The
one worth reading first: **a free plan cannot have no line items** — it saves
without complaint and then cannot be subscribed to, and nothing in the guides
or the spec says so. Then: `retrievePlan` omits entitlements unless asked;
`savePlan` wants ids not names; `tiersMode` and `minQuantity` are required
though marked optional; and a plan cannot be re-saved carrying a line-item
slug it already owns.

**5. Four things the RFC asserts that the API does not.** Also in the log.
None of them change the proposal; all of them change a sentence in it.

**6. The RFC's strategy links point at a file that no longer exists.** It
cites `handbook/company/strategy.md` for choices 2, 4 and 6, and
`handbook/engineering/development-process.md`. The choices now live in
`handbook/company/app-builder.md` under *"The choices that define this
approach"* — **and the numbering still matches exactly**, so it is a rename,
not a rethink. The engineering page does not exist at all.

**7. One design concession to sign off.** Entitlement names cannot contain
digits, so the board cap is a named tier and `BOARD_TIERS` in
`lib/salable/licence.mjs` is Flapper deciding that "many" is 25. The RFC's
"Boards: a few / more / unlimited" assumed a number that could live on the
plan. Salable still decides which tier an account is on; "how many is many"
is now in the application, which is a step back from *Salable holds the
answer* and should be a decision rather than a discovery.

**8. Free is one board, not "a few".** Taken from Neal's steer on 2026-09-02
rather than from the RFC. Worth confirming in the RFC so the two agree.

**9. One line in the handbook cuts against the Brew Digital route.**
`app-builder.md`: *"If every product continues to require the same level of
bespoke work, we are building a services business rather than proving this
approach works."* The RFC sells Flapper installations as agency work through
Brew, which is that risk by name, and the RFC does not address it. Not an
objection — a question the owner should answer on the record.

**Still open and not blocking anything:** Discussion 5, whether Flapper stays
open-source or closes with a template extracted. Everything built works
either way.

## Not built yet

In RFC breakdown order, so it's clear what this is and isn't:

- **Chunk 4, remainder** — the form and the queue are in (above); the routine
  for actually cutting a bespoke plan is a person's, and is not written down
  yet.
- **Chunk 3, remainder** — webhook paths, and dropping `user.tier`. Also
  entitlement-signature verification: the check response carries a
  `signature`, and `GET /api/signing-keys` exists, which is what makes a
  longer cache safe. The sixty-second in-memory cache is deliberately the
  simple version until then.
- **Chunk 5** — the team model. Owner invites Grantees into a Group; a
  per-seat Line Item sets how many. Nothing per-seat can attach to Flapper
  until it exists.
- **Chunk 6** — Live Mode, real Stripe, the account area showing licence,
  plan and seats.
- **Chunk 8** — the call to Salable in the app and the README.
- **Chunk 9** — the public "try the demo" page and the internal playbook.

**Not decided:** whether Flapper stays open-source or closes with a template
extracted from it (RFC Discussion 5). Everything above works either way.
