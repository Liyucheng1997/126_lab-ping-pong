// Stroke planning: interception point selection, return-shot targeting and
// paddle-impact inversion.
//
//  1. Interception: roll the EKF estimate forward, keep samples after the
//     bounce on our half that are reachable by the gantry, and score them by
//     hitting height, ball speed and the drive effort needed to get there.
//  2. Targeting: choose a landing point and flight time on the opponent's half,
//     then solve the boundary-value problem  p(T; p_hit, v_out, ω_out) = L  for
//     the outgoing velocity with Newton's method on the full aerodynamic model.
//  3. Impact inversion: find the blade normal n and blade speed σ (blade moves
//     along n) such that the rubber impact model maps (v_in, ω_in) to v_out.
//     The outgoing spin depends on (n, σ), so steps 2–3 are iterated.
//  4. Validation: roll out the resulting shot through table/net contacts and
//     reject it unless it clears the net and lands inside the table.

import { applyImpact, integrateFlight, NOMINAL_MODEL, paddleRestitution, rollout } from "./ballPhysics.js";
import { BALL, NET, PADDLE, TABLE } from "./constants.js";
import { clamp, solve3, vdot, vnorm, vsub } from "./math.js";
import {
  dirToLocal,
  GANTRY,
  inverseKinematics,
  jointVelocityForTranslation,
  tableClearance,
  toLocal,
} from "./robot.js";

const SURFACE = TABLE.height + BALL.radius;
const CONTACT_OFFSET = BALL.radius + PADDLE.halfThickness;
export const MAX_BLADE_SPEED = 7.2;

// ---- impact model --------------------------------------------------------------

// Unit vector in the blade plane pointing "up" — the brushing direction used
// to generate topspin.
export function brushDirection(normal) {
  const d = normal.y;
  return vnorm({ x: -d * normal.x, y: 1 - d * normal.y, z: -d * normal.z });
}

// Blade velocity = σ·n (hitting) + β·t (upward brushing in the blade plane).
export function bladeVelocity(normal, bladeSpeed, brush = 0) {
  const t = brushDirection(normal);
  return {
    x: normal.x * bladeSpeed + t.x * brush,
    y: normal.y * bladeSpeed + t.y * brush,
    z: normal.z * bladeSpeed + t.z * brush,
  };
}

export function paddleImpact(vIn, wIn, normal, bladeSpeed, brush = 0) {
  const s = new Float64Array([0, 0, 0, vIn.x, vIn.y, vIn.z, wIn.x, wIn.y, wIn.z]);
  applyImpact(
    s,
    normal,
    (vn) => paddleRestitution(vn, PADDLE.restitution),
    PADDLE.friction,
    bladeVelocity(normal, bladeSpeed, brush),
  );
  return { v: { x: s[3], y: s[4], z: s[5] }, w: { x: s[6], y: s[7], z: s[8] } };
}

// normal parameterised as (−side, a, b)/|·| so it always faces the opponent
const normalFrom = (side, a, b) => vnorm({ x: -side, y: a, z: b });

export function invertImpact(side, vIn, wIn, vOut, brush = 0) {
  let n = vnorm(vsub(vOut, vIn));
  if (n.x * -side < 0.2) n = vnorm({ x: -side, y: n.y, z: n.z });
  let a = n.y / Math.abs(n.x);
  let b = n.z / Math.abs(n.x);
  const e0 = paddleRestitution(Math.abs(vdot(vsub(vIn, vOut), n)) * 0.5);
  let sigma = (vdot(vOut, n) + e0 * vdot(vIn, n)) / (1 + e0);

  const residual = (pa, pb, ps) => {
    const out = paddleImpact(vIn, wIn, normalFrom(side, pa, pb), ps, brush).v;
    return [out.x - vOut.x, out.y - vOut.y, out.z - vOut.z];
  };
  let r = residual(a, b, sigma);
  for (let iter = 0; iter < 12; iter += 1) {
    const err = Math.hypot(...r);
    if (err < 1e-4) break;
    const h = 1e-4;
    const ra = residual(a + h, b, sigma);
    const rb = residual(a, b + h, sigma);
    const rs = residual(a, b, sigma + h);
    const J = new Float64Array(9);
    for (let i = 0; i < 3; i += 1) {
      J[i * 3] = (ra[i] - r[i]) / h;
      J[i * 3 + 1] = (rb[i] - r[i]) / h;
      J[i * 3 + 2] = (rs[i] - r[i]) / h;
    }
    const step = solve3(J, r);
    if (!step) break;
    // damped Newton: shrink the step until the residual decreases
    let lambda = 1;
    let next = null;
    for (let k = 0; k < 6; k += 1) {
      const na = a - lambda * step[0];
      const nb = b - lambda * step[1];
      const ns = sigma - lambda * step[2];
      const rn = residual(na, nb, ns);
      if (Math.hypot(...rn) < err) {
        next = [na, nb, ns, rn];
        break;
      }
      lambda *= 0.5;
    }
    if (!next) break;
    [a, b, sigma, r] = next;
  }
  const normal = normalFrom(side, a, b);
  const out = paddleImpact(vIn, wIn, normal, sigma, brush);
  return { normal, bladeSpeed: sigma, brush, vOut: out.v, wOut: out.w, error: Math.hypot(...r) };
}

