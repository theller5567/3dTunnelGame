// Core Three.js library (CDN ESM to avoid bundler requirements)
import * as THREE from 'https://esm.sh/three@0.159.0';
import spline from '../spline.js';
import { Game } from '../Game.js';
import { OrbitControls } from 'https://esm.sh/three@0.159.0/examples/jsm/controls/OrbitControls.js';


const scoreText = document.querySelector('.score-value');
const levelUpEl = document.querySelector('.level-up');
const h1Text = document.querySelector('h1');
const subHeaderText = document.querySelector('p');
const startButton = document.querySelector('.start-button');
const container = document.querySelector('.container');
const preloader = document.getElementById('preloader');
const loaderPctEl = document.getElementById('loader-pct');
const loaderFillEl = document.getElementById('loader-fill');
const pauseButton = document.querySelector('.pause-button');
const restartButton = document.querySelector('.restart-button');
const header = document.querySelector('header');
const healthText = document.querySelector('.health-value');
const gameOverEl = document.querySelector('.game-over');
const btnPlayAgain = document.querySelector('.btn-play-again');
const btnQuit = document.querySelector('.btn-quit');
const barHealth = document.querySelector('.health-bar-fill');
const stageText = document.querySelector('.stage-value');
const btnRules = document.querySelector('.rules');
const exitButton = document.querySelector('.exit-button');
const rulesModal = document.querySelector('.rules-modal');
const quitButton = document.querySelector('.quit-button');
// use existing Game Over quit button

btnRules.addEventListener('click', () => {
  console.log('[index] Rules clicked');
  // show the rules modal
  rulesModal.classList.add('show');
 
});
exitButton.addEventListener('click', () => {
  console.log('[index] Exit clicked');
  // show the rules modal
  rulesModal.classList.remove('show');
  setTimeout(() => {
    container.style.display = 'flex';
  }, 300);
});

const w = window.innerWidth;
const h = window.innerHeight;
let health = 10;
let currentStage = 1;
const SPAWN_START_U = 0.08; // 0.0..1.0 param along spline; 0.15 ≈ 15% down the tube
const OVERLAY_DURATION_MS = 800; // how long the four strips take to slide away
const COUNTDOWN_SECONDS = 5; // keep obstacles spawn in sync with countdown
let isRunning = false; // game loop state
let hasStarted = false; // has the game been started at least once
let hazardsShown = false; // visibility gate for boxes/spheres at game start
const USE_SHIP_MODEL = true; // Feature flag: optionally skip loading the ship model so it doesn't need to be in git

// Create game early so we can call initWorld below
const game = new Game({});
const { camera, scene, light } = game.initSceneCamera({ THREE, width: w, height: h });
// Initialize renderer and controls IMMEDIATELY so handlers can use them
const mount = document.body.querySelector('.game-canvas');
game.initRenderer({ mount, width: w, height: h, camera, scene });
let controls = new OrbitControls(camera, game.ctx.renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05;
controls.enabled = false;

// Initialize score/health display
if (scoreText) scoreText.textContent = `0`;
if (healthText) healthText.textContent = `${health}`;
if (stageText) stageText.textContent = `${currentStage}`;

  startButton.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent global click toggle from pausing immediately
    console.log('[index] Start clicked');
    container.classList.add('start');
    h1Text.style.opacity = 0;
    subHeaderText.style.opacity = 0;
    startButton.style.display = 'none';
    controls.enabled = true;
    hasStarted = true;
    // ensure audio context is resumed and BGM starts on the user gesture
    try { if (typeof tryStartBgm === 'function') tryStartBgm(); } catch(_){}
    game.startWithPreloader({
      useModel: USE_SHIP_MODEL,
      preloaderEl: preloader,
      headerEl: header,
      containerEl: container,
      loaderPctEl,
      loaderFillEl,
      assetLoadingManager,
      delayMs: OVERLAY_DURATION_MS
    });
    // Arm audio context with a user gesture so playback will succeed after load
    try {
      const ctx = audioListener && audioListener.context;
      if (ctx && ctx.state === 'suspended') ctx.resume();
      tryStartBgm();
    } catch (err) {}
  });
  // Pause when mouse leaves the viewport and resume on enter
  window.addEventListener('mouseleave', () => { if (hasStarted) pauseGame(); });
  window.addEventListener('mouseenter', () => { if (hasStarted) resumeGame(); });
  // Fire laser on click (Stage 3+ only)
  window.addEventListener('mousedown', (e) => {
    if (!hasStarted || !isRunning) return;
    // Enable laser fire only when the Game's stage has lasers enabled
    if (!game.lasersEnabled) return;
    // play the laser sound every time the player shoots
    if (game.ctx.sfxLazerGun && game.ctx.sfxLazerGun.buffer && !(game.isMuted && game.isMuted())) {
      if (game.ctx.sfxLazerGun.isPlaying) game.ctx.sfxLazerGun.stop();
      game.ctx.sfxLazerGun.play();
    }
    game.fireLaser(game.ctx.laserSystem, 0x7ffeff);
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
  btnQuit.addEventListener('click', (e) => {
    e.stopPropagation();
    // Fully quit back to title: tear down game instance and UI
    try { if (game && game.pause) game.pause(); } catch(_){}
    try { if (game && game.ctx && game.ctx.bgm && game.ctx.bgm.isPlaying) game.ctx.bgm.stop(); } catch(_){}
    // Remove renderer canvas
    const mount = document.body.querySelector('.game-canvas');
    if (mount) mount.innerHTML = '';
    // Reset flags
    isRunning = false;
    hasStarted = false;
    // Hide overlays and header; show landing
    if (gameOverEl && gameOverEl.style) gameOverEl.style.display = 'none';
    if (header && header.style) header.style.display = 'none';
    if (container && container.style) container.style.display = 'flex';
    if (startButton && startButton.style) startButton.style.display = 'inline-block';
    if (h1Text && h1Text.style) h1Text.style.opacity = 1;
  });
}


// allow user to move within the tube cross-section using mouse position (moved to Game)
const prevPlayerPos = new THREE.Vector3();
game.initWorld({ THREE, scene, spline, COUNTDOWN_SECONDS });

// Shared loading manager to drive the preloader UI
const assetLoadingManager = new THREE.LoadingManager();
assetLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  const pct = Math.round((itemsLoaded / itemsTotal) * 100);
  if (loaderPctEl) loaderPctEl.textContent = `${pct}%`;
  if (loaderFillEl) loaderFillEl.style.width = `${pct}%`;
};

