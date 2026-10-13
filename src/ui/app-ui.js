// All HTML interface: HUD, tool panel, species list, inspector, journal, field report, worlds manager,
// confirmations and first-time guidance. Every number shown is read from simulation state.
import { SPECIES, PLANT_IDS, ANIMAL_IDS, INTRODUCABLE, TRAIT_LABELS, ANIMAL_TRAITS, PLANT_TRAITS } from '../sim/species.js';
import { pigment } from '../sim/genome.js';
import { fmtT, EVENT_TYPES } from '../sim/journal.js';
import { eventLabel } from '../sim/offline.js';

const $ = (s, r = document) => r.querySelector(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colourOf = (sp) => { const [r, g, b] = pigment(SPECIES[sp].hueBase, 0.5); return `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`; };
const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
const fmtN = (n) => (n == null ? '–' : Math.round(n).toLocaleString('en-GB'));
const CHART_COLS = ['#5fb0a3', '#d9a441', '#9fb49a', '#c9775a', '#7fa3c4', '#e7d9a8', '#a48bbf', '#8fbf8a', '#d98b8b', '#6f9e6a', '#c5b38a', '#8bb6b0'];

export class UI {
  constructor(root, handlers) {
    this.root = root;
    this.h = handlers;
    this.tool = 'inspect';
    this.toolSpecies = 'grazer';
    this.hazard = { sp: 'grazer', trait: 'size', dir: 'high' };
    this.lastEventId = -1;
    this.speciesRows = {};
    this.buildLayout();
  }

  buildLayout() {
    this.root.innerHTML = `
      <div class="topbar panel" role="banner">
        <div class="brand">AFTER <span>YOU</span> LEAVE</div>
        <button id="btnWorlds" class="worldname" title="Worlds: create, open, export, delete">Worlds ▾</button>
        <div class="speeds row" role="group" aria-label="Time speed">
          <button data-speed="0" title="Pause (Space)">❚❚</button>
          <button data-speed="1" title="1× : 1 sim-hour every 20 s">1×</button>
          <button data-speed="4" title="4×">4×</button>
          <button data-speed="12" title="12×">12×</button>
        </div>
        <div class="clock" id="clock">–</div>
        <div class="stat" id="climate"></div>
        <div class="grow"></div>
        <div class="stat hide-s" id="savestat"></div>
        <button id="btnJournal" title="Field journal">Journal</button>
        <button id="btnHelp" title="Controls and guide">Guide</button>
      </div>

      <aside class="left panel" aria-label="Tools">
        <h2>Tools</h2>
        <div class="tools" role="group" aria-label="Choose a tool">
          <button data-tool="inspect">Inspect</button>
          <button data-tool="seed">Plant seeds</button>
          <button data-tool="intro">Introduce</button>
          <button data-tool="spring">Open spring</button>
          <button data-tool="mulch">Spread mulch</button>
          <button id="btnRain">Call rain</button>
        </div>
        <p class="tool-hint" id="toolHint"></p>
        <div class="row small" id="speciesPick" style="margin-top:8px"></div>
        <div class="section">
          <h2>Climate</h2>
          <div class="row small"><span class="grow">Background temperature offset</span><b id="offsetVal"></b></div>
          <input type="range" id="offset" min="-8" max="10" step="0.5" aria-label="Temperature offset">
          <p class="muted" id="rainNote"></p>
        </div>
        <div class="section">
          <h2>Selective hazard</h2>
          <p class="muted">For 4 sim-days, one species carries extra risk for individuals on one side of a trait.</p>
          <div class="row small"><select id="hzSp"></select><select id="hzTrait"></select></div>
          <div class="row small" style="margin-top:6px"><select id="hzDir"><option value="high">penalise LOW values</option><option value="low">penalise HIGH values</option></select>
          <button id="hzApply">Apply</button></div>
          <p class="muted" id="hzNote"></p>
        </div>
        <div class="section">
          <h2>Specimen bank</h2>
          <p class="muted" id="bankNote"></p>
        </div>
      </aside>

      <aside class="right panel" aria-label="Inspector">
        <div id="inspector"></div>
        <div class="section">
          <h2>Populations</h2>
          <div id="species"></div>
        </div>
        <div class="section row">
          <button id="btnFollow" class="grow">Follow selected</button>
          <button id="btnReset" class="grow">Reset view</button>
        </div>
        <p class="muted" style="margin-top:8px">Drag: orbit · Right-drag or Shift-drag: pan · Wheel: zoom · WASD: move · Q/E: turn · R: reset</p>
      </aside>

      <section class="bottom panel" aria-label="Population chart and recent events">
        <canvas class="chart" id="miniChart" style="height:100%"></canvas>
        <div class="ticker" id="ticker"></div>
      </section>
      <div class="hint-bar hidden" id="hint"></div>
      <div id="progress" class="progress panel hidden" role="status" aria-live="polite"></div>
      <div id="modalRoot"></div>
      <div class="toasts" id="toasts" aria-live="polite"></div>`;
    this.$ = {
      clock: $('#clock', this.root), climate: $('#climate', this.root), save: $('#savestat', this.root),
      inspector: $('#inspector', this.root), species: $('#species', this.root), ticker: $('#ticker', this.root),
      mini: $('#miniChart', this.root), offset: $('#offset', this.root), offsetVal: $('#offsetVal', this.root),
      rainNote: $('#rainNote', this.root), hint: $('#hint', this.root), toolHint: $('#toolHint', this.root),
      speciesPick: $('#speciesPick', this.root), hzSp: $('#hzSp', this.root), hzTrait: $('#hzTrait', this.root),
      hzDir: $('#hzDir', this.root), hzNote: $('#hzNote', this.root), bankNote: $('#bankNote', this.root),
      progress: $('#progress', this.root), modalRoot: $('#modalRoot', this.root), toasts: $('#toasts', this.root),
      btnRain: $('#btnRain', this.root), btnFollow: $('#btnFollow', this.root), worlds: $('#btnWorlds', this.root),
    };
    this.root.querySelectorAll('[data-speed]').forEach((b) => b.addEventListener('click', () => this.h.onSpeed(+b.dataset.speed)));
    this.root.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
    this.$.btnRain.addEventListener('click', () => this.h.onRain());
    this.$.offset.addEventListener('input', () => { this.$.offsetVal.textContent = fmtOff(+this.$.offset.value); });
    this.$.offset.addEventListener('change', () => this.h.onClimate(+this.$.offset.value));
    $('#hzApply', this.root).addEventListener('click', () => this.h.onHazard({ sp: this.$.hzSp.value, trait: this.$.hzTrait.value, dir: this.$.hzDir.value }));
    $('#btnFollow', this.root).addEventListener('click', () => this.h.onFollow());
    $('#btnReset', this.root).addEventListener('click', () => this.h.onReset());
    $('#btnJournal', this.root).addEventListener('click', () => this.h.onJournal());
    $('#btnHelp', this.root).addEventListener('click', () => this.showGuide(true));
    this.$.worlds.addEventListener('click', () => this.h.onWorlds());
    this.$.speciesPick.addEventListener('change', () => {});
    // dropdowns
    this.$.hzSp.innerHTML = ANIMAL_IDS.map((id) => `<option value="${id}">${esc(SPECIES[id].common)}</option>`).join('');
    this.$.hzTrait.innerHTML = [...ANIMAL_TRAITS, ...PLANT_TRAITS].map((t) => `<option value="${t}">${esc(TRAIT_LABELS[t] || t)}</option>`).join('');
    this.$.hzSp.addEventListener('change', () => this.fillHazardTraits());
    this.fillHazardTraits();
    this.setTool('inspect');
    this.renderSpeciesPick();
  }

  fillHazardTraits() {
    const sp = this.$.hzSp.value;
    const keys = SPECIES[sp]?.kind === 'plant' ? PLANT_TRAITS : ANIMAL_TRAITS;
    this.$.hzTrait.innerHTML = keys.map((t) => `<option value="${t}">${esc(TRAIT_LABELS[t] || t)}</option>`).join('');
  }

  setTool(t) {
    this.tool = t;
    this.root.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    const hints = {
      inspect: 'Click a creature to read its body, genes and state. The population list shows every species.',
      seed: 'Click the ground to scatter seeds of the chosen plant. Plants need the right moisture and light.',
      intro: 'Click the ground to introduce a founder group. Each introduction spends one specimen from the bank.',
      spring: 'Click the ground to open a spring. The soil nearby stays wet for three days.',
      mulch: 'Click the ground to spread organic mulch. Decomposers and fungi respond to it.',
    };
    this.$.toolHint.textContent = hints[t] || '';
    this.renderSpeciesPick();
    this.h.onToolChange?.(t);
  }

  renderSpeciesPick() {
    const t = this.tool;
    if (t === 'seed') {
      this.$.speciesPick.innerHTML = `<select id="pickSp" aria-label="Plant species">${PLANT_IDS.map((id) => `<option value="${id}" ${id === this.toolSpecies ? 'selected' : ''}>${esc(SPECIES[id].common)}</option>`).join('')}</select>`;
    } else if (t === 'intro') {
      this.$.speciesPick.innerHTML = `<select id="pickSp" aria-label="Animal species">${INTRODUCABLE.filter((id) => SPECIES[id].kind === 'animal').map((id) => `<option value="${id}" ${id === this.toolSpecies ? 'selected' : ''}>${esc(SPECIES[id].common)}</option>`).join('')}</select>`;
    } else { this.$.speciesPick.innerHTML = ''; return; }
    const sel = $('#pickSp', this.$.speciesPick);
    sel.addEventListener('change', () => { this.toolSpecies = sel.value; });
  }

  showHint(text, ms = 0) {
    this.$.hint.textContent = text;
    this.$.hint.classList.remove('hidden');
    clearTimeout(this._hintT);
    if (ms) this._hintT = setTimeout(() => this.$.hint.classList.add('hidden'), ms);
  }

  setWorldName(name) { this.$.worlds.textContent = `${name} ▾`; }

  /** Called every quarter second with the current view model. */
  update(v) {
    const { S, world } = v;
    if (!S || !world) return;
    this.lastView = v;
    this.setWorldName(S.name);
    const day = Math.floor(S.time / 24) + 1, hr = Math.floor(S.time % 24);
    this.$.clock.textContent = `Day ${day} · ${String(hr).padStart(2, '0')}:${String(Math.floor((S.time % 1) * 60)).padStart(2, '0')}`;
    const T = world.temp;
    const rain = S.climate.rain.on ? ` · <b>raining</b>` : '';
    this.$.climate.innerHTML = `<b>${T.toFixed(1)}°C</b> · humidity <b>${Math.round(S.climate.humidity * 100)}%</b>${rain}`;
    this.root.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', +b.dataset.speed === (S.speed ?? 1)));
    if (document.activeElement !== this.$.offset) { this.$.offset.value = S.climate.offset; this.$.offsetVal.textContent = fmtOff(S.climate.offset); }
    const ready = world.rainReadyIn();
    this.$.btnRain.disabled = ready > 0 || S.climate.rain.on;
    this.$.btnRain.textContent = S.climate.rain.on ? 'Raining…' : ready > 0 ? `Rain in ${ready.toFixed(1)} h` : 'Call rain';
    this.$.rainNote.textContent = 'Rain cools the basin, wets the soil and fills the pond.';
    this.$.bankNote.textContent = `${S.bank} specimen${S.bank === 1 ? '' : 's'} in the bank. Introducing a species costs one; each new species you discover adds one.`;
    this.renderSpecies(v);
    this.renderInspector(v);
    this.renderTicker(v);
    this.renderMini(v);
    this.renderSaveStatus(v);
  }

  renderSpecies(v) {
    const { S, world } = v;
    const ids = PLANT_IDS.concat(ANIMAL_IDS);
    const counts = world.countsSnapshot();
    const peak = {};
    for (const sp of ids) peak[sp] = Math.max(1, S.species[sp]?.peak || 0, counts[sp] || 0);
    if (!this.speciesRows.built) {
      this.$.species.innerHTML = ids.map((sp) => {
        const info = SPECIES[sp];
        return `<div class="species-row" data-sp="${sp}" role="button" tabindex="0" aria-label="${esc(info.common)} details">
          <div class="name"><span class="dot" style="background:${colourOf(sp)}"></span>${esc(info.common)}</div>
          <div class="num" data-n="${sp}">0</div>
          <div class="bar" style="grid-column:1/3"><i data-b="${sp}" style="width:0%"></i></div></div>`;
      }).join('');
      this.$.species.querySelectorAll('[data-sp]').forEach((el) => {
        el.addEventListener('click', () => this.showSpeciesCard(el.dataset.sp));
        el.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.showSpeciesCard(el.dataset.sp); });
      });
      this.speciesRows.built = true;
    }
    for (const sp of ids) {
      const n = counts[sp] || 0;
      const nn = this.$.species.querySelector(`[data-n="${sp}"]`);
      const bb = this.$.species.querySelector(`[data-b="${sp}"]`);
      if (nn) nn.textContent = fmtN(n);
      if (bb) bb.style.width = pct(n / peak[sp]);
    }
  }

  renderInspector(v) {
    const { S, world, selected } = v;
    const el = this.$.inspector;
    this.$.btnFollow.textContent = v.following ? 'Stop following' : 'Follow selected';
    this.$.btnFollow.disabled = !selected;
    if (!selected) { el.innerHTML = `<h2>Inspector</h2><p class="muted">Select a creature in the basin, or a species below, to read its body, genes and condition.</p>`; el.dataset.key = ''; return; }
    const a = S.animals.find((q) => q.id === selected);
    if (!a) {
      const key = 'gone';
      if (el.dataset.key !== key) el.innerHTML = `<h2>Inspector</h2><p class="muted">That creature has died. The lineage lives on in its offspring.</p>`;
      el.dataset.key = key;
      return;
    }
    const sp = SPECIES[a.sp];
    const ph = a.ph || {};
    const means = world.traitMeans(a.sp)?.means || {};
    const rec = S.species[a.sp] || {};
    const founder = rec.founderGenome || {};
    const bar = (label, v, cls = '') => `<div class="trait"><span>${esc(label)}</span><span style="text-align:right">${pct(v)}</span><div class="bar ${cls}"><i style="width:${pct(v)}"></i></div></div>`;
    const traitRows = ANIMAL_TRAITS.filter((k) => k !== 'diet').map((k) => bar(TRAIT_LABELS[k] || k, a.g[k] ?? 0)).join('');
    const drift = ANIMAL_TRAITS.filter((k) => k !== 'diet' && founder[k] != null && means[k] != null).map((k) => {
      const d = (means[k] - founder[k]);
      return `<div class="small">${esc(TRAIT_LABELS[k] || k)} <span class="muted">${d >= 0 ? '+' : ''}${(d * 100).toFixed(0)} pts vs founders</span></div>`;
    }).join('');
    el.innerHTML = `
      <h2>Inspector · animal</h2>
      <h3><span class="dot" style="background:${colourOf(a.sp)}"></span>${esc(sp.common)}</h3>
      <p class="muted small">${esc(sp.role)} · lineage ${esc(a.lin || 'unknown')} · age ${(a.age / 24).toFixed(1)} days${a.par ? ' · offspring' : ' · founder'}</p>
      <div style="margin-top:8px">${bar('Energy', a.energy)}${bar('Hydration', a.hyd, 'amber')}${bar('Health', a.health, 'rust')}</div>
      <p class="small">State: <b>${esc(a.st)}</b>${a.bur ? ' · burrowed' : ''}${ph.glow ? ' · glowing' : ''}</p>
      <p class="small muted">Top speed ${(ph.maxSpeed || 0).toFixed(2)} · body ${(ph.bodyLen || 0).toFixed(2)} · legs ${ph.legs ?? 0} · preferred ${ph.tempOpt?.toFixed?.(1) ?? '?'}°C</p>
      <div class="section" style="margin-top:8px"><h2>Genes</h2>${traitRows}</div>
      ${drift ? `<div class="section"><h2>Drift in this species</h2>${drift}</div>` : ''}
      <p class="muted small" style="margin-top:8px">${esc(sp.blurb)}</p>`;
    el.dataset.key = 'a' + a.id;
  }

  showSpeciesCard(sp) {
    const v = this.lastView;
    const S = v?.S;
    if (!S) return;
    const rec = S.species[sp] || {};
    const counts = v.world.countsSnapshot();
    const info = SPECIES[sp];
    const deaths = Object.entries(rec.deaths || {}).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c, n]) => `${c} ${n}`).join(' · ') || 'none yet';
    this.$.inspector.innerHTML = `
      <h2>Species · ${info.kind}</h2>
      <h3><span class="dot" style="background:${colourOf(sp)}"></span>${esc(info.common)}</h3>
      <p class="small">${esc(info.blurb)}</p>
      <p class="small">Living now: <b>${fmtN(counts[sp] || 0)}</b> · births ${fmtN(rec.births || 0)}${info.kind === 'animal' ? ` · kills ${fmtN(rec.kills || 0)}` : ''}</p>
      <p class="small muted">Deaths: ${esc(deaths)}</p>
      <p class="small muted">${rec.discovered ? `First observed ${fmtT(rec.discoveredAt || 0)}` : 'Not yet introduced by you'}</p>
      ${info.kind === 'animal' && INTRODUCABLE.includes(sp) ? `<p class="small">Introductions use one bank specimen.</p>` : ''}
      <button id="pickSpBtn">Use for ${info.kind === 'plant' ? 'seeding' : 'introduction'}</button>`;
    $('#pickSpBtn', this.$.inspector)?.addEventListener('click', () => {
      this.toolSpecies = sp;
      this.setTool(info.kind === 'plant' ? 'seed' : 'intro');
    });
    this.$.inspector.dataset.key = 'sp' + sp;
  }

  renderTicker(v) {
    const J = v.S.journal;
    const last = J.length ? J[J.length - 1].id : -1;
    if (last === this.lastEventId) return;
    this.lastEventId = last;
    const recent = J.slice(-24).reverse();
    this.$.ticker.innerHTML = recent.map((e) => `<div><span class="t">${fmtT(e.t).replace('day ', 'd')}</span>${esc(e.text)}</div>`).join('') || '<div class="muted">The journal is empty so far.</div>';
  }

  renderMini(v) {
    const H = v.S.history;
    const rows = PLANT_IDS.concat(ANIMAL_IDS).map((sp) => ({ sp, arr: H.counts[sp] || [] }))
      .filter((r) => r.arr.length > 1).sort((a, b) => (b.arr[b.arr.length - 1] || 0) - (a.arr[a.arr.length - 1] || 0)).slice(0, 7);
    drawChart(this.$.mini, H.t, rows.map((r, i) => ({ name: SPECIES[r.sp].common, values: r.arr, color: CHART_COLS[PLANT_IDS.concat(ANIMAL_IDS).indexOf(r.sp) % CHART_COLS.length] })), { xLabel: 'sim days', mini: true });
  }

  renderSaveStatus(v) {
    const s = v.saveState;
    this.$.save.innerHTML = `<span class="save-dot ${s?.ok === false ? 'bad' : ''}"></span>${esc(s?.text || '')}`;
  }

  // ───────── feedback ─────────
  toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = `toast reveal ${kind}`;
    t.setAttribute('role', kind === 'bad' ? 'alert' : 'status');
    t.textContent = msg;
    this.$.toasts.appendChild(t);
    setTimeout(() => t.remove(), kind === 'bad' ? 9000 : 4500);
  }

  progress(show, title = '', pct01 = 0, detail = '') {
    const el = this.$.progress;
    el.classList.toggle('hidden', !show);
    if (!show) return;
    el.innerHTML = `<h3>${esc(title)}</h3><div class="muted small">${esc(detail)}</div><div class="bar"><i style="width:${pct(pct01)}"></i></div>`;
  }

  modal({ title, body, actions = [], narrow = false, onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'scrim';
    wrap.innerHTML = `<div class="modal panel reveal ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h3>${esc(title)}</h3><button data-close aria-label="Close">✕</button></header>
      <div class="mbody"></div><div class="row" style="justify-content:flex-end;margin-top:14px" data-actions></div></div>`;
    const mb = $('.mbody', wrap);
    if (typeof body === 'string') mb.innerHTML = body; else mb.appendChild(body);
    const act = $('[data-actions]', wrap);
    const close = (val) => { wrap.remove(); this._modalDepth--; onClose?.(val); this._resolveModal?.(val); };
    for (const a of actions) {
      const b = document.createElement('button');
      b.textContent = a.label;
      if (a.primary) b.className = 'primary';
      if (a.danger) b.className = 'danger';
      b.addEventListener('click', () => { if (a.keep) { a.onClick?.(wrap); return; } close(a.value ?? a.label); });
      act.appendChild(b);
    }
    $('[data-close]', wrap).addEventListener('click', () => close(null));
    wrap.addEventListener('pointerdown', (e) => { if (e.target === wrap) close(null); });
    this.$.modalRoot.appendChild(wrap);
    this._modalDepth = (this._modalDepth || 0) + 1;
    return { el: wrap, mb, close };
  }

  confirm(message, { yes = 'Confirm', no = 'Cancel', danger = false, title = 'Are you sure?' } = {}) {
    return new Promise((resolve) => {
      const body = document.createElement('p');
      body.textContent = message;
      body.style.lineHeight = '1.5';
      this.modal({ title, body, narrow: true, actions: [{ label: no, value: false }, { label: yes, value: true, primary: !danger, danger }], onClose: (v) => resolve(!!v) });
    });
  }

  showGuide(force = false) {
    if (!force && localStorage.getItem('ayl.guide.seen') === '1') return;
    const body = document.createElement('div');
    body.innerHTML = `<ol>
      <li><b>Look around.</b> Drag to orbit, right-drag or Shift-drag to pan, scroll to zoom, WASD to move, Q/E to turn, R to reset.</li>
      <li><b>Read a creature.</b> Click any animal. The inspector shows its body, genes, energy and state. Follow keeps the camera on it.</li>
      <li><b>Shape the basin.</b> Plant seeds, introduce a founder group (one bank specimen each), open springs, spread mulch, call rain, or change the background temperature.</li>
      <li><b>Let time run.</b> Speed buttons advance the basin: 1 sim-hour takes 20 real seconds at 1×. Pause at any time.</li>
      <li><b>Leave and return.</b> The basin keeps running while you are away. On return, a field report lists what actually happened, and the journal keeps every event.</li></ol>
      <p class="muted small">Everything you see comes from the simulation. Nothing is scripted, and nothing is saved to a server: worlds stay in this browser.</p>`;
    this.modal({ title: 'First look: how to play', body, narrow: true, actions: [{ label: 'Got it', primary: true, value: 'ok' }], onClose: () => localStorage.setItem('ayl.guide.seen', '1') });
  }

  /** Field report after returning. The report only lists events and changes recorded in the simulation. */
  showReport(r) {
    const rows = PLANT_IDS.concat(ANIMAL_IDS).filter((sp) => (r.counts[sp]?.start || 0) + (r.counts[sp]?.end || 0) + (r.births[sp] || 0) + Object.values(r.deaths[sp] || {}).reduce((a, b) => a + b, 0) > 0)
      .map((sp) => {
        const c = r.counts[sp];
        const dsum = Object.values(r.deaths[sp] || {}).reduce((a, b) => a + b, 0);
        const causes = Object.entries(r.deaths[sp] || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}`).join(', ');
        const delta = c.end - c.start;
        return `<tr><td><span class="dot" style="background:${colourOf(sp)}"></span>${esc(SPECIES[sp].common)}</td>
          <td>${fmtN(c.start)} → <b>${fmtN(c.end)}</b> <span class="muted">(${delta >= 0 ? '+' : ''}${fmtN(delta)})</span></td>
          <td>${fmtN(c.min)}–${fmtN(c.max)}</td><td>${fmtN(r.births[sp] || 0)}</td><td>${fmtN(dsum)} <span class="muted small">${esc(causes)}</span></td>
          <td>${fmtN(r.kills[sp] || 0)}</td></tr>`;
      }).join('');
    const ev = (r.events || []).slice(-60).reverse();
    const cl = r.climate || {};
    const span = r.simHours;
    const none = !rows && !ev.length;
    const body = document.createElement('div');
    body.innerHTML = `
      <p>You were away for <b>${fmtDur(r.elapsedSec)}</b>. The basin advanced <b>${span.toFixed(1)} sim-hours</b> (${(span / 24).toFixed(2)} days) using the same rules as live play.</p>
      ${r.truncated ? `<p class="small" style="color:var(--amber)">Catch-up is capped at 240 sim-hours per return. Of the ${r.wantedHours.toFixed(0)} sim-hours that elapsed, only the first 240 were simulated; the rest were not.</p>` : ''}
      <p class="muted small">${esc(r.approximation)} Steps are ${(r.dt * 60).toFixed(0)} minutes long; live play uses 1.2-minute steps.</p>
      <div class="row small muted" style="margin:6px 0 10px">Temperature ${cl.tempMin != null ? cl.tempMin.toFixed(1) + '–' + cl.tempMax.toFixed(1) + '°C' : '–'} · humidity ${cl.humMin != null ? Math.round(cl.humMin * 100) + '–' + Math.round(cl.humMax * 100) + '%' : '–'} · rain for about ${cl.rainHours ?? 0} h</div>
      ${none ? '<p>Nothing measurable changed in the basin during this time.</p>' : `
      <div style="overflow:auto"><table class="table"><thead><tr><th>Species</th><th>Living start → end</th><th>Range</th><th>Births</th><th>Deaths</th><th>Kills</th></tr></thead><tbody>${rows}</tbody></table></div>`}
      <h3 style="margin-top:14px">Events in this period</h3>
      <div class="events">${ev.map((e) => `<div class="event"><span class="t">${fmtT(e.t)}</span><span class="k">${esc(eventLabel(e.type))}</span><span>${esc(e.text)}</span></div>`).join('') || '<p class="muted">No recorded events.</p>'}</div>`;
    this.modal({ title: 'What happened while you were gone?', body, actions: [{ label: 'Open journal', value: 'journal' }, { label: 'Continue', primary: true, value: 'ok' }], onClose: (v) => { if (v === 'journal') this.h.onJournal?.(); } });
  }

  openJournal(v) {
    const { S, world } = v;
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="tabs"><button class="on" data-tab="events">Events</button><button data-tab="charts">Charts</button><button data-tab="species">Species</button></div>
      <div data-pane="events"><div class="row small" style="margin-bottom:8px"><select id="jFilter"><option value="">All events</option>${Object.keys(EVENT_TYPES).map((k) => `<option value="${k}">${esc(EVENT_TYPES[k])}</option>`).join('')}</select><span class="muted">${S.journal.length} recorded</span></div>
        <div class="events" id="jList"></div></div>
      <div data-pane="charts" class="hidden">
        <div class="legend" id="jLegend"></div>
        <canvas class="chart" id="jPop" style="height:260px"></canvas>
        <p class="muted small">Population by species, sampled every 2 sim-hours (most recent ${S.history.t.length} samples).</p>
        <div class="legend">Climate</div>
        <canvas class="chart" id="jClim" style="height:160px"></canvas></div>
      <div data-pane="species" class="hidden" id="jSpecies"></div>`;
    const m = this.modal({ title: `Field journal · ${S.name}`, body, actions: [{ label: 'Close', primary: true, value: 'ok' }] });
    const list = $('#jList', body);
    const drawList = () => {
      const f = $('#jFilter', body).value;
      const evs = S.journal.filter((e) => !f || e.type === f).slice(-400).reverse();
      list.innerHTML = evs.map((e) => `<div class="event"><span class="t">${fmtT(e.t)}</span><span class="k">${esc(eventLabel(e.type))}</span><span>${esc(e.text)}</span></div>`).join('') || '<p class="muted">Nothing recorded yet. Introduce a species or let the basin run.</p>';
    };
    $('#jFilter', body).addEventListener('change', drawList);
    drawList();
    // tabs
    body.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      body.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
      body.querySelectorAll('[data-pane]').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== b.dataset.tab));
      if (b.dataset.tab === 'charts') drawCharts();
    }));
    const H = S.history;
    const picked = new Set(PLANT_IDS.concat(ANIMAL_IDS).filter((sp) => (H.counts[sp] || []).some((n) => n > 0)));
    const drawCharts = () => {
      const legend = $('#jLegend', body);
      const all = PLANT_IDS.concat(ANIMAL_IDS).filter((sp) => (H.counts[sp] || []).length);
      if (!legend.childElementCount) {
        legend.innerHTML = all.map((sp) => `<label><input type="checkbox" data-sp="${sp}" ${picked.has(sp) ? 'checked' : ''}><span class="dot" style="background:${CHART_COLS[PLANT_IDS.concat(ANIMAL_IDS).indexOf(sp) % CHART_COLS.length]}"></span>${esc(SPECIES[sp].common)}</label>`).join('');
        legend.querySelectorAll('input').forEach((i) => i.addEventListener('change', () => { i.checked ? picked.add(i.dataset.sp) : picked.delete(i.dataset.sp); drawPop(); }));
      }
      drawPop();
      drawChart($('#jClim', body), H.t, [
        { name: 'Temperature °C', values: H.climate.temp, color: '#d9a441' },
        { name: 'Humidity ×30', values: (H.climate.hum || []).map((x) => x * 30), color: '#5fb0a3' },
        { name: 'Rain intensity ×30', values: (H.climate.rain || []).map((x) => x * 30), color: '#7fa3c4' },
      ], { xLabel: 'sim days' });
    };
    const drawPop = () => {
      const series = PLANT_IDS.concat(ANIMAL_IDS).filter((sp) => picked.has(sp) && (H.counts[sp] || []).length).map((sp) => ({ name: SPECIES[sp].common, values: H.counts[sp], color: CHART_COLS[PLANT_IDS.concat(ANIMAL_IDS).indexOf(sp) % CHART_COLS.length] }));
      drawChart($('#jPop', body), H.t, series, { xLabel: 'sim days', legend: false });
    };
    const sp = $('#jSpecies', body);
    sp.innerHTML = `<div style="overflow:auto"><table class="table"><thead><tr><th>Species</th><th>Living</th><th>Births</th><th>Kills</th><th>Deaths (top causes)</th><th>First seen</th></tr></thead><tbody>${PLANT_IDS.concat(ANIMAL_IDS).map((id) => {
      const r = S.species[id] || {};
      const c = Object.entries(r.deaths || {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => `${k} ${n}`).join(', ');
      return `<tr><td><span class="dot" style="background:${colourOf(id)}"></span>${esc(SPECIES[id].common)}</td><td>${fmtN(world.countsSnapshot()[id] || 0)}</td><td>${fmtN(r.births || 0)}</td><td>${fmtN(r.kills || 0)}</td><td class="small">${esc(c) || '–'}</td><td class="small">${r.discovered ? fmtT(r.discoveredAt || 0) : '–'}</td></tr>`;
    }).join('')}</tbody></table></div>`;
    return m;
  }

  /** Worlds manager. h: { open, create, rename, copySeed, exportWorld, importFile, remove, restart } */
  openWorlds(list, activeId, activeName) {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="row" style="margin-bottom:10px"><button id="wNew" class="primary">New basin</button><label class="button-like"><button id="wImport" type="button">Import file…</button><input id="wFile" type="file" accept="application/json,.json" class="hidden"></label><span class="grow"></span><span class="muted small">Worlds are kept in this browser only.</span></div>
      <div id="wNewForm" class="hidden panel" style="padding:10px;margin-bottom:10px">
        <div class="field"><label for="wName">Name</label><input type="text" id="wName" maxlength="60" value="New basin"></div>
        <div class="field"><label for="wSeed">Seed (text or number; blank for random)</label><input type="text" id="wSeed" maxlength="60" placeholder="e.g. amber-tidewater"></div>
        <div class="row"><button id="wCreate" class="primary">Create basin</button><button id="wCancel">Cancel</button></div></div>
      <div id="wList">${list.map((w) => `
        <div class="worldcard ${w.id === activeId ? 'active' : ''}" data-id="${esc(w.id)}">
          <div><h3>${esc(w.name)}${w.id === activeId ? ' <span class="muted small">(open)</span>' : ''}</h3>
            <div class="muted small">Seed ${esc(w.seedText)} · ${w.species} species · ${((w.time || 0) / 24).toFixed(1)} sim-days in · saved ${w.savedAt ? new Date(w.savedAt).toLocaleString('en-GB') : '–'}</div></div>
          <div class="row" style="justify-content:flex-end">
            ${w.id === activeId ? '' : `<button data-act="open" class="primary">Open</button>`}
            <button data-act="rename">Rename</button><button data-act="seed">Copy seed</button><button data-act="export">Export</button><button data-act="delete" class="danger">Delete</button></div>
        </div>`).join('') || '<p class="muted">No worlds yet.</p>'}</div>
      ${activeId ? `<div class="section"><h2>Restart</h2><p class="muted small">Restarting ${esc(activeName)} erases its history and rebuilds it from the same seed. You will be asked to confirm.</p><button id="wRestart" class="danger">Restart ${esc(activeName)}</button></div>` : ''}`;
    const modal = this.modal({ title: 'Worlds', body, narrow: false, actions: [{ label: 'Close', primary: true, value: 'close' }] });
    const el = modal.el;
    const form = $('#wNewForm', el);
    $('#wNew', el).addEventListener('click', () => form.classList.toggle('hidden'));
    $('#wCancel', el).addEventListener('click', () => form.classList.add('hidden'));
    $('#wCreate', el).addEventListener('click', () => {
      const name = $('#wName', el).value.trim() || 'Untitled basin';
      const seed = $('#wSeed', el).value.trim();
      modal.close('created');
      this.h.create(name, seed);
    });
    $('#wImport', el).addEventListener('click', () => $('#wFile', el).click());
    $('#wFile', el).addEventListener('change', (e) => { const f = e.target.files[0]; modal.close('import'); if (f) this.h.importFile(f); });
    el.querySelectorAll('.worldcard').forEach((card) => {
      const id = card.dataset.id;
      card.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', async () => {
        const act = b.dataset.act;
        if (act === 'open') { modal.close('open'); this.h.open(id); }
        if (act === 'rename') {
          const name = prompt('New name for this basin', card.querySelector('h3').textContent.replace(' (open)', '').trim());
          if (name && name.trim()) this.h.rename(id, name.trim().slice(0, 60));
        }
        if (act === 'seed') this.h.copySeed(id);
        if (act === 'export') this.h.exportWorld(id);
        if (act === 'delete') {
          const w = list.find((x) => x.id === id);
          const ok = await this.confirm(`Delete "${w?.name || 'this basin'}" permanently? Its history and journal cannot be recovered.`, { yes: 'Delete basin', danger: true, title: 'Delete basin?' });
          if (ok) { modal.close('deleted'); this.h.remove(id); }
        }
      }));
    });
    $('#wRestart', el)?.addEventListener('click', async () => {
      const ok = await this.confirm(`Restart ${activeName}? Its current history, journal and report will be replaced by a fresh basin built from the same seed.`, { yes: 'Restart basin', danger: true, title: 'Restart basin?' });
      if (ok) { modal.close('restart'); this.h.restart(); }
    });
    return modal;
  }
}

function fmtOff(v) { return `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`; }
export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min ${s} s`;
  return `${s} s`;
}

