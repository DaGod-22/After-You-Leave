// Orbit camera: drag to orbit, right-drag or shift-drag to pan, wheel/pinch to zoom,
// WASD/arrows to pan, Q/E to turn, R to reset, and follow mode locked onto a creature.
import * as THREE from 'three';

const MIN_DIST = 4, MAX_DIST = 170, MIN_PITCH = 0.1, MAX_PITCH = 1.42;
const HALF = 78;

export class OrbitCam {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 2, 0);
    this.goal = this.target.clone();
    this.yaw = 0.7; this.goalYaw = 0.7;
    this.pitch = 0.75; this.goalPitch = 0.75;
    this.dist = 90; this.goalDist = 90;
    this.follow = null; // () => {x,y,z} | null
    this.keys = new Set();
    this.drag = null;
    this.moved = 0;
    this.onClickCandidate = null;
    this._bind();
  }
  _bind() {
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.button !== 2) return;
      this.drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, id: e.pointerId };
      this.moved = 0;
      d.setPointerCapture?.(e.pointerId);
    });
    d.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      this.moved += Math.abs(dx) + Math.abs(dy);
      if (this.drag.pan) this.panBy(-dx * this.goalDist * 0.0017, dy * this.goalDist * 0.0017);
      else {
        this.goalYaw -= dx * 0.005;
        this.goalPitch = clamp(this.goalPitch + dy * 0.004, MIN_PITCH, MAX_PITCH);
      }
      if (this.drag.pan && this.moved > 4) this.follow = null;
    });
    const end = (e) => {
      if (this.drag && this.moved <= 4 && e.type === 'pointerup' && this.onClickCandidate) this.onClickCandidate(e);
      this.drag = null;
    };
    d.addEventListener('pointerup', end);
    d.addEventListener('pointercancel', () => { this.drag = null; });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.goalDist = clamp(this.goalDist * Math.exp(e.deltaY * 0.0012), MIN_DIST, MAX_DIST);
    }, { passive: false });
    this._kd = (e) => { if (isTyping(e)) return; this.keys.add(e.key.toLowerCase()); if (e.key.toLowerCase() === 'r' && !e.ctrlKey && !e.metaKey) this.reset(); };
    this._ku = (e) => this.keys.delete(e.key.toLowerCase());
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
    window.addEventListener('blur', () => this.keys.clear());
  }
  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
  }
  panBy(sx, sz) {
    // screen-space pan on the ground plane
    const fx = -Math.sin(this.goalYaw), fz = -Math.cos(this.goalYaw);
    const rx = Math.cos(this.goalYaw), rz = -Math.sin(this.goalYaw);
    this.goal.x += rx * sx + fx * sz;
    this.goal.z += rz * sx + fz * sz;
  }
  reset() {
    this.follow = null;
    this.goal.set(0, 2, 0);
    this.goalYaw = 0.7; this.goalPitch = 0.75; this.goalDist = 90;
  }
  focus(x, z, dist) {
    this.goal.set(x, 1.5, z);
    if (dist) this.goalDist = dist;
  }
  setFollow(fn) {
    this.follow = fn ? { fn, keep: fn } : null;
  }
  update(dt, terrain, sim) {
    // keyboard
    const k = this.keys;
    const sp = (k.has('shift') ? 2.2 : 1) * dt * this.goalDist * 0.55;
    let ix = 0, iz = 0;
    if (k.has('w') || k.has('arrowup')) iz -= 1;
    if (k.has('s') || k.has('arrowdown')) iz += 1;
    if (k.has('a') || k.has('arrowleft')) ix -= 1;
    if (k.has('d') || k.has('arrowright')) ix += 1;
    if (ix || iz) {
      this.follow = null;
      this.panBy(ix * sp, iz * sp);
    }
    if (k.has('q')) this.goalYaw += dt * 1.4;
    if (k.has('e')) this.goalYaw -= dt * 1.4;
    if (this.follow) {
      const p = this.follow.fn();
      if (p) this.goal.set(p.x, p.y + 1, p.z);
      else this.follow = null;
    }
    this.goal.x = clamp(this.goal.x, -HALF, HALF);
    this.goal.z = clamp(this.goal.z, -HALF, HALF);
    const kk = 1 - Math.exp(-dt * (this.follow ? 6 : 5));
    this.target.lerp(this.goal, kk);
    this.yaw += (this.goalYaw - this.yaw) * kk;
    this.pitch += (this.goalPitch - this.pitch) * kk;
    this.dist += (this.goalDist - this.dist) * kk;
    const cp = Math.cos(this.pitch);
    const pos = new THREE.Vector3(
      this.target.x + this.dist * cp * Math.sin(this.yaw),
      this.target.y + this.dist * Math.sin(this.pitch),
      this.target.z + this.dist * cp * Math.cos(this.yaw));
    const floorY = terrain.heightAt(pos.x, pos.z) + 1.2;
    if (pos.y < floorY) pos.y = floorY;
    this.cam.position.copy(pos);
    this.cam.lookAt(this.target);
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
