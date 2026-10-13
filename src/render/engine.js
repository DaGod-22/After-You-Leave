// Owns the WebGL renderer, lights, sky and the views of the current world.
// It reads simulation state only; it never mutates the world.
import * as THREE from 'three';
import { makeMaterials, buildGeometries } from './parts.js';
import { TerrainView } from './terrain-view.js';
import { LifeView } from './life-view.js';
import { Sky } from './sky.js';
import { Weather } from './fx.js';
import { OrbitCam } from './camera.js';
import { daylightAt } from '../sim/world.js';

const C = (h) => new THREE.Color(h);
const DAY = { top: C(0x2d5f69), hor: C(0xcdbf99), amb: C(0xcfe3dc), ground: C(0x3a3427), sun: C(0xfff1d8) };
const DUSK = { top: C(0x3c4a57), hor: C(0xd29a68), amb: C(0xd9bfa6), ground: C(0x3b2e25), sun: C(0xffb273) };
const NIGHT = { top: C(0x0a1417), hor: C(0x1b2b2e), amb: C(0x3a5a5e), ground: C(0x111b1b), sun: C(0x8fb4c8) };

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xcdbf99, 150, 420);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.3, 1200);
    this.hemi = new THREE.HemisphereLight(0xcfe3dc, 0x3a3427, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d8, 2.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 10; sc.far = 340;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x8fb4c8, 0);
    this.scene.add(this.moon, this.moon.target);
    this.sky = new Sky(this.scene);
    buildGeometries();
    this.mats = makeMaterials();
    this.weather = new Weather(this.scene);
    this.orbit = new OrbitCam(this.camera, canvas);
    this.raycaster = new THREE.Raycaster();
    this.world = null;
    this.frame = 0;
    this.clock = 0; // real seconds, drives water, wind and clouds
    this.env = { time: 0, daylight: 0.5, night: 0, rain: 0, sunDir: new THREE.Vector3(0, 1, 0), sunCol: C(0xfff1d8), top: C(0), horizon: C(0), cloud: 0.4, humidity: 0.5 };
    this._tmp = new THREE.Color();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  attach(world) {
    this.detach();
    this.world = world;
    this.terrainView = new TerrainView(this.scene, world, this.mats);
    this.life = new LifeView(this.scene, world, this.mats);
    const t = world.terrain;
    this.scene.fog.near = 140; this.scene.fog.far = 420;
    this.orbit.reset();
    this.orbit.target.set(0, 2, 0);
    this.orbit.goal.copy(this.orbit.target);
    this.frame = 0;
  }

  detach() {
    if (this.terrainView) this.terrainView.dispose();
    if (this.life) this.life.dispose();
    this.terrainView = null; this.life = null; this.world = null;
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  computeEnv(time, world) {
    const e = this.env;
    const hour = ((time % 24) + 24) % 24;
    const a = ((hour - 6) / 24) * Math.PI * 2;
    const elev = Math.sin(a);
    const daylight = daylightAt(time);
    const dusk = Math.exp(-Math.pow((elev - 0.05) / 0.22, 2)); // warm light around the horizon
    const night = 1 - smoothstep(-0.18, 0.12, elev);
    e.time = time;
    e.daylight = daylight;
    e.night = night;
    e.rain = world.S.climate.rain.on ? world.S.climate.rain.intensity : 0;
    e.humidity = world.S.climate.humidity;
    e.sunDir.set(Math.cos(a), elev, 0.42).normalize();
    // blend the three palettes: day / dusk / night
    const dayW = smoothstep(-0.05, 0.25, elev);
    const nightW = night;
    const mix3 = (k) => {
      const c = this._tmp.copy(NIGHT[k]).lerp(DAY[k], dayW);
      return c.lerp(DUSK[k], dusk * 0.8 * (1 - nightW * 0.5));
    };
    e.top = mix3('top').clone();
    e.horizon = mix3('hor').clone();
    e.sunCol = C(0xfff1d8).lerp(DUSK.sun, dusk * 0.9).lerp(NIGHT.sun, nightW * 0.5).clone();
    e.cloud = clamp(0.2 + 0.45 * e.humidity + 0.4 * e.rain, 0, 1);
    e.ambient = mix3('amb').clone();
    e.ground = mix3('ground').clone();
    return e;
  }

  render(sim, frame, dt) {
    if (!this.world) return;
    this.clock += dt;
    const e = this.computeEnv(this.world.S.time, this.world);
    e.clock = this.clock;
    // lights
    const sunI = Math.pow(Math.max(0, e.sunDir.y), 0.6) * 2.4;
    this.sun.intensity = sunI;
    this.sun.color.copy(e.sunCol);
    this.moon.intensity = 0.35 * e.night;
    this.hemi.intensity = 0.35 + 0.65 * e.daylight + 0.35 * e.night;
    this.hemi.color.copy(e.ambient);
    this.hemi.groundColor.copy(e.ground);
    this.scene.fog.color.copy(e.horizon);
    this.renderer.toneMappingExposure = 0.95 + 0.1 * e.daylight;
    const tgt = this.orbit.target;
    this.sun.position.copy(tgt).addScaledVector(e.sunDir, 160);
    this.sun.target.position.copy(tgt);
    this.moon.position.copy(tgt).addScaledVector(e.sunDir, -160);
    this.moon.target.position.copy(tgt);
    this.sun.visible = sunI > 0.02;
    this.sun.shadow.needsUpdate = true;
    // views
    this.terrainView.update({ time: this.clock, rain: e.rain, sunDir: e.sunDir, sunCol: e.sunCol, horizon: e.horizon, daylight: e.daylight });
    this.life.update(this.world.S, this.world, e, dt, frame);
    this.sky.update({ time: this.clock, sunDir: e.sunDir, sunCol: e.sunCol, top: e.top, horizon: e.horizon, cloud: e.cloud, night: e.night, rain: e.rain }, this.camera.position);
    this.weather.update(dt, e.time, e.rain, e.daylight, tgt);
    this.orbit.update(dt, this.world.terrain, this.world);
    this.renderer.render(this.scene, this.camera);
  }

  /** Ray from screen point to the first animal body hit, or null. */
  pickAnimal(clientX, clientY) {
    if (!this.life) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    return this.life.pick(this.raycaster);
  }

  /** World ground point under the pointer, or null. */
  pickGround(clientX, clientY) {
    if (!this.terrainView) return null;
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.terrainView.mesh, false)[0];
    return hit ? { x: hit.point.x, z: hit.point.z } : null;
  }
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function smoothstep(a, b, x) { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }
