// CloudSystem: manages a group of billboard sprite "clouds" inside the tube.
// - Spawns sprites (with a soft radial texture) distributed around the spline.
// - Animates gentle drift along the tunnel and radial sway.
// - Supports a global color override or following a light color.
import * as THREE from 'three';
import { createCircleSpriteTexture } from './utils.js';

export class CloudSystem {
    constructor(scene, path, frames, options = {}) {
        // scene: main Three.js scene to attach the group to
        // path: THREE.Curve (CatmullRomCurve3) the tunnel follows
        // frames: Frenet frames for the path (normals/binormals per segment)
        this.scene = scene;
        this.path = path;
        this.frames = frames;
        this.group = new THREE.Group();
        this.scene.add(this.group);
        this.texture = createCircleSpriteTexture(64);
        this.white = new THREE.Color(0xffffff);
        this.colorOverride = null;
        this.additive = options.additive !== false;
    }

    // setColor: set a global color override (hex/THREE.Color) or via HSL
    setColor(colorOrH, s, l) {
        if (typeof colorOrH === 'number' && typeof s === 'number' && typeof l === 'number') {
            const c = new THREE.Color();
            c.setHSL(colorOrH, s, l);
            this.colorOverride = c;
            return;
        }
        if (colorOrH == null) { this.colorOverride = null; return; }
        if (colorOrH && colorOrH.isColor) { this.colorOverride = colorOrH.clone(); return; }
        this.colorOverride = new THREE.Color(colorOrH);
    }

    // addCloud: create a single sprite at param u (0..1) with radial offset
    addCloud(u, radius, size, colorHex = 0xffffff, opacity = 0.05) {
        const mat = new THREE.SpriteMaterial({
            map: this.texture,
            color: colorHex,
            transparent: true,
            opacity,
            depthWrite: false,
            blending: this.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
            premultipliedAlpha: !this.additive
        });
        const sprite = new THREE.Sprite(mat);
        sprite.scale.set(size, size, 1);
        // Pick the appropriate local frame (normal/binormal) at this u
        const idx = Math.floor(u * this.frames.tangents.length);
        const normal = this.frames.normals[idx % this.frames.normals.length].clone();
        const binormal = this.frames.binormals[idx % this.frames.binormals.length].clone();
        const pos = this.path.getPointAt(u);
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
        this.group.add(sprite);
        return sprite;
    }

    // populate: spawn a batch of clouds well within the tube radius
    populate(count = 320, tubeRadius = 0.5) {
        for (let i = 0; i < count; i++) {
            const u = Math.random();
            const r = THREE.MathUtils.lerp(tubeRadius * 0.3, tubeRadius * 0.84, Math.random());
            const size = THREE.MathUtils.lerp(0.25, 1.0, Math.random());
            this.addCloud(u, r, size, 0xffffff, 0.05);
        }
    }

    // update: drift along the tunnel, sway radially, and tint
    update(t, dt, lightColor, musicEnergy = 0, musicBeat = false) {
        const children = this.group.children;
        for (let i = 0; i < children.length; i++) {
            const s = children[i];
            const data = s.userData;
            data.u = (data.u + data.speed * dt) % 1;
            const idx = Math.floor(data.u * this.frames.tangents.length);
            const normal = this.frames.normals[idx % this.frames.normals.length];
            const binormal = this.frames.binormals[idx % this.frames.binormals.length];
            const pos = this.path.getPointAt(data.u);
            const swayR = data.radius + Math.sin(t * 0.001 + data.phase) * data.sway;
            const x = Math.cos(data.angle) * swayR;
            const y = Math.sin(data.angle) * swayR;
            s.position.copy(pos)
                .add(normal.clone().multiplyScalar(x))
                .add(binormal.clone().multiplyScalar(y));
            // base opacity oscillation, scaled by music energy
            const base = 0.03 + Math.abs(Math.sin(t * 0.0005 + data.phase)) * 0.05;
            const musicBoost = musicEnergy * 0.04 + (musicBeat ? 0.02 : 0);
            s.material.opacity = base + musicBoost;
            if (this.colorOverride) {
                s.material.color.copy(this.colorOverride);
            } else if (lightColor) {
                s.material.color.copy(lightColor);
            }
        }
    }
}


