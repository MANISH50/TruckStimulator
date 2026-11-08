// All 3D models, built in code from simple shapes (own work, no external assets).
// Convention: vehicle local +Z = forward, +X = LEFT side, Y = up.
// India drives on the left, so trucks are right-hand drive (driver at -X).
import * as THREE from 'three';
import { Builder, VC_MAT, canvasTexture, rng } from '../util.js';

const GLASS = '#2c3e50';
const DARK = '#1c1c1c';
const CHROME = '#c9ccd0';

// ---------- shared textures ----------
let _hornTex = null;
export function hornOkTexture() {
  if (_hornTex) return _hornTex;
  _hornTex = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#f7d21e'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d0202a';
    for (let i = 0; i < w; i += 32) { g.beginPath(); g.arc(i + 16, 10, 9, 0, Math.PI * 2); g.fill(); g.beginPath(); g.arc(i + 16, h - 10, 9, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#1a3a9a'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center';
    g.fillText('HORN', w / 2, 52);
    g.fillStyle = '#c0101a'; g.font = 'bold 24px sans-serif';
    g.fillText('OK  PLEASE', w / 2, 86);
    g.fillStyle = '#106a20'; g.font = 'bold 15px sans-serif';
    g.fillText('USE DIPPER AT NIGHT', w / 2, 108);
  });
  return _hornTex;
}

function rearPanel(w, h) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: hornOkTexture() }));
  m.rotation.y = Math.PI; // face backwards (-Z)
  return m;
}

const dialCache = {};
function dialTexture(kind) {
  if (dialCache[kind]) return dialCache[kind];
  dialCache[kind] = canvasTexture(128, 128, (g, w, h) => {
    g.fillStyle = '#0d0d0d'; g.beginPath(); g.arc(64, 64, 63, 0, 7); g.fill();
    g.strokeStyle = '#c9a227'; g.lineWidth = 4; g.beginPath(); g.arc(64, 64, 60, 0, 7); g.stroke();
    const max = kind === 'speed' ? 120 : 30, step = kind === 'speed' ? 20 : 5;
    g.fillStyle = '#fff'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let v = 0; v <= max; v += step / 2) {
      const a = Math.PI * 0.75 + (v / max) * Math.PI * 1.5;
      const major = v % step === 0;
      g.strokeStyle = kind === 'rpm' && v >= 24 ? '#ff3d00' : '#fff'; g.lineWidth = major ? 3 : 1.5;
      g.beginPath(); g.moveTo(64 + Math.cos(a) * (major ? 44 : 50), 64 + Math.sin(a) * (major ? 44 : 50)); g.lineTo(64 + Math.cos(a) * 56, 64 + Math.sin(a) * 56); g.stroke();
      if (major) g.fillText(String(v), 64 + Math.cos(a) * 33, 64 + Math.sin(a) * 33);
    }
    g.font = 'bold 10px sans-serif'; g.fillStyle = '#c9a227';
    g.fillText(kind === 'speed' ? 'km/h' : 'x100 rpm', 64, 92);
  });
  return dialCache[kind];
}