// ---- ballistic targeting ---------------------------------------------------------

function flyFor(p, v, w, T, model) {
  const steps = Math.max(8, Math.ceil(T / 0.004));
  const dt = T / steps;
  const s = new Float64Array([p.x, p.y, p.z, v.x, v.y, v.z, w.x, w.y, w.z]);
  for (let i = 0; i < steps; i += 1) integrateFlight(s, dt, model);
  return s;
}

// Solve p(T) = target for the launch velocity (shooting method).
export function solveLaunch(p, w, target, T, model = NOMINAL_MODEL, guess = null) {
  let v = guess ?? {
    x: ((target.x - p.x) / T) * 1.08,
    y: (target.y - p.y) / T + 0.5 * model.gravity * T,
    z: ((target.z - p.z) / T) * 1.08,
  };
  const residual = (vv) => {
    const s = flyFor(p, vv, w, T, model);
    return [s[0] - target.x, s[1] - target.y, s[2] - target.z];
  };
  let r = residual(v);
  for (let iter = 0; iter < 10; iter += 1) {
    if (Math.hypot(...r) < 2e-4) break;
    const h = 1e-3;
    const cols = [
      residual({ x: v.x + h, y: v.y, z: v.z }),
      residual({ x: v.x, y: v.y + h, z: v.z }),
      residual({ x: v.x, y: v.y, z: v.z + h }),
    ];
    const J = new Float64Array(9);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) J[i * 3 + j] = (cols[j][i] - r[i]) / h;
    }
    const step = solve3(J, r);
    if (!step) break;
    v = { x: v.x - step[0], y: v.y - step[1], z: v.z - step[2] };
    r = residual(v);
  }
  return { v, error: Math.hypot(...r) };
}

// Service: the ball must bounce on the server's half first. Solve for the
// launch velocity that puts the first bounce at x1 and the second bounce at L2
// (three equations, three unknowns) by Newton iteration over full rollouts.
export function solveServeLaunch(p, w, x1, target, model = NOMINAL_MODEL, guess = null) {
  let v = guess;
  if (!v) {
    const T1 = 0.1;
    v = solveLaunch(p, w, { x: x1, y: SURFACE, z: p.z + (target.z - p.z) * 0.25 }, T1, model).v;
  }
  const residual = (vv) => {
    const s0 = new Float64Array([p.x, p.y, p.z, vv.x, vv.y, vv.z, w.x, w.y, w.z]);
    const bounces = [];
    const path = rollout(s0, {
      horizon: 1.2,
      dt: 0.002,
      stride: 50,
      model,
      until: (sample) => {
        for (const e of sample.events) if (e.type === "table") bounces.push(e);
        return bounces.length >= 2;
      },
    });
    const last = path[path.length - 1].s;
    const b1 = bounces[0] ?? { x: last[0], z: last[2] };
    const b2 = bounces[1] ?? { x: last[0], z: last[2] };
    return [b1.x - x1, b2.x - target.x, b2.z - target.z];
  };
  let r = residual(v);
  for (let iter = 0; iter < 12; iter += 1) {
    const err = Math.hypot(...r);
    if (err < 1e-3) break;
    const h = 2e-3;
    const cols = [
      residual({ x: v.x + h, y: v.y, z: v.z }),
      residual({ x: v.x, y: v.y + h, z: v.z }),
      residual({ x: v.x, y: v.y, z: v.z + h }),
    ];
    const J = new Float64Array(9);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) J[i * 3 + j] = (cols[j][i] - r[i]) / h;
    }
    const step = solve3(J, r);
    if (!step) break;
    let lambda = 1;
    let accepted = false;
    for (let k = 0; k < 6; k += 1) {
      const cand = { x: v.x - lambda * step[0], y: v.y - lambda * step[1], z: v.z - lambda * step[2] };
      const rc = residual(cand);
      if (Math.hypot(...rc) < err) {
        v = cand;
        r = rc;
        accepted = true;
        break;
      }
      lambda *= 0.5;
    }
    if (!accepted) break;
  }
  return { v, error: Math.hypot(...r) };
}

