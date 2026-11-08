// 2D collision tests on the ground plane (x, z).
// Box = { x, z, h (heading), hl (half length), hw (half width) }

function axes(b) {
  const fx = Math.sin(b.h), fz = Math.cos(b.h);
  return [[fx, fz], [fz, -fx]]; // forward, left
}
function corners(b) {
  const [f, l] = axes(b);
  const out = [];
  for (const [a, c] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    out.push([b.x + f[0] * b.hl * a + l[0] * b.hw * c, b.z + f[1] * b.hl * a + l[1] * b.hw * c]);
  }
  return out;
}
export { corners as boxCorners };

// Separating axis test. Returns null or { nx, nz, depth, px, pz } (normal points from a to b)
export function boxBox(a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  if (dx * dx + dz * dz > (a.hl + a.hw + b.hl + b.hw) ** 2) return null;
  const ax = [...axes(a), ...axes(b)];
  const ca = corners(a), cb = corners(b);
  let minD = Infinity, n = null;
  for (const [x, z] of ax) {
    let amin = Infinity, amax = -Infinity, bmin = Infinity, bmax = -Infinity;
    for (const c of ca) { const p = c[0] * x + c[1] * z; amin = Math.min(amin, p); amax = Math.max(amax, p); }
    for (const c of cb) { const p = c[0] * x + c[1] * z; bmin = Math.min(bmin, p); bmax = Math.max(bmax, p); }
    const o = Math.min(amax, bmax) - Math.max(amin, bmin);
    if (o <= 0) return null;
    if (o < minD) {
      minD = o;
      const sgn = (dx * x + dz * z) < 0 ? -1 : 1;
      n = [x * sgn, z * sgn];
    }
  }
  // contact point: average of corners of each box inside the other (approx)
  let px = 0, pz = 0, k = 0;
  for (const c of cb) if (pointInBox(c[0], c[1], a)) { px += c[0]; pz += c[1]; k++; }
  for (const c of ca) if (pointInBox(c[0], c[1], b)) { px += c[0]; pz += c[1]; k++; }
  if (k) { px /= k; pz /= k; } else { px = (a.x + b.x) / 2; pz = (a.z + b.z) / 2; }
  return { nx: n[0], nz: n[1], depth: minD, px, pz };
}

export function pointInBox(x, z, b) {
  const [f, l] = axes(b);
  const dx = x - b.x, dz = z - b.z;
  return Math.abs(dx * f[0] + dz * f[1]) <= b.hl && Math.abs(dx * l[0] + dz * l[1]) <= b.hw;
}

// circle vs box. normal points from box to circle.
export function circleBox(cx, cz, r, b) {
  const [f, l] = axes(b);
  const dx = cx - b.x, dz = cz - b.z;
  const lf = Math.max(-b.hl, Math.min(b.hl, dx * f[0] + dz * f[1]));
  const ll = Math.max(-b.hw, Math.min(b.hw, dx * l[0] + dz * l[1]));
  const qx = b.x + f[0] * lf + l[0] * ll, qz = b.z + f[1] * lf + l[1] * ll;
  const ex = cx - qx, ez = cz - qz;
  const d2 = ex * ex + ez * ez;
  if (d2 > r * r) return null;
  const d = Math.sqrt(d2) || 1e-6;
  return { nx: ex / d, nz: ez / d, depth: r - d, px: qx, pz: qz };
}