// ---------- cargo ----------
// Adds cargo geometry to builder b on a bed of width w, length l, floor at y0, centred at zc.
// Returns the height of the load top.
export function addCargo(b, cargo, w, l, y0, zc, sides = 0) {
  const r = rng(77);
  const z0 = zc - l / 2;
  switch (cargo.id) {
    case 'ore': {
      b.box(w * 0.94, sides * 0.9, l * 0.96, 0, y0 + sides * 0.45, zc, '#5b3a2a');
      for (let i = 0; i < 9; i++) b.sphere(w * 0.32, (r() - 0.5) * w * 0.5, y0 + sides * 0.85, z0 + l * (0.1 + i * 0.1), i % 2 ? '#6b3f2c' : '#4f3326', 1.4, 0.55, 1.4);
      return y0 + sides + 0.4;
    }
    case 'timber': {
      const rows = 3, n = Math.max(3, Math.floor(w / 0.42));
      for (let rI = 0; rI < rows; rI++) for (let i = 0; i < n - (rI % 2); i++) {
        const x = -w / 2 + 0.25 + (i + (rI % 2) * 0.5) * (w - 0.5) / (n - 1);
        b.cyl(0.21, 0.21, l * 0.98, 7, x, y0 + 0.22 + rI * 0.38, zc, rI % 2 ? '#8a5a32' : '#7a4c28', Math.PI / 2, 0, 0);
      }
      // log ends
      for (let i = 0; i < n; i++) b.cyl(0.17, 0.17, 0.02, 7, -w / 2 + 0.25 + i * (w - 0.5) / (n - 1), y0 + 0.22, zc - l * 0.49 - 0.01, '#d8b07a', Math.PI / 2, 0, 0);
      // chains
      b.box(w + 0.05, 0.05, 0.08, 0, y0 + 1.15, zc - l * 0.3, '#444'); b.box(w + 0.05, 0.05, 0.08, 0, y0 + 1.15, zc + l * 0.3, '#444');
      return y0 + 1.2;
    }
    case 'cars': {
      // two decks of small cars
      const cols = ['#d7263d', '#f4f4f4', '#1b998b', '#2e86ab', '#c5c5c5', '#f6ae2d'];
      const n = Math.max(1, Math.floor(l / 4.3));
      // upper deck frame
      b.box(0.1, 1.8, l, w / 2 - 0.05, y0 + 0.9 + 0.75, zc, '#666');
      b.box(0.1, 1.8, l, -w / 2 + 0.05, y0 + 0.9 + 0.75, zc, '#666');
      b.box(w, 0.1, l, 0, y0 + 1.75, zc, '#555');
      for (let deck = 0; deck < 2; deck++) for (let i = 0; i < n; i++) {
        const cz = z0 + 2.1 + i * (l - 0.4) / n, cy = y0 + deck * 1.75;
        const c = cols[(i + deck * 3) % cols.length];
        b.box(1.65, 0.55, 3.6, 0, cy + 0.45, cz, c);
        b.box(1.45, 0.5, 1.9, 0, cy + 0.95, cz - 0.2, c);
        b.box(1.47, 0.36, 1.5, 0, cy + 0.98, cz - 0.15, GLASS);
        b.wheel(0.3, 0.2, 0.75, cy + 0.3, cz + 1.15); b.wheel(0.3, 0.2, -0.75, cy + 0.3, cz + 1.15);
        b.wheel(0.3, 0.2, 0.75, cy + 0.3, cz - 1.15); b.wheel(0.3, 0.2, -0.75, cy + 0.3, cz - 1.15);
      }
      return y0 + 2.95;
    }
    case 'fuel':
    case 'milk': {
      const R = Math.min(1.2, w * 0.48);
      b.cyl(R, R, l * 0.96, 14, 0, y0 + R + 0.1, zc, cargo.tank, Math.PI / 2, 0, 0);
      b.sphere(R, 0, y0 + R + 0.1, zc + l * 0.48, cargo.tank, 1, 1, 0.3, 1);
      b.sphere(R, 0, y0 + R + 0.1, zc - l * 0.48, cargo.tank, 1, 1, 0.3, 1);
      b.box(0.5, 0.15, l * 0.8, 0, y0 + 2 * R + 0.15, zc, '#888');
      const band = cargo.id === 'fuel' ? '#e03a1e' : '#2a62c9';
      b.cyl(R + 0.02, R + 0.02, 0.6, 14, 0, y0 + R + 0.1, zc, band, Math.PI / 2, 0, 0);
      for (let i = -1; i <= 1; i += 2) b.cyl(R + 0.02, R + 0.02, 0.12, 14, 0, y0 + R + 0.1, zc + i * l * 0.3, '#999', Math.PI / 2, 0, 0);
      return y0 + 2 * R + 0.2;
    }
    case 'steel': {
      const n = Math.max(2, Math.floor(l / 2.4));
      for (let i = 0; i < n; i++) {
        const cz = z0 + 1.2 + i * (l - 2.4) / Math.max(1, n - 1);
        b.cyl(0.85, 0.85, 1.4, 14, 0, y0 + 0.9, cz, '#9aa4ae', 0, 0, Math.PI / 2);
        b.cyl(0.32, 0.32, 1.42, 10, 0, y0 + 0.9, cz, '#3b4148', 0, 0, Math.PI / 2);
        b.box(1.5, 0.15, 0.6, 0, y0 + 0.08, cz, '#7a5a35');
      }
      return y0 + 1.8;
    }
    case 'container': {
      const h = 2.55;
      const col = ['#b5322b', '#1f6aa5', '#2e8b57', '#d98324'][Math.floor(l) % 4];
      b.box(w * 0.98, h, l * 0.98, 0, y0 + h / 2, zc, col);
      for (let i = 0; i < l / 0.5; i++) {
        b.box(w * 0.99 + 0.02, h * 0.96, 0.08, 0, y0 + h / 2, z0 + 0.25 + i * 0.5, i % 2 ? col : '#2a2a2a');
      }
      b.box(w * 0.98, h * 0.98, 0.04, 0, y0 + h / 2, zc - l * 0.49 - 0.02, col);
      b.box(0.06, h * 0.96, 0.05, 0, y0 + h / 2, zc - l * 0.49 - 0.03, '#222');
      return y0 + h;
    }
    case 'veg': {
      const cols = ['#e8a317', '#3f9b2a', '#d12f2f', '#f2c12e', '#8bc34a'];
      const nx = Math.max(1, Math.floor(w / 0.6)), nz = Math.max(1, Math.floor(l / 0.7));
      for (let k = 0; k < 2; k++) for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        b.box(0.55, 0.42, 0.62, -w / 2 + 0.3 + i * (w - 0.6) / Math.max(1, nx - 1), y0 + 0.21 + k * 0.44, z0 + 0.35 + j * (l - 0.7) / Math.max(1, nz - 1), k ? cols[(i + j) % cols.length] : '#8a6a3a');
      }
      b.box(w, 0.08, l, 0, y0 + 0.92, zc, '#2f6f4f');
      return y0 + 1.0;
    }
    case 'cement': {
      for (let k = 0; k < 4; k++) for (let j = 0; j < Math.floor(l / 0.55); j++) for (let i = 0; i < 3; i++) {
        b.box(w / 3 - 0.04, 0.24, 0.5, -w / 3 + i * w / 3, y0 + 0.13 + k * 0.25, z0 + 0.3 + j * 0.55, k % 2 ? '#c8c2b5' : '#b9b3a6');
      }
      return y0 + 1.05;
    }
    case 'glass':
    case 'goods':
    default: {
      // boxes under a tarpaulin
      const h = cargo.id === 'glass' ? 1.5 : 1.7;
      const tarp = cargo.id === 'glass' ? '#2f5d8a' : '#1f7a4a';
      b.box(w * 0.96, h, l * 0.96, 0, y0 + h / 2, zc, tarp);
      b.box(w * 0.9, 0.35, l * 0.9, 0, y0 + h + 0.12, zc, tarp);
      for (let i = 0; i < 4; i++) b.box(w + 0.02, 0.05, 0.06, 0, y0 + h * 0.6, z0 + l * (0.15 + i * 0.23), '#d9c25a');
      if (cargo.id === 'glass') b.box(0.02, 0.5, 1.2, w * 0.49, y0 + h * 0.6, zc, '#e33');
      return y0 + h + 0.3;
    }
  }
}

