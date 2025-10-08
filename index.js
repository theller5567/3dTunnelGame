// Core Three.js library
import * as THREE from 'three';
// Mouse orbit controls (disabled for gameplay; useful for debug)
import { OrbitControls } from 'jsm/controls/OrbitControls.js';
// Spline path describing the tunnel route
import spline from './spline.js';
// Postprocessing composer and passes
import { EffectComposer } from 'jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'jsm/postprocessing/UnrealBloomPass.js';
import { CloudSystem } from './src/clouds.js';
import { createCircleSpriteTexture } from './src/utils.js';
import { ColladaLoader } from 'jsm/loaders/ColladaLoader.js';

const w = window.innerWidth;
const h = window.innerHeight;

const fov = 75;
const aspect = w / h;
const near = 0.1;
const far = 1000;
let score = 0;
let streak = 0;           // consecutive positive gains without losses
let multiplier = 1;       // score multiplier (>=1). 5-streak -> x2
const STREAK_FOR_X2 = 5;  // threshold to activate x2
const SPAWN_START_U = 0.15; // 0.0..1.0 param along spline; 0.15 ≈ 15% down the tube

const scoreText = document.querySelector('.score-value');
const h1Text = document.querySelector('h1');
const startButton = document.querySelector('.start-button');
const container = document.querySelector('.container');
const preloader = document.getElementById('preloader');
const loaderPctEl = document.getElementById('loader-pct');
const loaderFillEl = document.getElementById('loader-fill');
const pauseButton = document.querySelector('.pause-button');
const restartButton = document.querySelector('.restart-button');
let isRunning = false; // game loop state
let hasStarted = false; // has the game been started at least once
let rafId = 0; // current animation frame id
let hazardsShown = false; // visibility gate for boxes/spheres at game start
const PLAYER_RADIUS = 0.03; // approximate collision radius for the ship
let pendingStart = false; // start requested but waiting for assets
const TOTAL_ASSETS = 4; // 1 model + 3 audio files
let loadedAssets = 0;
function updatePreloaderProgress(extra = 0){
  const pct = Math.max(0, Math.min(100, Math.round(((loadedAssets + extra) / TOTAL_ASSETS) * 100)));
  if (loaderPctEl) loaderPctEl.textContent = `${pct}%`;
  if (loaderFillEl) loaderFillEl.style.width = `${pct}%`;
}
function markAssetLoaded(){
  loadedAssets += 1;
  updatePreloaderProgress();
  if (loadedAssets >= TOTAL_ASSETS) {
    if (preloader) preloader.classList.remove('show');
    if (pendingStart) { tryStartBgm(); startGame(); pendingStart = false; }
  }
}

// Music analysis state (declare early so functions can assign safely)
let musicAnalyser = null;   // Web Audio AnalyserNode
let musicFreqData = null;   // Uint8Array for frequency bins
let musicEnergy = 0;     // 0..1
let musicEnergyMA = 0;   // moving average
let musicCentroid = 0;   // 0..1 (low->high)
let musicBeat = false;   // beat detected this frame
let beatLightBoost = 0;  // decays each frame
const ENERGY_SMOOTH = 0.1;
const BEAT_THRESHOLD = 0.18;
const BEAT_COOLDOWN_MS = 200;
let lastBeatMs = 0;
// scroll-controlled speed
const SPEED_MIN = 0.09;
const SPEED_MAX = 0.2;
let speed = 0.1;
let speedTarget = speed;
let pathU = 0; // normalized 0..1 position along the path
const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
camera.position.z = 0;

