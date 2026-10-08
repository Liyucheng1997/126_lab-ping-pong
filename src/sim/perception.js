// Stereo high-speed camera model: pinhole projection, sub-pixel centroid
// noise, frame dropouts, fixed pipeline latency and ray-midpoint triangulation.
//
// Each robot owns a calibrated stereo pair mounted on its top beam. The rig
// returns 3D ball measurements together with a measurement covariance that
// follows the classic stereo error model: lateral σ ≈ dσ_px/f and depth
// σ ≈ d²σ_px/(f·b) for range d and baseline b.

import { BALL } from "./constants.js";
import { vadd, vcross, vdot, vlen, vnorm, vscale, vsub } from "./math.js";

export class PinholeCamera {
  constructor({ position, target, up = { x: 0, y: 1, z: 0 }, width = 1440, height = 1080, hfov = 62 }) {
    this.position = position;
    this.width = width;
    this.height = height;
    this.hfov = hfov;
    this.focal = width / 2 / Math.tan((hfov * Math.PI) / 360);
    this.cx = width / 2;
    this.cy = height / 2;
    this.lookAt(target, up);
  }

  lookAt(target, up = { x: 0, y: 1, z: 0 }) {
    this.target = target;
    // camera axes: forward f, right r, down d (image v grows downwards)
    this.forward = vnorm(vsub(target, this.position));
    this.right = vnorm(vcross(this.forward, up));
    this.down = vcross(this.forward, this.right);
  }

  get vfov() {
    return (2 * Math.atan(this.height / 2 / this.focal) * 180) / Math.PI;
  }

  project(p) {
    const d = vsub(p, this.position);
    const zc = vdot(d, this.forward);
    if (zc < 0.05) return null;
    const u = this.cx + (this.focal * vdot(d, this.right)) / zc;
    const v = this.cy + (this.focal * vdot(d, this.down)) / zc;
    return { u, v, depth: zc };
  }

  inImage(px, margin = 0) {
    return px && px.u >= margin && px.v >= margin && px.u <= this.width - margin && px.v <= this.height - margin;
  }

  ray(u, v) {
    const x = (u - this.cx) / this.focal;
    const y = (v - this.cy) / this.focal;
    return vnorm(vadd(this.forward, vadd(vscale(this.right, x), vscale(this.down, y))));
  }
}

// Closest point between two rays (midpoint method).
export function triangulate(o1, d1, o2, d2) {
  const w0 = vsub(o1, o2);
  const a = vdot(d1, d1);
  const b = vdot(d1, d2);
  const c = vdot(d2, d2);
  const d = vdot(d1, w0);
  const e = vdot(d2, w0);
  const denom = a * c - b * b;
  if (Math.abs(denom) < 1e-12) return null;
  const s = (b * e - c * d) / denom;
  const t = (a * e - b * d) / denom;
  const p1 = vadd(o1, vscale(d1, s));
  const p2 = vadd(o2, vscale(d2, t));
  return { point: vscale(vadd(p1, p2), 0.5), gap: vlen(vsub(p1, p2)) };
}

export class StereoRig {
  constructor({ left, right, rate = 200, latency = 0.006, pixelSigma = 0.45, dropout = 0.015, rng }) {
    this.cameras = [left, right];
    this.rate = rate;
    this.period = 1 / rate;
    this.latency = latency;
    this.pixelSigma = pixelSigma;
    this.dropout = dropout;
    this.rng = rng;
    this.frameIndex = 1; // physics starts at t = dt; the first frame is at one period
    this.pipeline = [];
    this.lastDetections = [null, null];
    this.frames = 0;
    this.detections = 0;
  }

  get baseline() {
    return vlen(vsub(this.cameras[0].position, this.cameras[1].position));
  }

  // Called every physics step with the true ball position; returns the
  // measurements whose processing finished by time `t`.
  update(t, ballPos, visible = true) {
    const eps = 1e-9;
    while (t + eps >= this.frameIndex * this.period) {
      this.capture(this.frameIndex * this.period, ballPos, visible);
      this.frameIndex += 1;
    }
    const ready = [];
    while (this.pipeline.length && this.pipeline[0].readyAt <= t + eps) {
      ready.push(this.pipeline.shift());
    }
    return ready;
  }

  capture(stamp, ballPos, visible) {
    this.frames += 1;
    const pixels = this.cameras.map((cam) => {
      if (!visible || this.rng.next() < this.dropout) return null;
      const px = cam.project(ballPos);
      // the blob must be fully inside the image
      const radiusPx = px ? (cam.focal * BALL.radius) / px.depth : 0;
      if (!cam.inImage(px, radiusPx)) return null;
      return {
        u: px.u + this.rng.gaussian(this.pixelSigma),
        v: px.v + this.rng.gaussian(this.pixelSigma),
        radius: radiusPx,
      };
    });
    this.lastDetections = pixels;
    if (!pixels[0] || !pixels[1]) return;
    const [c1, c2] = this.cameras;
    const tri = triangulate(c1.position, c1.ray(pixels[0].u, pixels[0].v), c2.position, c2.ray(pixels[1].u, pixels[1].v));
    if (!tri || tri.gap > 0.02) return;
    this.detections += 1;
    this.pipeline.push({
      stamp,
      readyAt: stamp + this.latency,
      position: tri.point,
      covariance: this.measurementCovariance(tri.point),
      pixels,
    });
  }

  measurementCovariance(p) {
    const [c1, c2] = this.cameras;
    const centre = vscale(vadd(c1.position, c2.position), 0.5);
    const toBall = vsub(p, centre);
    const range = vlen(toBall);
    const f = c1.focal;
    const sigmaLat = (range * this.pixelSigma) / f;
    const sigmaDepth = (range * range * this.pixelSigma) / (f * this.baseline) * 0.9;
    // orthonormal basis around the viewing direction
    const a = vnorm(toBall);
    const helper = Math.abs(a.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
    const b = vnorm(vcross(a, helper));
    const c = vcross(a, b);
    const basis = [a, b, c];
    const sig2 = [sigmaDepth ** 2, sigmaLat ** 2, sigmaLat ** 2];
    const R = new Float64Array(9);
    const comp = (v, i) => (i === 0 ? v.x : i === 1 ? v.y : v.z);
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        let sum = 0;
        for (let k = 0; k < 3; k += 1) sum += comp(basis[k], i) * comp(basis[k], j) * sig2[k];
        R[i * 3 + j] = sum;
      }
    }
    return R;
  }
}
