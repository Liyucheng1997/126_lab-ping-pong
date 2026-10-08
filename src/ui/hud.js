// DOM dashboard: score, robot state cards with axis utilisation, ball
// telemetry with a rolling chart, match statistics and the robot-camera PiP.

import { GANTRY } from "../sim/robot.js";

const REASONS = {
  "SERVICE FAULT": "发球失误",
  "WRONG SIDE": "回球未过网",
  "DOUBLE BOUNCE": "二次弹跳",
  MISSED: "漏接",
  OUT: "出界",
  SIDE: "击中台侧",
  "DOUBLE HIT": "连击",
  OBSTRUCTION: "拦击",
  LONG: "出界",
  NET: "发球触网",
  LET: "重发球",
};

const MODES = {
  READY: "待机",
  TRACKING: "跟踪",
  STRIKE: "击球",
  SERVE: "发球",
  FOLLOW: "随挥",
  RECOVER: "复位",
};

const AXIS_LABELS = ["横移", "升降", "推杆", "偏航", "俯仰"];

const $ = (sel, root = document) => root.querySelector(sel);
const sideName = (side) => (side < 0 ? "LEFT" : "RIGHT");

export class Hud {
  constructor() {
    this.cards = new Map();
    document.querySelectorAll(".robot-card").forEach((card) => {
      const side = Number(card.dataset.side);
      const axes = $(".axes", card);
      const rows = AXIS_LABELS.map((label) => {
        const li = document.createElement("li");
        li.innerHTML = `<span>${label}</span><span class="bar"><i></i></span><span class="val">0</span>`;
        axes.appendChild(li);
        return { bar: $("i", li), val: $(".val", li) };
      });
      this.cards.set(side, {
        mode: $(".mode", card),
        shot: $(".shot", card),
        tth: $(".tth", card),
        blade: $(".blade", card),
        spin: $(".spin", card),
        rows,
      });
    });
    this.el = {
      pointsLeft: $("#pointsLeft"),
      pointsRight: $("#pointsRight"),
      gamesLeft: $("#gamesLeft"),
      gamesRight: $("#gamesRight"),
      serveLeft: $("#serveLeft"),
      serveRight: $("#serveRight"),
      rallyHits: $("#rallyHits"),
      callout: $("#callout"),
      ballSpeed: $("#ballSpeed"),
      ballSpin: $("#ballSpin"),
      estError: $("#estError"),
      hitError: $("#hitError"),
      statPoints: $("#statPoints"),
      statMean: $("#statMean"),
      statMax: $("#statMax"),
      statRate: $("#statRate"),
      statReasons: $("#statReasons"),
      chart: $("#chart"),
      pipOverlay: $("#pipOverlay"),
      pipLabel: $("#pipLabel"),
    };
    this.chart = { samples: [], window: 4, lastT: -1 };
    this.lastDom = -1;
    this.lastScoreKey = "";
    this.callout = "READY";
    this.calloutUntil = 0;
  }

  // ---- events ---------------------------------------------------------------------

  onEvent(e, time) {
    if (e.type === "point") {
      const reason = REASONS[e.reason] ?? e.reason;
      this.flash(`${sideName(e.winner)} 得分 · ${reason}`, time, 1.6);
    } else if (e.type === "let") {
      this.flash("LET · 重发球", time, 1.4);
    } else if (e.type === "game") {
      this.flash(`${sideName(e.winner)} 赢下本局  ${e.games[0]} : ${e.games[1]}`, time, 2.5);
    } else if (e.type === "match") {
      this.flash(`${sideName(e.winner)} 赢得比赛`, time, 3);
    } else if (e.type === "toss") {
      this.flash(`${sideName(e.side)} 发球`, time, 0.8);
    }
  }

  flash(text, time, duration) {
    this.callout = text;
    this.calloutUntil = time + duration;
  }

  // ---- per frame ------------------------------------------------------------------------

