import { describe, expect, it } from "vitest";
import { BALL, NET, TABLE } from "../src/sim/constants.js";
import { invertImpact, paddleImpact, simulateShot, solveLaunch, solveStroke } from "../src/sim/planner.js";
import { forwardKinematics, GANTRY, inverseKinematics, Quintic } from "../src/sim/robot.js";

describe("paddle impact inversion", () => {
  it("recovers blade normal and speed from a desired outgoing velocity", () => {
    const vIn = { x: 5, y: -1.2, z: 0.4 };
    const wIn = { x: 0, y: 20, z: -120 };
    const n = (() => {
      const v = { x: -0.92, y: 0.3, z: 0.1 };
      const l = Math.hypot(v.x, v.y, v.z);
      return { x: v.x / l, y: v.y / l, z: v.z / l };
    })();
    const target = paddleImpact(vIn, wIn, n, 2.4, 1.0).v;
    const solved = invertImpact(1, vIn, wIn, target, 1.0);
    expect(solved.error).toBeLessThan(1e-4);
    expect(solved.bladeSpeed).toBeCloseTo(2.4, 3);
    expect(solved.normal.y).toBeCloseTo(n.y, 3);
  });
});

describe("ballistic targeting", () => {
  it("hits a landing point at a prescribed flight time", () => {
    const p = { x: 1.6, y: 1.0, z: 0.2 };
    const target = { x: -0.9, y: TABLE.height + BALL.radius, z: -0.3 };
    const { v, error } = solveLaunch(p, { x: 0, y: 0, z: 150 }, target, 0.5);
    expect(error).toBeLessThan(1e-3);
    const shot = simulateShot(p, v, { x: 0, y: 0, z: 150 });
    expect(shot.bounces[0].x).toBeCloseTo(target.x, 2);
  });

  it("plans a full stroke that clears the net and lands in", () => {
    const ball = new Float64Array([1.55, TABLE.height + 0.3, 0.1, 4.5, 0.4, -0.2, 0, 0, 60]);
    const stroke = solveStroke(ball, {
      side: 1,
      target: { x: -0.95, z: -0.35 },
      flightTime: 0.55,
      brush: 1.5,
      netMargin: 0.03,
    });
    expect(stroke).not.toBeNull();
    expect(stroke.netClearance).toBeGreaterThan(0.03);
    expect(stroke.landing.x).toBeLessThan(0);
    expect(Math.abs(stroke.landing.z)).toBeLessThan(TABLE.halfWidth);
    expect(stroke.netClearance + TABLE.height + NET.height).toBeGreaterThan(TABLE.height);
  });
});

describe("gantry kinematics", () => {
  it("inverse and forward kinematics agree", () => {
    const centre = { x: -0.85, y: 1.05, z: 0.3 };
    const normal = (() => {
      const v = { x: -0.9, y: 0.25, z: 0.2 };
      const l = Math.hypot(v.x, v.y, v.z);
      return { x: v.x / l, y: v.y / l, z: v.z / l };
    })();
    const { q, violation } = inverseKinematics(centre, normal);
    expect(violation).toBe(0);
    const fk = forwardKinematics(q);
    expect(fk.centre.x).toBeCloseTo(centre.x, 9);
    expect(fk.centre.y).toBeCloseTo(centre.y, 9);
    expect(fk.centre.z).toBeCloseTo(centre.z, 9);
    expect(fk.normal.x).toBeCloseTo(normal.x, 9);
    expect(fk.normal.y).toBeCloseTo(normal.y, 9);
  });

  it("quintic segments match both boundary states", () => {
    const seg = new Quintic(1, 0.2, [0.1, 0.5, -2], [0.4, 3, 0]);
    const [p0, v0, a0] = seg.evaluate(1);
    const [p1, v1, a1] = seg.evaluate(1.2);
    expect([p0, v0, a0].map((v) => +v.toFixed(9))).toEqual([0.1, 0.5, -2]);
    expect(p1).toBeCloseTo(0.4, 9);
    expect(v1).toBeCloseTo(3, 9);
    expect(a1).toBeCloseTo(0, 6);
  });

  it("joint limits are reported as violations", () => {
    const far = inverseKinematics({ x: -2, y: 1, z: 0 }, { x: -1, y: 0, z: 0 });
    expect(far.violation).toBeGreaterThan(0.5);
    expect(GANTRY.axes).toHaveLength(5);
  });
});

describe("stroke references", () => {
  it("never command the swing or follow-through past the hard stops", async () => {
    const { swingProfile } = await import("../src/sim/agent.js");
    let checked = 0;
    for (let k = 0; k < 3; k += 1) {
      const axis = GANTRY.axes[k];
      for (const qHit of [axis.min + 0.02, (axis.min + axis.max) / 2, axis.max - 0.02]) {
        for (const qd of [-4, -1.5, 1.5, 4]) {
          const p = swingProfile(k, qHit, qd);
          const swing = new Quintic(0, p.duration, [p.qPre, 0, 0], [qHit, qd, 0]);
          const follow = new Quintic(0, p.followTime, [qHit, qd, 0], [p.qFollow, 0, 0]);
          for (let i = 0; i <= 50; i += 1) {
            for (const seg of [swing, follow]) {
              const [q] = seg.evaluate((seg.T * i) / 50);
              if (!p.feasible) continue; // the planner rejects these strokes
              checked += 1;
              expect(q).toBeGreaterThanOrEqual(axis.min - 1e-9);
              expect(q).toBeLessThanOrEqual(axis.max + 1e-9);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});
