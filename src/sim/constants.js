// Physical constants and ITTF regulation dimensions (SI units).
// World frame: +y up, x along the table length (left robot at -x, right robot at +x),
// z across the table width. The playing surface is at y = TABLE.height.

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.204; // kg/m^3 at 20 °C
export const AIR_KINEMATIC_VISCOSITY = 1.516e-5;

export const TABLE = Object.freeze({
  length: 2.74,
  width: 1.525,
  height: 0.76,
  halfLength: 1.37,
  halfWidth: 0.7625,
  thickness: 0.025,
  edgeLine: 0.02,
  centreLine: 0.003,
  // ITTF: a 30 cm drop must rebound ~23 cm → e = sqrt(23/30) ≈ 0.876
  restitution: 0.9,
  friction: 0.25,
});

export const NET = Object.freeze({
  height: 0.1525,
  overhang: 0.1525,
  halfLength: TABLE.halfWidth + 0.1525,
  thickness: 0.004,
  restitution: 0.12,
});

export const BALL = Object.freeze({
  radius: 0.02,
  mass: 0.0027,
  // thin spherical shell
  inertia: (2 / 3) * 0.0027 * 0.02 * 0.02,
  area: Math.PI * 0.02 * 0.02,
  dragCoefficient: 0.45,
  // exponential decay of spin from viscous torque (1/s)
  spinDamping: 0.18,
});

export const PADDLE = Object.freeze({
  // elliptical blade head (half axes)
  halfHeight: 0.079,
  halfWidth: 0.0755,
  // blade (≈6 mm) + two sheets of rubber (≈2 mm each)
  halfThickness: 0.005,
  handleLength: 0.1,
  restitution: 0.86,
  friction: 0.55,
});

export const RULES = Object.freeze({
  pointsToWinGame: 11,
  winBy: 2,
  gamesToWinMatch: 3,
  minServeToss: 0.16,
});

export const SIM = Object.freeze({
  // physics integrator rate
  dt: 1 / 1000,
  // camera frame rate
  cameraRate: 200,
});
