// Competition hall: 14 × 7 m court on red sports vinyl, surround barriers,
// overhead LED luminaires, umpire's table and an in-arena score display.

import * as THREE from "three";
import { barrierTexture, emissive } from "./materials.js";
import { box, cylinder, mesh, roundedBox } from "./parts.js";

export const COURT = { length: 14, width: 7.4 };

export function buildArena(scene, materials) {
  const group = new THREE.Group();
  group.name = "arena";

  const hall = mesh(new THREE.PlaneGeometry(60, 60), materials.concrete, { cast: false });
  hall.rotation.x = -Math.PI / 2;
  hall.position.y = -0.002;
  group.add(hall);

  const court = mesh(new THREE.PlaneGeometry(COURT.length, COURT.width), materials.sportsFloor, { cast: false });
  court.rotation.x = -Math.PI / 2;
  group.add(court);

  // barriers around the court (75 cm high, 2 m panels)
  const panelTexts = ["ROBOT TABLE TENNIS", "VISION · ESTIMATION · CONTROL", "1 kHz PHYSICS · 200 fps STEREO"];
  const panelLength = 2;
  const addPanel = (x, z, rotY, index) => {
    const panel = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({ map: barrierTexture(panelTexts[index % panelTexts.length]), roughness: 0.55 });
    const face = roundedBox(panelLength - 0.02, 0.72, 0.03, 0.01, mat);
    face.position.y = 0.39;
    panel.add(face);
    for (const s of [-1, 1]) {
      const foot = box(0.04, 0.03, 0.42, materials.steelDark);
      foot.position.set((s * (panelLength - 0.2)) / 2, 0.015, 0.1);
      panel.add(foot);
    }
    panel.position.set(x, 0, z);
    panel.rotation.y = rotY;
    group.add(panel);
  };
  let k = 0;
  const hx = COURT.length / 2;
  const hz = COURT.width / 2;
  for (let x = -hx + 1; x <= hx - 1 + 1e-6; x += panelLength) {
    addPanel(x, -hz, 0, k++);
    if (Math.abs(x) > 1.5) addPanel(x, hz, Math.PI, k++); // leave a gap for the camera side
  }
  for (let z = -hz + 1 + 0.2; z <= hz - 1; z += panelLength) {
    addPanel(-hx, z, Math.PI / 2, k++);
    addPanel(hx, z, -Math.PI / 2, k++);
  }

  // umpire's table at the side of the net
  const umpire = new THREE.Group();
  const desk = roundedBox(0.9, 0.04, 0.5, 0.01, materials.steelPainted);
  desk.position.y = 0.74;
  umpire.add(desk);
  const skirt = box(0.88, 0.5, 0.02, new THREE.MeshStandardMaterial({ color: 0x14315f, roughness: 0.6 }));
  skirt.position.set(0, 0.47, -0.24);
  umpire.add(skirt);
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = cylinder(0.015, 0.015, 0.72, materials.steelDark, 10);
      leg.position.set(sx * 0.4, 0.36, sz * 0.2);
      umpire.add(leg);
    }
  }
  umpire.position.set(0, 0, -2.75);
  group.add(umpire);

  // luminaires: rows of emissive LED panels; actual lighting below
  const ledMat = emissive(0xf4f8ff, 3.2);
  const housingMat = materials.steelDark;
  for (let i = -2; i <= 2; i += 1) {
    for (const z of [-1.6, 1.6]) {
      const housing = box(1.2, 0.06, 0.32, housingMat);
      housing.position.set(i * 2.2, 6.03, z);
      housing.castShadow = false;
      group.add(housing);
      const led = box(1.12, 0.01, 0.26, ledMat);
      led.position.set(i * 2.2, 5.995, z);
      led.castShadow = false;
      group.add(led);
    }
  }
  // truss lines across the ceiling
  for (const z of [-2.6, 0, 2.6]) {
    const truss = box(13, 0.12, 0.12, housingMat);
    truss.position.set(0, 6.15, z);
    truss.castShadow = false;
    group.add(truss);
  }

  scene.add(group);
  return group;
}

export function addLighting(scene) {
  const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x2a1512, 0.55);
  scene.add(hemi);

  // main key: overhead, slightly off-axis so the table edges catch light
  const key = new THREE.DirectionalLight(0xffffff, 1.55);
  key.position.set(-2.5, 9, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 20;
  key.shadow.camera.left = -6;
  key.shadow.camera.right = 6;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.015;
  key.shadow.radius = 3;
  scene.add(key);

  // hall spots over each end of the table
  for (const x of [-2.4, 2.4]) {
    const spot = new THREE.SpotLight(0xfff4e6, 20, 14, Math.PI / 5, 0.6, 1.6);
    spot.position.set(x, 5.8, 0);
    spot.target.position.set(x * 0.6, 0.8, 0);
    scene.add(spot);
    scene.add(spot.target);
  }

  const fill = new THREE.DirectionalLight(0x9fc4ff, 0.5);
  fill.position.set(4, 3, -6);
  scene.add(fill);
  return { key, hemi };
}

// Small free-standing scoreboard with a canvas display that the HUD refreshes.
export class ScoreDisplay {
  constructor(materials) {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.group = new THREE.Group();
    const stand = box(0.06, 1.1, 0.06, materials.steelDark);
    stand.position.y = 0.55;
    this.group.add(stand);
    const frame = roundedBox(0.92, 0.5, 0.06, 0.015, materials.plasticBlack);
    frame.position.y = 1.32;
    this.group.add(frame);
    const screen = new THREE.Mesh(
      new THREE.PlaneGeometry(0.86, 0.43),
      new THREE.MeshBasicMaterial({ map: this.texture, toneMapped: false }),
    );
    screen.position.set(0, 1.32, 0.031);
    this.group.add(screen);
    const back = screen.clone();
    back.rotation.y = Math.PI;
    back.position.z = -0.031;
    this.group.add(back);
    const base = roundedBox(0.4, 0.03, 0.3, 0.01, materials.steelDark);
    base.position.y = 0.015;
    this.group.add(base);
    this.group.position.set(1.4, 0, -3.0);
    this.group.rotation.y = -0.25;
  }

  draw({ left, right, gamesLeft, gamesRight, server }) {
    const ctx = this.canvas.getContext("2d");
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "600 26px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "#4ed8ff";
    ctx.fillText("LEFT", w * 0.25, 40);
    ctx.fillStyle = "#ff8a3d";
    ctx.fillText("RIGHT", w * 0.75, 40);
    ctx.font = "700 130px Consolas, monospace";
    ctx.fillStyle = "#ffd75a";
    ctx.fillText(String(left), w * 0.25, 175);
    ctx.fillText(String(right), w * 0.75, 175);
    ctx.font = "600 30px Consolas, monospace";
    ctx.fillStyle = "#e8edf2";
    ctx.fillText(`${gamesLeft}  GAMES  ${gamesRight}`, w / 2, 232);
    ctx.fillStyle = "#7dff8a";
    ctx.beginPath();
    ctx.arc(server < 0 ? w * 0.08 : w * 0.92, 30, 9, 0, Math.PI * 2);
    ctx.fill();
    this.texture.needsUpdate = true;
  }
}
