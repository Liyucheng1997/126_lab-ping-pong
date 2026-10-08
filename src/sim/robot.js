// 5-DOF Cartesian gantry robot: three linear axes (lateral belt drive,
// vertical ball screw, stroke linear motor) and a two-axis wrist (yaw, pitch).
//
// Robot frame: origin on the floor below the portal, local −x points at the
// net, local z is the lateral axis. World ↔ local is a pure reflection for the
// left robot so both robots share the same kinematics:
//     world = (s·(x_l + B), y_l, s·z_l)
//
// Joint vector q = [lateral, vertical, stroke, yaw, pitch].
// Each axis is a servo with position/velocity PD + acceleration feedforward,
// saturated at the drive's velocity and acceleration limits, so commanded
// trajectories that are too aggressive are tracked with real lag.

import { PADDLE, TABLE } from "./constants.js";
import { clamp } from "./math.js";

export const GANTRY = Object.freeze({
  baseDistance: 2.36, // portal centre distance from the net plane
  portalHalfWidth: 1.18,
  portalHeight: 2.08,
  armLength: 0.7, // stroke slider → wrist pivot
  wristDrop: 0.035,
  handleOffset: 0.118, // wrist pivot → blade centre
  axes: [
    { name: "lateral", min: -0.86, max: 0.86, vmax: 4.8, amax: 48, unit: "m" },
    { name: "vertical", min: 0.64, max: 1.62, vmax: 4.5, amax: 60, unit: "m" },
    { name: "stroke", min: -0.52, max: 0.12, vmax: 7.5, amax: 95, unit: "m" },
    { name: "yaw", min: -0.95, max: 0.95, vmax: 24, amax: 650, unit: "rad" },
    { name: "pitch", min: -0.75, max: 1.0, vmax: 24, amax: 650, unit: "rad" },
  ],
  bandwidthHz: 18,
  damping: 0.92,
});

export const READY_POSE = [0, 1.06, -0.12, 0, 0.12];

// Service feeder (robot frame): a tube flush with the table surface that pops
// the ball straight up; the robot waits behind it before the toss.
export const SERVE_FEEDER = Object.freeze({ x: -0.76, z: 0.3 });

// ---- frames -----------------------------------------------------------------

export const toWorld = (side, p) => ({ x: side * (p.x + GANTRY.baseDistance), y: p.y, z: side * p.z });
export const toLocal = (side, p) => ({ x: side * p.x - GANTRY.baseDistance, y: p.y, z: side * p.z });
export const dirToWorld = (side, d) => ({ x: side * d.x, y: d.y, z: side * d.z });
export const dirToLocal = dirToWorld;

// ---- kinematics ---------------------------------------------------------------

// Paddle axes in the robot frame for wrist angles (yaw ψ about y, pitch θ about z).
export function paddleAxes(yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  // R = Ry(ψ)·Rz(θ) applied to n0=(−1,0,0), h0=(0,1,0), b0=(0,0,1)
  return {
    normal: { x: -cp * cy, y: -sp, z: cp * sy },
    up: { x: -sp * cy, y: cp, z: sp * sy },
    width: { x: sy, y: 0, z: cy },
  };
}

export function wristFromNormal(n) {
  return { yaw: Math.atan2(n.z, -n.x), pitch: Math.asin(clamp(-n.y, -1, 1)) };
}

export function forwardKinematics(q) {
  const [lateral, vertical, stroke, yaw, pitch] = q;
  const pivot = { x: stroke - GANTRY.armLength, y: vertical - GANTRY.wristDrop, z: lateral };
  const axes = paddleAxes(yaw, pitch);
  const centre = {
    x: pivot.x + axes.up.x * GANTRY.handleOffset,
    y: pivot.y + axes.up.y * GANTRY.handleOffset,
    z: pivot.z + axes.up.z * GANTRY.handleOffset,
  };
  return { pivot, centre, ...axes };
}

// Inverse kinematics for a desired blade centre and normal (robot frame).
// `margin` shrinks the linear axis ranges (m) — used when screening targets
// whose final blade orientation is not known yet.
export function inverseKinematics(centre, normal, margin = 0) {
  const { yaw, pitch } = wristFromNormal(normal);
  const { up } = paddleAxes(yaw, pitch);
  const pivot = {
    x: centre.x - up.x * GANTRY.handleOffset,
    y: centre.y - up.y * GANTRY.handleOffset,
    z: centre.z - up.z * GANTRY.handleOffset,
  };
  const q = [pivot.z, pivot.y + GANTRY.wristDrop, pivot.x + GANTRY.armLength, yaw, pitch];
  const violation = GANTRY.axes.reduce((worst, axis, i) => {
    const m = axis.unit === "m" ? margin : 0;
    const over = Math.max(axis.min + m - q[i], q[i] - axis.max + m, 0);
    return Math.max(worst, axis.unit === "m" ? over : over * 0.2);
  }, 0);
  return { q, violation };
}

// Joint velocities for a pure blade translation (wrist at rest).
export function jointVelocityForTranslation(localVelocity) {
  return [localVelocity.z, localVelocity.y, localVelocity.x, 0, 0];
}

// Paddle must not dip into the table when it reaches over the end line.
export function tableClearance(centre, side) {
  const world = toWorld(side, centre);
  if (Math.abs(world.x) > TABLE.halfLength + PADDLE.halfHeight) return Infinity;
  return world.y - PADDLE.halfHeight - TABLE.height;
}

