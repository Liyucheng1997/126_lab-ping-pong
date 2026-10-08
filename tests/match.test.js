import { describe, expect, it } from "vitest";
import { Simulation } from "../src/sim/simulation.js";

describe("headless match", () => {
  it("is deterministic for a given seed", () => {
    const a = new Simulation({ seed: 3 });
    const b = new Simulation({ seed: 3 });
    a.advance(12);
    b.advance(12);
    expect(Array.from(a.ball)).toEqual(Array.from(b.ball));
    expect(a.rallyStats).toEqual(b.rallyStats);
  });

  it("sustains rallies from closed-loop perception, planning and control", () => {
    const sim = new Simulation({ seed: 21 });
    let contacts = 0;
    sim.on((e) => {
      if (e.type === "paddle") contacts += 1;
    });
    sim.advance(60);
    const points = sim.rallyStats;
    expect(points.length).toBeGreaterThan(2);
    const meanHits = points.reduce((s, p) => s + p.hits, 0) / points.length;
    expect(meanHits).toBeGreaterThan(3);
    expect(contacts).toBeGreaterThan(20);
    const errors = sim.agents.flatMap((a) => a.stats.predictionErrors);
    const mean = errors.reduce((s, e) => s + e, 0) / errors.length;
    // where the ball actually was at contact vs. where the planner said it would be
    expect(mean).toBeLessThan(0.02);
  }, 30000);
});
