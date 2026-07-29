import { Flipboard, DEFAULTS } from './flipboard.js';
import { Controller, CONTROLLER_DEFAULTS, MAIN, FOOTER } from './controller.mjs';
import { bandViews, describeDiagnostics, resolvePanelRegion } from './panel.mjs';
import { renderQueues } from './queue-view.js';

const ASSETS = '/assets';
// Bump when a default changes that a stored value would otherwise shadow.
const SETTINGS_KEY = 'flapper.settings.v1';

const el = (id) => document.getElementById(id);

/** Vertical padding on #controls, which the inner wrapper does not include. */
const PANEL_PADDING = 30;

const ui = {
  board: el('board'),
  loading: el('loading'),
  loadingFill: el('loading-fill'),
  failure: el('failure'),
  hint: el('hint'),
  controls: el('controls'),
  controlsBody: el('controls-body'),
  text: el('text'),
  send: el('send'),
  composeMore: el('compose-more'),
  composeOptions: el('compose-options'),
  msgPriority: el('msg-priority'),
  msgDwell: el('msg-dwell'),
  msgRepeat: el('msg-repeat'),
  msgReset: el('msg-reset'),
  regionPicker: el('region-picker'),
  queues: el('queues'),
  addFooter: el('add-footer'),
  savedAdd: el('saved-add'),
  panelBoard: el('panel-board'),
  panelMotion: el('panel-motion'),
  panelSaved: el('panel-saved'),
  playlist: el('playlist'),
  dwell: el('dwell'),
  dwellValue: el('dwell-value'),
  align: el('align'),
  fast: el('fast'),
  fastValue: el('fast-value'),
  land: el('land'),
  landValue: el('land-value'),
  sweep: el('sweep'),
  sweepValue: el('sweep-value'),
  staggerMode: el('stagger-mode'),
  valign: el('valign'),
  wrap: el('wrap'),
  footerRowsLabel: el('footer-rows-label'),
  server: el('server'),
  publicToggle: el('public-toggle'),
  accessDetail: el('access-detail'),
  cols: el('cols'),
  colsValue: el('cols-value'),
  rows: el('rows'),
  rowsValue: el('rows-value'),
  footerRows: el('footer-rows'),
  footerRowsValue: el('footer-rows-value'),
  always: el('always'),
  status: el('status'),
};

const settings = {
  cols: DEFAULTS.cols,
  rows: DEFAULTS.rows,
  footerRows: DEFAULTS.footerRows,
  align: DEFAULTS.align,
  valign: DEFAULTS.valign,
  fastStepMs: DEFAULTS.fastStepMs,
  landStepMs: DEFAULTS.landStepMs,
  sweepMs: DEFAULTS.sweepMs,
  staggerMode: DEFAULTS.staggerMode,
  alwaysFlip: DEFAULTS.alwaysFlip,
  dwellMs: CONTROLLER_DEFAULTS.dwellMs,
  playlist: 'FLAPPER\nHELLO\nDEPARTURES\nNOW BOARDING',
  ...loadSettings(),
};

let board = null;
let controller = null;

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* not worth surfacing */
  }
}

async function loadStrips(manifest) {
  const strips = new Array(manifest.cycle.length);
  let done = 0;
  await Promise.all(
    manifest.cycle.map(async (state, i) => {
      const response = await fetch(`${ASSETS}/${state.strip}`);
      if (!response.ok) throw new Error(`${state.strip}: HTTP ${response.status}`);
      strips[i] = await createImageBitmap(await response.blob());
      done += 1;
      ui.loadingFill.style.width = `${(done / manifest.cycle.length) * 100}%`;
    }),
  );
  return strips;
}

function status(message) {
  ui.status.textContent = message;
}

/* ---- composing ---- */

/** Which band the composer is aimed at. Always a band that exists. */
let target = MAIN;

/** Per-message options, as `enqueue` wants them. Defaults are left out. */
function composeOptions() {
  const options = { region: target };
  if (ui.msgPriority.value !== 'normal') options.priority = ui.msgPriority.value;
  if (ui.msgDwell.value !== '') options.dwellMs = Number(ui.msgDwell.value);
  if (ui.msgRepeat.checked) options.repeat = true;
  return options;
}

/** Whether anything is set that the user cannot see at a glance. */
function optionsDirty() {
  return (
    ui.msgPriority.value !== 'normal' || ui.msgDwell.value !== '' || ui.msgRepeat.checked
  );
}

