# Cookie Policy

> **[[PLACEHOLDER: Not yet reviewed. The facts below are true of the product
> today and are what a reviewer should confirm.]]**

*Effective: [[PLACEHOLDER: date]]*

## The short version

Flapper sets only cookies that are strictly necessary to run the service, so
it does not ask for cookie consent and shows no cookie banner. Under the
Privacy and Electronic Communications Regulations, strictly necessary cookies
are exempt from the consent requirement. If that ever changes - an analytics
tool, for instance - consent will be asked for before anything is set.

## The cookies

| Cookie | Set by | Purpose | Lifetime |
|---|---|---|---|
| `better-auth.session_token` | Flapper | keeps you signed in | [[PLACEHOLDER: session lifetime]] |
| OAuth state and code-verifier cookies | Flapper | complete a sign-in started by a connected app (Claude, ChatGPT) | minutes, during the sign-in |
| `__Host-…` / CSRF cookies (if any) | Flapper | protect forms and sign-in | [[PLACEHOLDER: confirm which exist]] |

The display page (`/b/{slug}`) sets no cookies at all; a wall screen keeps
nothing about you. The display's own settings - mute, volume - are kept in
that browser's `localStorage`, which is not a cookie and leaves nothing with
us.

## Third parties

None. Fonts and scripts are served from Flapper's own domain. [[PLACEHOLDER:
confirm after deployment - Vercel's edge may set its own cookie on some
plans.]]

## Managing cookies

You can block or delete cookies in your browser; without the session cookie
you cannot stay signed in.
