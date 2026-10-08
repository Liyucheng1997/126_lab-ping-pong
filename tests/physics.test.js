import { describe, expect, it } from "vitest";
import {
  applyImpact,
  createState,
  integrateFlight,
  NOMINAL_MODEL,
  rollout,
  stepBall,
} from "../src/sim/ballPhysics.js";
import { BALL, TABLE } from "../src/sim/constants.js";

const surface = TABLE.height + BALL.radius;

function apexAfterBounce(dropHeight) {
  const s = createState({ x: 0.5, y: surface + dropHeight, z: 0 });
  let bounced = false;
  let apex = 0;
  for (let i = 0; i < 2000; i += 1) {
    const events = stepBall(s, 0.0005);
    if (events.some((e) => e.type === "table")) bounced = true;
    if (bounced) apex = Math.max(apex, s[1] - surface);
    if (bounced && s[4] < 0) break;
  }
  return apex;
}

describe("ball flight", () => {
  it("passes the ITTF bounce test (30 cm drop → ≈23 cm rebound)", () => {
    const rebound = apexAfterBounce(0.3);
    expect(rebound).toBeGreaterThan(0.215);
    expect(rebound).toBeLessThan(0.245);
  });

  it("approaches the drag-limited terminal velocity", () => {
    const s = createState({ x: 10, y: 200, z: 0 });
    for (let i = 0; i < 5000; i += 1) integrateFlight(s, 0.001);
    const terminal = Math.sqrt(NOMINAL_MODEL.gravity / NOMINAL_MODEL.dragK);
    expect(Math.abs(s[4])).toBeCloseTo(terminal, 1);
  });

  it("RK4 integration converges with step size", () => {
    const base = createState({ x: -1.4, y: 1, z: 0 }, { x: 8, y: 2, z: 1 }, { x: 10, y: 50, z: -300 });
    const a = Float64Array.from(base);
    const b = Float64Array.from(base);
    for (let i = 0; i < 250; i += 1) integrateFlight(a, 0.002);
    for (let i = 0; i < 500; i += 1) integrateFlight(b, 0.001);
    const err = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(err).toBeLessThan(1e-6);
  });

  it("Magnus force makes topspin dip and backspin float", () => {
    const flightHeight = (wz) => {
      const s = createState({ x: -1.5, y: 1.2, z: 0 }, { x: 8, y: 0, z: 0 }, { x: 0, y: 0, z: wz });
      for (let i = 0; i < 200; i += 1) integrateFlight(s, 0.001);
      return s[1];
    };
    const flat = flightHeight(0);
    // ball moving +x: ω = −z is topspin, ω = +z backspin
    expect(flightHeight(-400)).toBeLessThan(flat - 0.01);
    expect(flightHeight(400)).toBeGreaterThan(flat + 0.01);
  });
});

describe("impulse contact", () => {
  it("never gains energy and respects restitution", () => {
    const s = createState({ x: 0, y: surface, z: 0 }, { x: 3, y: -4, z: 0 }, { x: 0, y: 0, z: 0 });
    const energy = (st) => 0.5 * BALL.mass * (st[3] ** 2 + st[4] ** 2 + st[5] ** 2)
      + 0.5 * BALL.inertia * (st[6] ** 2 + st[7] ** 2 + st[8] ** 2);
    const before = energy(s);
    applyImpact(s, { x: 0, y: 1, z: 0 }, 0.9, 0.25);
    expect(energy(s)).toBeLessThan(before);
    expect(s[4]).toBeCloseTo(3.6, 6);
  });

  it("high friction ends the contact in rolling (zero slip)", () => {
    const s = createState({ x: 0, y: surface, z: 0 }, { x: 2, y: -3, z: 0 }, { x: 0, y: 0, z: 0 });
    const res = applyImpact(s, { x: 0, y: 1, z: 0 }, 0.8, 5);
    expect(res.sliding).toBe(false);
    // contact point velocity v + ω × (−r n) = v_x + r·ω_z must vanish
    expect(Math.abs(s[3] + s[8] * BALL.radius)).toBeLessThan(1e-9);
    // forward motion produces topspin (ω_z < 0)
    expect(s[8]).toBeLessThan(0);
  });

  it("separating contacts are ignored", () => {
    const s = createState({ x: 0, y: surface, z: 0 }, { x: 1, y: 2, z: 0 });
    expect(applyImpact(s, { x: 0, y: 1, z: 0 }, 0.9, 0.2)).toBeNull();
  });
});

describe("environment contacts", () => {
  it("a ball driven into the net is stopped by it", () => {
    const s0 = createState({ x: -0.5, y: TABLE.height + 0.07, z: 0 }, { x: 6, y: 0, z: 0 });
    const path = rollout(s0, { horizon: 0.3, dt: 0.001 });
    const netHit = path.some((p) => p.events.some((e) => e.type === "net"));
    expect(netHit).toBe(true);
    expect(path[path.length - 1].s[0]).toBeLessThan(0.05);
  });

  it("detects a bounce on the correct half", () => {
    const s0 = createState({ x: -1.2, y: 1.0, z: 0.1 }, { x: 6, y: 1, z: 0 });
    const path = rollout(s0, { horizon: 1, dt: 0.001 });
    const bounce = path.flatMap((p) => p.events).find((e) => e.type === "table");
    expect(bounce.side).toBe(1);
    expect(Math.abs(bounce.x)).toBeLessThan(TABLE.halfLength);
  });
});
