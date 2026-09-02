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
| `board.create` | may create a board at all. This is the licence. |
| `boards:1`, `boards:25`, `boards:unlimited` | how many |
| `board.type.scheduled`, `board.type.shared` | a board type that isn't free |
| `board.private` | may make a board private |

The cap rides *inside* the value because the check response carries only
`{type, value, expiryDate}` — there is no quantity field to read. So
`boards:1` is one entitlement value, not an entitlement with a number
attached. Several plans granting a cap resolve to the most generous, which
is how Salable itself resolves a repeated entitlement's expiry.

A board type declares the value it needs, and that is Flapper's entire half
of the conversation:

```js
// lib/board-types/scheduled/definition.mjs
entitlement: 'board.type.scheduled',
```

Leave it unset and the type is free. A fork adding a type gets to decide.

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
   Stripe price. Give it the entitlements `board.create` and `boards:1`.
2. Set the env vars (see the table in [README](../README.md#deploy-it)):
   `SALABLE_API_KEY`, `SALABLE_FREE_PLAN_ID`.
3. Backfill the accounts that predate the licence, **before** the gate goes
   live:

   ```bash
   SALABLE_API_KEY=… SALABLE_FREE_PLAN_ID=… DATABASE_URL=… \
     node tools/backfill-licences.mjs --dry-run
   ```

   Idempotent: an account already holding `board.create` is skipped, so
   re-running never issues a second subscription. Existing accounts keep
   every board they have — an account over the free allowance is frozen where
   it is, still able to drive, rename and delete, just not to add another.
   Nothing is deleted and nothing is deactivated.
4. A bespoke sale is a clone of the free plan with a more generous cap and
   whichever type entitlements were asked for. No deploy.

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

## Not built yet

In RFC breakdown order, so it's clear what this is and isn't:

- **Chunk 4** — the in-app get-in-touch form, and the routine for cutting a
  bespoke plan. The 402 copy is in; the form is not.
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
