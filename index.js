import * as THREE from 'three';
import { OrbitControls } from 'jsm/controls/OrbitControls.js';
import spline from './spline.js';
import { EffectComposer } from 'jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'jsm/postprocessing/UnrealBloomPass.js';

const w = window.innerWidth;
const h = window.innerHeight;

const fov = 75;
const aspect = w / h;
const near = 0.1;
const far = 1000;
let score = 0;
const scoreText = document.querySelector('.score-value');
const h1Text = document.querySelector('h1');
const WHITE = new THREE.Color(0xffffff);
const TMP_COLOR = new THREE.Color();
const TMP_HSL = { h: 0, s: 0, l: 0 };
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
    scoreText.textContent = score;
  }

  //fade out the h1Text after 2 seconds
  setTimeout(() => {
    h1Text.style.opacity = 0;
  }, 2000);


const renderer = new THREE.WebGLRenderer({antialias: true});
renderer.setSize(w, h, true);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
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
const prevCamPos = new THREE.Vector3();

function onPointerMove(e){
    const rect = renderer.domElement.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;   // 0..1
    const my = (e.clientY - rect.top) / rect.height;  // 0..1
    mouseTarget.x = (mx - 0.5) * 2; // -1..1
    mouseTarget.y = (my - 0.5) * 2; // -1..1 (non-inverted Y)
}

window.addEventListener('pointermove', onPointerMove, false);

// wheel to adjust forward speed
function onWheel(e){
    const delta = Math.sign(e.deltaY) * -0.05; // up = faster, down = slower
    speedTarget = THREE.MathUtils.clamp(speedTarget + delta, SPEED_MIN, SPEED_MAX);
}
window.addEventListener('wheel', onWheel, { passive: true });


// reusable soft-circle texture for particles
function createCircleSpriteTexture(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const cy = size / 2;
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, cx);
    grd.addColorStop(0.0, 'rgba(255,255,255,1)');
    grd.addColorStop(1.0, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
}

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

// flash tube wireframe color on score changes
const tubeWireOriginalLineColor = lineMaterial.color.getHex();
const tubeWireOriginalMeshColor = tubeMaterial.color.getHex();
let tubeWireFlashTimeout = null;
function flashTubeWire(colorHex, durationMs = 1000) {
  lineMaterial.color.setHex(colorHex);
  tubeMaterial.color.setHex(colorHex);
  if (tubeWireFlashTimeout) clearTimeout(tubeWireFlashTimeout);
  tubeWireFlashTimeout = setTimeout(() => {
    lineMaterial.color.setHex(tubeWireOriginalLineColor);
    tubeMaterial.color.setHex(tubeWireOriginalMeshColor);
  }, durationMs);
}

// clouds inside the tube using soft sprites
const cloudsGroup = new THREE.Group();
scene.add(cloudsGroup);
// global color override for all clouds; set to THREE.Color or null
let cloudColorOverride = null;
function setCloudsColor(colorOrH, s, l) {
  // HSL overload: setCloudsColor(h, s, l)
  if (
    typeof colorOrH === 'number' && typeof s === 'number' && typeof l === 'number'
  ) {
    TMP_COLOR.setHSL(colorOrH, s, l);
    cloudColorOverride = TMP_COLOR.clone();
    return;
  }
  // Reset override
  if (colorOrH == null) {
    cloudColorOverride = null;
    return;
  }
  // THREE.Color instance
  if (colorOrH && colorOrH.isColor) {
    cloudColorOverride = colorOrH.clone();
    return;
  }
  // Hex or CSS string
  cloudColorOverride = new THREE.Color(colorOrH);
}

