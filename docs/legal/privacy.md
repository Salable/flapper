# Privacy Notice

> **[[PLACEHOLDER: This notice has not been written or reviewed. The sections
> below are the shape UK GDPR requires; the facts the product already decides
> are filled in, the rest is marked.]]**

*Effective: [[PLACEHOLDER: date]]*

## Who is responsible for your data

The controller is [[PLACEHOLDER: registered company name and number]]. Privacy
questions and requests: [[PLACEHOLDER: privacy@example.com]]. ICO registration:
[[PLACEHOLDER: number, or the exemption relied on]].

## What we collect, and why

| Data | Why | Lawful basis | Kept |
|---|---|---|---|
| Name, email, password hash | to run your account | contract | until you delete the account |
| Your boards: names, slugs, settings, themes, queued messages | to run your boards | contract | until you delete the board or the account |
| What a display is showing (its last reported state) | so the control room and the API can report it | contract | expires 30 days after the display last reported |
| Sign-in sessions and OAuth grants to connected apps | security, and so connected apps can act for you | contract / legitimate interest | session lifetime; grants until you disconnect |
| Marketing preference and when you set it | to know whether we may email you about Flapper | consent (PECR) | until withdrawn |
| Acceptance of the Terms (when, which version) | to show we had an agreement | legitimate interest | account lifetime |
| Server logs (IP address, request path, errors) | security and diagnosing faults | legitimate interest | [[PLACEHOLDER: Vercel's retention for the plan we are on - a hosting fact to look up, not an application setting]] |

We do not use analytics or advertising trackers. Confirmed in the code
rather than asserted: no analytics package is installed, and the served
pages request nothing from any other domain. If one is ever added, this
notice and the Cookie Policy change before it ships.

## Public boards

A board is public by default: its display URL and its read API show whatever
you have queued to anyone with the link. Do not put personal data on a board
you would not put on a wall.

## Who we share it with (processors)

| Processor | What they do | Where | Safeguard |
|---|---|---|---|
| Vercel Inc. | hosts the site and runs its functions | USA / EU edge | [[PLACEHOLDER: DPA + transfer mechanism]] |
| Neon Inc. | the Postgres database | [[PLACEHOLDER: region]] | [[PLACEHOLDER]] |
| Upstash Inc. | the Redis channel between the API and displays | [[PLACEHOLDER: region]] | [[PLACEHOLDER]] |
| Connected apps you authorise (e.g. Anthropic, OpenAI) | act on your boards at your request | their terms | your consent, per connection |

## International transfers

[[PLACEHOLDER: which processors hold data outside the UK, and the mechanism
relied on for each - UK IDTA, the UK Addendum to the EU SCCs, or the UK–US
Data Bridge where the processor is certified.]]

## Your rights

You can ask for a copy of your data, have it corrected or deleted, object to
or restrict processing, and take it elsewhere. Email [[PLACEHOLDER:
privacy@example.com]]; we answer within one month. You can also complain to
the Information Commissioner's Office (ico.org.uk). Withdrawing marketing
consent is one switch in Account → Privacy & data.

## Security

- **Passwords** are hashed with scrypt (Better Auth's default) and never
  stored in a form we could read.
- **Board API keys are stored in the clear.** A board's Settings screen has
  to be able to show you the key, so it cannot be a hash. Each key is scoped
  to one board — it can drive that board and reach nothing else on your
  account — and regenerating it is one click, which is the recovery story if
  a key gets out. Say this plainly rather than claim a hash we do not have.
- **Display tokens** — what a wall screen uses to report back — are derived
  by HMAC from the board's key and are not stored at all, so there is nothing
  to leak. Rotating the board's key invalidates every one of them.
- **Comparisons** of keys and tokens are constant-time.
- **Sessions** are signed, `HttpOnly` cookies.

[[PLACEHOLDER: breach notification commitment - the ICO within 72 hours
where required, and you without undue delay where the risk is high.]]

## Changes to this notice

[[PLACEHOLDER: how changes are notified; the date above moves.]]

## Annex — record of processing

[[PLACEHOLDER: the one-page Article 30 record: purposes, categories of data
and people, recipients, transfers, retention, security measures. The table
above is most of it.]]
