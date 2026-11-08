// States, cities, how states connect, and how each state looks.
// Coordinates are approximate (lat, lon). The outline of India is a
// simplified hand-drawn polygon (own work) for the route map.

export const STATES = {
  DL: { name: 'Delhi', c: [28.6, 77.2] },
  HR: { name: 'Haryana', c: [29.1, 76.1] },
  RJ: { name: 'Rajasthan', c: [26.6, 73.8] },
  GJ: { name: 'Gujarat', c: [22.7, 71.6] },
  MP: { name: 'Madhya Pradesh', c: [23.5, 78.5] },
  UP: { name: 'Uttar Pradesh', c: [26.9, 80.9] },
  BR: { name: 'Bihar', c: [25.6, 85.6] },
  JH: { name: 'Jharkhand', c: [23.6, 85.3] },
  WB: { name: 'West Bengal', c: [23.0, 87.9] },
  OD: { name: 'Odisha', c: [20.5, 84.4] },
  CG: { name: 'Chhattisgarh', c: [21.3, 81.9] },
  MH: { name: 'Maharashtra', c: [19.5, 75.7] },
  TG: { name: 'Telangana', c: [17.9, 79.0] },
  AP: { name: 'Andhra Pradesh', c: [15.9, 79.7] },
  KA: { name: 'Karnataka', c: [14.5, 75.7] },
  TN: { name: 'Tamil Nadu', c: [11.1, 78.6] },
  KL: { name: 'Kerala', c: [10.3, 76.4] },
};

export const ADJ = {
  DL: ['HR', 'UP'],
  HR: ['DL', 'RJ', 'UP'],
  RJ: ['HR', 'UP', 'MP', 'GJ'],
  GJ: ['RJ', 'MP', 'MH'],
  MP: ['RJ', 'UP', 'CG', 'MH', 'GJ'],
  UP: ['HR', 'DL', 'RJ', 'MP', 'CG', 'JH', 'BR'],
  BR: ['UP', 'JH', 'WB'],
  JH: ['BR', 'UP', 'CG', 'OD', 'WB'],
  WB: ['BR', 'JH', 'OD'],
  OD: ['WB', 'JH', 'CG', 'AP'],
  CG: ['UP', 'MP', 'MH', 'TG', 'OD', 'JH', 'AP'],
  MH: ['GJ', 'MP', 'CG', 'TG', 'KA'],
  TG: ['MH', 'CG', 'AP', 'KA'],
  AP: ['TG', 'CG', 'OD', 'KA', 'TN'],
  KA: ['MH', 'TG', 'AP', 'TN', 'KL'],
  TN: ['KA', 'AP', 'KL'],
  KL: ['KA', 'TN'],
};

export const CITIES = [
  { id: 'delhi', name: 'Delhi', state: 'DL', lat: 28.61, lon: 77.21 },
  { id: 'jaipur', name: 'Jaipur', state: 'RJ', lat: 26.91, lon: 75.79 },
  { id: 'jodhpur', name: 'Jodhpur', state: 'RJ', lat: 26.24, lon: 73.02 },
  { id: 'ahmedabad', name: 'Ahmedabad', state: 'GJ', lat: 23.02, lon: 72.57 },
  { id: 'mumbai', name: 'Mumbai', state: 'MH', lat: 19.08, lon: 72.88 },
  { id: 'pune', name: 'Pune', state: 'MH', lat: 18.52, lon: 73.86 },
  { id: 'bengaluru', name: 'Bengaluru', state: 'KA', lat: 12.97, lon: 77.59 },
  { id: 'chennai', name: 'Chennai', state: 'TN', lat: 13.08, lon: 80.27 },
  { id: 'lucknow', name: 'Lucknow', state: 'UP', lat: 26.85, lon: 80.95 },
  { id: 'agra', name: 'Agra', state: 'UP', lat: 27.18, lon: 78.01 },
  { id: 'kolkata', name: 'Kolkata', state: 'WB', lat: 22.57, lon: 88.36 },
  { id: 'bhopal', name: 'Bhopal', state: 'MP', lat: 23.26, lon: 77.41 },
  { id: 'hyderabad', name: 'Hyderabad', state: 'TG', lat: 17.39, lon: 78.49 },
  { id: 'kochi', name: 'Kochi', state: 'KL', lat: 9.93, lon: 76.27 },
];

// Look and feel of each state.
// ground: base ground colour, field: crop colours, trees: tree types used,
// hills: whether a ghat section appears, sky: haze colour
const T = (o) => Object.assign({
  ground: '#7f9a4a', shoulder: '#a68b62', field: ['#6f9b3a', '#88a845'], trees: ['round'],
  treeDensity: 1, hills: false, sky: '#bcd3e6', dunes: false, rocks: false, mountain: '#6d7f52',
  hut: '#b98b5e', roof: '#7a5236',
}, o);

