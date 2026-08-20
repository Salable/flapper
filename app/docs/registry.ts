/** The documents /docs serves, in display order. Slugs are the whitelist. */
export const DOCS: { slug: string; file: string; title: string; blurb: string }[] = [
  {
    slug: 'getting-started',
    file: 'GETTING-STARTED.md',
    title: 'Getting started',
    blurb: 'Create a board, put something on it, understand keys and privacy.',
  },
  {
    slug: 'queues',
    file: 'QUEUES.md',
    title: 'Queues & board types',
    blurb: 'Live, scheduled, and shared boards: what the queue means and how each plays.',
  },
  {
    slug: 'board-types',
    file: 'BOARD-TYPES.md',
    title: 'Authoring board types',
    blurb: 'The definition contract, the harness, and a worked example — enough to build a new type.',
  },
  {
    slug: 'design-system',
    file: 'DESIGN-SYSTEM.md',
    title: 'Design system',
    blurb: 'Tokens, components, type and motion rules - the contract for anything visual.',
  },
  {
    slug: 'board-api',
    file: 'BOARD-API.md',
    title: 'Board API',
    blurb: 'The full REST contract — also served per-board with live URLs at /api/b/{slug}/AGENTS.md.',
  },
];
