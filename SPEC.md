# Flapper — Specification

*Working spec for the next iteration. The executed 3.0/W4 program plan this
replaces lives in git history (`git show ee7741c:SPEC.md`); the accepted
scheduling design is `docs/rfcs/0002-scheduling.md`; the 2.0 screen baseline
is `docs/SCREENS.md`.*

## Where the product stands (shipped, production)

- **Accounts & offerings**: email/password sign-in; Standard (3 boards,
  live queues) ⇄ Plus (unlimited, time-based + shared queues), toggled free
  from the dashboard; downgrade pauses, never deletes.
- **Boards** at `/b/{slug}`: passive displays (only `F` and `Esc`), server
  config as the single source of truth, private boards via key or login,
  one API key each, per-board agent guide at `/api/b/{slug}/AGENTS.md`.
- **Queues**: durable, server-side, per-queue mode toggle — **live**
  (display-driven, holds its last page when drained) or **timed** (Plus:
  compiled cycle, clock-driven, multiple boards in lockstep, one-shots
  splice once). Editable in Settings (compose, reorder, loop, edit, remove)
  and over the REST API.
- **Surfaces**: dashboard with live cards, Settings as the control room,
  `/docs`, desktop kiosk shell. Bands (footers) deferred.

---

## Next iteration — Neal's asks

*Conventions for this round: anything REMOVED gets its source preserved
(moved to `attic/` in the repo, not just git history) and a short note in
`docs/attic/README.md` recording what it was, why it left, and what would
bring it back. Additions and modifications land through the usual
research-where-hard → implement → verify loop.*

### Removals
<!-- Components/screens/behaviours to take out. For each, a line on why, and
     anything about it worth keeping (patterns, copy, contract). -->

1. Remove the time-based board. In fact, we will move to a model where a pro or a standard user can simply create pro or standard boards. The board type becomes the basic structure for 'value', each having their own approach to delivering a flapperboard, and exposing capabilities like queues, API/MCP integrations, the ability to have multiple 'sections' on a board that you can control independantly, etc. 

Remove the pro/standard switch right now, by deafult we will expose all the tiers of board types, later we can restrict using salable (salable.app)

### Additions
<!-- New capabilities. As rough or precise as you like - questions welcome. -->

1. Add a design system that incorporates the 'flapper' aesthetic, color, movement, and font/brand. Incorporate this into our general layout for each avaialble screen. Provide instructions to incorporate this design system into future components or boards that people add. 

create a live queue board type, which simply has a queue of 5 items, and plays them immediately with the appropriate delay applied. 
Create a scheduled board type, which allows a user to input in a time-specific format, points along a 'clock' (this can get down to seconds, so its responsive), but it allows you to schedule board positions throughout a period of time. We should provide tools to make it easy to use "cron-like time" where we can set a daily/weekly/hourly/every 15 min/15 on the hour - as well as 'in a 7 second interval. 
Create a shared board type, which subsumes the logic of the scheduled type, and adds on the ability / instruction to easily connect multiple instantiations of the same board loaded on different "screens" - this lets a common board slug drive multiple screens at once, and does so on the system clock (or whatever is available to us). This is currently a broken feature, asking for multiple boards to sync together (not the plan). 
A "display" interface which allows a user to easily set, with a visual custom picker that looks like a small copy of the window, which allows a user to drag/scale a board size. For advanced boards, some will allow for multiple sections, which we will need to build as a second component. 

### Modifications
<!-- Existing things that should behave or look different. "As a user, when
     I X, it should Y" works great here. -->

1. Our create board experience should go from one of a simple button click to a window of 'types' of boards, each upon selection with their own params (including name etc.), this is the model we want to go to. 
Clicking on a created board (from our dashboard) - shoudl open the 'settings' view, not the 'live' view of a board
The settings screen should split it's contents into tabs. One is Queue, which allows a user to easily manipulate the queued items (and modify them), Display (see new additions), and General settings that swallow the rest. 
For every recommended change, and the existing infrastructure that is utilized in our setup - i want to move to a component-first model for design, and for general functinoality. Ideally we will be able to import common user elements that attach to a working view/screen/board experience. 
Each of the recommended board types should be built from these common set of components. 
Provide exstensive documentation on how we expand this component library and how they can be used throughout our application. 


### Open questions / decisions you want options on
<!-- Anything where you want me to research and bring back recommendations
     rather than just build. -->

1. What does it take to meet my requirements, and in your handoff, allow me to build a new board type, using agentic coding tools, which loads in our application? 
2. What do you need me to provide in terms of context in order to meet this SPEC? 
3. How will you be certain that you will properly remove all unneeded/redundant code once we clean up our general interface and componentize the necessary components to build our requested board types? 
