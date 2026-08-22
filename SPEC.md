# Flapper — Specification

*The next iteration's asks land here. The executed program plans live in git
history (`git show ee7741c:SPEC.md` for 3.0, `git show dc3b0a2:SPEC.md` for
4.0); what shipped is surveyed in [docs/SCREENS.md](docs/SCREENS.md), and the
standing design records are [docs/BOARD-TYPES.md](docs/BOARD-TYPES.md),
[docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md), and
[docs/rfcs/](docs/rfcs/).*

## Next iteration — asks

*Sections 1 and 2 are Neal's direct layout asks, 21 Aug 2026. Sections 3–7 come
from a UX walkthrough of production (`flapper-tan.vercel.app`) the same day —
signed-in dashboard, board creation, display, settings, the MCP connector, and
the disconnect flow. Findings marked **[verified]** were reproduced
deliberately; one is marked **[unverified]** and says what would settle it.
Notes in `docs/attic/README.md` for anything removed, per the 4.0 convention.*

> **Branch note, resolved 21 Aug:** `main`, the `mcp-interface-integration`
> worktree, and this branch were all at `da895a8` with the connect card in
> `DashboardClient.tsx` (215 lines) — the divergence warning was stale.

## Status — executed 21 Aug 2026 (branch `claude/spec-tasks-improvements-f82704`)

| # | Ask | Status | Where |
| --- | --- | --- | --- |
| 1–2 | Boards heading; New board on its row | **Done** | `DashboardClient`, `.dash-head` |
| 3 | Three columns below the grid (stateful connect) | **Done** | `.dash-more`; connections managed on `/account` |
| 4 | Identity out of the AppBar (paused chip stays) | **Done** | `SettingsClient` |
| 5 | Board sidebar (name at last) | **Done** | `components/BoardSidebar.tsx` |
| 6 | Tabs as a vertical menu + "always" links | **Done** | `Tabs orientation="vertical"`, `before`/`after` |
| 7 | Disconnect disconnects | **Done — immediate, not "within the hour"** | `lib/api/revocations.mjs`, `oauth_client_revocation` (migration 0005). Root cause: the provider never stores JWT access tokens, so nothing was being revoked |
| 8 | Key masked in its own code blocks | **Done** | `lib/api/mask.mjs`; Reveal unmasks all together; Copy copies real |
| 9 | `create_board` returns no key | **Done** | REST and MCP; `get_board_key` is the explicit ask |
| 10 | Background tab = `frozen`, loudly | **Done** | `hooks/useStatePublisher.ts` stamps visibility + frame age; `lib/api/liveness.mjs`; amber dot; Getting Started §3½ |
| 11 | Stale board list; three empty states | **Done** | Sign-in/out are full navigations (router cache was the cause); bfcache refresh; load-error + removed states |
| 12 | Catalogue | **Groundwork done; split is RFC 0003** | outcome copy, live previews, Start here, `tier` enforced in `createBoard` (402) |
| 13 | Ask for less at creation | **Done** | `advanced` params → Settings › Type settings; name required; `PATCH /config` validates params |
| 14 | `showing` null when settled | **Done** | `showing` always the glass (`held`), `phase` playing/holding/blank; `holding` retired (attic) |
| 15 | `lines` is intended state | **Done (docs softened)** | MCP/REST docs: "what the display was last told to show"; `animating` flagged |
| 16 | `position` leaks ordering key | **Done** | 1-based `position` + `ahead` |
| 17 | Card accessible names | **Not a bug — deleted** | Plain `<button>` with text content; name-from-content applies. The flattening was the reading tool's (reproduced with a second tool on the DOM). Cards now also carry an explicit `aria-label` |
| 18 | Account area | **Done** | `/account`; name in the AppBar is the link (`UserMenu`) |
| 19 | Smaller items | **Done / explained** | Flush/Clear disabled when idle; visible Cancel on step one; a pristine board already greets "FLAPPER" — the blank grid is a *cleared* board, by design |
| 9.1–6 | Open questions | **Options + recommendations** | [docs/rfcs/0003-catalogue-and-open-questions.md](docs/rfcs/0003-catalogue-and-open-questions.md) |

Also from the spruce-up ledger: the AuthForm OAuth continuation is explicit,
consent Deny says "nothing was connected" before following `access_denied`,
and the AppBar wraps at phone width.

---

### 1. Dashboard layout

1. **Raise the Boards header.** `.dash-title` ("Boards *n*") is currently sized
   like body copy and reads as a label rather than the page's heading. Give it
   real heading weight and size in the type scale.

