// PBR materials and procedurally generated textures (no external assets).

import * as THREE from "three";
import { TABLE } from "../sim/constants.js";

const textureCache = new Map();

function canvasTexture(key, width, height, draw, { repeat = null, srgb = true } = {}) {
  if (textureCache.has(key)) return textureCache.get(key);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  draw(ctx, width, height);
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  textureCache.set(key, tex);
  return tex;
}

function noise(ctx, w, h, amount, alpha = 1) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
    d[i + 3] = d[i + 3] * alpha;
  }
  ctx.putImageData(img, 0, 0);
}

// ---- textures ------------------------------------------------------------------

// Playing surface with ITTF markings: 20 mm white edge lines, 3 mm centre line.
export function tableTopTexture() {
  return canvasTexture("table-top", 2740, 1525, (ctx, w, h) => {
    const px = w / TABLE.length;
    ctx.fillStyle = "#1b4a86";
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 10);
    // faint roller marks of the matte lacquer
    ctx.globalAlpha = 0.035;
    for (let y = 0; y < h; y += 3) {
      ctx.fillStyle = Math.random() > 0.5 ? "#ffffff" : "#000000";
      ctx.fillRect(0, y, w, 1);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#f3f6f8";
    const edge = TABLE.edgeLine * px;
    ctx.fillRect(0, 0, w, edge);
    ctx.fillRect(0, h - edge, w, edge);
    ctx.fillRect(0, 0, edge, h);
    ctx.fillRect(w - edge, 0, edge, h);
    const centre = TABLE.centreLine * px;
    ctx.fillRect(0, h / 2 - centre / 2, w, centre);
    // brand mark near each end
    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#ffffff";
    ctx.font = `600 ${Math.round(0.045 * px)}px "Segoe UI", Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.translate(w * 0.5, h * 0.5);
    ctx.fillText("ITTF · 2.74 × 1.525 m", 0, -h * 0.36);
    ctx.restore();
  });
}

export function tableTopRoughness() {
  return canvasTexture(
    "table-rough",
    512,
    512,
    (ctx, w, h) => {
      ctx.fillStyle = "#9a9a9a";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 40);
    },
    { repeat: [6, 3], srgb: false },
  );
}

export function sportsFloorTexture() {
  return canvasTexture(
    "sports-floor",
    1024,
    1024,
    (ctx, w, h) => {
      ctx.fillStyle = "#5b1f1d";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 16);
      // vinyl sheet seams
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let x = 0; x < w; x += w / 4) ctx.fillRect(x, 0, 2, h);
    },
    { repeat: [4, 2] },
  );
}

export function concreteTexture() {
  return canvasTexture(
    "concrete",
    1024,
    1024,
    (ctx, w, h) => {
      ctx.fillStyle = "#1a1d21";
      ctx.fillRect(0, 0, w, h);
      noise(ctx, w, h, 22);
      ctx.strokeStyle = "rgba(255,255,255,0.035)";
      ctx.lineWidth = 2;
      for (let x = 0; x <= w; x += w / 2) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      for (let y = 0; y <= h; y += h / 2) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    },
    { repeat: [10, 10] },
  );
}

// Knotted net mesh with ≈13 mm cells, used as alpha map.
export function netTexture() {
  return canvasTexture(
    "net",
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 3;
      const cells = 8;
      for (let i = 0; i <= cells; i += 1) {
        const p = (i / cells) * w;
        ctx.beginPath();
        ctx.moveTo(p, 0);
        ctx.lineTo(p, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, p);
        ctx.lineTo(w, p);
        ctx.stroke();
      }
    },
    { repeat: [1830 / 104, 152.5 / 104], srgb: false },
  );
}

export function carbonTexture() {
  return canvasTexture(
    "carbon",
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = "#15171a";
      ctx.fillRect(0, 0, w, h);
      const s = 16;
      for (let y = 0; y < h; y += s) {
        for (let x = 0; x < w; x += s) {
          const horizontal = ((x + y) / s) % 2 === 0;
          const g = ctx.createLinearGradient(x, y, horizontal ? x : x + s, horizontal ? y + s : y);
          g.addColorStop(0, "#1d2024");
          g.addColorStop(0.5, "#34383e");
          g.addColorStop(1, "#1a1c20");
          ctx.fillStyle = g;
          ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
        }
      }
    },
    { repeat: [6, 1] },
  );
}

export function brushedTexture() {
  return canvasTexture(
    "brushed",
    512,
    64,
    (ctx, w, h) => {
      ctx.fillStyle = "#808080";
      ctx.fillRect(0, 0, w, h);
      for (let y = 0; y < h; y += 1) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`;
        ctx.fillRect(0, y, w, 1);
      }
      noise(ctx, w, h, 18);
    },
    { repeat: [1, 1], srgb: false },
  );
}

// Pimpled inverted rubber is smooth on top; give it a fine sponge grain.
export function rubberTexture(color) {
  return canvasTexture(`rubber-${color}`, 256, 256, (ctx, w, h) => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 14);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 22px Arial";
    ctx.textAlign = "center";
    ctx.fillText("ITTF", w / 2, h * 0.9);
  });
}

