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
import { GateSystem } from './src/gates.js';
import { createCircleSpriteTexture } from './src/utils.js';
import { LaserSystem } from './src/lasers.js';
import { GameLoop, Game } from './src/Game.js';
import { ColladaLoader } from 'jsm/loaders/ColladaLoader.js';
import { initPreviewSpaceship } from './src/previewShip.js';


const scoreText = document.querySelector('.score-value');
const levelUpEl = document.querySelector('.level-up');
const h1Text = document.querySelector('h1');
const startButton = document.querySelector('.start-button');
const container = document.querySelector('.container');
const preloader = document.getElementById('preloader');
const loaderPctEl = document.getElementById('loader-pct');
const loaderFillEl = document.getElementById('loader-fill');
const pauseButton = document.querySelector('.pause-button');
const restartButton = document.querySelector('.restart-button');
const header = document.querySelector('header');
const countdown = document.querySelector('.countdown');
const healthText = document.querySelector('.health-value');
const gameOverEl = document.querySelector('.game-over');
const btnPlayAgain = document.querySelector('.btn-play-again');
const btnQuit = document.querySelector('.btn-quit');


const w = window.innerWidth;
const h = window.innerHeight;

const fov = 75;
const aspect = w / h;
const near = 0.1;
const far = 1000;
let score = 35;
let health = 10;
let currentStage = 1;     // Stage 1 baseline
let stage2score = 50;  // Stage 2 threshold
let stage3score = 100;  // Stage 3 threshold
let isStageTransition = false; // guard during stage transitions
const SPAWN_START_U = 0.12; // 0.0..1.0 param along spline; 0.15 ≈ 15% down the tube
const OVERLAY_DURATION_MS = 1200; // how long the four strips take to slide away


const COUNTDOWN_SECONDS = 10; // keep obstacles spawn in sync with countdown

let isRunning = false; // game loop state
let hasStarted = false; // has the game been started at least once
let hazardsShown = false; // visibility gate for boxes/spheres at game start
// player collision radius moved into Game ctx
 // Feature flag: optionally skip loading the ship model so it doesn't need to be in git
const USE_SHIP_MODEL = true;
let pendingStart = false; // start requested but waiting for assets
let assetsReady = false; // all assets loaded
let TOTAL_ASSETS = USE_SHIP_MODEL ? 5 : 4; // model (optional) + 4 audio files
let loadedAssets = 0;

// Music analysis moved into Game
// scroll-controlled speed
const SPEED_MIN = 0.09;
const SPEED_MAX = 0.2;
const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
camera.position.z = 0;

const scene = new THREE.Scene();
{
    const color = 0x000000;
    const density = 0.5;
    scene.fog = new THREE.FogExp2(color, density);
  }