// ---------- player truck ----------
export function buildPlayerTruck(spec, cargo) {
  const root = new THREE.Group();
  const W = spec.width;
  const tractor = spec.trailer > 0;
  const mini = spec.id === 'mini';
  const wheelR = mini ? 0.38 : 0.52;
  const frameY = mini ? 0.72 : 1.0;
  const cabLen = mini ? 1.7 : 2.25;
  const cabFront = spec.wheelbase + (mini ? 1.0 : 1.25);
  const cabBack = cabFront - cabLen;
  const cabBottom = frameY - 0.1;
  const cabTop = mini ? 2.35 : 3.15;
  const rearZ = tractor ? -1.6 : cabFront - spec.length;
  const col = spec.color, acc = spec.accent;

  // ---- static body (chassis + bed + bumpers)
  const b = new Builder();
  b.plane(W + 0.4, cabFront - rearZ + 0.6, 0, 0.03, (cabFront + rearZ) / 2, '#151515'); // shadow
  b.box(0.22, 0.28, cabFront - rearZ - 0.3, W * 0.28, frameY - 0.25, (cabFront + rearZ) / 2, '#222');
  b.box(0.22, 0.28, cabFront - rearZ - 0.3, -W * 0.28, frameY - 0.25, (cabFront + rearZ) / 2, '#222');
  // bumper
  b.box(W + 0.05, 0.35, 0.25, 0, frameY - 0.35, cabFront + 0.08, mini ? '#333' : '#d8d8d8');
  // fuel tank (right side) and battery box
  if (!mini) {
    b.cyl(0.35, 0.35, 1.3, 10, -W / 2 + 0.3, frameY - 0.35, cabBack - 0.9, CHROME, Math.PI / 2, 0, 0);
    b.box(0.6, 0.5, 0.7, W / 2 - 0.35, frameY - 0.35, cabBack - 0.9, '#333');
  }
  // mudguards over front wheels
  b.box(0.42, 0.08, 1.2, W / 2 - 0.25, wheelR * 2 + 0.05, spec.wheelbase, '#222');
  b.box(0.42, 0.08, 1.2, -W / 2 + 0.25, wheelR * 2 + 0.05, spec.wheelbase, '#222');
  const cargoB = new Builder();
  let cargoTop = 0;
  let rearPanelInfo = null;

  if (!tractor) {
    // load body
    const bed = spec.bed;
    const bedFront = cabBack - 0.15, bedLen = bedFront - rearZ, bedZ = (bedFront + rearZ) / 2;
    const fy = frameY + 0.08;
    const sides = spec.id === 'cargo' ? 1.55 : spec.id === 'express' ? 1.1 : 0.55;
    b.box(W, 0.15, bedLen, 0, fy, bedZ, '#5a3b22');
    const sideCol = spec.id === 'cargo' ? '#c8742a' : spec.id === 'express' ? '#d9e2ea' : '#3a6fcf';
    b.box(0.08, sides, bedLen, W / 2 - 0.04, fy + sides / 2, bedZ, sideCol);
    b.box(0.08, sides, bedLen, -W / 2 + 0.04, fy + sides / 2, bedZ, sideCol);
    b.box(W, sides + (spec.id === 'cargo' ? 0.5 : 0), 0.08, 0, fy + (sides + (spec.id === 'cargo' ? 0.5 : 0)) / 2, bedFront, sideCol);
    b.box(W, sides, 0.08, 0, fy + sides / 2, rearZ + 0.04, sideCol);
    if (spec.id === 'cargo') {
      // classic painted wooden body: stripes and flowers
      const stripes = ['#1a8a3a', '#d42a2a', '#1a4fb0', '#f2c218'];
      for (let i = 0; i < 4; i++) {
        b.box(0.1, 0.12, bedLen, W / 2, fy + 0.2 + i * 0.35, bedZ, stripes[i]);
        b.box(0.1, 0.12, bedLen, -W / 2, fy + 0.2 + i * 0.35, bedZ, stripes[i]);
      }
      // crown over cab
      b.box(W, 0.45, 0.6, 0, cabTop + 0.12, cabBack - 0.15, '#c8742a');
      b.box(W + 0.02, 0.1, 0.62, 0, cabTop + 0.3, cabBack - 0.15, '#d42a2a');
    }
    if (spec.id === 'express') {
      b.box(0.1, 0.18, bedLen, W / 2, fy + 0.5, bedZ, '#2b6fd6');
      b.box(0.1, 0.18, bedLen, -W / 2, fy + 0.5, bedZ, '#2b6fd6');
    }
    cargoTop = addCargo(cargoB, cargo, W - 0.2, bedLen - 0.3, fy + 0.08, bedZ, sides);
    // rear wheels
    b.box(W, 0.1, 0.5, 0, wheelR * 2 + 0.05, 0, '#222');
    rearPanelInfo = { w: W * 0.8, h: Math.min(0.9, sides * 0.7), y: fy + Math.min(0.9, sides * 0.7) / 2 + 0.05, z: rearZ - 0.01 };
  } else {
    // fifth wheel plate
    b.box(1.2, 0.12, 1.2, 0, frameY + 0.05, 0.3, '#333');
    b.box(W - 0.2, 0.08, 2.2, 0, wheelR * 2 + 0.1, -0.1, '#222');
    // twin exhaust stacks behind cab
    const stackH = spec.id === 'turbo' ? 2.9 : 2.4;
    b.cyl(0.11, 0.11, stackH, 8, W / 2 - 0.15, frameY + stackH / 2, cabBack - 0.2, CHROME);
    if (spec.id === 'turbo') b.cyl(0.11, 0.11, stackH, 8, -W / 2 + 0.15, frameY + stackH / 2, cabBack - 0.2, CHROME);
  }
  const body = b.mesh();
  root.add(body);
  const cargoMesh = cargoB.empty ? null : cargoB.mesh();
  const cargoGroup = new THREE.Group();
  if (cargoMesh && !tractor) cargoGroup.add(cargoMesh);
  root.add(cargoGroup);
  if (rearPanelInfo) {
    const p = rearPanel(rearPanelInfo.w, rearPanelInfo.h);
    p.position.set(0, rearPanelInfo.y, rearPanelInfo.z);
    root.add(p);
  }

  // ---- cab shell (hidden in driver view)
  const c = new Builder();
  const ch = cabTop - cabBottom, cz = (cabFront + cabBack) / 2;
  c.box(W, ch * 0.55, cabLen, 0, cabBottom + ch * 0.275, cz, col);
  // upper cab (slightly narrower), windows
  c.box(W - 0.06, ch * 0.45, cabLen - 0.1, 0, cabBottom + ch * 0.775, cz - 0.05, col);
  c.box(W - 0.2, ch * 0.36, 0.06, 0, cabBottom + ch * 0.75, cabFront - 0.12, GLASS, -0.08, 0, 0);
  c.box(0.05, ch * 0.3, cabLen * 0.5, W / 2 - 0.02, cabBottom + ch * 0.75, cabFront - cabLen * 0.35, GLASS);
  c.box(0.05, ch * 0.3, cabLen * 0.5, -W / 2 + 0.02, cabBottom + ch * 0.75, cabFront - cabLen * 0.35, GLASS);
  // grille and headlights
  c.box(W * 0.6, ch * 0.3, 0.06, 0, cabBottom + ch * 0.25, cabFront + 0.01, mini ? '#333' : CHROME);
  for (let i = 0; i < 5; i++) c.box(W * 0.58, 0.04, 0.07, 0, cabBottom + ch * 0.14 + i * ch * 0.05, cabFront + 0.02, '#222');
  c.box(0.35, 0.22, 0.06, W / 2 - 0.3, cabBottom + 0.25, cabFront + 0.02, '#fffbe0');
  c.box(0.35, 0.22, 0.06, -W / 2 + 0.3, cabBottom + 0.25, cabFront + 0.02, '#fffbe0');
  // accent stripes
  c.box(W + 0.02, 0.12, cabLen + 0.02, 0, cabBottom + ch * 0.5, cz, acc);
  c.box(W + 0.02, 0.06, cabLen + 0.02, 0, cabBottom + ch * 0.42, cz, '#ffffff');
  // decorated visor above windshield (Indian style)
  c.box(W + 0.1, 0.25, 0.35, 0, cabTop - 0.05, cabFront + 0.05, acc);
  for (let i = 0; i < 6; i++) c.sphere(0.06, -W / 2 + 0.2 + i * (W - 0.4) / 5, cabTop - 0.2, cabFront + 0.22, i % 2 ? '#f2c218' : '#d42a2a');
  // mirrors
  c.box(0.08, 0.4, 0.2, W / 2 + 0.3, cabBottom + ch * 0.7, cabFront - 0.2, DARK);
  c.box(0.08, 0.4, 0.2, -W / 2 - 0.3, cabBottom + ch * 0.7, cabFront - 0.2, DARK);
  c.box(0.35, 0.04, 0.04, W / 2 + 0.15, cabBottom + ch * 0.7, cabFront - 0.2, DARK);
  c.box(0.35, 0.04, 0.04, -W / 2 - 0.15, cabBottom + ch * 0.7, cabFront - 0.2, DARK);
  if (spec.id === 'express' || spec.id === 'turbo') {
    // roof fairing
    c.box(W - 0.1, 0.6, cabLen * 0.7, 0, cabTop + 0.3, cz - 0.2, spec.id === 'turbo' ? '#ff6a00' : '#d9e2ea', -0.12, 0, 0);
    c.box(W * 0.9, 0.1, 0.1, 0, cabTop + 0.05, cabFront - 0.05, '#ffdd55');
  }
  if (spec.id === 'turbo') {
    // flame stripes
    for (let i = 0; i < 5; i++) {
      c.box(0.04, 0.12, 0.5 + i * 0.12, W / 2 + 0.01, cabBottom + 0.4 + i * 0.16, cabFront - 0.3 - i * 0.1, i % 2 ? '#ff6a00' : '#ffcc00');
      c.box(0.04, 0.12, 0.5 + i * 0.12, -W / 2 - 0.01, cabBottom + 0.4 + i * 0.16, cabFront - 0.3 - i * 0.1, i % 2 ? '#ff6a00' : '#ffcc00');
    }
  }
  // steps
  c.box(0.3, 0.06, 0.5, W / 2 - 0.1, cabBottom - 0.15, cabFront - 0.5, '#888');
  c.box(0.3, 0.06, 0.5, -W / 2 + 0.1, cabBottom - 0.15, cabFront - 0.5, '#888');
  const cabShell = c.mesh();
  root.add(cabShell);

  // ---- interior (driver view only)
  const interior = new THREE.Group();
  const eyeY = cabBottom + (mini ? 1.15 : 1.3);
  const seatX = -(W / 2 - (mini ? 0.45 : 0.6));
  const eyeZ = cabFront - (mini ? 0.75 : 0.95);
  const ib = new Builder();
  // dashboard: sloping top in front of the driver
  const dashZ0 = eyeZ + 0.5, dashZ1 = cabFront - 0.08;
  ib.box(W - 0.1, 0.5, dashZ1 - dashZ0, 0, eyeY - 0.55, (dashZ0 + dashZ1) / 2, '#3a3530');
  ib.box(W - 0.1, 0.05, dashZ1 - dashZ0 + 0.05, 0, eyeY - 0.29, (dashZ0 + dashZ1) / 2, '#2a2622', -0.12, 0, 0);
  // instrument binnacle in front of the driver
  ib.box(0.6, 0.16, 0.14, seatX, eyeY - 0.27, dashZ0 + 0.1, '#1d1b19', -0.35, 0, 0);
  // centre console with radio and switches
  ib.box(0.4, 0.25, 0.05, seatX + 0.75, eyeY - 0.42, dashZ0 + 0.02, '#222');
  ib.box(0.25, 0.06, 0.02, seatX + 0.75, eyeY - 0.36, dashZ0 - 0.01, '#4fc3f7');
  for (let i = 0; i < 4; i++) ib.box(0.04, 0.03, 0.02, seatX + 0.65 + i * 0.07, eyeY - 0.47, dashZ0 - 0.01, i % 2 ? '#e53935' : '#fdd835');
  // A-pillars
  ib.box(0.1, ch * 0.55, 0.1, W / 2 - 0.08, eyeY + 0.12, cabFront - 0.18, '#3e3833', -0.15, 0, 0);
  ib.box(0.1, ch * 0.55, 0.1, -W / 2 + 0.08, eyeY + 0.12, cabFront - 0.18, '#3e3833', -0.15, 0, 0);
  // roof edge & sun visors
  ib.box(W, 0.12, 0.45, 0, eyeY + 0.6, cabFront - 0.3, '#5a514a');
  ib.box(W, 0.06, cabLen, 0, eyeY + 0.7, cz, '#6a6058');
  ib.box(0.6, 0.03, 0.25, seatX, eyeY + 0.52, cabFront - 0.35, '#4a423b', 0.25, 0, 0);
  // decorative tassels and a small garland along the top of the windshield (Indian truck style)
  for (let i = 0; i < 13; i++) {
    const x = -W / 2 + 0.2 + i * (W - 0.4) / 12;
    ib.box(0.015, 0.07, 0.015, x, eyeY + 0.5, cabFront - 0.25, ['#d42a2a', '#f2c218', '#1a8a3a'][i % 3]);
    ib.sphere(0.022, x, eyeY + 0.46, cabFront - 0.25, ['#f2c218', '#d42a2a', '#ff8f00'][i % 3]);
  }
  // doors / window sills
  ib.box(0.08, 0.55, cabLen, W / 2 - 0.04, eyeY - 0.5, cz, '#4a443e');
  ib.box(0.08, 0.55, cabLen, -W / 2 + 0.04, eyeY - 0.5, cz, '#4a443e');
  // gear lever
  ib.box(0.04, 0.4, 0.04, seatX + 0.5, eyeY - 0.75, eyeZ + 0.15, '#222');
  ib.sphere(0.06, seatX + 0.5, eyeY - 0.55, eyeZ + 0.15, '#111');
  // small idol shelf on the dash (very common in Indian trucks)
  ib.box(0.22, 0.03, 0.12, 0.15, eyeY - 0.27, dashZ1 - 0.15, '#8a5a2a');
  ib.sphere(0.055, 0.15, eyeY - 0.2, dashZ1 - 0.15, '#f29f05');
  ib.sphere(0.03, 0.08, eyeY - 0.22, dashZ1 - 0.12, '#e53935');
  ib.sphere(0.03, 0.22, eyeY - 0.22, dashZ1 - 0.12, '#43a047');
  // windshield frame bottom
  ib.box(W, 0.06, 0.08, 0, eyeY - 0.27, cabFront - 0.08, col);
  const interiorMesh = ib.mesh();
  interior.add(interiorMesh);
  // gauges (speed + rpm) with moving needles
  const gauges = [];
  for (const [k, gx] of [['speed', 0.13], ['rpm', -0.13]]) {
    const dial = new THREE.Mesh(new THREE.CircleGeometry(0.1, 20), new THREE.MeshBasicMaterial({ map: dialTexture(k) }));
    const holder = new THREE.Group();
    holder.position.set(seatX + gx * 0.9, eyeY - 0.26, dashZ0 + 0.02);
    holder.rotation.set(-0.35, Math.PI, 0);
    holder.add(dial);
    const nb = new Builder(); nb.box(0.008, 0.085, 0.004, 0, 0.04, 0, '#ff3d00');
    const needle = nb.mesh(); needle.position.z = 0.004;
    holder.add(needle);
    interior.add(holder);
    gauges.push(needle);
  }
  // steering wheel
  const sw = new Builder();
  sw.addGeometry(new THREE.TorusGeometry(0.23, 0.03, 6, 20), '#6d4c41');
  sw.box(0.44, 0.045, 0.03, 0, 0, 0, '#9e9e9e');
  sw.box(0.045, 0.22, 0.03, 0, -0.11, 0, '#9e9e9e');
  sw.cyl(0.065, 0.065, 0.05, 10, 0, 0, 0, '#c9a227', Math.PI / 2, 0, 0);
  const steerMesh = sw.mesh();
  const steerPivot = new THREE.Group();
  steerPivot.position.set(seatX, eyeY - 0.37, eyeZ + 0.44);
  steerPivot.rotation.x = -0.7; // tilt (top toward driver)
  steerPivot.add(steerMesh);
  interior.add(steerPivot);
  interior.visible = false;
  root.add(interior);

  // ---- wheels
  const wheels = [];
  const frontWheels = [];
  const mkWheel = (dual) => {
    const wb = new Builder();
    wb.wheel(wheelR, dual ? 0.55 : 0.32, 0, 0, 0, '#1b1b1b', '#9a9a9a', 12);
    wb.box(0.02, wheelR * 1.5, 0.12, dual ? 0.29 : 0.17, 0, 0, '#c9a227');
    return wb.mesh();
  };
  for (const side of [1, -1]) {
    const pivot = new THREE.Group();
    pivot.position.set(side * (W / 2 - 0.22), wheelR, spec.wheelbase);
    const w = mkWheel(false);
    pivot.add(w);
    root.add(pivot);
    frontWheels.push(pivot);
    wheels.push(w);
  }
  const rearAxles = mini ? [0] : [0.68, -0.68];
  for (const z of rearAxles) for (const side of [1, -1]) {
    const w = mkWheel(true);
    w.position.set(side * (W / 2 - 0.35), wheelR, z);
    root.add(w);
    wheels.push(w);
  }

  // ---- trailer
  let trailer = null;
  if (tractor) {
    const Lt = spec.trailer;
    const tg = new THREE.Group();
    const tb = new Builder();
    const deckY = 1.35, front = 1.0, back = -(Lt - 1.0);
    const zc = (front + back) / 2;
    const axleZ = back + 2.0;
    tb.plane(W + 0.4, Lt + 0.4, 0, 0.03, zc, '#151515');
    tb.box(W, 0.2, Lt, 0, deckY, zc, '#3c3c3c');
    tb.box(0.3, 0.35, Lt, W * 0.3, deckY - 0.25, zc, '#222');
    tb.box(0.3, 0.35, Lt, -W * 0.3, deckY - 0.25, zc, '#222');
    // landing gear
    tb.box(0.12, 1.0, 0.12, W * 0.35, 0.6, front - 2.2, '#555');
    tb.box(0.12, 1.0, 0.12, -W * 0.35, 0.6, front - 2.2, '#555');
    // side markers & underride guard
    tb.box(W, 0.12, 0.12, 0, 0.5, back + 0.05, '#e0b020');
    tb.box(0.05, 0.08, Lt - 1, W / 2 + 0.01, deckY - 0.05, zc, '#e85d04');
    tb.box(0.05, 0.08, Lt - 1, -W / 2 - 0.01, deckY - 0.05, zc, '#e85d04');
    // mud flaps
    tb.box(0.5, 0.5, 0.04, W / 2 - 0.35, 0.45, axleZ - 1.3, '#111');
    tb.box(0.5, 0.5, 0.04, -W / 2 + 0.35, 0.45, axleZ - 1.3, '#111');
    const tBody = tb.mesh();
    tg.add(tBody);
    const tcB = new Builder();
    const tTop = addCargo(tcB, cargo, W - 0.1, Lt - 0.4, deckY + 0.1, zc, 0);
    cargoTop = tTop;
    const tCargoGroup = new THREE.Group();
    const tCargo = tcB.mesh();
    tCargoGroup.add(tCargo);
    tg.add(tCargoGroup);
    const tw = [];
    const nAx = Lt > 10 ? 3 : 2;
    for (let i = 0; i < nAx; i++) {
      const z = axleZ + (i - (nAx - 1) / 2) * 1.3;
      for (const side of [1, -1]) {
        const w = mkWheel(true);
        w.position.set(side * (W / 2 - 0.35), wheelR, z);
        tg.add(w); tw.push(w);
      }
    }
    const p = rearPanel(W * 0.7, 0.55);
    p.position.set(0, 0.95, back - 0.05);
    tg.add(p);
    trailer = { group: tg, body: tBody, cargoGroup: tCargoGroup, cargoMesh: tCargo, wheels: tw, length: Lt, axle: -axleZ, front, back, deckY, top: tTop };
  }

  return {
    root, body, cabShell, interior, steerPivot, gauges, wheels, frontWheels, cargoGroup, cargoMesh, trailer,
    wheelR, cabFront, cabBack, rearZ, cabTop, cargoTop: Math.max(cargoTop, cabTop),
    seat: new THREE.Vector3(seatX, eyeY, eyeZ),
    hitchZ: 0.3,
  };
}

