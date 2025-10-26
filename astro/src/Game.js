import * as THREE from 'https://esm.sh/three@0.159.0';
import { CloudSystem } from './clouds.js';
import { GateSystem } from './gates.js';
import { LaserSystem } from './lasers.js';
import { createCircleSpriteTexture } from './utils.js';
import { EffectComposer } from 'https://esm.sh/three@0.159.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://esm.sh/three@0.159.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://esm.sh/three@0.159.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'https://esm.sh/three@0.159.0/examples/jsm/loaders/GLTFLoader.js';


export class GameLoop {
  constructor(updateFn) {
    this.updateFn = updateFn; // (t, dt) => void
    this.isRunning = false;
    this.rafId = 0;
    this.prevTimeMs = 0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.prevTimeMs = performance.now();
    this.rafId = requestAnimationFrame(this._tick);
  }

  pause() {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.rafId) cancelAnimationFrame(this.rafId);
  }

  resume() { this.start(); }

  _tick = (t) => {
    if (!this.isRunning) return;
    this.rafId = requestAnimationFrame(this._tick);
    const dt = ((t - this.prevTimeMs) * 0.001) || 0;
    this.prevTimeMs = t;
    try { this.updateFn(t, dt); } catch (e) { console.error('GameLoop update error', e); }
  }
}

// Thin coordinator to encapsulate core game controls incrementally.
export class Game {
  constructor(apiOrCtx) {
    // api for controls or full ctx for world access
    this.api = apiOrCtx && (apiOrCtx.startGame || apiOrCtx.tubeGeometry) ? apiOrCtx : {};
    this.ctx = apiOrCtx && apiOrCtx.tubeGeometry ? apiOrCtx : null;
    // preloader state
    this.totalAssets = 0;
    this.loadedAssets = 0;
    this.assetsReady = false;
    this.overlayFinished = false;
    this.preloaderEl = null;
    this.loaderPctEl = null;
    this.loaderFillEl = null;
    this.tryStartBgm = null;
    this.startGameCb = null;
    this.minPreloadMs = 1000;
    this.preloaderShownAt = 0;
    // particles
    this.particleSystems = [];
    this.particleTexture = createCircleSpriteTexture(64);
    // music metrics
    this.musicAnalyser = null;
    this.musicFreqData = null;
    this.musicEnergy = 0;
    this.musicEnergyMA = 0;
    this.musicCentroid = 0;
    this.musicBeat = false;
    this.beatLightBoost = 0;
    this.lastBeatMs = 0;
    this.ENERGY_SMOOTH = 0.1;
    this.BEAT_THRESHOLD = 0.18;
    this.BEAT_COOLDOWN_MS = 200;
    // movement state
    this.speed = 0.1;
    this.speedTarget = 0.1;
    this.pathU = 0; // 0..1 along spline
    this.mouseTarget = { x: 0, y: 0 };
    this.mouseSmoothed = { x: 0, y: 0 };
    this.crossRadius = 0.35;
    this.lateralOffset = new THREE.Vector2(0, 0);
    this.lateralVelocity = new THREE.Vector2(0, 0);
    this.lateralStiffness = 20;
    this.lateralDamping = 10;
    this.lookAtSmoothed = new THREE.Vector3();
    this._isRunning = false;
    this.health = 10;
    this.score = 0;
    this.currentStage = 1;
    this.stage2score = 50;
    this.stage3score = 100;
    this.stage4score = 200;
    this.lasersEnabled = false;
    this.laserAmount = 1;
    // Stage config (default). Each entry corresponds to advancing INTO stage N+2.
    // Example: stages[0] is config applied when entering Stage 2
    this.stages = [
      { //stage 2
        threshold: 50,
        spawn: { boxes: 220, spheres: 220, gates: 16 },
        speedDelta: 0.03,
        enableMovers: false,
        movementSpeedScale: 1.0,
        gates: {
          radiusMin: 0.22,     // min ring radius for spawns in this stage
          radiusMax: 0.28,     // max ring radius
          movers: true,       // gates stay static in stage 2
          moveSpeed: 0.6,      // not used when movers=false
          moveAmplitude: 0.18   // not used when movers=false
        }
      },
      { //stage 3
        threshold: 100,
        spawn: { boxes: 260, spheres: 260, gates: 20 },
        speedDelta: 0.00,
        enableMovers: true,
        movementSpeedScale: 1.2,
        lasers: true,
        gates: {
          radiusMin: 0.10,
          radiusMax: 0.20,
          movers: false,        // gates stay static in stage 3
          moveSpeed: 0.6,      // higher = faster drift
          moveAmplitude: 0.18  // how far gates can drift in cross-section
        }
      },
      { //stage 4
        threshold: 200,
        spawn: { boxes: 300, spheres: 300, gates: 24 },
        speedDelta: 0.06,
        enableMovers: true,
        movementSpeedScale: 1.4,
        lasers: true,
        laserAmount: 2,
        bgmSrc: 'assets/soundFX/victory-awaits-in-the-gaming-universe_astronaut-265184.mp3',
        gates: {
          radiusMin: 0.18,
          radiusMax: 0.24,
          movers: true,
          moveSpeed: 0.9,
          moveAmplitude: 0.22
        }
      },
      { //stage 5
        threshold: 400,
        spawn: { boxes: 400, spheres: 300, gates: 24 },
        speedDelta: 0.06,
        enableMovers: true,
        movementSpeedScale: 1.4,
        lasers: true,
        laserAmount: 3,
        //bgmSrc: 'assets/soundFX/victory-awaits-in-the-gaming-universe_astronaut-265184.mp3',
        gates: {
          radiusMin: 0.16,
          radiusMax: 0.22,
          movers: true,
          moveSpeed: 0.9,
          moveAmplitude: 0.22
        }
      },
      { //stage 6
        threshold: 400,
        spawn: { boxes: 500, spheres: 320, gates: 30 },
        speedDelta: 0.06,
        enableMovers: true,
        movementSpeedScale: 1.4,
        lasers: true,
        laserAmount: 4,
        bgmSrc: 'assets/soundFX/ultimate-gaming-soundtrack-for-legends_astronaut-272122.mp3',
        gates: {
          radiusMin: 0.16,
          radiusMax: 0.22,
          movers: true,
          moveSpeed: 0.9,
          moveAmplitude: 0.22
        }
      }

    ];
    this.movementSpeedScale = 1.0;
    this._bgmBuffers = {};
  }