2. **Move New board to the right, onto the header row.** Today it sits alone in
   `.dash-create` above everything. Put it on the same row as the Boards header,
   right-aligned — header left, primary action right.

3. **Rebuild the section below the board grid as three columns.** It currently
   reads as generic AI-product furniture rather than part of Flapper. Three
   equal columns:

   - **Left — connect an assistant.** Stateful. When no connector is attached,
     show the MCP URL and the Copy MCP URL button. When one is attached, show
     the connection's name instead (as the Connected row does today).
   - **Middle — drive it over REST.** Links to the REST API documentation.
   - **Right — learn more.** Links to the docs root (`/docs`).

   Related: this is also where the disconnect state needs fixing — see ask 7.
   And active connections arguably belong in an account area rather than the
   dashboard (ask 18); the three-column card is the near-term shape, not
   necessarily the final home.

---

### 2. Settings layout — sidebar and left-hand menu

The settings screen currently pushes board identity into the top bar and lays
the three tabs out horizontally. Move identity into a sidebar and the tabs into
a vertical menu.

4. **Strip board identity out of the AppBar.** `SettingsClient` passes
   `AppBar right` a muted `/b/{slug}`, a `<Chip>` of the type name, a paused
   chip when deactivated, then Open display and Dashboard. Remove the `/b/{slug}`
   span and the type chip — both move to the sidebar. Keep the two actions in
   the bar.

   One decision: the **paused** chip is a live status, not identity — a paused
   board is playing nothing at all. Recommend it stays visible outside the
   sidebar (or the sidebar is always in view), rather than becoming something
   you have to look for.

5. **Add a board sidebar.** A persistent column — left or right, see open
   question 6 — holding the details about the board itself:

   - **Board name.** It appears nowhere on this screen today: you type a name at
     creation and never see it again, and the bar shows only the slug. The
     sidebar is the fix for that (this closes the old smaller-item ask).
   - Slug and the board URL, with a copy control.
   - Board type, and status (active / paused / private).
   - Created date.
   - Quick actions: Open display, copy display URL.

   Treat this as a reusable shell, not a one-off: the same pattern will want to
   serve any future per-board screen.

6. **Turn the tabs into a left-hand menu.** Queue / Display / General become a
   vertical nav beside the panel rather than a strip above it.

   - `Tabs` lives in `components/ui/Tabs.tsx` and is used by **only**
     `SettingsClient`, so the change is contained. But it is a `components/ui/`
     primitive, so give it an `orientation` variant (or add a sibling `SideNav`)
     rather than hard-coding a vertical list inside settings — consistent with
     the standing "component-first" direction from the 4.0 spec.
   - Keep the `role="tablist"` / `aria-selected` semantics and add
     `aria-orientation="vertical"`; keep arrow-key roving focus.
   - Note the `components/ui/` rule in CLAUDE.md — callback-prop identity is
     never behavioural. Don't key effects on the tab-change handler.
   - **Below the nav items, a default area** for things that are always true of
     this board rather than a tab: the board type, and default links — the
     board's own agent guide (`/api/b/{slug}/AGENTS.md`), the REST API docs, and
     the docs root. This is the natural home for the per-board AGENTS.md link,
     which is currently buried at the bottom of General.

---

### 3. Security — do these first

The only items I would block a public demo on. All three are the product
telling the user something untrue.