// Initialize score/health display
if (scoreText) scoreText.textContent = `${score}`;
if (healthText) healthText.textContent = `${health}`;


  startButton.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent global click toggle from pausing immediately
    console.log('[index] Start clicked');
    container.classList.add('start');
    h1Text.style.opacity = 0;
    startButton.style.display = 'none';
    controls.enabled = true;
    hasStarted = true;
    // configure preloader gating
    game.configurePreloader({
      totalAssets: TOTAL_ASSETS,
      preloaderEl: preloader,
      loaderPctEl,
      loaderFillEl,
      tryStartBgm,
      startGame: () => { startGame(); pendingStart = false; }
    });
    // defer preloader and asset loading until intro delay completes
    setTimeout(() => {
      console.log('[index] intro delay done');
      if (preloader) preloader.classList.add('show');
      header.style.display = 'flex';
      pendingStart = true;
      if (loaderPctEl) loaderPctEl.textContent = '0%';
      if (loaderFillEl) loaderFillEl.style.width = '0%';
      if (USE_SHIP_MODEL) { game.ctx = { ...game.ctx, assetLoadingManager, player, shipScale, shipYaw, shipPitch, shipRoll, shipForwardAdjustY }; game.loadModel(); }
      // route audio loads via Game helper
      // provide audio deps to Game so it can request files
      game.ctx = { ...game.ctx, audioLoader, audioListener, bgm, sfxPoint, sfxExplosion, sfxLazerGun, bgmMuted, bgmBaseVolume };
      // use Game.loadAudio defined in Game.js
      console.log('[index] calling game.loadAudio');
      game.loadAudio();
      if (container) container.style.display = 'none';
      // notify Game overlay finished; it starts when assets are ready
      console.log('[index] calling game.onOverlayFinished');
      if (game.onOverlayFinished) game.onOverlayFinished();
    }, OVERLAY_DURATION_MS);
    // Arm audio context with a user gesture so playback will succeed after load
    try {
      const ctx = audioListener && audioListener.context;
      if (ctx && ctx.state === 'suspended') ctx.resume();
    } catch (err) {}
  });

  // Pause when mouse leaves the viewport and resume on enter
  window.addEventListener('mouseleave', () => { if (hasStarted) pauseGame(); });
  window.addEventListener('mouseenter', () => { if (hasStarted) resumeGame(); });
  // Fire laser on click (Stage 3+ only)
  window.addEventListener('mousedown', (e) => {
    if (!hasStarted || !isRunning) return;
    if (currentStage < 3) return;
    // play the laser sound every time the player shoots
    if (sfxLazerGun && sfxLazerGun.buffer && !bgmMuted) {
      if (sfxLazerGun.isPlaying) sfxLazerGun.stop();
      sfxLazerGun.play();
    }

   
    // build forward direction from player towards lookAt
    const path = tubeGeometry.parameters.path;
    const lookAt = path.getPointAt(((game.pathU ?? 0) + 0.03) % 1);
    const dir = new THREE.Vector3().subVectors(lookAt, player.position).normalize();
    // origin from slightly in front of ship
    const origin = player.position.clone().add(dir.clone().multiplyScalar(0.1));
    laserSystem.spawn(origin, dir, 0x7ffeff);
  });

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
    // stop and reset BGM so it starts from the beginning
    if (bgm && bgm.isPlaying) bgm.stop();
    // fully restart game state
    resetToStartOfSpline();
    startNewGame();
    pauseButton.textContent = 'Pause';
  });

  // Game Over actions
  if (btnPlayAgain) {
    btnPlayAgain.addEventListener('click', () => {
      if (gameOverEl && gameOverEl.style) gameOverEl.style.display = 'none';
      // Reset everything and start a new run
      if (bgm && bgm.isPlaying) bgm.stop();
      resetToStartOfSpline();
      startNewGame();
      tryStartBgm();
    });
  }
  if (btnQuit) {
    btnQuit.addEventListener('click', () => {
      // Fully quit back to title
      if (gameOverEl && gameOverEl.style) gameOverEl.style.display = 'none';
      isRunning = false;
      game.pause();
      // Hide canvas UI; show title and header appropriately
      const mount = document.body.querySelector('.game-canvas');
      if (mount) mount.innerHTML = '';
      header.style.display = 'none';
      container.style.display = 'flex';
      startButton.style.display = 'inline-block';
      h1Text.style.opacity = 1;
      hasStarted = false;
    });
  }


// renderer/controls initialized after Game instance is created

// allow user to move within the tube cross-section using mouse position (moved to Game)
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

// model loading handled by Game.loadModel()

// countdown handled by Game.countDown via ctx (optional)

// Lights attached to the player so the model is clearly visible
// attach player lights
const playerLight = new THREE.PointLight(0xffffff, 3.0, 10, 1); playerLight.position.set(0, 0.15, 0.3); player.add(playerLight);
const playerBackLight = new THREE.PointLight(0x88aaff, 1.5, 8, 1); playerBackLight.position.set(0, -0.1, -0.4); player.add(playerBackLight);
const playerHemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.0); player.add(playerHemi);

function onPointerMove(e){
    const dom = (game && game.ctx && game.ctx.renderer && game.ctx.renderer.domElement) ? game.ctx.renderer.domElement : null;
    if (!dom) return;
    const rect = dom.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;   // 0..1
    const my = (e.clientY - rect.top) / rect.height;  // 0..1
    game.mouseTarget.x = (mx - 0.5) * 2; // -1..1
    game.mouseTarget.y = (my - 0.5) * 2; // -1..1 (non-inverted Y)
}

window.addEventListener('pointermove', onPointerMove, false);

// reusable soft-circle texture for particles (kept for preview/other modules if needed)

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

// composer will be initialized after Game initializes the renderer

const edgesGeometry = new THREE.EdgesGeometry(tubeGeometry, 0.2);
const lineMaterial = new THREE.LineBasicMaterial({color: 0xffffff});
const tubeLines = new THREE.LineSegments(edgesGeometry, lineMaterial);
scene.add(tubeLines);

// Gates (modularized)
const gateSystem = new GateSystem(scene, tubeGeometry.parameters.path, SPAWN_START_U);

// clouds system
const cloudSystem = new CloudSystem(scene, tubeGeometry.parameters.path, frames, { additive: true });
cloudSystem.populate(320, 0.5);
const setCloudsColor = (...args) => cloudSystem.setColor(...args);


// Obstacles storage
const boxes = [];
const spheres = [];
    
// cloud system update
// cloud updates handled by game.updateClouds