export const SERVE_READY_POSE = (() => {
  const centre = { x: SERVE_FEEDER.x + 0.12, y: TABLE.height + 0.27, z: SERVE_FEEDER.z };
  return inverseKinematics(centre, { x: -0.995, y: 0.1, z: 0 }).q;
})();

// ---- motion primitives ----------------------------------------------------------

// Quintic polynomial matching position/velocity/acceleration at both ends.
export class Quintic {
  constructor(t0, duration, start, end) {
    this.t0 = t0;
    this.T = Math.max(duration, 1e-3);
    const T = this.T;
    const [p0, v0, a0] = start;
    const [p1, v1, a1] = end;
    const T2 = T * T;
    const T3 = T2 * T;
    const T4 = T3 * T;
    const T5 = T4 * T;
    this.c = [
      p0,
      v0,
      a0 / 2,
      (20 * (p1 - p0) - (8 * v1 + 12 * v0) * T - (3 * a0 - a1) * T2) / (2 * T3),
      (30 * (p0 - p1) + (14 * v1 + 16 * v0) * T + (3 * a0 - 2 * a1) * T2) / (2 * T4),
      (12 * (p1 - p0) - (6 * v1 + 6 * v0) * T - (a0 - a1) * T2) / (2 * T5),
    ];
  }

  get t1() {
    return this.t0 + this.T;
  }

  evaluate(t) {
    const tau = clamp(t - this.t0, 0, this.T);
    const [c0, c1, c2, c3, c4, c5] = this.c;
    const p = c0 + tau * (c1 + tau * (c2 + tau * (c3 + tau * (c4 + tau * c5))));
    const v = c1 + tau * (2 * c2 + tau * (3 * c3 + tau * (4 * c4 + tau * 5 * c5)));
    const a = 2 * c2 + tau * (6 * c3 + tau * (12 * c4 + tau * 20 * c5));
    return [p, v, a];
  }

  // peak |velocity| and |acceleration| sampled along the segment
  peaks(samples = 24) {
    let vmax = 0;
    let amax = 0;
    for (let i = 0; i <= samples; i += 1) {
      const [, v, a] = this.evaluate(this.t0 + (this.T * i) / samples);
      vmax = Math.max(vmax, Math.abs(v));
      amax = Math.max(amax, Math.abs(a));
    }
    return { vmax, amax };
  }
}

// Piecewise-quintic reference for a single axis.
export class AxisReference {
  constructor(position) {
    this.segments = [];
    this.hold = position;
  }

  evaluate(t) {
    for (const seg of this.segments) {
      if (t <= seg.t1) return seg.evaluate(t);
    }
    return [this.hold, 0, 0];
  }

  replace(segments) {
    this.segments = segments;
    if (segments.length) this.hold = segments[segments.length - 1].evaluate(Infinity)[0];
  }
}

// ---- drive model ------------------------------------------------------------------

export class GantryRobot {
  constructor(side) {
    this.side = side;
    this.q = [...READY_POSE];
    this.qd = [0, 0, 0, 0, 0];
    this.qdd = [0, 0, 0, 0, 0];
    this.reference = READY_POSE.map((p) => new AxisReference(p));
    this.refState = READY_POSE.map((p) => [p, 0, 0]);
    this.trackingError = [0, 0, 0, 0, 0];
    this.saturation = [0, 0, 0, 0, 0];
    this.updatePaddle(0);
    this.prevCentre = { ...this.paddle.centre };
  }

  referenceAt(t) {
    return this.reference.map((ref) => ref.evaluate(t));
  }

  step(t, dt) {
    const wn = 2 * Math.PI * GANTRY.bandwidthHz;
    const kp = wn * wn;
    const kd = 2 * GANTRY.damping * wn;
    this.refState = this.referenceAt(t);
    GANTRY.axes.forEach((axis, i) => {
      const [r, rd, rdd] = this.refState[i];
      const rc = clamp(r, axis.min, axis.max);
      let a = rdd + kp * (rc - this.q[i]) + kd * (rd - this.qd[i]);
      const sat = Math.abs(a) / axis.amax;
      a = clamp(a, -axis.amax, axis.amax);
      let v = clamp(this.qd[i] + a * dt, -axis.vmax, axis.vmax);
      let p = this.q[i] + v * dt;
      if (p < axis.min || p > axis.max) {
        p = clamp(p, axis.min, axis.max);
        v = 0;
      }
      this.qdd[i] = (v - this.qd[i]) / dt;
      this.qd[i] = v;
      this.q[i] = p;
      this.trackingError[i] = r - p;
      this.saturation[i] = Math.max(sat, Math.abs(v) / axis.vmax);
    });
    this.updatePaddle(dt);
  }

  updatePaddle(dt) {
    const fk = forwardKinematics(this.q);
    const prev = this.paddle?.worldCentre;
    const worldCentre = toWorld(this.side, fk.centre);
    const velocity = prev && dt > 0
      ? { x: (worldCentre.x - prev.x) / dt, y: (worldCentre.y - prev.y) / dt, z: (worldCentre.z - prev.z) / dt }
      : { x: 0, y: 0, z: 0 };
    this.paddle = {
      ...fk,
      worldCentre,
      worldNormal: dirToWorld(this.side, fk.normal),
      worldUp: dirToWorld(this.side, fk.up),
      worldWidth: dirToWorld(this.side, fk.width),
      velocity,
    };
  }
}
