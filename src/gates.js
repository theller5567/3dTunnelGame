import * as THREE from 'three';

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

    spawn(count = 10) {
        for (let i = 0; i < count; i++) {
            const u = (this.spawnStartU + Math.random() * (1 - this.spawnStartU)) % 1;
            const center = this.path.getPointAt(u);
            const tangent = this.path.getTangentAt(u).normalize();
            const arbitrary = Math.abs(tangent.y) < 0.9 ? new THREE.Vector3(0,1,0) : new THREE.Vector3(1,0,0);
            const normal = new THREE.Vector3().crossVectors(tangent, arbitrary).normalize();
            const binormal = new THREE.Vector3().crossVectors(tangent, normal).normalize();
            const ringRadius = 0.25;
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
            const center = g.userData.center;
            const n = g.userData.planeNormal;
            const radius = g.userData.ringRadius;
            const halfWidth = g.userData.halfWidth || 0.02;
            const d0 = new THREE.Vector3().subVectors(prevPos, center).dot(n);
            const d1 = new THREE.Vector3().subVectors(currPos, center).dot(n);
            if (d0 === 0 && d1 === 0) continue;
            if (d0 * d1 <= 0) {
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
                    this.scene.remove(g);
                    if (g.geometry) g.geometry.dispose();
                    if (g.material) g.material.dispose();
                    this.gates.splice(i, 1);
                    count++;
                }
            }
        }
        return count;
    }
}


