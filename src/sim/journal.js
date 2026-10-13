// Field journal: turns simulation facts into timestamped, grounded events.
// Every event text is built from numbers the simulation actually holds at that moment.
import { SPECIES, PLANT_IDS, ANIMAL_IDS } from './species.js';
import { animalPhenotype, plantPhenotype, camoMatch, traitKeys, pigment } from './genome.js';
import { TRAIT_LABELS } from './species.js';

export const JOURNAL_MAX = 1500;
const HABITAT_TRAITS = new Set(['waterNeed', 'heatTol', 'camo', 'hue', 'stature', 'droughtTol']);
export const EVENT_TYPES = {
  survey: 'Survey',
  discovery: 'First observation',
  reproduction: 'Reproduction',
  mutation: 'Mutation',
  lineage: 'New lineage',
  shift: 'Trait shift',
  adaptation: 'Habitat adaptation',
  boom: 'Population boom',
  collapse: 'Population collapse',
  extinction: 'Extinction',
  recovery: 'Recovery',
  predation: 'Predation',
  weather: 'Weather',
  intervention: 'Your intervention',
};

export function noteEvent(w, type, sp, text, data = {}, lin = null) {
  const S = w.S;
  S.seq = (S.seq || 0) + 1;
  S.journal.push({ id: S.seq, t: Math.round(S.time * 100) / 100, type, sp, lin, text, data });
  if (S.journal.length > JOURNAL_MAX) S.journal.splice(0, S.journal.length - JOURNAL_MAX);
}

const CHILD_KEYS = { animal: traitKeys('animal'), plant: traitKeys('plant') };
const TRAIT_SHORT = { ...TRAIT_LABELS };
export function describeTrait(t) {
  return TRAIT_SHORT[t] || t;
}

/** Called for each birth. Records first reproduction and notable mutations. */
export function noteBirth(w, child, parent, mate, lin) {
  const S = w.S;
  const rec = S.species[child.sp];
  const spd = SPECIES[child.sp];
  if (!rec.reproNoted) {
    rec.reproNoted = true;
    noteEvent(w, 'reproduction', child.sp, `First recorded reproduction: ${spd.common} ${spd.kind === 'plant' ? 'dispersed a seed' : 'produced offspring'} at ${fmtT(S.time)}. Its descendants will show whatever traits inheritance preserves.`, { id: child.id }, lin);
  }
  const keys = CHILD_KEYS[spd.kind];
  let big = null;
  for (const k of keys) {
    const d = (child.g[k] ?? 0) - (parent.g[k] ?? 0);
    if (Math.abs(d) > 0.16 && (!big || Math.abs(d) > Math.abs(big.d))) big = { k, d };
  }
  if (big && (rec.lastMutationT == null || S.time - rec.lastMutationT > 12)) {
    rec.lastMutationT = S.time;
    const v = child.g[big.k];
    noteEvent(
      w,
      'mutation',
      child.sp,
      `New mutation in ${spd.common}${lin ? ' (' + lin + ')' : ''}: ${describeTrait(big.k)} ${big.d > 0 ? 'jumped up' : 'dropped'} to ${(v * 100).toFixed(0)}% (parent ${((v - big.d) * 100).toFixed(0)}%). Offspring inherit it; whether it persists depends on survival.`,
      { id: child.id, trait: big.k, delta: +big.d.toFixed(3) },
      lin,
    );
  }
}

export function fmtT(t) {
  const d = Math.floor(t / 24);
  const h = Math.floor(t - d * 24);
  return `day ${d + 1}, ${String(h).padStart(2, '0')}:00`;
}