7. **Disconnect does not disconnect. [verified]** Revoking the Claude connection
   from the dashboard removes the Connected row from the UI, but the revoked
   client keeps **full read and write access**. Immediately after confirming
   Disconnect, `list_boards` returned every board and `post_message` with
   `priority: "now"` successfully wrote to the glass. The confirm dialog is
   honest about this ("anything it already holds stops working within the
   hour"), but once confirmed the connection vanishes from the page entirely, so
   the standing grace window is invisible.

   Someone disconnects because they suspect misuse. For up to an hour the thing
   they revoked can still post to their wall, and the screen shows no connection
   at all. Asks:
   - Keep the row visible while access persists: *"Claude — revoking, access
     ends 14:32"*, then drop it.
   - Offer immediate revocation (invalidate issued access tokens, not just the
     refresh grant) as the default, with the hour as the fallback.
   - Do not claim in demos or docs that Disconnect revokes immediately.

8. **API key masking is defeated on its own screen. [verified]** Settings →
   General masks the key behind Reveal / Copy, then prints it in full, unmasked,
   twice below: in the `SEND A MESSAGE` curl block and the `CONNECT CLAUDE OR
   CHATGPT TO THIS BOARD` command. The masking is theatre. Anyone screen-sharing
   settings — which the current demo script instructs at step 6 — broadcasts a
   live write key.

   Ask: mask the key inside the code blocks too (`Bearer ••••••••••••`), and let
   Copy curl / Copy command put the real value on the clipboard. The user never
   needs to see the key to use it — the principle the OAuth path already gets
   right.

9. **`create_board` returns the new key in the tool response.** Any agent that
   creates a board has the key in its transcript, and so does any log of that
   conversation. Ask: return a one-time retrieval URL, or require an explicit
   `get_board_key` call, so key material isn't emitted as a side effect of
   creation.

---

### 4. Reliability

10. **A backgrounded display tab freezes silently, and reports itself healthy.
    [verified]** With the display tab hidden, `requestAnimationFrame` is
    suspended entirely — a 2-second rAF probe timed out after 45s with the
    renderer unresponsive, while ordinary JS ran fine. The board halts
    mid-transition showing garbled half-flipped tiles. Throughout, `get_status`
    kept returning `boardReady: true`, `stale: false`, and a `lines` array
    describing the *intended* text. The heartbeat survives background
    throttling; the animation does not. Foregrounded, the same board runs at
    60fps and is settled 64% of the time.

    For a product whose job is unattended wall display this is the
    highest-value reliability fix. A kiosk tab that loses foreground to a
    screensaver, an OS window switch, or another tab goes dead with no signal
    anywhere. Asks:
    - Have the display report `document.visibilityState` and observed frame
      progress in its heartbeat; surface a distinct `frozen` state in
      `get_status` alongside `stale`.
    - Show it on the dashboard card — a frozen board should not look identical
      to a playing one.
    - Document the deployment guidance (kiosk shell, or a foregrounded tab) in
      `docs/GETTING-STARTED.md`, and say plainly that a background tab will not
      animate.

11. **The dashboard served a stale board list. [verified]** First paint after
    sign-in rendered four boards — names, slugs, Open display and Delete buttons
    — that had already been deleted. Seconds later, untouched, the page
    re-rendered to the empty state. All four slugs returned `404 unknown board`;
    `GET /api/boards` returned `{"boards": []}`. Clicking any of those cards
    would have 404'd.

    Ask: don't paint a board list from cache without revalidating, and
    distinguish the three states the empty state currently conflates — *you have
    no boards yet* (onboarding copy), *we couldn't load your boards* (error +
    retry), and *your boards were removed*. A returning user with boards was
    shown new-user onboarding copy with no error.

---

### 5. The create flow → a board catalogue

12. **Turn "What kind of board?" into a catalogue.** The current chooser is
    three cards distinguished by a one-line description and capability chips.
    Scheduled and Shared Screens both show CLOCK, FALLBACK, API — the only
    visible difference is one MULTISCREEN chip. Nothing indicates a default, and
    the choice is consequential: pick Live and a later `schedule` is refused
    with a 422. It reads as an internal engine picker, not a product surface.
    The title "What kind of board?" reads as placeholder copy.

    The aspiration is an app-store-style catalogue of board types, templates and
    custom configurations, including entries locked behind a tier or requiring
    purchase (`salable.app`, per the 4.0 spec). The architecture is already most
    of the way there — `lib/board-types/` is a registry whose contract requires
    `name`, `tagline`, `description`, `capabilities`, `createParams`, and
    `configVersion`/`migrateConfig`, and per `docs/BOARD-TYPES.md` the registry
    already feeds the create modal, settings, the API, *and* the per-board
    AGENTS.md. A catalogue entry propagates everywhere for free. This is an
    exposure and entitlement problem, not a re-architecture.

    - **Split engine from template.** Today a "type" conflates the playback
      engine the server must understand (`playback: 'live' | 'clock'`) with the
      product concept a customer thinks they're getting. A store needs many
      listings over few engines. "Departures Board", "Standup Timer", "Build
      Status", "Café Menu", "Countdown" are all templates over the two engines
      that already exist — a named preset of `typeId + config + seed content`.
      Engines stay the contract-enforced, security-reviewed few; templates are
      data-only, cheap, and safe to accept from third parties. Without this
      split every catalogue entry costs an engine and the catalogue stays at
      three.
    - **Keep "types add no server routes."** The contract calls it a v1
      non-goal. For a marketplace it is the load-bearing safety property — it's
      what allows hosting someone else's board type without sandboxing. Promote
      it from limitation to guarantee and state it in the authoring guide.
    - **Replace the capability chips rather than explaining them.**
      QUEUE / LOOP / CLOCK / FALLBACK / MULTISCREEN describe the implementation.
      Listings should sell outcomes. `capabilities` is already documented as
      free-form labels, so this costs nothing.
    - **Enforce entitlement server-side and on MCP.** Greyed-out cards are
      decoration. `create_board` over the connector must refuse a premium type
      with a clean, explanatory 402/403 — the existing `reject(msg, code)` idiom
      fits. Agents are the expected creation path; a UI-only paywall is no
      paywall.
    - **Live previews are the unfair advantage.** Every listing can render a
      real animated split-flap of sample content; the display player is already
      client-side. App stores use screenshots because they have to. Make the
      preview the centrepiece of the catalogue, not a detail.