export function ballTexture() {
  return canvasTexture("ball", 512, 256, (ctx, w, h) => {
    ctx.fillStyle = "#f7f5ee";
    ctx.fillRect(0, 0, w, h);
    noise(ctx, w, h, 5);
    // seam line + printed logo make the spin readable
    ctx.fillStyle = "rgba(160,160,150,0.55)";
    ctx.fillRect(0, h / 2 - 1, w, 2);
    ctx.fillStyle = "#e0662a";
    ctx.font = "bold 46px Arial";
    ctx.textAlign = "center";
    ctx.fillText("★★★", w * 0.25, h * 0.36);
    ctx.fillStyle = "#1f4f8f";
    ctx.font = "bold 34px Arial";
    ctx.fillText("40+", w * 0.75, h * 0.72);
  });
}

export function barrierTexture(text) {
  return canvasTexture(`barrier-${text}`, 1024, 384, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#14315f");
    g.addColorStop(1, "#0c1f3d");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    let size = Math.round(h * 0.22);
    ctx.font = `700 ${size}px "Segoe UI", Arial, sans-serif`;
    const fit = (w * 0.86) / ctx.measureText(text).width;
    if (fit < 1) {
      size = Math.floor(size * fit);
      ctx.font = `700 ${size}px "Segoe UI", Arial, sans-serif`;
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, w / 2, h * 0.47);
    ctx.fillStyle = "#4ed8ff";
    ctx.fillRect(0, h * 0.86, w, h * 0.04);
  });
}

// ---- materials -------------------------------------------------------------------

export function createMaterials() {
  const brushed = brushedTexture();
  return {
    tableTop: new THREE.MeshPhysicalMaterial({
      map: tableTopTexture(),
      roughnessMap: tableTopRoughness(),
      roughness: 0.72,
      metalness: 0,
      specularIntensity: 0.35,
      clearcoat: 0.04,
      clearcoatRoughness: 0.7,
    }),
    tableEdge: new THREE.MeshStandardMaterial({ color: 0x173f73, roughness: 0.5 }),
    tableWhite: new THREE.MeshStandardMaterial({ color: 0xdfe4e8, roughness: 0.6 }),
    steelPainted: new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.42, metalness: 0.6 }),
    steelDark: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.5, metalness: 0.5 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdfe5ea, roughness: 0.12, metalness: 1 }),
    aluminium: new THREE.MeshStandardMaterial({
      color: 0xc7ccd1,
      roughness: 0.32,
      metalness: 0.92,
      roughnessMap: brushed,
    }),
    aluminiumDark: new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 0.35, metalness: 0.85 }),
    railSteel: new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.18, metalness: 1 }),
    carriage: new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.3, metalness: 0.75 }),
    sealRed: new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.5 }),
    motorBlack: new THREE.MeshStandardMaterial({ color: 0x0e0f11, roughness: 0.48, metalness: 0.45 }),
    motorLabel: new THREE.MeshStandardMaterial({ color: 0x8b94a0, roughness: 0.4, metalness: 0.3 }),
    beltRubber: new THREE.MeshStandardMaterial({ color: 0x0b0c0d, roughness: 0.85 }),
    plasticBlack: new THREE.MeshStandardMaterial({ color: 0x131416, roughness: 0.62 }),
    plasticWhite: new THREE.MeshStandardMaterial({ color: 0xe9edf1, roughness: 0.38 }),
    carbon: new THREE.MeshPhysicalMaterial({
      map: carbonTexture(),
      roughness: 0.28,
      metalness: 0.2,
      clearcoat: 0.8,
      clearcoatRoughness: 0.15,
    }),
    rubberRed: new THREE.MeshStandardMaterial({ map: rubberTexture("#c4171f"), roughness: 0.58 }),
    rubberBlack: new THREE.MeshStandardMaterial({ map: rubberTexture("#111214"), roughness: 0.62 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xd2a86f, roughness: 0.7 }),
    woodHandle: new THREE.MeshStandardMaterial({ color: 0xb98a52, roughness: 0.55 }),
    glassLens: new THREE.MeshPhysicalMaterial({
      color: 0x0a1420,
      roughness: 0.05,
      metalness: 0.2,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
    }),
    netMesh: new THREE.MeshStandardMaterial({
      color: 0x0d1a33,
      alphaMap: netTexture(),
      transparent: true,
      alphaTest: 0.3,
      side: THREE.DoubleSide,
      roughness: 0.8,
    }),
    ball: new THREE.MeshPhysicalMaterial({
      map: ballTexture(),
      roughness: 0.42,
      clearcoat: 0.3,
      clearcoatRoughness: 0.4,
    }),
    sportsFloor: new THREE.MeshStandardMaterial({ map: sportsFloorTexture(), roughness: 0.62 }),
    concrete: new THREE.MeshStandardMaterial({ map: concreteTexture(), roughness: 0.88 }),
    cabinet: new THREE.MeshStandardMaterial({ color: 0x3a4048, roughness: 0.45, metalness: 0.4 }),
    rubberFoot: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.9 }),
    cableOrange: new THREE.MeshStandardMaterial({ color: 0xe0661f, roughness: 0.6 }),
    cableGrey: new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.65 }),
  };
}

export function emissive(color, intensity = 2) {
  return new THREE.MeshStandardMaterial({
    color: 0x000000,
    emissive: new THREE.Color(color),
    emissiveIntensity: intensity,
    roughness: 0.4,
  });
}