/** Population-level checks each sample (every 2 sim hours). */
export function analyseSample(w, counts) {
  const S = w.S;
  const H = S.history.counts;
  const idxBack = (sp, back) => {
    const arr = H[sp];
    return arr && arr.length > back ? arr[arr.length - 1 - back] : undefined;
  };
  for (const sp of PLANT_IDS.concat(ANIMAL_IDS)) {
    const rec = S.species[sp];
    if (!rec.discovered) continue;
    const c = counts[sp] || 0;
    const name = SPECIES[sp].common;
    rec.peak = Math.max(rec.peak || 0, c);
    const prev = idxBack(sp, 1);
    // extinction / reappearance
    if (c === 0 && prev > 0 && !rec.extinct) {
      rec.extinct = true;
      noteEvent(w, 'extinction', sp, `${name} has disappeared from the basin. It peaked at ${rec.peak} individuals. Context: ${context(w, sp)}`, { peak: rec.peak }, null);
    } else if (c > 0 && rec.extinct) {
      rec.extinct = false;
      noteEvent(w, 'recovery', sp, `${name} reappeared (${c} individuals). Something survived or re-entered the basin.`, { c }, null);
    }
    // recent window
    const arr = H[sp] || [];
    const win = arr.slice(-60);
    const winMax = win.length ? Math.max(...win) : 0;
    if (!rec.collapse && c > 0 && winMax >= 12 && c <= 0.5 * winMax) {
      rec.collapse = { from: winMax, t: S.time };
      noteEvent(w, 'collapse', sp, `${name} collapsed from ${winMax} to ${c} in about ${Math.round((win.length) * 2 / 24 * 10) / 10} days. ${context(w, sp)}`, { from: winMax, to: c }, null);
    }
    if (rec.collapse && c >= 0.85 * rec.collapse.from) {
      noteEvent(w, 'recovery', sp, `${name} has recovered to ${c} individuals, close to its earlier level of ${rec.collapse.from}.`, { from: rec.collapse.from, to: c }, null);
      rec.collapse = null;
    }
    if (c > 0 && c <= 3 && rec.peak >= 15 && !rec.nearExt) {
      rec.nearExt = true;
      noteEvent(w, 'collapse', sp, `${name} is down to ${c} individuals, a near-extinction. ${context(w, sp)}`, { c }, null);
    } else if (c > 8) rec.nearExt = false;
    // boom (vs three days ago)
    const ref = idxBack(sp, 36);
    if (!rec.boom && ref !== undefined && c >= 1.7 * ref && c - ref >= 8) {
      rec.boom = true;
      noteEvent(w, 'boom', sp, `${name} boomed from ${ref} to ${c} over three days. ${context(w, sp)}`, { from: ref, to: c }, null);
    } else if (rec.boom && ref !== undefined && c <= 1.25 * ref) {
      rec.boom = false;
    }
  }
  // climate thresholds (logged once per episode)
  const hum = S.climate.humidity;
  if (hum < 0.2 && !S.climate.droughtNoted) {
    S.climate.droughtNoted = true;
    noteEvent(w, 'weather', null, `Drought: air humidity has fallen to ${(hum * 100).toFixed(0)}%. Surface moisture is drying and plants will start to stress.`, { hum: +hum.toFixed(2) });
  } else if (hum > 0.4) S.climate.droughtNoted = false;
  if (w.temp > 30 && !S.climate.heatNoted) {
    S.climate.heatNoted = true;
    noteEvent(w, 'weather', null, `Heat: air temperature reached ${w.temp.toFixed(1)}°C. Animals without shade or water will suffer.`, { temp: +w.temp.toFixed(1) });
  } else if (w.temp < 26) S.climate.heatNoted = false;
}

/** Short grounded explanation of what supports or limits a species. */
export function context(w, sp) {
  const S = w.S;
  const spd = SPECIES[sp];
  if (spd.kind === 'plant') {
    const sizes = S.plants.filter((p) => p.sp === sp);
    const avg = sizes.length ? sizes.reduce((s, p) => s + p.size, 0) / sizes.length : 0;
    const dry = w.S.climate.humidity < 0.3 ? ' Dry air is limiting growth.' : '';
    return `Mean size ${avg.toFixed(2)} across ${sizes.length} plants.${dry}`;
  }
  const herb = spd.diet.filter((d) => SPECIES[d].kind === 'plant');
  const prey = spd.diet.filter((d) => SPECIES[d].kind === 'animal');
  const food = S.plants.filter((p) => herb.includes(p.sp) && p.size > 0.08).length;
  const preyN = S.animals.filter((a) => prey.includes(a.sp)).length;
  const parts = [];
  if (herb.length) parts.push(`food plants in reach: ${food}`);
  if (prey.length) parts.push(`prey in basin: ${preyN}`);
  const kills = S.species[sp].kills || 0;
  if (prey.length) parts.push(`lifetime kills: ${kills}`);
  return parts.join('; ') + '.';
}

/** Daily: trait drift vs founders, predation pattern, and per-day history for the trait charts. */
export function analyseDay(w) {
  const S = w.S;
  const dayNow = S.day.index;
  for (const sp of PLANT_IDS.concat(ANIMAL_IDS)) {
    const rec = S.species[sp];
    if (!rec.discovered || !rec.founderGenome) continue;
    const tm = w.traitMeans(sp);
    if (!tm || tm.n < 4) continue;
    const H = S.history.traits[sp] = S.history.traits[sp] || [];
    H.push({ t: Math.round(S.time), n: tm.n, m: roundMeans(tm.means) });
    if (H.length > 160) H.shift();
    rec.traitFlags = rec.traitFlags || {};
    for (const k of Object.keys(tm.means)) {
      const cur = tm.means[k];
      const base = rec.founderGenome[k];
      const anchor = rec.traitFlags[k] ?? base;
      if (Math.abs(cur - anchor) > 0.1 && Math.abs(cur - base) > 0.1) {
        rec.traitFlags[k] = cur;
        const dir = cur > base ? 'higher' : 'lower';
        const type = HABITAT_TRAITS.has(k) ? 'adaptation' : 'shift';
        noteEvent(
          w,
          type,
          sp,
          `${SPECIES[sp].common}: mean ${describeTrait(k).toLowerCase()} is now ${(cur * 100).toFixed(0)}% (founders ${(base * 100).toFixed(0)}%), ${dir}. ${evidence(w, sp, k, base, cur)}`,
          { trait: k, from: +base.toFixed(3), to: +cur.toFixed(3), n: tm.n },
          null,
        );
      } else if (rec.traitFlags[k] === undefined) {
        rec.traitFlags[k] = anchor;
      }
    }
  }
  // Predation pattern: a predator with several kills in the completed day
  for (const sp of ANIMAL_IDS) {
    const kills = S.day.kills[sp] || 0;
    const rec = S.species[sp];
    if (kills >= 3 && (rec.lastPredDay ?? -9) < dayNow - 2) {
      rec.lastPredDay = dayNow;
      noteEvent(w, 'predation', sp, `${SPECIES[sp].common} made ${kills} kills during day ${dayNow}. Prey numbers and camouflage decide how much of the population is lost.`, { kills }, null);
    }
  }
}

