// App shell: screens (menu, truck, cargo, route, summary), renderer, main loop.
import * as THREE from 'three';
import { TRUCKS, truckById } from './data/trucks.js';
import { CARGO, cargoById, canCarry } from './data/cargo.js';
import { STATES, CITIES, cityById } from './data/cities.js';
import { tripInfo } from './world/route.js';
import { Controls } from './ui/controls.js';
import { MiniMap } from './ui/minimap.js';
import { Showroom } from './ui/garage.js';
import { RouteMap } from './ui/routemap.js';
import { Audio } from './audio/audio.js';
import { Game } from './game.js';
import { VIEW_NAMES } from './cameras.js';
import { fmtTime } from './util.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');

const QUALITY = [
  { pr: 1.5, ahead: 560, fog: 360, traffic: 1 },
  { pr: 1.15, ahead: 450, fog: 300, traffic: 0.85 },
  { pr: 0.85, ahead: 360, fog: 240, traffic: 0.7 },
];

class App {
  constructor() {
    this.canvas = $('c');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, powerPreference: 'high-performance' });
    this.qi = 0;
    this.quality = QUALITY[0];
    this._applyQuality();
    this.controls = new Controls();
    this.audio = new Audio();
    this.minimap = new MiniMap($('minimap'));
    this.showroom = new Showroom();
    this.game = null;
    this.screen = 'menu';
    this.lastView = 'back';
    this.overtakeNag = 0;
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('its_sel') || '{}'); } catch (e) { /* */ }
    this.sel = Object.assign({ truck: 'cargo', cargo: 'goods', from: 'delhi', to: 'jaipur', governor: true }, saved);
    this._wire();
    this._resize();
    addEventListener('resize', () => this._resize());
    addEventListener('orientationchange', () => setTimeout(() => this._resize(), 200));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.pause(); });
    this.showroom.setTruck(truckById(this.sel.truck), cargoById(this.sel.cargo));
    this.fpsAcc = 0; this.fpsN = 0; this.lowFps = 0; this.hudT = 0; this.mapT = 0;
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this._frame());
    if (DEBUG) { $('fps').classList.remove('hidden'); window.__app = this; }
    if (params.has('quick')) {
      this.sel.from = params.get('from') || 'delhi'; this.sel.to = params.get('to') || 'agra';
      if (params.get('truck')) this.sel.truck = params.get('truck');
      if (params.get('cargo')) this.sel.cargo = params.get('cargo');
      this.startTrip();
    }
  }

  _applyQuality() {
    const pr = Math.min(window.devicePixelRatio || 1, this.quality.pr);
    this.renderer.setPixelRatio(pr);
    if (this.game) {
      this.game.scene.fog.far = this.quality.fog;
      this.game.world.setDrawDistance(this.quality.ahead);
      this.game.traffic.density = this.quality.traffic;
    }
  }

  _resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h, false);
    this.w = w; this.h = h;
    if (this.game) { this.game.camera.aspect = w / h; this.game.camera.updateProjectionMatrix(); }
    this.minimap.resize();
    if (h > w) this.pause();
  }

  // ---------- screens ----------
  showScreen(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.toggle('hidden', s.id !== id);
    this.screen = id;
    if (id === 'garage') { this.showroom.offsetX = 0; this._garageUI(); }
    if (id === 'cargo') { this.showroom.offsetX = 0.24; this._cargoUI(); }
    if (id === 'route') this._routeUI();
    if (id === 'summary') this._summaryUI();
    if (id === 'menu' || id === 'garage' || id === 'cargo' || id === 'route' || id === 'summary') {
      if (this.game) { this.game.dispose(); this.game = null; }
      this.hud(false);
    }
  }
  hud(on) { $('hud').classList.toggle('hidden', !on); }
  save() { try { localStorage.setItem('its_sel', JSON.stringify(this.sel)); } catch (e) { /* */ } }

  _wire() {
    const tap = (id, fn) => $(id).addEventListener('click', (e) => { e.preventDefault(); this.audio.click(); fn(e); });
    for (const b of document.querySelectorAll('[data-go]')) b.addEventListener('click', () => { this.audio.click(); this.showScreen(b.dataset.go); });
    tap('bPlay', async () => {
      await this.audio.init();
      this._landscape();
      this.showScreen('garage');
    });
    // garage
    tap('gPrev', () => this._cycleTruck(-1));
    tap('gNext', () => this._cycleTruck(1));
    $('tGov').addEventListener('change', (e) => { this.sel.governor = e.target.checked; this._garageUI(); this.save(); });
    tap('gGo', () => this.showScreen('cargo'));
    tap('cGo', () => this.showScreen('route'));
    // route
    this.map = new RouteMap($('map'), (f, t) => { this.sel.from = f; this.sel.to = t; this._routeInfo(); });
    for (const [id, which] of [['rFromSel', 'from'], ['rToSel', 'to']]) {
      const sel = $(id);
      sel.innerHTML = '<option value="">— tap a city —</option>' + CITIES.map((c) => `<option value="${c.id}">${c.name} (${STATES[c.state].name})</option>`).join('');
      sel.addEventListener('change', () => {
        const v = sel.value || null;
        if (which === 'from') this.map.set(v, this.map.to === v ? null : this.map.to);
        else this.map.set(this.map.from, v === this.map.from ? null : v);
      });
    }
    tap('rSwap', () => this.map.swap());
    tap('rClear', () => this.map.clear());
    tap('rGo', () => this.showScreen('summary'));
    tap('sGo', () => this.startTrip());
    // HUD
    tap('bPause', () => this.pause());
    tap('bCam', () => this._camera());
    tap('bMute', () => this._mute());
    $('ctxBtn').addEventListener('pointerdown', (e) => { e.preventDefault(); this.game && this.game.useContext(); });
    tap('pResume', () => this.resume());
    tap('pRestart', () => this.startTrip());
    tap('pQuit', () => this.showScreen('menu'));
    tap('oAgain', () => this.startTrip());
    tap('wAgain', () => this.startTrip());
    tap('oRoute', () => this.showScreen('route'));
    tap('wRoute', () => this.showScreen('route'));
    tap('replaySkip', () => this.game && this.game.skipReplay());
    this.controls.onHornStart = () => this.audio.hornOn();
    this.controls.onHornEnd = () => this.audio.hornOff();
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyC' && this.game && this.game.state === 'drive') this._camera();
      if ((e.code === 'KeyP' || e.code === 'Escape') && this.game) { this.game.state === 'paused' ? this.resume() : this.pause(); }
      if (e.code === 'KeyM') this._mute();
      if (e.code === 'KeyE' && this.game) this.game.useContext();
    });
    this._updateMuteIcon();
  }

  async _landscape() {
    try {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen && matchMedia('(pointer: coarse)').matches) await el.requestFullscreen({ navigationUI: 'hide' });
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape');
    } catch (e) { /* not supported (e.g. iPhone): the rotate overlay handles portrait */ }
  }

  _cycleTruck(d) {
    const i = TRUCKS.findIndex((t) => t.id === this.sel.truck);
    const t = TRUCKS[(i + d + TRUCKS.length) % TRUCKS.length];
    this.sel.truck = t.id;
    this.sel.governor = !t.fast;
    if (!canCarry(t, cargoById(this.sel.cargo))) this.sel.cargo = 'goods';
    this.showroom.setTruck(t, cargoById(this.sel.cargo));
    this._garageUI();
    this.save();
  }
  _garageUI() {
    const t = truckById(this.sel.truck);
    $('tName').textContent = t.name;
    $('tDesc').textContent = t.desc;
    const bars = (n) => '<i>' + [1, 2, 3, 4, 5].map((k) => `<u class="${k <= n ? 'on' : ''}"></u>`).join('') + '</i>';
    $('tStats').innerHTML = `<span>Top speed ${this.sel.governor ? Math.min(80, t.vmax) : t.vmax - 5} km/h</span>${bars(t.stats.speed)}<span>Pickup</span>${bars(t.stats.pickup)}<span>Size</span>${bars(t.stats.size)}<span>Handling difficulty</span>${bars(t.stats.handling)}`;
    $('tGov').checked = this.sel.governor;
    $('tGovTxt').textContent = this.sel.governor ? 'ON (80 km/h legal limit)' : 'OFF (' + (t.vmax - 5) + ' km/h)';
  }
  _cargoUI() {
    const t = truckById(this.sel.truck);
    const list = $('cargoList');
    list.innerHTML = '';
    for (const c of CARGO) {
      const ok = canCarry(t, c);
      const b = document.createElement('button');
      b.className = 'ccard' + (c.id === this.sel.cargo ? ' on' : '');
      b.disabled = !ok;
      b.innerHTML = `<span class="ic">${c.icon}</span><span><b>${c.name}</b><small>${ok ? Math.round(c.mass * t.capacity / 1000 * 10) / 10 + ' t' : c.needs === 'trailer' ? 'needs trailer' : 'needs tipper'}</small></span>`;
      b.addEventListener('click', () => { this.sel.cargo = c.id; this.save(); this.showroom.setTruck(t, c); this._cargoUI(); this.audio.click(); });
      list.appendChild(b);
    }
    const c = cargoById(this.sel.cargo);
    $('cargoInfo').innerHTML = `<b>${c.icon} ${c.name}</b> — ${c.rule} Pay: <b>₹${c.pay}/km</b>${c.cap ? ' • Limit ' + c.cap + ' km/h' : ''}${c.fragility > 0.8 ? ' • <b>Fragile</b>' : ''}`;
  }
  _routeUI() {
    this.map.set(this.sel.from, this.sel.to);
  }
  _routeInfo() {
    const f = this.sel.from, t = this.sel.to;
    $('rFromSel').value = f || ''; $('rToSel').value = t || '';
    $('rStep').textContent = !f ? 'Tap a FROM city' : !t ? 'Now tap a TO city' : 'Route ready!';
    $('rGo').disabled = !(f && t);
    if (f && t) {
      const info = tripInfo(f, t);
      $('rInfo').innerHTML = `Road distance <b>${info.realKm} km</b><br>Drive time in game <b>~${Math.round(info.estSec / 60)} min</b><br>States: <b>${info.states.map((s) => STATES[s].name).join(' → ')}</b>`;
      this.save();
    } else $('rInfo').innerHTML = 'Tap cities on the map. 14 cities in 11 states.';
  }
  _summaryUI() {
    const info = tripInfo(this.sel.from, this.sel.to);
    const t = truckById(this.sel.truck), c = cargoById(this.sel.cargo);
    $('sumBody').innerHTML = `<div class="kv">
      <div><small>From</small><b>${info.from.name}</b></div><div><small>To</small><b>${info.to.name}</b></div>
      <div><small>Distance</small><b>${info.realKm} km</b></div><div><small>Estimated time</small><b>${Math.round(info.estSec / 60)} min</b></div>
      <div><small>Truck</small><b>${t.name}</b></div><div><small>Cargo</small><b>${c.icon} ${c.name}</b></div>
    </div><p class="hint">Route: ${info.states.map((s) => STATES[s].name).join(' → ')} • Game road ${(info.gameM / 1000).toFixed(1)} km<br>⛽ Refuel at diesel pumps • 🍲 Rest at dhabas • 🚦 Stop at red lights • Keep LEFT</p>`;
  }

  startTrip() {
    this.audio.init();
    if (this.game) { this.game.dispose(); this.game = null; }
    const spec = truckById(this.sel.truck);
    let cargo = cargoById(this.sel.cargo);
    if (!canCarry(spec, cargo)) cargo = cargoById('goods');
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    this.screen = 'game';
    $('loading').classList.remove('hidden');
    $('loadTxt').textContent = 'Building the road…';
    // let the loading text paint first
    setTimeout(() => {
      this.game = new Game(this, { spec, cargo, from: this.sel.from, to: this.sel.to, governor: this.sel.governor });
      this.game.camera.aspect = this.w / this.h; this.game.camera.updateProjectionMatrix();
      this.audio.setupEngine(spec.cyl, spec.id === 'mini' ? 0.7 : spec.id === 'turbo' ? 1.25 : 1);
      this._camName();
      if (DEBUG) window.__game = this.game;
    }, 30);
  }

  pause() {
    if (!this.game || this.game.state !== 'drive') return;
    this.game.state = 'paused';
    this.audio.hornOff();
    if (this.audio.ctx) this.audio.ctx.suspend();
    this.showScreen('pause');
  }
  resume() {
    if (!this.game || this.game.state !== 'paused') return;
    if (innerHeight > innerWidth) return;
    this.game.state = 'drive';
    if (this.audio.ctx) this.audio.ctx.resume();
    $('pause').classList.add('hidden');
    this.screen = 'game';
    this.last = performance.now();
  }
  _camera() {
    if (!this.game || this.game.state !== 'drive') return;
    this.lastView = this.game.rig.next();
    this._camName();
  }
  _camName() {
    const el = $('camName');
    el.textContent = '🎥 ' + VIEW_NAMES[this.game.rig.view];
    clearTimeout(this._camT);
    el.style.opacity = 1;
    this._camT = setTimeout(() => (el.style.opacity = 0), 1500);
  }
  _mute() { this.audio.setMuted(!this.audio.muted); this._updateMuteIcon(); }
  _updateMuteIcon() { $('bMute').textContent = this.audio.muted ? '🔇' : '🔊'; }

  // ---------- main loop ----------
  _frame() {
    const now = performance.now();
    const dtReal = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const g = this.game;
    if (g) {
      g.update(dtReal);
      this.renderer.render(g.scene, g.camera);
      if (g.state === 'drive') {
        this.hudT -= dtReal;
        if (this.hudT <= 0) { this.hudT = 0.1; this._hud(g.hudData()); }
        this.mapT -= dtReal;
        if (this.mapT <= 0) { this.mapT = 1 / 15; this.minimap.draw(g.route, g.truck, g.traffic, g.s); }
      }
    } else {
      this.showroom.render(this.renderer, dtReal, this.w, this.h);
    }
    // FPS + adaptive quality
    this.fpsAcc += dtReal; this.fpsN++;
    if (this.fpsAcc > 2) {
      const fps = this.fpsN / this.fpsAcc;
      this.fps = fps;
      if (g && g.state === 'drive') {
        if (fps < 28 && this.qi < QUALITY.length - 1) { this.lowFps++; if (this.lowFps >= 2) { this.qi++; this.quality = QUALITY[this.qi]; this._applyQuality(); this.lowFps = 0; } }
        else this.lowFps = 0;
      }
      if (DEBUG) {
        const info = this.renderer.info.render;
        $('fps').textContent = `${fps.toFixed(0)} fps • ${info.calls} calls • ${(info.triangles / 1000).toFixed(0)}k tris • Q${this.qi}`;
      }
      this.fpsAcc = 0; this.fpsN = 0;
    }
  }

  _hud(d) {
    $('dSpeed').textContent = d.speed;
    $('dGear').textContent = d.gear;
    $('dLimit').textContent = d.limit ? 'LIMIT ' + d.limit : 'NO LIMIT';
    const bar = (id, v, inv) => {
      const e = $(id); e.style.width = Math.max(0, Math.min(100, v)) + '%';
      const bad = inv ? v > 75 : v < 20, mid = inv ? v > 50 : v < 40;
      e.style.background = bad ? '#ff4d4d' : mid ? '#ffb020' : '#3ddc84';
    };
    bar('dFuel', d.fuel); bar('dTired', d.tired, true); bar('dCargo', d.cargo);
    $('dDist').textContent = d.left.toFixed(1);
    $('dArrow').style.transform = `rotate(${(-d.ang * 180 / Math.PI).toFixed(0)}deg)`;
    $('dNext').textContent = d.next;
  }
}

new App();