  update(sim, frame) {
    const t = sim.time;
    this.sampleChart(sim);
    if (frame.wall - this.lastDom < 1 / 15) return;
    this.lastDom = frame.wall;

    const ref = sim.referee;
    const el = this.el;
    el.pointsLeft.textContent = ref.points[-1];
    el.pointsRight.textContent = ref.points[1];
    el.gamesLeft.textContent = ref.games[-1];
    el.gamesRight.textContent = ref.games[1];
    el.serveLeft.classList.toggle("on", ref.server < 0);
    el.serveRight.classList.toggle("on", ref.server > 0);
    el.rallyHits.textContent = ref.hits;
    el.callout.textContent = t < this.calloutUntil ? this.callout : ref.live ? "IN PLAY" : "—";

    const ball = sim.ballSnapshot();
    el.ballSpeed.textContent = ball.speed.toFixed(1);
    el.ballSpin.textContent = ball.rpm.toFixed(0);
    const err = this.estimationError(sim);
    el.estError.textContent = err === null ? "—" : (err * 1000).toFixed(1);
    const recent = sim.agents.flatMap((a) => a.stats.predictionErrors.slice(-10));
    el.hitError.textContent = recent.length ? ((recent.reduce((s, v) => s + v, 0) / recent.length) * 1000).toFixed(1) : "—";

    for (const agent of sim.agents) {
      const card = this.cards.get(agent.side);
      const tel = agent.telemetry();
      card.mode.textContent = `${tel.mode} ${MODES[tel.mode] ?? ""}`;
      card.mode.classList.toggle("hot", tel.mode === "STRIKE" || tel.mode === "SERVE");
      card.shot.textContent = agent.plan ? tel.shot : "—";
      const tth = tel.timeToHit;
      card.tth.textContent = tth !== null && tth > -0.05 && agent.plan ? `${Math.max(0, tth * 1000).toFixed(0)} ms` : "—";
      card.blade.textContent = agent.plan ? `${Math.abs(tel.bladeSpeed).toFixed(2)} m/s` : "—";
      if (tel.spinEstimate && agent.ekf.updates > 4) {
        const s = tel.spinEstimate;
        card.spin.textContent = `${((Math.hypot(s.x, s.y, s.z) * 60) / (2 * Math.PI)).toFixed(0)} rpm`;
      } else {
        card.spin.textContent = "—";
      }
      tel.q.forEach((q, i) => {
        const util = Math.min(1, Math.abs(tel.qd[i]) / GANTRY.axes[i].vmax);
        card.rows[i].bar.style.width = `${(util * 100).toFixed(0)}%`;
        card.rows[i].val.textContent = GANTRY.axes[i].unit === "m" ? `${q.toFixed(3)}` : `${((q * 180) / Math.PI).toFixed(1)}°`;
      });
    }

    const scoreKey = `${sim.rallyStats.length}`;
    if (scoreKey !== this.lastScoreKey) {
      this.lastScoreKey = scoreKey;
      this.updateStats(sim);
    }
    el.statRate.textContent = frame.rateText;
    this.drawChart();
  }

  estimationError(sim) {
    if (sim.ballHeld) return null;
    const towards = sim.ball[3] >= 0 ? sim.agent(1) : sim.agent(-1);
    if (!towards.ekf.initialized || towards.ekf.updates < 3) return null;
    const x = towards.ekf.stateAt(sim.time);
    return Math.hypot(x[0] - sim.ball[0], x[1] - sim.ball[1], x[2] - sim.ball[2]);
  }

  updateStats(sim) {
    const el = this.el;
    const rallies = sim.rallyStats;
    el.statPoints.textContent = rallies.length;
    if (rallies.length) {
      const hits = rallies.map((r) => r.hits);
      el.statMean.textContent = `${(hits.reduce((a, b) => a + b, 0) / hits.length).toFixed(1)} 拍`;
      el.statMax.textContent = `${Math.max(...hits)} 拍`;
    }
    const counts = {};
    for (const r of rallies) {
      const key = REASONS[r.reason] ?? r.reason;
      counts[key] = (counts[key] || 0) + 1;
    }
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
    el.statReasons.innerHTML = entries
      .map(([k, v]) => `<li><span>${k}</span><span>${v}</span><span class="bar"><i style="width:${((v / rallies.length) * 100).toFixed(0)}%"></i></span></li>`)
      .join("");
  }

  // ---- rolling chart ------------------------------------------------------------------------