13. **Ask for less at creation.** `Queue size` (default 5) is on the create
    form. A first-run user has no basis to choose it and it is editable later.
    Creation should ask for the minimum a type genuinely needs; everything else
    belongs in settings. Related: the name field has no placeholder and is not
    marked required, and a board can be created unnamed.

---

### 6. Agent-facing API

14. **`showing` is `null` on a board that is displaying text. [verified]** When
    settled, `get_status` returns `showing: null` and moves the message to
    `regions.main.holding`; `lines` is correct throughout. `showing` is the
    field an agent reaches for to answer "what's on the board?", and it is empty
    exactly when the board is at rest and most readable. Ask: make one field
    answer "what is on the glass right now" in every state, and reserve the
    playing/holding distinction for a separate field.

15. **`lines` is the intended state, not the literal glass.** Both the MCP
    server instructions and the demo script call `lines` "the literal rows on
    the glass." During a transition it reports the destination text while the
    board shows half-flipped tiles; `animating: true` is the only hint. Ask:
    either soften the documented claim, or have the display post back its actual
    tile state. This matters most for an agent verifying its own post — the one
    moment it is most likely to look.

16. **`post_message` leaks the ordering key as `position`.** Responses return
    `position: 2048`, `3072`, `4096` — an internal gap index that reads like
    "2048th in the queue." Ask: return a human-meaningful position (or omit it),
    and keep the ordering key internal.

---

### 7. Interface and accessibility

17. **Do the board-type cards have accessible names? [unverified]** Reading the
    open create modal returned `dialog`, then three bare `button` entries with
    no accessible names — a screen-reader user would hear "button, button,
    button" with no way to tell Live Queue from Scheduled from Shared Screens.
    Ordinary fields in step two of the same modal read back correctly, so if
    real it is specific to the card pattern.

    I could not confirm it from the source. `CreateBoardModal` renders real
    `<button>`s whose content is nested `<span>`s, and `.flap-in` animates
    `opacity`/`transform`, not `visibility` — none of which should strip a name.
    So this may be an artifact of the reading tool. Ask: check it with a real
    screen reader or an axe run; if it reproduces, fix the pattern, add a
    contract test, and record the rule in `docs/DESIGN-SYSTEM.md` alongside
    "Forms hold focus". If it doesn't, delete this item.

18. **There is no account, settings, or profile area.** The entire global nav is
    Dashboard / Docs / Sign out; the user's name in the header is plain text,
    not a link. Active connections consequently live bolted to the bottom of the
    dashboard. Ask: add an account area and move connections, profile, and
    future billing/tier into it. See ask 3 for the near-term shape.

19. **Smaller items.**
    - `FLUSH PENDING` and `CLEAR BOARD` are enabled on an empty queue.
    - The board-type modal's first step has no *visible* cancel or close
      control; the second step has Back.
    - A brand-new board with an empty queue shows a completely blank grid,
      indistinguishable from a broken one. Consider a first-run standing
      message.

---

### 8. What is already good — don't regress it

Recorded because it should survive the next refactor.

- **`preview` is the best surface in the product.** Substitutions itemised with
  counts, `unsupported` separated from `substitutions`, `brokenWords`,
  `clippedLines`, and an `estimatedMs` that measured accurate (3908 predicted
  against settled runs of 3836–3880ms).
- **Error copy states what and why.** The scheduling 422 — *"this board type has
  no clock; schedule only applies to scheduled boards"* — is a model.
- **Destructive confirmations name the consequence**, both the slug-rename
  warning and the regenerate-key dialog.
- **Dashboard cards earn their space** when a display is connected: green status
  dot plus the live message ("showing LAST TRAIN 23 45").