// ---------- AI traffic vehicles (origin centre, ground level) ----------
const CAR_COLS = ['#c62828', '#f5f5f5', '#9e9e9e', '#1565c0', '#2e7d32', '#212121', '#ef6c00', '#6d4c41', '#bdbdbd'];
export const VEHICLE_TYPES = {
  car: { len: 4.0, wid: 1.75, mass: 1100, vmax: 22, accel: 2.2 },
  suv: { len: 4.6, wid: 1.9, mass: 1800, vmax: 21, accel: 2.0 },
  bus: { len: 11, wid: 2.5, mass: 11000, vmax: 17, accel: 1.0 },
  auto: { len: 2.7, wid: 1.35, mass: 400, vmax: 12, accel: 1.4 },
  bike: { len: 2.0, wid: 0.8, mass: 200, vmax: 19, accel: 2.6 },
  truck: { len: 9.0, wid: 2.45, mass: 16000, vmax: 15, accel: 0.8 },
  tractor: { len: 6.5, wid: 2.0, mass: 4000, vmax: 8, accel: 0.8 },
};

function shadow(b, w, l) { b.plane(w + 0.2, l + 0.2, 0, 0.03, 0, '#151515'); }

export function buildVehicleGeo(type, variant) {
  const b = new Builder();
  const r = rng(variant * 31 + type.length * 7);
  const t = VEHICLE_TYPES[type];
  const L = t.len, W = t.wid;
  shadow(b, W, L);
  if (type === 'car' || type === 'suv') {
    const c = CAR_COLS[variant % CAR_COLS.length];
    const h = type === 'suv' ? 0.85 : 0.6;
    b.box(W, h, L, 0, 0.35 + h / 2, 0, c);
    b.box(W * 0.9, 0.55, L * 0.5, 0, 0.35 + h + 0.27, type === 'suv' ? -0.3 : -0.15, c);
    b.box(W * 0.92, 0.42, L * 0.48, 0, 0.35 + h + 0.27, type === 'suv' ? -0.3 : -0.15, GLASS);
    b.box(W * 0.7, 0.15, 0.05, 0, 0.55, L / 2, '#eee');
    b.box(W * 0.8, 0.12, 0.05, 0, 0.7, -L / 2, '#c00');
    for (const z of [L * 0.32, -L * 0.32]) for (const s of [1, -1]) b.wheel(0.32, 0.22, s * W * 0.45, 0.32, z);
  } else if (type === 'bus') {
    const c = ['#b71c1c', '#1565c0', '#2e7d32', '#e65100'][variant % 4];
    b.box(W, 2.4, L, 0, 0.5 + 1.2, 0, c);
    b.box(W + 0.02, 0.8, L * 0.85, 0, 2.05, -0.5, GLASS);
    b.box(W - 0.2, 0.9, 0.05, 0, 2.0, L / 2 + 0.01, GLASS);
    b.box(W + 0.03, 0.18, L, 0, 1.3, 0, '#f5f5f5');
    b.box(W - 0.4, 0.3, 1.6, 0, 3.05, -2, '#777'); // luggage on roof
    for (const z of [L * 0.33, -L * 0.3]) for (const s of [1, -1]) b.wheel(0.5, 0.35, s * (W / 2 - 0.25), 0.5, z);
  } else if (type === 'auto') {
    const c = variant % 2 ? '#f9d71c' : '#2e7d32';
    b.box(W, 0.6, L * 0.8, 0, 0.55, -0.15, c);
    b.box(W * 0.9, 0.8, L * 0.55, 0, 1.25, -0.35, '#111'); // canvas top
    b.box(W * 0.98, 0.08, L * 0.6, 0, 1.68, -0.3, '#111');
    b.box(W * 0.6, 0.45, 0.06, 0, 1.15, L * 0.18, GLASS);
    b.box(W * 0.5, 0.45, 0.5, 0, 0.55, L * 0.32, '#f9d71c');
    b.wheel(0.22, 0.14, 0, 0.22, L * 0.4);
    b.wheel(0.22, 0.14, W * 0.42, 0.22, -L * 0.3); b.wheel(0.22, 0.14, -W * 0.42, 0.22, -L * 0.3);
  } else if (type === 'bike') {
    const c = ['#111', '#b71c1c', '#1565c0', '#555'][variant % 4];
    b.wheel(0.32, 0.1, 0, 0.32, 0.7); b.wheel(0.32, 0.1, 0, 0.32, -0.7);
    b.box(0.3, 0.35, 1.2, 0, 0.7, 0, c);
    b.box(0.6, 0.05, 0.05, 0, 1.05, 0.55, '#333');
    // rider
    b.box(0.42, 0.6, 0.3, 0, 1.25, -0.1, ['#f2f2f2', '#1e88e5', '#e53935', '#8d6e63'][variant % 4]);
    b.sphere(0.16, 0, 1.72, -0.05, ['#212121', '#d32f2f', '#fbc02d'][variant % 3]);
    b.box(0.12, 0.5, 0.12, 0.15, 0.75, 0.1, '#263238'); b.box(0.12, 0.5, 0.12, -0.15, 0.75, 0.1, '#263238');
  } else if (type === 'truck') {
    const c = ['#f2a516', '#c62828', '#1e88e5', '#2e7d32', '#6a1b9a'][variant % 5];
    b.box(W, 1.9, 2.0, 0, 0.9 + 0.95, L / 2 - 1.0, c);
    b.box(W - 0.2, 0.7, 0.05, 0, 2.2, L / 2 + 0.01, GLASS);
    b.box(W, 0.4, 0.5, 0, 3.0, L / 2 - 1.0, '#d42a2a');
    b.box(W, 1.5, L - 2.3, 0, 1.2 + 0.75, -1.1, '#c8742a');
    b.box(W - 0.1, 0.3, L - 2.4, 0, 2.8, -1.1, r() < 0.5 ? '#1f7a4a' : '#2f5d8a');
    for (let i = 0; i < 3; i++) b.box(W + 0.02, 0.1, L - 2.3, 0, 1.4 + i * 0.4, -1.1, ['#1a8a3a', '#d42a2a', '#f2c218'][i]);
    b.box(W * 0.8, 0.6, 0.05, 0, 1.6, -L / 2 + 0.02, '#f7d21e');
    for (const z of [L / 2 - 1.2, -L / 2 + 1.8, -L / 2 + 0.6]) for (const s of [1, -1]) b.wheel(0.5, 0.4, s * (W / 2 - 0.3), 0.5, z);
  } else if (type === 'tractor') {
    b.box(1.0, 0.8, 1.8, 0, 1.2, 2.0, '#c62828');
    b.wheel(0.75, 0.4, 0.8, 0.75, 1.2, '#1b1b1b', '#e65100'); b.wheel(0.75, 0.4, -0.8, 0.75, 1.2, '#1b1b1b', '#e65100');
    b.wheel(0.4, 0.25, 0.6, 0.4, 2.6); b.wheel(0.4, 0.25, -0.6, 0.4, 2.6);
    b.box(0.5, 0.6, 0.5, 0, 1.9, 1.2, '#455a64');
    b.box(W, 1.0, 4.0, 0, 1.2, -1.2, '#2e7d32');
    b.box(W - 0.2, 0.7, 3.8, 0, 1.9, -1.2, '#e8d28a'); // hay / sugarcane
    b.wheel(0.45, 0.3, W / 2 - 0.2, 0.45, -1.5); b.wheel(0.45, 0.3, -W / 2 + 0.2, 0.45, -1.5);
  }
  return b.build();
}

