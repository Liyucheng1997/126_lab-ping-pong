import "./styles.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const canvas = document.querySelector("#scene");
const leftState = document.querySelector("#leftState");
const rightState = document.querySelector("#rightState");
const ballSpeed = document.querySelector("#ballSpeed");
const togglePrediction = document.querySelector("#togglePrediction");
const toggleVision = document.querySelector("#toggleVision");
const leftScoreEl = document.querySelector("#leftScore");
const rightScoreEl = document.querySelector("#rightScore");
const leftGamesEl = document.querySelector("#leftGames");
const rightGamesEl = document.querySelector("#rightGames");
const serverLabel = document.querySelector("#serverLabel");
const rallyMessage = document.querySelector("#rallyMessage");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07090c);
scene.fog = new THREE.Fog(0x07090c, 12, 28);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  80,
);
camera.position.set(7.6, 5.1, 8.1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1.1, 0);
controls.maxDistance = 18;
controls.minDistance = 5;
controls.maxPolarAngle = Math.PI * 0.49;

function configureCameraForViewport() {
  const mobile = window.innerWidth < 700;
  camera.fov = mobile ? 72 : 45;
  camera.position.set(mobile ? 0.2 : 7.6, mobile ? 7.6 : 5.1, mobile ? 16.4 : 8.1);
  controls.target.set(0, mobile ? 1.08 : 1.1, 0);
  camera.updateProjectionMatrix();
  controls.update();
}

const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2(10, 10);

const table = {
  length: 8.0,
  width: 3.0,
  height: 0.92,
  halfLength: 4.0,
  halfWidth: 1.5,
};

const palette = {
  graphite: new THREE.Color(0x151b22),
  cyan: new THREE.Color(0x4ed8ff),
  orange: new THREE.Color(0xff7a2f),
  lime: new THREE.Color(0xb5ff6a),
  porcelain: new THREE.Color(0xf2f7ff),
  rubberRed: new THREE.Color(0xb12a2d),
  rubberBlack: new THREE.Color(0x121318),
};

const materials = {
  floor: new THREE.MeshStandardMaterial({
    color: 0x111417,
    roughness: 0.85,
    metalness: 0.05,
  }),
  tableTop: new THREE.MeshStandardMaterial({
    color: 0x123c48,
    roughness: 0.58,
    metalness: 0.12,
  }),
  tableEdge: new THREE.MeshStandardMaterial({
    color: 0xeaf4fb,
    roughness: 0.38,
    metalness: 0.1,
  }),
  net: new THREE.MeshStandardMaterial({
    color: 0xdce9f2,
    roughness: 0.45,
    metalness: 0.05,
    transparent: true,
    opacity: 0.86,
  }),
  carbon: new THREE.MeshStandardMaterial({
    color: 0x1c232b,
    roughness: 0.38,
    metalness: 0.74,
  }),
  joint: new THREE.MeshStandardMaterial({
    color: 0x5c6670,
    roughness: 0.24,
    metalness: 0.9,
  }),
  whiteShell: new THREE.MeshStandardMaterial({
    color: 0xdce8f2,
    roughness: 0.34,
    metalness: 0.25,
  }),
  blackRubber: new THREE.MeshStandardMaterial({
    color: palette.rubberBlack,
    roughness: 0.65,
    metalness: 0.08,
  }),
  redRubber: new THREE.MeshStandardMaterial({
    color: palette.rubberRed,
    roughness: 0.58,
    metalness: 0.05,
  }),
  ball: new THREE.MeshStandardMaterial({
    color: 0xfff8d2,
    roughness: 0.35,
    metalness: 0,
    emissive: 0x7a5300,
    emissiveIntensity: 0.15,
  }),
  vision: new THREE.MeshBasicMaterial({
    color: 0x4ed8ff,
    transparent: true,
    opacity: 0.2,
    depthWrite: false,
    side: THREE.DoubleSide,
  }),
  prediction: new THREE.MeshBasicMaterial({
    color: 0xb5ff6a,
    transparent: true,
    opacity: 0.86,
  }),
  scan: new THREE.MeshBasicMaterial({
    color: 0x4ed8ff,
    transparent: true,
    opacity: 0.55,
  }),
};

function roundedBox(width, height, depth, radius, segments = 4) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSegments: segments,
    bevelSize: radius * 0.35,
    bevelThickness: radius * 0.35,
  });
  geometry.center();
  return geometry;
}