const scene = new THREE.Scene();
{
    const color = 0x000000;
    const density = 0.5;
    scene.fog = new THREE.FogExp2(color, density);
  }

  function updateScore() {
    scoreText.textContent = `${score}  x${multiplier}`;
  }


  startButton.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent global click toggle from pausing immediately
    container.classList.add('start');
    h1Text.style.opacity = 0;
    startButton.style.display = 'none';
    controls.enabled = true;
    hasStarted = true;
    if (preloader) preloader.classList.add('show');
    if (container) container.style.display = 'none';
    pendingStart = true;
    // Arm audio context with a user gesture so playback will succeed after load
    try {
      const ctx = audioListener && audioListener.context;
      if (ctx && ctx.state === 'suspended') ctx.resume();
    } catch (err) {}
    // Initialize preloader UI to 0%
    if (loaderPctEl) loaderPctEl.textContent = '0%';
    if (loaderFillEl) loaderFillEl.style.width = '0%';
    // Begin loading assets; game will start automatically when done
    loadModel();
    loadAudio();
  });

  // Pause when mouse leaves the viewport and resume on enter
  window.addEventListener('mouseleave', () => { if (hasStarted) pauseGame(); });
  window.addEventListener('mouseenter', () => { if (hasStarted) resumeGame(); });

  pauseButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!hasStarted) return;
    if (preloader && preloader.classList.contains('show')) return;
    if (isRunning) {
      pauseGame();
      pauseButton.textContent = 'Resume';
    } else {
      resumeGame();
      pauseButton.textContent = 'Pause';
    }
  });

  restartButton.addEventListener('click', (e) => {
    e.stopPropagation();
    pauseGame();
    // reset score on restart
    score = 0; streak = 0; multiplier = 1; updateScore();
    tryStartBgm();
    startNewGame();
    pauseButton.textContent = 'Pause';
  });


const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(w, h, true);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMappingExposure = 1.25;
document.body.appendChild(renderer.domElement);


const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enabled = false;

// allow user to move within the tube cross-section using mouse position
const mouseTarget = { x: 0, y: 0 };
const mouseSmoothed = { x: 0, y: 0 };
const crossRadius = 0.35; // must be < tube radius (0.5)
// lateral movement smoothing
const lateralOffset = new THREE.Vector2(0, 0);
const lateralVelocity = new THREE.Vector2(0, 0);
const lateralStiffness = 20; // attraction to target (higher = snappier)
const lateralDamping = 10;   // damping factor (higher = less oscillation)
const lookAtSmoothed = new THREE.Vector3();
const prevPlayerPos = new THREE.Vector3();
const player = new THREE.Group();
scene.add(player);
let playerLoaded = false;
let playerDistance = 0.3; // distance in front of camera to place the player model
// Ship tuning knobs – adjust these to fix orientation/placement
let shipScale = 0.02;     // overall scale of the ship
let shipYaw = 0;   // Y rotation (radians)
let shipPitch = -(Math.PI / 2)  ;           // X rotation (radians)
let shipRoll = Math.PI / 2;            // Z rotation (radians)
let shipOffsetX = 0;         // local X offset
let shipOffsetY = 0;         // local Y offset
let shipOffsetZ = 0;         // local Z offset (forward/back relative to ship)
let shipBankFactor = 0.6;    // roll responsiveness to lateral lean (radians at full lean)
let shipPitchFactor = 0.4;   // pitch responsiveness to vertical lean (radians at full lean)
let shipForwardAdjustY = Math.PI; // add 180° yaw so nose points away from camera

// Load player model (COLLADA)
// Shared loading manager to drive the preloader UI
const assetLoadingManager = new THREE.LoadingManager();
assetLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  const pct = Math.round((itemsLoaded / itemsTotal) * 100);
  if (loaderPctEl) loaderPctEl.textContent = `${pct}%`;
  if (loaderFillEl) loaderFillEl.style.width = `${pct}%`;
};
assetLoadingManager.onLoad = () => { /* progress handled by manual counters */ };

const colladaLoader = new ColladaLoader(assetLoadingManager);
function loadModel(){
colladaLoader.load('assets/models/ship-new.dae', (collada) => {
    const model = collada.scene || collada;
    // scale to fit inside tube comfortably
    model.scale.set(shipScale, shipScale, shipScale);
    // Base orientation: set pitch/yaw/roll here; player.lookAt keeps nose forward
    // Extra yaw to ensure nose points away from camera along tunnel
    model.rotation.set(shipPitch, shipYaw + shipForwardAdjustY, shipRoll);
    // If the model uses basic materials, ensure visible color
    model.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (m.color && m.color.getHex && m.color.getHex() === 0x000000) m.color.setHex(0x6666ff);
          if (m.emissive) {
            m.emissive.setHex(0x111111);
            if (typeof m.emissiveIntensity === 'number') m.emissiveIntensity = 0.8;
          }
          m.needsUpdate = true;
        });
      }
    });
    player.add(model);
    playerLoaded = true;
    markAssetLoaded();
});
}

