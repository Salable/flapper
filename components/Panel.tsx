'use client';

/**
 * The control panel. Markup mirrors the desktop app's panel; every decision
 * about what to show still lives in lib/board/panel.mjs, and the band cards are
 * still drawn by queue-view.js (imperative on purpose - it reconciles by
 * message id so a settling board doesn't eat clicks or reset scroll).
 */

import { useEffect, useRef, useState } from 'react';
import { bandViews } from '@/lib/board/panel.mjs';
import { renderQueues } from '@/lib/board/queue-view.js';
import { AccessPanel } from './AccessPanel';

type Settings = {
  cols: number;
  rows: number;
  footerRows: number;
  align: string;
  valign: string;
  wrap: string;
  fastStepMs: number;
  landStepMs: number;
  sweepMs: number;
  staggerMode: string;
  alwaysFlip: boolean;
  dwellMs: number;
  playlist: string;
};

type PanelProps = {
  slug: string;
  isOwner: boolean;
  settings: Settings;
  boardState: any;
  target: string;
  statusMsg: string;
  maxFooterRows: number;
  onPatch: (patch: object) => void;
  onSetSetting: (key: string, value: unknown) => void;
  onSend: (text: string, options: object) => void;
  onAddSaved: () => void;
  onTarget: (region: string) => void;
  onFlush: (region: string) => void;
  onClear: (region: string) => void;
};

const ms = (value: number) => `${value}ms`;

