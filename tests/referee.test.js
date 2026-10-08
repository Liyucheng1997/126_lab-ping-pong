import { describe, expect, it } from "vitest";
import { Referee } from "../src/sim/referee.js";

// plays a clean point for `winner`: winner serves or receives, loser misses
function playPoint(ref, winner) {
  ref.newRally();
  ref.toss();
  const server = ref.server;
  ref.paddle(server, -server * 1.6);
  ref.table(server);
  ref.table(-server);
  if (winner === server) {
    ref.out(); // receiver misses a good serve
  } else {
    ref.paddle(-server, server * 1.6);
    ref.table(server);
    ref.out(); // server misses the return
  }
}

describe("ITTF referee", () => {
  it("alternates service every two points and every point from 10–10", () => {
    const ref = new Referee();
    const servers = [];
    for (let i = 0; i < 20; i += 1) {
      servers.push(ref.server);
      playPoint(ref, i % 2 === 0 ? -1 : 1);
    }
    expect(servers.slice(0, 6)).toEqual([-1, -1, 1, 1, -1, -1]);
    expect(ref.points[-1]).toBe(10);
    expect(ref.points[1]).toBe(10);
    const deuce = [];
    for (let i = 0; i < 4; i += 1) {
      deuce.push(ref.server);
      playPoint(ref, i % 2 === 0 ? -1 : 1);
    }
    expect(deuce).toEqual([-1, 1, -1, 1]);
  });

  it("requires a two-point margin and alternates the first server per game", () => {
    const ref = new Referee();
    for (let i = 0; i < 10; i += 1) playPoint(ref, -1);
    for (let i = 0; i < 10; i += 1) playPoint(ref, 1);
    playPoint(ref, -1); // 11–10: not yet
    expect(ref.games[-1]).toBe(0);
    playPoint(ref, -1); // 12–10
    expect(ref.games[-1]).toBe(1);
    expect(ref.points[-1]).toBe(0);
    expect(ref.server).toBe(1);
  });

  it("calls service faults, lets, double bounces and double hits", () => {
    const ref = new Referee();
    ref.toss();
    ref.paddle(-1, -1.6);
    ref.table(1); // served directly onto the receiver's half
    expect(ref.history.at(-1).reason).toBe("SERVICE FAULT");
    expect(ref.history.at(-1).winner).toBe(1);

    ref.newRally();
    ref.toss();
    const s = ref.server;
    const pointsBefore = ref.history.length;
    ref.paddle(s, 0);
    ref.net();
    ref.table(s);
    ref.table(-s);
    expect(ref.reason).toBe("LET");
    expect(ref.history.length).toBe(pointsBefore); // a let scores nothing

    ref.newRally();
    ref.toss();
    const s2 = ref.server;
    ref.paddle(s2, 0);
    ref.table(s2);
    ref.table(-s2);
    ref.table(-s2);
    expect(ref.history.at(-1).reason).toBe("DOUBLE BOUNCE");
    expect(ref.history.at(-1).winner).toBe(s2);

    ref.newRally();
    ref.toss();
    const s3 = ref.server;
    ref.paddle(s3, 0);
    ref.table(s3);
    ref.table(-s3);
    ref.paddle(-s3, 0);
    ref.paddle(-s3, 0);
    expect(ref.history.at(-1).reason).toBe("DOUBLE HIT");
  });
});
