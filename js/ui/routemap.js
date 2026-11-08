// Simple SVG map of India for choosing FROM and TO cities.
import { CITIES, INDIA_OUTLINE, STATES } from '../data/cities.js';

const LON0 = 67.5, LON1 = 98, LAT0 = 6.5, LAT1 = 37.5;
const W = 400, H = 440;
const proj = (lon, lat) => [(lon - LON0) / (LON1 - LON0) * W, (LAT1 - lat) / (LAT1 - LAT0) * H];

export class RouteMap {
  constructor(svg, onChange) {
    this.svg = svg; this.onChange = onChange;
    this.from = null; this.to = null;
    const NS = 'http://www.w3.org/2000/svg';
    const el = (tag, attrs, parent = svg) => { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.appendChild(e); return e; };
    const pts = INDIA_OUTLINE.map(([lo, la]) => proj(lo, la).map((v) => v.toFixed(1)).join(',')).join(' ');
    el('polygon', { points: pts, class: 'india' });
    // state labels (only states with cities)
    const shown = new Set(CITIES.map((c) => c.state));
    for (const code of shown) {
      const [la, lo] = STATES[code].c;
      const [x, y] = proj(lo, la);
      const t = el('text', { x, y: y + 22, 'text-anchor': 'middle', 'font-size': 9, fill: '#9fd3a9', opacity: 0.7, 'font-style': 'italic' });
      t.textContent = STATES[code].name;
    }
    this.line = el('path', { class: 'rline', d: '' });
    this.nodes = {};
    for (const c of CITIES) {
      const [x, y] = proj(c.lon, c.lat);
      const g = el('g', { class: 'city', transform: `translate(${x},${y})` });
      el('circle', { r: 22, class: 'hit' }, g);
      el('circle', { r: 6, class: 'dot' }, g);
      const t = el('text', { x: 9, y: 4 }, g);
      t.textContent = c.name;
      if (['mumbai', 'kochi', 'ahmedabad', 'jodhpur'].includes(c.id)) { t.setAttribute('x', -9); t.setAttribute('text-anchor', 'end'); }
      g.addEventListener('pointerdown', (e) => { e.preventDefault(); this.pick(c.id); });
      this.nodes[c.id] = { g, x, y };
    }
  }
  pick(id) {
    if (!this.from || (this.from && this.to)) { this.from = id; this.to = null; }
    else if (id !== this.from) this.to = id;
    this.refresh();
  }
  set(from, to) { this.from = from; this.to = to; this.refresh(); }
  swap() { if (this.from && this.to) { [this.from, this.to] = [this.to, this.from]; this.refresh(); } }
  clear() { this.from = this.to = null; this.refresh(); }
  refresh() {
    for (const id in this.nodes) {
      const n = this.nodes[id];
      n.g.classList.toggle('from', id === this.from);
      n.g.classList.toggle('to', id === this.to);
    }
    if (this.from && this.to) {
      const a = this.nodes[this.from], b = this.nodes[this.to];
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.15, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.15;
      this.line.setAttribute('d', `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`);
    } else this.line.setAttribute('d', '');
    this.onChange && this.onChange(this.from, this.to);
  }
}