// Lights attached to the player so the model is clearly visible
const playerLight = new THREE.PointLight(0xffffff, 3.0, 10, 1);
playerLight.position.set(0, 0.15, 0.3);
player.add(playerLight);
const playerBackLight = new THREE.PointLight(0x88aaff, 1.5, 8, 1);
playerBackLight.position.set(0, -0.1, -0.4);
player.add(playerBackLight);
const playerHemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.0);
player.add(playerHemi);

function onPointerMove(e){
    const rect = renderer.domElement.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;   // 0..1
    const my = (e.clientY - rect.top) / rect.height;  // 0..1
    mouseTarget.x = (mx - 0.5) * 2; // -1..1
    mouseTarget.y = (my - 0.5) * 2; // -1..1 (non-inverted Y)
}

window.addEventListener('pointermove', onPointerMove, false);

// Scrollwheel to adjust forward speed
function onWheel(e){
    const delta = Math.sign(e.deltaY) * -0.05; // up = faster, down = slower
    speedTarget = THREE.MathUtils.clamp(speedTarget + delta, SPEED_MIN, SPEED_MAX);
}
window.addEventListener('wheel', onWheel, { passive: true });


// reusable soft-circle texture for particles
const PARTICLE_TEXTURE = createCircleSpriteTexture(64);

const curve = spline.getPoints(100);
const curveGeometry = new THREE.BufferGeometry().setFromPoints(curve);
const curveMaterial = new THREE.LineBasicMaterial({color: 0x0000ff});
const curveMesh = new THREE.Line(curveGeometry, curveMaterial);

//create a tube geometry from the spline
const tubeGeometry = new THREE.TubeGeometry(spline, 222, 0.5, 16, true);
const tubeMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    wireframe: true,
    side: THREE.BackSide,
});
const tubeMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
scene.add(tubeMesh);

// precompute Frenet frames for lateral movement
const frameSegments = 2000;
const frames = spline.computeFrenetFrames(frameSegments, true);

// make the tube line/tube material glow using effect composer
const composer = new EffectComposer(renderer);
composer.setSize(w, h);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(new THREE.Vector2(w, h), 0.5, 0.1, 0.0);
composer.addPass(bloomPass);




const edgesGeometry = new THREE.EdgesGeometry(tubeGeometry, 0.2);
const lineMaterial = new THREE.LineBasicMaterial({color: 0xffffff});
const tubeLines = new THREE.LineSegments(edgesGeometry, lineMaterial);
scene.add(tubeLines);

// Tube color is driven by music (no score-based flashes)

// Score helper that applies streak and multiplier rules
function addScore(delta) {
  if (delta > 0) {
    streak += 1;
    if (streak >= STREAK_FOR_X2) multiplier = 2; // simple rule: 5-in-a-row => x2
    score += delta * multiplier;
    // play point SFX on positive score
    if (sfxPointReady && !bgmMuted) {
      // restart SFX if it was still playing
      if (sfxPoint.isPlaying) sfxPoint.stop();
      sfxPoint.play();
    }
  } else if (delta < 0) {
    streak = 0;
    multiplier = 1;
    score += delta; // penalties are not multiplied
    if (sfxExplosionReady && !bgmMuted) {
      sfxExplosion.play();
    }
  }
}

// clouds system
const cloudSystem = new CloudSystem(scene, tubeGeometry.parameters.path, frames, { additive: true });
cloudSystem.populate(320, 0.5);
const setCloudsColor = (...args) => cloudSystem.setColor(...args);


// Obstacles (spawned after a short delay at game start)
const boxes = [];
const spheres = [];
// Do not spawn obstacles in the first portion of the path so the ship has room