function resetOptions() {
  ui.msgPriority.value = 'normal';
  ui.msgDwell.value = '';
  ui.msgRepeat.checked = false;
  syncOptions();
}

/**
 * Reveal the options whenever any is non-default, so a priority left on "play
 * now" cannot sit there invisibly changing what every message does.
 */
function syncOptions(force) {
  const open = force ?? (optionsDirty() || ui.composeMore.getAttribute('aria-expanded') === 'true');
  ui.composeOptions.hidden = !open;
  ui.composeMore.setAttribute('aria-expanded', String(open));
  ui.composeMore.classList.toggle('is-on', optionsDirty());
  syncReserve();
}

function sendComposed() {
  const text = ui.text.value;
  if (text.trim() === '') return;
  show(text, composeOptions());
  ui.text.value = '';
}

function addSavedLines() {
  const entries = settings.playlist
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== '');
  if (entries.length === 0) {
    status('No saved lines to add.');
    return;
  }
  // Repeating, so they cycle in the band rather than playing once and stopping.
  // A band's Clear is what stops them again.
  for (const entry of entries) {
    try {
      controller.enqueue(entry, { source: 'ui', region: target, repeat: true });
    } catch (error) {
      status(error.message);
      return;
    }
  }
  status(`Added ${entries.length} to ${target}.`);
}

/* ---- board ---- */

/** Everything the UI shows goes through the same queue as the API. */
function show(text, options = {}) {
  try {
    const result = controller.enqueue(text, { source: 'ui', ...options });
    status(describeDiagnostics(result.diagnostics));
  } catch (error) {
    status(error.message);
  }
}

/* ---- rendering the panel ---- */

let pendingState = null;
let pendingFrame = false;

/**
 * The board settles several times a second in every band, and each of those is
 * a state change. Render at most once a frame and drop the intermediates - the
 * panel only has to keep up with the eye.
 */
function scheduleRender(state) {
  pendingState = state;
  // Nothing to draw while the panel is closed, which is how a wall board spends
  // nearly all of its time. It is redrawn in full when it opens.
  if (ui.controls.hidden || pendingFrame) return;
  pendingFrame = true;
  requestAnimationFrame(() => {
    pendingFrame = false;
    renderPanel(pendingState);
  });
}

function renderPanel(state) {
  if (!state) return;
  const views = bandViews(state);
  const ids = views.map((view) => view.id);
  const multiBand = views.length > 1;

  target = resolvePanelRegion(target, ids);
  renderQueues(ui.queues, views, { target, multiBand });
  syncBandChrome(state, views, multiBand);
}

/** Everything in the panel that depends on how many bands there are. */
function syncBandChrome(state, views, multiBand) {
  // With one band there is nothing to choose between, so the picker does not
  // exist rather than showing a single pointless option.
  const pickerChanged = ui.regionPicker.hidden === multiBand;
  ui.regionPicker.hidden = !multiBand;
  if (multiBand) {
    const wanted = views.map((view) => view.id).join(',');
    if (ui.regionPicker.dataset.bands !== wanted) {
      ui.regionPicker.dataset.bands = wanted;
      ui.regionPicker.replaceChildren(
        ...views.map((view) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'chip';
          chip.dataset.region = view.id;
          chip.textContent = view.name;
          return chip;
        }),
      );
    }
    for (const chip of ui.regionPicker.children) {
      chip.classList.toggle('is-on', chip.dataset.region === target);
    }
  }

  // The only hint in the panel that a board can be split at all.
  const addChanged = ui.addFooter.hidden === !multiBand;
  ui.addFooter.hidden = multiBand;

  ui.text.placeholder = multiBand
    ? `Add to ${target} — Enter to send`
    : 'Type a word and press Enter';
  ui.savedAdd.textContent = multiBand ? `Add all to ${target}` : 'Add all';

  // The board clamps a footer to leave the main band a row, so the slider must
  // not offer positions the board will refuse.
  ui.footerRows.max = String(controller.capabilities().maxFooterRows);
  ui.footerRowsLabel.title =
    'Bottom rows driven by their own queue. 0 turns the footer off. ' +
    `The main band has ${state.grid.mainRows} rows.`;

  if (pickerChanged || addChanged) syncReserve();
}

/* ---- controls wiring ---- */