// ---------- props (all return BufferGeometry, local origin on ground) ----------
export function propGeo(kind, opt = {}) {
  const b = new Builder();
  switch (kind) {
    case 'tree_round':
      b.cyl(0.18, 0.25, 2.2, 6, 0, 1.1, 0, '#6b4a2b');
      b.sphere(1.6, 0, 3.1, 0, '#4f8a2e', 1, 0.85, 1);
      b.sphere(1.1, 0.7, 3.8, 0.3, '#5a9a35', 1, 0.9, 1);
      break;
    case 'tree_mango':
      b.cyl(0.25, 0.32, 1.8, 6, 0, 0.9, 0, '#5a3d24');
      b.sphere(2.2, 0, 3.0, 0, '#2f6e24', 1.1, 0.75, 1.1);
      break;
    case 'tree_neem':
      b.cyl(0.18, 0.24, 2.6, 6, 0, 1.3, 0, '#6b4a2b');
      b.sphere(1.5, 0, 3.4, 0, '#5d9a38', 1.2, 0.7, 1.2);
      b.sphere(1.0, -0.8, 3.0, 0.4, '#6aa840', 1, 0.7, 1);
      break;
    case 'tree_teak':
      b.cyl(0.15, 0.22, 4.0, 6, 0, 2.0, 0, '#6b5a3b');
      b.sphere(1.3, 0, 4.6, 0, '#4a7a2a', 0.9, 1.3, 0.9);
      break;
    case 'tree_khejri':
      b.cyl(0.12, 0.2, 1.8, 5, 0, 0.9, 0, '#7a5a3a', 0, 0, 0.1);
      b.sphere(1.4, 0.2, 2.3, 0, '#8a9a4a', 1.3, 0.45, 1.3);
      break;
    case 'tree_palm': {
      const H = 6.5;
      for (let i = 0; i < 6; i++) b.cyl(0.16, 0.2, H / 6 + 0.05, 6, i * 0.08, H / 12 + i * H / 6, 0, i % 2 ? '#8a6a45' : '#7a5c3a', 0, 0, -0.06);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        b.box(0.5, 0.06, 2.6, 0.5 + Math.sin(a) * 1.1, H - 0.1, Math.cos(a) * 1.1, k % 2 ? '#3f8a2a' : '#4fa035', -0.45, a, 0);
      }
      b.sphere(0.3, 0.45, H - 0.2, 0, '#5a4020');
      break;
    }
    case 'tree_banana':
      b.cyl(0.15, 0.2, 2.2, 6, 0, 1.1, 0, '#7a8a3a');
      for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; b.box(0.6, 0.04, 1.8, Math.sin(a) * 0.8, 2.4, Math.cos(a) * 0.8, '#6fbf3a', -0.6, a, 0); }
      break;
    case 'tree_bamboo':
      for (let i = 0; i < 6; i++) b.cyl(0.06, 0.08, 6, 5, (i % 3) * 0.3 - 0.3, 3, Math.floor(i / 3) * 0.3, '#8aa83a', (i - 3) * 0.04, 0, (i % 3 - 1) * 0.06);
      b.sphere(1.0, 0, 5.8, 0, '#6a9a2a', 1, 1.2, 1);
      break;
    case 'bush':
      b.sphere(0.9, 0, 0.6, 0, '#6a7a3a', 1.2, 0.7, 1.2);
      break;
    case 'rock':
      b.sphere(1, 0, 0.4, 0, '#8a8478', 1.2, 0.8, 1);
      break;
    case 'dune':
      b.sphere(1, 0, 0, 0, '#dcbf85', 1, 0.25, 0.6, 1);
      break;
    case 'mountain':
      b.cone(1, 1, 7, 0, 0.5, 0, '#6d7f52');
      break;
    case 'field':
      b.box(1, 0.12, 1, 0, 0.06, 0, '#ffffff');
      break;
    case 'building': // unit box with window bands, tinted per instance
      b.box(1, 1, 1, 0, 0.5, 0, '#ffffff');
      for (let i = 0; i < 4; i++) b.box(1.01, 0.08, 1.01, 0, 0.18 + i * 0.22, 0, '#7a7a7a');
      b.box(1.04, 0.04, 1.04, 0, 1.0, 0, '#cccccc');
      break;
    case 'shop':
      b.box(4, 3.2, 5, 0, 1.6, 0, '#ffffff');
      b.box(0.05, 1.8, 4.2, 2.01, 1.0, 0, '#3a2a1a');
      b.box(1.2, 0.08, 4.6, 2.5, 2.4, 0, '#d84315', 0, 0, -0.2);
      b.box(0.06, 0.6, 4.4, 2.03, 2.85, 0, '#fdd835');
      break;
    case 'hut':
      b.box(3, 2, 3.4, 0, 1, 0, '#b98b5e');
      b.prism(3.6, 1.4, 4, 0, 2, 0, '#7a5236', Math.PI / 2);
      b.box(0.05, 1.3, 0.8, 1.51, 0.65, 0, '#3a2a1a');
      break;
    case 'factory':
      b.box(14, 7, 20, 0, 3.5, 0, '#a7a39a');
      for (let i = 0; i < 5; i++) b.prism(14, 2, 3.8, 0, 7, -8 + i * 4, '#7d8a8a', Math.PI / 2 * 0);
      b.cyl(0.9, 1.2, 22, 8, -4, 11, 6, '#9a5a4a');
      b.cyl(0.95, 0.95, 1.0, 8, -4, 18, 6, '#e0e0e0');
      b.cyl(0.95, 0.95, 1.0, 8, -4, 20.5, 6, '#c62828');
      b.box(0.1, 3, 6, 7.01, 1.5, 0, '#455a64');
      break;
    case 'warehouse':
      b.box(12, 6, 24, 0, 3, 0, '#b0bec5');
      b.prism(12.4, 2.2, 24.4, 0, 6, 0, '#607d8b', 0);
      b.box(0.1, 4, 5, 6.01, 2, -5, '#37474f');
      b.box(0.1, 4, 5, 6.01, 2, 5, '#37474f');
      break;
    case 'tank':
      b.cyl(4, 4, 6, 12, 0, 3, 0, '#d0d0d0');
      b.cone(4.1, 1.2, 12, 0, 6.6, 0, '#bdbdbd');
      break;
    case 'pole':
      b.cyl(0.08, 0.1, 8, 5, 0, 4, 0, '#7a7a7a');
      b.box(1.6, 0.08, 0.08, 0.6, 7.8, 0, '#7a7a7a');
      b.box(0.4, 0.12, 0.25, 1.3, 7.7, 0, '#eeeeaa');
      break;
    case 'epole':
      b.cyl(0.1, 0.14, 9, 5, 0, 4.5, 0, '#9e9e9e');
      b.box(0.1, 0.1, 2.2, 0, 8.6, 0, '#616161');
      break;
    case 'barrier': // crash barrier 4 m piece, along local z
      b.box(0.08, 0.35, 4.0, 0, 0.65, 0, '#d9d9d9');
      b.box(0.1, 0.7, 0.1, 0.06, 0.35, 0, '#9e9e9e');
      break;
    case 'kmstone':
      b.box(0.5, 0.6, 0.2, 0, 0.3, 0, '#f5f5f5');
      b.cyl(0.25, 0.25, 0.2, 8, 0, 0.6, 0, '#fbc02d', Math.PI / 2, 0, 0);
      break;
    case 'cow':
      b.box(0.7, 0.7, 1.6, 0, 1.0, 0, '#f2f2f2');
      b.box(0.4, 0.45, 0.55, 0, 1.25, 1.0, '#eeeeee');
      b.box(0.5, 0.08, 0.08, 0, 1.55, 1.0, '#9e9e9e');
      for (const x of [0.25, -0.25]) for (const z of [0.6, -0.6]) b.box(0.14, 0.7, 0.14, x, 0.35, z, '#e0e0e0');
      break;
    case 'temple':
      b.box(4, 2.5, 4, 0, 1.25, 0, '#f5e6c8');
      b.cone(2.2, 5, 4, 0, 5, 0, '#e08a3c', 0, Math.PI / 4, 0);
      b.box(0.1, 0.8, 0.05, 0, 7.8, 0, '#d84315');
      break;
  }
  return b.build();
}

