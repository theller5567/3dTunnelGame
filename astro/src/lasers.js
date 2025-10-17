import * as THREE from 'three';

export class LaserSystem {
  constructor(scene, composer) {
    this.scene = scene;
    this.composer = composer;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.items = [];
    this.maxDistance = 3.0; // how far lasers travel
    this.speed = 6.0; // units/sec
    this.width = 0.01;
    this.duration = 0.4; // seconds fallback lifetime
    this.laserAmount = 1; // how many lasers to spawn
  }

  spawn(origin, direction, color = 0x00ffff, amount) {
    for (let i = 0; i < amount; i++) {
      const mat = new THREE.MeshBasicMaterial({ color });
      const geom = new THREE.CylinderGeometry(this.width, this.width, 0.2, 8);
      const mesh = new THREE.Mesh(geom, mat);
      // orient cylinder along direction
      const up = new THREE.Vector3(0,1,0);
      const quat = new THREE.Quaternion().setFromUnitVectors(up, direction.clone().normalize());
      mesh.quaternion.copy(quat);
      // center the cylinder so it extends forward from origin
      mesh.position.copy(origin.clone().add(direction.clone().normalize().multiplyScalar(0.1)));
      mesh.userData = {
        start: origin.clone(),
        dir: direction.clone().normalize(),
        traveled: 0,
        life: 0
      };
      this.group.add(mesh);
      this.items.push(mesh);
    }
  }

  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const l = this.items[i];
      const data = l.userData;
      const step = this.speed * dt;
      data.traveled += step;
      data.life += dt;
      l.position.add(data.dir.clone().multiplyScalar(step));
      if (data.traveled >= this.maxDistance || data.life >= this.duration) {
        this._dispose(i);
      }
    }
  }

  // simple segment vs AABB approximation using laser cylinder as thin segment
  // returns index of hit box or -1
  findHitBox(boxes) {
    for (let i = 0; i < this.items.length; i++) {
      const laser = this.items[i];
      const start = laser.userData.start;
      const end = laser.position.clone();
      for (let b = boxes.length - 1; b >= 0; b--) {
        const box = boxes[b];
        if (!box || box.userData.disintegrated) continue;
        const size = (box.userData.size || 0.05) * 0.5;
        const min = box.position.clone().addScalar(-size);
        const max = box.position.clone().addScalar(size);
        if (this._segmentAabbIntersect(start, end, min, max)) {
          return { laserIndex: i, boxIndex: b };
        }
      }
    }
    return null;
  }

  removeAt(index) {
    this._dispose(index);
  }

  _dispose(i) {
    const m = this.items[i];
    if (!m) return;
    this.group.remove(m);
    if (m.geometry) m.geometry.dispose();
    if (m.material) m.material.dispose();
    this.items.splice(i, 1);
  }

  _segmentAabbIntersect(p0, p1, bbmin, bbmax) {
    // Liang-Barsky style parametric slab test
    const d = new THREE.Vector3().subVectors(p1, p0);
    let tmin = 0;
    let tmax = 1;
    for (const axis of ['x','y','z']) {
      const inv = d[axis] !== 0 ? 1 / d[axis] : Infinity;
      let t1 = (bbmin[axis] - p0[axis]) * inv;
      let t2 = (bbmax[axis] - p0[axis]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmax < tmin) return false;
    }
    return true;
  }
}