/** Simple line chart on a canvas, with HiDPI scaling and axis labels. */
export function drawChart(canvas, xs, series, opt = {}) {
  if (!canvas) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const padL = opt.mini ? 34 : 44, padR = 10, padT = 10, padB = opt.mini ? 16 : 22;
  const pw = w - padL - padR, ph = h - padT - padB;
  let ymax = 1;
  for (const s of series) for (const v of s.values) if (v > ymax) ymax = v;
  ymax = niceMax(ymax);
  const x0 = xs.length ? xs[0] : 0, x1 = xs.length ? xs[xs.length - 1] : 1;
  const xs2 = (t) => padL + ((t - x0) / Math.max(1e-6, x1 - x0)) * pw;
  g.font = `11px system-ui, sans-serif`;
  g.strokeStyle = 'rgba(190,210,196,0.12)';
  g.fillStyle = 'rgba(190,210,196,0.6)';
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (ph * i) / 4;
    g.beginPath(); g.moveTo(padL, y); g.lineTo(w - padR, y); g.stroke();
    g.fillText(String(Math.round(ymax * (1 - i / 4))), 4, y + 4);
  }
  if (xs.length > 1) {
    g.fillText(`${(x0 / 24).toFixed(1)} d`, padL, h - 4);
    const lbl = `${(x1 / 24).toFixed(1)} d ${opt.xLabel ? '' : ''}`;
    g.fillText(lbl, w - padR - g.measureText(lbl).width, h - 4);
  } else {
    g.fillText('no samples yet', padL + 4, h / 2);
  }
  for (const s of series) {
    const vals = s.values;
    if (!vals.length) continue;
    g.strokeStyle = s.color;
    g.lineWidth = opt.mini ? 1.4 : 1.8;
    g.beginPath();
    const off = xs.length - vals.length;
    for (let i = 0; i < vals.length; i++) {
      const t = xs[i + off] ?? xs[xs.length - 1];
      const x = xs2(t), y = padT + ph - (vals[i] / ymax) * ph;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
  }
  if (opt.legend !== false && !opt.mini && series.length) {
    let lx = padL + 6;
    g.font = '11px system-ui, sans-serif';
    for (const s of series.slice(0, 6)) {
      g.fillStyle = s.color; g.fillRect(lx, padT + 2, 10, 3);
      g.fillStyle = 'rgba(236,229,209,0.85)';
      g.fillText(s.name, lx + 14, padT + 8);
      lx += g.measureText(s.name).width + 26;
    }
  }
}
function niceMax(v) {
  if (v <= 5) return 5;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}
