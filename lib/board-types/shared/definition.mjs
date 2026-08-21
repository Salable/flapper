/**
 * The shared board: a scheduled board whose point is many screens. One slug,
 * opened on any number of displays, all in step - which the scheduled
 * machinery already guarantees, because playback is a pure function of the
 * server clock and every screen evaluates it. This type composes that
 * machinery verbatim and adds the multi-screen framing: the create flow and
 * settings surface screens, and the promise is stated instead of implied.
 *
 * (The old "attach several boards to one queue" feature is in attic/ - this
 * is its replacement: same slug everywhere, nothing to attach.)
 */

import scheduled from '../scheduled/definition.mjs';

export default {
  ...scheduled,
  id: 'shared',
  name: 'Shared screens',
  tagline: 'One schedule, every screen in step.',
  description:
    'A scheduled board built for many screens: open the same board URL on ' +
    'every display and they all show the same thing at the same moment, ' +
    'synced on the server clock. Schedules, the fallback message, and the ' +
    'API are identical to a scheduled board - the difference is the promise: ' +
    'add screens by opening the URL, never by configuring anything.',
  capabilities: ['Every screen in step', 'Runs on the clock', 'Add screens by opening the URL'],
  sample: 'EVERY SCREEN',
};