export const THEMES = {
  DL: T({ ground: '#8c9a5a', field: ['#7aa040', '#c9b23c'], trees: ['round', 'neem'], sky: '#c9d3d8' }),
  HR: T({ ground: '#8fa055', field: ['#7aa040', '#d8c23a'], trees: ['round', 'neem'] }),
  RJ: T({ ground: '#d6b47a', shoulder: '#c9a46a', field: ['#c8a865', '#b8a058'], trees: ['khejri', 'bush'], treeDensity: 0.35, dunes: true, sky: '#e6dcc4', mountain: '#b89466', hills: true, hut: '#d9a86a', roof: '#a8743c' }),
  GJ: T({ ground: '#b9ad6a', field: ['#d9d6c6', '#a9a24f'], trees: ['khejri', 'round', 'bush'], treeDensity: 0.6, sky: '#dcdccc' }),
  MP: T({ ground: '#8c8a4c', field: ['#9a9a40', '#6f8a3a'], trees: ['round', 'teak'], hills: true, rocks: true, mountain: '#5f6e3f' }),
  UP: T({ ground: '#6f9a3c', field: ['#5f9a2e', '#e3cc2c', '#7fae3a'], trees: ['round', 'mango'], treeDensity: 1.2 }),
  BR: T({ ground: '#6a9a3a', field: ['#5aa02c', '#7fb03a'], trees: ['mango', 'banana', 'round'], treeDensity: 1.2 }),
  JH: T({ ground: '#6d8a3a', field: ['#5a8a2c'], trees: ['teak', 'round'], treeDensity: 1.4, hills: true, rocks: true, mountain: '#4f6a33' }),
  WB: T({ ground: '#5f9a35', field: ['#58a82c', '#7cc03a'], trees: ['banana', 'palm', 'bamboo', 'mango'], treeDensity: 1.4, sky: '#c2d6dc' }),
  OD: T({ ground: '#629a3a', field: ['#58a82c'], trees: ['palm', 'round'], treeDensity: 1.2 }),
  CG: T({ ground: '#6a8a38', field: ['#5a9a2c'], trees: ['teak', 'round'], treeDensity: 1.5, hills: true, mountain: '#4c6a30' }),
  MH: T({ ground: '#6d6a45', shoulder: '#6b5a44', field: ['#5d8a2a', '#7aa03a', '#4a7a2a'], trees: ['round', 'mango'], hills: true, rocks: true, mountain: '#58663d' }),
  TG: T({ ground: '#9a8a5c', field: ['#9aa04a'], trees: ['bush', 'round'], treeDensity: 0.6, rocks: true, mountain: '#8a7a5a' }),
  AP: T({ ground: '#a8744c', shoulder: '#a0603e', field: ['#6a9a33', '#88aa44'], trees: ['palm', 'round'], rocks: true }),
  KA: T({ ground: '#9a6a44', shoulder: '#a35c3a', field: ['#5a9a2c', '#7fb03a'], trees: ['palm', 'round', 'mango'], treeDensity: 1.2, hills: true, mountain: '#4c6e34' }),
  TN: T({ ground: '#8a7a48', shoulder: '#a0603e', field: ['#58a82c', '#7cc03a'], trees: ['palm', 'palm', 'round'], treeDensity: 1.3, hills: true, mountain: '#4f7038' }),
  KL: T({ ground: '#4f8a32', shoulder: '#9a5a3a', field: ['#4fa02a'], trees: ['palm', 'palm', 'banana'], treeDensity: 1.8, hills: true, mountain: '#3f6a2c', sky: '#bcd8dc' }),
};

// Simplified outline of India (lon, lat), clockwise from Kutch.
export const INDIA_OUTLINE = [
  [68.2, 23.7], [69.0, 22.4], [70.9, 20.7], [72.6, 21.2], [72.8, 19.0], [73.3, 17.0], [73.8, 15.4],
  [74.8, 12.9], [75.8, 11.2], [76.3, 9.9], [77.5, 8.1], [78.2, 8.9], [79.3, 10.3], [79.9, 11.9],
  [80.3, 13.1], [80.2, 15.5], [81.3, 16.3], [82.3, 17.0], [83.3, 17.7], [85.1, 19.4], [86.5, 20.2],
  [87.0, 21.5], [88.2, 21.6], [89.0, 21.9], [88.7, 23.2], [88.6, 24.3], [88.0, 24.6], [88.4, 25.2],
  [89.8, 25.9], [90.6, 25.2], [92.0, 25.0], [92.3, 24.2], [91.6, 23.4], [91.8, 22.4], [92.6, 21.9],
  [93.3, 22.9], [94.2, 23.8], [94.6, 25.5], [95.2, 26.6], [96.6, 27.2], [97.3, 28.2], [95.5, 28.9],
  [94.0, 28.1], [92.0, 27.3], [89.8, 26.8], [88.8, 27.4], [88.1, 26.5], [86.0, 26.6], [84.0, 27.4],
  [82.0, 27.8], [80.6, 28.8], [80.3, 30.2], [79.0, 31.3], [78.4, 32.5], [79.5, 33.0], [79.8, 35.0],
  [77.8, 35.5], [74.5, 37.0], [73.7, 34.4], [74.0, 33.0], [74.6, 32.6], [74.5, 31.1], [73.9, 30.0],
  [71.9, 27.9], [70.0, 27.2], [69.5, 26.0], [70.3, 25.4], [68.8, 24.3],
];

export function cityById(id) { return CITIES.find((c) => c.id === id); }

// Shortest state path between two states (Dijkstra on centroid distances)
export function statePath(a, b) {
  const dist = {}, prev = {}, Q = new Set(Object.keys(STATES));
  for (const k of Q) dist[k] = Infinity;
  dist[a] = 0;
  const d2 = (x, y) => {
    const p = STATES[x].c, q = STATES[y].c;
    return Math.hypot(p[0] - q[0], (p[1] - q[1]) * Math.cos(((p[0] + q[0]) / 2) * Math.PI / 180));
  };
  while (Q.size) {
    let u = null;
    for (const k of Q) if (u === null || dist[k] < dist[u]) u = k;
    Q.delete(u);
    if (u === b) break;
    for (const v of ADJ[u]) {
      const alt = dist[u] + d2(u, v);
      if (alt < dist[v]) { dist[v] = alt; prev[v] = u; }
    }
  }
  const path = [b];
  while (path[0] !== a) path.unshift(prev[path[0]]);
  return path;
}
