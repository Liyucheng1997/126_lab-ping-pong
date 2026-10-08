// Small, allocation-light numeric helpers shared by the simulation core.
// Vectors are plain {x, y, z} objects or slices of Float64Array state vectors;
// matrices are row-major Float64Array of size n*n (or n*m).

export function createRng(seed = 1) {
  // mulberry32: tiny, fast, deterministic — lets headless tests replay a match exactly.
  let a = seed >>> 0;
  let spare = null;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    uniform: (lo, hi) => lo + (hi - lo) * next(),
    gaussian: (sigma = 1) => {
      if (spare !== null) {
        const value = spare;
        spare = null;
        return value * sigma;
      }
      let u = 0;
      let v = 0;
      let s = 0;
      do {
        u = next() * 2 - 1;
        v = next() * 2 - 1;
        s = u * u + v * v;
      } while (s >= 1 || s === 0);
      const factor = Math.sqrt((-2 * Math.log(s)) / s);
      spare = v * factor;
      return u * factor * sigma;
    },
    pick: (items) => items[Math.floor(next() * items.length)],
  };
}

export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));

export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const vcopy = (v) => ({ x: v.x, y: v.y, z: v.z });
export const vadd = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const vsub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const vscale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const vdot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const vcross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
export const vlen = (a) => Math.hypot(a.x, a.y, a.z);
export const vnorm = (a) => {
  const l = vlen(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
};
export const vlerp = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
  z: a.z + (b.z - a.z) * t,
});

// ---- dense matrices ------------------------------------------------------

export function matIdentity(n, scale = 1) {
  const m = new Float64Array(n * n);
  for (let i = 0; i < n; i += 1) m[i * n + i] = scale;
  return m;
}

export function matMul(a, b, n, k = n, m = n) {
  // (n×k)·(k×m)
  const out = new Float64Array(n * m);
  for (let i = 0; i < n; i += 1) {
    for (let p = 0; p < k; p += 1) {
      const aip = a[i * k + p];
      if (aip === 0) continue;
      for (let j = 0; j < m; j += 1) out[i * m + j] += aip * b[p * m + j];
    }
  }
  return out;
}

export function matTranspose(a, n, m = n) {
  const out = new Float64Array(n * m);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < m; j += 1) out[j * n + i] = a[i * m + j];
  }
  return out;
}

export function matSymmetrize(a, n) {
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const v = 0.5 * (a[i * n + j] + a[j * n + i]);
      a[i * n + j] = v;
      a[j * n + i] = v;
    }
  }
  return a;
}

export function inverse3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-300) return null;
  const s = 1 / det;
  return new Float64Array([
    A * s, -(b * i - c * h) * s, (b * f - c * e) * s,
    B * s, (a * i - c * g) * s, -(a * f - c * d) * s,
    C * s, -(a * h - b * g) * s, (a * e - b * d) * s,
  ]);
}

export function solve3(m, r) {
  const inv = inverse3(m);
  if (!inv) return null;
  return [
    inv[0] * r[0] + inv[1] * r[1] + inv[2] * r[2],
    inv[3] * r[0] + inv[4] * r[1] + inv[5] * r[2],
    inv[6] * r[0] + inv[7] * r[1] + inv[8] * r[2],
  ];
}

// Eigen-decomposition of a symmetric 3×3 matrix (Jacobi rotations).
// Returns {values:[3], vectors: Float64Array(9) with eigenvectors as columns}.
export function symmetricEigen3(input) {
  const a = Float64Array.from(input);
  const v = matIdentity(3);
  for (let sweep = 0; sweep < 24; sweep += 1) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off < 1e-18) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      const apq = a[p * 3 + q];
      if (Math.abs(apq) < 1e-20) continue;
      const app = a[p * 3 + p];
      const aqq = a[q * 3 + q];
      const theta = (aqq - app) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;
      for (let k = 0; k < 3; k += 1) {
        const akp = a[k * 3 + p];
        const akq = a[k * 3 + q];
        a[k * 3 + p] = c * akp - s * akq;
        a[k * 3 + q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k += 1) {
        const apk = a[p * 3 + k];
        const aqk = a[q * 3 + k];
        a[p * 3 + k] = c * apk - s * aqk;
        a[q * 3 + k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k += 1) {
        const vkp = v[k * 3 + p];
        const vkq = v[k * 3 + q];
        v[k * 3 + p] = c * vkp - s * vkq;
        v[k * 3 + q] = s * vkp + c * vkq;
      }
    }
  }
  return { values: [a[0], a[4], a[8]], vectors: v };
}