// Petrol/diesel pump station (generic, unbranded). Faces +X side = towards road when placed on left.
export function pumpStationGeo() {
  const b = new Builder();
  b.box(16, 0.1, 30, 0, 0.05, 0, '#9e9e9e'); // forecourt
  // canopy
  b.box(9, 0.6, 18, -1.5, 5.6, 0, '#f5f5f5');
  b.box(9.05, 0.3, 18.05, -1.5, 5.5, 0, '#2e7d32');
  for (const z of [-7, 7]) b.box(0.4, 5.4, 0.4, -4.5, 2.7, z, '#e0e0e0');
  // pump islands
  for (const z of [-4, 4]) {
    b.box(1.2, 0.25, 3, -4.5, 0.2, z, '#eceff1');
    b.box(0.7, 1.7, 0.9, -4.5, 1.15, z, '#fbc02d');
    b.box(0.72, 0.4, 0.92, -4.5, 1.7, z, '#2e7d32');
  }
  // office
  b.box(5, 3.2, 8, -6, 1.6, -12, '#fafafa');
  b.box(5.05, 0.5, 8.05, -6, 3.0, -12, '#2e7d32');
  // tall price sign
  b.box(0.3, 7, 0.3, 7, 3.5, 13.5, '#888');
  b.box(0.3, 2.2, 2.4, 7, 7.5, 13.5, '#2e7d32');
  b.box(0.32, 1.4, 2.0, 7, 7.4, 13.5, '#fbc02d');
  // stop bay paint (yellow box)
  b.box(0.25, 0.02, 14, 5.6, 0.11, 0, '#ffd600');
  b.box(0.25, 0.02, 14, 1.4, 0.11, 0, '#ffd600');
  b.box(4.4, 0.02, 0.25, 3.5, 0.11, 7, '#ffd600');
  b.box(4.4, 0.02, 0.25, 3.5, 0.11, -7, '#ffd600');
  return b.build();
}

