import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim/world.js';
import { validateState } from '../src/sim/serialize.js';
import { CatchUp, planCatchUp } from '../src/sim/offline.js';

test('world creates with life and survey events', () => {
  const w = World.create({ name: 'Test', seed: 12345 });
  const c = w.countsSnapshot();
  assert.ok(c.veilmoss > 20, 'moss present ' + c.veilmoss);
  assert.ok(c.grazer > 10, 'grazers present ' + c.grazer);
  assert.ok(w.S.journal.length > 5);
});

test('deterministic from the same seed', () => {
  const a = World.create({ name: 'A', seed: 777, now: 1 });
  const b = World.create({ name: 'A', seed: 777, now: 1 });
  a.runSteps(200, 0.1);
  b.runSteps(200, 0.1);
  assert.deepEqual(a.countsSnapshot(), b.countsSnapshot());
  assert.equal(a.S.time, b.S.time);
});

test('long run stays bounded and ecologically plausible', () => {
  const w = World.create({ name: 'Long', seed: 42, now: 1 });
  const t0 = Date.now();
  const rows = [];
  for (let day = 0; day < 20; day++) {
    w.runSteps(Math.round(24 / 0.12), 0.12);
    rows.push({ day, ...w.countsSnapshot() });
  }
  const ms = Date.now() - t0;
  console.log('20 sim days in ms', ms);
  for (const r of rows.filter((_, i) => i % 4 === 0 || i === rows.length - 1)) console.log(JSON.stringify(r));
  const last = rows[rows.length - 1];
  assert.ok(last.veilmoss > 0 || last.spirefern > 0, 'producers survive');
  assert.ok(Object.values(last).reduce((s, v) => s + v, 0) < 2000, 'bounded');
});

test('save round trip validates', () => {
  const w = World.create({ name: 'Save', seed: 99, now: 5 });
  w.runSteps(50, 0.1);
  const S = JSON.parse(JSON.stringify(w.toState()));
  const v = validateState(S);
  assert.ok(v.ok, v.error);
  const w2 = World.from(v.state);
  assert.deepEqual(w2.countsSnapshot(), w.countsSnapshot());
});

test('malformed save is rejected', () => {
  assert.equal(validateState(null).ok, false);
  assert.equal(validateState({ format: 1, id: 'x', seed: 'abc' }).ok, false);
  assert.equal(validateState({ format: 99 }).ok, false);
});

test('catch-up advances time bounded and produces a report', () => {
  const w = World.create({ name: 'Away', seed: 2024, now: 1000 });
  w.S.savedAt = 1000;
  const plan = planCatchUp(w.S, 1000 + 20 * 60 * 1000); // 20 real minutes away → 60 sim hours
  assert.ok(Math.abs(plan.hours - 60) < 1e-6, 'plan hours ' + plan.hours);
  const cu = new CatchUp(w, plan);
  const t0 = Date.now();
  while (!cu.advance(50));
  const rep = cu.finish();
  console.log('catch-up 60h ms', Date.now() - t0, 'events', rep.events.length, 'births', JSON.stringify(rep.births));
  assert.ok(Math.abs(rep.simHours - 60) < 0.2);
});