// Full rollout of a candidate shot through table and net contacts.
export function simulateShot(p, v, w, model = NOMINAL_MODEL, horizon = 1.6) {
  const s0 = new Float64Array([p.x, p.y, p.z, v.x, v.y, v.z, w.x, w.y, w.z]);
  const bounces = [];
  let netClearance = Infinity;
  let netHit = false;
  let prevX = p.x;
  const path = rollout(s0, {
    horizon,
    dt: 0.002,
    stride: 4,
    model,
    until: (sample) => {
      for (const e of sample.events) {
        if (e.type === "table") bounces.push({ ...e, t: sample.t });
        if (e.type === "net" || e.type === "side") netHit = true;
      }
      return bounces.length >= 2 || sample.s[1] < TABLE.height - 0.3;
    },
  });
  for (const sample of path) {
    const x = sample.s[0];
    if (Math.sign(x) !== Math.sign(prevX)) {
      netClearance = Math.min(netClearance, sample.s[1] - BALL.radius - (TABLE.height + NET.height));
    }
    prevX = x;
  }
  return { path, bounces, netClearance, netHit };
}

const inBounds = (b, margin) =>
  Math.abs(b.x) <= TABLE.halfLength - margin && Math.abs(b.z) <= TABLE.halfWidth - margin;

/**
 * Solves the complete stroke for a ball state at the hitting instant.
 * spec: { side, target:{x,z}, flightTime, serve?:bool, netMargin }
 */
export function solveStroke(ballState, spec, model = NOMINAL_MODEL) {
  const { side } = spec;
  const p = { x: ballState[0], y: ballState[1], z: ballState[2] };
  const vIn = { x: ballState[3], y: ballState[4], z: ballState[5] };
  const wIn = { x: ballState[6], y: ballState[7], z: ballState[8] };
  const target = { x: spec.target.x, y: SURFACE, z: spec.target.z };

  let wOut = { x: 0, y: 0, z: 0 };
  let launch = null;
  let impact = null;
  for (let iter = 0; iter < 3; iter += 1) {
    launch = spec.serve
      ? solveServeLaunch(p, wOut, spec.firstBounceX, target, model, launch?.v)
      : solveLaunch(p, wOut, target, spec.flightTime, model, launch?.v);
    impact = invertImpact(side, vIn, wIn, launch.v, spec.brush ?? 0);
    wOut = impact.wOut;
  }
  if (!launch || launch.error > 5e-3 || impact.error > 5e-3) return null;
  if (Math.abs(impact.bladeSpeed) > MAX_BLADE_SPEED) return null;

  const shot = simulateShot(p, impact.vOut, impact.wOut, model);
  const [first, second] = shot.bounces;
  if (shot.netHit || !first) return null;
  if (spec.serve) {
    if (Math.sign(first.x) !== side || !second || Math.sign(second.x) !== -side) return null;
    if (!inBounds(second, 0.04) || shot.netClearance < spec.netMargin) return null;
  } else {
    if (Math.sign(first.x) !== -side || !inBounds(first, 0.03)) return null;
    if (shot.netClearance < spec.netMargin) return null;
  }
  return {
    normal: impact.normal,
    bladeSpeed: impact.bladeSpeed,
    brush: impact.brush,
    vOut: impact.vOut,
    wOut: impact.wOut,
    landing: spec.serve ? second : first,
    firstBounce: first,
    netClearance: shot.netClearance,
    path: shot.path,
  };
}