function clearObstacles(){
  for (let i = boxes.length - 1; i >= 0; i--) {
    const b = boxes[i];
    scene.remove(b);
    if (b.geometry) b.geometry.dispose();
    if (b.material) b.material.dispose();
  }
  boxes.length = 0;
  for (let i = spheres.length - 1; i >= 0; i--) {
    const s = spheres[i];
    scene.remove(s);
    if (s.geometry) s.geometry.dispose();
    if (s.material) s.material.dispose();
  }
  spheres.length = 0;
}

function spawnObstacles(boxCount = 150, sphereCount = 170){
  // Boxes
  for (let i = 0; i < boxCount; i++) {
    const size = Math.random() * (0.1 - 0.01) + 0.01; // 0.01 .. 0.1
    const box = new THREE.BoxGeometry(size, size, size);
    // pick a param u that is not near the start of the tube
    const u = SPAWN_START_U + Math.random() * (1 - SPAWN_START_U);
    const pos = tubeGeometry.parameters.path.getPointAt(u);
    pos.x += Math.random() * 0.5 - 0.25;
    pos.y += Math.random() * 0.5 - 0.25;
    const rotation = new THREE.Euler(Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI);
    const boxMaterial = new THREE.MeshPhongMaterial({color: 0xffffff, shininess: 100});
    const boxMesh = new THREE.Mesh(box, boxMaterial);
    boxes.push(boxMesh);
    boxMesh.position.copy(pos);
    boxMesh.rotation.copy(rotation);
    boxMesh.userData.size = size;
    scene.add(boxMesh);
  }
  // Spheres
  for (let i = 0; i < sphereCount; i++) {
    const size = {radius: 0.02};
    const sphereGeometry = new THREE.SphereGeometry(size.radius, 32, 32);
    const u = SPAWN_START_U + Math.random() * (1 - SPAWN_START_U);
    const pos = tubeGeometry.parameters.path.getPointAt(u);
    pos.x += Math.random() * 0.5 - 0.25;
    pos.y += Math.random() * 0.5 - 0.25;
    const rotation = new THREE.Euler(Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI);
    const sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0xffffff}));
    spheres.push(sphereMesh);
    sphereMesh.position.copy(pos);
    sphereMesh.userData.size = size;
    sphereMesh.userData.radius = size.radius;
    sphereMesh.rotation.copy(rotation);
    scene.add(sphereMesh);
  }
}
    

// particle systems spawned from disintegrated boxes
const particleSystems = [];

