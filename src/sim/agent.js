// One autonomous robot player: stereo perception → EKF → planner → gantry.
//
// Control states
//   READY     holding the ready pose, waiting for an incoming ball
//   TRACKING  ball incoming, no feasible interception yet
//   STRIKE    executing a planned stroke (replanned at 100 Hz until 20 ms
//             before impact, then frozen)
//   FOLLOW    follow-through after impact
//   RECOVER   returning to the ready pose
//   SERVE     striking our own service toss

import { BallEKF } from "./estimator.js";
import { PinholeCamera, StereoRig } from "./perception.js";
import { chooseInterception, predictBall, solveStroke, strokeToJoints } from "./planner.js";
import { GANTRY, GantryRobot, Quintic, READY_POSE, SERVE_READY_POSE, toWorld } from "./robot.js";
import { clamp } from "./math.js";

const REPLAN_PERIOD = 0.01;
const FREEZE_BEFORE_HIT = 0.02;
const SWING_TIME = 0.17;
const FOLLOW_TIME = 0.17;
const RECOVER_TIME = 0.5;

export const CAMERA_MOUNT = Object.freeze({
  // stereo pair on a mast behind the portal (robot frame)
  x: 0.46,
  y: 2.52,
  halfBaseline: 0.4,
  target: { x: -2.9, y: 0.8, z: 0 },
});

// A rest-to-(q, v) quintic covering Δ = v·T/2 peaks at |a| = 1.5|v|/T. When
// the natural backswing (or follow-through) would leave the axis range, the
// segment is shortened to fit the remaining travel instead of overshooting
// the hard stop; `feasible` reports whether the drive can still deliver it.
export function swingProfile(axisIndex, qHit, qd) {
  const axis = GANTRY.axes[axisIndex];
  const v = Math.abs(qd);
  const fit = (target, nominal) => {
    const clamped = clamp(target, axis.min, axis.max);
    const travel = Math.abs(clamped - qHit);
    const duration = v < 0.05 ? nominal : clamp((2 * travel) / v, 0.02, nominal);
    return { q: clamped, duration };
  };
  const pre = fit(qHit - qd * SWING_TIME * 0.5, SWING_TIME);
  const follow = fit(qHit + qd * FOLLOW_TIME * 0.5, FOLLOW_TIME);
  const peak = (duration) => (v < 0.05 ? 0 : (1.5 * v) / duration);
  return {
    qPre: pre.q,
    duration: pre.duration,
    qFollow: follow.q,
    followTime: follow.duration,
    feasible: peak(pre.duration) <= axis.amax * 1.1 && peak(follow.duration) <= axis.amax * 1.6,
  };
}

export class RobotAgent {
  constructor({ side, name, rng, skill = {} }) {
    this.side = side;
    this.name = name;
    this.rng = rng;
    this.skill = {
      netMargin: 0.045,
      aggression: 0.5,
      topspin: 0.6,
      ...skill,
    };
    this.robot = new GantryRobot(side);
    this.rig = new StereoRig({
      left: this.makeCamera(-1),
      right: this.makeCamera(1),
      rng,
    });
    this.ekf = new BallEKF();
    this.mode = "READY";
    this.plan = null;
    this.intent = null;
    this.lastPlanAt = -1;
    this.followUntil = 0;
    this.recoverUntil = 0;
    this.lastContactAt = -1;
    this.prevSignedDistance = null;
    this.stats = { strokes: 0, contacts: 0, planFailures: 0, predictionErrors: [], timing: [] };
    // wrist imperfections (rad): a static calibration bias (≈0.3°) plus gear
    // backlash that settles differently on every stroke (≈0.25° rms)
    this.calibration = { yaw: rng.gaussian(0.005), pitch: rng.gaussian(0.005) };
    this.backlash = { yaw: 0, pitch: 0 };
    this.lastMeasurement = null;
  }

  makeCamera(sign) {
    const m = CAMERA_MOUNT;
    return new PinholeCamera({
      position: toWorld(this.side, { x: m.x, y: m.y, z: sign * m.halfBaseline }),
      target: toWorld(this.side, m.target),
      width: 1920,
      height: 1200,
      hfov: 72,
    });
  }

  // the feeder is our own device: restart estimation the moment it fires
  onToss() {
    this.ekf.reset();
  }

  resetForRally(t) {
    this.servePrepared = false;
    this.ekf.reset();
    this.plan = null;
    this.intent = null;
    this.prevSignedDistance = null;
    if (this.mode !== "RECOVER" && this.mode !== "READY") this.recover(t);
  }

  // ---- per physics step -------------------------------------------------------

  step(t, dt, ballPos, context) {
    this.now = t;
    if (context.phase === "pre-serve" && context.server === this.side && !this.servePrepared) {
      this.servePrepared = true;
      this.moveTo(t, SERVE_READY_POSE, "READY");
    }
    let updated = false;
    for (const m of this.rig.update(t, ballPos)) {
      this.ekf.update(m);
      this.lastMeasurement = m;
      updated = true;
    }
    if (updated && t - this.lastPlanAt >= REPLAN_PERIOD - 1e-9) {
      this.lastPlanAt = t;
      this.think(t, context);
    }
    if (this.plan && (this.mode === "STRIKE" || this.mode === "SERVE") && t > this.plan.tHit + 0.03) {
      this.mode = "FOLLOW";
    }
    if (this.mode === "FOLLOW" && t > this.followUntil) this.mode = "RECOVER";
    if (this.mode === "RECOVER" && t > this.recoverUntil) this.mode = "READY";
    this.robot.step(t, dt);
  }