function roundMeans(m) {
  const o = {};
  for (const k of Object.keys(m)) o[k] = +m[k].toFixed(3);
  return o;
}

/** Explains a trait shift using phenotype consequences computed from the founder and current means. */
export function evidence(w, sp, k, base, cur) {
  const spd = SPECIES[sp];
  const fg = {}, cg = {};
  const keys = traitKeys(spd.kind);
  const rec = w.S.species[sp];
  const founder = rec.founderGenome;
  for (const kk of keys) {
    fg[kk] = founder[kk] ?? 0.5;
    cg[kk] = w.traitMeans(sp)?.means?.[kk] ?? fg[kk];
  }
  const f = (g) => (spd.kind === 'animal' ? animalPhenotype(sp, g) : plantPhenotype(sp, g));
  const a = f(fg), b = f(cg);
  const r = (x) => x.toFixed(2);
  switch (k) {
    case 'legLen':
      return `Longer legs change top speed from ${r(a.maxSpeed)} to ${r(b.maxSpeed)} units/h, while metabolic cost goes ${r(a.metab * 100)} → ${r(b.metab * 100)} per 100 h.`;
    case 'shell':
      return `Shell defence against capture goes ${r(a.shellDefence)} → ${r(b.shellDefence)}, at a top-speed cost of ${r(a.maxSpeed)} → ${r(b.maxSpeed)}.`;
    case 'speed':
      return `Top speed ${r(a.maxSpeed)} → ${r(b.maxSpeed)} units/h, with metabolic cost ${r(a.metab * 100)} → ${r(b.metab * 100)} per 100 h.`;
    case 'eff':
      return `Energy cost per hour ${r(a.metab * 100)} → ${r(b.metab * 100)} per 100 h.`;
    case 'camo': {
      const gh = avgGroundHue(w);
      const ma = camoMatch(fg.hue, gh) * fg.camo, mb = camoMatch(cg.hue, gh) * cg.camo;
      return `Camouflage match against typical ground (${r(gh)} on the pigment scale) goes ${(ma * 100).toFixed(0)}% → ${(mb * 100).toFixed(0)}%. Predators detect well-matched prey less often.`;
    }
    case 'hue': {
      const gh = avgGroundHue(w);
      const ma = camoMatch(fg.hue, gh), mb = camoMatch(cg.hue, gh);
      return `Pigment ${pigmentName(fg.hue)} → ${pigmentName(cg.hue)}. Ground match ${(ma * 100).toFixed(0)}% → ${(mb * 100).toFixed(0)}%.`;
    }
    case 'waterNeed':
      return `Water loss per hour ${r(a.waterLoss * 100)} → ${r(b.waterLoss * 100)} (×100). Drier ground favours low values.`;
    case 'heatTol':
      return `Thermal optimum moves ${r(a.tempOpt)}°C → ${r(b.tempOpt)}°C, tolerance ±${r(a.tempTol)} → ±${r(b.tempTol)}°C.`;
    case 'fert':
      return `Breeding interval ${r(a.breedCD)} → ${r(b.breedCD)} h, litter size ${a.litter} → ${b.litter}.`;
    case 'life':
      return `Expected lifespan ${Math.round(a.lifespan)} → ${Math.round(b.lifespan)} h.`;
    case 'sense':
      return `Sensory range ${r(a.senseRange)} → ${r(b.senseRange)} units.`;
    case 'size':
      return `Body length ${r(a.bodyLen)} → ${r(b.bodyLen)} units, with a larger daily food requirement.`;
    case 'stature':
      return `Plant height ${r(a.height)} → ${r(b.height)}. Taller plants cast more shade and need more moisture.`;
    case 'droughtTol':
      return `Drought damage factor ${r(a.droughtFactor)} → ${r(b.droughtFactor)}.`;
    case 'vigor':
      return `Growth rate ${r(a.growth)} → ${r(b.growth)} per hour, with shorter expected lifespans.`;
    default:
      return `Effect on ${describeTrait(k).toLowerCase()} is recorded in the trait chart.`;
  }
}

function avgGroundHue(w) {
  let s = 0;
  for (let i = 0; i < w.groundHue.length; i++) s += w.groundHue[i];
  return s / w.groundHue.length;
}
function pigmentName(v) {
  if (v < 0.2) return 'pale sand';
  if (v < 0.4) return 'umber';
  if (v < 0.55) return 'sage';
  if (v < 0.75) return 'jade';
  return 'deep teal';
}
