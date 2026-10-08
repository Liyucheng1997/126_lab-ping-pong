// ITTF rules as an event-driven state machine.
//
// Input events: serve toss, paddle contacts, table contacts (with side), net
// contacts, side-of-table contacts and the ball reaching the floor.
// Covers: service faults, lets (net touch on an otherwise good service),
// wrong-side and double bounces, double hits, obstruction/volleys, misses,
// 11-point games won by two, service alternating every two points (every
// point from 10–10), alternating first server per game, best of five.

import { RULES, TABLE } from "./constants.js";

export const sideName = (side) => (side < 0 ? "LEFT" : "RIGHT");

export class Referee {
  constructor() {
    this.games = { [-1]: 0, [1]: 0 };
    this.points = { [-1]: 0, [1]: 0 };
    this.gameFirstServer = -1;
    this.server = -1;
    this.matchWinner = 0;
    this.history = [];
    this.listeners = [];
    this.newRally();
  }

  on(listener) {
    this.listeners.push(listener);
  }

  emit(event) {
    this.listeners.forEach((fn) => fn(event));
  }

  newRally() {
    this.phase = "pre-serve"; // pre-serve → toss → service → rally → dead
    this.lastHitter = 0;
    this.expect = 0; // side that the next bounce must land on
    this.bouncesOnReceiver = 0;
    this.netOnService = false;
    this.hits = 0;
    this.reason = "";
  }

  get receiver() {
    return -this.server;
  }

  get live() {
    return this.phase === "toss" || this.phase === "service" || this.phase === "rally";
  }

  toss() {
    this.phase = "toss";
  }

  paddle(side, ballX) {
    if (!this.live) return;
    if (this.phase === "toss") {
      if (side !== this.server) return this.award(this.server, "OBSTRUCTION");
      this.phase = "service";
      this.lastHitter = side;
      this.expect = side;
      this.hits = 1;
      return;
    }
    if (side === this.lastHitter) return this.award(-side, "DOUBLE HIT");
    if (this.expect === side && this.bouncesOnReceiver === 0) {
      // struck before the ball bounced on the striker's half
      const beyondEnd = Math.abs(ballX) > TABLE.halfLength;
      return beyondEnd ? this.award(side, "LONG") : this.award(-side, "OBSTRUCTION");
    }
    this.phase = "rally";
    this.lastHitter = side;
    this.expect = -side;
    this.bouncesOnReceiver = 0;
    this.hits += 1;
  }

  table(side) {
    if (!this.live) return;
    if (this.phase === "toss") return this.award(this.receiver, "SERVICE FAULT");
    if (this.phase === "service") {
      if (this.expect === this.server) {
        if (side !== this.server) return this.award(this.receiver, "SERVICE FAULT");
        this.expect = this.receiver;
        return;
      }
      if (side !== this.receiver) return this.award(this.receiver, "SERVICE FAULT");
      if (this.netOnService) return this.let();
      this.phase = "rally";
      this.bouncesOnReceiver = 1;
      return;
    }
    // rally
    if (side !== this.expect) return this.award(-this.lastHitter, "WRONG SIDE");
    this.bouncesOnReceiver += 1;
    if (this.bouncesOnReceiver >= 2) this.award(this.lastHitter, "DOUBLE BOUNCE");
  }

  net() {
    if (this.phase === "service") this.netOnService = true;
  }

  out(kind = "OUT") {
    if (!this.live) return;
    if (this.phase === "toss") return this.award(this.receiver, "SERVICE FAULT");
    if (this.bouncesOnReceiver > 0) {
      // the receiver let a good ball go past
      return this.award(this.lastHitter, "MISSED");
    }
    if (this.phase === "service" && this.netOnService) return this.award(this.receiver, "NET");
    this.award(-this.lastHitter, kind);
  }

  let() {
    this.phase = "dead";
    this.reason = "LET";
    this.emit({ type: "let" });
  }

  award(winner, reason) {
    if (!this.live) return;
    this.phase = "dead";
    this.reason = reason;
    this.points[winner] += 1;
    const record = {
      winner,
      reason,
      hits: this.hits,
      server: this.server,
      score: [this.points[-1], this.points[1]],
    };
    this.history.push(record);
    this.emit({ type: "point", ...record });

    const a = this.points[winner];
    const b = this.points[-winner];
    if (a >= RULES.pointsToWinGame && a - b >= RULES.winBy) {
      this.games[winner] += 1;
      this.emit({ type: "game", winner, games: [this.games[-1], this.games[1]] });
      if (this.games[winner] >= RULES.gamesToWinMatch) {
        this.matchWinner = winner;
        this.emit({ type: "match", winner });
      }
      this.points = { [-1]: 0, [1]: 0 };
      this.gameFirstServer = -this.gameFirstServer;
      this.server = this.gameFirstServer;
      return;
    }
    this.server = this.serverFor(this.points[-1], this.points[1]);
  }

  serverFor(left, right) {
    const total = left + right;
    const deuce = left >= RULES.pointsToWinGame - 1 && right >= RULES.pointsToWinGame - 1;
    const turns = deuce ? total : Math.floor(total / 2);
    return turns % 2 === 0 ? this.gameFirstServer : -this.gameFirstServer;
  }

  resetMatch() {
    this.games = { [-1]: 0, [1]: 0 };
    this.points = { [-1]: 0, [1]: 0 };
    this.gameFirstServer = -1;
    this.server = -1;
    this.matchWinner = 0;
    this.newRally();
  }
}