- **The number field's raw-string handling is deliberate and correct** —
  `inputMode="numeric"` with server-side coercion, so a half-typed value never
  echoes back as `NaN`. Don't "fix" it to `type="number"`.
- **`prefers-reduced-motion` is honoured** on `.flap-in`.
- **The flip itself is right.** Foregrounded, 60fps, settled ~64% of the time
  with ~3.8s readable holds. The rhythm is good; protect it.

---

### 9. Open questions / decisions I want options on

1. **Background-tab freeze:** is the answer the Electron kiosk shell, a Wake
   Lock / offscreen-canvas approach in the browser display, or accepting it and
   detecting it loudly? What does a real customer's wall actually run?
2. **Engine vs template:** how far to take the split. Is a template just
   `typeId + config + seed items`, or does it need its own presentation hooks?
   What is the minimum that lets a third party publish one?
3. **Immediate revocation:** what does invalidating issued access tokens cost
   given the pinned `@better-auth/oauth-provider` / `mcp` packages — is it a
   supported operation or does it mean a token blacklist?
4. **Catalogue and entitlement:** does tier live in Flapper or entirely in
   salable.app, and what does `create_board` check on the MCP path?
5. **Branch divergence:** which tree is authoritative for the dashboard (see the
   note at the top), and should the worktree be merged before section 1 starts?
6. **Sidebar side, and how many columns:** left or right for the board sidebar,
   and is the vertical tab menu the *same* column as the board details (one
   sidebar, nav on top of details) or a separate one (nav left, details right,
   panel centre)? The second is heavier but keeps details visible on every tab.
---

## Launch readiness — legal and compliance for a UK website

*Research and design, 22 Aug 2026. Nothing here is legal advice; it is what
the product needs in place, in the shape it needs it, so that a solicitor (or
a careful founder) can fill the text in rather than design the plumbing. Every
placeholder the app ships is marked `[[PLACEHOLDER: …]]` in the document and
carries a visible banner on the page until its `status` in
`lib/legal/documents.mjs` is flipped to `published`.*

### What applies, and why

| Regime | What it asks of Flapper | Where it lands |
|---|---|---|
| **UK GDPR / Data Protection Act 2018** | A privacy notice at the point of collection; a lawful basis per purpose (contract for the account, legitimate interest for security logs, **consent** for marketing); a record of processing; named processors and where they are; international-transfer safeguards (Vercel, Neon, Upstash are US companies → UK IDTA / Addendum, or the UK–US Data Bridge where certified); retention periods; the rights (access, rectification, erasure, portability, objection) and how to exercise them; breach handling (72 h to the ICO); data-protection fee paid to the ICO unless exempt. | `docs/legal/privacy.md`; Account → *Privacy & data*; the consent columns below |
| **PECR 2003 (as amended, incl. DUAA 2025)** | Electronic marketing to individuals needs **consent**: an unticked box, separate from the terms, naming who will contact them and about what, withdrawable as easily as it was given, and *recorded*. The soft opt-in does not apply at signup (no sale). Cookies: strictly-necessary ones are exempt from consent; anything else (analytics, A/B, ads) needs opt-in *before* it is set, with Reject as prominent as Accept. | Signup checkbox + `user.marketingConsent*`; `docs/legal/cookies.md` — **Flapper sets only strictly-necessary cookies today (the session and OAuth state), so no banner is required. Adding analytics changes that.** |
| **Companies Act 2006 / Trading Disclosures Regs 2008 / E-Commerce Regs 2002** | Registered name, company number, place of registration, registered office, and a contact email (a geographic address too) on the site, easily found. VAT number if registered. | `components/SiteFooter.tsx` + `docs/legal/company.md` |
| **Consumer Rights Act 2015 / Consumer Contracts Regs 2013** | Only once something is sold: pre-contract information, 14-day cancellation for digital services (with the express-consent-to-start carve-out), clear pricing, confirmation. Today Flapper sells nothing; the Terms say so and reserve the section. | `docs/legal/terms.md` §Payment (reserved) |
| **Equality Act 2010** | Reasonable adjustments for disabled users — not a website standard in law for a private company, but WCAG 2.1 AA is the defensible bar, and SPEC §7 already tracks it. | SPEC §7 |
| **Online Safety Act 2023** | Probably out of scope: boards show content their owner chooses, there is no user-to-user service. *Decision for counsel*: a public board URL that anyone can view is "published", not "shared between users". | `docs/legal/terms.md` §Acceptable use |
| **Desktop app** | An EULA for the Electron kiosk (licence, no warranty, updates, telemetry = none), surfaced in the release notes and on first run. | `docs/legal/eula.md`; release notes |

