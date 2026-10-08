import { describe, expect, it } from "vitest";
import { createBallModel, createState, stepBall } from "../src/sim/ballPhysics.js";
import { BallEKF } from "../src/sim/estimator.js";
import { createRng, symmetricEigen3 } from "../src/sim/math.js";
import { PinholeCamera, StereoRig, triangulate } from "../src/sim/perception.js";

function makeRig(rng) {
  const cams = [-0.4, 0.4].map(
    (z) => new PinholeCamera({ position: { x: 2.8, y: 2.5, z }, target: { x: -0.5, y: 0.8, z: 0 }, width: 1920, height: 1200, hfov: 72 }),
  );
  return new StereoRig({ left: cams[0], right: cams[1], rng });
}

describe("stereo perception", () => {
  it("triangulates noise-free rays exactly", () => {
    const rng = createRng(1);
    const rig = makeRig(rng);
    const p = { x: 0.3, y: 1.0, z: -0.2 };
    const [a, b] = rig.cameras.map((c) => c.project(p));
    const tri = triangulate(rig.cameras[0].position, rig.cameras[0].ray(a.u, a.v), rig.cameras[1].position, rig.cameras[1].ray(b.u, b.v));
    expect(Math.hypot(tri.point.x - p.x, tri.point.y - p.y, tri.point.z - p.z)).toBeLessThan(1e-9);
  });

  it("depth error grows quadratically with range", () => {
    const rig = makeRig(createRng(2));
    const near = symmetricEigen3(rig.measurementCovariance({ x: 1.6, y: 1, z: 0 })).values;
    const far = symmetricEigen3(rig.measurementCovariance({ x: -1.3, y: 1, z: 0 })).values;
    const ratio = Math.sqrt(Math.max(...far) / Math.max(...near));
    expect(ratio).toBeGreaterThan(4);
  });
});

describe("9-state EKF", () => {
  it("tracks position to millimetres and observes topspin through the Magnus effect", () => {
    const rng = createRng(5);
    const rig = makeRig(rng);
    const truth = createBallModel({ dragCoefficient: 0.46, liftScale: 1.04 });
    const ekf = new BallEKF();
    const s = createState({ x: -1.6, y: 1.0, z: 0.2 }, { x: 7.5, y: 1.6, z: -0.4 }, { x: 0, y: -40, z: -260 });
    let t = 0;
    const errors = [];
    for (let i = 0; i < 420; i += 1) {
      t += 0.001;
      stepBall(s, 0.001, truth);
      for (const m of rig.update(t, { x: s[0], y: s[1], z: s[2] })) ekf.update(m);
      if (t > 0.2 && i % 10 === 0) {
        const x = ekf.stateAt(t);
        errors.push(Math.hypot(x[0] - s[0], x[1] - s[1], x[2] - s[2]));
      }
    }
    const rms = Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / errors.length);
    expect(rms).toBeLessThan(0.008);
    // spin about z is the dominant, observable component
    expect(ekf.x[8]).toBeLessThan(-150);
    expect(ekf.x[8]).toBeGreaterThan(-380);
  });

  it("re-initialises after an abrupt velocity change (paddle impact)", () => {
    const rng = createRng(9);
    const rig = makeRig(rng);
    const ekf = new BallEKF();
    const s = createState({ x: 1.2, y: 1.0, z: 0 }, { x: -6, y: 1, z: 0 });
    let t = 0;
    let reset = false;
    for (let i = 0; i < 300; i += 1) {
      t += 0.001;
      if (i === 120) {
        s[3] = 6;
        s[4] = 2;
      }
      stepBall(s, 0.001);
      for (const m of rig.update(t, { x: s[0], y: s[1], z: s[2] })) {
        if (ekf.update(m) === "reset") reset = true;
      }
    }
    expect(reset).toBe(true);
    expect(Math.abs(ekf.x[3] - s[3])).toBeLessThan(0.3);
  });
});

describe("camera clock", () => {
  it("captures on the exact frame instant when driven by integer physics steps", () => {
    const rig = makeRig(createRng(4));
    rig.dropout = 0;
    rig.latency = 0;
    rig.pixelSigma = 0;
    const stamps = [];
    const captured = [];
    for (let step = 1; step <= 1000; step += 1) {
      const t = step * 0.001;
      for (const m of rig.update(t, { x: t, y: 1, z: 0 })) {
        stamps.push(m.stamp);
        captured.push(m.position.x);
      }
    }
    // the ball's x equals the time it was observed: frames must not slip a step
    const slips = stamps.filter((s, i) => Math.abs(captured[i] - s) > 1e-6);
    expect(stamps.length).toBeGreaterThan(150);
    expect(slips).toHaveLength(0);
  });
});
