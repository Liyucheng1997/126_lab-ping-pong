// Engineering overlays: estimated/predicted trajectories, planned strike pose,
// 2σ uncertainty ellipsoid, landing targets, camera frusta with detection rays,
// bounce marks and contact bursts.

import * as THREE from "three";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { BALL, TABLE } from "../sim/constants.js";
import { symmetricEigen3 } from "../sim/math.js";
import { buildPaddle } from "./paddleModel.js";

const lineMaterials = new Set();

export function setLineResolution(width, height) {
  lineMaterials.forEach((m) => m.resolution.set(width, height));
}

export class FatLine {
  constructor({ color = 0xffffff, width = 2, opacity = 1, dashed = false, maxPoints = 400, vertexColors = false }) {
    this.geometry = new LineGeometry();
    this.material = new LineMaterial({
      color,
      linewidth: width,
      transparent: true,
      opacity,
      dashed,
      dashSize: 0.05,
      gapSize: 0.035,
      vertexColors,
      depthWrite: false,
    });
    this.material.resolution.set(window.innerWidth, window.innerHeight);
    lineMaterials.add(this.material);
    this.line = new Line2(this.geometry, this.material);
    this.line.frustumCulled = false;
    this.line.renderOrder = 5;
    this.maxPoints = maxPoints;
    this.positions = new Float32Array(maxPoints * 3);
    this.colors = new Float32Array(maxPoints * 3);
    this.line.visible = false;
  }

  set(points, colorFn = null) {
    const n = Math.min(points.length, this.maxPoints);
    if (n < 2) {
      this.line.visible = false;
      return;
    }
    // LineGeometry needs a fresh buffer when the vertex count changes
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      pos[i * 3] = points[i].x;
      pos[i * 3 + 1] = points[i].y;
      pos[i * 3 + 2] = points[i].z;
    }
    this.geometry.dispose();
    this.geometry = new LineGeometry();
    this.geometry.setPositions(pos);
    if (colorFn) {
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i += 1) {
        const c = colorFn(i / (n - 1));
        col[i * 3] = c.r;
        col[i * 3 + 1] = c.g;
        col[i * 3 + 2] = c.b;
      }
      this.geometry.setColors(col);
    }
    this.line.geometry = this.geometry;
    if (this.material.dashed) this.line.computeLineDistances();
    this.line.visible = true;
  }

  hide() {
    this.line.visible = false;
  }
}

function ring(radius, tube, color, opacity = 0.9) {
  return new THREE.Mesh(
    new THREE.TorusGeometry(radius, tube, 8, 64),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }),
  );
}

export class Overlays {
  constructor(scene, materials, agents) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = "overlays";
    scene.add(this.group);
    this.flags = { prediction: true, plan: true, uncertainty: true, vision: true, marks: true, trail: true };
    this.perRobot = new Map();

