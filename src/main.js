// Application entry: wires the simulation, the renderer, persistence and the interface together.
// Live play steps the same rules at 0.02 sim-hour per step; returning after time away runs a bounded catch-up.
import './styles.css';
import { Engine } from './render/engine.js';
import { World, seedFromText } from './sim/world.js';
import { CatchUp, planCatchUp, SIM_HOURS_PER_REAL_SECOND, DT_LIVE } from './sim/offline.js';
import { stripForSave, exportPayload, validateState } from './sim/serialize.js';
import { UI } from './ui/app-ui.js';
import * as db from './persist/db.js';

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui');
const engine = new Engine(canvas);
const app = {
  S: null, world: null, catchUp: null, acc: 0, lastSaveTs: 0, saving: false, pendingSave: false,
  saveState: { ok: true, text: 'Not saved yet' }, selected: null, following: false, rippleNext: 0,
  storageOk: true,
};
let ui = null;

const WORDS = ['amber', 'tidewater', 'lichen', 'basalt', 'fernmoor', 'saltreed', 'ember', 'hollow', 'sable', 'mistgrove', 'copper', 'rillstone'];
const randomSeedText = () => `${WORDS[(Math.random() * WORDS.length) | 0]}-${WORDS[(Math.random() * WORDS.length) | 0]}-${(Math.random() * 9000 + 1000) | 0}`;

function view() {
  return {
    S: app.S, world: app.world, selected: app.selected, following: app.following, saveState: app.saveState,
  };
}

function setSaveState(ok, text) {
  app.saveState = { ok, text };
}