function makeBox(width, height, depth, material, radius = 0.02) {
  const geometry =
    radius > 0
      ? roundedBox(width, height, depth, Math.min(radius, width * 0.25, height * 0.25))
      : new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function makeCylinder(radiusTop, radiusBottom, height, material, radial = 32) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial),
    material,
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function addLights() {
  const hemi = new THREE.HemisphereLight(0x9fcfff, 0x10151a, 1.4);
  scene.add(hemi);

  const key = new THREE.DirectionalLight(0xffffff, 3.8);
  key.position.set(-4.5, 8, 5.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 24;
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  scene.add(key);

  const rim = new THREE.PointLight(0x4ed8ff, 2.6, 16);
  rim.position.set(0, 4.4, -5.5);
  scene.add(rim);

  const warm = new THREE.PointLight(0xff7a2f, 1.8, 13);
  warm.position.set(0, 2.2, 5.0);
  scene.add(warm);
}

function buildEnvironment() {
  const floor = makeBox(15, 0.08, 10, materials.floor, 0);
  floor.position.y = -0.04;
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new THREE.GridHelper(15, 30, 0x234453, 0x17242b);
  grid.position.y = 0.006;
  scene.add(grid);

  const backWall = makeBox(15, 6.2, 0.08, new THREE.MeshStandardMaterial({
    color: 0x0c1116,
    roughness: 0.82,
  }), 0);
  backWall.position.set(0, 3.05, -4.4);
  backWall.receiveShadow = true;
  scene.add(backWall);

  for (let i = -3; i <= 3; i += 1) {
    const lightBar = makeBox(1.28, 0.035, 0.035, new THREE.MeshBasicMaterial({
      color: i % 2 === 0 ? 0x4ed8ff : 0xff7a2f,
      transparent: true,
      opacity: 0.78,
    }), 0.01);
    lightBar.position.set(i * 1.9, 3.8, -4.34);
    scene.add(lightBar);
  }
}

function buildTable() {
  const group = new THREE.Group();
  group.name = "competition-table";

  const top = makeBox(table.length, 0.13, table.width, materials.tableTop, 0.035);
  top.position.y = table.height;
  group.add(top);

  const centerLine = makeBox(table.length + 0.02, 0.012, 0.035, materials.tableEdge, 0);
  centerLine.position.set(0, table.height + 0.073, 0);
  group.add(centerLine);

  const sideLines = [
    [0, table.height + 0.076, table.halfWidth - 0.035, table.length, 0.012, 0.035],
    [0, table.height + 0.076, -table.halfWidth + 0.035, table.length, 0.012, 0.035],
    [table.halfLength - 0.035, table.height + 0.076, 0, 0.035, 0.012, table.width],
    [-table.halfLength + 0.035, table.height + 0.076, 0, 0.035, 0.012, table.width],
  ];
  sideLines.forEach(([x, y, z, w, h, d]) => {
    const line = makeBox(w, h, d, materials.tableEdge, 0);
    line.position.set(x, y, z);
    group.add(line);
  });

  const netMesh = makeBox(0.08, 0.44, table.width + 0.22, materials.net, 0.01);
  netMesh.position.set(0, table.height + 0.26, 0);
  group.add(netMesh);

  for (let z = -1.48; z <= 1.48; z += 0.18) {
    const strand = makeBox(0.095, 0.43, 0.008, new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.36,
    }), 0);
    strand.position.set(0.004, table.height + 0.26, z);
    group.add(strand);
  }

  for (const x of [-3.35, 3.35]) {
    for (const z of [-1.12, 1.12]) {
      const leg = makeCylinder(0.055, 0.075, table.height, materials.carbon, 18);
      leg.position.set(x, table.height * 0.5, z);
      group.add(leg);
    }
  }

  scene.add(group);
}

function makeGlowLine(points, material) {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, material);
}

function makePaddle() {
  const group = new THREE.Group();
  const blade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.23, 0.23, 0.035, 48),
    [materials.blackRubber, materials.redRubber, materials.redRubber],
  );
  blade.rotation.x = Math.PI * 0.5;
  blade.castShadow = true;
  group.add(blade);

  const handle = makeBox(0.12, 0.34, 0.09, new THREE.MeshStandardMaterial({
    color: 0x7a5130,
    roughness: 0.5,
    metalness: 0.05,
  }), 0.035);
  handle.position.set(0, -0.31, 0);
  group.add(handle);
  return group;
}

