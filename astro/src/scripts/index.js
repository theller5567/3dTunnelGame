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
const COUNTDOWN_SECONDS = 5; // keep obstacles spawn in sync with countdown
let isRunning = false; // game loop state
const OVERLAY_DURATION_MS = 800; // how long the four strips take to slide away

let hasStarted = false; // has the game been started at least once
let hazardsShown = false; // visibility gate for boxes/spheres at game start
const USE_SHIP_MODEL = true; // Feature flag: optionally skip loading the ship model so it doesn't need to be in git

// Shared loading manager to drive the preloader UI (must be defined before init)
const assetLoadingManager = new THREE.LoadingManager();
assetLoadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
  const pct = Math.round((itemsLoaded / itemsTotal) * 100);
  if (loaderPctEl) loaderPctEl.textContent = `${pct}%`;
  if (loaderFillEl) loaderFillEl.style.width = `${pct}%`;
};
assetLoadingManager.onLoad = () => { /* progress handled by manual counters */ };

// Lifecycle-managed game instance
let game = null;
let controls = null;
let needsReinit = false;

function initGameInstance() {
  const mount = document.body.querySelector('.game-canvas');
  game = new Game({});
  const { camera, scene } = game.initSceneCamera({ THREE, width: w, height: h });
  game.initRenderer({ mount, width: w, height: h, camera, scene });
  controls = new OrbitControls(game.ctx.camera, game.ctx.renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.enabled = false;
  // world and systems
  game.initWorld({ THREE, scene, spline, COUNTDOWN_SECONDS });
  const systems = game.initGameplaySystems({ SPAWN_START_U });
  // audio
  game.initAudio({ THREE, camera: game.ctx.camera, assetLoadingManager });
  // loop
  game.runLoop();
  // Provide hooks and UI state setters once
  game.ctx = {
    ...game.ctx,
    levelUpEl,
    countdownEl: document.querySelector('.countdown'),
    gameOverEl,
    COUNTDOWN_MS: COUNTDOWN_SECONDS * 1000,
    setHazardsShown: (v) => { hazardsShown = !!v; },
    onRunningChange: (running) => { isRunning = !!running; },
    sfxPointReady: !!(game.ctx.sfxPoint && game.ctx.sfxPoint.buffer),
    sfxPoint: game.ctx.sfxPoint,
    sfxExplosionReady: !!(game.ctx.sfxExplosion && game.ctx.sfxExplosion.buffer),
    sfxExplosion: game.ctx.sfxExplosion,
    sfxLazerGunReady: !!(game.ctx.sfxLazerGun && game.ctx.sfxLazerGun.buffer),
    isMuted: () => (game.isMuted ? game.isMuted() : false),
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
}

// initialize one instance on page load
initGameInstance();

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
    // If we previously quit, fully re-init game instance
    const mount = document.querySelector('.game-canvas');
    if (!game || !game.ctx || !game.ctx.renderer || (mount && mount.childElementCount === 0)) {
      initGameInstance();
    }
    if (controls) controls.enabled = true;
    hasStarted = true;
    // reset UI/game state for a fresh run
    try {
      if (game) {
        game.score = 0;
        game.health = 10;
        game.currentStage = 1;
        if (game.ctx && typeof game.ctx.setScore === 'function') game.ctx.setScore(0);
        if (game.ctx && typeof game.ctx.setHealth === 'function') game.ctx.setHealth(10);
        if (game.ctx && typeof game.ctx.setStage === 'function') game.ctx.setStage(1);
      }
    } catch(_){}
    // ensure audio context is resumed and BGM starts on the user gesture
    try { if (game && game.tryStartBgm) game.tryStartBgm(); } catch(_){ }
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
  });
  // Pause when mouse leaves the viewport and resume on enter
  window.addEventListener('mouseleave', () => { if (hasStarted) game.pause(); });
  window.addEventListener('mouseenter', () => { if (hasStarted) game.resume(); });
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
      game.pause();
      pauseButton.textContent = 'Resume';
    } else {
      game.resume();
      pauseButton.textContent = 'Pause'; 
    }
  });
  restartButton.addEventListener('click', (e) => {
    e.stopPropagation();
    game.startNewGame();
    pauseButton.textContent = 'Pause';
  });

  // Game Over actions
  if (btnPlayAgain) {
    btnPlayAgain.addEventListener('click', () => {
      if (gameOverEl && gameOverEl.style) gameOverEl.style.display = 'none';
      game.startNewGame();
    });
  }
if (btnQuit) {
  btnQuit.addEventListener('click', (e) => {
    e.stopPropagation();
    // Fully quit back to title: tear down via Game.quit
    try { if (game && game.quit) game.quit(); } catch(_){ }
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

