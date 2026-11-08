// Four camera views + crash replay camera.
import * as THREE from 'three';
import { clamp } from './util.js';

export const VIEWS = ['back', 'driver', 'side', 'top'];
export const VIEW_NAMES = { driver: 'Driver seat', side: 'Side view', top: 'Top view', back: 'Back view' };

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3();
const q1 = new THREE.Quaternion();
const yFlip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const pitchDown = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.13);

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.view = 'back';
    this.blend = 1;
    this.fromPos = new THREE.Vector3(); this.fromQuat = new THREE.Quaternion();
    this.smoothPos = new THREE.Vector3(); this.smoothLook = new THREE.Vector3();
    this.inited = false;
    this.shake = 0;
    this.chaseH = 0;
  }
  setView(v) {
    if (v === this.view) return;
    this.fromPos.copy(this.cam.position); this.fromQuat.copy(this.cam.quaternion);
    this.view = v; this.blend = 0; this.inited = false;
  }
  next() { const i = VIEWS.indexOf(this.view); this.setView(VIEWS[(i + 1) % VIEWS.length]); return this.view; }

  // truck: Truck sim, model: built model
  update(dt, truck, model, extraShake = 0) {
    const cam = this.cam;
    const root = model.root;
    root.updateMatrixWorld();
    const fwd = v3.set(Math.sin(truck.heading), 0, Math.cos(truck.heading));
    let pos = v1, look = v2, snap = false;
    const tlen = model.trailer ? model.trailer.length : 0;
    cam.up.set(0, 1, 0);
    if (this.view === 'driver') {
      pos.copy(model.seat).applyMatrix4(root.matrixWorld);
      root.getWorldQuaternion(q1);
      q1.multiply(yFlip).multiply(pitchDown);
      snap = true;
    } else if (this.view === 'side') {
      const c = model.trailer ? -tlen * 0.35 : (model.cabFront + model.rearZ) / 2;
      pos.set(-13 - tlen * 0.35, 3.2, c + 2).applyMatrix4(root.matrixWorld);
      look.set(0, 1.6, c + 1.5).applyMatrix4(root.matrixWorld);
    } else if (this.view === 'top') {
      const c = model.trailer ? -tlen * 0.3 : 0;
      pos.set(0, 32 + tlen * 0.8, c - 3).applyMatrix4(root.matrixWorld);
      look.set(0, 0, c + 1).applyMatrix4(root.matrixWorld);
      cam.up.copy(fwd);
    } else {
      // chase cam behind the trailer (or truck)
      let bx, bz, bh;
      if (model.trailer) {
        const tg = model.trailer.group;
        bh = truck.trailerVisH();
        bx = tg.position.x + Math.sin(bh) * model.trailer.back;
        bz = tg.position.z + Math.cos(bh) * model.trailer.back;
      } else {
        bh = truck.heading;
        bx = truck.x + Math.sin(bh) * model.rearZ;
        bz = truck.z + Math.cos(bh) * model.rearZ;
      }
      // smooth heading
      let dh = bh - this.chaseH;
      while (dh > Math.PI) dh -= 2 * Math.PI; while (dh < -Math.PI) dh += 2 * Math.PI;
      this.chaseH += dh * Math.min(1, dt * 3.5);
      if (!this.inited) this.chaseH = bh;
      const back = 9.5 + Math.min(4, Math.abs(truck.v) * 0.08);
      pos.set(bx - Math.sin(this.chaseH) * back, truck.y + 4.6 + (model.trailer ? 0.6 : 0), bz - Math.cos(this.chaseH) * back);
      look.set(truck.x + fwd.x * 8, truck.y + 2.0, truck.z + fwd.z * 8);
    }
    if (!snap) {
      const k = this.inited ? Math.min(1, dt * (this.view === 'back' ? 8 : 6)) : 1;
      this.smoothPos.lerp(pos, k); this.smoothLook.lerp(look, k);
      if (!this.inited) { this.smoothPos.copy(pos); this.smoothLook.copy(look); this.inited = true; }
      cam.position.copy(this.smoothPos);
      cam.lookAt(this.smoothLook);
    } else {
      cam.position.copy(pos);
      cam.quaternion.copy(q1);
    }
    // camera shake
    const sh = this.shake + extraShake;
    if (sh > 0.001) {
      const t = performance.now() / 1000;
      cam.position.x += Math.sin(t * 61) * sh * 0.35;
      cam.position.y += Math.sin(t * 47 + 1) * sh * 0.3;
      cam.position.z += Math.sin(t * 53 + 2) * sh * 0.35;
      cam.rotateZ(Math.sin(t * 39) * sh * 0.04);
    }
    this.shake = Math.max(0, this.shake - dt * 1.4);
    // quick blend when switching
    if (this.blend < 1) {
      this.blend = Math.min(1, this.blend + dt / 0.15);
      const b = this.blend * this.blend * (3 - 2 * this.blend);
      cam.position.lerpVectors(this.fromPos, cam.position, b);
      cam.quaternion.slerpQuaternions(this.fromQuat, cam.quaternion.clone(), b);
    }
    const fov = this.view === 'driver' ? 72 : 60;
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    // what's visible
    model.cabShell.visible = this.view !== 'driver';
    model.interior.visible = this.view === 'driver';
  }

  // replay camera: 3 angles around impact point
  replay(p, target, phase, u) {
    const cam = this.cam;
    cam.up.set(0, 1, 0);
    if (phase === 0) {
      // low tracking shot beside the truck, slightly ahead
      const h = p.h;
      cam.position.set(target.x - Math.cos(h) * 9 + Math.sin(h) * 9, target.y - 0.4, target.z + Math.sin(h) * 9 + Math.cos(h) * 9);
    } else if (phase === 1) {
      const a = u * 2.2 + 0.5;
      cam.position.set(p.x + Math.sin(a) * 15, p.y + 6, p.z + Math.cos(a) * 15);
    } else {
      cam.position.set(p.x + 2, p.y + 34, p.z + 2);
    }
    cam.lookAt(target);
    if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); }
  }
}
