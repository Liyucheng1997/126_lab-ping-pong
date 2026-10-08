// Flight and contact dynamics of a 40 mm table tennis ball.
//
// State vector s = [p(3), v(3), ω(3)] in SI units.
//
//   dp/dt = v
//   dv/dt = -g ŷ − k_D |v| v + k_M r (ω × v) / (1 + 2S)        (drag + Magnus)
//   dω/dt = −c_ω ω                                               (viscous spin decay)
//
// with k_D = ρ C_D A / 2m, k_M = ρ A / 2m and spin ratio S = r|ω⊥|/|v|.
// The lift coefficient C_L = S / (1 + 2S) reproduces the linear low-spin
// regime (C_L ≈ S) and saturates at 0.5 for very high spin.
//
// Contacts (table, net, paddle) use a rigid impulse model of a thin spherical
// shell: normal restitution e(v_n) plus Coulomb friction that either slides
// (impulse μJ_n) or reaches rolling (impulse 2/5·m|u|) within the contact.

import { AIR_DENSITY, BALL, GRAVITY, NET, TABLE } from "./constants.js";

export const STATE_SIZE = 9;

export function createBallModel(overrides = {}) {
  const dragCoefficient = overrides.dragCoefficient ?? BALL.dragCoefficient;
  const mass = overrides.mass ?? BALL.mass;
  return {
    gravity: overrides.gravity ?? GRAVITY,
    dragK: (AIR_DENSITY * dragCoefficient * BALL.area) / (2 * mass),
    magnusK: ((AIR_DENSITY * BALL.area) / (2 * mass)) * (overrides.liftScale ?? 1),
    spinDamping: overrides.spinDamping ?? BALL.spinDamping,
    tableRestitution: overrides.tableRestitution ?? TABLE.restitution,
    tableFriction: overrides.tableFriction ?? TABLE.friction,
  };
}

export const NOMINAL_MODEL = createBallModel();

export function createState(p = { x: 0, y: 0, z: 0 }, v = { x: 0, y: 0, z: 0 }, w = { x: 0, y: 0, z: 0 }) {
  return new Float64Array([p.x, p.y, p.z, v.x, v.y, v.z, w.x, w.y, w.z]);
}

export const position = (s) => ({ x: s[0], y: s[1], z: s[2] });
export const velocity = (s) => ({ x: s[3], y: s[4], z: s[5] });
export const spin = (s) => ({ x: s[6], y: s[7], z: s[8] });

// Writes ds/dt into out[0..8].
function derivative(s, model, out) {
  const vx = s[3];
  const vy = s[4];
  const vz = s[5];
  const wx = s[6];
  const wy = s[7];
  const wz = s[8];
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);

  const cx = wy * vz - wz * vy;
  const cy = wz * vx - wx * vz;
  const cz = wx * vy - wy * vx;
  let magnus = 0;
  if (speed > 1e-6) {
    const crossLen = Math.sqrt(cx * cx + cy * cy + cz * cz);
    const spinRatio = (BALL.radius * crossLen) / (speed * speed);
    magnus = (model.magnusK * BALL.radius) / (1 + 2 * spinRatio);
  }
  const drag = model.dragK * speed;

  out[0] = vx;
  out[1] = vy;
  out[2] = vz;
  out[3] = -drag * vx + magnus * cx;
  out[4] = -drag * vy + magnus * cy - model.gravity;
  out[5] = -drag * vz + magnus * cz;
  out[6] = -model.spinDamping * wx;
  out[7] = -model.spinDamping * wy;
  out[8] = -model.spinDamping * wz;
}

const k1 = new Float64Array(9);
const k2 = new Float64Array(9);
const k3 = new Float64Array(9);
const k4 = new Float64Array(9);
const tmp = new Float64Array(9);