    const ghostMaterials = {
      ...materials,
      ghost: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.25, depthWrite: false }),
    };

    for (const agent of agents) {
      const accent = new THREE.Color(agent.side < 0 ? 0x4ed8ff : 0xff8a3d);
      const prediction = new FatLine({ color: accent, width: 2.2, opacity: 0.85, dashed: true });
      const shot = new FatLine({ color: accent, width: 1.4, opacity: 0.45 });
      const ghostMat = ghostMaterials.ghost.clone();
      ghostMat.color = accent;
      const ghost = buildPaddle({ ...ghostMaterials, ghost: ghostMat }, { ghost: true });
      ghost.visible = false;
      const normal = new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 0.22, accent, 0.04, 0.025);
      normal.visible = false;
      const hitRing = ring(0.035, 0.003, accent);
      hitRing.visible = false;
      const target = new THREE.Group();
      const tRing = ring(0.06, 0.004, accent, 0.95);
      tRing.rotation.x = Math.PI / 2;
      target.add(tRing);
      const cross = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(-0.09, 0, 0),
          new THREE.Vector3(0.09, 0, 0),
          new THREE.Vector3(0, 0, -0.09),
          new THREE.Vector3(0, 0, 0.09),
        ]),
        new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.8 }),
      );
      target.add(cross);
      target.visible = false;
      const ellipsoid = new THREE.Mesh(
        new THREE.SphereGeometry(1, 24, 16),
        new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.18, depthWrite: false }),
      );
      const ellipsoidWire = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.SphereGeometry(1, 12, 8)),
        new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.35 }),
      );
      ellipsoid.add(ellipsoidWire);
      ellipsoid.visible = false;

      // camera frusta + detection rays
      const frusta = new THREE.Group();
      const rays = [];
      agent.rig.cameras.forEach((cam) => {
        frusta.add(this.frustum(cam, accent));
        const ray = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
          new THREE.LineBasicMaterial({ color: accent, transparent: true, opacity: 0.32 }),
        );
        ray.frustumCulled = false;
        frusta.add(ray);
        rays.push(ray);
      });

      [prediction.line, shot.line, ghost, normal, hitRing, target, ellipsoid, frusta].forEach((o) => this.group.add(o));
      this.perRobot.set(agent.side, { prediction, shot, ghost, normal, hitRing, target, ellipsoid, frusta, rays, accent });
    }

    // ball trail: last ~0.35 s, fading
    this.trail = new FatLine({ color: 0xffffff, width: 3, opacity: 0.9, vertexColors: true });
    this.group.add(this.trail.line);
    this.trailPoints = [];

    // estimated ball (EKF) marker
    this.estimate = ring(BALL.radius * 1.9, 0.002, 0x7dff8a);
    this.group.add(this.estimate);

    // bounce marks
    this.marks = [];
    this.markGeo = new THREE.CircleGeometry(0.022, 24);
    this.bursts = [];
  }

  frustum(cam, color) {
    // short frustum glyph at each camera; the detection rays show what it sees
    const depth = 0.75;
    const corners = [
      [0, 0],
      [cam.width, 0],
      [cam.width, cam.height],
      [0, cam.height],
    ].map(([u, v]) => {
      const d = cam.ray(u, v);
      const t = depth / (d.x * cam.forward.x + d.y * cam.forward.y + d.z * cam.forward.z);
      return new THREE.Vector3(cam.position.x + d.x * t, cam.position.y + d.y * t, cam.position.z + d.z * t);
    });
    const o = new THREE.Vector3(cam.position.x, cam.position.y, cam.position.z);
    const pts = [];
    for (let i = 0; i < 4; i += 1) {
      pts.push(o, corners[i]);
      pts.push(corners[i], corners[(i + 1) % 4]);
    }
    return new THREE.LineSegments(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }),
    );
  }

  setFlag(name, value) {
    this.flags[name] = value;
  }

  addBounce(x, z, side) {
    if (!this.flags.marks) return;
    const mat = new THREE.MeshBasicMaterial({
      color: side < 0 ? 0x4ed8ff : 0xff8a3d,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const mark = new THREE.Mesh(this.markGeo, mat);
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(x, TABLE.height + 0.0008, z);
    this.group.add(mark);
    this.marks.push({ mesh: mark, age: 0 });
    if (this.marks.length > 40) {
      const old = this.marks.shift();
      this.group.remove(old.mesh);
      old.mesh.material.dispose();
    }
    this.burst(new THREE.Vector3(x, TABLE.height + 0.002, z), 0xffffff, true);
  }

  burst(position, color, flat = false) {
    const r = ring(0.03, 0.0025, color, 0.9);
    r.position.copy(position);
    if (flat) r.rotation.x = Math.PI / 2;
    this.group.add(r);
    this.bursts.push({ mesh: r, age: 0, flat });
  }

  update(dt, sim, camera, uncertaintyBySide) {
    const f = this.flags;
    const ball = sim.ball;
    const ballPos = new THREE.Vector3(ball[0], ball[1], ball[2]);

    // trail
    if (f.trail && !sim.ballHeld) {
      this.trailPoints.push(ballPos.clone());
      if (this.trailPoints.length > 26) this.trailPoints.shift();
      this.trail.set(this.trailPoints, (t) => new THREE.Color().setRGB(0.35 + 0.65 * t, 0.85 + 0.15 * t, 0.6 + 0.4 * t).multiplyScalar(t));
    } else {
      this.trailPoints.length = 0;
      this.trail.hide();
    }

    for (const agent of sim.agents) {
      const o = this.perRobot.get(agent.side);
      const plan = agent.plan;
      const active = plan && sim.time < plan.tHit + 0.05 && (agent.mode === "STRIKE" || agent.mode === "SERVE");

      // predicted incoming path up to the hit
      if (f.prediction && active) {
        const pts = [];
        for (const sample of plan.path) {
          if (plan.pathStart + sample.t > plan.tHit + 1e-6) break;
          if (plan.pathStart + sample.t < sim.time - 0.01) continue;
          pts.push(new THREE.Vector3(sample.s[0], sample.s[1], sample.s[2]));
        }
        pts.push(new THREE.Vector3(plan.ballAtHit[0], plan.ballAtHit[1], plan.ballAtHit[2]));
        o.prediction.set(pts);
      } else {
        o.prediction.hide();
      }

      // planned outgoing shot and its landing target
      if (f.plan && active) {
        const pts = plan.stroke.path.map((p) => new THREE.Vector3(p.s[0], p.s[1], p.s[2]));
        const landing = plan.stroke.landing;
        const cut = pts.findIndex((p, i) => i > 3 && p.y <= TABLE.height + BALL.radius + 0.002 && Math.abs(p.x - landing.x) < 0.08);
        o.shot.set(cut > 0 ? pts.slice(0, cut + 1) : pts);
        o.target.position.set(landing.x, TABLE.height + 0.002, landing.z);
        o.target.visible = true;

        const c = plan.joints.centreWorld;
        const n = plan.stroke.normal;
        o.ghost.visible = true;
        // ghost blade: centre and orientation of the planned strike
        o.ghost.position.set(0, 0, 0);
        const xAxis = new THREE.Vector3(-n.x, -n.y, -n.z);
        const up = new THREE.Vector3(0, 1, 0).addScaledVector(new THREE.Vector3(n.x, n.y, n.z), -n.y).normalize();
        const zAxis = new THREE.Vector3().crossVectors(xAxis, up).normalize();
        const basis = new THREE.Matrix4().makeBasis(xAxis, up, zAxis);
        o.ghost.quaternion.setFromRotationMatrix(basis);
        const offset = new THREE.Vector3(0, 0.118, 0).applyQuaternion(o.ghost.quaternion);
        o.ghost.position.set(c.x, c.y, c.z).sub(offset);
        o.normal.visible = true;
        o.normal.position.set(c.x, c.y, c.z);
        o.normal.setDirection(new THREE.Vector3(n.x, n.y, n.z));
        o.hitRing.visible = true;
        o.hitRing.position.set(plan.ballAtHit[0], plan.ballAtHit[1], plan.ballAtHit[2]);
        o.hitRing.quaternion.copy(camera.quaternion);
      } else {
        o.shot.hide();
        o.target.visible = false;
        o.ghost.visible = false;
        o.normal.visible = false;
        o.hitRing.visible = false;
      }

      // 2σ (≈74 % probability mass in 3-D) uncertainty ellipsoid of the predicted hitting position
      const unc = uncertaintyBySide.get(agent.side);
      if (f.uncertainty && active && unc && agent.ekf.updates > 6) {
        const { values, vectors } = symmetricEigen3(unc.covariance);
        const e = o.ellipsoid;
        const axes = [0, 1, 2].map((k) => new THREE.Vector3(vectors[k], vectors[3 + k], vectors[6 + k]));
        if (axes[0].clone().cross(axes[1]).dot(axes[2]) < 0) axes[2].negate();
        e.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(axes[0], axes[1], axes[2]));
        const radii = values.map((v) => Math.max(0.004, 2 * Math.sqrt(Math.max(v, 0))));
        e.scale.set(...radii);
        e.position.set(unc.position.x, unc.position.y, unc.position.z);
        // right after an opponent's stroke the filter has not converged yet
        e.visible = Math.max(...radii) < 0.25;
      } else {
        o.ellipsoid.visible = false;
      }

      // vision
      o.frusta.visible = f.vision;
      if (f.vision) {
        agent.rig.cameras.forEach((cam, i) => {
          const ray = o.rays[i];
          const det = agent.rig.lastDetections[i];
          ray.visible = Boolean(det) && !sim.ballHeld;
          if (ray.visible) {
            const p = ray.geometry.attributes.position;
            p.setXYZ(0, cam.position.x, cam.position.y, cam.position.z);
            p.setXYZ(1, ballPos.x, ballPos.y, ballPos.z);
            p.needsUpdate = true;
          }
        });
      }
    }

    // EKF estimate marker of the robot the ball is travelling towards
    const towards = ball[3] >= 0 ? sim.agent(1) : sim.agent(-1);
    if (f.vision && towards.ekf.initialized && !sim.ballHeld) {
      const x = towards.ekf.stateAt(sim.time);
      this.estimate.position.set(x[0], x[1], x[2]);
      this.estimate.quaternion.copy(camera.quaternion);
      this.estimate.visible = true;
    } else {
      this.estimate.visible = false;
    }

    // fade marks and bursts
    for (const m of this.marks) {
      m.age += dt;
      m.mesh.material.opacity = Math.max(0.12, 0.75 - m.age * 0.08);
      m.mesh.visible = f.marks;
    }
    for (let i = this.bursts.length - 1; i >= 0; i -= 1) {
      const b = this.bursts[i];
      b.age += dt;
      b.mesh.scale.setScalar(1 + b.age * 9);
      b.mesh.material.opacity = Math.max(0, 0.9 - b.age * 2.6);
      if (!b.flat) b.mesh.quaternion.copy(camera.quaternion);
      if (b.age > 0.35) {
        this.group.remove(b.mesh);
        b.mesh.geometry.dispose();
        b.mesh.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }
}
