import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { BALL, SIM } from "./sim/constants.js";
import { propagateCovariance } from "./sim/estimator.js";
import { Simulation } from "./sim/simulation.js";
import { addLighting, buildArena, ScoreDisplay } from "./render/arena.js";
import { createMaterials } from "./render/materials.js";
import { Overlays, setLineResolution } from "./render/overlays.js";
import { RobotModel } from "./render/robotModel.js";
import { buildTable } from "./render/tableModel.js";
import { Hud } from "./ui/hud.js";

// ---- renderer & scene ---------------------------------------------------------------

const canvas = document.querySelector("#scene");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06080b);
scene.fog = new THREE.Fog(0x06080b, 16, 38);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.environmentIntensity = 0.32;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.05, 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 0.6;
controls.maxDistance = 16;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.45, 0.96);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---- world ---------------------------------------------------------------------------------

const materials = createMaterials();
buildArena(scene, materials);
addLighting(scene);
scene.add(buildTable(materials));
const scoreDisplay = new ScoreDisplay(materials);
scene.add(scoreDisplay.group);

const sim = new Simulation({ seed: Math.floor(Math.random() * 1e6) });
const robotViews = new Map();
for (const agent of sim.agents) {
  const view = new RobotModel({ side: agent.side, accent: agent.side < 0 ? 0x4ed8ff : 0xff8a3d, materials });
  scene.add(view.root);
  view.aimCameras();
  robotViews.set(agent.side, view);
}

const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 48, 32), materials.ball);
ballMesh.castShadow = true;
scene.add(ballMesh);
// soft halo so the 40 mm ball stays readable from broadcast distance
const halo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: haloTexture(),
    color: 0xfff3c4,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }),
);
halo.scale.setScalar(0.11);
scene.add(halo);

const overlays = new Overlays(scene, materials, sim.agents);
const hud = new Hud();

sim.on((e) => {
  if (e.type === "table" && e.ballEvent) overlays.addBounce(e.x, e.z, e.side);
  if (e.type === "paddle") overlays.burst(new THREE.Vector3(e.x, e.y, e.z), e.side < 0 ? 0x4ed8ff : 0xff8a3d);
  hud.onEvent(e, sim.time);
});

function haloTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, "rgba(255,255,255,0.9)");
  g.addColorStop(0.25, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ---- camera director ---------------------------------------------------------------------------

const VIEWS = {
  broadcast: { pos: [1.7, 3.35, 6.5], target: [0.1, 0.86, 0], fov: 36 },
  side: { pos: [0, 1.55, 5.3], target: [0, 1.0, 0], fov: 42 },
  top: { pos: [0, 5.6, 0.01], target: [0, 0.8, 0], fov: 52 },
  robot: { pos: [-2.6, 2.78, 0.05], target: [0.8, 0.8, 0], fov: 56 },
  follow: { pos: [2.2, 1.7, 2.6], target: [0, 0.95, 0], fov: 45 },
};

const director = {
  view: "broadcast",
  transition: 0,
  fromPos: new THREE.Vector3(),
  fromTarget: new THREE.Vector3(),
  toPos: new THREE.Vector3(),
  toTarget: new THREE.Vector3(),
  userDriven: false,
};

function mobileScale() {
  const aspect = window.innerWidth / window.innerHeight;
  return aspect < 0.8 ? 2.05 : aspect < 1.2 ? 1.45 : 1;
}

// portrait screens: look down the long axis of the table instead
const PORTRAIT_BROADCAST = { pos: [4.4, 6.0, 1.3], target: [-0.3, 0.8, 0], fov: 52 };

function setView(name, instant = false) {
  director.view = name;
  const portrait = window.innerWidth / window.innerHeight < 0.8;
  const v = portrait && name === "broadcast" ? PORTRAIT_BROADCAST : VIEWS[name];
  const k = name === "top" || name === "robot" || v === PORTRAIT_BROADCAST ? 1 : mobileScale();
  const target = new THREE.Vector3(...v.target);
  const pos = new THREE.Vector3(...v.pos).sub(target).multiplyScalar(k).add(target);
  if (name === "top" && portrait) pos.set(0.01, 5.6, 0); // long axis vertical on screen
  director.fromPos.copy(camera.position);
  director.fromTarget.copy(controls.target);
  director.toPos.copy(pos);
  director.toTarget.copy(target);
  director.transition = instant ? 1 : 0;
  director.userDriven = false;
  camera.fov = name === "top" && portrait ? 72 : v.fov;
  camera.updateProjectionMatrix();
  if (instant) {
    camera.position.copy(pos);
    controls.target.copy(target);
  }
  document.querySelectorAll("#viewButtons button").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
}

controls.addEventListener("start", () => {
  director.userDriven = true;
});

const followTarget = new THREE.Vector3(0, 0.95, 0);
function updateDirector(dt) {
  if (director.transition < 1) {
    director.transition = Math.min(1, director.transition + dt / 1.1);
    const e = 1 - Math.pow(1 - director.transition, 3);
    camera.position.lerpVectors(director.fromPos, director.toPos, e);
    controls.target.lerpVectors(director.fromTarget, director.toTarget, e);
  } else if (director.view === "follow" && !director.userDriven && !sim.ballHeld) {
    const b = new THREE.Vector3(sim.ball[0], Math.max(0.85, sim.ball[1]), sim.ball[2]);
    followTarget.lerp(b, 1 - Math.exp(-dt * 4));
    controls.target.copy(followTarget);
    const desired = followTarget.clone().add(new THREE.Vector3(0.4 + followTarget.x * -0.25, 0.75, 2.4).multiplyScalar(mobileScale()));
    camera.position.lerp(desired, 1 - Math.exp(-dt * 2.5));
  }
}

// ---- controls -------------------------------------------------------------------------------------

let timeScale = 1;
let lastScale = 1;
let paused = false;

function setSpeed(value) {
  if (value === 0) {
    paused = !paused;
  } else {
    paused = false;
    timeScale = value;
    lastScale = value;
  }
  document.querySelectorAll("#speedButtons button").forEach((b) => {
    const v = Number(b.dataset.speed);
    b.classList.toggle("active", v === 0 ? paused : !paused && v === timeScale);
  });
}

document.querySelectorAll("#viewButtons button").forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));
document.querySelectorAll("#speedButtons button").forEach((b) => b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))));
document.querySelectorAll("[data-flag]").forEach((input) => {
  input.addEventListener("change", () => overlays.setFlag(input.dataset.flag, input.checked));
});
const pipEl = document.querySelector("#pip");
const pipToggle = document.querySelector("#pipToggle");
pipToggle.addEventListener("change", () => pipEl.classList.toggle("hidden", !pipToggle.checked));
const panelToggle = document.querySelector("#panelToggle");
panelToggle.addEventListener("click", () => {
  const open = document.querySelector("#controls").classList.toggle("open");
  panelToggle.setAttribute("aria-expanded", String(open));
});
if (window.innerWidth < 760) {
  pipToggle.checked = false;
  pipEl.classList.add("hidden");
}

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.code === "Space") {
    e.preventDefault();
    setSpeed(0);
  }
  const views = ["broadcast", "side", "top", "robot", "follow"];
  const n = Number(e.key);
  if (n >= 1 && n <= 5) setView(views[n - 1]);
  if (e.key === "s" || e.key === "S") setSpeed(timeScale === 1 ? 0.25 : lastScale === 0.25 ? 1 : 0.25);
});

// ---- PiP robot camera -------------------------------------------------------------------------------

const pipAgent = sim.agent(-1);
const pipCam = (() => {
  const c = pipAgent.rig.cameras[0];
  const cam = new THREE.PerspectiveCamera(c.vfov, c.width / c.height, 0.15, 30);
  cam.position.set(c.position.x, c.position.y, c.position.z);
  cam.up.set(0, 1, 0);
  cam.lookAt(c.target.x, c.target.y, c.target.z);
  return cam;
})();

function renderPip() {
  if (pipEl.classList.contains("hidden")) return;
  const rect = pipEl.getBoundingClientRect();
  const w = rect.width;
  const h = rect.height;
  const y = window.innerHeight - rect.bottom;
  renderer.setScissorTest(true);
  renderer.setScissor(rect.left, y, w, h);
  renderer.setViewport(rect.left, y, w, h);
  pipCam.aspect = w / h;
  pipCam.updateProjectionMatrix();
  // vision overlays clutter the camera's own image
  const flags = overlays.group.visible;
  overlays.group.visible = false;
  halo.visible = false;
  renderer.render(scene, pipCam);
  overlays.group.visible = flags;
  halo.visible = true;
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, window.innerWidth, window.innerHeight);
  hud.drawPip(pipAgent, sim, w, h);
}