assetLoadingManager.onLoad = () => { /* progress handled by manual counters */ };


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

//create a tube geometry from the spline
const { player, tubeGeometry, tubeMaterial, lineMaterial, frames, frameSegments } = game.ctx;

// Initialize gameplay subsystems (gates, clouds, lasers) in Game (requires composer from renderer)
const systems = game.initGameplaySystems({ SPAWN_START_U });
const gateSystem = systems && systems.gateSystem ? systems.gateSystem : game.ctx.gateSystem;
const cloudSystem = systems && systems.cloudSystem ? systems.cloudSystem : game.ctx.cloudSystem;
const setCloudsColor = systems && systems.setCloudsColor ? systems.setCloudsColor : game.ctx.setCloudsColor;


// Obstacles storage
const boxes = game.ctx.boxes;
const spheres = game.ctx.spheres;
    
// Reset ship/camera to the start of the spline (fresh-run pose)
function resetToStartOfSpline(){ game.ctx = { ...game.ctx, tubeGeometry, camera, player, prevPlayerPos }; game.resetToStart(); }

// Audio setup moved into Game (reuse assetLoadingManager above)
game.initAudio({ THREE, camera, assetLoadingManager });
const { audioListener, audioLoader, bgm, sfxPoint, sfxExplosion, sfxLazerGun } = game.ctx;
const tryStartBgm = () => game.tryStartBgm && game.tryStartBgm();

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
        if (game.toggleMute) game.toggleMute();
    }
});

// Provide API and context to the existing game instance
game.api = { startGame, pauseGame, resumeGame, startNewGame };
game.ctx = {
  ...game.ctx,
  scene,
  tubeGeometry,
  frames,
  boxes,
  spheres,
  levelUpEl,
  countdownEl: document.querySelector('.countdown'),
  gameOverEl,
  COUNTDOWN_MS: COUNTDOWN_SECONDS * 1000
};

// controls already initialized above

// Hand off the render/update loop to Game
game.runLoop();

// Provide lifecycle and UI hooks to Game early so start() can use them before the loop
// Provide hooks and UI state setters once
game.ctx = {
  ...game.ctx,
  setHazardsShown: (v) => { hazardsShown = !!v; },
  onRunningChange: (running) => { isRunning = !!running; },
  // SFX/mute hooks used by Game.addScore/disintegrateBox
  sfxPointReady: !!(game.ctx.sfxPoint && game.ctx.sfxPoint.buffer),
  sfxPoint: game.ctx.sfxPoint,
  sfxExplosionReady: !!(game.ctx.sfxExplosion && game.ctx.sfxExplosion.buffer),
  sfxExplosion: game.ctx.sfxExplosion,
  sfxLazerGunReady: !!(game.ctx.sfxLazerGun && game.ctx.sfxLazerGun.buffer),
  isMuted: () => (game.isMuted ? game.isMuted() : false),
  // Score/health setters for UI
  getScore: () => game.score,
  setScore: (v) => { game.score = v; if (scoreText) scoreText.textContent = `${game.score}`; },
  getHealth: () => health,
  setHealth: (v) => {
    health = v;
    if (healthText && barHealth) { 
      healthText.textContent = `${health}`; 
      barHealth.style.width = `${Math.max(0, Math.min(1, (Number(health)||0)/10))*100}%`; 
    } else {
      if (healthText) healthText.textContent = `${health}`;
      if (barHealth) barHealth.style.width = `${Math.max(0, Math.min(1, (Number(health)||0)/10))*100}%`;
    }
  },
  getStage: () => game.currentStage,
  setStage: (s) => { game.currentStage = s; currentStage = s; if (stageText) stageText.textContent = `${s}`; },
  getCurrentStage: () => currentStage,
  setCurrentStage: (s) => { currentStage = s; if (stageText) stageText.textContent = `${s}`; },
  stage2score: game.stage2score,
  stage3score: game.stage3score,
  stage4score: game.stage4score
};

function startGame(){ isRunning = true; game.start(); }

function pauseGame(){ isRunning = false; game.pause(); }

function resumeGame(){ isRunning = true; game.resume(); }

function startNewGame(){ game.startNewGame(); }