  // ---- decision making ------------------------------------------------------------

  think(t, context) {
    const ekf = this.ekf;
    if (!ekf.initialized || !context.live) return;
    if (this.plan && t > this.plan.tHit - FREEZE_BEFORE_HIT && t < this.plan.tHit + 0.05) return;

    const x = ekf.x;
    const serving = context.phase === "toss" && context.server === this.side;
    const incoming = this.side * x[3] > 0.4 && this.side * x[0] < GANTRY.baseDistance - 0.5;
    if (!serving && !incoming) {
      if (this.mode === "TRACKING") this.mode = "READY";
      if (this.plan && t > this.plan.tHit) {
        this.plan = null;
        this.intent = null;
      }
      return;
    }
    if (this.plan && t > this.plan.tHit) return; // already struck this ball

    const path = predictBall(ekf.x, serving ? 0.8 : 1.3);
    const query = {
      side: this.side,
      t0: ekf.t,
      now: t,
      currentQ: this.robot.q,
      previousHit: this.plan?.tHit ?? null,
      mode: serving ? "serve" : "rally",
      bounced: ekf.lastBounce?.side === this.side,
    };
    let options = chooseInterception(path, query);
    // nothing comfortably reachable: an overloaded stroke beats a stale plan
    if (!options.length) options = chooseInterception(path, { ...query, relaxed: true });
    if (!options.length) {
      this.note("no-intercept");
      if (!this.plan) this.mode = "TRACKING";
      return;
    }

    let hit = null;
    let stroke = null;
    let joints = null;
    for (const option of options) {
      const candidate = this.solveWithIntent(option.state, serving, context);
      if (!candidate) {
        this.note("no-stroke");
        continue;
      }
      const j = strokeToJoints(this.side, option.state, candidate);
      if (j.violation > 0.002 || j.clearance < 0.01) {
        this.note(j.violation > 0.002 ? "joint-limit" : "table-clearance");
        continue;
      }
      if (![0, 1, 2].every((k) => swingProfile(k, j.q[k], j.qd[k]).feasible)) {
        this.note("swing-room");
        continue;
      }
      hit = option;
      stroke = candidate;
      joints = j;
      break;
    }
    if (!hit) {
      this.stats.planFailures += 1;
      if (!this.plan) this.mode = "TRACKING";
      return;
    }

    const isNew = !this.plan;
    this.plan = {
      tHit: hit.tHit,
      ballAtHit: hit.state,
      stroke,
      joints,
      path,
      pathStart: ekf.t,
      serve: serving,
      planned: t,
      effort: hit.effort,
    };
    if (isNew) {
      this.stats.strokes += 1;
      this.backlash = { yaw: this.rng.gaussian(0.0045), pitch: this.rng.gaussian(0.0045) };
    }
    this.mode = serving ? "SERVE" : "STRIKE";
    this.buildReference(t, joints, hit.tHit);
  }

  // Strategy: pick a target once per incoming ball and keep it while replanning.
  solveWithIntent(state, serving, context) {
    const spec = (intent) => ({
      side: this.side,
      target: intent.target,
      flightTime: intent.flightTime,
      brush: intent.brush,
      firstBounceX: intent.firstBounceX,
      serve: serving,
      netMargin: intent.netMargin,
    });
    if (this.intent) {
      const stroke = solveStroke(state, spec(this.intent));
      if (stroke) return stroke;
    }
    const candidates = serving ? this.serveIntents() : this.rallyIntents(context);
    for (const intent of candidates) {
      const stroke = solveStroke(state, spec(intent));
      if (stroke) {
        this.intent = intent;
        return stroke;
      }
    }
    return null;
  }

  rallyIntents(context) {
    const rng = this.rng;
    const s = this.side;
    const { aggression, topspin, netMargin } = this.skill;
    const intents = [];
    // aim away from where the opponent's blade currently is
    const opponentZ = context.opponentPaddleZ ?? 0;
    for (let i = 0; i < 6; i += 1) {
      // aggression pushes targets towards the lines, flattens and speeds up
      // the ball and trims the net margin — winners and errors both follow
      const deep = rng.uniform(0.55 + 0.3 * aggression, Math.min(1.33, 0.85 + 0.48 * aggression));
      const wide = clamp(-Math.sign(opponentZ || rng.uniform(-1, 1)) * rng.uniform(0.1 + 0.3 * aggression, 0.4 + 0.33 * aggression), -0.73, 0.73);
      const loop = rng.next() < topspin;
      intents.push({
        target: { x: -s * deep, z: wide },
        flightTime: loop ? rng.uniform(0.5 - 0.06 * aggression, 0.66) : rng.uniform(0.42 - 0.12 * aggression, 0.55 - 0.1 * aggression),
        brush: loop ? rng.uniform(2.2, 3.8) : rng.uniform(0.3, 1.2),
        netMargin: Math.max(0.012, netMargin * (1.25 - 0.6 * aggression)),
        kind: loop ? "TOPSPIN" : "DRIVE",
      });
    }
    // conservative fallbacks: centre of the table, slow and high
    intents.push({ target: { x: -s * 0.75, z: 0 }, flightTime: 0.62, brush: 1.2, netMargin: 0.03, kind: "BLOCK" });
    intents.push({ target: { x: -s * 0.7, z: 0 }, flightTime: 0.72, brush: 0, netMargin: 0.02, kind: "LOB" });
    return intents;
  }

