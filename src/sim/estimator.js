// Extended Kalman filter for ball state x = [p, v, ω] (9 states).
//
// Process model: the same aerodynamic + table-bounce model as the simulator
// (with nominal parameters — the true ball differs slightly), discretised by
// RK4. The Jacobian F = ∂f/∂x is obtained by central finite differences, which
// keeps it exact across table bounces where an analytic form is awkward.
//
// Spin is never measured directly; it becomes observable through the Magnus
// curvature of the trajectory and through the bounce kick, which is why a
// 200 Hz camera and a well-tuned process noise matter.
//
// Paddle impacts are not in the process model. They are detected with a χ²
// gate on the normalised innovation; two consecutive outliers re-initialise the
// filter from the newest measurements.

import { NOMINAL_MODEL, stepBall } from "./ballPhysics.js";
import { inverse3, matIdentity, matMul, matSymmetrize, matTranspose } from "./math.js";

const N = 9;
const GATE = 24; // χ²(3) at p ≈ 0.99997

export class BallEKF {
  constructor({ model = NOMINAL_MODEL, accelNoise = 0.4, spinNoise = 60, substep = 0.001 } = {}) {
    this.model = model;
    this.accelNoise = accelNoise; // m²/s³ spectral density of unmodelled acceleration
    this.spinNoise = spinNoise; // rad²/s³
    this.substep = substep;
    this.reset();
  }

  reset() {
    this.x = new Float64Array(N);
    this.P = matIdentity(N, 1);
    this.t = 0;
    this.initialized = false;
    this.pending = [];
    this.outliers = 0;
    this.lastNis = 0;
    this.updates = 0;
    this.resets = 0;
    this.lastBounce = null;
  }

  // propagate a copy of the state by dt (with bounces) — process function f(x)
  propagate(x, dt) {
    const s = Float64Array.from(x);
    let remaining = dt;
    const events = [];
    while (remaining > 1e-9) {
      const h = Math.min(this.substep, remaining);
      events.push(...stepBall(s, h, this.model));
      remaining -= h;
    }
    return { s, events };
  }

  predict(t) {
    const dt = t - this.t;
    if (!this.initialized || dt <= 0) {
      this.t = Math.max(this.t, t);
      return;
    }
    const { s, events } = this.propagate(this.x, dt);
    const F = this.jacobian(this.x, dt);
    const Ft = matTranspose(F, N);
    const P = matMul(matMul(F, this.P, N), Ft, N);
    this.addProcessNoise(P, dt);
    const bounce = events.find((e) => e.type === "table");
    if (bounce) this.lastBounce = { t, side: bounce.side, x: bounce.x, z: bounce.z };
    if (events.length) {
      // the impact model is the least certain part of the dynamics
      for (let i = 3; i < 6; i += 1) P[i * N + i] += 0.15 ** 2;
      for (let i = 6; i < 9; i += 1) P[i * N + i] += 40 ** 2;
    }
    this.x = s;
    this.P = matSymmetrize(P, N);
    this.t = t;
  }

  jacobian(x, dt) {
    const F = new Float64Array(N * N);
    const steps = [0.002, 0.002, 0.002, 0.01, 0.01, 0.01, 2, 2, 2];
    for (let j = 0; j < N; j += 1) {
      const xp = Float64Array.from(x);
      const xm = Float64Array.from(x);
      xp[j] += steps[j];
      xm[j] -= steps[j];
      const fp = this.propagate(xp, dt);
      const fm = this.propagate(xm, dt);
      // a bounce that happens for only one of the perturbed states makes the
      // central difference meaningless — fall back to the one-sided version
      const fpBounce = fp.events.length > 0;
      const fmBounce = fm.events.length > 0;
      let a = fp.s;
      let b = fm.s;
      let h = 2 * steps[j];
      if (fpBounce !== fmBounce) {
        const f0 = this.propagate(x, dt);
        const f0Bounce = f0.events.length > 0;
        if (f0Bounce === fpBounce) {
          b = f0.s;
        } else {
          a = f0.s;
        }
        h = steps[j];
      }
      for (let i = 0; i < N; i += 1) F[i * N + j] = (a[i] - b[i]) / h;
    }
    return F;
  }

  addProcessNoise(P, dt) {
    const q = this.accelNoise;
    const dt2 = dt * dt;
    const dt3 = dt2 * dt;
    for (let axis = 0; axis < 3; axis += 1) {
      const p = axis;
      const v = axis + 3;
      const w = axis + 6;
      P[p * N + p] += (q * dt3) / 3;
      P[p * N + v] += (q * dt2) / 2;
      P[v * N + p] += (q * dt2) / 2;
      P[v * N + v] += q * dt;
      P[w * N + w] += this.spinNoise * dt;
    }
  }