class PingPongRobot {
  constructor({ side, accent, name }) {
    this.side = side;
    this.accent = accent;
    this.name = name;
    this.group = new THREE.Group();
    this.group.name = name;
    this.baseX = side * 4.95;
    this.crossSlide = new THREE.Group();
    this.verticalSlide = new THREE.Group();
    this.strikeSlide = new THREE.Group();
    this.cameraRig = new THREE.Group();
    this.paddle = makePaddle();
    this.handTarget = new THREE.Vector3(side * 3.65, 1.38, 0);
    this.detectedBall = new THREE.Vector3();
    this.detectedVelocity = new THREE.Vector3();
    this.lastMeasurement = null;
    this.hasDetection = false;
    this.smoothedPrediction = new THREE.Vector3(side * 3.4, 1.3, 0);
    this.lastHitAt = -10;
    this.status = "TRACKING";
    this.build();
    scene.add(this.group);
  }

  build() {
    this.group.position.set(this.baseX, 0, 0);
    this.group.rotation.y = this.side > 0 ? 0 : Math.PI;

    const accentMaterial = new THREE.MeshStandardMaterial({
      color: this.accent,
      roughness: 0.3,
      metalness: 0.55,
      emissive: this.accent,
      emissiveIntensity: 0.08,
    });

    const basePlate = makeBox(1.2, 0.1, 3.55, materials.carbon, 0.04);
    basePlate.position.set(0.12, 0.05, 0);
    this.group.add(basePlate);

    const tableSideFoot = makeBox(0.24, 0.12, 3.35, materials.joint, 0.03);
    tableSideFoot.position.set(-1.35, 0.09, 0);
    this.group.add(tableSideFoot);

    const backFoot = makeBox(0.2, 0.11, 3.2, materials.joint, 0.03);
    backFoot.position.set(0.42, 0.1, 0);
    this.group.add(backFoot);

    for (const x of [-1.35, 0.42]) {
      for (const z of [-1.58, 1.58]) {
        const post = makeCylinder(0.045, 0.055, 2.26, materials.carbon, 18);
        post.position.set(x, 1.18, z);
        this.group.add(post);

        const foot = makeBox(0.34, 0.08, 0.34, materials.whiteShell, 0.035);
        foot.position.set(x, 0.11, z);
        this.group.add(foot);
      }
    }

    for (const y of [1.02, 2.28]) {
      const frontRail = makeBox(0.1, 0.1, 3.42, materials.carbon, 0.035);
      frontRail.position.set(-1.35, y, 0);
      this.group.add(frontRail);

      const backRail = makeBox(0.1, 0.1, 3.42, materials.carbon, 0.035);
      backRail.position.set(0.42, y, 0);
      this.group.add(backRail);
    }

    for (const z of [-1.58, 1.58]) {
      const depthBrace = makeBox(1.85, 0.08, 0.08, materials.carbon, 0.03);
      depthBrace.position.set(-0.46, 2.28, z);
      this.group.add(depthBrace);
    }

    const topDriveRail = makeBox(0.16, 0.16, 3.5, materials.joint, 0.04);
    topDriveRail.position.set(-0.52, 2.28, 0);
    this.group.add(topDriveRail);

    const belt = makeBox(0.05, 0.035, 3.36, new THREE.MeshStandardMaterial({
      color: 0x05080b,
      roughness: 0.5,
      metalness: 0.25,
    }), 0.01);
    belt.position.set(-0.7, 2.42, 0);
    this.group.add(belt);

    this.cameraRig.position.set(-0.1, 2.48, 0);
    this.group.add(this.cameraRig);

    const cameraBody = makeBox(0.34, 0.24, 0.52, materials.whiteShell, 0.055);
    cameraBody.position.set(0, 0, 0);
    this.cameraRig.add(cameraBody);

    const cameraFace = makeBox(0.035, 0.18, 0.38, new THREE.MeshStandardMaterial({
      color: 0x071117,
      roughness: 0.18,
      metalness: 0.25,
      emissive: this.accent,
      emissiveIntensity: 0.18,
    }), 0.02);
    cameraFace.position.set(-0.18, 0, 0);
    this.cameraRig.add(cameraFace);

    const lens = makeCylinder(0.07, 0.05, 0.05, new THREE.MeshBasicMaterial({
      color: this.accent,
    }), 28);
    lens.rotation.z = Math.PI * 0.5;
    lens.position.set(-0.22, 0, 0);
    this.cameraRig.add(lens);

    this.visionCone = this.createVisionCone(accentMaterial);
    this.group.add(this.visionCone);

    this.detectedMarker = this.createDetectionReticle();
    scene.add(this.detectedMarker);

    this.scanLine = makeGlowLine(
      [new THREE.Vector3(), new THREE.Vector3()],
      new THREE.LineBasicMaterial({
        color: this.accent,
        transparent: true,
        opacity: 0.7,
      }),
    );
    scene.add(this.scanLine);

    this.crossSlide.position.set(-0.52, 0, 0);
    this.group.add(this.crossSlide);

    const crossCarriage = makeBox(0.42, 0.28, 0.42, materials.whiteShell, 0.06);
    crossCarriage.position.set(0, 2.28, 0);
    this.crossSlide.add(crossCarriage);

    const motor = makeCylinder(0.14, 0.14, 0.2, accentMaterial, 32);
    motor.rotation.x = Math.PI * 0.5;
    motor.position.set(0.08, 2.29, 0.31);
    this.crossSlide.add(motor);

    const verticalRailA = makeBox(0.08, 1.42, 0.08, materials.carbon, 0.025);
    verticalRailA.position.set(-0.08, 1.55, -0.12);
    this.crossSlide.add(verticalRailA);

    const verticalRailB = makeBox(0.08, 1.42, 0.08, materials.carbon, 0.025);
    verticalRailB.position.set(-0.08, 1.55, 0.12);
    this.crossSlide.add(verticalRailB);

    this.verticalSlide.position.set(-0.08, 1.38, 0);
    this.crossSlide.add(this.verticalSlide);

    const liftBlock = makeBox(0.36, 0.28, 0.38, materials.whiteShell, 0.055);
    liftBlock.position.set(0, 0, 0);
    this.verticalSlide.add(liftBlock);

    const statusStrip = makeBox(0.03, 0.2, 0.3, accentMaterial, 0.015);
    statusStrip.position.set(-0.19, 0, 0);
    this.verticalSlide.add(statusStrip);

    this.strikeSlide.position.set(-0.82, 0, 0);
    this.verticalSlide.add(this.strikeSlide);

    const strikeBeam = makeBox(0.95, 0.1, 0.1, materials.carbon, 0.03);
    strikeBeam.position.set(0.38, 0, 0);
    this.strikeSlide.add(strikeBeam);

    const wristMotor = makeCylinder(0.11, 0.11, 0.16, accentMaterial, 28);
    wristMotor.rotation.x = Math.PI * 0.5;
    wristMotor.position.set(-0.13, 0, 0);
    this.strikeSlide.add(wristMotor);

    this.paddle.position.set(-0.36, 0, 0);
    this.paddle.rotation.y = Math.PI * 0.5;
    this.paddle.rotation.z = -0.18;
    this.strikeSlide.add(this.paddle);
  }