  serveIntents() {
    const rng = this.rng;
    const s = this.side;
    const intents = [];
    for (let i = 0; i < 6; i += 1) {
      intents.push({
        firstBounceX: s * rng.uniform(0.8, 1.15),
        target: { x: -s * rng.uniform(0.55, 1.15), z: rng.uniform(-0.5, 0.5) },
        brush: rng.uniform(0, 1.8),
        netMargin: 0.025,
        kind: "SERVE",
      });
    }
    return intents;
  }

  // ---- reference trajectories -------------------------------------------------------

  buildReference(t, joints, tHit) {
    const wristError = [0, 0, 0, this.calibration.yaw + this.backlash.yaw, this.calibration.pitch + this.backlash.pitch];
    const qHit = joints.q.map((v, i) => v + wristError[i]);
    const qdHit = joints.qd;
    const tFollowEnd = tHit + FOLLOW_TIME;
    this.followUntil = tFollowEnd;
    this.recoverUntil = tFollowEnd + RECOVER_TIME;

    this.robot.reference.forEach((ref, i) => {
      const current = ref.evaluate(t);
      const segments = [];
      if (i < 3) {
        const swing = swingProfile(i, qHit[i], qdHit[i]);
        const tPre = tHit - swing.duration;
        if (tPre - t > 0.05) {
          segments.push(new Quintic(t, tPre - t, current, [swing.qPre, 0, 0]));
          segments.push(new Quintic(tPre, swing.duration, [swing.qPre, 0, 0], [qHit[i], qdHit[i], 0]));
        } else {
          segments.push(new Quintic(t, tHit - t, current, [qHit[i], qdHit[i], 0]));
        }
        segments.push(new Quintic(tHit, swing.followTime, [qHit[i], qdHit[i], 0], [swing.qFollow, 0, 0]));
        segments.push(new Quintic(tHit + swing.followTime, tFollowEnd + RECOVER_TIME - tHit - swing.followTime, [swing.qFollow, 0, 0], [READY_POSE[i], 0, 0]));
      } else {
        const tArrive = Math.max(t + 0.04, tHit - 0.05);
        segments.push(new Quintic(t, tArrive - t, current, [qHit[i], 0, 0]));
        segments.push(new Quintic(tArrive, tFollowEnd - tArrive, [qHit[i], 0, 0], [qHit[i], 0, 0]));
        segments.push(new Quintic(tFollowEnd, RECOVER_TIME, [qHit[i], 0, 0], [READY_POSE[i], 0, 0]));
      }
      ref.replace(segments);
    });
  }

  recover(t) {
    this.moveTo(t, READY_POSE, "RECOVER");
  }

  moveTo(t, pose, mode) {
    this.robot.reference.forEach((ref, i) => {
      const current = ref.evaluate(t);
      ref.replace([new Quintic(t, RECOVER_TIME, current, [pose[i], 0, 0])]);
    });
    this.recoverUntil = t + RECOVER_TIME;
    this.mode = mode;
  }

  note(reason) {
    this.lastFailure = reason;
    this.stats.failures = this.stats.failures || {};
    this.stats.failures[reason] = (this.stats.failures[reason] || 0) + 1;
  }

  // ---- bookkeeping --------------------------------------------------------------------

  onContact(t, ballState) {
    this.lastContactAt = t;
    this.stats.contacts += 1;
    if (this.plan) {
      const p = this.plan.ballAtHit;
      const err = Math.hypot(p[0] - ballState[0], p[1] - ballState[1], p[2] - ballState[2]);
      this.stats.predictionErrors.push(err);
      this.stats.timing.push(t - this.plan.tHit);
      this.plan.contact = { t, error: err };
    }
  }

  telemetry() {
    const ekf = this.ekf;
    return {
      mode: this.mode,
      q: [...this.robot.q],
      qd: [...this.robot.qd],
      saturation: [...this.robot.saturation],
      trackingError: [...this.robot.trackingError],
      timeToHit: this.plan ? this.plan.tHit - this.now : null,
      bladeSpeed: this.plan?.stroke.bladeSpeed ?? 0,
      shot: this.intent?.kind ?? "—",
      ekfReady: ekf.initialized,
      spinEstimate: ekf.initialized ? { x: ekf.x[6], y: ekf.x[7], z: ekf.x[8] } : null,
      nis: ekf.lastNis,
      frames: this.rig.frames,
      detections: this.rig.detections,
    };
  }
}