// ---- interception -------------------------------------------------------------------

export function predictBall(state, horizon = 1.3, model = NOMINAL_MODEL) {
  return rollout(state, { horizon, dt: 0.002, stride: 2, model });
}

/**
 * Ranks hitting instants along a predicted path (best first).
 * mode "rally": after the bounce on our half; "serve": while the tossed ball descends.
 */
export function chooseInterception(path, { side, t0, now, currentQ, previousHit = null, mode = "rally", bounced = false, relaxed = false }) {
  let start = 1;
  if (mode === "rally" && !bounced) {
    const ownBounce = path.findIndex((sample) => sample.events.some((e) => e.type === "table" && e.side === side));
    if (ownBounce < 0) return [];
    start = ownBounce + 1;
  }
  const candidates = [];
  for (let i = start; i < path.length; i += 1) {
    const sample = path[i];
    const s = sample.s;
    if (sample.events.some((e) => e.type === "table")) break; // second bounce
    const tHit = t0 + sample.t;
    const T = tHit - now;
    if (T < 0.06) continue;
    if (mode === "serve" && (s[4] > -0.2 || s[1] > TABLE.height + 0.34)) continue;
    if (mode === "rally" && side * s[3] < 0.3) continue;
    if (s[1] < TABLE.height + 0.07) continue;

    const local = toLocal(side, { x: s[0], y: s[1], z: s[2] });
    // nominal blade orientation for feasibility screening: face the net
    const normal = { x: -1, y: 0, z: 0 };
    const centre = { x: local.x + CONTACT_OFFSET, y: local.y, z: local.z };
    const ik = inverseKinematics(centre, normal, 0.05);
    if (ik.violation > 0) continue;
    if (tableClearance(centre, side) < 0.02) continue;

    // drive effort: rest-to-rest quintic peak acceleration = 5.77·Δq/T²
    let effort = 0;
    for (let k = 0; k < 3; k += 1) {
      const ratio = (5.77 * Math.abs(ik.q[k] - currentQ[k])) / (T * T) / GANTRY.axes[k].amax;
      effort = Math.max(effort, ratio);
    }
    if (effort > (relaxed ? 2.5 : 0.85)) continue;

    const height = s[1] - TABLE.height;
    let cost =
      2.2 * Math.abs(height - 0.3) +
      0.12 * Math.abs(s[4]) +
      0.9 * effort +
      0.6 * Math.max(0, 0.18 - T) +
      0.12 * Math.abs(local.z);
    if (mode === "rally") cost += 0.5 * Math.max(0, Math.abs(s[0]) - 1.7);
    if (previousHit !== null) cost += 3 * Math.abs(tHit - previousHit);
    candidates.push({ index: i, tHit, state: s, cost, effort });
  }
  candidates.sort((a, b) => a.cost - b.cost);
  // keep a few well-separated options so a failed stroke solve can fall back
  const picked = [];
  for (const c of candidates) {
    if (picked.every((p) => Math.abs(p.tHit - c.tHit) > 0.025)) picked.push(c);
    if (picked.length >= 4) break;
  }
  return picked;
}

// ---- joint-space targets ------------------------------------------------------------

export function strokeToJoints(side, ballState, stroke) {
  const n = stroke.normal;
  const centreWorld = {
    x: ballState[0] - n.x * CONTACT_OFFSET,
    y: ballState[1] - n.y * CONTACT_OFFSET,
    z: ballState[2] - n.z * CONTACT_OFFSET,
  };
  const centre = toLocal(side, centreWorld);
  const normalLocal = dirToLocal(side, n);
  const ik = inverseKinematics(centre, normalLocal);
  const vLocal = dirToLocal(side, bladeVelocity(n, stroke.bladeSpeed, stroke.brush ?? 0));
  return {
    q: ik.q,
    qd: jointVelocityForTranslation(vLocal),
    violation: ik.violation,
    clearance: tableClearance(centre, side),
    centreWorld,
  };
}

export const clampToAxes = (q) => q.map((v, i) => clamp(v, GANTRY.axes[i].min, GANTRY.axes[i].max));