  createVisionCone(accentMaterial) {
    const geometry = new THREE.BufferGeometry();
    const vertices = new Float32Array([
      -0.25, 2.48, 0,
      -3.35, 0.88, -1.38,
      -3.35, 0.88, 1.38,
      -0.25, 2.48, 0,
      -3.35, 2.08, 1.18,
      -3.35, 0.88, 1.38,
      -0.25, 2.48, 0,
      -3.35, 2.08, -1.18,
      -3.35, 2.08, 1.18,
      -0.25, 2.48, 0,
      -3.35, 0.88, -1.38,
      -3.35, 2.08, -1.18,
    ]);
    geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, materials.vision.clone());
    mesh.material.color.copy(accentMaterial.color);
    return mesh;
  }

  createDetectionReticle() {
    const group = new THREE.Group();
    const material = new THREE.LineBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: 0.88,
    });
    const radius = 0.17;
    const segments = 64;
    const points = [];
    for (let i = 0; i <= segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0));
    }
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));

    const horizontal = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.25, 0, 0),
      new THREE.Vector3(-0.08, 0, 0),
      new THREE.Vector3(0.08, 0, 0),
      new THREE.Vector3(0.25, 0, 0),
    ]);
    const vertical = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, -0.25, 0),
      new THREE.Vector3(0, -0.08, 0),
      new THREE.Vector3(0, 0.08, 0),
      new THREE.Vector3(0, 0.25, 0),
    ]);
    group.add(new THREE.LineSegments(horizontal, material));
    group.add(new THREE.LineSegments(vertical, material));

    const labelBar = makeBox(0.34, 0.025, 0.025, new THREE.MeshBasicMaterial({
      color: this.accent,
      transparent: true,
      opacity: 0.72,
    }), 0.006);
    labelBar.position.set(0, -0.31, 0);
    group.add(labelBar);
    return group;
  }

  update(ball, time, dt) {
    const measurement = ball.position.clone().add(randomVisionNoise(time, this.side));
    if (!this.hasDetection || !this.lastMeasurement) {
      this.detectedBall.copy(measurement);
      this.lastMeasurement = measurement.clone();
      this.hasDetection = true;
    }

    const rawVelocity = measurement.clone().sub(this.lastMeasurement).divideScalar(Math.max(dt, 0.001));
    this.detectedVelocity.lerp(rawVelocity, 1 - Math.pow(0.0001, dt));
    this.detectedBall.lerp(measurement, 1 - Math.pow(0.000000000001, dt));
    this.lastMeasurement.copy(measurement);
    this.detectedMarker.position.copy(this.detectedBall);
    this.detectedMarker.quaternion.copy(camera.quaternion);
    this.detectedMarker.scale.setScalar(1 + 0.08 * Math.sin(time * 15));

    const prediction = estimateInterceptFor(this, this.detectedBall, this.detectedVelocity);
    const desired = prediction.clone();
    desired.x = THREE.MathUtils.clamp(desired.x, -3.65, 3.65);
    desired.y = THREE.MathUtils.clamp(desired.y, 1.02, 1.86);
    desired.z = THREE.MathUtils.clamp(desired.z, -1.25, 1.25);
    this.smoothedPrediction.lerp(desired, 1 - Math.pow(0.0001, dt));

    const reachTarget = new THREE.Vector3(
      this.side * Math.abs(this.smoothedPrediction.x),
      this.smoothedPrediction.y,
      this.smoothedPrediction.z,
    );

    const isThreat =
      Math.sign(this.detectedVelocity.x) === this.side &&
      Math.abs(this.detectedBall.x - this.side * 3.4) < 2.4;
    this.status = isThreat ? "INTERCEPT" : "TRACKING";
    const rest = new THREE.Vector3(this.side * 3.62, 1.25, 0.62 * Math.sin(time * 0.8));
    this.handTarget.lerp(isThreat ? reachTarget : rest, 1 - Math.pow(0.00004, dt));

    this.solveArm(this.handTarget, time);
    this.updateVisualTelemetry(time, this.detectedBall);
  }

  solveArm(worldTarget, time) {
    const localTarget = this.group.worldToLocal(worldTarget.clone());
    const lateral = THREE.MathUtils.clamp(localTarget.z, -1.25, 1.25);
    const lift = THREE.MathUtils.clamp(localTarget.y, 1.08, 1.88);
    const stroke = THREE.MathUtils.clamp(localTarget.x + 0.38, -1.18, -0.68);

    this.crossSlide.position.z = THREE.MathUtils.lerp(this.crossSlide.position.z, lateral, 0.18);
    this.verticalSlide.position.y = THREE.MathUtils.lerp(
      this.verticalSlide.position.y,
      lift,
      0.2,
    );
    this.strikeSlide.position.x = THREE.MathUtils.lerp(
      this.strikeSlide.position.x,
      stroke + 0.06 * Math.sin(time * 12),
      0.22,
    );
    this.paddle.rotation.x = THREE.MathUtils.lerp(
      this.paddle.rotation.x,
      THREE.MathUtils.clamp((lift - 1.35) * 0.55, -0.32, 0.32),
      0.18,
    );
    this.paddle.rotation.z = THREE.MathUtils.lerp(
      this.paddle.rotation.z,
      THREE.MathUtils.clamp(-lateral * 0.24, -0.32, 0.32),
      0.18,
    );
  }

  updateVisualTelemetry(time, ballPosition) {
    const origin = new THREE.Vector3(-0.25, 2.48, 0).applyMatrix4(this.group.matrixWorld);
    const sweep = new THREE.Vector3(
      -this.side * 0.1,
      ballPosition.y + Math.sin(time * 9 + this.side) * 0.08,
      ballPosition.z,
    );
    const positions = this.scanLine.geometry.attributes.position;
    positions.setXYZ(0, origin.x, origin.y, origin.z);
    positions.setXYZ(1, sweep.x, sweep.y, sweep.z);
    positions.needsUpdate = true;
  }

  paddleWorldPosition() {
    return this.paddle.localToWorld(new THREE.Vector3(0, 0, 0));
  }

  setVisionVisible(visible) {
    this.visionCone.visible = visible;
    this.detectedMarker.visible = visible;
    this.scanLine.visible = visible;
  }
}

