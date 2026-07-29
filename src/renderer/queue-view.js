/**
 * Draws the band cards, and nothing else.
 *
 * Every decision about *what* to draw is made in `panel.mjs`, which is pure and
 * tested; this file only puts the result into nodes. It keeps a handle on each
 * node and updates it in place rather than rebuilding the list, because the
 * board settles several times a second and a rebuilt list loses focus, resets
 * scroll, and can drop a click between mousedown and mouseup.
 *
 * Messages keep their id when they cycle, which is what makes reconciling by id
 * work at all: a repeating band is the same few rows moving, not a stream of
 * new ones.
 */

/** @type {Map<string, object>} band id -> its nodes */
const cards = new Map();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Write only when it differs, so the board's page counter doesn't thrash layout. */
function setText(node, value) {
  if (node.textContent !== value) node.textContent = value;
}

function createCard(id) {
  const root = el('section', 'band');
  root.dataset.region = id;

  const head = el('div', 'band-head');
  const name = el('button', 'band-name');
  name.type = 'button';
  name.dataset.action = 'target';
  const rows = el('span', 'band-rows muted');
  const now = el('span', 'band-now');
  const count = el('span', 'band-count muted');

  const actions = el('div', 'band-actions');
  const flush = el('button', null, 'Flush');
  flush.type = 'button';
  flush.dataset.action = 'flush';
  flush.title = 'Drop what is waiting. Whatever is showing keeps playing.';
  const clear = el('button', null, 'Clear');
  clear.type = 'button';
  clear.dataset.action = 'clear';
  clear.title = 'Stop this band and blank it. This is what stops a repeating message.';
  actions.append(flush, clear);

  head.append(name, rows, now, count, actions);

  const list = el('ol', 'band-queue');
  root.append(head, list);

  const card = { root, name, rows, now, count, list, items: new Map() };
  cards.set(id, card);
  return card;
}

function createItem(row) {
  const li = el('li');
  li.dataset.id = row.id;
  li.append(el('span', 'qtext'), el('span', 'qmeta muted'));
  return li;
}

function updateItem(li, row) {
  setText(li.querySelector('.qtext'), row.label);
  setText(li.querySelector('.qmeta'), row.meta.join(' · '));
}

/**
 * Bring the cards in line with the view models.
 * @param {HTMLElement} container
 * @param {Array<object>} views from `bandViews()`
 * @param {{target: string, multiBand: boolean}} options
 */
export function renderQueues(container, views, { target, multiBand }) {
  const seen = new Set();

  for (const view of views) {
    seen.add(view.id);
    const card = cards.get(view.id) ?? createCard(view.id);

    setText(card.name, view.name);
    setText(card.rows, `${view.height} ${view.height === 1 ? 'row' : 'rows'}`);
    setText(card.now, view.summary);
    setText(card.count, view.queued > 0 ? `+${view.queued}` : '');
    card.now.classList.toggle('is-held', view.state === 'held');
    card.root.classList.toggle('is-target', multiBand && view.id === target);
    card.root.classList.toggle('is-animating', view.animating);
    // With one band there is nothing to pick between, so the name is a label.
    card.name.disabled = !multiBand;

    // Only rebuild the list when the list itself changed; a page turn leaves
    // this untouched and costs a string compare.
    if (card.signature !== view.signature) {
      card.signature = view.signature;
      const kept = new Set();
      for (const row of view.items) {
        kept.add(row.id);
        const li = card.items.get(row.id) ?? createItem(row);
        card.items.set(row.id, li);
        updateItem(li, row);
        // Appending a node that is already a child moves it, so ordering falls
        // out of this without any node being recreated.
        card.list.appendChild(li);
      }
      for (const [id, li] of card.items) {
        if (kept.has(id)) continue;
        li.remove();
        card.items.delete(id);
      }
    }

    container.appendChild(card.root);
  }

  for (const [id, card] of cards) {
    if (seen.has(id)) continue;
    card.root.remove();
    cards.delete(id);
  }
}

/** Forget every card. Only needed if the container is ever replaced. */
export function resetQueues() {
  cards.clear();
}
