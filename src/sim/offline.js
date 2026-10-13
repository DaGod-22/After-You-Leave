// Time away: the world keeps running at the same pace it runs when you watch it (1 sim hour every
// 20 real seconds), but the catch-up is bounded. Catch-up uses the same rules as live play at a
// coarser 7-minute resolution, so events are consistent with what the rules would produce.
import { World } from './world.js';
import { SPECIES, PLANT_IDS, ANIMAL_IDS } from './species.js';
import { EVENT_TYPES } from './journal.js';

export const SIM_HOURS_PER_REAL_SECOND = 1 / 20;
export const DT_LIVE = 0.02;
export const DT_CATCHUP = 0.12;
export const MAX_CATCHUP_HOURS = 240; // 10 simulated days per return

export function planCatchUp(S, nowMs = Date.now()) {
  const elapsedSec = Math.max(0, (nowMs - (S.savedAt || nowMs)) / 1000);
  const wanted = elapsedSec * SIM_HOURS_PER_REAL_SECOND;
  const hours = Math.min(wanted, MAX_CATCHUP_HOURS);
  return { elapsedSec, wantedHours: wanted, hours, truncated: wanted > MAX_CATCHUP_HOURS, dt: DT_CATCHUP, paused: !!S.paused };
}

/** Runs the catch-up in time-budgeted slices so the UI stays responsive. */
export class CatchUp {
  constructor(world, plan) {
    this.w = world;
    this.plan = plan;
    this.S = world.S;
    this.startTime = this.S.time;
    this.startSeq = this.S.seq || 0;
    this.startH = this.S.history.t.length;
    this.startCounts = world.countsSnapshot();
    this.before = snapshotCounters(this.S);
    this.target = this.startTime + plan.hours;
    this.done = plan.hours <= 0;
    this.minCounts = { ...this.startCounts };
    this.maxCounts = { ...this.startCounts };
  }
  get progress() {
    if (this.plan.hours <= 0) return 1;
    return Math.min(1, (this.S.time - this.startTime) / this.plan.hours);
  }
  /** Advance for up to budgetMs. Returns true when finished. */
  advance(budgetMs = 14) {
    const t0 = performance.now();
    while (!this.done) {
      const remaining = this.target - this.S.time;
      if (remaining <= 1e-6) { this.done = true; break; }
      const dt = Math.min(this.plan.dt, remaining);
      this.w.step(dt);
      if (performance.now() - t0 > budgetMs) break;
    }
    if (this.S.time >= this.target - 1e-6) this.done = true;
    return this.done;
  }
  finish() {
    const S = this.S;
    const hist = S.history;
    const idxStart = hist.t.findIndex((t) => t >= this.startTime - 1e-6);
    const from = idxStart < 0 ? hist.t.length : idxStart;
    const counts = {};
    for (const sp of PLANT_IDS.concat(ANIMAL_IDS)) {
      const arr = (hist.counts[sp] || []).slice(from);
      counts[sp] = {
        start: this.startCounts[sp] || 0,
        end: this.w.countsSnapshot()[sp] || 0,
        min: arr.length ? Math.min(...arr, this.startCounts[sp] || 0) : this.startCounts[sp] || 0,
        max: arr.length ? Math.max(...arr, this.startCounts[sp] || 0) : this.startCounts[sp] || 0,
      };
    }
    const after = snapshotCounters(S);
    const births = {}, deaths = {}, kills = {};
    for (const sp of PLANT_IDS.concat(ANIMAL_IDS)) {
      births[sp] = (after.births[sp] || 0) - (this.before.births[sp] || 0);
      kills[sp] = (after.kills[sp] || 0) - (this.before.kills[sp] || 0);
      deaths[sp] = {};
      const causes = new Set([...Object.keys(after.deaths[sp] || {}), ...Object.keys(this.before.deaths[sp] || {})]);
      for (const c of causes) {
        const d = (after.deaths[sp]?.[c] || 0) - (this.before.deaths[sp]?.[c] || 0);
        if (d > 0) deaths[sp][c] = d;
      }
    }
    const climateArr = (k) => (hist.climate[k] || []).slice(from);
    const temps = climateArr('temp'), hums = climateArr('hum'), rains = climateArr('rain');
    const rainSamples = rains.filter((r) => r > 0).length;
    const climate = {
      tempMin: temps.length ? Math.min(...temps) : null,
      tempMax: temps.length ? Math.max(...temps) : null,
      humMin: hums.length ? Math.min(...hums) : null,
      humMax: hums.length ? Math.max(...hums) : null,
      rainHours: +(rainSamples * 2).toFixed(1),
      startHum: this.startHum ?? null,
      endHum: S.climate.humidity,
    };
    const events = S.journal.filter((e) => e.id > this.startSeq && e.type !== 'survey').map((e) => ({ ...e }));
    const lineages = Object.values(S.lineages).filter((L) => L.created >= this.startTime - 1e-6).map((L) => ({ id: L.id, sp: L.sp, parent: L.parent, created: L.created }));
    const report = {
      id: 'r' + Math.round(Date.now()).toString(36),
      createdAt: Date.now(),
      elapsedSec: +this.plan.elapsedSec.toFixed(1),
      wantedHours: +this.plan.wantedHours.toFixed(1),
      simHours: +(S.time - this.startTime).toFixed(2),
      truncated: this.plan.truncated,
      dt: this.plan.dt,
      startTime: +this.startTime.toFixed(2),
      endTime: +S.time.toFixed(2),
      counts,
      births,
      deaths,
      kills,
      climate,
      events,
      lineages,
      approximation: `Catch-up uses ${(this.plan.dt * 60).toFixed(0)}-minute steps with the same rules as live play. Individual encounters are resolved at that resolution.`,
    };
    S.report = report;
    return report;
  }
}

function snapshotCounters(S) {
  const births = {}, kills = {}, deaths = {};
  for (const sp of PLANT_IDS.concat(ANIMAL_IDS)) {
    const r = S.species[sp] || {};
    births[sp] = r.births || 0;
    kills[sp] = r.kills || 0;
    deaths[sp] = { ...(r.deaths || {}) };
  }
  return { births, kills, deaths };
}

export function eventLabel(type) {
  return EVENT_TYPES[type] || type;
}
export { World, SPECIES };