function bindRange(input, label, key, format, apply) {
  input.value = settings[key];
  label.textContent = format(settings[key]);
  input.addEventListener('input', () => {
    const value = Number(input.value);
    settings[key] = value;
    label.textContent = format(value);
    apply(value);
    saveSettings();
  });
}

function wireControls() {
  ui.text.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') sendComposed();
  });
  ui.send.addEventListener('click', sendComposed);

  ui.composeMore.addEventListener('click', () => {
    syncOptions(ui.composeOptions.hidden);
  });
  ui.msgReset.addEventListener('click', resetOptions);
  for (const element of [ui.msgPriority, ui.msgDwell, ui.msgRepeat]) {
    element.addEventListener('change', () => syncOptions(true));
  }

  // Both the chips and a band card's name aim the composer, so you can pick a
  // band from either end.
  ui.regionPicker.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-region]');
    if (!chip) return;
    target = chip.dataset.region;
    renderPanel(controller.status());
  });

  ui.queues.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const region = button.closest('[data-region]')?.dataset.region;
    if (!region) return;
    if (button.dataset.action === 'target') target = region;
    if (button.dataset.action === 'flush') {
      const removed = controller.flush(region);
      status(removed ? `Dropped ${removed} waiting in ${region}.` : `Nothing waiting in ${region}.`);
    }
    if (button.dataset.action === 'clear') {
      controller.clear(region);
      status(`Cleared ${region}.`);
    }
    renderPanel(controller.status());
  });

  ui.addFooter.addEventListener('click', () => {
    applyConfigure({ footerRows: 2 });
    renderPanel(controller.status());
  });

  ui.playlist.value = settings.playlist;
  ui.playlist.addEventListener('input', () => {
    settings.playlist = ui.playlist.value;
    saveSettings();
  });
  ui.savedAdd.addEventListener('click', addSavedLines);

  for (const element of [ui.panelBoard, ui.panelMotion, ui.panelSaved]) {
    element?.addEventListener('toggle', syncReserve);
  }

  for (const [element, key] of [
    [ui.align, 'align'],
    [ui.valign, 'valign'],
    [ui.wrap, 'wrap'],
    [ui.staggerMode, 'staggerMode'],
  ]) {
    element.value = settings[key];
    element.addEventListener('change', () => {
      settings[key] = element.value;
      controller.configure({ [key]: element.value });
      saveSettings();
    });
  }

  ui.always.checked = settings.alwaysFlip;
  ui.always.addEventListener('change', () => {
    settings.alwaysFlip = ui.always.checked;
    controller.configure({ alwaysFlip: settings.alwaysFlip });
    saveSettings();
  });

  const ms = (value) => `${value}ms`;
  // Through applyConfigure rather than straight to the controller, so a value
  // the board clamps - a footer taller than the grid allows - snaps the slider
  // back to what actually happened instead of leaving it lying.
  const configure = (key) => (value) => applyConfigure({ [key]: value });
  bindRange(ui.dwell, ui.dwellValue, 'dwellMs', ms, configure('dwellMs'));
  bindRange(ui.fast, ui.fastValue, 'fastStepMs', ms, configure('fastStepMs'));
  bindRange(ui.land, ui.landValue, 'landStepMs', ms, configure('landStepMs'));
  bindRange(ui.sweep, ui.sweepValue, 'sweepMs', ms, configure('sweepMs'));
  bindRange(ui.cols, ui.colsValue, 'cols', String, configure('cols'));
  bindRange(ui.rows, ui.rowsValue, 'rows', String, configure('rows'));
  bindRange(ui.footerRows, ui.footerRowsValue, 'footerRows', String, configure('footerRows'));
}

/**
 * Grow the window by the panel's height so the board keeps its size.
 *
 * Measured from the inner wrapper, not `#controls`: that is capped at 70% of
 * the window, so measuring it would feed its own growth back into itself. The
 * wrapper's height is what the content wants, regardless of the window.
 */
function syncReserve() {
  const open = !ui.controls.hidden;
  window.flapper?.reserveHeight(open ? ui.controlsBody.offsetHeight + PANEL_PADDING : 0);
}

function toggleControls(force) {
  const open = force ?? ui.controls.hidden;
  ui.controls.hidden = !open;
  ui.hint.classList.toggle('visible', !open);
  if (open) ui.text.focus();
  else ui.text.blur();
  syncReserve();
  // Nothing is drawn while it is closed, so it needs a full pass on the way in.
  if (open && controller) renderPanel(controller.status());
}

