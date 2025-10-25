// Utilities shared across modules
import * as THREE from 'https://esm.sh/three@0.159.0';

// createCircleSpriteTexture: generate a soft radial gradient texture.
// Used for particles and cloud sprites to get a fog-like look.
export function createCircleSpriteTexture(size) {
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


