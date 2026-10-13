// Weather and drifting-spore particle effects. All are cheap CPU-updated buffers.
import * as THREE from 'three';

export class Weather {
  constructor(scene) {
    this.n = 2200;
    this.pos = new Float32Array(this.n * 6);
    this.vy = new Float32Array(this.n);
    this.seed = new Float32Array(this.n);
    this.box = { x: 0, z: 0 };
    for (let i = 0; i < this.n; i++) this.respawn(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.LineBasicMaterial({ color: 0xbfd6cf, transparent: true, opacity: 0, depthWrite: false });
    this.lines = new THREE.LineSegments(g, this.mat);
    this.lines.frustumCulled = false;
    this.lines.visible = false;
    scene.add(this.lines);

    // Drifting spores / pollen motes
    this.m = 500;
    this.mp = new Float32Array(this.m * 3);
    this.ms = new Float32Array(this.m);
    for (let i = 0; i < this.m; i++) { this.ms[i] = Math.random() * 6.28; this.setMote(i); }
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.mp, 3));
    this.motes = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xf0d9a0, size: 0.35, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false }));
    this.motes.frustumCulled = false;
    scene.add(this.motes);
    this.level = 0;
  }
  respawn(i, initial = false) {
    const b = this.pos;
    const x = this.box.x + (Math.random() - 0.5) * 120, z = this.box.z + (Math.random() - 0.5) * 120;
    const y = initial ? Math.random() * 40 : 40 + Math.random() * 10;
    const len = 1.4 + Math.random() * 0.8;
    b[i * 6] = x; b[i * 6 + 1] = y; b[i * 6 + 2] = z;
    b[i * 6 + 3] = x - 0.3 * len * 0.25; b[i * 6 + 4] = y - len; b[i * 6 + 5] = z;
    this.vy[i] = 26 + Math.random() * 10;
    this.seed[i] = len;
  }
  setMote(i) {
    this.mp[i * 3] = (Math.random() - 0.5) * 140;
    this.mp[i * 3 + 1] = 0.5 + Math.random() * 14;
    this.mp[i * 3 + 2] = (Math.random() - 0.5) * 140;
  }
  /** Share of raindrops drawn (quality setting). */
  setDensity(f) {
    this.lines.geometry.setDrawRange(0, Math.round(this.n * 2 * f));
  }
  update(dt, t, rain, daylight, center) {
    this.level += (rain - this.level) * Math.min(1, dt * 2);
    const L = this.level;
    this.lines.visible = L > 0.01;
    this.mat.opacity = 0.42 * L;
    if (this.lines.visible) {
      const b = this.pos;
      this.box.x = center.x; this.box.z = center.z;
      for (let i = 0; i < this.n; i++) {
        if (Math.random() > L + 0.05 && i % 3 === 0) continue;
        const dy = this.vy[i] * dt;
        b[i * 6 + 1] -= dy; b[i * 6 + 4] -= dy;
        b[i * 6] -= 0.5 * dy; b[i * 6 + 3] -= 0.5 * dy;
        if (b[i * 6 + 4] < 0) this.respawn(i);
        if (Math.abs(b[i * 6] - center.x) > 65 || Math.abs(b[i * 6 + 2] - center.z) > 65) this.respawn(i);
      }
      this.lines.geometry.attributes.position.needsUpdate = true;
    }
    this.motes.material.opacity = 0.55 * daylight;
    this.motes.visible = daylight > 0.02;
    for (let i = 0; i < this.m; i++) {
      this.ms[i] += dt * 0.15;
      this.mp[i * 3] += Math.sin(this.ms[i]) * dt * 0.35 + 0.05 * dt;
      this.mp[i * 3 + 1] += Math.cos(this.ms[i] * 1.3) * dt * 0.08;
      this.mp[i * 3 + 2] += Math.cos(this.ms[i]) * dt * 0.3;
      if (this.mp[i * 3 + 1] < 0.4 || this.mp[i * 3 + 1] > 16) this.setMote(i);
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
  }
}
