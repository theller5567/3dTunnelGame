import * as THREE from 'three';
import { ColladaLoader } from 'jsm/loaders/ColladaLoader.js';

// Lightweight, self-contained preview renderer for the spaceship model.
// Usage:
// const ctrl = initPreviewSpaceship({
//   canvasId: 'threeD-spaceship',
//   modelUrl: 'assets/models/ship-new.dae',
//   position: { x: 0, y: 0, z: 0 },
//   rotation: { x: -Math.PI * 0.5, y: Math.PI, z: 0 },
//   scale: 0.06,
//   spinSpeed: 0 // radians/sec (0 = static)
// });
// ctrl.setRotation({ x: 0, y: 0, z: 0 });
// ctrl.setPosition({ x: 0, y: 0, z: 0 });
// ctrl.setSpinSpeed(0.5);

export function initPreviewSpaceship(options = {}) {
  const opts = {
    canvasId: 'threeD-spaceship',
    modelUrl: 'assets/models/ship-new.dae',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    scale: 0.06,
    spinSpeed: 0,
    mouseControl: true,
    pitchMax: 0.4, // radians up/down
    yawMax: 0.8,   // radians left/right
    mouseSmooth: 0.15,
    fov: 45,
    ...options,
  };

  const canvas = document.getElementById(opts.canvasId);
  if (!canvas) {
    console.warn(`[previewShip] Canvas not found: #${opts.canvasId}`);
    return null;
  }

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;

  const root = new THREE.Group();
  scene.add(root);

  // Basic lights suitable for a small product preview
  const key = new THREE.PointLight(0xffffff, 2.0, 10, 1);
  key.position.set(1.2, 0.9, 1.5);
  scene.add(key);
  const fill = new THREE.HemisphereLight(0xffffff, 0x223344, 0.8);
  scene.add(fill);

  // Resize handling: size to the canvas element (not the window)
  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  // Frame camera so object is fully visible
  function frameToObject(object, padding = 1.2) {
    const box = new THREE.Box3().setFromObject(object);
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(0.0001, sphere.radius);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const hDist = radius / Math.tan(fov / 2);
    const hFov = 2 * Math.atan(Math.tan(fov / 2) * camera.aspect);
    const wDist = radius / Math.tan(hFov / 2);
    const dist = Math.max(hDist, wDist) * padding;
    // center model at origin for stability
    object.position.sub(sphere.center);
    camera.position.set(0, 0, dist);
    camera.near = Math.max(0.001, dist - radius * 3);
    camera.far = dist + radius * 6;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }

  // Load model
  const loader = new ColladaLoader();
  loader.load(opts.modelUrl, (collada) => {
    const model = collada.scene || collada;
    model.scale.set(opts.scale, opts.scale, opts.scale);
    model.rotation.set(opts.rotation.x, opts.rotation.y, opts.rotation.z);
    root.add(model);
    frameToObject(model);
    // Apply requested root transform (position only; rotation is applied to model)
    root.position.set(opts.position.x, opts.position.y, opts.position.z);
  }, undefined, (err) => {
    console.warn('[previewShip] Failed to load model:', err);
  });

  // Mouse-driven pitch/yaw (in-place) with smoothing
  let targetPitch = 0, targetYaw = 0;
  let currentPitch = 0, currentYaw = 0;
  function onMouseMove(e) {
    const vw = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const vh = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const mx = e.clientX / vw; // 0..1 across the entire viewport
    const my = e.clientY / vh; // 0..1 across the entire viewport
    const nx = (mx - 0.5) * 2; // -1..1
    const ny = (my - 0.5) * 2; // -1..1
    targetYaw = THREE.MathUtils.clamp(nx * opts.yawMax, -opts.yawMax, opts.yawMax);
    targetPitch = THREE.MathUtils.clamp(-ny * opts.pitchMax, -opts.pitchMax, opts.pitchMax);
  }
  function onMouseLeave(ev) {
    // Only reset if the pointer left the window entirely
    const toWindow = ev.relatedTarget === null && ev.target === document.body;
    if (toWindow || ev.type === 'blur') {
      targetPitch = 0; targetYaw = 0;
    }
  }
  if (opts.mouseControl) {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseout', onMouseLeave);
    window.addEventListener('blur', onMouseLeave);
  }

  let prevT = 0;
  let spinAccum = 0;
  function tick(t = 0) {
    requestAnimationFrame(tick);
    const dt = prevT ? (t - prevT) * 0.001 : 0;
    prevT = t;
    // update smoothed pitch/yaw from mouse
    currentPitch += (targetPitch - currentPitch) * opts.mouseSmooth;
    currentYaw += (targetYaw - currentYaw) * opts.mouseSmooth;
    // spin accumulator (separate from mouse yaw)
    if (opts.spinSpeed) spinAccum += opts.spinSpeed * dt;
    root.rotation.x = currentPitch;
    root.rotation.y = spinAccum + currentYaw;
    renderer.render(scene, camera);
  }
  tick();

  // Simple controller API to tweak after init
  return {
    setSpinSpeed(v) { opts.spinSpeed = Number(v) || 0; },
    setScale(s) { if (root.children[0]) root.children[0].scale.set(s, s, s); },
    setRotation(r) {
      const m = root.children[0];
      if (m) m.rotation.set(r.x || 0, r.y || 0, r.z || 0);
    },
    setPosition(p) { root.position.set(p.x || 0, p.y || 0, p.z || 0); },
    setMouseControl(enabled) {
      enabled = !!enabled;
      if (enabled && !opts.mouseControl) {
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseout', onMouseLeave);
        window.addEventListener('blur', onMouseLeave);
      } else if (!enabled && opts.mouseControl) {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseout', onMouseLeave);
        window.removeEventListener('blur', onMouseLeave);
      }
      opts.mouseControl = enabled;
    },
    setMouseSensitivity({ pitchMax, yawMax, smooth } = {}) {
      if (typeof pitchMax === 'number') opts.pitchMax = pitchMax;
      if (typeof yawMax === 'number') opts.yawMax = yawMax;
      if (typeof smooth === 'number') opts.mouseSmooth = smooth;
    },
    dispose() {
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseout', onMouseLeave);
      window.removeEventListener('blur', onMouseLeave);
      renderer.dispose();
    }
  };
}


