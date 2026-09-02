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
| `better-auth.session_token` | Flapper | keeps you signed in | 7 days (`Max-Age=604800`), `Path=/`, `HttpOnly`, `SameSite=Lax` |

That is the only one. Signing up, signing in and browsing the app set nothing
else — observed on the responses, not inferred from the framework's defaults.

Two cookies a reviewer might expect and will not find. Flapper is the OAuth
**provider**, not a client, so the state and code-verifier cookies of a
sign-in started from Claude or ChatGPT are set by *them*, on their own
domains; what Flapper carries through its own consent screen is a signed
`oauth_query` URL parameter, not a cookie. And there is no separate CSRF or
`__Host-` cookie: the session cookie is `SameSite=Lax` and does the work.

The display page (`/b/{slug}`) sets no cookies at all; a wall screen keeps
nothing about you. The display's own settings - mute, volume - are kept in
that browser's `localStorage`, which is not a cookie and leaves nothing with
us.

## Third parties

None. Nothing on a Flapper page requests anything from another domain — the
served HTML contains no external host at all. Worth saying why, because the
build looks otherwise: the two typefaces come from `next/font/google`, which
downloads them at build time and serves the `.woff2` files from Flapper's own
domain, so no request ever reaches Google from a visitor's browser.

[[PLACEHOLDER: confirm after deployment - Vercel's edge may set its own
cookie on some plans, which is a hosting fact rather than an application
one.]]

## Managing cookies

You can block or delete cookies in your browser; without the session cookie
you cannot stay signed in.