export function dhabaGeo() {
  const b = new Builder();
  b.box(18, 0.06, 32, 0, 0.03, 0, '#a1887f');
  // main hut
  b.box(7, 3, 10, -5, 1.5, -6, '#e0b97a');
  b.box(8, 0.3, 11, -5, 3.1, -6, '#5d4037');
  b.box(8.5, 0.15, 6, -1, 2.6, -6, '#8d6e63', 0, 0, -0.12);
  for (const z of [-8.5, -3.5]) b.box(0.2, 2.6, 0.2, 2.8, 1.3, z, '#5d4037');
  // charpais (rope beds)
  for (let i = 0; i < 4; i++) {
    const z = 4 + i * 2.6;
    b.box(1.0, 0.1, 2.0, -5.5, 0.55, z, '#d7b46a');
    for (const x of [-0.45, 0.45]) for (const zz of [-0.9, 0.9]) b.box(0.08, 0.5, 0.08, -5.5 + x, 0.25, z + zz, '#5d4037');
  }
  // tandoor & water pot
  b.cyl(0.5, 0.7, 0.9, 8, -8, 0.45, 0, '#bf6f3a');
  b.sphere(0.35, -8, 0.4, 2, '#c97a3a');
  // sign board (painted)
  b.box(0.2, 4.5, 0.2, 7, 2.25, -14, '#5d4037');
  b.box(0.25, 1.4, 4, 7, 4.5, -14, '#d84315');
  b.box(0.27, 0.9, 3.6, 7, 4.5, -14, '#ffeb3b');
  // parking bay paint
  b.box(0.25, 0.02, 16, 6, 0.07, 0, '#ffffff');
  b.box(0.25, 0.02, 16, 1.3, 0.07, 0, '#ffffff');
  return b.build();
}

export function signalGeo() {
  const b = new Builder();
  b.cyl(0.1, 0.12, 5.2, 6, 0, 2.6, 0, '#424242');
  b.box(0.1, 0.1, 3.0, 0, 5.1, -1.4, '#424242');
  b.box(0.45, 1.3, 0.35, 0, 4.4, -2.7, '#212121');
  return b.build();
}

export function gateGeo(width, color) {
  const b = new Builder();
  b.box(1.2, 8, 1.2, 0, 4, width / 2, color);
  b.box(1.2, 8, 1.2, 0, 4, -width / 2, color);
  b.box(1.4, 2.2, width + 1.2, 0, 8.6, 0, color);
  b.cone(0.8, 1.6, 4, 0, 10.4, width / 2, '#ffca28');
  b.cone(0.8, 1.6, 4, 0, 10.4, -width / 2, '#ffca28');
  return b.build();
}
