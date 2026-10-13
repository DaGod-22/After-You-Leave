// Weather, humidity and the moisture / nutrient field of the ecological grid.
import { clamp, smoothstep } from './math.js';
import { CELLS } from './terrain.js';
import { noteEvent } from './journal.js';

export const SEASON_HOURS = 24 * 40;

export function stepClimate(w, dt) {
  const S = w.S;
  const c = S.climate;
  const t = S.time;
  const hour = ((t % 24) + 24) % 24;
  const diurnal = 5.2 * Math.sin((2 * Math.PI * (hour - 9)) / 24);
  const seasonal = 2.4 * Math.sin((2 * Math.PI * t) / SEASON_HOURS);
  const rainI = c.rain.on ? c.rain.intensity : 0;
  w.temp = clamp(17 + diurnal + seasonal + c.offset - 2.5 * rainI, -6, 42);

  // Rain state machine
  if (c.rain.on) {
    c.rain.intensity = clamp(c.rain.intensity + w.rng.range(-0.04, 0.04) * dt * 4, 0.25, 1);
    S.day.rain += dt;
    if (t >= c.rain.until) {
      c.rain = { on: false, intensity: 0, until: 0 };
      c.lastRainEnd = t;
    }
  } else if (t >= c.nextRainCheck) {
    c.nextRainCheck = t + 6;
    const season = Math.sin((2 * Math.PI * t) / SEASON_HOURS);
    const p = clamp(0.2 + 0.45 * (1 - c.humidity) + 0.08 * season, 0.05, 0.85);
    if (w.rng.chance(p)) {
      const dry = c.lastRainEnd == null ? 999 : t - c.lastRainEnd;
      c.rain = { on: true, intensity: w.rng.range(0.45, 0.9), until: t + w.rng.range(2, 9) };
      if (dry > 30) noteEvent(w, 'weather', null, `Rain returned after ${Math.round(dry)} hours without it (${c.rain.intensity > 0.7 ? 'heavy' : 'steady'}). Moisture will rise in low ground first.`, { intensity: +c.rain.intensity.toFixed(2) });
    }
  }
  // Humidity: rain feeds it, dry air and heat draw it down
  c.humidity = clamp(c.humidity + (rainI * 0.035 + (0.5 - c.humidity) * 0.03 - Math.max(0, w.temp - 20) * 0.0018) * dt, 0, 1);
  // Springs expire
  if (c.springs.length) c.springs = c.springs.filter((s) => s.until > t);
}

/** Moisture relaxes toward a terrain- and climate-dependent target, with rain pulses and springs. */
export function updateGrid(w, dt) {
  const S = w.S;
  const c = S.climate;
  const N = CELLS * CELLS;
  const rainI = c.rain.on ? c.rain.intensity : 0;
  const hum = c.humidity;
  const springs = c.springs;
  for (let ci = 0; ci < N; ci++) {
    if (w.cellDepth[ci] > 0) {
      w.moist[ci] = 1;
      continue;
    }
    const T = w.tempAt(ci);
    let target = w.baseWet[ci] * (0.5 + 0.5 * hum) + rainI * 0.3;
    for (const sp of springs) {
      const d = Math.hypot(w.cellCX[ci] - sp.x, w.cellCZ[ci] - sp.z);
      if (d < 7) target = Math.max(target, 0.85 * (1 - d / 7) + 0.05);
    }
    const rate = 0.09 + 0.035 * Math.max(0, T - 16) / 4;
    let m = w.moist[ci] + (target - w.moist[ci]) * Math.min(1, rate * dt);
    if (rainI > 0) m += rainI * 0.12 * dt;
    w.moist[ci] = clamp(m, 0, 1);
    // Nutrients slowly leach back toward the baseline
    const base = 0.3 + 0.2 * w.baseShade[ci];
    w.nut[ci] += (base - w.nut[ci]) * Math.min(1, 0.008 * dt);
  }
  // Light diffusion so moisture and nutrients look like soils, not pixels.
  const tmp = w.tmpMoist || (w.tmpMoist = new Float32Array(N));
  for (let j = 0; j < CELLS; j++) {
    for (let i = 0; i < CELLS; i++) {
      const ci = j * CELLS + i;
      let s = w.moist[ci] * 4, k = 4;
      if (i > 0) { s += w.moist[ci - 1]; k++; }
      if (i < CELLS - 1) { s += w.moist[ci + 1]; k++; }
      if (j > 0) { s += w.moist[ci - CELLS]; k++; }
      if (j < CELLS - 1) { s += w.moist[ci + CELLS]; k++; }
      tmp[ci] = s / k;
    }
  }
  for (let ci = 0; ci < N; ci++) {
    if (w.cellDepth[ci] > 0) continue;
    w.moist[ci] = w.moist[ci] * 0.8 + tmp[ci] * 0.2;
  }
  void smoothstep;
}