  initWorld({ THREE, scene, spline, COUNTDOWN_SECONDS = 10 }) {
    if (!scene || !THREE || !spline) return;
    // Player group and lights
    const player = new THREE.Group();
    scene.add(player);
    //const playerLight = new THREE.PointLight(0xffffff, 3.0, 10, 1); playerLight.position.set(0, 0.15, 0.3); player.add(playerLight);
    const playerBackLight = new THREE.PointLight(0x88aaff, 1.5, 8, 1); playerBackLight.position.set(0, -0.1, -0.4); player.add(playerBackLight);
    //const playerHemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.0); player.add(playerHemi);

    // Tube geometry and helpers
    const tubeGeometry = new THREE.TubeGeometry(spline, 222, 0.5, 16, true);
    const tubeMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, side: THREE.BackSide });
    const tubeMesh = new THREE.Mesh(tubeGeometry, tubeMaterial);
    scene.add(tubeMesh);
    const edgesGeometry = new THREE.EdgesGeometry(tubeGeometry, 0.2);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    const tubeLines = new THREE.LineSegments(edgesGeometry, lineMaterial);
    scene.add(tubeLines);
    const frameSegments = 2000;
    const frames = spline.computeFrenetFrames(frameSegments, true);

    // Containers
    const boxes = [];
    const spheres = [];
    const prevPlayerPos = new THREE.Vector3();

    // Save to ctx
    this.ctx = {
      ...this.ctx,
      player,
      playerDistance: 0.3,
      shipScale: 0.02,
      shipYaw: 0,
      shipPitch: -(Math.PI / 2),
      shipRoll: Math.PI / 2,
      shipOffsetX: 0,
      shipOffsetY: 0,
      shipOffsetZ: 0,
      shipBankFactor: 0.6,
      shipPitchFactor: 0.4,
      shipForwardAdjustY: Math.PI,
      tubeGeometry,
      tubeMaterial,
      lineMaterial,
      frames,
      frameSegments,
      boxes,
      spheres,
      prevPlayerPos,
      COUNTDOWN_MS: COUNTDOWN_SECONDS * 1000
    };
    // Place camera/player at start so scene is visible before countdown
    try { this.resetToStart(); } catch(_){}
    return this.ctx;
  }

  initSceneCamera({ THREE, width, height, fov = 75, near = 0.1, far = 1000 }) {
    if (!THREE) return;
    const aspect = (width && height) ? (width / height) : 1;
    const camera = new THREE.PerspectiveCamera(fov, aspect, near, far);
    camera.position.z = 0;
    const scene = new THREE.Scene();
    try { scene.fog = new THREE.FogExp2(0x000000, 0.5); } catch (_) {}
    scene.add(camera);
    const ambient = new THREE.AmbientLight(0x202020, 1);
    scene.add(ambient);
    const light = new THREE.PointLight(0xffffff, 2, 50, 2);
    camera.add(light);
    this.ctx = { ...this.ctx, camera, scene, light };
    return { camera, scene, light };
  }

  initAudio({ THREE, camera, assetLoadingManager }) {
    if (!THREE || !camera) return;
    const audioListener = new THREE.AudioListener();
    camera.add(audioListener);
    const bgm = new THREE.Audio(audioListener);
    const audioLoader = new THREE.AudioLoader(assetLoadingManager);
    const sfxPoint = new THREE.Audio(audioListener);
    const sfxExplosion = new THREE.Audio(audioListener);
    const sfxLazerGun = new THREE.Audio(audioListener);
    this.ctx = {
      ...this.ctx,
      audioListener,
      audioLoader,
      bgm,
      sfxPoint,
      sfxExplosion,
      sfxLazerGun,
      bgmMuted: false,
      bgmBaseVolume: 0.3
    };
    this.tryStartBgm = () => {
      try {
        const ctx = audioListener.context;
        if (ctx && ctx.state === 'suspended') ctx.resume();
        if (bgm.buffer && !bgm.isPlaying) bgm.play();
      } catch(_){}
    };
    this.isMuted = () => !!(this.ctx && this.ctx.bgmMuted);
    this.setMuted = (muted) => {
      if (!this.ctx) return;
      this.ctx.bgmMuted = !!muted;
      const vol = this.ctx.bgmMuted ? 0 : (this.ctx.bgmBaseVolume || 0.3);
      try { if (bgm && (bgm.isPlaying || bgm.buffer)) bgm.setVolume(vol); } catch(_){ }
      try { if (sfxPoint && sfxPoint.buffer) sfxPoint.setVolume(this.ctx.bgmMuted ? 0 : 0.7); } catch(_){ }
      try { if (sfxExplosion && sfxExplosion.buffer) sfxExplosion.setVolume(this.ctx.bgmMuted ? 0 : 0.7); } catch(_){ }
      try { if (sfxLazerGun && sfxLazerGun.buffer) sfxLazerGun.setVolume(this.ctx.bgmMuted ? 0 : 0.7); } catch(_){ }
    };
    this.toggleMute = () => this.setMuted(!this.isMuted());
    return this.ctx;
  }

  setStages(stages) { if (Array.isArray(stages)) this.stages = stages.slice(); }

  async changeBgm(src) {
    const { audioLoader, bgm } = this.ctx || {};
    if (!audioLoader || !bgm || !src) return;
    return new Promise((resolve) => {
      try {
        const cached = this._bgmBuffers && this._bgmBuffers[src];
        const apply = (buffer) => {
          try { if (bgm.isPlaying) bgm.stop(); } catch(_){}
          bgm.setBuffer(buffer);
          bgm.setLoop(true);
          const vol = (this.ctx && this.ctx.bgmMuted) ? 0 : (this.ctx && this.ctx.bgmBaseVolume != null ? this.ctx.bgmBaseVolume : 0.3);
          bgm.setVolume(vol);
          if (this.tryStartBgm) this.tryStartBgm();
          resolve(true);
        };
        if (cached) {
          apply(cached);
        } else {
          audioLoader.load(src, (buffer) => { apply(buffer); }, undefined, () => resolve(false));
        }
      } catch(_) { resolve(false); }
    });
  }

  _getTargetBgmVolume() {
    if (!this.ctx) return 0.3;
    if (this.ctx.bgmMuted) return 0;
    return (this.ctx.bgmBaseVolume != null) ? this.ctx.bgmBaseVolume : 0.3;
  }

  async crossfadeBgm(nextSrc, durationMs = 800) {
    const { audioListener, audioLoader, camera } = this.ctx || {};
    if (!audioListener || !audioLoader || !nextSrc) return false;
    const targetVol = this._getTargetBgmVolume();
    const current = this.ctx && this.ctx.bgm;
    // Get (or load) next buffer
    const nextBuf = this._bgmBuffers && this._bgmBuffers[nextSrc];
    const startWithBuffer = async (buffer) => {
      if (!buffer) return false;
      const next = new THREE.Audio(audioListener);
      next.setBuffer(buffer);
      next.setLoop(true);
      next.setVolume(0);
      try { if (camera && camera.add) camera.add(next); } catch(_){}
      try { next.play(); } catch(_){}
      // Promote immediately so any subsequent tryStartBgm affects the new track
      this.ctx.bgm = next;
      const start = performance.now();
      const fade = () => {
        const t = Math.min(1, (performance.now() - start) / Math.max(1, durationMs));
        let startVol = targetVol;
        try { if (current && current.getVolume) startVol = current.getVolume(); } catch(_){}
        const outVol = (1 - t) * startVol;
        const inVol = t * targetVol;
        try { if (current && current.setVolume) current.setVolume(outVol); } catch(_){ }
        try { next.setVolume(inVol); } catch(_){ }
        if (t < 1) {
          requestAnimationFrame(fade);
        } else {
          try { if (current && current.isPlaying) current.stop(); } catch(_){ }
        }
      };
      fade();
      return true;
    };
    if (nextBuf) {
      return startWithBuffer(nextBuf);
    }
    return new Promise((resolve) => {
      audioLoader.load(nextSrc, (buffer) => {
        if (this._bgmBuffers) this._bgmBuffers[nextSrc] = buffer;
        startWithBuffer(buffer).then(resolve);
      }, undefined, () => resolve(false));
    });
  }

  fireLaser(laserSystem, color = 0x7ffeff, amount) {
    const { tubeGeometry, player, camera, renderer } = this.ctx || {};
    const system = laserSystem || (this.ctx && this.ctx.laserSystem);
    if (!system || !tubeGeometry || !player) return;
    const path = tubeGeometry.parameters && tubeGeometry.parameters.path;
    if (!path || !path.getPointAt) return;
    const lookAt = path.getPointAt(((this.pathU || 0) + 0.03) % 1);
    const dir = new THREE.Vector3().subVectors(lookAt, player.position).normalize();
    const origin = player.position.clone().add(dir.clone().multiplyScalar(0.1));
    const num = Math.max(1, amount || this.laserAmount || 1);
    // compute world-units per pixel at the player's depth for ~30px spacing
    let worldPerPixel = 0.02; // fallback
    try {
      if (camera) {
        const camPos = new THREE.Vector3();
        camera.getWorldPosition(camPos);
        const d = camPos.distanceTo(origin);
        const fovRad = (camera.fov || 75) * Math.PI / 180;
        const visibleHeight = 2 * Math.tan(fovRad / 2) * d;
        const size = renderer && renderer.getSize ? renderer.getSize(new THREE.Vector2()) : { y: (typeof window !== 'undefined' ? window.innerHeight : 1080) };
        const viewportH = size.y || (typeof window !== 'undefined' ? window.innerHeight : 1080);
        worldPerPixel = visibleHeight / Math.max(1, viewportH);
      }
    } catch(_){ }
    const pixelSpacing = 50;
    const spacingWorld = pixelSpacing * worldPerPixel;
    // build a right vector relative to camera up so offsets are horizontal on screen
    const right = new THREE.Vector3().crossVectors(dir, (camera && camera.up) ? camera.up : new THREE.Vector3(0,1,0)).normalize();
    const span = spacingWorld * (num - 1);
    const start = -span / 2;
    for (let i = 0; i < num; i++) {
      const off = start + i * spacingWorld;
      const spawnOrigin = origin.clone().add(right.clone().multiplyScalar(off));
      system.spawn(spawnOrigin, dir, color, 1);
    }
  }

  

  startWithPreloader({
    useModel = true,
    preloaderEl,
    headerEl,
    containerEl,
    loaderPctEl,
    loaderFillEl,
    assetLoadingManager,
    delayMs = 1200
  } = {}) {
    // count unique stage bgm tracks for preloading
    const seen = new Set();
    let extraBgm = 0;
    if (Array.isArray(this.stages)) {
      for (const s of this.stages) {
        const src = s && s.bgmSrc;
        if (src && !seen.has(src)) { seen.add(src); extraBgm += 1; }
      }
    }
    const totalAssets = (useModel ? 5 : 4) + extraBgm;
    this.configurePreloader({ totalAssets, preloaderEl, loaderPctEl, loaderFillEl });
    setTimeout(() => {
      try {
        if (preloaderEl) preloaderEl.classList.add('show');
        if (headerEl && headerEl.style) headerEl.style.display = 'flex';
        if (loaderPctEl) loaderPctEl.textContent = '0%';
        if (loaderFillEl) loaderFillEl.style.width = '0%';
      } catch (_){ }
      if (useModel) {
        this.ctx = { ...this.ctx, assetLoadingManager };
        this.loadModel();
      }
      // audio loader already initialized via initAudio; just kick loads
      this.loadAudio();
      if (containerEl && containerEl.style) containerEl.style.display = 'none';
      if (typeof this.onOverlayFinished === 'function') this.onOverlayFinished();
    }, Math.max(0, delayMs || 0));
  }
  _emitHealth() {
    try { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('game:health', { detail: this.health })); } catch(_){}
  }
  start() { this.api && this.api.startGame && this.api.startGame(); }
  pause() { this.api && this.api.pauseGame && this.api.pauseGame(); }
  resume() { this.api && this.api.resumeGame && this.api.resumeGame(); }
  restart() { this.api && this.api.startNewGame && this.api.startNewGame(); }

  // Delegated obstacle methods (optional usage)
  clearObstacles() {
    const { scene, boxes, spheres, gateSystem } = this.ctx || {};
    if (!scene || !boxes || !spheres) return;
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      scene.remove(b);
      if (b && b.geometry) b.geometry.dispose();
      if (b && b.material) b.material.dispose();
    }
    boxes.length = 0;
    for (let i = spheres.length - 1; i >= 0; i--) {
      const s = spheres[i];
      scene.remove(s);
      if (s && s.geometry) s.geometry.dispose();
      if (s && s.material) s.material.dispose();
    }
    spheres.length = 0;
    if (gateSystem && typeof gateSystem.clear === 'function') {
      gateSystem.clear();
    }
  }

  loadAudio() {
    if (this.audioLoadingStarted) return;
    this.audioLoadingStarted = true;
    let { audioLoader, audioListener, bgm, sfxPoint, sfxExplosion, sfxLazerGun, bgmMuted, bgmBaseVolume } = this.ctx || {};
    // Fallback: create a loader if not provided (progress won't be tracked by external manager)
    if (!audioLoader) audioLoader = new THREE.AudioLoader();
    if (!audioListener || !bgm) return;
    try { console.log('[Game] loadAudio start'); } catch (_e) {}
    // BGM-1
    audioLoader.load('assets/soundFX/retro-gaming-271301.mp3', (buffer) => {
      try { console.log('[Game] BGM loaded'); } catch (_e) {}
      bgm.setBuffer(buffer);
      bgm.setLoop(true);
      const vol = (this.ctx && this.ctx.bgmMuted) ? 0 : (this.ctx && this.ctx.bgmBaseVolume != null ? this.ctx.bgmBaseVolume : 0.3);
      bgm.setVolume(vol);
      if (!this.musicAnalyser) {
        const ctx = audioListener.context;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        this.musicFreqData = new Uint8Array(analyser.frequencyBinCount);
        if (bgm.getOutput) { bgm.getOutput().connect(analyser); }
        else if (bgm.gain) { bgm.gain.connect(analyser); }
        this.musicAnalyser = analyser;
      }
      // If user has already interacted, start BGM immediately
      // If user has already interacted, start BGM immediately
      try {
        const ctx = audioListener && audioListener.context;
        if (ctx && ctx.state === 'suspended') ctx.resume();
      } catch(_){}
      if (this.tryStartBgm) this.tryStartBgm();
      this.markAssetLoaded();
    }, undefined, (err) => { try { console.error('[Game] BGM load error', err); } catch(_e) {} this.markAssetLoaded(); });
    // Preload stage BGMs (if configured)
    try {
      const unique = new Set();
      if (Array.isArray(this.stages)) {
        for (const s of this.stages) {
          const src = s && s.bgmSrc;
          if (src && !unique.has(src)) {
            unique.add(src);
            audioLoader.load(src, (buffer) => {
              this._bgmBuffers[src] = buffer;
              this.markAssetLoaded();
            }, undefined, () => { this.markAssetLoaded(); });
          }
        }
      }
    } catch(_){ }
    // Laser SFX
    if (sfxLazerGun) {
      audioLoader.load('assets/soundFX/lazer-gun.mp3', (buffer) => {
        try { console.log('[Game] SFX lazer loaded'); } catch (_e) {}
        sfxLazerGun.setBuffer(buffer);
        sfxLazerGun.setLoop(false);
        sfxLazerGun.setVolume(bgmMuted ? 0 : 0.7);
        this.markAssetLoaded();
      }, undefined, (err) => { try { console.error('[Game] SFX lazer load error', err); } catch(_e) {} this.markAssetLoaded(); });
    }
    // Coin SFX
    if (sfxPoint) {
      audioLoader.load('assets/soundFX/coin-grab.wav', (buffer) => {
        try { console.log('[Game] SFX coin loaded'); } catch (_e) {}
        sfxPoint.setBuffer(buffer);
        sfxPoint.setLoop(false);
        sfxPoint.setVolume(bgmMuted ? 0 : 0.3);
        this.markAssetLoaded();
      }, undefined, (err) => { try { console.error('[Game] SFX coin load error', err); } catch(_e) {} this.markAssetLoaded(); });
    }
    // Explosion SFX
    if (sfxExplosion) {
      audioLoader.load('assets/soundFX/new-explosion.wav', (buffer) => {
        try { console.log('[Game] SFX explosion loaded'); } catch (_e) {}
        sfxExplosion.setBuffer(buffer);
        sfxExplosion.setLoop(false);
        sfxExplosion.setVolume(bgmMuted ? 0 : 0.3);
        this.markAssetLoaded();
      }, undefined, (err) => { try { console.error('[Game] SFX explosion load error', err); } catch(_e) {} this.markAssetLoaded(); });
    }
  }

  loadModel() {
    const { assetLoadingManager, player, shipScale=0.02, shipYaw=0,
            shipPitch=-(Math.PI/2), shipRoll=Math.PI, shipForwardAdjustY=Math.PI } = this.ctx || {};
    if (!player) return;

    const loader = new GLTFLoader(assetLoadingManager);
    loader.load('assets/models/ship-new.glb', (gltf) => {
      const model = gltf && (gltf.scene || (Array.isArray(gltf.scenes) ? gltf.scenes[0] : null));
      if (!model) { this.markAssetLoaded(); return; }

      model.scale.set(shipScale, shipScale, shipScale);
      // Restore the same orientation you had previously
      // Apply a roll offset so wings are horizontal (east-west)
      model.rotation.set(shipPitch, (shipYaw - Math.PI/2) + shipForwardAdjustY, shipRoll);
      player.add(model);
      this.ctx.shipModel = model;
      this.markAssetLoaded();
    }, undefined, () => this.markAssetLoaded());
  }

  updateCamera(t, dt) {
    const {
      tubeGeometry,
      frames,
      frameSegments,
      camera,
      player,
      prevPlayerPos,
      playerDistance,
      shipOffsetX,
      shipOffsetY,
      shipOffsetZ,
      shipBankFactor,
      shipPitchFactor
    } = this.ctx || {};
    if (!tubeGeometry || !frames || !camera || !player || !prevPlayerPos) return;
    const path = tubeGeometry.parameters && tubeGeometry.parameters.path;
    if (!path || typeof path.getPointAt !== 'function') return;
    // smooth speed towards target
    this.speed += ((this.speedTarget ?? 0.1) - this.speed) * 0.08;
    // advance along path
    this.pathU = (this.pathU + this.speed * dt * 0.1) % 1;
    const p = this.pathU;
    const pos = path.getPointAt(Math.max(0, Math.min(1, p)) || 0);
    const nextU = (p + 0.03) % 1;
    const lookAt = path.getPointAt(nextU);
    // smooth mouse input
    const ease = (v) => Math.sign(v) * Math.pow(Math.abs(v), 0.7);
    this.mouseSmoothed.x += (ease(this.mouseTarget.x) - this.mouseSmoothed.x) * 0.5;
    this.mouseSmoothed.y += (ease(this.mouseTarget.y) - this.mouseSmoothed.y) * 0.5;
    // frame indices
    const segCount = (frameSegments || (frames.tangents && frames.tangents.length) || 0);
    if (!segCount || !frames.normals || !frames.binormals) return;
    const idx = Math.floor(p * segCount);
    const normalBase = frames.normals[idx % frames.normals.length];
    const binormalBase = frames.binormals[idx % frames.binormals.length];
    if (!normalBase || !binormalBase) return;
    const normal = normalBase.clone();
    const binormal = binormalBase.clone();
    // spring-damper lateral offset
    const targetOffset = new THREE.Vector2(
      this.mouseSmoothed.x * this.crossRadius,
      this.mouseSmoothed.y * this.crossRadius
    );
    const accelX = this.lateralStiffness * (targetOffset.x - this.lateralOffset.x) - this.lateralDamping * this.lateralVelocity.x;
    const accelY = this.lateralStiffness * (targetOffset.y - this.lateralOffset.y) - this.lateralDamping * this.lateralVelocity.y;
    this.lateralVelocity.x += accelX * dt;
    this.lateralVelocity.y += accelY * dt;
    this.lateralOffset.x += this.lateralVelocity.x * dt;
    this.lateralOffset.y += this.lateralVelocity.y * dt;
    // camera/player placement
    const camPos = pos.clone();
    const forward = new THREE.Vector3().subVectors(lookAt, camPos).normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const upScreen = new THREE.Vector3().crossVectors(right, forward).normalize();
    const offsetScreen = right.clone().multiplyScalar(this.mouseSmoothed.x * this.crossRadius)
      .add(upScreen.clone().multiplyScalar(-this.mouseSmoothed.y * this.crossRadius));
    const pd = typeof playerDistance === 'number' ? playerDistance : 0.3;
    const pox = shipOffsetX || 0;
    const poy = shipOffsetY || 0;
    const poz = shipOffsetZ || 0;
    const playerPos = camPos.clone()
      .add(right.clone().multiplyScalar(pox))
      .add(upScreen.clone().multiplyScalar(poy))
      .add(forward.clone().multiplyScalar(pd + poz))
      .add(offsetScreen);
    prevPlayerPos.copy(player.position);
    player.position.copy(playerPos);
    player.lookAt(lookAt);
    player.rotateY(Math.PI);
    const leanX = THREE.MathUtils.clamp(this.mouseSmoothed.x, -1, 1);
    const leanY = -THREE.MathUtils.clamp(this.mouseSmoothed.y, -1, 1);
    const bankAngle = -leanX * (shipBankFactor || 0);
    const pitchAngle = leanY * (shipPitchFactor || 0);
    const bankQuat = new THREE.Quaternion().setFromAxisAngle(forward, bankAngle);
    const pitchQuat = new THREE.Quaternion().setFromAxisAngle(right, pitchAngle);
    player.quaternion.multiply(bankQuat).multiply(pitchQuat);
    camera.position.copy(camPos);
    this.lookAtSmoothed.lerp(lookAt, 0.35);
    camera.lookAt(this.lookAtSmoothed);
  }

  resetToStart() {
    const {
      tubeGeometry,
      camera,
      player,
      playerDistance,
      shipOffsetX,
      shipOffsetY,
      shipOffsetZ
    } = this.ctx || {};
    if (!tubeGeometry || !camera || !player) return;
    this.pathU = 0;
    // reset movement smoothing/state
    this.mouseTarget.x = 0; this.mouseTarget.y = 0;
    this.mouseSmoothed.x = 0; this.mouseSmoothed.y = 0;
    this.lateralOffset.set(0, 0);
    this.lateralVelocity.set(0, 0);
    // reset speed to base
    this.speedTarget = 0.1;
    this.speed = 0.1;
    // place camera and player at start
    const p = 0;
    const path = tubeGeometry.parameters.path;
    const camPos = path.getPointAt(p);
    const lookAt = path.getPointAt((p + 0.03) % 1);
    const forward = new THREE.Vector3().subVectors(lookAt, camPos).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
    const upScreen = new THREE.Vector3().crossVectors(right, forward).normalize();
    camera.position.copy(camPos);
    this.lookAtSmoothed.copy(lookAt);
    camera.lookAt(this.lookAtSmoothed);
    const pd = typeof playerDistance === 'number' ? playerDistance : 0.3;
    const pox = shipOffsetX || 0;
    const poy = shipOffsetY || 0;
    const poz = shipOffsetZ || 0;
    const playerPos = camPos.clone()
      .add(right.clone().multiplyScalar(pox))
      .add(upScreen.clone().multiplyScalar(poy))
      .add(forward.clone().multiplyScalar(pd + poz));
    if (this.ctx && this.ctx.prevPlayerPos) this.ctx.prevPlayerPos.copy(playerPos);
    player.position.copy(playerPos);
    player.lookAt(lookAt);
    player.rotation.x = 0;
    player.rotation.z = 0;
    player.rotateY(Math.PI);
  }

  // Score helper
  addScore(delta) {
    const { sfxPoint, sfxExplosion, isMuted, onScoreChange } = this.ctx || {};
    if (!delta) return;
    const cur = Number(this.score) || 0;
    const next = cur + delta;
    this.score = next;
    if (typeof this.ctx?.setScore === 'function') {
      this.ctx.setScore(next);
    }
    const muted = typeof isMuted === 'function' ? !!isMuted() : false;
    const pointReady = !!(sfxPoint && sfxPoint.buffer);
    const explosionReady = !!(sfxExplosion && sfxExplosion.buffer);
    if (delta > 0 && pointReady && !muted) {
      if (sfxPoint.isPlaying) sfxPoint.stop();
      sfxPoint.play();
    }
    if (delta < 0 && explosionReady && !muted) {
      sfxExplosion.play();
    }
    if (typeof onScoreChange === 'function') onScoreChange(next, delta);

    // stage progression (internal)
    const currentStage = Number(this.currentStage) || 1;
    const nextIndex = currentStage - 1; // stage 1 -> index 0 (advance into stage 2)
    const cfg = (this.stages && this.stages[nextIndex]) || null;
    if (cfg && next >= Number(cfg.threshold || 0)) {
      this.onStageAdvance(currentStage + 1);
    }
  }

  checkHealth() {
    if (this.health <= 0) {
      this.gameOver();
    }
  }

  gameOver() {
    const { gameOverEl } = this.ctx || {};
    if (gameOverEl && gameOverEl.style) {
      gameOverEl.style.display = 'flex';
    }
    // Pause and wait for user to choose Play Again or Quit
    this.pause();
    this._isRunning = false;
    // Reset health immediately for UI; actual restart is triggered by buttons
    this.health = 10;
    if (typeof this.ctx?.setHealth === 'function') this.ctx.setHealth(this.health);
    this._emitHealth();
  }

  // Box disintegration with particles
  disintegrateBox(boxMesh, penalize = true) {
    const { scene, sfxExplosionReady, sfxExplosion, isMuted, setHealth } = this.ctx || {};
    if (!scene || !boxMesh || boxMesh.userData.disintegrated) return;
    boxMesh.userData.disintegrated = true;
    if (penalize) { this.addScore(-1); this.health = Math.max(0, (this.health || 0) - 1); if (typeof setHealth === 'function') setHealth(this.health); this._emitHealth(); this.checkHealth && this.checkHealth(); }
    const muted = typeof isMuted === 'function' ? !!isMuted() : false;
    if (sfxExplosionReady && sfxExplosion && !muted) {
      sfxExplosion.play();
    }
    // particle burst
    const particleCount = 500;
    const duration = 1.0;
    const initialSpeed = 0.3;
    const size = boxMesh.userData.size || 0.005;
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const half = size * 0.02;
    for (let i = 0; i < particleCount; i++) {
      const ix = i * 3;
      positions[ix] = (Math.random() * 2 - 1) * half;
      positions[ix + 1] = (Math.random() * 2 - 1) * half;
      positions[ix + 2] = (Math.random() * 2 - 1) * half;
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
      color: (boxMesh.material && boxMesh.material.color && boxMesh.material.color.getHex) ? boxMesh.material.color.getHex() : 0xffffff,
      map: this.particleTexture,
      alphaMap: this.particleTexture,
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
    particles.userData = { velocities, life: 0, duration };
    scene.add(particles);
    this.particleSystems.push(particles);
    // remove original
    scene.remove(boxMesh);
    if (boxMesh.geometry) boxMesh.geometry.dispose();
    if (boxMesh.material) boxMesh.material.dispose();
  }

  updateParticles(dt) {
    const { scene } = this.ctx || {};
    if (!scene) return;
    for (let i = this.particleSystems.length - 1; i >= 0; i--) {
      const p = this.particleSystems[i];
      const geom = p.geometry;
      const posAttr = geom.getAttribute('position');
      const positions = posAttr.array;
      const vels = p.userData.velocities;
      const life = p.userData.life + dt;
      p.userData.life = life;
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
        if (Array.isArray(p.material)) { p.material.forEach(m => m.dispose()); } else { p.material.dispose(); }
        this.particleSystems.splice(i, 1);
      }
    }
  }

  onStageAdvance(targetStage) {
    if (this._stageTransition) return;
    this._stageTransition = true;
    this.currentStage = targetStage;
    const { setStage } = this.ctx || {};
    if (typeof setStage === 'function') setStage(targetStage);
    const { levelUpEl, setHazardsShown, gateSystem, COUNTDOWN_MS } = this.ctx || {};
    const cfgIndex = targetStage - 2; // stage 2 maps to 0
    const cfg = (this.stages && this.stages[cfgIndex]) || {};
    // simple stage overlay with fade
    if (levelUpEl && levelUpEl.style) {
      levelUpEl.textContent = `Stage ${targetStage}`;
      levelUpEl.style.display = 'flex';
      levelUpEl.style.opacity = '0';
      levelUpEl.style.transition = 'opacity 400ms ease';
      requestAnimationFrame(() => { levelUpEl.style.opacity = '1'; });
      setTimeout(() => {
        levelUpEl.style.opacity = '0';
        setTimeout(() => { try { if (levelUpEl) levelUpEl.style.display = 'none'; } catch(_){} }, 450);
      }, 1200);
    }
    // stop and reset position/obstacles
   //try { const { bgm } = this.ctx || {}; if (bgm && bgm.isPlaying) bgm.stop(); } catch(_){}
    //this.resetToStart();
    if (typeof setHazardsShown === 'function') setHazardsShown(false);
    this.clearObstacles();
    // difficulty knobs from config
    if (typeof cfg.speedDelta === 'number') {
      const max = 0.8;
      const t = (this.speedTarget || 0.1) + cfg.speedDelta;
      this.speedTarget = Math.min(max, t);
    }
    if (typeof cfg.movementSpeedScale === 'number' && cfg.movementSpeedScale > 0) {
      this.movementSpeedScale = cfg.movementSpeedScale;
    }
    // lasers
    this.lasersEnabled = !!cfg.lasers;
    this.laserAmount = Math.max(1, Number(cfg.laserAmount || 1));
    // spawn after countdown; Stage 3 enables movers
    const SAFE_START_U = 0.15;
    const delay = (typeof COUNTDOWN_MS === 'number' && COUNTDOWN_MS > 0) ? COUNTDOWN_MS : 10000;
    // If a new BGM is configured, start crossfade immediately so it completes before spawn
    if (cfg.bgmSrc) {
      this.crossfadeBgm(cfg.bgmSrc, Math.min(1200, delay - 200)).catch(() => {});
    }
    this.startStageWithCountdown(this.ctx && this.ctx.countDown, () => {
      if (typeof setHazardsShown === 'function') setHazardsShown(true);
      const spawn = cfg.spawn || {};
      const b = Number(spawn.boxes || 0);
      const s = Number(spawn.spheres || 0);
      if (b || s) this.spawnObstacles(b, s, SAFE_START_U);
      if (gateSystem && gateSystem.spawn && Number(spawn.gates || 0)) {
        gateSystem.spawn(Number(spawn.gates), SAFE_START_U, cfg.gates || {});
      }
      if (cfg.enableMovers) this._moversEnabled = true;
      if (this.tryStartBgm) this.tryStartBgm();
      this._stageTransition = false;
    }, delay);
  }

  updateMusicMetrics(nowMs) {
    this.musicBeat = false;
    if (!this.musicAnalyser || !this.musicFreqData) return;
      this.musicAnalyser.getByteFrequencyData(this.musicFreqData);
    let sum = 0;
    for (let i = 0; i < this.musicFreqData.length; i++) sum += this.musicFreqData[i];
    const avg = sum / this.musicFreqData.length;
    const e = Math.max(0, Math.min(1, avg / 255));
    this.musicEnergyMA += (e - this.musicEnergyMA) * this.ENERGY_SMOOTH;
    this.musicEnergy = e;
    let wsum = 0, asum = 0;
    for (let i = 0; i < this.musicFreqData.length; i++) { const a = this.musicFreqData[i]; asum += a; wsum += a * i; }
    this.musicCentroid = asum > 0 ? (wsum / asum) / (this.musicFreqData.length - 1) : 0;
    if (e - this.musicEnergyMA > this.BEAT_THRESHOLD && nowMs - this.lastBeatMs > this.BEAT_COOLDOWN_MS) {
      this.musicBeat = true;
      this.lastBeatMs = nowMs;
      this.beatLightBoost = 0.5;
    } else {
      this.beatLightBoost = Math.max(0, this.beatLightBoost * 0.9);
    }
  }

  changeLightColor(t) {
    const { light, setCloudsColor, lineMaterial, tubeMaterial } = this.ctx || {};
    if (!light || !lineMaterial || !tubeMaterial) return;
    const baseH = (t * 0.0001) % 1;
    const h = baseH * 0.9 + this.musicCentroid * 0.1;
    light.color.setHSL(h, 1, 0.5);
    // keep clouds colored to match the light/music
    if (typeof setCloudsColor === 'function') setCloudsColor(h, 1, 0.5);
    light.intensity = 2 + 1.2 * (this.musicEnergy || 0) + (this.beatLightBoost || 0);
    lineMaterial.color.setHSL(h, 1, 0.6);
    tubeMaterial.color.setHSL(h, 1, 0.6);
  }

  updateClouds(t, dt) {
    const { cloudSystem, light } = this.ctx || {};
    if (!cloudSystem || !cloudSystem.update || !light) return;
    cloudSystem.update(t, dt, light.color, this.musicEnergy || 0, !!this.musicBeat);
  }

  initRenderer({ mount, width, height, camera, scene }) {
    camera = camera || (this.ctx && this.ctx.camera);
    scene = scene || (this.ctx && this.ctx.scene);
    if (!camera || !scene) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(width, height, true);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMappingExposure = 1.25;
    if (mount && mount.appendChild) mount.appendChild(renderer.domElement);
    const composer = new EffectComposer(renderer);
    composer.setSize(width, height);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0.5, 0.1, 0.0);
    composer.addPass(bloomPass);
    this.ctx = { ...this.ctx, renderer, composer };
    try { console.log('[Game] renderer initialized'); } catch(_){}
    return { renderer, composer };
  }

  initGameplaySystems({ SPAWN_START_U = 0.12 } = {}) {
    const { scene, tubeGeometry, frames } = this.ctx || {};
    if (!scene || !tubeGeometry || !frames || !this.ctx || !this.ctx.composer) return;
    const gateSystem = new GateSystem(scene, tubeGeometry.parameters.path, SPAWN_START_U);
    const cloudSystem = new CloudSystem(scene, tubeGeometry.parameters.path, frames, { additive: true });
    cloudSystem.populate(320, 0.5);
    const setCloudsColor = (...args) => cloudSystem.setColor(...args);
    const laserSystem = new LaserSystem(scene, this.ctx.composer);
    this.ctx = { ...this.ctx, gateSystem, cloudSystem, setCloudsColor, laserSystem };
    return { gateSystem, cloudSystem, setCloudsColor, laserSystem };
  }

  runLoop() {
    if (this._loop) return this._loop;
    this._loop = new GameLoop((t, dt) => {
      try { this.updateMusicMetrics(t); } catch(_){ }
      // camera and light
      try { this.updateCamera(t, dt); } catch(_){ }
      try { this.changeLightColor(t); } catch(_){ }
      // collisions and movers
      try {
        const gate = (this.ctx && typeof this.ctx.hazardsShown === 'boolean') ? this.ctx.hazardsShown : true;
        this.ctx && this.checkCollisions && this.checkCollisions(gate);
      } catch(_){ }
      try { this.updateMovers(dt, () => this.currentStage); } catch(_){ }
      // animate moving gates if enabled
      try { if (this.ctx && this.ctx.gateSystem && this.ctx.gateSystem.update) this.ctx.gateSystem.update(t, dt); } catch(_){ }
      // lasers
      try {
        if (this.lasersEnabled && this.ctx && this.ctx.laserSystem) {
          this.ctx.laserSystem.update(dt);
          const boxes = this.ctx.boxes || [];
          const hit = this.ctx.laserSystem.findHitBox(boxes);
          if (hit) {
            const { laserIndex, boxIndex } = hit;
            const box = boxes[boxIndex];
            this.disintegrateBox(box, false);
            boxes.splice(boxIndex, 1);
            this.ctx.laserSystem.removeAt(laserIndex);
          }
        }
      } catch(_){ }
      // particles/clouds/post
      try { this.updateParticles(dt); } catch(_){ }
      try { this.updateClouds(t, dt); } catch(_){ }
      try { this.ctx && this.ctx.composer && this.ctx.composer.render(); } catch(_){ }
    });
    // expose loop control via ctx so start/pause/resume continue to work
    this.ctx = {
      ...this.ctx,
      startLoop: () => this._loop.start(),
      pauseLoop: () => this._loop.pause(),
      resumeLoop: () => this._loop.resume()
    };
    return this._loop;
  }

  countDown() {
    const { countdownEl, COUNTDOWN_MS } = this.ctx || {};
    if (!countdownEl) return;
    const seconds = Math.max(1, Math.floor((COUNTDOWN_MS || 10000) / 1000));
    countdownEl.style.display = 'flex';
    let value = seconds;
    const step = () => {
      countdownEl.textContent = String(value);
      if (value <= 1) {
        setTimeout(() => { try { countdownEl.style.display = 'none'; } catch(_){} }, 1000);
      } else {
        value -= 1; setTimeout(step, 1000);
      }
    };
    step();
  }

  updateClouds(t, dt) {
    const { cloudSystem, light } = this.ctx || {};
    if (!cloudSystem || !cloudSystem.update || !light) return;
    cloudSystem.update(t, dt, light.color, this.musicEnergy || 0, !!this.musicBeat);
  }

  start() {
    const { startLoop, tryStartBgm, setHazardsShown, COUNTDOWN_MS, onRunningChange } = this.ctx || {};
    if (this._isRunning) return;
    this._isRunning = true;
    try { if (typeof onRunningChange === 'function') onRunningChange(true); } catch(_){}
    if (typeof startLoop === 'function') startLoop();
    if (typeof setHazardsShown === 'function') setHazardsShown(false);
    this.clearObstacles();
    const delay = (typeof COUNTDOWN_MS === 'number' && COUNTDOWN_MS > 0) ? COUNTDOWN_MS : 10000;
    this.countDown();
    setTimeout(() => {
      if (typeof setHazardsShown === 'function') setHazardsShown(true);
      this.spawnObstacles();
    }, delay);
    if (typeof tryStartBgm === 'function') tryStartBgm();
  }

  pause() {
    const { pauseLoop, bgm, onRunningChange } = this.ctx || {};
    if (!this._isRunning) return;
    this._isRunning = false;
    try { if (typeof onRunningChange === 'function') onRunningChange(false); } catch(_){}
    if (typeof pauseLoop === 'function') pauseLoop();
    try { if (bgm && bgm.isPlaying) bgm.pause(); } catch(_){ }
  }

  resume() {
    const { resumeLoop, tryStartBgm, onRunningChange } = this.ctx || {};
    if (this._isRunning) return;
    this._isRunning = true;
    try { if (typeof onRunningChange === 'function') onRunningChange(true); } catch(_){}
    if (typeof resumeLoop === 'function') resumeLoop();
    if (typeof tryStartBgm === 'function') tryStartBgm();
  }

  startNewGame() {
    const { setScore, setHazardsShown, setHealth } = this.ctx || {};
    if (typeof setScore === 'function') setScore(0);
    this.health = 10;
    if (typeof setHealth === 'function') setHealth(this.health);
    this._emitHealth();
    if (typeof setHazardsShown === 'function') setHazardsShown(false);
    this.clearObstacles();
    this.resetToStart();
    this._isRunning = false;
    this.start();
  }

  spawnObstacles(boxCount = 150, sphereCount = 170, startU = 0.12) {
    const { scene, tubeGeometry, frames, boxes, spheres } = this.ctx || {};
    if (!scene || !tubeGeometry || !frames || !boxes || !spheres) return;
    const path = tubeGeometry.parameters.path;
    const tubeRadius = tubeGeometry.parameters.radius || 0.5;
    const maxR = tubeRadius * 0.9;
    // boxes (stratified along u to avoid long empty sections)
    for (let i = 0; i < boxCount; i++) {
      const size = Math.random() * (0.1 - 0.01) + 0.01;
      const geom = new THREE.BoxGeometry(size, size, size);
      const u = startU + ((i + Math.random()) / Math.max(1, boxCount)) * (1 - startU);//u:Parametric position along the tube spline (0..1). Where along the tunnel the object sits.
      const center = path.getPointAt(u);
      const idx = Math.floor(u * frames.tangents.length);
      const normal = frames.normals[idx % frames.normals.length].clone();
      const binormal = frames.binormals[idx % frames.binormals.length].clone();
      const r = THREE.MathUtils.randFloat(0.05, maxR * 0.9);
      const ang = Math.random() * Math.PI * 2;
      const ox = Math.cos(ang) * r;//ox: Offset along the local normal axis of the tube cross‑section (radial X offset from center).
      const oy = Math.sin(ang) * r;//oy: Offset along the local binormal axis of the tube cross‑section (radial Y offset from center).
      const pos = center.clone().add(normal.clone().multiplyScalar(ox)).add(binormal.clone().multiplyScalar(oy));
      const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100 });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      /*
      vx: Velocity for ox (how fast the offset changes over time; used by movers).
      vy: Velocity for oy (how fast the offset changes over time; used by movers).
      */
      mesh.userData = { size, u, ox, oy, vx: THREE.MathUtils.randFloatSpread(0.4), vy: THREE.MathUtils.randFloatSpread(0.4), movable: true };
      boxes.push(mesh);
      scene.add(mesh);
    }
    // spheres (stratified)
    for (let i = 0; i < sphereCount; i++) {
      const radius = 0.02;
      const geom = new THREE.SphereGeometry(radius, 32, 32);
      const u = startU + ((i + Math.random()) / Math.max(1, sphereCount)) * (1 - startU);
      const center = path.getPointAt(u);
      const idx = Math.floor(u * frames.tangents.length);
      const normal = frames.normals[idx % frames.normals.length].clone();
      const binormal = frames.binormals[idx % frames.binormals.length].clone();
      const r = THREE.MathUtils.randFloat(0.05, maxR * 0.9);
      const ang = Math.random() * Math.PI * 2;
      const ox = Math.cos(ang) * r;
      const oy = Math.sin(ang) * r;
      const pos = center.clone().add(normal.clone().multiplyScalar(ox)).add(binormal.clone().multiplyScalar(oy));
      const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial({ color: 0xffffff }));
      mesh.position.copy(pos);
      mesh.userData = { size: { radius }, radius, u, ox, oy, vx: THREE.MathUtils.randFloatSpread(0.4), vy: THREE.MathUtils.randFloatSpread(0.4), movable: true };
      spheres.push(mesh);
      scene.add(mesh);
    }
  }

  ensureObstacleDensity(minBoxes = 120, minSpheres = 140, startU = 0.12) {
    const { boxes, spheres } = this.ctx || {};
    if (!boxes || !spheres) return;
    const needBoxes = Math.max(0, minBoxes - boxes.length);
    const needSpheres = Math.max(0, minSpheres - spheres.length);
    if (needBoxes > 0 || needSpheres > 0) this.spawnObstacles(needBoxes, needSpheres, startU);
  }

  updateMovers(dt, getStage) {
    const { tubeGeometry, frames, boxes, spheres } = this.ctx || {};
    if (!tubeGeometry || !frames) return;
    // allow explicit enable flag or stage 3+
    const stageVal = getStage ? getStage() : this.currentStage;
    if (!(this._moversEnabled || (stageVal >= 3))) return;
    const path = tubeGeometry.parameters.path;
    const tubeRadius = tubeGeometry.parameters.radius || 0.5;
    const maxR = tubeRadius * 0.95;
    const tangents = frames.tangents;
    const normals = frames.normals;
    const binormals = frames.binormals;
    const tLen = tangents && tangents.length || 0;
    const nLen = normals && normals.length || 0;
    const bLen = binormals && binormals.length || 0;
    if (!tLen || !nLen || !bLen) return;
    const speedScale = this.movementSpeedScale || 1;
    const move = (obj) => {
      const d = obj.userData;
      if (!d || !d.movable) return;
      d.ox += (d.vx || 0) * dt * speedScale;
      d.oy += (d.vy || 0) * dt * speedScale;
      const rNow = Math.hypot(d.ox, d.oy);
      if (rNow > maxR) {
        const nx = d.ox / (rNow || 1);
        const ny = d.oy / (rNow || 1);
        const dot = (d.vx || 0) * nx + (d.vy || 0) * ny;
        d.vx = (d.vx || 0) - 2 * dot * nx;
        d.vy = (d.vy || 0) - 2 * dot * ny;
        const k = maxR / (rNow || 1);
        d.ox *= k; d.oy *= k;
      }
      const u = Math.max(0, Math.min(1, d.u || 0));
      const idx = Math.floor(u * tLen);
      const normal = normals[idx % nLen];
      const binormal = binormals[idx % bLen];
      if (!normal || !binormal) return;
      const center = path.getPointAt(u);
      obj.position.copy(center)
        .add(normal.clone().multiplyScalar(d.ox))
        .add(binormal.clone().multiplyScalar(d.oy));
    };
    if (boxes) for (let i = 0; i < boxes.length; i++) move(boxes[i]);
    if (spheres) for (let i = 0; i < spheres.length; i++) move(spheres[i]);
  }

  startStageWithCountdown(countdownFn, spawnFn, delayMs) {
    if (typeof countdownFn === 'function') countdownFn();
    setTimeout(() => { if (typeof spawnFn === 'function') spawnFn(); }, Math.max(0, delayMs || 0));
  }

  configurePreloader({ totalAssets, preloaderEl, loaderPctEl, loaderFillEl, tryStartBgm, startGame }) {
    try { console.log('[Game] configurePreloader totalAssets=', totalAssets); } catch (_e) {}
    this.totalAssets = totalAssets || 0;
    this.preloaderEl = preloaderEl || null;
    this.loaderPctEl = loaderPctEl || null;
    this.loaderFillEl = loaderFillEl || null;
    if (typeof tryStartBgm === 'function') this.tryStartBgm = tryStartBgm;
    if (typeof startGame === 'function') this.startGameCb = startGame;
    this.loadedAssets = 0;
    this.assetsReady = false;
    // watchdog: if gates get stuck (e.g., a missing asset), force start after a short delay
    if (this._watchdog) clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      this.assetsReady = true;
      this.overlayFinished = true;
      this._tryStartAfterGates();
    }, Math.max(4000, this.minPreloadMs + 1500));
  }

  updatePreloaderProgress(extra = 0) {
    if (!this.totalAssets) return;
    const pct = Math.max(0, Math.min(100, Math.round(((this.loadedAssets + extra) / this.totalAssets) * 100)));
    try { console.log('[Game] preload progress', `${this.loadedAssets + extra}/${this.totalAssets}`, `${pct}%`); } catch (_e) {}
    if (this.loaderPctEl) this.loaderPctEl.textContent = `${pct}%`;
    if (this.loaderFillEl) this.loaderFillEl.style.width = `${pct}%`;
  }

  markAssetLoaded() {
    this.loadedAssets += 1;
    try { console.log('[Game] asset loaded', this.loadedAssets, '/', this.totalAssets); } catch (_e) {}
    this.updatePreloaderProgress();
    if (this.loadedAssets >= this.totalAssets) {
      this.assetsReady = true;
      this._tryStartAfterGates();
    }
  }

  onOverlayFinished() {
    try { console.log('[Game] overlay finished'); } catch (_e) {}
    this.overlayFinished = true;
    this.preloaderShownAt = performance.now();
    this._tryStartAfterGates();
  }

  _tryStartAfterGates() {
    try { console.log('[Game] tryStart gates', { assetsReady: this.assetsReady, overlayFinished: this.overlayFinished }); } catch (_e) {}
    if (!(this.assetsReady && this.overlayFinished)) return;
    if (this._startedFromGates) return; // guard against multiple triggers
    const now = performance.now();
    const elapsed = this.preloaderShownAt ? (now - this.preloaderShownAt) : this.minPreloadMs;
    const remaining = Math.max(0, this.minPreloadMs - elapsed);
    const start = () => {
      if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
      this._startedFromGates = true;
      try {
        if (this.preloaderEl) this.preloaderEl.classList.remove('show');
        const container = document.querySelector('.container');
        if (container) container.style.display = 'none';
        const header = document.querySelector('header');
        if (header) header.style.display = 'flex';
      } catch(_){}
      if (this.tryStartBgm) this.tryStartBgm();
      try { console.log('[Game] starting game now'); } catch (_e) {}
      // Start directly to avoid any external callback cycles
      this.start();
    };
    if (remaining > 0) {
      try { console.log('[Game] delaying start by ms', remaining); } catch (_e) {}
      setTimeout(start, remaining);
    } else {
      start();
    }
  }

  // Set a temporary tint on the ship model by adjusting emissive/color
  setShipTint(colorHex = 0xff3333, minEmissiveIntensity = 0.9) {
    const model = this.ctx && this.ctx.shipModel;
    if (!model) return;
    try {
      model.traverse((obj) => {
        if (!obj || !obj.isMesh || !obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.emissive) {
            m.emissive.setHex(colorHex);
            if (typeof m.emissiveIntensity === 'number') {
              m.emissiveIntensity = Math.max(m.emissiveIntensity || 0, minEmissiveIntensity);
            }
          } else if (m.color) {
            m.color.setHex(colorHex);
          }
          m.needsUpdate = true;
        }
      });
    } catch(_){}
  }

  // Restore original material tint cached at load time
  restoreShipTint() {
    const model = this.ctx && this.ctx.shipModel;
    if (!model) return;
    try {
      model.traverse((obj) => {
        if (!obj || !obj.isMesh || !obj.material || !obj.userData || !obj.userData._orig) return;
        const { color, emissive, emissiveIntensity } = obj.userData._orig;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          if (!m) continue;
          if (m.color && color) m.color.copy(color);
          if (m.emissive && emissive) m.emissive.copy(emissive);
          if (typeof emissiveIntensity === 'number' && typeof m.emissiveIntensity === 'number') {
            m.emissiveIntensity = emissiveIntensity;
          }
          m.needsUpdate = true;
        }
      });
    } catch(_){}
  }

  // One-shot damage flash
  flashShipDamage(durationMs = 250) {
    this.setShipTint(0xff3333, 1.1);
    try { if (this._shipFlashTimer) clearTimeout(this._shipFlashTimer); } catch(_){ }
    this._shipFlashTimer = setTimeout(() => { this.restoreShipTint(); }, Math.max(50, durationMs));
  }

  // Collision checks migrated here
  checkCollisions(hazardsShown) {
    if (!hazardsShown) return;
    const { boxes, spheres, player, prevPlayerPos, scene, gateSystem } = this.ctx || {};
    if (!player || !scene) return;
    const camPos = player.position;

    // Boxes: precise collision using bounding-sphere (half-diagonal) + player radius
    if (boxes) {
      for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (!b || b.userData.disintegrated) continue;
        const size = b.userData.size || 0.05;
        const rBox = Math.sqrt(3) * (size * 0.5);
        const rPlayer = (this.ctx && this.ctx.playerRadius) || 0.03;
        const radius = rBox + rPlayer;
        // quick check at current position
        if (b.position.distanceTo(camPos) <= radius) {
          this.disintegrateBox(b);
          boxes.splice(i, 1);
          // damage flash on ship
          this.flashShipDamage(250);

          continue;
        }
        // segment-sphere intersection to avoid tunneling
        const prevPos = prevPlayerPos || camPos;
        const movement = new THREE.Vector3().subVectors(camPos, prevPos);
        const movementLenSq = movement.lengthSq();
        if (movementLenSq > 0) {
          const segLen = Math.sqrt(movementLenSq);
          const segDir = movement.clone().divideScalar(segLen);
          const m = new THREE.Vector3().subVectors(prevPos, b.position);
          const bdot = m.dot(segDir);
          const c = m.lengthSq() - radius * radius;
          if (c <= 0) {
            this.disintegrateBox(b);
            boxes.splice(i, 1);
            continue;
          }
          const discr = bdot * bdot - c;
          if (discr >= 0) {
            const tHit = -bdot - Math.sqrt(discr);
            if (tHit >= 0 && tHit <= segLen) {
              this.disintegrateBox(b);
              boxes.splice(i, 1);
              this.flashShipDamage(250);
            }
          }
        }
      }
    }

    // Spheres: award on contact; include segment intersection to avoid tunneling
    if (spheres) {
      const prevPos = prevPlayerPos || camPos.clone();
      const movement = new THREE.Vector3().subVectors(camPos, prevPos);
      const movementLenSq = movement.lengthSq();
      for (let i = spheres.length - 1; i >= 0; i--) {
        const s = spheres[i];
        if (!s) continue;
        const baseRadius = (s.userData && s.userData.radius != null)
          ? s.userData.radius
          : (s.geometry && s.geometry.parameters && s.geometry.parameters.radius) || 0.02;
        const radius = baseRadius + 0.1;
        if (s.position.distanceTo(camPos) <= radius) {
          this.addScore(1);
          scene.remove(s);
          if (s.geometry) s.geometry.dispose();
          if (s.material) s.material.dispose();
          spheres.splice(i, 1);
          continue;
        }
        if (movementLenSq > 0) {
          const segDir = movement.clone();
          const segLen = Math.sqrt(movementLenSq);
          segDir.divideScalar(segLen);
          const m = new THREE.Vector3().subVectors(prevPos, s.position);
          const b = m.dot(segDir);
          const c = m.lengthSq() - radius * radius;
          if (c <= 0) {
            this.addScore(1);
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
              this.addScore(1);
              scene.remove(s);
              if (s.geometry) s.geometry.dispose();
              if (s.material) s.material.dispose();
              spheres.splice(i, 1);
            }
          }
        }
      }
    }

    // Gates via GateSystem helper
    if (gateSystem && gateSystem.checkPasses) {
      gateSystem.checkPasses(prevPlayerPos || camPos, camPos, (gate) => {
        this.addScore(5);
        try {
          if (gate && gate.material) {
            if (Array.isArray(gate.material)) gate.material.forEach(m => m && (m.color ? m.color.set(0xff0000) : null));
            else if (gate.material.color) gate.material.color.set(0xff0000);
          }
        } catch (_) {}
        // removal is handled inside GateSystem after callback delay
      });
    }
  }
}


