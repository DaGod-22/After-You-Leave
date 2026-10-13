// Balance sweep: runs the live simulation rules for several seeds and prints population snapshots.
// Usage: node tools/balance-sweep.mjs [seed,seed,...] [days]
import { World } from '../src/sim/world.js';

const seeds = (process.argv[2] || '42,99,7,2024,1,5,11,333').split(',').map(Number);
const days = +(process.argv[3] || 120);
const keys = ['grazer', 'stalker', 'mire', 'skimmer', 'lumen', 'veilmoss'];
for (const seed of seeds) {
  const w = World.create({ name: 'Sweep', seed, now: 1 });
  const rows = [];
  for (let d = 0; d <= days; d++) {
    if (d > 0) w.runSteps(199, 0.12);
    if (d % 30 === 0) {
      const c = w.countsSnapshot();
      rows.push(`d${d}: ` + keys.map((k) => `${k.slice(0, 3)} ${c[k]}`).join(' · '));
    }
  }
  console.log(`seed ${seed}\n  ${rows.join('\n  ')}`);
}
