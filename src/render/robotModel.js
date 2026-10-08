// Mechanical model of the 5-axis gantry robot. The kinematic chain mirrors
// src/sim/robot.js exactly so the rendered blade sits where the simulator
// says it is:
//
//   portal (fixed) ─ lateral carriage (z = q0) ─ vertical carriage (y = q1)
//     ─ stroke forcer (x = q2) ─ wrist pivot (−armLength, −wristDrop, 0)
//       ─ yaw (about y, q3) ─ pitch (about z, q4) ─ blade
//
// Everything is built from T-slot extrusions, profiled rails with carriage
// blocks, AC servos, a timing belt, a ball screw, a linear motor stage and
// energy chains, plus the stereo camera mast, control cabinet and serve feeder.

import * as THREE from "three";
import { TABLE } from "../sim/constants.js";
import { CAMERA_MOUNT } from "../sim/agent.js";
import { GANTRY, SERVE_FEEDER } from "../sim/robot.js";
import { emissive } from "./materials.js";
import { buildPaddle } from "./paddleModel.js";
import {
  alongAxis,
  box,
  CableCarrier,
  carriageBlock,
  cylinder,
  extrusion,
  linearRail,
  roundedBox,
  servoMotor,
  timingPulley,
} from "./parts.js";

const PORTAL_Z = GANTRY.portalHalfWidth;
const BEAM_Y = 2.0; // top beam centre (80 × 160 profile)
const BEAM_FRONT = -0.04;
const COLUMN_X = -0.15;
const COLUMN_FRONT = COLUMN_X - 0.04;
const VCARRIAGE_X = COLUMN_FRONT - 0.018 - 0.03;
const STROKE_BEAM_Y = 0.245; // rails clear the top of the blade below
const STROKE_BEAM = { from: -0.232, to: -0.985 };
const FORCER_OFFSET = -0.4;

export class RobotModel {
  constructor({ side, accent, materials }) {
    this.side = side;
    this.materials = materials;
    this.accent = new THREE.Color(accent);
    this.accentMat = new THREE.MeshStandardMaterial({
      color: this.accent,
      roughness: 0.35,
      metalness: 0.4,
      emissive: this.accent,
      emissiveIntensity: 0.35,
    });
    this.root = new THREE.Group();
    this.root.name = side < 0 ? "left-robot" : "right-robot";
    this.root.position.set(side * GANTRY.baseDistance, 0, 0);
    this.root.rotation.y = side > 0 ? 0 : Math.PI;

    this.lateral = new THREE.Group();
    this.vertical = new THREE.Group();
    this.stroke = new THREE.Group();
    this.wrist = new THREE.Group();
    this.yaw = new THREE.Group();
    this.pitch = new THREE.Group();

    this.buildPortal();
    this.buildLateralAxis();
    this.buildVerticalAxis();
    this.buildStrokeAxis();
    this.buildWrist();
    this.buildCameraMast();
    this.buildCabinet();
    this.buildFeeder();
  }

  // ---- fixed portal ------------------------------------------------------------------

