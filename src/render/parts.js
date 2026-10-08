// Reusable mechanical parts: T-slot aluminium extrusions, profiled linear
// guides with carriage blocks, servo motors, pulleys, fasteners, cable chains.

import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

const geometryCache = new Map();
function cached(key, build) {
  if (!geometryCache.has(key)) geometryCache.set(key, build());
  return geometryCache.get(key);
}

export function mesh(geometry, material, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

export function roundedBox(w, h, d, r, material, segments = 3) {
  const radius = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const geo = cached(`rb:${w}:${h}:${d}:${radius}:${segments}`, () => new RoundedBoxGeometry(w, h, d, segments, radius));
  return mesh(geo, material);
}

export function box(w, h, d, material) {
  const geo = cached(`b:${w}:${h}:${d}`, () => new THREE.BoxGeometry(w, h, d));
  return mesh(geo, material);
}

export function cylinder(rTop, rBottom, h, material, segments = 32, open = false) {
  const geo = cached(`c:${rTop}:${rBottom}:${h}:${segments}:${open}`, () =>
    new THREE.CylinderGeometry(rTop, rBottom, h, segments, 1, open),
  );
  return mesh(geo, material);
}

// Orient a +y-aligned part along a local axis.
export function alongAxis(object, axis) {
  if (axis === "x") object.rotation.z = Math.PI / 2;
  if (axis === "z") object.rotation.x = Math.PI / 2;
  return object;
}

// ---- T-slot extrusion ------------------------------------------------------------

// Cross-section of an aluminium profile built from c×c cells (c = 40 mm series):
// a T-slot at every perimeter cell and a core bore in every cell.
function tSlotShape(cellsX, cellsY, cell = 0.04) {
  const w = cellsX * cell;
  const h = cellsY * cell;
  const slot = cell * 0.205; // slot opening
  const under = cell * 0.5; // undercut width
  const lip = cell * 0.11; // lip thickness
  const depth = cell * 0.31; // slot depth
  const chamfer = cell * 0.04;
  const shape = new THREE.Shape();

  // edge walker in a local frame: origin at a corner, u along the edge, v inward
  const points = [];
  const walkEdge = (origin, u, v, length, cells) => {
    const at = (a, b) => ({ x: origin.x + u.x * a + v.x * b, y: origin.y + u.y * a + v.y * b });
    points.push(at(chamfer, 0));
    for (let i = 0; i < cells; i += 1) {
      const c = (i + 0.5) * cell;
      points.push(at(c - slot / 2, 0));
      points.push(at(c - slot / 2, lip));
      points.push(at(c - under / 2, lip));
      points.push(at(c - under / 2 + cell * 0.08, depth));
      points.push(at(c + under / 2 - cell * 0.08, depth));
      points.push(at(c + under / 2, lip));
      points.push(at(c + slot / 2, lip));
      points.push(at(c + slot / 2, 0));
    }
    points.push(at(length - chamfer, 0));
  };
  const x0 = -w / 2;
  const y0 = -h / 2;
  walkEdge({ x: x0, y: y0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, w, cellsX);
  walkEdge({ x: -x0, y: y0 }, { x: 0, y: 1 }, { x: -1, y: 0 }, h, cellsY);
  walkEdge({ x: -x0, y: -y0 }, { x: -1, y: 0 }, { x: 0, y: -1 }, w, cellsX);
  walkEdge({ x: x0, y: -y0 }, { x: 0, y: -1 }, { x: 1, y: 0 }, h, cellsY);
  shape.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((p) => shape.lineTo(p.x, p.y));
  shape.closePath();

  for (let i = 0; i < cellsX; i += 1) {
    for (let j = 0; j < cellsY; j += 1) {
      const hole = new THREE.Path();
      hole.absarc(x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell, cell * 0.105, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  return shape;
}

/**
 * Aluminium extrusion of the given length along `axis` with a cellsA×cellsB section.
 * Section orientation: axis "x" → cellsA along z, cellsB along y;
 * axis "y" → cellsA along x, cellsB along z; axis "z" → cellsA along x, cellsB along y.
 */
export function extrusion(length, axis, cellsA, cellsB, material, cell = 0.04) {
  const geo = cached(`ext:${length}:${axis}:${cellsA}:${cellsB}:${cell}`, () => {
    const g = new THREE.ExtrudeGeometry(tSlotShape(cellsA, cellsB, cell), {
      depth: length,
      bevelEnabled: false,
      curveSegments: 6,
    });
    g.translate(0, 0, -length / 2);
    // default extrusion axis is z with section in x,y
    if (axis === "x") g.rotateY(Math.PI / 2);
    if (axis === "y") g.rotateX(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
  const m = mesh(geo, material);
  return m;
}

// End cap for an extrusion.
export function endCap(size, material) {
  return roundedBox(size, size, 0.004, 0.003, material);
}

// ---- linear guide -------------------------------------------------------------------

function railShape(width, height) {
  const s = new THREE.Shape();
  const w = width / 2;
  const g = height * 0.18; // groove depth
  s.moveTo(-w, 0);
  s.lineTo(w, 0);
  s.lineTo(w, height * 0.38);
  s.lineTo(w - g, height * 0.5);
  s.lineTo(w, height * 0.62);
  s.lineTo(w, height);
  s.lineTo(-w, height);
  s.lineTo(-w, height * 0.62);
  s.lineTo(-w + g, height * 0.5);
  s.lineTo(-w, height * 0.38);
  s.closePath();
  return s;
}

/** Profiled rail lying along `axis`, mounted on its base (base at local y = 0, top +y). */
export function linearRail(length, axis, material, width = 0.02, height = 0.018) {
  const geo = cached(`rail:${length}:${axis}:${width}:${height}`, () => {
    const g = new THREE.ExtrudeGeometry(railShape(width, height), { depth: length, bevelEnabled: false });
    g.translate(0, 0, -length / 2);
    if (axis === "x") g.rotateY(Math.PI / 2);
    g.computeVertexNormals();
    return g;
  });
  return mesh(geo, material);
}

/** Carriage block that rides a rail along `axis` (body above local y = 0). */
export function carriageBlock(axis, materials, width = 0.044, length = 0.065, height = 0.026) {
  const group = new THREE.Group();
  const along = axis === "x" ? [length, height, width] : [width, height, length];
  const body = roundedBox(along[0], along[1], along[2], 0.003, materials.carriage);
  body.position.y = height / 2 + 0.004;
  group.add(body);
  for (const sign of [-1, 1]) {
    const seal = roundedBox(
      axis === "x" ? 0.005 : width * 0.98,
      height * 0.92,
      axis === "x" ? width * 0.98 : 0.005,
      0.0015,
      materials.sealRed,
    );
    const offset = sign * (length / 2 + 0.0025);
    if (axis === "x") seal.position.set(offset, height / 2 + 0.004, 0);
    else seal.position.set(0, height / 2 + 0.004, offset);
    group.add(seal);
    // grease nipple
    if (sign > 0) {
      const nipple = cylinder(0.0025, 0.0025, 0.008, materials.chrome, 10);
      alongAxis(nipple, axis);
      if (axis === "x") nipple.position.set(offset + 0.006, height / 2 + 0.004, 0);
      else nipple.position.set(0, height / 2 + 0.004, offset + 0.006);
      group.add(nipple);
    }
  }
  return group;
}

// ---- motors & transmission ---------------------------------------------------------------

/** AC servo motor; output shaft along +y from the flange at y = 0. */
export function servoMotor(materials, size = 0.08, length = 0.16, accent = null) {
  const group = new THREE.Group();
  const flange = roundedBox(size, 0.012, size, 0.006, materials.aluminiumDark);
  flange.position.y = -0.006;
  group.add(flange);
  const body = roundedBox(size * 0.9, length, size * 0.9, 0.01, materials.motorBlack);
  body.position.y = -0.012 - length / 2;
  group.add(body);
  // cooling ribs
  for (let i = 0; i < 5; i += 1) {
    const rib = roundedBox(size * 0.94, 0.004, size * 0.94, 0.002, materials.motorBlack);
    rib.position.y = -0.03 - i * (length * 0.14);
    group.add(rib);
  }
  const encoder = roundedBox(size * 0.82, length * 0.22, size * 0.82, 0.012, materials.plasticBlack);
  encoder.position.y = -0.012 - length - length * 0.11;
  group.add(encoder);
  const label = box(0.0015, length * 0.4, size * 0.5, materials.motorLabel);
  label.position.set(size * 0.455, -0.012 - length * 0.45, 0);
  group.add(label);
  for (const [dz, len] of [[-0.016, 0.03], [0.016, 0.024]]) {
    const connector = roundedBox(0.026, len, 0.022, 0.004, materials.plasticBlack);
    connector.position.set(size * 0.35, -0.012 - length * 0.8, dz);
    connector.rotation.z = Math.PI / 2;
    group.add(connector);
  }
  const shaft = cylinder(size * 0.1, size * 0.1, 0.03, materials.chrome, 16);
  shaft.position.y = 0.015;
  group.add(shaft);
  if (accent) {
    const ring = cylinder(size * 0.47, size * 0.47, 0.004, accent, 32);
    ring.position.y = -0.012 - length + 0.002;
    ring.scale.set(1, 1, 1);
    group.add(ring);
  }
  return group;
}

export function timingPulley(radius, width, materials) {
  const group = new THREE.Group();
  const hub = cylinder(radius, radius, width, materials.aluminium, 28);
  group.add(hub);
  for (const s of [-1, 1]) {
    const flange = cylinder(radius * 1.18, radius * 1.18, 0.002, materials.aluminium, 28);
    flange.position.y = (s * width) / 2;
    group.add(flange);
  }
  const bore = cylinder(radius * 0.3, radius * 0.3, width * 1.05, materials.steelDark, 12);
  group.add(bore);
  return group;
}

export function bolt(materials, length = 0.012, radius = 0.003) {
  const head = cylinder(radius * 1.6, radius * 1.6, radius * 1.2, materials.steelDark, 6);
  head.position.y = radius * 0.6;
  const group = new THREE.Group();
  group.add(head);
  return group;
}

// ---- cable carrier (energy chain) ---------------------------------------------------------

const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const Z_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * Energy chain whose fixed end sits at `fixed` and whose moving end follows a
 * carriage along `axis`. Links are laid along: lower run → 180° bend → upper run.
 */
export class CableCarrier {
  constructor({ length, bendRadius, linkPitch = 0.028, width = 0.05, height = 0.022, material, axis = "z" }) {
    this.length = length;
    this.bendRadius = bendRadius;
    this.axis = axis;
    this.count = Math.floor(length / linkPitch);
    this.pitch = length / this.count;
    const geo = new RoundedBoxGeometry(linkPitch * 0.94, height, width, 2, 0.003);
    this.mesh = new THREE.InstancedMesh(geo, material, this.count);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.dummy = new THREE.Object3D();
    this.qBase = new THREE.Quaternion().setFromAxisAngle(Y_AXIS, -Math.PI / 2);
    this.qBend = new THREE.Quaternion();
  }

  /**
   * fixed: position (along axis) of the fixed end on the lower run,
   * moving: position of the carriage end on the upper run; the chain bends
   * towards +axis.
   */
  update(fixed, moving, baseY = 0) {
    const R = this.bendRadius;
    const straight = this.length - Math.PI * R;
    const bend = (straight + fixed + moving) / 2; // where the arc starts
    const lower = bend - fixed;
    for (let i = 0; i < this.count; i += 1) {
      const s = (i + 0.5) * this.pitch;
      let a;
      let y;
      let angle;
      if (s < lower) {
        a = fixed + s;
        y = baseY;
        angle = 0;
      } else if (s < lower + Math.PI * R) {
        const phi = (s - lower) / R;
        a = bend + R * Math.sin(phi);
        y = baseY + R - R * Math.cos(phi);
        angle = phi;
      } else {
        a = bend - (s - lower - Math.PI * R);
        y = baseY + 2 * R;
        angle = Math.PI;
      }
      if (this.axis === "z") {
        this.dummy.position.set(0, y, a);
        this.qBend.setFromAxisAngle(X_AXIS, -angle);
        this.dummy.quaternion.copy(this.qBend).multiply(this.qBase);
      } else {
        this.dummy.position.set(a, y, 0);
        this.dummy.quaternion.setFromAxisAngle(Z_AXIS, angle);
      }
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