// Classic RK4 flight step, in place.
export function integrateFlight(s, dt, model = NOMINAL_MODEL) {
  derivative(s, model, k1);
  for (let i = 0; i < 9; i += 1) tmp[i] = s[i] + 0.5 * dt * k1[i];
  derivative(tmp, model, k2);
  for (let i = 0; i < 9; i += 1) tmp[i] = s[i] + 0.5 * dt * k2[i];
  derivative(tmp, model, k3);
  for (let i = 0; i < 9; i += 1) tmp[i] = s[i] + dt * k3[i];
  derivative(tmp, model, k4);
  for (let i = 0; i < 9; i += 1) {
    s[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return s;
}

export function acceleration(s, model = NOMINAL_MODEL) {
  const out = new Float64Array(9);
  derivative(s, model, out);
  return { x: out[3], y: out[4], z: out[5] };
}

// ---- impulse contact ------------------------------------------------------

export function tableRestitution(normalSpeed, base = TABLE.restitution) {
  // restitution of celluloid/ABS balls drops with impact speed
  return Math.min(0.94, Math.max(0.72, base + 0.044 - 0.018 * normalSpeed));
}

export function paddleRestitution(normalSpeed, base = 0.86) {
  return Math.min(0.92, Math.max(0.68, base + 0.06 - 0.012 * normalSpeed));
}

/**
 * Applies a contact impulse in place.
 * n: unit contact normal pointing from the surface towards the ball centre.
 * surfaceVel: velocity of the surface at the contact point.
 * Returns {normalSpeed, sliding, impulse} or null if the ball is separating.
 */
export function applyImpact(s, n, restitution, friction, surfaceVel = { x: 0, y: 0, z: 0 }) {
  const r = BALL.radius;
  const m = BALL.mass;
  const I = BALL.inertia;
  const rvx = s[3] - surfaceVel.x;
  const rvy = s[4] - surfaceVel.y;
  const rvz = s[5] - surfaceVel.z;
  const vn = rvx * n.x + rvy * n.y + rvz * n.z;
  if (vn >= 0) return null;

  const e = typeof restitution === "function" ? restitution(-vn) : restitution;
  // tangential slip of the contact point: u = v_t + ω × (−r n)
  const wx = s[6];
  const wy = s[7];
  const wz = s[8];
  const ux = rvx - vn * n.x - r * (wy * n.z - wz * n.y);
  const uy = rvy - vn * n.y - r * (wz * n.x - wx * n.z);
  const uz = rvz - vn * n.z - r * (wx * n.y - wy * n.x);
  const slip = Math.sqrt(ux * ux + uy * uy + uz * uz);

  const jn = m * (1 + e) * -vn;
  // impulse that brings the contact point to rest (rolling) for a thin shell
  const jStop = (m * slip * 2) / 5;
  const sliding = friction * jn < jStop;
  const jt = sliding ? friction * jn : jStop;

  let dx = 0;
  let dy = 0;
  let dz = 0;
  if (slip > 1e-9) {
    dx = ux / slip;
    dy = uy / slip;
    dz = uz / slip;
  }
  s[3] += (jn * n.x - jt * dx) / m;
  s[4] += (jn * n.y - jt * dy) / m;
  s[5] += (jn * n.z - jt * dz) / m;
  // Δω = (r_c × (−J_t d)) / I = r J_t (n × d) / I
  const kw = (r * jt) / I;
  s[6] += kw * (n.y * dz - n.z * dy);
  s[7] += kw * (n.z * dx - n.x * dz);
  s[8] += kw * (n.x * dy - n.y * dx);
  return { normalSpeed: -vn, sliding, impulse: jn };
}

// ---- environment contacts --------------------------------------------------

const surfaceY = TABLE.height + BALL.radius;
const netTop = TABLE.height + NET.height;

function insideTable(x, z) {
  return Math.abs(x) <= TABLE.halfLength && Math.abs(z) <= TABLE.halfWidth;
}

const UP = { x: 0, y: 1, z: 0 };

function bounceOnTable(s, model) {
  s[1] = surfaceY;
  return applyImpact(
    s,
    UP,
    (vn) => tableRestitution(vn, model.tableRestitution),
    model.tableFriction,
  );
}

// Net modelled as a thin vertical rectangle in the x = 0 plane.
function netContact(s) {
  const cy = Math.min(Math.max(s[1], TABLE.height), netTop);
  const cz = Math.min(Math.max(s[2], -NET.halfLength), NET.halfLength);
  const dx = s[0];
  const dy = s[1] - cy;
  const dz = s[2] - cz;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const reach = BALL.radius + NET.thickness * 0.5;
  if (dist >= reach || dist < 1e-9) return null;
  return { n: { x: dx / dist, y: dy / dist, z: dz / dist }, depth: reach - dist };
}

/**
 * Advances the ball by dt including table and net contacts.
 * Returns an array of contact events (possibly empty).
 * `floor` enables bounces on the arena floor (y = 0) for dead balls.
 */
export function stepBall(s, dt, model = NOMINAL_MODEL, { floor = false } = {}) {
  const events = [];
  const x0 = s[0];
  const y0 = s[1];
  const z0 = s[2];
  integrateFlight(s, dt, model);

  // table top (only from above, contact point inside the playing surface)
  if (s[1] < surfaceY && y0 >= surfaceY && s[4] < 0) {
    const f = (y0 - surfaceY) / (y0 - s[1]);
    const cx = x0 + (s[0] - x0) * f;
    const cz = z0 + (s[2] - z0) * f;
    if (insideTable(cx, cz)) {
      s[0] = cx;
      s[2] = cz;
      const impact = bounceOnTable(s, model);
      if (impact) {
        events.push({ type: "table", x: cx, z: cz, side: cx < 0 ? -1 : 1, speed: impact.normalSpeed });
        // finish the remainder of the step after the bounce
        const rest = dt * (1 - f);
        if (rest > 1e-7) integrateFlight(s, rest, model);
      }
    }
  }

  // net (also catches a sign change of x that would tunnel through)
  let contact = netContact(s);
  if (!contact && Math.sign(x0) !== Math.sign(s[0]) && s[1] < netTop + BALL.radius && s[1] > TABLE.height) {
    if (Math.abs(s[2]) <= NET.halfLength) {
      contact = { n: { x: Math.sign(x0) || 1, y: 0, z: 0 }, depth: BALL.radius + Math.abs(s[0]) };
    }
  }
  if (contact) {
    const impact = applyImpact(s, contact.n, NET.restitution, 0.3);
    s[0] += contact.n.x * contact.depth;
    s[1] += contact.n.y * contact.depth;
    s[2] += contact.n.z * contact.depth;
    if (impact) events.push({ type: "net", x: s[0], y: s[1], z: s[2], speed: impact.normalSpeed });
  }

  // table edges and sides: sphere vs. the table-top slab. A contact whose normal
  // points mostly upwards touched the top edge (a legal "edge ball"); otherwise
  // the ball clipped the side of the table.
  if (!events.length && Math.abs(s[0]) < TABLE.halfLength + BALL.radius && Math.abs(s[2]) < TABLE.halfWidth + BALL.radius) {
    const qx = Math.min(Math.max(s[0], -TABLE.halfLength), TABLE.halfLength);
    const qy = Math.min(Math.max(s[1], TABLE.height - TABLE.thickness), TABLE.height);
    const qz = Math.min(Math.max(s[2], -TABLE.halfWidth), TABLE.halfWidth);
    const dx = s[0] - qx;
    const dy = s[1] - qy;
    const dz = s[2] - qz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist < BALL.radius && dist > 1e-9) {
      const n = { x: dx / dist, y: dy / dist, z: dz / dist };
      const top = n.y > 0.35;
      const impact = top
        ? applyImpact(s, n, (vn) => tableRestitution(vn, model.tableRestitution), model.tableFriction)
        : applyImpact(s, n, 0.55, 0.2);
      const push = BALL.radius - dist;
      s[0] += n.x * push;
      s[1] += n.y * push;
      s[2] += n.z * push;
      if (impact) {
        events.push(
          top
            ? { type: "table", x: qx, z: qz, side: qx < 0 ? -1 : 1, speed: impact.normalSpeed, edge: true }
            : { type: "side", x: qx, z: qz, side: qx < 0 ? -1 : 1 },
        );
      }
    }
  }

  if (floor && s[1] < BALL.radius && s[4] < 0) {
    s[1] = BALL.radius;
    const impact = applyImpact(s, UP, 0.78, 0.35);
    if (impact) events.push({ type: "floor", x: s[0], z: s[2], speed: impact.normalSpeed });
  }
  return events;
}

/**
 * Forward-simulates a copy of the state. Returns samples every `stride` steps.
 * Stops early when `until(sample, events)` returns true.
 */
export function rollout(s0, { horizon = 1.2, dt = 0.002, stride = 1, model = NOMINAL_MODEL, until = null } = {}) {
  const s = Float64Array.from(s0);
  const samples = [{ t: 0, s: Float64Array.from(s), events: [] }];
  const steps = Math.ceil(horizon / dt);
  for (let i = 1; i <= steps; i += 1) {
    const events = stepBall(s, dt, model);
    if (i % stride === 0 || events.length) {
      const sample = { t: i * dt, s: Float64Array.from(s), events };
      samples.push(sample);
      if (until && until(sample)) break;
    }
    if (s[1] < 0) break;
  }
  return samples;
}