function disintegrateBox(boxMesh) {
    if (!boxMesh || boxMesh.userData.disintegrated) return;
    boxMesh.userData.disintegrated = true;
    addScore(-1);
    if (sfxExplosionReady && !bgmMuted) {
      sfxExplosion.play();
    }
    // removed score-based tube flash; color now driven by music
    // parameters
    const particleCount = 500;
    const duration = 1.0; // seconds
    const initialSpeed = 0.3; // units/sec

    // create particle geometry in the box's local space
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const size = boxMesh.userData.size || 0.005;
    console.log('size: ',boxMesh.userData.size);
    const half = size * 0.02;
    for (let i = 0; i < particleCount; i++) {
        const ix = i * 3;
        // random point inside the cube
        positions[ix] = (Math.random() * 2 - 1) * half;
        positions[ix + 1] = (Math.random() * 2 - 1) * half;
        positions[ix + 2] = (Math.random() * 2 - 1) * half;
        // random velocity mostly outward
        const rx = (Math.random() * 2 - 1);
        const ry = (Math.random() * 2 - 1);
        const rz = (Math.random() * 2 - 1);
        const len = Math.sqrt(rx * rx + ry * ry + rz * rz) || 1;
        velocities[ix] = (rx / len) * initialSpeed;
        velocities[ix + 1] = (ry / len) * initialSpeed;
        velocities[ix + 2] = (rz / len) * initialSpeed;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const particleSize = THREE.MathUtils.clamp(size * 1.2, 0.003, 0.03);
    const mat = new THREE.PointsMaterial({
        color: boxMesh.material.color.getHex(),
        map: PARTICLE_TEXTURE,
        alphaMap: PARTICLE_TEXTURE,
        size: particleSize,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    const particles = new THREE.Points(geom, mat);
    particles.position.copy(boxMesh.position);
    particles.quaternion.copy(boxMesh.quaternion);
    particles.userData = {
        velocities,
        life: 0,
        duration
    };
    scene.add(particles);
    particleSystems.push(particles);

    // remove the original box
    scene.remove(boxMesh);
    if (boxMesh.geometry) boxMesh.geometry.dispose();
    if (boxMesh.material) boxMesh.material.dispose();
}

function updateParticles(dt) {
    for (let i = particleSystems.length - 1; i >= 0; i--) {
        const p = particleSystems[i];
        const geom = p.geometry;
        const posAttr = geom.getAttribute('position');
        const positions = posAttr.array;
        const vels = p.userData.velocities;
        const life = p.userData.life + dt;
        p.userData.life = life;

        // simple outward drift and fade
        for (let j = 0; j < positions.length; j += 3) {
            positions[j] += vels[j] * dt;
            positions[j + 1] += vels[j + 1] * dt;
            positions[j + 2] += vels[j + 2] * dt;
        }
        posAttr.needsUpdate = true;

        const t = Math.min(life / p.userData.duration, 1);
        p.material.opacity = 1 - t;
        p.material.needsUpdate = true;

        if (life >= p.userData.duration) {
            scene.remove(p);
            p.geometry.dispose();
            if (Array.isArray(p.material)) {
                p.material.forEach(m => m.dispose());
            } else {
                p.material.dispose();
            }
            particleSystems.splice(i, 1);
        }
    }
}

function checkBoxesForDisintegration() {
    if (!hazardsShown) return;
    const currPos = player.position;
    const prevPos = prevPlayerPos;
    const movement = new THREE.Vector3().subVectors(currPos, prevPos);
    const movementLenSq = movement.lengthSq();
    for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (!b || b.userData.disintegrated) continue;
        const size = b.userData.size || 0.05;
        // sphere radius that fully contains the oriented cube (half diagonal)
        const halfDiagonal = Math.sqrt(3) * (size * 0.5);
        const radius = halfDiagonal + PLAYER_RADIUS;
        // quick check at current position
        if (b.position.distanceTo(currPos) <= radius) {
            disintegrateBox(b);
            boxes.splice(i, 1);
            continue;
        }
        // segment-sphere test to avoid tunneling if the ship moved fast
        if (movementLenSq > 0) {
            const segDir = movement.clone();
            const segLen = Math.sqrt(movementLenSq);
            segDir.divideScalar(segLen);
            const m = new THREE.Vector3().subVectors(prevPos, b.position);
            const bdot = m.dot(segDir);
            const c = m.lengthSq() - radius * radius;
            if (c <= 0) {
                disintegrateBox(b);
                boxes.splice(i, 1);
                continue;
            }
            const discr = bdot * bdot - c;
            if (discr >= 0) {
                const tHit = -bdot - Math.sqrt(discr);
                if (tHit >= 0 && tHit <= segLen) {
                    disintegrateBox(b);
                    boxes.splice(i, 1);
                }
            }
        }
    }
}

// cloud system update
function updateClouds(t, dt) {
  cloudSystem.update(t, dt, light.color, musicEnergy, musicBeat);
}

function checkSpheresForPenalty() {
  if (!hazardsShown) return;
  const camPos = player.position;
  const prevPos = prevPlayerPos;
  const movement = new THREE.Vector3().subVectors(camPos, prevPos);
  const movementLenSq = movement.lengthSq();
  for (let i = spheres.length - 1; i >= 0; i--) {
    const s = spheres[i];
    if (!s) continue;
    // radius with margin
    const baseRadius = (s.userData && s.userData.radius != null)
      ? s.userData.radius
      : (s.geometry && s.geometry.parameters && s.geometry.parameters.radius) || 0.02;
    const radius = baseRadius + 0.1;
    // quick check current pos
    if (s.position.distanceTo(camPos) <= radius) {
      addScore(1);
      scene.remove(s);
      if (s.geometry) s.geometry.dispose();
      if (s.material) s.material.dispose();
      spheres.splice(i, 1);
      continue;
    }
    // segment-sphere intersection to catch tunneling
    if (movementLenSq > 0) {
      const segDir = movement.clone();
      const segLen = Math.sqrt(movementLenSq);
      segDir.divideScalar(segLen);
      const m = new THREE.Vector3().subVectors(prevPos, s.position);
      const b = m.dot(segDir);
      const c = m.lengthSq() - radius * radius;
      if (c <= 0) {
        // started inside sphere
        addScore(1);
        scene.remove(s);
        if (s.geometry) s.geometry.dispose();
        if (s.material) s.material.dispose();
        spheres.splice(i, 1);
        continue;
      }
      const discr = b * b - c;
      if (discr >= 0) {
        const tHit = -b - Math.sqrt(discr);
        if (tHit >= 0 && tHit <= segLen) {
          addScore(1);
          scene.remove(s);
          if (s.geometry) s.geometry.dispose();
          if (s.material) s.material.dispose();
          spheres.splice(i, 1);
        }
      }
    }
  }
}

//attach a light to the camera position
scene.add(camera);
const ambient = new THREE.AmbientLight(0x202020, 1);
scene.add(ambient);
const light = new THREE.PointLight(0xffffff, 2, 50, 2);
camera.add(light);

// Background music (starts on first user interaction)
const audioListener = new THREE.AudioListener();
camera.add(audioListener);
const bgm = new THREE.Audio(audioListener);
const audioLoader = new THREE.AudioLoader(assetLoadingManager);
// Hoist audio flags/objects to module scope so other handlers can access them
let bgmReady = false;
let bgmMuted = false;
let bgmBaseVolume = 0.3; // default volume when unmuted

// Point/Explosion SFX
const sfxPoint = new THREE.Audio(audioListener);
let sfxPointReady = false;
const sfxExplosion = new THREE.Audio(audioListener);
let sfxExplosionReady = false;

function loadAudio(){

// Music analysis (declared earlier)

audioLoader.load('assets/soundFX/retro-gaming-271301.mp3', (buffer) => {
    bgm.setBuffer(buffer);
    bgm.setLoop(true);
    bgm.setVolume(bgmMuted ? 0 : bgmBaseVolume);
    bgmReady = true;
    // create analyser once bgm is ready (Web Audio API)
    const ctx = audioListener.context;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256; // 128 bins
    musicFreqData = new Uint8Array(analyser.frequencyBinCount);
      // tap into the audio graph without altering output routing
      if (bgm.getOutput) {
        bgm.getOutput().connect(analyser);
      } else if (bgm.gain) {
        bgm.gain.connect(analyser);
      }
      musicAnalyser = analyser;
      markAssetLoaded();
});


audioLoader.load('assets/soundFX/lazer-gun.mp3', (buffer) => {
  sfxPoint.setBuffer(buffer);
  sfxPoint.setLoop(false);
  sfxPoint.setVolume(bgmMuted ? 0 : 0.7);
  sfxPointReady = true;
  markAssetLoaded();
});

audioLoader.load('assets/soundFX/explosion-9-340460.mp3', (buffer) => {
  sfxExplosion.setBuffer(buffer);
  sfxExplosion.setLoop(false);
  sfxExplosion.setVolume(bgmMuted ? 0 : 0.3);
  sfxExplosionReady = true;
  markAssetLoaded();
});
}

function tryStartBgm() {
    if (!bgmReady) return;
    const ctx = audioListener.context;
    if (ctx && ctx.state === 'suspended') {
        ctx.resume();
    }
    if (!bgm.isPlaying) {
        bgm.play();
    }
}

// Start audio on any user gesture (required by browsers)
window.addEventListener('pointerdown', tryStartBgm);
window.addEventListener('keydown', tryStartBgm);

// Press 'M' to toggle mute/unmute
window.addEventListener('keydown', (e) => {
    if (e.key === 'm' || e.key === 'M') {
        bgmMuted = !bgmMuted;
        if (bgm.isPlaying || bgmReady) {
            bgm.setVolume(bgmMuted ? 0 : bgmBaseVolume);
        }
    if (sfxPointReady) {
      sfxPoint.setVolume(bgmMuted ? 0 : 0.7);
    }
    if (sfxExplosionReady) {
      sfxExplosion.setVolume(bgmMuted ? 0 : 0.7);
    }
    }
});

function updateMusicMetrics(nowMs) {
  musicBeat = false;
  if (!musicAnalyser) return;
  // overall energy
  musicAnalyser.getByteFrequencyData(musicFreqData);
  let sum = 0;
  for (let i = 0; i < musicFreqData.length; i++) sum += musicFreqData[i];
  const avg = sum / musicFreqData.length; // 0..255
  const e = Math.max(0, Math.min(1, avg / 255));
  musicEnergyMA += (e - musicEnergyMA) * ENERGY_SMOOTH;
  musicEnergy = e;
  // rough spectral centroid
  let wsum = 0, asum = 0;
  for (let i = 0; i < musicFreqData.length; i++) { const a = musicFreqData[i]; asum += a; wsum += a * i; }
  musicCentroid = asum > 0 ? (wsum / asum) / (musicFreqData.length - 1) : 0;
  // beat detection (energy spike over moving average)
  if (e - musicEnergyMA > BEAT_THRESHOLD && nowMs - lastBeatMs > BEAT_COOLDOWN_MS) {
    musicBeat = true;
    lastBeatMs = nowMs;
    beatLightBoost = 0.5; // spike added to light intensity
  } else {
    beatLightBoost = Math.max(0, beatLightBoost * 0.9);
  }
}

//create a function that changes the color of the light randomly as camera moves
//color changes should change slowly and smoothly
function changeLightColor(t) {
    // base hue from time, lightly biased by spectral centroid
    const baseH = (t * 0.0001) % 1;
    const h = baseH * 0.9 + musicCentroid * 0.1;
    light.color.setHSL(h, 1, 0.5);
    setCloudsColor(h, 1, 0.5);
    // intensity reacts to energy and beats
    light.intensity = 2 + 1.2 * musicEnergy + beatLightBoost;
    // drive tube/wireframe color by music hue as well
    lineMaterial.color.setHSL(h, 1, 0.6);
    tubeMaterial.color.setHSL(h, 1, 0.6);
}


function updateCamera(t, dt) {
    // smooth speed towards target
    speed += (speedTarget - speed) * 0.08;
    // advance normalized path position
    pathU = (pathU + speed * dt * 0.1) % 1; // 0.1 scales world speed
    const p = pathU;
    const path = tubeGeometry.parameters.path;
    const pos = path.getPointAt(p);
    const nextU = (p + 0.03) % 1; // wrap parameter between 0 and 1
    const lookAt = path.getPointAt(nextU);

    // smooth mouse input with gentle easing (cubic for fine center control)
    const ease = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.7);
    mouseSmoothed.x += (ease(mouseTarget.x) - mouseSmoothed.x) * 0.5;
    mouseSmoothed.y += (ease(mouseTarget.y) - mouseSmoothed.y) * 0.5;

    // get Frenet frame (normal/binormal) at this segment
    const idx = Math.floor(p * frameSegments);
    const normal = frames.normals[idx % frameSegments].clone();
    const binormal = frames.binormals[idx % frameSegments].clone();

    // spring-damper for lateral offset inside tube
    const targetOffset = new THREE.Vector2(
        mouseSmoothed.x * crossRadius,
        mouseSmoothed.y * crossRadius
    );
    // acceleration = k(x_target - x) - c*v
    const accelX = lateralStiffness * (targetOffset.x - lateralOffset.x) - lateralDamping * lateralVelocity.x;
    const accelY = lateralStiffness * (targetOffset.y - lateralOffset.y) - lateralDamping * lateralVelocity.y;
    lateralVelocity.x += accelX * dt;
    lateralVelocity.y += accelY * dt;
    lateralOffset.x += lateralVelocity.x * dt;
    lateralOffset.y += lateralVelocity.y * dt;

    const offset = normal.clone().multiplyScalar(lateralOffset.x)
        .add(binormal.clone().multiplyScalar(lateralOffset.y));

    // Keep camera centered on the spline (no lateral mouse offset)
    const camPos = pos.clone();
    // position player in front of camera along the forward vector
    const forward = new THREE.Vector3().subVectors(lookAt, camPos).normalize();
    // Compute viewport-aligned axes so cursor mapping is consistent
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const upScreen = new THREE.Vector3().crossVectors(right, forward).normalize();
    // Invert vertical so moving cursor up moves ship up on screen
    const offsetScreen = right.clone().multiplyScalar(mouseSmoothed.x * crossRadius)
      .add(upScreen.clone().multiplyScalar(-mouseSmoothed.y * crossRadius));
    // Ship moves within the tube by mouse, using screen-aligned axes
    const playerPos = camPos.clone()
      .add(right.clone().multiplyScalar(shipOffsetX))
      .add(upScreen.clone().multiplyScalar(shipOffsetY))
      .add(forward.clone().multiplyScalar(playerDistance + shipOffsetZ))
      .add(offsetScreen);
    prevPlayerPos.copy(player.position);
    player.position.copy(playerPos);
    player.lookAt(lookAt);
    // Ensure the ship points away from the camera (Three.js lookAt points -Z toward target)
    // Flip around Y so the ship's nose faces forward along the tunnel
    player.rotateY(Math.PI);
    // Bank the ship based on lateral lean (left/right) inside the tube
    const leanX = THREE.MathUtils.clamp(mouseSmoothed.x, -1, 1);
    const leanY = -THREE.MathUtils.clamp(mouseSmoothed.y, -1, 1);
    const bankAngle = -leanX * shipBankFactor;
    const pitchAngle = leanY * shipPitchFactor;
    const bankQuat = new THREE.Quaternion().setFromAxisAngle(forward, bankAngle);
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(right, pitchAngle);
    player.quaternion.multiply(bankQuat).multiply(pitchQuat);
    camera.position.copy(camPos);
    // smooth look-at for reduced jitter
    lookAtSmoothed.lerp(lookAt, 0.35);
    camera.lookAt(lookAtSmoothed);
}

let prevTimeMs = 0;
function animateLoop(t = 0){
    if (!isRunning) return;
    rafId = requestAnimationFrame(animateLoop);
    const dt = ((t - prevTimeMs) * 0.001) || 0;
    prevTimeMs = t;
    updateMusicMetrics(t);
    updateCamera(t, dt);
    changeLightColor(t);
    checkBoxesForDisintegration();
    checkSpheresForPenalty();
    updateParticles(dt);
    updateClouds(t, dt);
    composer.render();
    controls.update();
    updateScore();
}

function startGame(){
  if (isRunning) return;
  isRunning = true;
  prevTimeMs = performance.now();
  rafId = requestAnimationFrame(animateLoop);
  if (bgmReady && bgmMuted === false && !bgm.isPlaying) bgm.play();
  // Delay hazards visibility for 2 seconds to give the player room
  hazardsShown = false;
  clearObstacles();
  setTimeout(() => { hazardsShown = true; spawnObstacles(); }, 5000);
}

function pauseGame(){
  if (!isRunning) return;
  isRunning = false;
  if (rafId) cancelAnimationFrame(rafId);
  if (bgm && bgm.isPlaying) bgm.pause();
}

function resumeGame(){
  if (isRunning) return;
  isRunning = true;
  prevTimeMs = performance.now();
  rafId = requestAnimationFrame(animateLoop);
  if (bgmReady && bgmMuted === false && !bgm.isPlaying) bgm.play();
}

function startNewGame(){
  // Restart full game: reset obstacles and score, then start with spawn delay
  score = 0; streak = 0; multiplier = 1; updateScore();
  hazardsShown = false;
  clearObstacles();
  startGame();
}