class Scoreboard {
  constructor() {
    this.leftPoints = 0;
    this.rightPoints = 0;
    this.leftGames = 0;
    this.rightGames = 0;
    this.serverSide = -1;
    this.lastMessage = "READY";
    this.update();
  }

  awardPoint(winnerSide, reason) {
    if (winnerSide < 0) {
      this.leftPoints += 1;
    } else {
      this.rightPoints += 1;
    }

    const gameWinner = this.findGameWinner();
    if (gameWinner) {
      if (gameWinner < 0) {
        this.leftGames += 1;
      } else {
        this.rightGames += 1;
      }
      this.lastMessage = `${sideName(gameWinner)} GAME`;
      this.leftPoints = 0;
      this.rightPoints = 0;
      this.serverSide = gameWinner;
      this.update();
      return;
    }

    this.serverSide = this.nextServerSide();
    this.lastMessage = `${sideName(winnerSide)} +1 · ${reason}`;
    this.update();
  }

  findGameWinner() {
    if (this.leftPoints >= 11 && this.leftPoints - this.rightPoints >= 2) {
      return -1;
    }
    if (this.rightPoints >= 11 && this.rightPoints - this.leftPoints >= 2) {
      return 1;
    }
    return 0;
  }

  nextServerSide() {
    const total = this.leftPoints + this.rightPoints;
    const deuce = this.leftPoints >= 10 && this.rightPoints >= 10;
    const block = deuce ? total : Math.floor(total / 2);
    return block % 2 === 0 ? -1 : 1;
  }

