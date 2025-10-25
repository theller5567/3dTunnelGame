import * as THREE from 'https://esm.sh/three@0.159.0';

export class GateSystem {
    constructor(scene, path, spawnStartU = 0.12) {
        this.scene = scene;
        this.path = path;
        this.spawnStartU = spawnStartU;
        this.gates = [];
    }

    clear() {
        for (let i = this.gates.length - 1; i >= 0; i--) {
            const g = this.gates[i];
            this.scene.remove(g);
            if (g.geometry) g.geometry.dispose();
            if (g.material) g.material.dispose();
        }
        this.gates.length = 0;
    }

    spawn(count = 10, startU = this.spawnStartU, options = {}) {
        const {
          radiusMin = 0.25,
          radiusMax = 0.25,
          // placeholders for Step 3 (movement); fine to leave unused for now
          movers = false,
          moveSpeed = 0,
          moveAmplitude = 0
        } = options;
      
        const rMin = Math.min(radiusMin, radiusMax);
        const rMax = Math.max(radiusMin, radiusMax);
      
        for (let i = 0; i < count; i++) {
          const u = (startU + Math.random() * (1 - startU)) % 1;
          const center = this.path.getPointAt(u);
          const tangent = this.path.getTangentAt(u).normalize();
          const arbitrary = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
          const normal = new THREE.Vector3().crossVectors(tangent, arbitrary).normalize();
          const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
      
          const ringRadius = rMin + Math.random() * (rMax - rMin); // randomized per ring
          const tube = new THREE.TorusGeometry(ringRadius, 0.01, 8, 64);
          const mat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
          const ring = new THREE.Mesh(tube, mat);
      
          const m = new THREE.Matrix4();
          m.makeBasis(normal, binormal, tangent);
          ring.matrixAutoUpdate = false;
          ring.position.copy(center);
          ring.setRotationFromMatrix(m);
          ring.updateMatrix();
      
          ring.userData.center = center.clone();
          ring.userData.planeNormal = tangent.clone();
          ring.userData.ringRadius = ringRadius;
          ring.userData.halfWidth = 0.02;
          ring.userData.u = u; // store param location along the path for orientation recompute
      
          // stash movement config (will use in Step 3)
          ring.userData.movers = !!movers;
          ring.userData.moveSpeed = moveSpeed;
          ring.userData.moveAmplitude = moveAmplitude;
          ring.userData.movePhase = Math.random() * Math.PI * 2;
      
          this.scene.add(ring);
          this.gates.push(ring);
        }
      }

    // returns number of gates passed this frame
    checkPasses(prevPos, currPos, onPass) {
        const seg = new THREE.Vector3().subVectors(currPos, prevPos);
        let count = 0;
        for (let i = this.gates.length - 1; i >= 0; i--) {
            const g = this.gates[i];
            if (!g || !g.userData) { this.gates.splice(i, 1); continue; }
            const center = g.userData.center;
            const n = g.userData.planeNormal;
            const radius = g.userData.ringRadius;
            const halfWidth = g.userData.halfWidth || 0.02;
            const d0 = new THREE.Vector3().subVectors(prevPos, center).dot(n);
            const d1 = new THREE.Vector3().subVectors(currPos, center).dot(n);
            const crossed = (d0 === 0 && d1 !== 0) || (d1 === 0 && d0 !== 0) || (d0 * d1 <= 0);
            if (crossed) {
                const denom = seg.dot(n);
                if (Math.abs(denom) < 1e-6) continue;
                const t = -d0 / denom;
                if (t < 0 || t > 1) continue;
                const hit = prevPos.clone().add(seg.clone().multiplyScalar(t));
                const radial = hit.clone().sub(center);
                radial.sub(n.clone().multiplyScalar(radial.dot(n)));
                const r = radial.length();
                if (r <= radius + halfWidth) {
                    if (onPass) onPass(g);
                    console.log('gate passed');
                    // turn red briefly then remove
                    // force a strong red flash by swapping the material
                    try {
                        if (g.material) {
                            if (Array.isArray(g.material)) g.material.forEach(m => m && m.dispose());
                            else g.material.dispose();
                        }
                        g.material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                        g.material.needsUpdate = true;
                    } catch (_) {}
                    const gate = g;
                    // remove from the list immediately to avoid re-detection
                    this.gates.splice(i, 1);
                    count++;
                    setTimeout(() => {
                        this.scene.remove(gate);
                        if (gate.geometry) gate.geometry.dispose();
                        if (gate.material) {
                            if (Array.isArray(gate.material)) gate.material.forEach(m => m && m.dispose());
                            else gate.material.dispose();
                        }
                    }, 1000);
                }
            } else {
                // Fallback: if current point is within the ring slab and radial radius, treat as pass
                const slab = Math.abs(d1) <= (halfWidth * 2);
                const radialNow = currPos.clone().sub(center);
                radialNow.sub(n.clone().multiplyScalar(radialNow.dot(n)));
                const rNow = radialNow.length();
                if (slab && rNow <= radius + halfWidth) {
                    if (onPass) onPass(g);
                    if (g.material) {
                        if (Array.isArray(g.material)) g.material.forEach(m => m && m.dispose());
                        else g.material.dispose();
                    }
                    g.material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
                    g.material.needsUpdate = true;
                    const gate = g;
                    this.gates.splice(i, 1);
                    count++;
                    setTimeout(() => {
                        this.scene.remove(gate);
                        if (gate.geometry) gate.geometry.dispose();
                        if (gate.material) {
                            if (Array.isArray(gate.material)) gate.material.forEach(m => m && m.dispose());
                            else gate.material.dispose();
                        }
                    }, 1000);
                }
            }
        }
        return count;
    }

    // Animate moving gates across the tube cross-section
    update(t, dt) {
        if (!this.gates || !this.gates.length) return;
        const timeSec = (typeof t === 'number') ? (t * 0.001) : 0; // t arrives in ms from raf
        for (let i = 0; i < this.gates.length; i++) {
            const g = this.gates[i];
            if (!g || !g.userData) continue;
            const d = g.userData;
            if (!d.movers || !this.path) continue;
            const u = (typeof d.u === 'number') ? d.u : 0;
            const baseCenter = this.path.getPointAt(u);
            const tangent = this.path.getTangentAt(u).normalize();
            const arbitrary = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
            const normal = new THREE.Vector3().crossVectors(tangent, arbitrary).normalize();
            const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();

            const speed = d.moveSpeed || 0;
            const amp = d.moveAmplitude || 0;
            const phase = d.movePhase || 0;
            const theta = phase + timeSec * speed;
            const offset = normal.clone().multiplyScalar(Math.cos(theta) * amp)
                .add(binormal.clone().multiplyScalar(Math.sin(theta) * amp));

            g.position.copy(baseCenter).add(offset);
            const m = new THREE.Matrix4();
            m.makeBasis(normal, binormal, tangent);
            g.setRotationFromMatrix(m);
            g.updateMatrix();
            // keep center current for collision checks
            d.center = g.position.clone();
            d.planeNormal = tangent.clone();
        }
    }
}