// Reset ship/camera to the start of the spline (fresh-run pose)
function resetToStartOfSpline(){
  game.ctx = { ...game.ctx, tubeGeometry, camera, player, prevPlayerPos, playerDistance, shipOffsetX, shipOffsetY, shipOffsetZ };
  game.resetToStart();
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
const sfxLazerGun = new THREE.Audio(audioListener);
let sfxLazerGunReady = false;


function tryStartBgm() {
    const ctx = audioListener.context;
    if (ctx && ctx.state === 'suspended') {
        ctx.resume();
    }
    if (bgm.buffer && !bgm.isPlaying) {
        bgm.play();
    }
}

// Start audio on any user gesture (required by browsers)
const armAudioOnce = () => {
  tryStartBgm();
  window.removeEventListener('pointerdown', armAudioOnce);
  window.removeEventListener('keydown', armAudioOnce);
};
window.addEventListener('pointerdown', armAudioOnce);
window.addEventListener('keydown', armAudioOnce);

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
    if (sfxLazerGunReady) {
      sfxLazerGun.setVolume(bgmMuted ? 0 : 0.7);
    }
    }
});




const game = new Game({
  scene,
  tubeGeometry,
  frames,
  boxes,
  spheres,
  startGame,
  pauseGame,
  resumeGame,
  startNewGame
});

// Initialize renderer and controls now that game exists
const mount = document.body.querySelector('.game-canvas');
game.initRenderer({ mount, width: w, height: h, camera, scene });
const controls = new OrbitControls(camera, game.ctx.renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enabled = false;

// composer-dependent systems
const composer = game.ctx.composer;
const laserSystem = new LaserSystem(scene, composer);

const gameLoop = new GameLoop((t, dt) => {
  game.updateMusicMetrics(t);
  game.ctx = { ...game.ctx, tubeGeometry, frames, frameSegments, camera, player, prevPlayerPos, playerDistance, shipOffsetX, shipOffsetY, shipOffsetZ, shipBankFactor, shipPitchFactor, cloudSystem, startLoop: () => gameLoop.start(), pauseLoop: () => gameLoop.pause(), resumeLoop: () => gameLoop.resume() };
  game.updateCamera(t, dt);
  game.changeLightColor(t);
  game.ctx = {
    ...game.ctx,
    boxes,
    spheres,
    gameOverEl,
    healthText,
    player,
    prevPlayerPos,
    scene,
    gateSystem,
    light,
    cloudSystem,
    setCloudsColor,
    lineMaterial,
    tubeMaterial,
    // SFX/mute hooks used by Game.addScore/disintegrateBox
    sfxPointReady: !!(sfxPoint && sfxPoint.buffer),
    sfxPoint,
    sfxExplosionReady: !!(sfxExplosion && sfxExplosion.buffer),
    sfxExplosion,
    sfxLazerGunReady: !!(sfxLazerGun && sfxLazerGun.buffer),
    isMuted: () => bgmMuted,
    // Score/stage hooks
    getScore: () => score,
    setScore: (v) => { score = v; if (scoreText) scoreText.textContent = `${score}`; },
    getHealth: () => health,
    setHealth: (v) => { health = v; if (healthText) healthText.textContent = `${health}`; },
    getStage: () => currentStage,
    setStage: (s) => { currentStage = s; },
    stage2score,
    stage3score,
    setHazardsShown: (v) => { hazardsShown = !!v; },
    levelUpEl,
    countdownEl: document.querySelector('.countdown'),
    COUNTDOWN_MS: COUNTDOWN_SECONDS * 1000,
    gameOverEl,
    tryStartBgm
  };
  game.ctx.playerRadius = 0.03;
  game.checkCollisions(hazardsShown);
  game.updateMovers(dt, () => currentStage);
  if (currentStage >= 3) {
    laserSystem.update(dt);
    const hit = laserSystem.findHitBox(boxes);
    if (hit) {
      const { laserIndex, boxIndex } = hit;
      const box = boxes[boxIndex];
      game.disintegrateBox(box, false);
      boxes.splice(boxIndex, 1);
      laserSystem.removeAt(laserIndex);
    }
  }
  game.updateParticles(dt);
  game.updateClouds(t, dt);
  composer.render();
    controls.update();
  // score display is updated via ctx.setScore
});

// Provide lifecycle and UI hooks to Game early so start() can use them before the loop
game.ctx = {
  ...game.ctx,
  startLoop: () => gameLoop.start(),
  pauseLoop: () => gameLoop.pause(),
  resumeLoop: () => gameLoop.resume(),
  setHazardsShown: (v) => { hazardsShown = !!v; },
  countdownEl: document.querySelector('.countdown'),
  COUNTDOWN_MS: COUNTDOWN_SECONDS * 1000
};

function startGame(){ isRunning = true; game.start(); }

function pauseGame(){ isRunning = false; game.pause(); }

function resumeGame(){ isRunning = true; game.resume(); }

function startNewGame(){ game.startNewGame(); }