  update() {
    leftScoreEl.textContent = this.leftPoints;
    rightScoreEl.textContent = this.rightPoints;
    leftGamesEl.textContent = `G ${this.leftGames}`;
    rightGamesEl.textContent = `G ${this.rightGames}`;
    serverLabel.textContent = `${sideName(this.serverSide)} SERVE`;
    rallyMessage.textContent = this.lastMessage;
  }
}

function sideName(side) {
  return side < 0 ? "LEFT" : "RIGHT";
}

class BallSystem {
  constructor(scoreboard) {
    this.scoreboard = scoreboard;
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(0.075, 32, 20), materials.ball);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    scene.add(this.mesh);

    this.trailPoints = Array.from({ length: 36 }, () => new THREE.Vector3());
    this.trail = makeGlowLine(this.trailPoints, new THREE.LineBasicMaterial({
      color: 0xfff2a6,
      transparent: true,
      opacity: 0.55,
    }));
    scene.add(this.trail);

    this.predictionLine = makeGlowLine(
      Array.from({ length: 80 }, () => new THREE.Vector3()),
      new THREE.LineBasicMaterial({
        color: 0xb5ff6a,
        transparent: true,
        opacity: 0.75,
      }),
    );
    scene.add(this.predictionLine);

    this.position = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.lastBounceAt = -10;
    this.lastResetAt = 0;
    this.lastHitter = this.scoreboard.serverSide;
    this.bouncesSinceHit = 0;
    this.lastBounceSide = 0;
    this.serveOwnBounceSeen = false;
    this.isServe = true;
    this.inPoint = true;
    this.nextServeAt = 0;
    this.serve(this.scoreboard.serverSide);
  }

  serve(side) {
    this.position.set(side * 3.15, 1.34, THREE.MathUtils.randFloatSpread(0.55));
    this.velocity.set(
      -side * THREE.MathUtils.randFloat(5.2, 6.1),
      THREE.MathUtils.randFloat(1.2, 1.7),
      THREE.MathUtils.randFloatSpread(1.15),
    );
    this.lastHitter = side;
    this.bouncesSinceHit = 0;
    this.lastBounceSide = 0;
    this.serveOwnBounceSeen = false;
    this.isServe = true;
    this.inPoint = true;
    this.lastResetAt = clock.elapsedTime;
    this.mesh.visible = true;
    this.scoreboard.lastMessage = "IN PLAY";
    this.scoreboard.update();
  }

  update(dt, time, robots) {
    if (!this.inPoint) {
      if (time >= this.nextServeAt) {
        this.serve(this.scoreboard.serverSide);
      }
      this.updateTrail();
      this.updatePrediction();
      return;
    }

    const safeDt = Math.min(dt, 1 / 30);
    this.velocity.y -= 9.7 * safeDt;
    this.position.addScaledVector(this.velocity, safeDt);

    if (
      this.position.y <= table.height + 0.09 &&
      this.position.y > table.height - 0.12 &&
      Math.abs(this.position.x) <= table.halfLength &&
      Math.abs(this.position.z) <= table.halfWidth &&
      time - this.lastBounceAt > 0.12
    ) {
      this.position.y = table.height + 0.09;
      this.velocity.y = Math.abs(this.velocity.y) * 0.82;
      this.velocity.x *= 0.985;
      this.velocity.z *= 0.94;
      this.lastBounceAt = time;
      pulseAt(this.position, 0xb5ff6a);
      this.handleTableBounce(time);
      if (!this.inPoint) {
        return;
      }
    }

    robots.forEach((robot) => this.checkRobotHit(robot, time));

    if (
      this.position.y < -0.45 ||
      Math.abs(this.position.x) > 6.5 ||
      Math.abs(this.position.z) > 3.4
    ) {
      this.failPoint(this.outcomeForMiss(), "MISS");
      return;
    }

    if (time - this.lastResetAt > 13) {
      this.failPoint(-this.lastHitter, "TIMEOUT");
      return;
    }

    this.mesh.position.copy(this.position);
    this.mesh.rotation.x += this.velocity.z * dt;
    this.mesh.rotation.z -= this.velocity.x * dt;
    this.updateTrail();
    this.updatePrediction();
  }

  handleTableBounce(time) {
    const bounceSide = this.position.x < 0 ? -1 : 1;

    if (this.isServe && !this.serveOwnBounceSeen) {
      if (bounceSide !== this.lastHitter) {
        this.failPoint(-this.lastHitter, "SERVICE FAULT");
        return;
      }
      this.serveOwnBounceSeen = true;
      this.lastBounceSide = bounceSide;
      return;
    }

    const targetSide = -this.lastHitter;
    if (bounceSide !== targetSide) {
      this.failPoint(targetSide, "WRONG SIDE");
      return;
    }

    if (this.lastBounceSide === bounceSide && this.bouncesSinceHit >= 1) {
      this.failPoint(this.lastHitter, "DOUBLE BOUNCE");
      return;
    }

    this.isServe = false;
    this.bouncesSinceHit += 1;
    this.lastBounceSide = bounceSide;
    this.lastResetAt = time;
  }

  outcomeForMiss() {
    return this.bouncesSinceHit > 0 ? this.lastHitter : -this.lastHitter;
  }

  failPoint(winnerSide, reason) {
    if (!this.inPoint) {
      return;
    }
    this.inPoint = false;
    this.velocity.set(0, 0, 0);
    this.scoreboard.awardPoint(winnerSide, reason);
    this.nextServeAt = clock.elapsedTime + 1.1;
  }

  checkRobotHit(robot, time) {
    if (Math.sign(this.velocity.x) !== robot.side || time - robot.lastHitAt < 0.38) {
      return;
    }
    const paddle = robot.paddleWorldPosition();
    const nearSide = Math.abs(this.position.x - robot.side * 3.72) < 0.72;
    const distance = paddle.distanceTo(this.position);
    if (!nearSide || distance > 0.48) {
      return;
    }

    const forcedError = Math.random() < 0.22;
    const targetX = -robot.side * THREE.MathUtils.randFloat(2.55, forcedError ? 3.9 : 3.12);
    const targetZ = forcedError
      ? (Math.random() < 0.5 ? -1 : 1) * THREE.MathUtils.randFloat(1.85, 2.35)
      : THREE.MathUtils.clamp(
        -this.position.z * 0.55 + THREE.MathUtils.randFloatSpread(0.5),
        -1.08,
        1.08,
      );
    const apex = THREE.MathUtils.randFloat(1.65, 2.2);
    const flightTime = THREE.MathUtils.randFloat(0.95, 1.18);
    const vx = (targetX - this.position.x) / flightTime;
    const vz = (targetZ - this.position.z) / flightTime;
    const vy = (apex - this.position.y + 0.5 * 9.7 * (flightTime * 0.48) ** 2) / (flightTime * 0.48);

    this.velocity.set(vx, THREE.MathUtils.clamp(vy, 2.4, 4.4), vz);
    this.position.addScaledVector(this.velocity, 0.016);
    this.lastHitter = robot.side;
    this.bouncesSinceHit = 0;
    this.lastBounceSide = 0;
    this.isServe = false;
    robot.lastHitAt = time;
    robot.status = "RETURN";
    pulseAt(paddle, robot.accent.getHex());
  }

  updateTrail() {
    this.trailPoints.pop();
    this.trailPoints.unshift(this.position.clone());
    this.trail.geometry.setFromPoints(this.trailPoints);
  }

  updatePrediction() {
    const points = predictPath(this.position, this.velocity, 80, 0.035);
    this.predictionLine.geometry.setFromPoints(points);
  }

  setPredictionVisible(visible) {
    this.predictionLine.visible = visible;
  }
}