function addCloud(u, radius, size, colorHex, opacity) {
  const mat = new THREE.SpriteMaterial({
    map: PARTICLE_TEXTURE,
    color: colorHex,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    premultipliedAlpha: false
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);

  const idx = Math.floor(u * frameSegments);
  const normal = frames.normals[idx % frameSegments].clone();
  const binormal = frames.binormals[idx % frameSegments].clone();
  const pos = tubeGeometry.parameters.path.getPointAt(u);
  const angle = Math.random() * Math.PI * 2;
  const offset = normal.multiplyScalar(Math.cos(angle) * radius)
    .add(binormal.multiplyScalar(Math.sin(angle) * radius));
  sprite.position.copy(pos).add(offset);
  sprite.userData = {
    u,
    angle,
    radius,
    speed: (Math.random() * 0.5 + 0.5) * 0.02,
    sway: Math.random() * 0.2 + 0.05,
    phase: Math.random() * Math.PI * 2
  };
  cloudsGroup.add(sprite);
}

function createClouds(count = 5020) {
  for (let i = 0; i < count; i++) {
    const u = Math.random();
    const r = THREE.MathUtils.lerp(0.15, 0.42, Math.random()); // stay inside tube radius 0.5
    const size = THREE.MathUtils.lerp(0.25, 1.0, Math.random());
    addCloud(u, r, size, 0xffffff, 0.05);
  }
}

createClouds(120);


//create random 3d boxes along the camera path inside the tube
//make the boxes have different sizes but true squares
const boxes = [];
for (let i = 0; i < 150; i++) {
    const size = Math.random() * (0.1 - 0.01) + 0.01; // 0.01 .. 0.1
    const box = new THREE.BoxGeometry(size, size, size);
    const pos = tubeGeometry.parameters.path.getPointAt(Math.random() * 0.99 + 0.01);
    //offset the boxes x and y position randomly between -0.5 and 0.5
    pos.x += Math.random() * 0.5 - 0.25;
    pos.y += Math.random() * 0.5 - 0.25;
    const rotation = new THREE.Euler(Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI);
    const boxMaterial = new THREE.MeshPhongMaterial({color: 0xffffff, shininess: 100});
    const boxMesh = new THREE.Mesh(box, boxMaterial);
    scene.add(boxMesh);
    boxes.push(boxMesh);
    boxMesh.position.copy(pos);
    boxMesh.rotation.copy(rotation);
    boxMesh.userData.size = size;
}

const spheres = [];
for (let i = 0; i < 170; i++) {
    const size = {radius: 0.02}; // 0.01 .. 0.1
    const sphereGeometry = new THREE.SphereGeometry(size.radius, 32, 32);
    const pos = tubeGeometry.parameters.path.getPointAt(Math.random() * 0.99 + 0.01);
    //offset the boxes x and y position randomly between -0.5 and 0.5
    pos.x += Math.random() * 0.5 - 0.25;
    pos.y += Math.random() * 0.5 - 0.25;
    const rotation = new THREE.Euler(Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI, Math.random() * 2 * Math.PI);
    const sphereMesh = new THREE.Mesh(sphereGeometry, new THREE.MeshBasicMaterial({color: 0xffffff}));
    scene.add(sphereMesh);
    spheres.push(sphereMesh);
    sphereMesh.position.copy(pos);
  sphereMesh.userData.size = size;
  sphereMesh.userData.radius = size.radius;
    sphereMesh.rotation.copy(rotation);
}
    

// particle systems spawned from disintegrated boxes
const particleSystems = [];

function disintegrateBox(boxMesh) {
    if (!boxMesh || boxMesh.userData.disintegrated) return;
    boxMesh.userData.disintegrated = true;
    score++;
    flashTubeWire(0x00ff00, 1000);
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
    const camPos = camera.position;
    for (let i = boxes.length - 1; i >= 0; i--) {
        const b = boxes[i];
        if (!b || b.userData.disintegrated) continue;
        // use size-based threshold
        const threshold = Math.max(0.15, (b.userData.size || 0.05) * 3);
        if (b.position.distanceTo(camPos) <= threshold) {
            disintegrateBox(b);
            boxes.splice(i, 1);
        }
    }
}

function updateClouds(t, dt) {
  for (let i = 0; i < cloudsGroup.children.length; i++) {
    const s = cloudsGroup.children[i];
    const data = s.userData;
    // drift along tube and sway radially
    data.u = (data.u + data.speed * dt) % 1;
    const idx = Math.floor(data.u * frameSegments);
    const normal = frames.normals[idx % frameSegments];
    const binormal = frames.binormals[idx % frameSegments];
    const pos = tubeGeometry.parameters.path.getPointAt(data.u);
    const swayR = data.radius + Math.sin(t * 0.001 + data.phase) * data.sway;
    const x = Math.cos(data.angle) * swayR;
    const y = Math.sin(data.angle) * swayR;
    s.position.copy(pos)
      .add(normal.clone().multiplyScalar(x))
      .add(binormal.clone().multiplyScalar(y));
    // subtle opacity pulse
    s.material.opacity = 0.03 + Math.abs(Math.sin(t * 0.0005 + data.phase)) * 0.05;
    // tint: if override provided, use it directly; else follow light color directly
    if (cloudColorOverride) {
      s.material.color.copy(cloudColorOverride);
    } else {
      s.material.color.copy(light.color);
    }
  }
}

function checkSpheresForPenalty() {
  const camPos = camera.position;
  const prevPos = prevCamPos;
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
      score--;
      flashTubeWire(0xff0000, 500);
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
        score--;
        flashTubeWire(0xff0000, 500);
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
          score--;
          flashTubeWire(0xff0000, 500);
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

//create a function that changes the color of the light randomly as camera moves
//color changes should change slowly and smoothly
function changeLightColor(t) {
    const h = (t * 0.0001) % 1; // smooth hue cycle
    light.color.setHSL(h, 1, 0.5);
    setCloudsColor(h, 1, 0.5)
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
    mouseSmoothed.x += (ease(mouseTarget.x) - mouseSmoothed.x) * 0.22;
    mouseSmoothed.y += (ease(mouseTarget.y) - mouseSmoothed.y) * 0.22;

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

    const camPos = pos.clone().add(offset);
    prevCamPos.copy(camera.position);
    camera.position.copy(camPos);
    // smooth look-at for reduced jitter
    lookAtSmoothed.lerp(lookAt, 0.35);
    camera.lookAt(lookAtSmoothed);
}

let prevTimeMs = 0;
function animateLoop(t = 0){
    requestAnimationFrame(animateLoop);
    const dt = ((t - prevTimeMs) * 0.001) || 0;
    prevTimeMs = t;
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

animateLoop();