  // velocityCov / crossCov (3×3) describe a finite-difference velocity estimate
  initialize(measurement, velocity = null, velocityCov = null, crossCov = null) {
    this.x = new Float64Array(N);
    this.x[0] = measurement.position.x;
    this.x[1] = measurement.position.y;
    this.x[2] = measurement.position.z;
    this.P = matIdentity(N, 0);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) this.P[i * N + j] = measurement.covariance[i * 3 + j];
    }
    if (velocity) {
      this.x[3] = velocity.x;
      this.x[4] = velocity.y;
      this.x[5] = velocity.z;
      for (let i = 0; i < 3; i += 1) {
        for (let j = 0; j < 3; j += 1) {
          this.P[(i + 3) * N + (j + 3)] = velocityCov ? velocityCov[i * 3 + j] : i === j ? 0.6 ** 2 : 0;
          if (crossCov) {
            this.P[i * N + (j + 3)] = crossCov[i * 3 + j];
            this.P[(j + 3) * N + i] = crossCov[i * 3 + j];
          }
        }
      }
    } else {
      for (let i = 3; i < 6; i += 1) this.P[i * N + i] = 6 ** 2;
    }
    for (let i = 6; i < 9; i += 1) this.P[i * N + i] = 160 ** 2;
    this.t = measurement.stamp;
    this.initialized = true;
    this.outliers = 0;
    this.lastBounce = null;
  }

  /**
   * Processes one stereo measurement {stamp, position, covariance}.
   * Returns "init" | "update" | "outlier" | "reset".
   */
  update(measurement) {
    if (!this.initialized) {
      this.initialize(measurement);
      this.history = [measurement];
      return "init";
    }
    this.history = [...(this.history || []).slice(-3), measurement];
    this.predict(measurement.stamp);

    const z = measurement.position;
    const y = [z.x - this.x[0], z.y - this.x[1], z.z - this.x[2]];
    const S = new Float64Array(9);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) S[i * 3 + j] = this.P[i * N + j] + measurement.covariance[i * 3 + j];
    }
    const Si = inverse3(S);
    if (!Si) return "outlier";
    let nis = 0;
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) nis += y[i] * Si[i * 3 + j] * y[j];
    }
    this.lastNis = nis;

    if (nis > GATE) {
      this.outliers += 1;
      if (this.outliers >= 2) {
        // trajectory changed abruptly (paddle impact): restart from the two
        // most recent measurements, both taken after the discontinuity
        const [a, b] = this.history.slice(-2);
        const dt = Math.max(b.stamp - a.stamp, 1e-3);
        // the difference quotient is the mid-interval velocity; under gravity
        // the velocity at the newer frame is lower by g·dt/2
        const vel = {
          x: (b.position.x - a.position.x) / dt,
          y: (b.position.y - a.position.y) / dt - 0.5 * this.model.gravity * dt,
          z: (b.position.z - a.position.z) / dt,
        };
        // Cov(v) = (R_a + R_b)/dt², Cov(p_b, v) = R_b/dt
        const velocityCov = new Float64Array(9);
        const crossCov = new Float64Array(9);
        for (let i = 0; i < 9; i += 1) {
          velocityCov[i] = (a.covariance[i] + b.covariance[i]) / (dt * dt) + (i % 4 === 0 ? 0.05 ** 2 : 0);
          crossCov[i] = b.covariance[i] / dt;
        }
        this.initialize(b, vel, velocityCov, crossCov);
        this.resets += 1;
        return "reset";
      }
      return "outlier";
    }
    this.outliers = 0;

    // K = P Hᵀ S⁻¹  (9×3)
    const K = new Float64Array(N * 3);
    for (let i = 0; i < N; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        let sum = 0;
        for (let k = 0; k < 3; k += 1) sum += this.P[i * N + k] * Si[k * 3 + j];
        K[i * 3 + j] = sum;
      }
    }
    for (let i = 0; i < N; i += 1) {
      this.x[i] += K[i * 3] * y[0] + K[i * 3 + 1] * y[1] + K[i * 3 + 2] * y[2];
    }
    // Joseph form: P = (I − KH) P (I − KH)ᵀ + K R Kᵀ
    const IKH = matIdentity(N);
    for (let i = 0; i < N; i += 1) {
      for (let j = 0; j < 3; j += 1) IKH[i * N + j] -= K[i * 3 + j];
    }
    let P = matMul(matMul(IKH, this.P, N), matTranspose(IKH, N), N);
    const KR = matMul(K, measurement.covariance, N, 3, 3);
    const KRKt = matMul(KR, matTranspose(K, N, 3), N, 3, N);
    for (let i = 0; i < N * N; i += 1) P[i] += KRKt[i];
    this.P = matSymmetrize(P, N);
    this.updates += 1;
    return "update";
  }

  // Predicted state (mean only) at a future time.
  stateAt(t) {
    if (!this.initialized) return null;
    if (t <= this.t) return Float64Array.from(this.x);
    return this.propagate(this.x, t - this.t).s;
  }

  positionCovariance() {
    const C = new Float64Array(9);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) C[i * 3 + j] = this.P[i * N + j];
    }
    return C;
  }

  spinSigma() {
    return Math.sqrt((this.P[6 * N + 6] + this.P[7 * N + 7] + this.P[8 * N + 8]) / 3);
  }
}

// Propagates mean and covariance forward to time t (used to visualise the
// uncertainty of the predicted interception point).
export function propagateCovariance(ekf, horizon, step = 0.02) {
  let x = Float64Array.from(ekf.x);
  let P = Float64Array.from(ekf.P);
  let t = 0;
  while (t < horizon - 1e-9) {
    const h = Math.min(step, horizon - t);
    const F = ekf.jacobian(x, h);
    P = matMul(matMul(F, P, N), matTranspose(F, N), N);
    ekf.addProcessNoise(P, h);
    x = ekf.propagate(x, h).s;
    t += h;
  }
  const C = new Float64Array(9);
  for (let i = 0; i < 3; i += 1) {
    for (let j = 0; j < 3; j += 1) C[i * 3 + j] = P[i * N + j];
  }
  return { x, positionCovariance: C };
}
