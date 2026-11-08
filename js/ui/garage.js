// 3D showroom: the chosen truck rotating on a turntable.
import * as THREE from 'three';
import { buildPlayerTruck } from '../world/models.js';
import { Builder } from '../util.js';

export class Showroom {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#2a2f3a');
    this.scene.fog = new THREE.Fog('#2a2f3a', 40, 90);
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
    this.scene.add(new THREE.HemisphereLight('#fff7e8', '#404a5a', 1.2));
    const d = new THREE.DirectionalLight('#ffffff', 1.6); d.position.set(10, 20, 8); this.scene.add(d);
    const b = new Builder();
    b.cyl(9, 9, 0.3, 40, 0, -0.15, 0, '#3b414d');
    b.cyl(9.2, 9.2, 0.1, 40, 0, -0.27, 0, '#ff9f1a');
    for (let i = 0; i < 12; i++) b.box(0.15, 0.02, 7, 0, 0.01, 0, '#4a5262', 0, i * Math.PI / 12, 0);
    this.table = b.mesh();
    this.scene.add(this.table);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshLambertMaterial({ color: '#1f232b' }));
    floor.rotation.x = -Math.PI / 2; floor.position.y = -0.3; this.scene.add(floor);
    this.holder = new THREE.Group();
    this.scene.add(this.holder);
    this.angle = 0.6;
    this.offsetX = 0;
  }
  setTruck(spec, cargo) {
    while (this.holder.children.length) this.holder.remove(this.holder.children[0]);
    const m = buildPlayerTruck(spec, cargo);
    const g = new THREE.Group();
    g.add(m.root);
    let len = m.cabFront - m.rearZ;
    let mid = (m.cabFront + m.rearZ) / 2;
    if (m.trailer) {
      m.trailer.group.position.set(0, 0, 0.3);
      g.add(m.trailer.group);
      len = m.cabFront - (0.3 + m.trailer.back);
      mid = (m.cabFront + 0.3 + m.trailer.back) / 2;
    }
    m.root.position.z = -mid; if (m.trailer) m.trailer.group.position.z -= mid;
    this.holder.add(g);
    this.len = len;
    this.model = m;
  }
  render(renderer, dt, w, h) {
    this.angle += dt * 0.45;
    this.holder.rotation.y = this.angle;
    this.table.rotation.y = this.angle;
    this.camera.aspect = w / h;
    const dist = Math.max(11, this.len * 1.05) * (w / h < 1.6 ? 1.2 : 1);
    this.camera.position.set(Math.sin(0.6) * dist, dist * 0.32, Math.cos(0.6) * dist);
    this.camera.lookAt(0, 1.4, 0);
    // shift the truck sideways in the frame (for the cargo screen)
    this.camera.setViewOffset(w, h, this.offsetX * w, h * 0.06, w, h);
    this.camera.updateProjectionMatrix();
    renderer.render(this.scene, this.camera);
  }
}