function randomVisionNoise(time, side) {
  return new THREE.Vector3(
    Math.sin(time * 17.1 + side) * 0.005,
    Math.cos(time * 13.7 - side) * 0.004,
    Math.sin(time * 15.3) * 0.006,
  );
}

function predictPath(position, velocity, samples = 60, step = 0.04) {
  const p = position.clone();
  const v = velocity.clone();
  const points = [];
  for (let i = 0; i < samples; i += 1) {
    v.y -= 9.7 * step;
    p.addScaledVector(v, step);
    if (
      p.y <= table.height + 0.09 &&
      p.y > table.height - 0.1 &&
      Math.abs(p.x) <= table.halfLength &&
      Math.abs(p.z) <= table.halfWidth
    ) {
      p.y = table.height + 0.09;
      v.y = Math.abs(v.y) * 0.82;
      v.x *= 0.985;
      v.z *= 0.94;
    }
    points.push(p.clone());
  }
  return points;
}

function estimateInterceptFor(robot, position, velocity) {
  const points = predictPath(position, velocity, 100, 0.028);
  const targetX = robot.side * 3.55;
  let best = points[points.length - 1].clone();
  let bestDistance = Infinity;
  for (const point of points) {
    const distance = Math.abs(point.x - targetX) + Math.abs(point.z) * 0.08;
    if (distance < bestDistance && point.y > table.height + 0.12 && point.y < 2.25) {
      best = point.clone();
      bestDistance = distance;
    }
  }
  best.x = targetX;
  return best;
}

