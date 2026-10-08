// Headless benchmark: plays simulated time for several seeds and reports rally
// statistics, stroke quality and the simulator's real-time factor.
//
//   npm run bench -- [seconds=120] [seeds=4]

import { Simulation } from "../src/sim/simulation.js";

const seconds = Number(process.argv[2] ?? 120);
const seeds = Number(process.argv[3] ?? 4);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);
const pct = (a, p) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

const totals = { points: 0, hits: [], speeds: [], spins: [], errors: [], timing: [], reasons: {}, wall: 0 };
for (let seed = 1; seed <= seeds; seed += 1) {
  const sim = new Simulation({ seed });
  sim.on((e) => {
    if (e.type === "paddle") {
      totals.speeds.push(e.speed);
      totals.spins.push((e.spin * 60) / (2 * Math.PI));
    }
  });
  const t0 = performance.now();
  sim.advance(seconds);
  totals.wall += performance.now() - t0;
  for (const p of sim.rallyStats) {
    totals.points += 1;
    totals.hits.push(p.hits);
    totals.reasons[p.reason] = (totals.reasons[p.reason] || 0) + 1;
  }
  for (const a of sim.agents) {
    totals.errors.push(...a.stats.predictionErrors.map((e) => e * 1000));
    totals.timing.push(...a.stats.timing.map((e) => e * 1000));
  }
}

const simulated = seconds * seeds;
console.log(`simulated ${simulated} s in ${(totals.wall / 1000).toFixed(1)} s  (×${((simulated * 1000) / totals.wall).toFixed(1)} real time)`);
console.log(`points ${totals.points}  ·  hits/point mean ${mean(totals.hits).toFixed(1)}  median ${pct(totals.hits, 0.5)}  max ${Math.max(...totals.hits)}`);
console.log(`outgoing ball speed  mean ${mean(totals.speeds).toFixed(2)} m/s  p95 ${pct(totals.speeds, 0.95).toFixed(2)} m/s`);
console.log(`outgoing spin        mean ${mean(totals.spins).toFixed(0)} rpm  p95 ${pct(totals.spins, 0.95).toFixed(0)} rpm`);
console.log(`hit-point prediction mean ${mean(totals.errors).toFixed(1)} mm  p95 ${pct(totals.errors, 0.95).toFixed(1)} mm`);
console.log(`contact timing       mean ${mean(totals.timing).toFixed(1)} ms  p95 |dt| ${pct(totals.timing.map(Math.abs), 0.95).toFixed(1)} ms`);
console.log("point endings:", Object.entries(totals.reasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(" · "));
