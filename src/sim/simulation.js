// The world: true ball dynamics at 1 kHz, two robot agents, paddle contacts
// and the referee. Rendering-independent so it can run headless in tests.

import { applyImpact, createBallModel, paddleRestitution, stepBall } from "./ballPhysics.js";
import { BALL, PADDLE, SIM, TABLE } from "./constants.js";
import { RobotAgent } from "./agent.js";
import { createRng } from "./math.js";
import { Referee } from "./referee.js";
import { SERVE_FEEDER, toWorld } from "./robot.js";

const PRE_SERVE_DELAY = 0.9;
const DEAD_BALL_TIME = 1.3;
const TOSS_SPEED = 2.55;

export function feederPosition(side) {
  return toWorld(side, { x: SERVE_FEEDER.x, y: TABLE.height, z: SERVE_FEEDER.z });
}

export class Simulation {
  constructor({ seed = 7, skills = {} } = {}) {
    this.rng = createRng(seed);
    this.time = 0;
    this.stepCount = 0;
    this.ball = new Float64Array(9);
    this.ballModel = createBallModel();
    this.referee = new Referee();
    this.agents = [
      // two playing styles: a spinny all-rounder and a flatter, more aggressive hitter
      new RobotAgent({ side: -1, name: "LEFT", rng: createRng(seed * 31 + 1), skill: { aggression: 1.0, topspin: 0.75, ...skills.left } }),
      new RobotAgent({ side: 1, name: "RIGHT", rng: createRng(seed * 31 + 2), skill: { aggression: 1.2, topspin: 0.4, ...skills.right } }),
    ];
    this.listeners = [];
    this.eventLog = [];
    this.rallyStats = [];
    this.bounceMarks = [];
    this.referee.on((event) => this.onRefereeEvent(event));
    this.prepareServe();
  }

  on(listener) {
    this.listeners.push(listener);
  }

  emit(event) {
    const stamped = { t: this.time, ...event };
    this.eventLog.push(stamped);
    if (this.eventLog.length > 200) this.eventLog.shift();
    this.listeners.forEach((fn) => fn(stamped));
  }

  agent(side) {
    return side < 0 ? this.agents[0] : this.agents[1];
  }

  // ---- rally lifecycle -------------------------------------------------------------

  prepareServe() {
    const server = this.referee.server;
    const p = feederPosition(server);
    this.ball.set([p.x, p.y + BALL.radius, p.z, 0, 0, 0, 0, 0, 0]);
    this.ballHeld = true;
    this.tossAt = this.time + PRE_SERVE_DELAY;
    this.deadUntil = null;
    // every ball is slightly different: manufacturing and wear
    this.ballModel = createBallModel({
      dragCoefficient: 0.45 * (1 + this.rng.gaussian(0.025)),
      liftScale: 1 + this.rng.gaussian(0.05),
    });
    this.agents.forEach((a) => a.resetForRally(this.time));
    this.emit({ type: "ready", server });
  }

  toss() {
    this.ballHeld = false;
    this.ball[3] = this.rng.gaussian(0.03);
    this.ball[4] = TOSS_SPEED + this.rng.gaussian(0.05);
    this.ball[5] = this.rng.gaussian(0.03);
    this.referee.toss();
    this.agents.forEach((a) => a.onToss());
    this.emit({ type: "toss", side: this.referee.server });
  }

  onRefereeEvent(event) {
    if (event.type === "point" || event.type === "let") {
      this.deadUntil = this.time + DEAD_BALL_TIME;
      if (event.type === "point") this.rallyStats.push(event);
    }
    this.emit({ ...event, refereeEvent: true });
  }

  // ---- main loop -----------------------------------------------------------------------

  advance(seconds) {
    const steps = Math.round(seconds / SIM.dt);
    for (let i = 0; i < steps; i += 1) this.step();
  }

  step() {
    const dt = SIM.dt;
    // integer step counter: repeated float addition would drift against the
    // camera frame clock and stamp frames with the wrong ball position
    this.stepCount += 1;
    this.time = this.stepCount * dt;
    const t = this.time;
    const ref = this.referee;

    if (this.ballHeld) {
      if (t >= this.tossAt) this.toss();
    } else {
      const events = stepBall(this.ball, dt, this.ballModel, { floor: true });
      for (const e of events) this.handleBallEvent(e);
      this.checkOut();
    }

    const ballPos = { x: this.ball[0], y: this.ball[1], z: this.ball[2] };
    const context = {
      live: ref.live,
      phase: ref.phase,
      server: ref.server,
    };
    for (const agent of this.agents) {
      const opponent = this.agent(-agent.side);
      context.opponentPaddleZ = opponent.robot.paddle.worldCentre.z;
      agent.step(t, dt, ballPos, context);
    }
    if (!this.ballHeld) {
      for (const agent of this.agents) this.checkPaddleContact(agent, t);
    }

    if (this.deadUntil !== null && t >= this.deadUntil) {
      if (ref.matchWinner) {
        this.emit({ type: "match-reset", winner: ref.matchWinner });
        ref.resetMatch();
      } else {
        ref.newRally();
      }
      this.prepareServe();
    }
  }