// ---- main loop -----------------------------------------------------------------------------------

const clock = new THREE.Clock();
let accumulator = 0;
const uncertainty = new Map();
let lastUncertainty = -1;
const spinAxis = new THREE.Vector3();
const spinQuat = new THREE.Quaternion();
const perf = { simMs: 0, frames: 0, text: "—", lastText: 0 };
let scoreKey = "";

function updateUncertainty() {
  if (sim.time - lastUncertainty < 0.05) return;
  lastUncertainty = sim.time;
  for (const agent of sim.agents) {
    const plan = agent.plan;
    if (!plan || !agent.ekf.initialized || sim.time > plan.tHit) {
      uncertainty.delete(agent.side);
      continue;
    }
    const horizon = Math.max(0, plan.tHit - agent.ekf.t);
    const { positionCovariance } = propagateCovariance(agent.ekf, horizon, 0.04);
    uncertainty.set(agent.side, {
      covariance: positionCovariance,
      position: { x: plan.ballAtHit[0], y: plan.ballAtHit[1], z: plan.ballAtHit[2] },
    });
  }
}

function animate() {
  requestAnimationFrame(animate);
  const real = Math.min(clock.getDelta(), 0.05);
  const wall = clock.elapsedTime;

  const t0 = performance.now();
  let simDt = 0;
  if (!paused) {
    accumulator += real * timeScale;
    let steps = Math.floor(accumulator / SIM.dt);
    steps = Math.min(steps, 120);
    for (let i = 0; i < steps; i += 1) sim.step();
    accumulator -= steps * SIM.dt;
    simDt = steps * SIM.dt;
  }
  perf.simMs += performance.now() - t0;
  perf.frames += 1;
  if (wall - perf.lastText > 1) {
    perf.text = `${(perf.simMs / perf.frames).toFixed(2)} ms/帧`;
    perf.simMs = 0;
    perf.frames = 0;
    perf.lastText = wall;
  }

  // ball
  ballMesh.position.set(sim.ball[0], sim.ball[1], sim.ball[2]);
  const w = Math.hypot(sim.ball[6], sim.ball[7], sim.ball[8]);
  if (w > 1e-3 && simDt > 0) {
    spinAxis.set(sim.ball[6] / w, sim.ball[7] / w, sim.ball[8] / w);
    // cap the rendered angle per frame so strong spin does not alias into stillness
    spinQuat.setFromAxisAngle(spinAxis, Math.min(w * simDt, 0.9));
    ballMesh.quaternion.premultiply(spinQuat);
  }
  halo.position.copy(ballMesh.position);

  for (const agent of sim.agents) robotViews.get(agent.side).update(agent.robot.q, agent.telemetry());

  updateUncertainty();
  overlays.update(simDt, sim, camera, uncertainty);
  hud.update(sim, { wall, rateText: perf.text });

  const ref = sim.referee;
  const key = `${ref.points[-1]}:${ref.points[1]}:${ref.games[-1]}:${ref.games[1]}:${ref.server}`;
  if (key !== scoreKey) {
    scoreKey = key;
    scoreDisplay.draw({ left: ref.points[-1], right: ref.points[1], gamesLeft: ref.games[-1], gamesRight: ref.games[1], server: ref.server });
  }
  if (Math.floor(wall * 4) !== Math.floor((wall - real) * 4)) {
    for (const agent of sim.agents) {
      const s = agent.ekf.initialized ? Math.hypot(agent.ekf.x[6], agent.ekf.x[7], agent.ekf.x[8]) * 9.549 : 0;
      robotViews.get(agent.side).drawHmi(agent.mode, agent.rig.rate, s);
    }
  }

  updateDirector(real);
  controls.update();
  composer.render();
  renderPip();
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  setLineResolution(w, h);
}

window.addEventListener("resize", () => {
  onResize();
  if (!director.userDriven) setView(director.view, true);
});

onResize();
setView("broadcast", true);
animate();

// expose for debugging in the console
window.__sim = sim;
window.__view = { camera, controls, renderer, composer };