function isTyping() {
  const node = document.activeElement;
  if (!node) return false;
  // SELECT included: a focused dropdown swallows the shortcut keys otherwise,
  // and space over one both opens it and fires the panel's space binding.
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
}

function wireKeys() {
  window.addEventListener('keydown', (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (event.key === 'Escape') {
      event.preventDefault();
      // The panic key: every band, blank. Each band's own Clear is the
      // considered version.
      controller.clear();
      status('Cleared every band.');
      return;
    }

    if (isTyping()) return;

    switch (event.key.toLowerCase()) {
      case 'c':
        event.preventDefault();
        toggleControls();
        break;
      case 'f':
        event.preventDefault();
        window.flapper?.toggleFullscreen();
        break;
      case ' ':
        event.preventDefault();
        addSavedLines();
        break;
      case 'enter':
        event.preventDefault();
        toggleControls(true);
        break;
      default:
        break;
    }
  });
}

/**
 * devicePixelRatio changes when the window moves to a display with a different
 * scale factor, without the CSS size changing. The media query only matches the
 * ratio it was built for, so re-arm it after each change.
 */
function watchPixelRatio(onChange) {
  const attach = () => {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        onChange();
        attach();
      },
      { once: true },
    );
  };
  attach();
}

/** Apply an API config patch and mirror it into the local UI + settings. */
function applyConfigure(patch) {
  const state = controller.configure(patch);
  // Before the mirroring below, not after: assigning a value against a stale
  // `max` lets the browser clamp it, and the slider would then disagree with
  // the board in the one case this mirroring exists to fix.
  ui.footerRows.max = String(controller.capabilities().maxFooterRows);
  for (const [key, element, label] of [
    ['cols', ui.cols, ui.colsValue],
    ['rows', ui.rows, ui.rowsValue],
    // Mirrors the effective height, so a footer clamped against a short board
    // snaps the slider back to what the board actually did.
    ['footerRows', ui.footerRows, ui.footerRowsValue],
    ['fastStepMs', ui.fast, ui.fastValue],
    ['landStepMs', ui.land, ui.landValue],
    ['sweepMs', ui.sweep, ui.sweepValue],
    ['dwellMs', ui.dwell, ui.dwellValue],
  ]) {
    const value = key === 'dwellMs' ? state.dwellMs : (state.grid[key] ?? state.motion[key]);
    if (value === undefined) continue;
    settings[key] = value;
    element.value = value;
    label.textContent = key.endsWith('Ms') ? `${value}ms` : String(value);
  }
  for (const [key, element] of [
    ['align', ui.align],
    ['valign', ui.valign],
    ['wrap', ui.wrap],
    ['staggerMode', ui.staggerMode],
  ]) {
    const value = state.grid[key] ?? state.motion[key];
    if (value === undefined) continue;
    settings[key] = value;
    element.value = value;
  }
  saveSettings();
  // A geometry change can add or remove a band, so the cards and the picker
  // have to follow it.
  renderPanel(state);
  return state;
}

/* ---- network access ---- */

let access = null;

/** Reflect the main process's view of the server into the panel. */
function renderAccess(info) {
  access = info;
  if (!info) {
    ui.server.textContent = '';
    return;
  }

  const isPublic = Boolean(info.isPublic);
  ui.publicToggle.textContent = isPublic ? 'Public' : 'Local only';
  ui.publicToggle.classList.toggle('is-public', isPublic);
  ui.publicToggle.disabled = Boolean(info.locked);
  ui.publicToggle.title = info.locked
    ? 'Host was set at launch, so this cannot be changed from here'
    : isPublic
      ? 'Anyone on this network can control the board. Click to restrict it.'
      : 'Only reachable from this machine. Click to allow other machines.';

  if (info.error) {
    ui.accessDetail.textContent = info.error;
  } else if (!info.enabled) {
    ui.accessDetail.textContent = 'API disabled';
  } else if (isPublic) {
    // Show an address someone can actually type, not the 0.0.0.0 we bind.
    const reachable = info.addresses?.[0] || info.url;
    ui.accessDetail.textContent =
      `${reachable} — anyone on this network can control the board`;
  } else {
    ui.accessDetail.textContent = `${info.url} — this machine only`;
  }

  ui.server.textContent = info.enabled
    ? `API ${isPublic ? `${info.addresses?.[0] || info.url} (public)` : info.url}`
    : 'API off';
}