Sources consulted: ICO guidance on direct marketing by electronic mail and on
PECR cookies (2025 update), the Data (Use and Access) Act 2025 changes to PECR
enforcement (fines now up to £17.5 m / 4 %), HWB's and Influx's UK website
requirement guides, and the Crunch summary of the E-Commerce Regulations.

### The documents

| Slug | Title | Status | Needs from Neal before it can be written |
|---|---|---|---|
| `terms` | Terms of Service | placeholder | legal entity; governing law (England & Wales); whether boards may be used commercially; uptime promise (none); liability cap; age (18+ proposed) |
| `privacy` | Privacy Notice | placeholder | controller identity and contact; DPO or privacy contact email; ICO registration number; processor list confirmed (Vercel, Neon, Upstash; any email provider); transfer mechanism per processor; retention periods (proposal: account until deleted, board state 30 days after last touch — the broker TTL already does this, logs 90 days) |
| `cookies` | Cookie Policy | placeholder | confirm no analytics; name the cookies (`better-auth.session_token`, OAuth state) with lifetimes |
| `eula` | Desktop App Licence | placeholder | licence terms for the kiosk; whether the app may be redistributed |
| `company` | Company Details | placeholder | registered name, number, place, registered office, contact email, VAT number (if any) |

Each file has the *headings* the finished document needs, with the text of
each section either written (where the product already decides it — what
cookies exist, what data a board stores) or a `[[PLACEHOLDER: …]]` naming
exactly what is missing.

### What the app does now (implemented with the placeholders)

1. **`/legal/{slug}`** — public pages rendering `docs/legal/*.md` with a
   placeholder banner while `status` is `placeholder`; `/legal` lists them.
2. **Site footer** (`SiteFooter`) on the landing, auth, dashboard, account and
   docs pages — not the display: company line + Terms · Privacy · Cookies ·
   Desktop licence · Company details. The display is wall glass and stays bare.
3. **Signup** has two boxes, both unticked: *I agree to the Terms of Service
   and Privacy Notice* (required to submit; links open in a new tab) and
   *Email me about new features — you can unsubscribe any time* (optional,
   separate, names the purpose). Both are stored on the user:
   `termsAcceptedAt`, `termsVersion`, `marketingConsent`, `marketingConsentAt`
   — the record PECR asks for. The terms version is the registry's `version`,
   so a future change to the Terms can prompt re-acceptance.
4. **Account → Privacy & data**: the marketing preference as a switch (writes
   `marketingConsent` + timestamp both ways — withdrawal is one click, as the
   ICO wants), and *Download your data* / *Delete your account* as explicit
   placeholders that open a mail to the privacy contact until the real paths
   exist.
5. **No cookie banner**, by design, documented in the cookie policy. The
   contract test in `tests/legal.test.mjs` asserts the registry and files
   agree and that every placeholder document still says so.

### To do later — in this order

1. **Inputs** (Neal): the table above, plus a decision on the legal entity
   that is the data controller and the contact address for privacy requests.
2. **Write the five documents**, flip each `status` to `published` and set
   `effectiveDate`; the banners disappear and the footer shows the date.
3. **ICO**: pay the data-protection fee (or record the exemption); keep a
   one-page record of processing (purposes, data, processors, retention,
   transfers) — `docs/legal/privacy.md` §Annex is its skeleton.
4. **Processors**: sign/collect DPAs — Vercel, Neon, Upstash each publish
   one; record the transfer mechanism each relies on.
5. **Data subject rights, for real**: account deletion that cascades boards,
   keys, sessions, connections (Better Auth's `deleteUser` plus our tables);
   a data export (boards + config + queue as JSON — `export_queue` already
   exists per board). Replace the two placeholders in Account.
6. **Retention job**: boards/queues for deleted accounts; broker keys already
   expire after 30 days.
7. **Email**: the first time the app sends any email (verification, marketing)
   it needs a provider, an unsubscribe link in every marketing message, and
   the consent check before sending.
8. **Desktop**: show the EULA on first run of the kiosk; link it from the
   release notes (`.github/workflows/release.yml`).
9. **Accessibility statement** (optional for a private company, good
   practice): a short page under `/legal/accessibility` once SPEC §7 is done.
10. **If anything is ever sold**: the Consumer Contracts Regs section of the
    Terms, pricing page, order confirmation, cancellation flow.
