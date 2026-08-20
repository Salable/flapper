/**
 * The live queue: the simplest board. A rolling list - the display plays it
 * top to bottom, loop items return to the back, and when the queue is full
 * the oldest waiting message falls off to make room (a ticker, not a form).
 */

export default {
  id: 'live',
  name: 'Live queue',
  tagline: 'A rolling queue that plays as it arrives.',
  description:
    'Messages play in order the moment a display is watching. The queue holds ' +
    'a handful of messages; adding one past the cap rolls the oldest waiting ' +
    'message off. Loop items cycle until removed. The board holds its last ' +
    'message when the queue drains - one message makes a standing sign.',
  capabilities: ['queue', 'loop', 'api'],
  configVersion: 1,
  migrateConfig(config) {
    return config;
  },
  createParams: [
    { key: 'name', kind: 'text', label: 'Board name', maxLength: 80, default: '' },
    {
      key: 'queueCap',
      kind: 'number',
      label: 'Queue size',
      min: 1,
      max: 50,
      integer: true,
      default: 5,
    },
  ],
  itemParams: [],
  queuePolicy: {
    cap: (config) => config.queueCap ?? 5,
    onFull: 'roll',
    /** Pending = waiting behind the current message; what flush drops. */
    isPending: (item, { currentItemId }) => item.id !== currentItemId,
  },
  playback: 'live',
  /** now/next/normal keep their 1.x meanings on a live board. */
  ingest(priority, entry) {
    return { entry, placement: priority === 'now' || priority === 'next' ? priority : 'append' };
  },
};