async function saveNow() {
  const S = app.S;
  if (!S || !app.storageOk) return;
  if (app.saving) { app.pendingSave = true; return; }
  app.saving = true;
  try {
    S.paused = S.speed === 0;
    S.savedAt = Date.now();
    await db.saveWorld(stripForSave(S));
    setSaveState(true, `Saved ${new Date(S.savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (e) {
    setSaveState(false, 'Not saved: ' + e.message);
    ui?.toast('Could not save this basin. ' + e.message, 'bad');
  } finally {
    app.saving = false;
    app.lastSaveTs = performance.now();
    if (app.pendingSave) { app.pendingSave = false; saveNow(); }
  }
}

/** Opens a world and reconciles elapsed time: a paused world does not advance; otherwise catch up. */
function activate(S, { announce = true } = {}) {
  const world = new World(S);
  app.S = S;
  app.world = world;
  app.selected = null;
  app.following = false;
  app.acc = 0;
  engine.attach(world);
  engine.orbit.setFollow(null);
  if (!S.speed && S.speed !== 0) S.speed = 1;
  const plan = planCatchUp(S);
  if (!S.paused && plan.hours > 0.05) {
    app.catchUp = new CatchUp(world, plan);
    ui.progress(true, 'While you were away…', 0, `Catching up ${plan.hours.toFixed(1)} sim-hours${plan.truncated ? ' (capped at 240)' : ''}`);
  } else {
    S.savedAt = Date.now();
    app.catchUp = null;
  }
  db.setMeta('active', S.id).catch(() => {});
  if (announce) ui.toast(`Opened ${S.name}.`, 'good');
  ui.lastEventId = -1;
  ui.update(view());
}

async function openById(id) {
  try {
    const raw = await db.loadWorld(id);
    if (!raw) { ui.toast('That basin is no longer in storage.', 'bad'); return false; }
    const v = validateState(raw);
    if (!v.ok) { ui.toast(`This save could not be opened: ${v.error}`, 'bad'); return false; }
    activate(v.state);
    return true;
  } catch (e) {
    ui.toast('Could not open the basin: ' + e.message, 'bad');
    return false;
  }
}

function newWorld(name, seedText) {
  const text = (seedText || '').trim() || randomSeedText();
  const seed = seedFromText(text);
  const w = World.create({ name: name || 'Untitled basin', seed });
  const S = w.S;
  S.seedText = text;
  S.speed = 1;
  S.paused = false;
  return S;
}

async function createWorld(name, seedText) {
  const S = newWorld(name, seedText);
  activate(S, { announce: false });
  ui.toast(`Created ${S.name}. Seed: ${S.seedText}`, 'good');
  await saveNow();
  ui.showGuide();
}

async function ensureActive() {
  let list = [];
  try {
    list = await db.listWorlds();
  } catch (e) {
    app.storageOk = false;
    setSaveState(false, 'Storage unavailable');
    ui.toast(`Worlds cannot be saved in this browser (${e.message}). The basin will run in this tab only.`, 'bad');
    createWorld('Untitled basin', '');
    return;
  }
  let activeId = null;
  try { activeId = await db.getMeta('active'); } catch { activeId = null; }
  const target = list.find((w) => w.id === activeId) || list[0];
  if (target && (await openById(target.id))) return;
  await createWorld('First basin', '');
}

const handlers = {
  onSpeed(n) {
    if (!app.S) return;
    if (app.catchUp) { ui.toast('Catching up with the time you were away. Speed controls will return when it finishes.'); return; }
    app.S.speed = n;
    app.S.paused = n === 0;
    ui.update(view());
  },
  onToolChange(t) {
    if (t !== 'inspect' && app.selected == null) return;
  },
  onRain() {
    if (!app.world) return;
    const ok = app.world.rainfall();
    if (ok) ui.toast('Rain is falling. Watch the pond and the soil.', 'good');
    else ui.toast(`Rain is still recharging: about ${app.world.rainReadyIn().toFixed(1)} sim-hours left.`, 'bad');
  },
  onClimate(v) { app.world?.setClimateOffset(v); },
  onHazard({ sp, trait, dir }) {
    if (!app.world) return;
    app.world.addPressure(sp, trait, dir, 4);
    ui.toast(`Selective hazard applied to ${sp} for 4 sim-days.`, 'good');
  },
  onFollow() {
    if (!app.selected) return;
    if (app.following) { app.following = false; engine.orbit.setFollow(null); return; }
    const id = app.selected;
    app.following = true;
    engine.orbit.setFollow(() => {
      const rs = engine.life?.render.get(id);
      if (!rs || !engine.world) return null;
      return { x: rs.x, y: engine.world.terrain.heightAt(rs.x, rs.z), z: rs.z };
    });
  },
  onReset() {
    app.following = false;
    engine.orbit.reset();
    ui.showHint('View reset.', 1200);
  },
  onJournal() { if (app.S) ui.openJournal(view()); },
  onWorlds() { openWorldsDialog(); },
  create: (name, seed) => createWorld(name, seed),
  open: (id) => openById(id),
  rename: async (id, name) => {
    try {
      if (app.S && app.S.id === id) { app.S.name = name; await saveNow(); }
      else { const S = await db.loadWorld(id); if (S) { S.name = name; await db.saveWorld(S); } }
      ui.toast('Renamed.', 'good');
    } catch (e) { ui.toast('Rename failed: ' + e.message, 'bad'); }
  },
  copySeed: async (id) => {
    try {
      const S = app.S && app.S.id === id ? app.S : await db.loadWorld(id);
      const text = S?.seedText || String(S?.seed ?? '');
      try { await navigator.clipboard.writeText(text); ui.toast(`Seed copied: ${text}`, 'good'); }
      catch { ui.toast(`Seed: ${text} (copy it manually)`, 'good'); }
    } catch (e) { ui.toast('Could not read the seed: ' + e.message, 'bad'); }
  },
  exportWorld: async (id) => {
    try {
      const S = app.S && app.S.id === id ? (await saveNow(), app.S) : await db.loadWorld(id);
      if (!S) return;
      const blob = new Blob([exportPayload(S)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `after-you-leave-${S.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'basin'}.json`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      ui.toast('Export downloaded.', 'good');
    } catch (e) { ui.toast('Export failed: ' + e.message, 'bad'); }
  },
  importFile: async (file) => {
    if (file.size > 30 * 1024 * 1024) { ui.toast('That file is larger than 30 MB and was not imported.', 'bad'); return; }
    let obj;
    try { obj = JSON.parse(await file.text()); } catch { ui.toast('That file is not valid JSON, so it was not imported.', 'bad'); return; }
    const raw = obj && obj.app === 'after-you-leave' && obj.world ? obj.world : obj;
    const v = validateState(raw);
    if (!v.ok) { ui.toast(`Import rejected: ${v.error}`, 'bad'); return; }
    const S = v.state;
    S.id = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    S.name = `${S.name} (imported)`.slice(0, 80);
    S.savedAt = Date.now();
    activate(S, { announce: false });
    await saveNow();
    ui.toast('Imported as a new basin. Existing worlds were not changed.', 'good');
  },
  remove: async (id) => {
    try {
      await db.deleteWorld(id);
      ui.toast('Basin deleted.', 'good');
      if (app.S && app.S.id === id) {
        const list = await db.listWorlds().catch(() => []);
        const next = list[0];
        if (next) await openById(next.id); else await createWorld('First basin', '');
      }
    } catch (e) { ui.toast('Delete failed, nothing was removed: ' + e.message, 'bad'); }
  },
  restart: async () => {
    const old = app.S;
    if (!old) return;
    const S = newWorld(old.name, old.seedText);
    S.id = old.id;
    activate(S, { announce: false });
    await saveNow();
    ui.toast('Basin restarted from its seed.', 'good');
  },
};

async function openWorldsDialog() {
  let list = [];
  try { list = await db.listWorlds(); } catch (e) { ui.toast('Storage error: ' + e.message, 'bad'); }
  ui.openWorlds(list, app.S?.id, app.S?.name || '');
}

function handleClick(e) {
  const S = app.S;
  if (!S || app.catchUp) return;
  const tool = ui.tool;
  if (tool === 'inspect') {
    const id = engine.pickAnimal(e.clientX, e.clientY);
    app.selected = id;
    if (id == null && app.following) { app.following = false; engine.orbit.setFollow(null); }
    if (id != null) { ui.showHint('Follow keeps the camera on it. Press Follow in the inspector.', 2200); }
    ui.update(view());
    return;
  }
  const g = engine.pickGround(e.clientX, e.clientY);
  if (!g) { ui.showHint('Click the ground or water to use this tool.', 1600); return; }
  const w = app.world;
  if (tool === 'seed') {
    const sp = ui.toolSpecies;
    const n = w.plantSeeds(sp, g.x, g.z);
    if (n) ui.toast(`${n} seeds planted. They will sprout where the soil suits them.`, 'good');
    else ui.toast('No suitable ground there. Try wetter, lower ground.', 'bad');
  } else if (tool === 'intro') {
    if (S.bank < 1) { ui.toast('The specimen bank is empty. Discover a new species to earn one.', 'bad'); return; }
    const sp = ui.toolSpecies;
    const n = w.introduce(sp, g.x, g.z, 6);
    if (n) ui.toast(`${n} founders released. One specimen was spent.`, 'good');
    else ui.toast('No suitable ground there for that species.', 'bad');
  } else if (tool === 'spring') {
    w.addSpring(g.x, g.z);
    ui.toast('Spring opened. The ground will stay damp for three days.', 'good');
  } else if (tool === 'mulch') {
    w.addMulch(g.x, g.z);
    ui.toast('Mulch spread.', 'good');
  }
  ui.update(view());
}

let lastTs = performance.now();
let uiTimer = 0;
let frameNo = 0;
function loop(ts) {
  const dt = Math.min(0.1, Math.max(0, (ts - lastTs) / 1000));
  lastTs = ts;
  frameNo++;
  const S = app.S;
  if (S && app.world) {
    if (app.catchUp) {
      const cu = app.catchUp;
      const done = cu.advance(14);
      const plan = cu.plan;
      const doneHours = S.time - cu.startTime;
      ui.progress(true, 'While you were away…', Math.min(1, doneHours / Math.max(0.01, plan.hours)), `Simulated ${doneHours.toFixed(1)} of ${plan.hours.toFixed(1)} sim-hours`);
      if (done) {
        const report = cu.finish();
        app.catchUp = null;
        ui.progress(false);
        saveNow();
        ui.showReport(report);
      }
    } else if (S.speed > 0) {
      app.acc += dt * SIM_HOURS_PER_REAL_SECOND * S.speed;
      let steps = 0;
      while (app.acc >= DT_LIVE && steps < 80) {
        app.world.step(DT_LIVE);
        app.acc -= DT_LIVE;
        steps++;
      }
      if (app.acc > DT_LIVE * 3) app.acc = 0; // never fall behind for long: drop backlog honestly
    }
    if (S.climate.rain.on && engine.clock >= app.rippleNext && engine.terrainView) {
      engine.terrainView.addRipple(engine.clock, 0.5 + Math.random() * 0.7);
      app.rippleNext = engine.clock + 0.12 + Math.random() * 0.25;
    }
    engine.render(S, frameNo, dt);
    if (app.following && !engine.orbit.follow) app.following = false;
  }
  if (ts - uiTimer > 250) { uiTimer = ts; if (app.S) ui.update(view()); }
  if (app.S && !app.catchUp && app.storageOk && ts - app.lastSaveTs > 15000) { app.lastSaveTs = ts; saveNow(); }
  requestAnimationFrame(loop);
}

function boot() {
  ui = new UI(uiRoot, handlers);
  engine.orbit.onClickCandidate = handleClick;
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === ' ' && app.S) { e.preventDefault(); handlers.onSpeed(app.S.speed === 0 ? 1 : 0); }
    if (e.key === 'Escape') { ui.setTool('inspect'); }
    if (e.key === 'f' || e.key === 'F') handlers.onFollow();
  });
  const persistNow = () => { if (app.S && !app.catchUp && app.storageOk) saveNow(); };
  document.addEventListener('visibilitychange', () => { if (document.hidden) persistNow(); });
  window.addEventListener('pagehide', persistNow);
  window.addEventListener('beforeunload', persistNow);
  ensureActive().then(() => { lastTs = performance.now(); requestAnimationFrame(loop); });
  window.__ayl = { app, engine };
}

boot();