  buildPortal() {
    const m = this.materials;
    const g = this.root;
    const uprightH = BEAM_Y - 0.08;
    for (const z of [-PORTAL_Z, PORTAL_Z]) {
      const upright = extrusion(uprightH, "y", 2, 2, m.aluminium);
      upright.position.set(0, uprightH / 2 + 0.02, z);
      g.add(upright);
      // base plate with levelling feet and anchors
      const plate = roundedBox(0.34, 0.02, 0.26, 0.01, m.steelPainted);
      plate.position.set(0.04, 0.01, z);
      g.add(plate);
      for (const dx of [-0.13, 0.17]) {
        for (const dz of [-0.1, 0.1]) {
          const foot = cylinder(0.018, 0.022, 0.012, m.rubberFoot, 16);
          foot.position.set(dx, 0.006, z + dz);
          g.add(foot);
          const nut = cylinder(0.008, 0.008, 0.012, m.chrome, 6);
          nut.position.set(dx, 0.026, z + dz);
          g.add(nut);
        }
      }
      // rear brace (A-frame in side view)
      const from = new THREE.Vector3(0.04, 1.35, z);
      const to = new THREE.Vector3(0.78, 0.04, z);
      g.add(this.diagonal(from, to, m.aluminium));
      const rearFoot = roundedBox(0.16, 0.02, 0.12, 0.008, m.steelPainted);
      rearFoot.position.set(0.8, 0.01, z);
      g.add(rearFoot);
      // corner gussets at the beam joint
      for (const dx of [-1, 1]) {
        const gusset = roundedBox(0.006, 0.1, 0.1, 0.004, m.aluminiumDark);
        gusset.position.set(dx * 0.043, BEAM_Y - 0.13, z - Math.sign(z) * 0.06);
        g.add(gusset);
      }
      // e-stop on the upright facing the operator side
      if (z < 0) {
        const housing = roundedBox(0.07, 0.07, 0.06, 0.008, new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5 }));
        housing.position.set(0.075, 1.25, z);
        g.add(housing);
        const button = cylinder(0.026, 0.022, 0.025, new THREE.MeshStandardMaterial({ color: 0xc81e1e, roughness: 0.4 }), 24);
        alongAxis(button, "x");
        button.position.set(0.118, 1.25, z);
        g.add(button);
      }
    }
    // floor tie between the uprights and between the rear feet
    for (const x of [0.04, 0.78]) {
      const tie = extrusion(PORTAL_Z * 2 - 0.08, "z", 2, 1, m.aluminium);
      tie.position.set(x, 0.04, 0);
      g.add(tie);
    }

    // top beam 80 × 160
    const beam = extrusion(PORTAL_Z * 2 + 0.16, "z", 2, 4, m.aluminium);
    beam.position.set(0, BEAM_Y, 0);
    g.add(beam);
    for (const z of [-1, 1]) {
      const cap = roundedBox(0.082, 0.162, 0.006, 0.004, m.plasticBlack);
      cap.position.set(0, BEAM_Y, z * (PORTAL_Z + 0.083));
      g.add(cap);
    }
    // lateral guide rails on the front face
    for (const y of [BEAM_Y + 0.052, BEAM_Y - 0.052]) {
      const rail = linearRail(PORTAL_Z * 2 - 0.1, "z", m.railSteel);
      rail.rotation.z = Math.PI / 2;
      rail.position.set(BEAM_FRONT, y, 0);
      g.add(rail);
    }

    // belt drive: servo at +z end, idler at −z end, belt runs above the rails
    // shaft along −x into the gearbox, body sticking out behind the beam
    const motor = servoMotor(m, 0.09, 0.17, this.accentMat);
    motor.rotation.set(0, 0, Math.PI / 2);
    motor.position.set(0.06, BEAM_Y + 0.115, PORTAL_Z - 0.05);
    g.add(motor);
    const gearbox = roundedBox(0.09, 0.09, 0.09, 0.01, m.aluminiumDark);
    gearbox.position.set(0.0, BEAM_Y + 0.115, PORTAL_Z - 0.05);
    g.add(gearbox);
    for (const z of [PORTAL_Z - 0.05, -PORTAL_Z + 0.05]) {
      const pulley = timingPulley(0.028, 0.03, m);
      alongAxis(pulley, "x");
      pulley.position.set(BEAM_FRONT - 0.02, BEAM_Y + 0.115, z);
      g.add(pulley);
      const bracket = roundedBox(0.05, 0.08, 0.05, 0.006, m.aluminiumDark);
      bracket.position.set(BEAM_FRONT - 0.02, BEAM_Y + 0.115, z + Math.sign(z) * 0.045);
      g.add(bracket);
    }
    this.beltUpper = box(0.012, 0.003, 1, m.beltRubber);
    this.beltUpper.position.set(BEAM_FRONT - 0.02, BEAM_Y + 0.144, 0);
    g.add(this.beltUpper);
    this.beltLowerA = box(0.012, 0.003, 1, m.beltRubber);
    this.beltLowerB = box(0.012, 0.003, 1, m.beltRubber);
    g.add(this.beltLowerA, this.beltLowerB);

    // cable tray on top of the beam + lateral energy chain
    const tray = roundedBox(0.07, 0.006, PORTAL_Z * 2, 0.002, m.aluminiumDark);
    tray.position.set(0.0, BEAM_Y + 0.083, 0);
    g.add(tray);
    this.lateralChain = new CableCarrier({ length: 1.75, bendRadius: 0.055, material: m.plasticBlack, axis: "z", width: 0.045 });
    this.lateralChain.mesh.position.set(0.0, BEAM_Y + 0.098, 0);
    g.add(this.lateralChain.mesh);

    // stack light on top of the −z upright
    this.stack = this.buildStackLight();
    this.stack.position.set(0, BEAM_Y + 0.08, -PORTAL_Z - 0.0);
    g.add(this.stack);

    g.add(this.lateral);
  }

  diagonal(from, to, material) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const len = dir.length();
    const bar = extrusion(len, "y", 1, 1, material);
    bar.position.copy(from).addScaledVector(dir, 0.5);
    bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return bar;
  }

  buildStackLight() {
    const g = new THREE.Group();
    const base = cylinder(0.03, 0.034, 0.03, this.materials.plasticBlack, 20);
    base.position.y = 0.015;
    g.add(base);
    this.lamps = {};
    const colours = { green: 0x23d160, amber: 0xffb020, red: 0xff3030 };
    let y = 0.035;
    for (const [name, color] of Object.entries(colours)) {
      const mat = new THREE.MeshStandardMaterial({
        color,
        transparent: true,
        opacity: 0.85,
        roughness: 0.25,
        emissive: new THREE.Color(color),
        emissiveIntensity: 0.05,
      });
      const lamp = cylinder(0.028, 0.028, 0.045, mat, 20);
      lamp.position.y = y + 0.0225;
      g.add(lamp);
      this.lamps[name] = mat;
      y += 0.048;
    }
    const cap = cylinder(0.026, 0.028, 0.012, this.materials.plasticBlack, 20);
    cap.position.y = y + 0.006;
    g.add(cap);
    return g;
  }

  // ---- lateral axis (belt drive) ------------------------------------------------------

  buildLateralAxis() {
    const m = this.materials;
    const g = this.lateral;
    for (const y of [BEAM_Y + 0.052, BEAM_Y - 0.052]) {
      for (const dz of [-0.075, 0.075]) {
        const block = carriageBlock("z", m);
        block.rotation.z = Math.PI / 2;
        block.position.set(BEAM_FRONT - 0.018, y, dz);
        g.add(block);
      }
    }
    const plate = roundedBox(0.016, 0.24, 0.26, 0.006, m.aluminiumDark);
    plate.position.set(BEAM_FRONT - 0.018 - 0.034, BEAM_Y, 0);
    g.add(plate);
    const stripe = box(0.002, 0.012, 0.22, this.accentMat);
    stripe.position.set(BEAM_FRONT - 0.018 - 0.043, BEAM_Y + 0.1, 0);
    g.add(stripe);
    const clamp = roundedBox(0.03, 0.03, 0.08, 0.004, m.aluminium);
    clamp.position.set(BEAM_FRONT - 0.02, BEAM_Y + 0.135, 0);
    g.add(clamp);
    // chain bracket
    const chainArm = roundedBox(0.05, 0.12, 0.02, 0.004, m.aluminiumDark);
    chainArm.position.set(0.0, BEAM_Y + 0.18, 0);
    g.add(chainArm);

    // hanging column for the vertical axis
    const colTop = BEAM_Y + 0.06;
    const colBottom = 0.5;
    const column = extrusion(colTop - colBottom, "y", 2, 2, m.aluminium);
    column.position.set(COLUMN_X, (colTop + colBottom) / 2, 0);
    g.add(column);
    const capBottom = roundedBox(0.082, 0.006, 0.082, 0.003, m.plasticBlack);
    capBottom.position.set(COLUMN_X, colBottom - 0.003, 0);
    g.add(capBottom);
    for (const z of [-0.022, 0.022]) {
      // rail base on the column's front face, top towards −x
      const rail = alongVertical(linearRail(colTop - colBottom - 0.12, "x", m.railSteel, 0.015, 0.014));
      rail.position.set(COLUMN_FRONT, (colTop + colBottom) / 2, z);
      g.add(rail);
    }
    // ball screw beside the column, servo on top
    const screwLen = colTop - colBottom - 0.06;
    const screw = cylinder(0.008, 0.008, screwLen, m.chrome, 16);
    screw.position.set(COLUMN_X, (colTop + colBottom) / 2, 0.064);
    g.add(screw);
    this.screwThread = screw;
    for (const y of [colBottom + 0.03, colTop - 0.02]) {
      const support = roundedBox(0.05, 0.035, 0.04, 0.005, m.aluminiumDark);
      support.position.set(COLUMN_X, y, 0.064);
      g.add(support);
    }
    const vMotor = servoMotor(m, 0.07, 0.14, this.accentMat);
    vMotor.rotation.x = Math.PI; // shaft down into the coupling
    vMotor.position.set(COLUMN_X, colTop + 0.07, 0.064);
    g.add(vMotor);
    const coupling = cylinder(0.016, 0.016, 0.045, m.aluminium, 16);
    coupling.position.set(COLUMN_X, colTop + 0.03, 0.064);
    g.add(coupling);

    // vertical energy chain (axis mapped to +y, bending towards +z)
    this.verticalChain = new CableCarrier({ length: 1.45, bendRadius: 0.045, material: m.plasticBlack, axis: "x", width: 0.035, height: 0.018 });
    const chainFrame = new THREE.Group();
    chainFrame.quaternion.setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)),
    );
    chainFrame.position.set(COLUMN_X + 0.005, 0, 0.1);
    chainFrame.add(this.verticalChain.mesh);
    g.add(chainFrame);

    g.add(this.vertical);
  }

  // ---- vertical carriage + stroke stage -------------------------------------------------------

  buildVerticalAxis() {
    const m = this.materials;
    const g = this.vertical;
    for (const z of [-0.022, 0.022]) {
      for (const dy of [-0.05, 0.05]) {
        const block = alongVertical(carriageBlock("x", m, 0.034, 0.05, 0.02));
        block.position.set(COLUMN_FRONT - 0.014, dy, z);
        g.add(block);
      }
    }
    const plate = roundedBox(0.014, 0.24, 0.14, 0.005, m.aluminiumDark);
    plate.position.set(VCARRIAGE_X, 0.02, 0);
    g.add(plate);
    const nut = roundedBox(0.05, 0.05, 0.05, 0.006, m.aluminium);
    nut.position.set(COLUMN_X, 0, 0.064);
    g.add(nut);
    const nutArm = box(0.07, 0.03, 0.02, m.aluminiumDark);
    nutArm.position.set(COLUMN_X - 0.04, 0, 0.05);
    g.add(nutArm);
    const chainArm = roundedBox(0.03, 0.04, 0.06, 0.004, m.aluminiumDark);
    chainArm.position.set(COLUMN_X, 0.06, 0.12);
    g.add(chainArm);

    // stroke stage: profile cantilevered towards the table, magnet track below
    const len = STROKE_BEAM.from - STROKE_BEAM.to;
    const centre = (STROKE_BEAM.from + STROKE_BEAM.to) / 2;
    const beam = extrusion(len, "x", 1, 2, m.aluminium);
    beam.position.set(centre, STROKE_BEAM_Y + 0.04, 0);
    g.add(beam);
    const track = roundedBox(len - 0.04, 0.012, 0.05, 0.003, m.steelDark);
    track.position.set(centre, STROKE_BEAM_Y - 0.006, 0);
    g.add(track);
    for (const z of [-0.026, 0.026]) {
      const rail = linearRail(len - 0.03, "x", m.railSteel, 0.012, 0.011);
      rail.rotation.x = Math.PI; // hanging under the beam
      rail.position.set(centre, STROKE_BEAM_Y, z);
      g.add(rail);
    }
    const endStop = roundedBox(0.02, 0.06, 0.07, 0.004, m.plasticBlack);
    endStop.position.set(STROKE_BEAM.to + 0.01, STROKE_BEAM_Y + 0.0, 0);
    g.add(endStop);
    // knee brackets tying the stage to the carriage plate
    for (const z of [-0.055, 0.055]) {
      const knee = new THREE.Mesh(kneeGeometry(), m.aluminiumDark);
      knee.castShadow = true;
      knee.position.set(VCARRIAGE_X - 0.007, STROKE_BEAM_Y - 0.0, z);
      g.add(knee);
    }
    // linear encoder strip
    const scale = box(len - 0.06, 0.004, 0.006, m.chrome);
    scale.position.set(centre, STROKE_BEAM_Y + 0.04, 0.044);
    g.add(scale);

    g.add(this.stroke);
  }

  buildStrokeAxis() {
    const m = this.materials;
    const g = this.stroke;
    const forcer = roundedBox(0.12, 0.03, 0.09, 0.006, m.carriage);
    forcer.position.set(FORCER_OFFSET, STROKE_BEAM_Y - 0.03, 0);
    g.add(forcer);
    const cover = roundedBox(0.11, 0.008, 0.08, 0.003, this.accentMat);
    cover.position.set(FORCER_OFFSET, STROKE_BEAM_Y - 0.048, 0);
    g.add(cover);
    // forearm: carbon tube from the forcer down to the wrist housing
    const start = new THREE.Vector3(FORCER_OFFSET - 0.02, STROKE_BEAM_Y - 0.05, 0);
    const end = new THREE.Vector3(-GANTRY.armLength + 0.035, -GANTRY.wristDrop + 0.0, 0);
    const dir = new THREE.Vector3().subVectors(end, start);
    const tube = cylinder(0.019, 0.019, dir.length(), m.carbon, 24);
    tube.position.copy(start).addScaledVector(dir, 0.5);
    tube.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
    g.add(tube);
    const brace = cylinder(0.008, 0.008, 0.2, m.carbon, 12);
    const bStart = new THREE.Vector3(FORCER_OFFSET + 0.04, STROKE_BEAM_Y - 0.045, 0);
    const bEnd = start.clone().addScaledVector(dir, 0.55);
    const bDir = new THREE.Vector3().subVectors(bEnd, bStart);
    brace.scale.y = bDir.length() / 0.2;
    brace.position.copy(bStart).addScaledVector(bDir, 0.5);
    brace.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), bDir.normalize());
    g.add(brace);
    const clampA = roundedBox(0.05, 0.05, 0.05, 0.008, m.aluminiumDark);
    clampA.position.copy(start);
    g.add(clampA);

    this.wrist.position.set(-GANTRY.armLength, -GANTRY.wristDrop, 0);
    g.add(this.wrist);
  }

  buildWrist() {
    const m = this.materials;
    // yaw drive below the pivot, output up
    const yawMotor = cylinder(0.03, 0.03, 0.085, m.motorBlack, 28);
    yawMotor.position.set(0, -0.07, 0);
    this.wrist.add(yawMotor);
    const yawRing = cylinder(0.031, 0.031, 0.006, this.accentMat, 28);
    yawRing.position.set(0, -0.03, 0);
    this.wrist.add(yawRing);
    const housing = roundedBox(0.075, 0.03, 0.07, 0.008, m.aluminiumDark);
    housing.position.set(0.02, -0.033, 0);
    this.wrist.add(housing);

    this.wrist.add(this.yaw);
    // fork carrying the pitch drive
    const fork = roundedBox(0.05, 0.012, 0.11, 0.004, m.aluminium);
    fork.position.set(0, -0.012, 0.025);
    this.yaw.add(fork);
    const pitchMotor = cylinder(0.024, 0.024, 0.07, m.motorBlack, 24);
    alongAxis(pitchMotor, "z");
    pitchMotor.position.set(0, 0, 0.075);
    this.yaw.add(pitchMotor);
    const pitchRing = cylinder(0.025, 0.025, 0.005, this.accentMat, 24);
    alongAxis(pitchRing, "z");
    pitchRing.position.set(0, 0, 0.04);
    this.yaw.add(pitchRing);

    this.yaw.add(this.pitch);
    const hub = cylinder(0.018, 0.018, 0.03, m.aluminium, 20);
    alongAxis(hub, "z");
    hub.position.set(0, 0, 0.025);
    this.pitch.add(hub);
    const clamp = roundedBox(0.03, 0.04, 0.036, 0.006, m.aluminiumDark);
    clamp.position.set(0, 0.01, 0);
    this.pitch.add(clamp);
    this.paddle = buildPaddle(m);
    this.pitch.add(this.paddle);
  }

  // ---- peripherals ---------------------------------------------------------------------

  buildCameraMast() {
    const m = this.materials;
    const g = this.root;
    const mast = CAMERA_MOUNT;
    for (const z of [-0.62, 0.62]) {
      const arm = extrusion(mast.x + 0.06, "x", 1, 1, m.aluminium);
      arm.position.set((mast.x + 0.06) / 2 - 0.02, BEAM_Y + 0.1, z);
      g.add(arm);
      const post = extrusion(mast.y - BEAM_Y - 0.08, "y", 1, 1, m.aluminium);
      post.position.set(mast.x, (mast.y + BEAM_Y + 0.12) / 2 - 0.02, z);
      g.add(post);
    }
    const bar = extrusion(1.32, "z", 1, 1, m.aluminium);
    bar.position.set(mast.x, mast.y + 0.02, 0);
    g.add(bar);

    this.cameraBodies = [];
    for (const sign of [-1, 1]) {
      const cam = new THREE.Group();
      const body = roundedBox(0.058, 0.058, 0.075, 0.006, m.plasticWhite);
      cam.add(body);
      const lensBarrel = cylinder(0.022, 0.022, 0.06, m.motorBlack, 24);
      alongAxis(lensBarrel, "z");
      lensBarrel.position.z = 0.068;
      cam.add(lensBarrel);
      for (const zz of [0.05, 0.08]) {
        const ring = cylinder(0.0235, 0.0235, 0.006, m.aluminium, 24);
        alongAxis(ring, "z");
        ring.position.z = zz;
        cam.add(ring);
      }
      const glass = cylinder(0.017, 0.017, 0.002, m.glassLens, 24);
      alongAxis(glass, "z");
      glass.position.z = 0.099;
      cam.add(glass);
      const led = box(0.008, 0.004, 0.002, emissive(this.accent, 3));
      led.position.set(0.018, 0.022, 0.0385);
      cam.add(led);
      const cable = cylinder(0.005, 0.005, 0.12, m.cableGrey, 8);
      cable.rotation.x = Math.PI / 2;
      cable.position.set(0, 0, -0.09);
      cam.add(cable);
      const ballHead = cylinder(0.012, 0.012, 0.04, m.steelDark, 12);
      ballHead.position.set(0, -0.045, 0);
      cam.add(ballHead);
      cam.position.set(mast.x, mast.y - 0.065, sign * mast.halfBaseline);
      g.add(cam);
      this.cameraBodies.push(cam);
    }
  }

  aimCameras() {
    // lookAt needs world matrices: run once after the root is in the scene
    this.root.updateMatrixWorld(true);
    const mast = CAMERA_MOUNT;
    for (const cam of this.cameraBodies) {
      const target = this.root.localToWorld(new THREE.Vector3(mast.target.x, mast.target.y, mast.target.z));
      cam.lookAt(target);
    }
  }

  buildCabinet() {
    const m = this.materials;
    const g = new THREE.Group();
    const body = roundedBox(0.6, 1.25, 0.42, 0.012, m.cabinet);
    body.position.y = 0.625 + 0.08;
    g.add(body);
    const plinth = box(0.6, 0.08, 0.4, m.steelDark);
    plinth.position.y = 0.04;
    g.add(plinth);
    const door = roundedBox(0.54, 1.15, 0.01, 0.006, m.cabinet);
    door.position.set(0, 0.705, -0.215);
    g.add(door);
    const handle = roundedBox(0.02, 0.14, 0.02, 0.005, m.chrome);
    handle.position.set(0.22, 0.75, -0.228);
    g.add(handle);
    for (let i = 0; i < 6; i += 1) {
      const vent = box(0.18, 0.006, 0.004, m.steelDark);
      vent.position.set(-0.14, 0.22 + i * 0.022, -0.222);
      g.add(vent);
    }
    // HMI panel + status display
    this.hmiCanvas = document.createElement("canvas");
    this.hmiCanvas.width = 256;
    this.hmiCanvas.height = 160;
    this.hmiTexture = new THREE.CanvasTexture(this.hmiCanvas);
    this.hmiTexture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.25, 0.156),
      new THREE.MeshBasicMaterial({ map: this.hmiTexture, toneMapped: false }),
    );
    screen.position.set(-0.05, 1.05, -0.222);
    screen.rotation.y = Math.PI;
    g.add(screen);
    const bezel = roundedBox(0.28, 0.185, 0.012, 0.006, m.plasticBlack);
    bezel.position.set(-0.05, 1.05, -0.216);
    g.add(bezel);
    const key = cylinder(0.015, 0.015, 0.02, m.chrome, 16);
    alongAxis(key, "z");
    key.position.set(0.17, 1.05, -0.228);
    g.add(key);
    // cable conduit to the portal
    const conduit = cylinder(0.025, 0.025, 1.0, m.cableGrey, 12);
    conduit.rotation.x = Math.PI / 2;
    conduit.position.set(0, 0.03, 0.7);
    g.add(conduit);
    g.position.set(0.85, 0, -PORTAL_Z - 0.55);
    g.rotation.y = Math.PI / 2 + Math.PI;
    this.root.add(g);
    this.drawHmi("BOOT", 0, 0);
  }

  drawHmi(mode, rate, spinEst) {
    const ctx = this.hmiCanvas.getContext("2d");
    ctx.fillStyle = "#06121d";
    ctx.fillRect(0, 0, 256, 160);
    ctx.fillStyle = `#${this.accent.getHexString()}`;
    ctx.fillRect(0, 0, 256, 22);
    ctx.fillStyle = "#03070b";
    ctx.font = "bold 14px Consolas, monospace";
    ctx.fillText(this.side < 0 ? "ROBOT L · CTRL" : "ROBOT R · CTRL", 8, 16);
    ctx.fillStyle = "#cfe8ff";
    ctx.font = "bold 26px Consolas, monospace";
    ctx.fillText(mode, 10, 62);
    ctx.font = "14px Consolas, monospace";
    ctx.fillStyle = "#7fa3c0";
    ctx.fillText(`servo 1 kHz  cam ${rate} fps`, 10, 96);
    ctx.fillText(`spin est ${spinEst.toFixed(0)} rpm`, 10, 118);
    ctx.fillText("EtherCAT  OK", 10, 140);
    this.hmiTexture.needsUpdate = true;
  }

  buildFeeder() {
    const m = this.materials;
    const g = new THREE.Group();
    const base = cylinder(0.12, 0.13, 0.02, m.steelDark, 32);
    base.position.y = 0.01;
    g.add(base);
    const column = cylinder(0.022, 0.022, TABLE.height - 0.1, m.aluminium, 20);
    column.position.y = (TABLE.height - 0.1) / 2 + 0.02;
    g.add(column);
    const head = cylinder(0.034, 0.03, 0.08, m.plasticBlack, 24);
    head.position.y = TABLE.height - 0.04;
    g.add(head);
    const ring = cylinder(0.035, 0.035, 0.006, this.accentMat, 24);
    ring.position.y = TABLE.height - 0.004;
    g.add(ring);
    // magazine tube with spare balls
    const tube = cylinder(0.024, 0.024, 0.32, new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      transmission: 0.9,
      transparent: true,
      opacity: 0.35,
      roughness: 0.05,
    }), 20, true);
    tube.position.set(0.07, TABLE.height - 0.05, 0);
    tube.rotation.z = -0.5;
    g.add(tube);
    for (let i = 0; i < 4; i += 1) {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02, 20, 14), m.ball);
      ball.position.set(0.07 + Math.sin(0.5) * (i * 0.041 - 0.06), TABLE.height - 0.05 + Math.cos(0.5) * (i * 0.041 - 0.06), 0);
      g.add(ball);
    }
    g.position.set(SERVE_FEEDER.x, 0, SERVE_FEEDER.z);
    this.root.add(g);
  }

  // ---- animation ----------------------------------------------------------------------

  update(q, telemetry) {
    const [lateral, vertical, stroke, yaw, pitch] = q;
    this.lateral.position.z = lateral;
    this.vertical.position.y = vertical;
    this.stroke.position.x = stroke;
    this.yaw.rotation.y = yaw;
    this.pitch.rotation.z = pitch;

    // belt: upper run fixed, lower run split at the carriage clamp
    const zMax = PORTAL_Z - 0.05;
    const zMin = -PORTAL_Z + 0.05;
    this.beltUpper.scale.z = zMax - zMin;
    const y = BEAM_Y + 0.086;
    const x = BEAM_FRONT - 0.02;
    const aLen = Math.max(0.001, lateral - 0.04 - zMin);
    const bLen = Math.max(0.001, zMax - lateral - 0.04);
    this.beltLowerA.scale.z = aLen;
    this.beltLowerA.position.set(x, y, zMin + aLen / 2);
    this.beltLowerB.scale.z = bLen;
    this.beltLowerB.position.set(x, y, zMax - bLen / 2);

    this.lateralChain.update(-0.25, lateral - 0.0, 0);
    this.verticalChain.update(1.15, vertical + 0.06, 0);
    this.screwThread.rotation.y = vertical * 120;

    if (telemetry) {
      const mode = telemetry.mode;
      const active = mode === "STRIKE" || mode === "SERVE" || mode === "FOLLOW";
      this.lamps.green.emissiveIntensity = active ? 0.15 : 2.4;
      this.lamps.amber.emissiveIntensity = active ? 3.2 : mode === "TRACKING" ? 1.6 : 0.05;
      this.lamps.red.emissiveIntensity = 0.05;
    }
  }
}

// Turn a part that was modelled lying along x into a vertical (y) part while
// keeping its "up" pointing towards −x (onto a front face).
function alongVertical(object) {
  object.rotation.set(0, 0, 0);
  const q = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(
      new THREE.Vector3(0, 1, 0), // part x (length) → y
      new THREE.Vector3(-1, 0, 0), // part y (up) → −x
      new THREE.Vector3(0, 0, 1),
    ),
  );
  object.quaternion.copy(q);
  return object;
}

let kneeGeo = null;
function kneeGeometry() {
  if (kneeGeo) return kneeGeo;
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-0.12, 0);
  s.lineTo(-0.12, 0.012);
  s.lineTo(-0.012, 0.11);
  s.lineTo(0, 0.11);
  s.closePath();
  kneeGeo = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false });
  kneeGeo.translate(0, -0.11 + 0.0, -0.004);
  kneeGeo.rotateX(Math.PI);
  return kneeGeo;
}
