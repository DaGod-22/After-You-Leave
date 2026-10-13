// Save format: plain JSON. Loading validates everything, clamps numbers and drops unknown species,
// so a malformed file cannot crash the simulation. Returns {ok, error, state}.
import { SPECIES, PLANT_IDS, ANIMAL_IDS, ANIMAL_TRAITS, PLANT_TRAITS } from './species.js';
import { FORMAT_VERSION } from './world.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b, d = a) => (isNum(v) ? Math.min(b, Math.max(a, v)) : d);

export function stripForSave(S) {
  const out = JSON.parse(JSON.stringify(S, (k, v) => (k === 'ph' || k === 'tx' || k === 'tz' || k === 'wanderTurn' || k === 'glow' ? undefined : v)));
  return out;
}

export function exportPayload(S) {
  return JSON.stringify({ app: 'after-you-leave', exportedAt: new Date().toISOString(), world: stripForSave(S) }, null, 1);
}

export function validateState(raw) {
  try {
    if (!raw || typeof raw !== 'object') return fail('Save data is not an object.');
    const S = raw;
    if (S.format !== FORMAT_VERSION) return fail(`Unsupported save format ${S.format}.`);
    if (typeof S.id !== 'string' || S.id.length > 80) return fail('Missing world id.');
    S.name = typeof S.name === 'string' ? S.name.slice(0, 80) : 'Recovered basin';
    if (!isNum(S.seed) || S.seed < 0 || S.seed > 0xffffffff) return fail('World seed is invalid.');
    S.seed = S.seed >>> 0;
    S.time = clamp(S.time, 0, 1e7, 0);
    S.savedAt = clamp(S.savedAt, 0, 9e15, Date.now());
    S.createdAt = clamp(S.createdAt, 0, 9e15, Date.now());
    S.rngState = clamp(S.rngState, 0, 0xffffffff, 7) >>> 0;
    S.seq = clamp(S.seq, 0, 1e9, 0);
    S.nextId = clamp(S.nextId, 1, 1e9, 1);
    S.bank = clamp(S.bank, 0, 999, 4);
    S.config = S.config && typeof S.config === 'object' ? { relief: clamp(S.config.relief, 0.5, 1.5, 1), pondSize: clamp(S.config.pondSize, 0.5, 1.5, 1) } : {};
    S.paused = !!S.paused;

    const C = S.climate || {};
    S.climate = {
      offset: clamp(C.offset, -8, 10, 0),
      humidity: clamp(C.humidity, 0, 1, 0.5),
      rain: { on: !!(C.rain && C.rain.on), intensity: clamp(C.rain?.intensity, 0, 1, 0), until: clamp(C.rain?.until, 0, 1e7, 0), player: !!C.rain?.player },
      nextRainCheck: clamp(C.nextRainCheck, 0, 1e7, 6),
      playerRainReadyAt: clamp(C.playerRainReadyAt, 0, 1e7, 0),
      springs: Array.isArray(C.springs) ? C.springs.filter((s) => s && isNum(s.x) && isNum(s.z) && isNum(s.until)).slice(0, 20) : [],
      droughtNoted: !!C.droughtNoted,
      heatNoted: !!C.heatNoted,
    };

    const N = 64 * 64;
    if (S.grid && Array.isArray(S.grid.moist) && Array.isArray(S.grid.nut) && S.grid.moist.length === N && S.grid.nut.length === N) {
      S.grid = { moist: S.grid.moist.map((v) => clamp(v, 0, 1, 0.3)), nut: S.grid.nut.map((v) => clamp(v, 0, 1.5, 0.3)) };
    } else S.grid = null;

    S.plants = (Array.isArray(S.plants) ? S.plants : []).filter((p) => p && PLANT_IDS.includes(p.sp) && isNum(p.x) && isNum(p.z)).slice(0, 1200).map((p) => ({
      id: clamp(p.id, 1, 1e9, 1), sp: p.sp, x: clamp(p.x, -90, 90), z: clamp(p.z, -90, 90), size: clamp(p.size, 0, 1, 0.1), health: clamp(p.health, 0, 1, 1),
      age: clamp(p.age, 0, 1e7, 0), g: traits(p.g, PLANT_TRAITS), par: p.par ?? null,
    }));
    S.animals = (Array.isArray(S.animals) ? S.animals : []).filter((a) => a && ANIMAL_IDS.includes(a.sp) && isNum(a.x) && isNum(a.z)).slice(0, 1200).map((a) => ({
      id: clamp(a.id, 1, 1e9, 1), sp: a.sp, x: clamp(a.x, -90, 90), z: clamp(a.z, -90, 90), hd: clamp(a.hd, -100, 100, 0),
      energy: clamp(a.energy, 0, 1, 0.6), hyd: clamp(a.hyd, 0, 1, 0.8), health: clamp(a.health, 0, 1, 1), age: clamp(a.age, 0, 1e7, 0),
      g: traits(a.g, ANIMAL_TRAITS), lin: typeof a.lin === 'string' ? a.lin.slice(0, 40) : null, par: a.par ?? null, born: clamp(a.born, 0, 1e7, 0),
      st: typeof a.st === 'string' ? a.st.slice(0, 20) : 'wander', tgtId: isNum(a.tgtId) ? a.tgtId : null,
      tk: clamp(a.tk, 0, 100, 0), cd: clamp(a.cd, 0, 1e6, 0), ac: clamp(a.ac, 0, 100, 0), bur: !!a.bur,
    }));
    const sp = {};
    for (const id of PLANT_IDS.concat(ANIMAL_IDS)) {
      const r = (S.species && S.species[id]) || {};
      sp[id] = {
        discovered: !!r.discovered, discoveredAt: isNum(r.discoveredAt) ? r.discoveredAt : null,
        founderGenome: r.founderGenome && typeof r.founderGenome === 'object' ? traits(r.founderGenome, SPECIES[id].kind === 'plant' ? PLANT_TRAITS : ANIMAL_TRAITS) : null,
        deaths: r.deaths && typeof r.deaths === 'object' ? r.deaths : {}, births: clamp(r.births, 0, 1e9, 0), kills: clamp(r.kills, 0, 1e9, 0),
        name: typeof r.name === 'string' ? r.name.slice(0, 60) : null, boom: !!r.boom, collapse: r.collapse || null, extinct: !!r.extinct,
        peak: clamp(r.peak, 0, 1e9, 0), nearExt: !!r.nearExt, traitFlags: r.traitFlags || {}, reproNoted: !!r.reproNoted, firstKillNoted: !!r.firstKillNoted,
        lastMutationT: isNum(r.lastMutationT) ? r.lastMutationT : null, lastPredDay: isNum(r.lastPredDay) ? r.lastPredDay : null,
      };
    }
    S.species = sp;
    S.lineages = S.lineages && typeof S.lineages === 'object' ? S.lineages : {};
    for (const k of Object.keys(S.lineages)) {
      const L = S.lineages[k];
      if (!L || !ANIMAL_IDS.concat(PLANT_IDS).includes(L.sp)) { delete S.lineages[k]; continue; }
      L.founder = traits(L.founder, SPECIES[L.sp].kind === 'plant' ? PLANT_TRAITS : ANIMAL_TRAITS);
      L.created = clamp(L.created, 0, 1e7, 0);
      L.count = clamp(L.count, 0, 1e9, 0);
    }
    S.ancestry = S.ancestry && typeof S.ancestry === 'object' ? S.ancestry : {};
    S.journal = (Array.isArray(S.journal) ? S.journal : []).filter((e) => e && typeof e.text === 'string' && typeof e.type === 'string').slice(-1500).map((e) => ({
      id: clamp(e.id, 0, 1e9, 0), t: clamp(e.t, 0, 1e7, 0), type: String(e.type).slice(0, 20), sp: ANIMAL_IDS.concat(PLANT_IDS).includes(e.sp) ? e.sp : null,
      lin: typeof e.lin === 'string' ? e.lin.slice(0, 40) : null, text: e.text.slice(0, 600), data: e.data && typeof e.data === 'object' ? e.data : {},
    }));
    const H = S.history || {};
    S.history = {
      every: 2,
      t: (Array.isArray(H.t) ? H.t : []).filter(isNum).slice(-900),
      counts: {},
      climate: { temp: (H.climate?.temp || []).filter(isNum).slice(-900), hum: (H.climate?.hum || []).filter(isNum).slice(-900), rain: (H.climate?.rain || []).filter(isNum).slice(-900) },
      traits: {},
    };
    for (const id of PLANT_IDS.concat(ANIMAL_IDS)) {
      S.history.counts[id] = (Array.isArray(H.counts?.[id]) ? H.counts[id] : []).filter(isNum).slice(-900);
      S.history.traits[id] = (Array.isArray(H.traits?.[id]) ? H.traits[id] : []).slice(-160);
    }
    S.pressures = (Array.isArray(S.pressures) ? S.pressures : []).filter((p) => p && ANIMAL_IDS.includes(p.sp) && isNum(p.until)).slice(0, 10);
    S.day = S.day && isNum(S.day.index) ? { index: S.day.index, births: S.day.births || {}, deaths: S.day.deaths || {}, kills: S.day.kills || {}, rain: clamp(S.day.rain, 0, 99, 0) } : { index: 0, births: {}, deaths: {}, kills: {}, rain: 0 };
    S.dayLog = Array.isArray(S.dayLog) ? S.dayLog.slice(-80) : [];
    S.lastSeen = S.lastSeen && typeof S.lastSeen === 'object' ? S.lastSeen : null;
    S.report = S.report && typeof S.report === 'object' ? S.report : null;
    return { ok: true, state: S };
  } catch (e) {
    return fail('Save data could not be read: ' + (e && e.message ? e.message : 'unknown error'));
  }
}

function traits(g, keys) {
  const o = {};
  for (const k of keys) o[k] = clamp(g && g[k], 0, 1, 0.5);
  return o;
}
function fail(msg) {
  return { ok: false, error: msg };
}