  handleBallEvent(e) {
    const ref = this.referee;
    if (e.type === "table") {
      const live = ref.live;
      ref.table(e.side);
      if (live) {
        this.bounceMarks.push({ x: e.x, z: e.z, t: this.time, side: e.side });
        if (this.bounceMarks.length > 60) this.bounceMarks.shift();
      }
    } else if (e.type === "net") {
      ref.net();
    } else if (e.type === "side") {
      ref.out("SIDE");
    } else if (e.type === "floor") {
      ref.out("OUT");
    }
    this.emit({ ...e, ballEvent: true });
  }

  checkOut() {
    const s = this.ball;
    const ref = this.referee;
    if (!ref.live) return;
    if (s[1] < TABLE.height - 0.05 && (Math.abs(s[0]) > TABLE.halfLength || Math.abs(s[2]) > TABLE.halfWidth)) {
      // below the playing surface outside the table: can no longer be played
      if (s[1] < 0.4) ref.out("OUT");
    }
    if (Math.abs(s[0]) > 4.5 || Math.abs(s[2]) > 3.2) ref.out("OUT");
  }

  checkPaddleContact(agent, t) {
    const pad = agent.robot.paddle;
    const s = this.ball;
    const rx = s[0] - pad.worldCentre.x;
    const ry = s[1] - pad.worldCentre.y;
    const rz = s[2] - pad.worldCentre.z;
    const n = pad.worldNormal;
    const d = rx * n.x + ry * n.y + rz * n.z;
    const a1 = rx * pad.worldUp.x + ry * pad.worldUp.y + rz * pad.worldUp.z;
    const a2 = rx * pad.worldWidth.x + ry * pad.worldWidth.y + rz * pad.worldWidth.z;
    const prev = agent.prevSignedDistance;
    agent.prevSignedDistance = d;
    // allow the ball to touch the rim: grow the ellipse by a fraction of the radius
    const inside = (a1 / (PADDLE.halfHeight + 0.006)) ** 2 + (a2 / (PADDLE.halfWidth + 0.006)) ** 2 <= 1;
    if (!inside || t - agent.lastContactAt < 0.06) return;
    const reach = BALL.radius + PADDLE.halfThickness;
    const crossed = prev !== null && Math.sign(prev) !== Math.sign(d) && Math.abs(prev) < 0.12;
    if (Math.abs(d) >= reach && !crossed) return;

    const faceSign = crossed ? Math.sign(prev) || 1 : Math.sign(d) || 1;
    const normal = { x: n.x * faceSign, y: n.y * faceSign, z: n.z * faceSign };
    // Off-centre impacts excite blade vibration and lose energy (the "sweet
    // spot"); rubber grip and rebound also vary from stroke to stroke with
    // sheet temperature and wear. The planner only knows the nominal values.
    const offCentre = (a1 / PADDLE.halfHeight) ** 2 + (a2 / PADDLE.halfWidth) ** 2;
    const sweetSpot = 1 - 0.3 * Math.min(1, offCentre);
    const rubberE = 1 + this.rng.gaussian(0.03);
    const rubberMu = PADDLE.friction * (1 + this.rng.gaussian(0.08));
    const impact = applyImpact(
      s,
      normal,
      (vn) => paddleRestitution(vn, PADDLE.restitution) * sweetSpot * rubberE,
      rubberMu,
      pad.velocity,
    );
    if (!impact) return;
    const push = reach - faceSign * d;
    s[0] += normal.x * push;
    s[1] += normal.y * push;
    s[2] += normal.z * push;
    agent.prevSignedDistance = faceSign * reach;
    agent.onContact(t, s);
    this.referee.paddle(agent.side, s[0]);
    this.emit({
      type: "paddle",
      side: agent.side,
      x: s[0],
      y: s[1],
      z: s[2],
      speed: Math.hypot(s[3], s[4], s[5]),
      spin: Math.hypot(s[6], s[7], s[8]),
      face: faceSign > 0 ? "forehand" : "backhand",
    });
  }

  // ---- read-out -----------------------------------------------------------------------

  ballSnapshot() {
    const s = this.ball;
    return {
      position: { x: s[0], y: s[1], z: s[2] },
      velocity: { x: s[3], y: s[4], z: s[5] },
      spin: { x: s[6], y: s[7], z: s[8] },
      speed: Math.hypot(s[3], s[4], s[5]),
      rpm: (Math.hypot(s[6], s[7], s[8]) * 60) / (2 * Math.PI),
    };
  }
}
