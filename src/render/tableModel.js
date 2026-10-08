// ITTF competition table: 25 mm top, two halves on folding undercarriages
// with lockable castors, and a clamp-on net assembly (183 cm × 15.25 cm).

import * as THREE from "three";
import { NET, TABLE } from "../sim/constants.js";
import { alongAxis, box, cylinder, mesh, roundedBox } from "./parts.js";

export function buildTable(materials) {
  const group = new THREE.Group();
  group.name = "ittf-table";

  // ---- playing surface: two halves separated by a hairline joint
  const halfLen = TABLE.halfLength - 0.0015;
  for (const s of [-1, 1]) {
    const geo = new THREE.BoxGeometry(halfLen, TABLE.thickness, TABLE.width);
    // UVs of the top face (index 2) map into the shared full-table texture
    const uv = geo.attributes.uv;
    const u0 = s < 0 ? 0 : 0.5 + 0.0015 / TABLE.length;
    const u1 = s < 0 ? 0.5 - 0.0015 / TABLE.length : 1;
    for (let i = 8; i < 12; i += 1) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      uv.setXY(i, u0 + (u1 - u0) * u, 1 - v);
    }
    const top = mesh(geo, [
      materials.tableEdge,
      materials.tableEdge,
      materials.tableTop,
      materials.steelDark,
      materials.tableEdge,
      materials.tableEdge,
    ]);
    top.position.set((s * (halfLen + 0.003)) / 2, TABLE.height - TABLE.thickness / 2, 0);
    group.add(top);
  }
  // thin white lacquer line along the top edges (visible from the side)
  for (const z of [-1, 1]) {
    const lip = box(TABLE.length, 0.003, 0.002, materials.tableWhite);
    lip.position.set(0, TABLE.height - 0.0015, z * (TABLE.halfWidth + 0.001));
    group.add(lip);
  }
  for (const x of [-1, 1]) {
    const lip = box(0.002, 0.003, TABLE.width, materials.tableWhite);
    lip.position.set(x * (TABLE.halfLength + 0.001), TABLE.height - 0.0015, 0);
    group.add(lip);
  }

  // ---- undercarriage per half
  for (const s of [-1, 1]) group.add(buildUndercarriage(s, materials));

  group.add(buildNet(materials));
  return group;
}

function buildUndercarriage(side, materials) {
  const g = new THREE.Group();
  const yTop = TABLE.height - TABLE.thickness;
  // apron frame under the top
  const apronDepth = 0.05;
  for (const z of [-1, 1]) {
    const rail = box(TABLE.halfLength - 0.12, apronDepth, 0.025, materials.steelPainted);
    rail.position.set(side * (TABLE.halfLength / 2 + 0.02), yTop - apronDepth / 2, z * (TABLE.halfWidth - 0.09));
    g.add(rail);
  }
  for (const x of [0.12, TABLE.halfLength - 0.1]) {
    const cross = box(0.025, apronDepth, TABLE.width - 0.2, materials.steelPainted);
    cross.position.set(side * x, yTop - apronDepth / 2, 0);
    g.add(cross);
  }

  // A-shaped leg frames
  const legX = [0.36, TABLE.halfLength - 0.24];
  for (const x of legX) {
    for (const z of [-1, 1]) {
      const leg = box(0.04, yTop - 0.13, 0.04, materials.steelPainted);
      leg.position.set(side * x, (yTop + 0.13) / 2 - 0.0, z * 0.52);
      g.add(leg);
    }
    const tie = box(0.035, 0.035, 1.04, materials.steelPainted);
    tie.position.set(side * x, 0.36, 0);
    g.add(tie);
  }
  // base runners with castors
  for (const z of [-1, 1]) {
    const runner = box(legX[1] - legX[0] + 0.24, 0.05, 0.05, materials.steelPainted);
    runner.position.set(side * ((legX[0] + legX[1]) / 2), 0.13, z * 0.52);
    g.add(runner);
    for (const x of [legX[0] - 0.1, legX[1] + 0.1]) {
      const fork = box(0.04, 0.05, 0.04, materials.steelDark);
      fork.position.set(side * x, 0.085, z * 0.52);
      g.add(fork);
      const wheel = alongAxis(cylinder(0.05, 0.05, 0.03, materials.rubberFoot, 24), "z");
      wheel.position.set(side * x, 0.05, z * 0.52);
      g.add(wheel);
      const hub = alongAxis(cylinder(0.022, 0.022, 0.034, materials.chrome, 16), "z");
      hub.position.copy(wheel.position);
      g.add(hub);
    }
  }
  // diagonal struts to the apron (folding mechanism)
  for (const z of [-1, 1]) {
    const from = new THREE.Vector3(side * legX[0], 0.36, z * 0.52);
    const to = new THREE.Vector3(side * 0.14, yTop - 0.05, z * 0.6);
    g.add(strut(from, to, 0.012, materials.chrome));
  }
  return g;
}

function strut(from, to, radius, material) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const m = cylinder(radius, radius, len, material, 12);
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

function buildNet(materials) {
  const g = new THREE.Group();
  g.name = "net-assembly";
  const netLength = NET.halfLength * 2;
  const y0 = TABLE.height;

  const meshPlane = mesh(new THREE.PlaneGeometry(netLength, NET.height - 0.012), materials.netMesh, {
    cast: false,
    receive: false,
  });
  meshPlane.rotation.y = Math.PI / 2;
  meshPlane.position.set(0, y0 + (NET.height - 0.012) / 2 + 0.002, 0);
  g.add(meshPlane);

  // white binding tape along the top (15 mm)
  const tape = roundedBox(0.004, 0.015, netLength, 0.0015, materials.tableWhite);
  tape.position.set(0, y0 + NET.height - 0.0075, 0);
  g.add(tape);
  // bottom cord
  const cord = alongAxis(cylinder(0.0015, 0.0015, netLength, materials.plasticBlack, 6), "z");
  cord.position.set(0, y0 + 0.003, 0);
  g.add(cord);

  // posts with screw clamps
  for (const z of [-1, 1]) {
    const post = new THREE.Group();
    post.position.set(0, 0, z * NET.halfLength);
    const upright = roundedBox(0.018, NET.height + 0.02, 0.014, 0.004, materials.steelDark);
    upright.position.y = y0 + (NET.height + 0.02) / 2 - 0.01;
    post.add(upright);
    const arm = roundedBox(0.03, 0.02, NET.overhang + 0.03, 0.005, materials.steelDark);
    arm.position.set(0, y0 + 0.005, -z * (NET.overhang / 2 - 0.01));
    post.add(arm);
    const clamp = roundedBox(0.05, 0.06, 0.03, 0.006, materials.steelDark);
    clamp.position.set(0, y0 - 0.025, -z * (NET.overhang - 0.015 + 0.0));
    post.add(clamp);
    const screw = cylinder(0.005, 0.005, 0.06, materials.chrome, 10);
    screw.position.set(0, y0 - 0.075, -z * (NET.overhang - 0.015));
    post.add(screw);
    const knob = cylinder(0.018, 0.018, 0.012, materials.plasticBlack, 16);
    knob.position.set(0, y0 - 0.108, -z * (NET.overhang - 0.015));
    post.add(knob);
    const tension = alongAxis(cylinder(0.009, 0.009, 0.012, materials.plasticBlack, 12), "z");
    tension.position.set(0, y0 + NET.height - 0.008, z * 0.01);
    post.add(tension);
    g.add(post);
  }
  return g;
}
