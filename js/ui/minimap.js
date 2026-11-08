// Round mini-map: road ahead, truck, pumps, dhabas, destination, traffic.
import { clamp } from '../util.js';
import { STEP } from '../world/route.js';

export class MiniMap {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.t = 0;
    this.scale = 0.22; // px per metre (css)
  }
  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.c.clientWidth || 140;
    this.c.width = w * dpr; this.c.height = w * dpr;
    this.dpr = dpr; this.w = w;
  }
  draw(route, truck, traffic, sP) {
    if (!this.w) this.resize();
    const g = this.g, W = this.w, dpr = this.dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2); g.clip();
    g.fillStyle = 'rgba(20,35,25,0.82)'; g.fillRect(0, 0, W, W);
    const sc = this.scale * (W / 140);
    const cx = W / 2, cy = W * 0.62;
    const h = truck.heading, ch = Math.cos(h), sh = Math.sin(h);
    // world -> map: rotate so truck heading points up. right = -left
    const tx = (x, z) => {
      const dx = x - truck.x, dz = z - truck.z;
      const f = dx * sh + dz * ch;       // forward
      const l = dx * ch - dz * sh;       // left
      return [cx - l * sc, cy - f * sc];
    };
    // road
    g.lineCap = 'round'; g.lineJoin = 'round';
    const a = Math.max(0, sP - 260), b = Math.min(route.length, sP + 700);
    g.beginPath();
    for (let s = a; s <= b; s += 8) {
      const i = Math.min(route.n - 1, Math.floor(s / STEP));
      const p = tx(route.x[i], route.z[i]);
      if (s === a) g.moveTo(p[0], p[1]); else g.lineTo(p[0], p[1]);
    }
    g.strokeStyle = '#9aa0a6'; g.lineWidth = 6; g.stroke();
    g.strokeStyle = '#d7dadc'; g.lineWidth = 2; g.stroke();
    // icons
    const icon = (s, d, fill, label) => {
      if (s < a || s > b) return;
      const p = route.pos(s, d, {});
      const q = tx(p.x, p.z);
      g.fillStyle = fill; g.beginPath(); g.arc(q[0], q[1], 7, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke();
      g.fillStyle = '#fff'; g.font = 'bold 9px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(label, q[0], q[1] + 0.5);
    };
    for (const j of route.junctions) {
      if (j.s < a || j.s > b) continue;
      const p = route.pos(j.s, 0, {}); const q = tx(p.x, p.z);
      g.fillStyle = '#ffeb3b'; g.fillRect(q[0] - 2, q[1] - 2, 4, 4);
    }
    for (const p of route.pumps) icon(p.s, 12, '#f57c00', 'F');
    for (const p of route.dhabas) icon(p.s, 15, '#2e7d32', 'D');
    icon(route.bayS, route.bay.d, '#c62828', '★');
    // traffic
    for (const o of traffic.list) {
      const q = tx(o.x, o.z);
      g.fillStyle = o.dir > 0 ? '#80cbc4' : '#ef9a9a';
      g.fillRect(q[0] - 1.5, q[1] - 2, 3, 4);
    }
    g.restore();
    // truck arrow
    g.fillStyle = '#ffd600'; g.strokeStyle = '#000'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(cx, cy - 9); g.lineTo(cx + 6, cy + 6); g.lineTo(cx, cy + 3); g.lineTo(cx - 6, cy + 6); g.closePath(); g.fill(); g.stroke();
    // off-map destination pointer
    if (route.bayS > b) {
      const p = route.pos(route.bayS, 0, {}); const q = tx(p.x, p.z);
      const ang = Math.atan2(q[1] - cy, q[0] - cx);
      const r = W / 2 - 9;
      g.fillStyle = '#c62828';
      g.beginPath(); g.arc(W / 2 + Math.cos(ang) * r, W / 2 + Math.sin(ang) * r, 5, 0, 7); g.fill();
    }
    g.beginPath(); g.arc(W / 2, W / 2, W / 2 - 1, 0, Math.PI * 2);
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2; g.stroke();
  }
}
