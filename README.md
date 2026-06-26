# Ping Pong Robot Arena

A Three.js simulation of two gantry-style table tennis robots playing against each other.

## Features

- Gantry robot model with camera, horizontal slide, vertical slide, striker slide, and paddle.
- Ball detection visualization with camera frustum, tracking reticle, and scan line.
- Toggle controls for prediction trajectory and camera visualization.
- Vision-based control loop using measured ball position and estimated velocity.
- Table tennis scoring: 11 points, win by 2, serve rotation every 2 points before deuce and every point after deuce.
- Failure detection for misses, wrong-side bounces, double bounces, service faults, and rally timeout.

## Run

```bash
npm install
npm run dev
```

Open the local URL printed by Vite.

## Build

```bash
npm run build
```

## Version

Current version: `1.0.0`
