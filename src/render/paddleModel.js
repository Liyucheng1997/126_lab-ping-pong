// Table tennis bat: 5-ply blade outline, 2 mm inverted rubbers (red forehand
// facing −x, black backhand facing +x), flared handle. Pivot at the origin,
// blade centre at +y = handleOffset; the blade plane is the local y–z plane.

import * as THREE from "three";
import { PADDLE } from "../sim/constants.js";
import { GANTRY } from "../sim/robot.js";
import { mesh } from "./parts.js";

function bladeOutline(scale = 1) {
  // ellipse head flowing into the throat of the handle
  const a = PADDLE.halfHeight * scale; // along y
  const b = PADDLE.halfWidth * scale; // along z
  const shape = new THREE.Shape();
  const throat = 0.017 * scale;
  const startAngle = -Math.PI / 2 + Math.asin(throat / b);
  const endAngle = (3 * Math.PI) / 2 - Math.asin(throat / b);
  const steps = 72;
  for (let i = 0; i <= steps; i += 1) {
    const t = startAngle + ((endAngle - startAngle) * i) / steps;
    const x = Math.cos(t) * b;
    const y = Math.sin(t) * a;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  // throat down into the handle
  shape.lineTo(-throat, -a - 0.012 * scale);
  shape.lineTo(throat, -a - 0.012 * scale);
  shape.closePath();
  return shape;
}

function headOutline(inset = 0) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, PADDLE.halfWidth - inset, PADDLE.halfHeight - inset, 0, Math.PI * 2, false, 0);
  return shape;
}

export function buildPaddle(materials, { ghost = false } = {}) {
  const group = new THREE.Group();
  const holder = new THREE.Group();
  // shapes are drawn in (z, y); rotate so their extrusion axis becomes x
  holder.rotation.y = Math.PI / 2;
  holder.position.y = GANTRY.handleOffset;
  group.add(holder);

  const bladeThickness = 0.0058;
  const rubber = 0.0021;
  const blade = mesh(
    new THREE.ExtrudeGeometry(bladeOutline(), {
      depth: bladeThickness,
      bevelEnabled: true,
      bevelThickness: 0.0004,
      bevelSize: 0.0006,
      bevelSegments: 2,
      curveSegments: 48,
    }),
    ghost ? materials.ghost : materials.wood,
  );
  blade.geometry.translate(0, 0, -bladeThickness / 2);
  holder.add(blade);

  const rubberGeo = new THREE.ExtrudeGeometry(headOutline(0.0008), {
    depth: rubber,
    bevelEnabled: true,
    bevelThickness: 0.0004,
    bevelSize: 0.0005,
    bevelSegments: 2,
    curveSegments: 64,
  });
  // the holder's +z maps to the group's +x: the forehand (red) sheet sits on
  // holder −z so it faces the net (−x), the backhand (black) sheet on +z
  const forehand = mesh(rubberGeo, ghost ? materials.ghost : materials.rubberRed);
  forehand.position.z = -bladeThickness / 2 - rubber;
  holder.add(forehand);
  const backhand = mesh(rubberGeo, ghost ? materials.ghost : materials.rubberBlack);
  backhand.position.z = bladeThickness / 2;
  holder.add(backhand);

  // flared handle (lathe profile), along −y from the throat
  if (!ghost) {
    const profile = [
      [0.0, -0.105],
      [0.016, -0.105],
      [0.017, -0.095],
      [0.0145, -0.06],
      [0.0135, -0.03],
      [0.0145, -0.002],
      [0.0, -0.002],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const handle = mesh(new THREE.LatheGeometry(profile, 24), materials.woodHandle);
    handle.scale.set(1, 1, 0.72);
    handle.position.y = -PADDLE.halfHeight - 0.004;
    holder.add(handle);
  }
  return group;
}
