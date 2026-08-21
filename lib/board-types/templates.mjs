/**
 * Board templates: the cards on /new.
 *
 * A template is a board type plus a starting point - a preset config (grid,
 * theme, fallback, timezone) and a seeded queue - so a new board lands in
 * its control room with something already on the glass instead of a dark
 * rectangle and a text box. Templates are grouped into families, which are
 * the horizontal rails on the new-board screen: a person scans rows of
 * "what is this for", not a list of playback machines.
 *
 * The first family is the registry itself - every type, blank - so a new
 * board type gets a card with no change here. The rest are curated.
 *
 * Pure and client-safe (the picker imports it in the browser): only
 * lib/board-types and lib/board modules. Seeds are plain POST /message
 * bodies and go through the same validation as any API caller's, so a
 * template can never do what the API would refuse.
 */

import { BOARD_TYPES } from './index.mjs';

/** The poster line(s) a card shows, in the board's own charset (≤12 tiles a line). */

const FAMILIES = [
  {
    id: 'office',
    title: 'Around the office',
    blurb: 'Signs that run the day - a welcome, the rituals, what the build is doing.',
    templates: [
      {
        id: 'welcome',
        type: 'live',
        name: 'Welcome sign',
        defaultName: 'Reception',
        tagline: 'A standing message at the door, changed with one line.',
        poster: ['WELCOME'],
        what: [
          'One message stands on the glass until the next arrives',
          'Post a visitor’s name from your phone or a calendar agent',
          'Holds its last message when nothing is queued',
        ],
        config: {},
        seed: [{ text: 'WELCOME' }],
      },
      {
        id: 'office-clock',
        type: 'scheduled',
        name: 'Office clock',
        defaultName: 'Office',
        tagline: 'Standup, lunch, home time - called on the dot, every day.',
        poster: ['STANDUP 0930'],
        what: [
          'Daily calls at fixed times, to the second, in your timezone',
          'A fallback message stands between them',
          'Edit the times in the control room; add one-offs from an agent',
        ],
        params: { fallback: 'HAVE A GOOD ONE' },
        config: {},
        seed: [
          { text: 'STANDUP IN 5', schedule: { kind: 'daily', at: '09:25', durationMs: 5 * 60_000 } },
          { text: 'LUNCH', schedule: { kind: 'daily', at: '12:30', durationMs: 30 * 60_000 } },
          { text: 'HOME TIME', schedule: { kind: 'daily', at: '17:30', durationMs: 30 * 60_000 } },
        ],
      },
      {
        id: 'build-status',
        type: 'live',
        name: 'Build status',
        defaultName: 'CI',
        tagline: 'Your pipeline posts; the wall tells the room.',
        poster: ['BUILD 142', 'PASSING'],
        what: [
          'One curl from CI per event - green, red, deployed',
          'A deeper queue so a busy pipeline never drops an update',
          'Its own API key and agent guide, ready for a webhook',
        ],
        params: { queueCap: 12 },
        config: {},
        seed: [{ text: 'BUILD 142 PASSING' }, { text: 'DEPLOYED TO PROD' }],
      },
      {
        id: 'room',
        type: 'scheduled',
        name: 'Room sign',
        defaultName: 'Room 1',
        tagline: 'Who has the room, and when it is free.',
        poster: ['ROOM FREE'],
        what: [
          'Weekly bookings as scheduled items, by weekday and time',
          'Says ROOM FREE in the gaps',
          'A calendar agent can add and remove bookings over the API',
        ],
        params: { fallback: 'ROOM FREE' },
        config: {},
        seed: [
          { text: 'TEAM SYNC', schedule: { kind: 'weekly', dow: 1, at: '10:00', durationMs: 60 * 60_000 } },
          { text: 'DESIGN REVIEW', schedule: { kind: 'weekly', dow: 4, at: '14:00', durationMs: 60 * 60_000 } },
        ],
      },
    ],
  },
  {
    id: 'events',
    title: 'Events and match day',
    blurb: 'Boards for a crowd - a foyer, a stand, a hall full of people.',
    templates: [
      {
        id: 'match-day',
        type: 'live',
        name: 'Match day',
        defaultName: 'Carrow Road',
        tagline: 'Norwich green tiles. Score, line-ups, the chant.',
        poster: ['ON THE BALL', 'CITY'],
        what: [
          'The Canary tiles - green flaps, white glyphs',
          'Post the score as it changes; the board holds it',
          'A wide grid for team sheets',
        ],
        config: { theme: 'canary', cols: 24, rows: 8 },
        seed: [{ text: 'ON THE BALL CITY' }, { text: 'KICK OFF 1500' }],
      },
      {
        id: 'departures',
        type: 'live',
        name: 'Departures',
        defaultName: 'Departures',
        tagline: 'The original: a board of rows, laid out to the cell.',
        poster: ['DEPARTURES'],
        what: [
          'A tall grid, one row per line, set literally with rows',
          'Replace the whole board in one post, or a single row',
          'Left-aligned, like the real thing',
        ],
        config: { cols: 24, rows: 10, align: 'left' },
        seed: [
          {
            rows: [
              'DEPARTURES',
              '',
              '0915 LONDON    ON TIME',
              '0940 NORWICH   ON TIME',
              '1005 EDINBURGH DELAYED',
              '1030 CARDIFF   ON TIME',
              '1100 YORK      BOARDING',
            ],
          },
        ],
      },
      {
        id: 'conference',
        type: 'scheduled',
        name: 'Conference day',
        defaultName: 'Main hall',
        tagline: 'The running order, cut on the clock, the same on every screen.',
        poster: ['KEYNOTE', 'HALL A'],
        what: [
          'Sessions as daily items - edit the times to your programme',
          'Registration notice between sessions',
          'Open the URL on every hall screen and they agree',
        ],
        params: { fallback: 'REGISTRATION OPEN' },
        config: {},
        seed: [
          { text: 'KEYNOTE HALL A', schedule: { kind: 'daily', at: '09:00', durationMs: 60 * 60_000 } },
          { text: 'COFFEE', schedule: { kind: 'daily', at: '10:30', durationMs: 30 * 60_000 } },
          { text: 'WORKSHOPS', schedule: { kind: 'daily', at: '11:00', durationMs: 120 * 60_000 } },
          { text: 'LUNCH', schedule: { kind: 'daily', at: '13:00', durationMs: 60 * 60_000 } },
        ],
      },
    ],
  },
  {
    id: 'screens',
    title: 'Many screens',
    blurb: 'One board on every wall, every one in step - add a screen by opening the URL.',
    templates: [
      {
        id: 'break-bell',
        type: 'shared',
        name: 'Break bell',
        defaultName: 'Floor',
        tagline: 'Every screen on the floor calls the break together.',
        poster: ['BREAK IN 5'],
        what: [
          'Hourly at five to, for five minutes, on every screen at once',
          'FOCUS TIME stands between',
          'Synced on the server clock, not on who is watching',
        ],
        params: { fallback: 'FOCUS TIME' },
        config: {},
        seed: [{ text: 'BREAK IN 5', schedule: { kind: 'hourly', minute: 55, durationMs: 5 * 60_000 } }],
      },
      {
        id: 'club-wall',
        type: 'shared',
        name: 'Club wall',
        defaultName: 'Clubhouse',
        tagline: 'Green tiles in every room; kick-off called everywhere at once.',
        poster: ['KICK OFF', '1500'],
        what: [
          'The Canary tiles on every screen',
          'A weekly kick-off call; the chant in between',
          'Add a room by opening the URL there',
        ],
        params: { fallback: 'ON THE BALL CITY' },
        config: { theme: 'canary' },
        seed: [{ text: 'KICK OFF', schedule: { kind: 'weekly', dow: 6, at: '15:00', durationMs: 10 * 60_000 } }],
      },
    ],
  },
];

/** The blank card for a registered type. */
function blankTemplate(type) {
  return {
    id: `blank-${type.id}`,
    type: type.id,
    name: type.name,
    defaultName: '',
    tagline: type.tagline,
    poster: [type.sample ?? type.name],
    what: type.capabilities,
    recommended: Boolean(type.recommended),
    tier: type.tier,
    blank: true,
    params: {},
    config: {},
    seed: [],
  };
}

function normalise(template) {
  return {
    params: {},
    recommended: false,
    blank: false,
    ...template,
  };
}

/** The rails, in order: the blank types first, then the curated families. */
export const TEMPLATE_FAMILIES = Object.freeze([
  {
    id: 'start',
    title: 'Start here',
    blurb: 'Every kind of board, blank. A live queue suits most walls; pick a clock type for anything on a timetable - a live board cannot be given a schedule later.',
    templates: [...BOARD_TYPES.values()].map(blankTemplate),
  },
  ...FAMILIES.map((family) => ({ ...family, templates: family.templates.map(normalise) })),
]);

export const TEMPLATES = new Map(
  TEMPLATE_FAMILIES.flatMap((family) => family.templates.map((template) => [template.id, template])),
);

export function getTemplate(id) {
  return TEMPLATES.get(id) ?? null;
}
