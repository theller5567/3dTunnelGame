import * as THREE from 'three';
import { createCircleSpriteTexture } from './utils.js';
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
    this.minPreloadMs = 2000;
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
    // BGM
    audioLoader.load('assets/soundFX/retro-gaming-271301.mp3', (buffer) => {
      try { console.log('[Game] BGM loaded'); } catch (_e) {}
      bgm.setBuffer(buffer);
      bgm.setLoop(true);
      bgm.setVolume(bgmMuted ? 0 : bgmBaseVolume);
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
      if (this.tryStartBgm) this.tryStartBgm();
      this.markAssetLoaded();
    }, undefined, (err) => { try { console.error('[Game] BGM load error', err); } catch(_e) {} this.markAssetLoaded(); });
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
    const {
      getScore, setScore,
      sfxPointReady, sfxPoint,
      sfxExplosionReady, sfxExplosion,
      isMuted,
      onScoreChange,
      getStage,
      setStage,
      stage2score,
      stage3score
    } = this.ctx || {};
    if (!delta) return;
    const cur = typeof getScore === 'function' ? Number(getScore()) || 0 : 0;
    const next = cur + delta;
    if (typeof setScore === 'function') setScore(next);
    const muted = typeof isMuted === 'function' ? !!isMuted() : false;
    if (delta > 0 && sfxPointReady && sfxPoint && !muted) {
      if (sfxPoint.isPlaying) sfxPoint.stop();
      sfxPoint.play();
    }
    if (delta < 0 && sfxExplosionReady && sfxExplosion && !muted) {
      sfxExplosion.play();
    }
    if (typeof onScoreChange === 'function') onScoreChange(next, delta);

    // stage progression (internal)
    const currentStage = typeof getStage === 'function' ? Number(getStage()) || 1 : 1;
    const s2 = (typeof stage2score === 'number' ? stage2score : 50);
    const s3 = (typeof stage3score === 'number' ? stage3score : 200);
    if (currentStage === 1 && next >= s2) {
      this.onStageAdvance(2, setStage);
    } else if (currentStage === 2 && next >= s3) {
      this.onStageAdvance(3, setStage);
    }
  }

  // Box disintegration with particles
  disintegrateBox(boxMesh, penalize = true) {
    const { scene, sfxExplosionReady, sfxExplosion, isMuted } = this.ctx || {};
    if (!scene || !boxMesh || boxMesh.userData.disintegrated) return;
    boxMesh.userData.disintegrated = true;
    if (penalize) this.addScore(-1);
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

  onStageAdvance(targetStage, setStage) {
    if (this._stageTransition) return;
    this._stageTransition = true;
    if (typeof setStage === 'function') setStage(targetStage);
    const { levelUpEl, setHazardsShown, gateSystem, COUNTDOWN_MS } = this.ctx || {};
    // simple stage overlay
    if (levelUpEl && levelUpEl.style) {
      levelUpEl.style.display = 'flex';
      levelUpEl.textContent = `Stage ${targetStage}`;
      setTimeout(() => { try { if (levelUpEl) levelUpEl.style.display = 'none'; } catch(_){} }, 2000);
    }
    // stop and reset position/obstacles
    try { const { bgm } = this.ctx || {}; if (bgm && bgm.isPlaying) bgm.stop(); } catch(_){}
    this.resetToStart();
    if (typeof setHazardsShown === 'function') setHazardsShown(false);
    this.clearObstacles();
    // increase difficulty for stage 2
    if (targetStage === 2) {
      const max = 0.2;
      const t = (this.speedTarget || 0.1) + 0.03;
      this.speedTarget = Math.min(max, t);
    }
    // spawn after countdown; Stage 3 enables movers
    const SAFE_START_U = 0.25;
    const delay = (typeof COUNTDOWN_MS === 'number' && COUNTDOWN_MS > 0) ? COUNTDOWN_MS : 10000;
    this.startStageWithCountdown(this.ctx && this.ctx.countDown, () => {
      if (typeof setHazardsShown === 'function') setHazardsShown(true);
      if (targetStage === 2) {
        this.spawnObstacles(220, 220, SAFE_START_U);
        if (gateSystem && gateSystem.spawn) gateSystem.spawn(16, SAFE_START_U);
      } else if (targetStage === 3) {
        this.spawnObstacles(260, 260, SAFE_START_U);
        if (gateSystem && gateSystem.spawn) gateSystem.spawn(20, SAFE_START_U);
        // enable movers update at stage 3 by setting a flag the update reads
        this._moversEnabled = true;
      }
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
    if (typeof setCloudsColor === 'function') setCloudsColor(h, 1, 0.5);
    light.intensity = 2 + 1.2 * (this.musicEnergy || 0) + (this.beatLightBoost || 0);
    lineMaterial.color.setHSL(h, 1, 0.6);
    tubeMaterial.color.setHSL(h, 1, 0.6);
  }

  spawnObstacles(boxCount = 150, sphereCount = 170, startU = 0.12) {
    const { scene, tubeGeometry, frames, boxes, spheres } = this.ctx || {};
    if (!scene || !tubeGeometry || !frames || !boxes || !spheres) return;
    const path = tubeGeometry.parameters.path;
    const tubeRadius = tubeGeometry.parameters.radius || 0.5;
    const maxR = tubeRadius * 0.9;
    // boxes
    for (let i = 0; i < boxCount; i++) {
      const size = Math.random() * (0.1 - 0.01) + 0.01;
      const geom = new THREE.BoxGeometry(size, size, size);
      const u = startU + Math.random() * (1 - startU);
      const center = path.getPointAt(u);
      const idx = Math.floor(u * frames.tangents.length);
      const normal = frames.normals[idx % frames.normals.length].clone();
      const binormal = frames.binormals[idx % frames.binormals.length].clone();
      const r = THREE.MathUtils.randFloat(0.05, maxR * 0.9);
      const ang = Math.random() * Math.PI * 2;
      const ox = Math.cos(ang) * r;
      const oy = Math.sin(ang) * r;
      const pos = center.clone().add(normal.clone().multiplyScalar(ox)).add(binormal.clone().multiplyScalar(oy));
      const mat = new THREE.MeshPhongMaterial({ color: 0xffffff, shininess: 100 });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.copy(pos);
      mesh.userData = { size, u, ox, oy, vx: THREE.MathUtils.randFloatSpread(0.4), vy: THREE.MathUtils.randFloatSpread(0.4), movable: true };
      boxes.push(mesh);
      scene.add(mesh);
    }
    // spheres
    for (let i = 0; i < sphereCount; i++) {
      const radius = 0.02;
      const geom = new THREE.SphereGeometry(radius, 32, 32);
      const u = startU + Math.random() * (1 - startU);
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

  updateMovers(dt, getStage) {
    const { tubeGeometry, frames, boxes, spheres } = this.ctx || {};
    if (!tubeGeometry || !frames) return;
    // allow explicit enable flag or stage 3+
    if (!(this._moversEnabled || (getStage && getStage() >= 3))) return;
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
    const move = (obj) => {
      const d = obj.userData;
      if (!d || !d.movable) return;
      d.ox += (d.vx || 0) * dt;
      d.oy += (d.vy || 0) * dt;
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
    this.tryStartBgm = tryStartBgm || null;
    this.startGameCb = startGame || null;
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
    const now = performance.now();
    const elapsed = this.preloaderShownAt ? (now - this.preloaderShownAt) : this.minPreloadMs;
    const remaining = Math.max(0, this.minPreloadMs - elapsed);
    const start = () => {
      if (this._watchdog) { clearTimeout(this._watchdog); this._watchdog = null; }
      if (this.preloaderEl) this.preloaderEl.classList.remove('show');
      if (this.tryStartBgm) this.tryStartBgm();
      try { console.log('[Game] starting game now'); } catch (_e) {}
      if (this.startGameCb) this.startGameCb();
    };
    if (remaining > 0) {
      try { console.log('[Game] delaying start by ms', remaining); } catch (_e) {}
      setTimeout(start, remaining);
    } else {
      start();
    }
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
    if (gateSystem && gateSystem.checkPasses && typeof addScore === 'function') {
      gateSystem.checkPasses(prevPlayerPos || camPos, camPos, () => addScore(5));
    }
  }
}