const pulses = [];
function pulseAt(position, color) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.12, 0.008, 10, 48),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
    }),
  );
  ring.position.copy(position);
  ring.rotation.x = Math.PI * 0.5;
  scene.add(ring);
  pulses.push({ ring, born: clock.elapsedTime });
}

function updatePulses(time) {
  for (let i = pulses.length - 1; i >= 0; i -= 1) {
    const pulse = pulses[i];
    const age = time - pulse.born;
    pulse.ring.scale.setScalar(1 + age * 5);
    pulse.ring.material.opacity = Math.max(0, 0.85 - age * 1.6);
    if (age > 0.6) {
      scene.remove(pulse.ring);
      pulse.ring.geometry.dispose();
      pulse.ring.material.dispose();
      pulses.splice(i, 1);
    }
  }
}

function buildReferenceBadges() {
  const labelMaterial = new THREE.MeshBasicMaterial({
    color: 0x9fb4c5,
    transparent: true,
    opacity: 0.58,
  });
  const floorMarks = [
    ["FORPHEUS-style high-speed vision", -2.6, 0.01, 3.05],
    ["Learning rally controller", 2.45, 0.01, 3.05],
  ];
  floorMarks.forEach(([, x, y, z], index) => {
    const strip = makeBox(2.35, 0.012, 0.035, labelMaterial, 0.01);
    strip.position.set(x, y, z);
    strip.rotation.y = index === 0 ? -0.12 : 0.12;
    scene.add(strip);
  });
}

function addHoverFocus() {
  window.addEventListener("pointermove", (event) => {
    pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(event.clientY / window.innerHeight) * 2 + 1;
  });
}

function updateCameraMicroMotion(time) {
  raycaster.setFromCamera(pointer, camera);
  camera.position.x += Math.sin(time * 0.16) * 0.0008;
}

addLights();
buildEnvironment();
buildTable();
buildReferenceBadges();
addHoverFocus();
configureCameraForViewport();

const leftBot = new PingPongRobot({
  side: -1,
  accent: palette.cyan,
  name: "left-vision-robot",
});
const rightBot = new PingPongRobot({
  side: 1,
  accent: palette.orange,
  name: "right-vision-robot",
});
const scoreboard = new Scoreboard();
const ball = new BallSystem(scoreboard);
const robots = [leftBot, rightBot];

togglePrediction.addEventListener("change", () => {
  ball.setPredictionVisible(togglePrediction.checked);
});

toggleVision.addEventListener("change", () => {
  robots.forEach((robot) => robot.setVisionVisible(toggleVision.checked));
});

function animate() {
  requestAnimationFrame(animate);
  const dt = clock.getDelta();
  const time = clock.elapsedTime;

  robots.forEach((robot) => {
    robot.update(ball, time, dt);
  });
  ball.update(dt, time, robots);
  updatePulses(time);
  updateCameraMicroMotion(time);

  leftState.textContent = leftBot.status;
  rightState.textContent = rightBot.status;
  ballSpeed.textContent = `${ball.velocity.length().toFixed(1)} m/s`;

  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  renderer.setSize(window.innerWidth, window.innerHeight);
  configureCameraForViewport();
});

animate();