async function refreshAccess() {
  try {
    renderAccess(await window.flapper?.serverInfo?.());
  } catch {
    // The board is useful without the control API; a missing or failed handler
    // must not take the renderer down.
    ui.server.textContent = '';
  }
}

function wireAccess() {
  ui.publicToggle.addEventListener('click', async () => {
    const goingPublic = !access?.isPublic;
    ui.publicToggle.disabled = true;
    ui.accessDetail.textContent = goingPublic ? 'Opening to the network…' : 'Restricting…';
    try {
      const info = await window.flapper?.setPublic?.(goingPublic);
      renderAccess(info);
      if (info?.rejected) status(`Cannot change access: ${info.rejected}.`);
    } catch (error) {
      status(`Could not change access: ${error.message}`);
      await refreshAccess();
    }
  });

}

function flashHint() {
  ui.hint.classList.add('visible');
  setTimeout(() => {
    if (ui.controls.hidden) ui.hint.classList.remove('visible');
  }, 3200);
}

async function main() {
  let manifest;
  let strips;
  try {
    const response = await fetch(`${ASSETS}/manifest.json`);
    if (!response.ok) throw new Error(`manifest.json: HTTP ${response.status}`);
    manifest = await response.json();
    strips = await loadStrips(manifest);
  } catch (error) {
    console.error(`flapper: tile art failed to load — ${error.message}`);
    ui.loading.hidden = true;
    ui.failure.hidden = false;
    ui.failure.textContent = `Could not load tile art: ${error.message}. Run "npm run build:assets" to generate it from the source GIFs.`;
    return;
  }
  console.info(
    `flapper: loaded ${strips.length} strips, ${manifest.tileSize}px tiles, ` +
      `${manifest.framesPerStrip} frames each`,
  );

  board = new Flipboard(ui.board, manifest, strips, {
    cols: settings.cols,
    rows: settings.rows,
    footerRows: settings.footerRows,
    align: settings.align,
    valign: settings.valign,
    wrap: settings.wrap,
    fastStepMs: settings.fastStepMs,
    landStepMs: settings.landStepMs,
    sweepMs: settings.sweepMs,
    staggerMode: settings.staggerMode,
    alwaysFlip: settings.alwaysFlip,
  });
  controller = new Controller(board, { dwellMs: settings.dwellMs });
  controller.onChange = (state) => {
    // Pushed on every change, uncoalesced: an SSE client asked for every state,
    // and only the panel's drawing needs rationing.
    window.flapper?.publishState(state);
    scheduleRender(state);
  };

  // Reachable from the devtools console for tuning an installation live.
  // (Not `window.board` — that name is taken by the canvas element's id.)
  window.flipboard = board;
  window.controller = controller;

  // The main process forwards REST requests here as named method calls.
  function dispatch(method, params) {
    switch (method) {
      case 'enqueue':
        return controller.enqueue(params.text, params.options);
      case 'preview':
        return controller.preview(params.text, params.options);
      case 'status':
        return controller.status();
      case 'capabilities':
        return controller.capabilities();
      case 'flush':
        return controller.flush(params.region);
      case 'clear':
        return controller.clear(params.region);
      case 'configure':
        return applyConfigure(params);
      default: {
        const error = new Error(`unknown method: ${method}`);
        error.status = 400;
        throw error;
      }
    }
  }

  // Failures are returned rather than thrown: an Error loses its `status` on the
  // way across the contextBridge, which would turn every 422 and 429 into a 500.
  window.flapper?.onCall((method, params = {}) => {
    try {
      return { ok: true, value: dispatch(method, params) };
    } catch (error) {
      return {
        ok: false,
        error: { message: String(error?.message || error), status: error?.status || 500 },
      };
    }
  });

  ui.loading.hidden = true;
  wireControls();
  wireKeys();
  wireAccess();
  refreshAccess();

  new ResizeObserver(() => board.resize()).observe(ui.board);
  watchPixelRatio(() => board.resize());

  flashHint();
  // Reconcile the panel with what the board did with the stored settings - a
  // footer height saved against a taller board is clamped here rather than
  // sitting wrong until something touches the API.
  applyConfigure({});
  syncOptions(false);
  new ResizeObserver(syncReserve).observe(ui.controlsBody);
  // Start from a blank board, then flip in so the first thing you see is the
  // effect. Skipped if anything has already driven the board by then.
  setTimeout(() => {
    if (!controller.current && controller.queue.length === 0) show('FLAPPER');
  }, 500);
}

main();