  sampleChart(sim) {
    const c = this.chart;
    if (sim.time - c.lastT < 1 / 120) return;
    c.lastT = sim.time;
    const err = this.estimationError(sim);
    c.samples.push({
      t: sim.time,
      speed: sim.ballHeld ? 0 : Math.hypot(sim.ball[3], sim.ball[4], sim.ball[5]),
      err: err === null ? null : err * 1000,
      height: sim.ball[1],
    });
    while (c.samples.length && c.samples[0].t < sim.time - c.window) c.samples.shift();
  }

  drawChart() {
    const canvas = this.el.chart;
    if (!canvas.offsetParent) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const samples = this.chart.samples;
    if (samples.length < 2) return;
    const t1 = samples[samples.length - 1].t;
    const t0 = t1 - this.chart.window;
    const x = (t) => ((t - t0) / (t1 - t0)) * w;

    ctx.strokeStyle = "rgba(255,255,255,0.06)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(0, (h * i) / 4);
      ctx.lineTo(w, (h * i) / 4);
      ctx.stroke();
    }
    const series = (key, max, min, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      let pen = false;
      for (const s of samples) {
        const v = s[key];
        if (v === null) {
          pen = false;
          continue;
        }
        const y = h - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (h - 4) - 2;
        if (pen) ctx.lineTo(x(s.t), y);
        else ctx.moveTo(x(s.t), y);
        pen = true;
      }
      ctx.stroke();
    };
    series("height", 1.9, 0.6, "#8fb6ff");
    series("speed", 12, 0, "#ffd75a");
    series("err", 20, 0, "#7dff8a");
    ctx.fillStyle = "rgba(200,214,228,0.55)";
    ctx.font = "10px Consolas, monospace";
    ctx.fillText("12 m/s · 20 mm", 4, 11);
  }

  // ---- PiP overlay ---------------------------------------------------------------------------------

  drawPip(agent, sim, width, height) {
    const canvas = this.el.pipOverlay;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const cam = agent.rig.cameras[0];
    // the PiP keeps the sensor's vertical FOV: one scale, horizontally centred
    const k = height / cam.height;
    const ox = (width - cam.width * k) / 2;
    const px2 = (u) => ox + u * k;
    const sy = k;
    const color = agent.side < 0 ? "#4ed8ff" : "#ff8a3d";

    // predicted path projected into the image
    if (agent.plan && sim.time < agent.plan.tHit) {
      ctx.strokeStyle = "rgba(125,255,138,0.8)";
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      let pen = false;
      for (const sample of agent.plan.path) {
        const tt = agent.plan.pathStart + sample.t;
        if (tt < sim.time || tt > agent.plan.tHit) continue;
        const px = cam.project({ x: sample.s[0], y: sample.s[1], z: sample.s[2] });
        if (!px) continue;
        if (pen) ctx.lineTo(px2(px.u), px.v * sy);
        else ctx.moveTo(px2(px.u), px.v * sy);
        pen = true;
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const det = agent.rig.lastDetections[0];
    if (det && !sim.ballHeld) {
      const r = Math.max(5, det.radius * k * 2.2);
      const u = px2(det.u);
      const v = det.v * sy;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(u - r, v - r, 2 * r, 2 * r);
      ctx.beginPath();
      ctx.moveTo(u - r - 5, v);
      ctx.lineTo(u - r + 3, v);
      ctx.moveTo(u + r - 3, v);
      ctx.lineTo(u + r + 5, v);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "10px Consolas, monospace";
      ctx.fillText(`ball ${det.u.toFixed(1)}, ${det.v.toFixed(1)} px`, Math.min(u + r + 6, width - 120), Math.max(v - r, 22));
    }
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, height - 18, width, 18);
    ctx.fillStyle = "#c9d6e3";
    ctx.font = "10px Consolas, monospace";
    const rig = agent.rig;
    ctx.fillText(`det ${((rig.detections / Math.max(1, rig.frames)) * 100).toFixed(0)}%  NIS ${agent.ekf.lastNis.toFixed(1)}  f ${cam.focal.toFixed(0)} px`, 6, height - 6);
  }
}