export function Panel({
  slug,
  isOwner,
  settings,
  boardState,
  target,
  statusMsg,
  maxFooterRows,
  onPatch,
  onSetSetting,
  onSend,
  onAddSaved,
  onTarget,
  onFlush,
  onClear,
}: PanelProps) {
  const queuesRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState('');
  const [priority, setPriority] = useState('normal');
  const [msgDwell, setMsgDwell] = useState('');
  const [repeat, setRepeat] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const views = boardState ? bandViews(boardState) : [];
  const multiBand = views.length > 1;
  // Reveal the options whenever any is non-default, so a priority left on
  // "play now" cannot sit there invisibly changing what every message does.
  const optionsDirty = priority !== 'normal' || msgDwell !== '' || repeat;
  const showOptions = optionsOpen || optionsDirty;

  useEffect(() => {
    if (queuesRef.current && boardState) {
      renderQueues(queuesRef.current, bandViews(boardState), { target, multiBand });
    }
  }, [boardState, target, multiBand]);

  function composeOptions() {
    const options: Record<string, unknown> = { region: target };
    if (priority !== 'normal') options.priority = priority;
    if (msgDwell !== '') options.dwellMs = Number(msgDwell);
    if (repeat) options.repeat = true;
    return options;
  }

  function sendComposed() {
    if (text.trim() === '') return;
    onSend(text, composeOptions());
    setText('');
  }

  function onQueuesClick(event: React.MouseEvent<HTMLDivElement>) {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!button) return;
    const region = button.closest<HTMLElement>('[data-region]')?.dataset.region;
    if (!region) return;
    if (button.dataset.action === 'target') onTarget(region);
    if (button.dataset.action === 'flush') onFlush(region);
    if (button.dataset.action === 'clear') onClear(region);
  }

  const range = (
    id: string,
    labelText: string,
    key: keyof Settings,
    min: number,
    max: number,
    step: number,
    format: (value: number) => string,
  ) => (
    <div className="field">
      <label htmlFor={id}>
        {labelText} <span className="muted">{format(settings[key] as number)}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={settings[key] as number}
        onChange={(event) => onPatch({ [key]: Number(event.target.value) })}
      />
    </div>
  );

  const select = (id: string, labelText: string, key: keyof Settings, options: [string, string][]) => (
    <div className="field">
      <label htmlFor={id}>{labelText}</label>
      <select
        id={id}
        value={settings[key] as string}
        onChange={(event) => onPatch({ [key]: event.target.value })}
      >
        {options.map(([value, name]) => (
          <option key={value} value={value}>
            {name}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <section id="controls" aria-label="Board controls">
      <div id="controls-body">
        {/* Compose: pick a band, type, add it to that band's queue. */}
        <div className="row compose">
          {multiBand && (
            <div id="region-picker" className="segmented" role="group" aria-label="Target band">
              {views.map((view: any) => (
                <button
                  key={view.id}
                  type="button"
                  className={`chip${view.id === target ? ' is-on' : ''}`}
                  onClick={() => onTarget(view.id)}
                >
                  {view.name}
                </button>
              ))}
            </div>
          )}
          <input
            id="text"
            type="text"
            placeholder={multiBand ? `Add to ${target} — Enter to send` : 'Type a word and press Enter'}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') sendComposed();
            }}
          />
          <button id="send" className="primary" onClick={sendComposed}>
            Add
          </button>
          <button
            id="compose-more"
            aria-expanded={showOptions}
            className={optionsDirty ? 'is-on' : ''}
            title="Message options"
            onClick={() => setOptionsOpen(!showOptions)}
          >
            •••
          </button>
        </div>

        {showOptions && (
          <div className="row options" id="compose-options">
            <div className="field">
              <label htmlFor="msg-priority">Priority</label>
              <select id="msg-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="normal">Queue it</option>
                <option value="next">Play next</option>
                <option value="now">Play now</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="msg-dwell">Hold</label>
              <select id="msg-dwell" value={msgDwell} onChange={(e) => setMsgDwell(e.target.value)}>
                <option value="">Band default</option>
                <option value="1000">1s</option>
                <option value="2000">2s</option>
                <option value="5000">5s</option>
                <option value="10000">10s</option>
                <option value="30000">30s</option>
              </select>
            </div>
            <div className="field checkbox">
              <label htmlFor="msg-repeat">
                <input
                  id="msg-repeat"
                  type="checkbox"
                  checked={repeat}
                  onChange={(e) => setRepeat(e.target.checked)}
                />{' '}
                Repeat
              </label>
            </div>
            <button
              id="msg-reset"
              onClick={() => {
                setPriority('normal');
                setMsgDwell('');
                setRepeat(false);
                setOptionsOpen(false);
              }}
            >
              Reset
            </button>
          </div>
        )}

        {/* One card per band, drawn by queue-view.js */}
        <div id="queues" ref={queuesRef} onClick={onQueuesClick} />
        {!multiBand && (
          <button id="add-footer" className="ghost" onClick={() => onPatch({ footerRows: 2 })}>
            + Add a footer band
          </button>
        )}

        <details id="panel-board" className="section">
          <summary>Board</summary>
          <div className="row grid">
            {range('cols', 'Columns', 'cols', 1, 80, 1, String)}
            {range('rows', 'Board rows', 'rows', 1, 40, 1, String)}
            <div className="field">
              <label
                id="footer-rows-label"
                htmlFor="footer-rows"
                title={
                  'Bottom rows driven by their own queue. 0 turns the footer off. ' +
                  `The main band has ${boardState?.grid?.mainRows ?? settings.rows} rows.`
                }
              >
                Footer rows <span className="muted">{String(settings.footerRows)}</span>
              </label>
              <input
                id="footer-rows"
                type="range"
                min={0}
                max={maxFooterRows}
                step={1}
                value={settings.footerRows}
                onChange={(event) => onPatch({ footerRows: Number(event.target.value) })}
              />
            </div>
            {range('dwell', 'Hold', 'dwellMs', 0, 8000, 100, ms)}
            {select('align', 'Align', 'align', [
              ['left', 'Left'],
              ['center', 'Center'],
              ['right', 'Right'],
            ])}
            {select('valign', 'Vertical', 'valign', [
              ['top', 'Top'],
              ['middle', 'Middle'],
              ['bottom', 'Bottom'],
            ])}
            {select('wrap', 'Wrap', 'wrap', [
              ['word', 'Word'],
              ['char', 'Char'],
              ['none', 'None'],
            ])}
          </div>
        </details>

        <details id="panel-motion" className="section">
          <summary>Motion</summary>
          <div className="row grid">
            {range('fast', 'Scroll speed', 'fastStepMs', 25, 200, 5, ms)}
            {range('land', 'Landing', 'landStepMs', 40, 500, 10, ms)}
            {range('sweep', 'Sweep', 'sweepMs', 0, 2000, 25, ms)}
            {select('stagger-mode', 'Sweep shape', 'staggerMode', [
              ['diagonal', 'Diagonal'],
              ['column', 'Column'],
              ['row', 'Row'],
              ['random', 'Random'],
              ['none', 'None'],
            ])}
            <div className="field checkbox">
              <label htmlFor="always">
                <input
                  id="always"
                  type="checkbox"
                  checked={settings.alwaysFlip}
                  onChange={(event) => {
                    onSetSetting('alwaysFlip', event.target.checked);
                    onPatch({ alwaysFlip: event.target.checked });
                  }}
                />{' '}
                Always flip
              </label>
            </div>
          </div>
        </details>

        <details id="panel-saved" className="section">
          <summary>Saved lines</summary>
          <div className="row split">
            <div className="field grow">
              <label htmlFor="playlist">
                One message per line <span className="muted">kept across reloads</span>
              </label>
              <textarea
                id="playlist"
                rows={4}
                spellCheck={false}
                value={settings.playlist}
                onChange={(event) => onSetSetting('playlist', event.target.value)}
              />
            </div>
            <div className="stack">
              <button id="saved-add" className="primary wide" onClick={onAddSaved}>
                {multiBand ? `Add all to ${target}` : 'Add all'}
              </button>
              <span className="muted">
                Added as repeating messages, so they cycle. Use a band&apos;s Clear to stop them.
              </span>
            </div>
          </div>
        </details>

        <AccessPanel slug={slug} isOwner={isOwner} />

        <div className="row footer">
          <span className="readouts">
            <span id="status" className="muted">
              {statusMsg}
            </span>
          </span>
          <span className="muted keys">
            <kbd>C</kbd> controls · <kbd>Space</kbd> add saved · <kbd>Esc</kbd> clear all ·{' '}
            <kbd>F</kbd> fullscreen
          </span>
        </div>
      </div>
    </section>
  );
}
