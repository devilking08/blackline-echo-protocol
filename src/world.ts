import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { seeded, type Collider } from "./core";
export interface Actor {
  id: number;
  root: T.Group;
  hp: number;
  cooldown: number;
  stunned: number;
  alert: number;
  home: T.Vector3;
  phase: number;
}
export interface Pickup {
  root: T.Group;
  kind: "med" | "ammo";
  taken: boolean;
}
const C = {
  cyan: 0x35e4ee,
  pink: 0xff397c,
  amber: 0xff9e4d,
  lime: 0xd2ff54,
  dark: 0x111e29,
};
export class City {
  readonly scene = new T.Scene();
  readonly walls: Collider[] = [];
  readonly actors: Actor[] = [];
  readonly pickups: Pickup[] = [];
  readonly targetMeshes: T.Object3D[] = [];
  readonly scenery: T.Object3D[] = [];
  readonly cars: T.Group[] = [];
  readonly pedestrians: T.Group[] = [];
  readonly objective = new T.Group();
  readonly rain: T.LineSegments;
  readonly rainPositions: Float32Array;
  readonly weapon = new T.Group();
  readonly muzzle = new T.Mesh(
    new T.ConeGeometry(0.08, 0.28, 6),
    new T.MeshBasicMaterial({ color: 0xffdd99 }),
  );
  private rng = seeded(2079);
  private batch = new Map<
    T.Material,
    { p: T.Vector3; s: T.Vector3; r: T.Euler }[]
  >();
  private boxGeometry = new T.BoxGeometry(1, 1, 1);
  private mats = new Map<string, T.Material>();
  private clock = 0;
  private wet: T.ShaderMaterial;
  private fan = new T.Group();
  private holo = new T.Group();
  constructor(readonly camera: T.PerspectiveCamera) {
    this.scene.background = new T.Color(0x121722);
    this.scene.fog = new T.FogExp2(0x18232e, 0.012);
    this.scene.add(new T.HemisphereLight(0x9dbdd2, 0x223040, 2.1));
    const moon = new T.DirectionalLight(0x7cb8ca, 2.4);
    moon.position.set(-30, 60, 40);
    this.scene.add(moon);
    const sunset = new T.DirectionalLight(0xff8469, 1.4);
    sunset.position.set(30, 15, -60);
    this.scene.add(sunset);
    this.wet = new T.ShaderMaterial({
      uniforms: { time: { value: 0 } },
      vertexShader: `varying vec3 world;void main(){world=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(world,1.);}`,
      fragmentShader: `varying vec3 world;uniform float time;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}void main(){vec2 p=world.xz;float n=hash(floor(p*18.));vec3 c=vec3(.025,.044,.061)+n*.012;float lane=(1.-step(.045,abs(abs(p.x)-2.8)))*step(.47,fract((p.y+3.)/5.));c+=lane*vec3(.45,.38,.19);float reflection=pow(max(0.,1.-abs(p.x)/10.),2.);float ripple=sin(p.y*7.+sin(p.x*3.)*.8+time*.6)*.5+.5;float neon=pow(max(0.,sin(p.y*.25)),12.)*reflection*(.25+ripple*.2);c+=neon*mix(vec3(.01,.23,.32),vec3(.38,.035,.12),step(0.,p.x));float stripe=step(.91,fract(p.y*.6))*step(abs(p.x),6.8)*step(abs(p.y-20.),2.5);c+=stripe*.27;float drain=step(.92,fract(p.y*4.))*step(7.05,abs(p.x))*step(abs(p.x),7.35);c+=drain*.11;gl_FragColor=vec4(c,1.);}`,
    });
    const ground = new T.Mesh(new T.PlaneGeometry(360, 460), this.wet);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);
    this.buildCity();
    this.buildProps();
    this.buildSkyline();
    this.buildLandmarks();
    this.buildActors();
    this.buildWeapon();
    this.flush();
    const ring = new T.Mesh(
      new T.TorusGeometry(0.48, 0.023, 6, 30),
      new T.MeshBasicMaterial({ color: C.lime }),
    );
    ring.rotation.x = Math.PI / 2;
    this.objective.add(ring);
    const diamond = new T.Mesh(
      new T.OctahedronGeometry(0.17),
      new T.MeshBasicMaterial({ color: C.lime, wireframe: true }),
    );
    diamond.position.y = 2.9;
    this.objective.add(diamond);
    this.scene.add(this.objective);
    this.rainPositions = new Float32Array(1600 * 6);
    for (let i = 0; i < this.rainPositions.length; i += 6) {
      const x = (this.rng() - 0.5) * 100,
        y = this.rng() * 42,
        z = (this.rng() - 0.5) * 170;
      this.rainPositions.set([x, y, z, x - 0.045, y + 0.65, z], i);
    }
    const rg = new T.BufferGeometry();
    rg.setAttribute("position", new T.BufferAttribute(this.rainPositions, 3));
    this.rain = new T.LineSegments(
      rg,
      new T.LineBasicMaterial({
        color: 0x91b8cc,
        transparent: true,
        opacity: 0.23,
        depthWrite: false,
      }),
    );
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }
  private material(color: number, glow = false, opacity = 1): T.Material {
    const key = `${color}-${glow}-${opacity}`;
    let m = this.mats.get(key);
    if (!m) {
      m = glow
        ? new T.MeshBasicMaterial({
            color,
            transparent: opacity < 1,
            opacity,
            depthWrite: opacity === 1,
          })
        : new T.MeshLambertMaterial({ color });
      this.mats.set(key, m);
    }
    return m;
  }
  private box(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    glow = false,
    rot = 0,
  ) {
    const m = this.material(color, glow);
    if (!this.batch.has(m)) this.batch.set(m, []);
    this.batch.get(m)!.push({
      p: new T.Vector3(x, y, z),
      s: new T.Vector3(w, h, d),
      r: new T.Euler(0, rot, 0),
    });
  }
  private solid(
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color = 0x172733,
  ) {
    this.box(x, h / 2, z, w, h, d, color);
    this.walls.push({ x, z, w, d });
  }
  private flush() {
    const dummy = new T.Object3D();
    for (const [mat, entries] of this.batch) {
      const mesh = new T.InstancedMesh(this.boxGeometry, mat, entries.length);
      entries.forEach((e, i) => {
        dummy.position.copy(e.p);
        dummy.scale.copy(e.s);
        dummy.rotation.copy(e.r);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.computeBoundingSphere();
      this.scene.add(mesh);
      this.scenery.push(mesh);
    }
    this.batch.clear();
  }
  private sign(
    text: string,
    sub: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    color: number,
    rotation = 0,
  ) {
    const canvas = document.createElement("canvas");
    canvas.width = 768;
    canvas.height = 256;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#07151d";
    c.fillRect(0, 0, 768, 256);
    const css = "#" + color.toString(16).padStart(6, "0");
    c.strokeStyle = css;
    c.lineWidth = 4;
    c.strokeRect(8, 8, 752, 240);
    c.fillStyle = css;
    c.font = "700 108px Rajdhani, sans-serif";
    c.textAlign = "center";
    c.fillText(text, 384, 137, 720);
    c.font = "500 29px monospace";
    c.fillText(sub, 384, 208, 720);
    for (let i = 16; i < 760; i += 16) {
      c.fillRect(i, 233, 7, 4);
    }
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map: tex, side: T.DoubleSide }),
    );
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    this.scene.add(mesh);
    return mesh;
  }
  private buildCity() {
    for (const s of [-1, 1]) {
      this.box(s * 9, 0.1, 0, 3.3, 0.2, 166, 0x354451);
      this.box(s * 7.4, 0.16, 0, 0.15, 0.3, 166, 0x707c7a);
      for (let k = 0; k < 9; k++) {
        const z = 70 - k * 18;
        if (k === 3 || k === 6) continue;
        const w = 10 + this.rng() * 5,
          d = 14,
          h = 17 + this.rng() * 35,
          x = s * (10.7 + w / 2);
        const col = [0x162b38, 0x243443, 0x23323a, 0x2d3643][k % 4];
        this.solid(x, z, w, h, d, col);
        this.box(x, h + 0.45, z, w + 0.5, 0.7, d + 0.5, 0x0d1721);
        this.box(x, h + 1.6, z, 3, 2, 4, 0x3b4b52);
        const front = x - s * (w / 2 + 0.025);
        for (let yy = 4; yy < h - 1; yy += 2.6) {
          for (let zz = z - d / 2 + 1; zz < z + d / 2; zz += 1.65) {
            if (this.rng() > 0.44)
              this.box(
                front,
                yy,
                zz,
                0.045,
                0.85,
                0.78,
                [0x65b4bd, 0xd6ad77, 0x3d758e, 0xdaa779][k % 4],
                true,
              );
          }
        }
        for (let xx = x - w / 2 + 0.8; xx < x + w / 2; xx += 1.7)
          for (let yy = 4; yy < h - 1; yy += 2.6) {
            if (this.rng() > 0.38)
              this.box(
                xx,
                yy,
                z + d / 2 + 0.03,
                0.7,
                0.9,
                0.04,
                k % 2 ? 0x527e94 : 0xb59d76,
                true,
              );
          }
        this.box(front - s * 0.08, 2.8, z, 0.35, 0.12, d, 0x455f66);
        for (let zz = z - 5; zz < z + 6; zz += 3.6) {
          this.box(front - s * 0.2, 1.5, zz, 0.3, 2.6, 2.8, 0x101e28);
          this.box(
            front - s * 0.39,
            2.8,
            zz,
            0.08,
            0.07,
            2.7,
            k % 2 ? C.pink : C.cyan,
            true,
          );
        }
        this.box(
          front - s * 0.12,
          h / 2,
          z - 6,
          0.07,
          h,
          0.12,
          k % 2 ? 0x894455 : 0x28616d,
          true,
        );
        for (let yy = 5; yy < h; yy += 8)
          this.box(front - s * 0.2, yy, z + 4, 0.65, 1.2, 1.5, 0x46535b);
        if (k % 2 === 0) {
          const words =
            s < 0
              ? ["SYNTH", "LOWTIDE", "NO SIGNAL", "GHOST FM", "KŌRI"]
              : ["MEMORY", "HOTEL 09", "VOID", "AURA", "REPAIR"];
          this.sign(
            words[k / 2],
            s < 0 ? "BODY / MIND / MACHINE" : "THE FUTURE IS BORROWED",
            front - s * 0.18,
            6.1,
            z + 2,
            8.5,
            2.6,
            k % 4 ? C.pink : C.cyan,
            (-s * Math.PI) / 2,
          );
        }
        // Fire escapes and service piping along the inward-facing facades.
        for (let yy = 4; yy < Math.min(h, 25); yy += 4) {
          this.box(front - s * 0.4, yy, z - 3, 1.1, 0.12, 3.5, 0x43515c);
          this.box(front - s * 0.9, yy + 0.6, z - 3, 0.08, 1.1, 3.5, 0x344c57);
        }
      }
    }
    for (let z = -68; z < 80; z += 17) {
      for (const s of [-1, 1]) {
        this.box(s * 7.2, 3, z, 0.1, 6, 0.1, 0x516371);
        this.box(s * 6.5, 6, z, 1.6, 0.09, 0.13, 0x6b7b85);
        this.box(
          s * 6.5,
          5.94,
          z,
          1.4,
          0.04,
          0.16,
          z % 2 ? C.cyan : C.amber,
          true,
        );
      }
    }
    // Distant cross-streets are bounded to keep traversal within the authored district.
    this.walls.push(
      { x: 0, z: -87, w: 130, d: 1 },
      { x: 0, z: 84, w: 130, d: 1 },
      { x: -62, z: 0, w: 1, d: 172 },
      { x: 62, z: 0, w: 1, d: 172 },
    );
    for (const z of [16, -38]) {
      this.box(0, 11, z, 24, 1.2, 3.4, 0x253342);
      this.box(0, 11.65, z, 24, 0.06, 3.4, 0x5a6470);
      for (const s of [-1, 1])
        this.box(0, 11.9, z + s * 1.65, 24, 0.5, 0.09, 0x384957);
      this.box(0, 10.35, z + 1.74, 23, 0.08, 0.08, C.pink, true);
    }
  }
  private buildSkyline() {
    for (let i = 0; i < 85; i++) {
      const angle = this.rng() * Math.PI * 2,
        r = 60 + this.rng() * 95,
        rawX = Math.sin(angle) * r,
        z = Math.cos(angle) * r - 25,
        x = z > -95 && Math.abs(rawX) < 68 ? (rawX < 0 ? -1 : 1) * 78 : rawX,
        h = 25 + this.rng() * 100,
        w = 5 + this.rng() * 12;
      this.box(x, h / 2, z, w, h, w, 0x152431);
      this.box(x, h, z, w, 0.1, w, 0x324952);
      for (let j = 5; j < h; j += 4) {
        this.box(
          x,
          j,
          z + w / 2 + 0.03,
          w * 0.75,
          0.13,
          0.05,
          i % 3 ? 0x375c72 : 0x794d68,
          true,
        );
      }
      if (i % 4 === 0) {
        this.box(
          x + w / 2,
          h / 2,
          z,
          0.08,
          h,
          w * 0.7,
          i % 2 ? 0x3d9ca5 : 0xa2516d,
          true,
        );
        this.box(x, h + 4, z, 0.12, 8, 0.12, 0x526a7a);
        this.box(x, h + 8, z, 0.22, 0.22, 0.22, 0xff536c, true);
      }
    }
    // Original monumental archive with tiered crown and vertical illuminated ribs.
    this.solid(0, -80, 20, 61, 13, 0x263546);
    this.box(0, 64, -80, 15, 6, 10, 0x1d3143);
    this.box(0, 69, -80, 10, 4, 7, 0x2f4455);
    this.box(0, 75, -80, 0.3, 10, 0.3, C.pink, true);
    for (let x = -8; x <= 8; x += 2) {
      this.box(
        x,
        32,
        -73.42,
        0.16,
        56,
        0.07,
        x % 4 === 0 ? C.cyan : 0x3d6678,
        true,
      );
    }
    this.sign("ORISON", "WE KEEP WHAT MAKES YOU", 0, 43, -73.3, 16, 4, C.cyan);
    this.sign(
      "ECHO ARCHIVE",
      "AUTHORIZED PERSONNEL ONLY",
      0,
      7,
      -73.2,
      16,
      2.6,
      C.pink,
    );
  }
  private buildProps() {
    for (let i = 0; i < 38; i++) {
      const s = i % 2 ? -1 : 1,
        z = -67 + i * 3.8;
      if (Math.abs(z - 32) < 5 || Math.abs(z - 2) < 4) continue;
      const x = s * (8 + this.rng() * 1.3);
      if (i % 3 === 0) {
        this.solid(x, z, 1.4, 1.1, 1.2, 0x3c4b51);
        this.box(x, 1.14, z, 1.42, 0.06, 1.22, 0x8a876c);
      } else if (i % 3 === 1) {
        this.box(x, 0.6, z, 0.7, 1.2, 0.7, 0x182c38);
        this.box(x, 1.2, z, 0.76, 0.12, 0.76, 0x526676);
      } else {
        this.box(x, 0.2, z, 1.2, 0.4, 0.7, 0x39434d);
      }
    }
    // Noodle stand: canvas awning, visible counter, stools, preparation machinery.
    const x = 8.7,
      z = 32;
    this.solid(x, z, 2.5, 1, 4, 0x3c4245);
    this.box(x, 1.07, z, 3, 0.15, 4.5, 0xa07c60);
    this.box(x, 3.2, z, 4, 0.24, 5, 0xb55043);
    for (const zz of [z - 2.3, z + 2.3])
      this.box(7, 1.6, zz, 0.09, 3.2, 0.09, 0x708087);
    this.sign(
      "MIDNIGHT RAMEN",
      "OPEN UNTIL THE END",
      7.8,
      3.7,
      34.6,
      5,
      1.2,
      C.amber,
    );
    for (let j = 0; j < 3; j++) {
      this.box(6.7, 0.5, z - 1.4 + j * 1.4, 0.65, 1, 0.65, 0x526b71);
      this.box(6.7, 1.03, z - 1.4 + j * 1.4, 0.8, 0.12, 0.8, 0xb36147);
      const lamp = new T.Mesh(
        new T.SphereGeometry(0.22, 10, 8),
        new T.MeshBasicMaterial({ color: C.amber }),
      );
      lamp.position.set(6.8, 2.7, z - 1.6 + j * 1.6);
      lamp.scale.y = 1.4;
      this.scene.add(lamp);
    }
    this.sign(
      "NOODLES",
      "REAL FOOD. ALMOST.",
      8.5,
      1.7,
      34.05,
      2.3,
      0.8,
      C.amber,
    );
    const l = new T.PointLight(C.amber, 25, 10, 2);
    l.position.set(6, 3, 32);
    this.scene.add(l);
    // Service relay and archive console.
    this.solid(-6, 2, 1.3, 1.65, 0.8, 0x2c414b);
    this.box(-6, 1.8, 2, 1.5, 0.3, 1, 0x16232d);
    this.sign("RELAY / 07", "E — CONNECT", -6, 1.6, 2.42, 1.1, 0.55, C.cyan);
    this.box(-6, 1.01, 2.43, 0.85, 0.1, 0.02, C.cyan, true);
    this.solid(0, -60, 2, 1.3, 1, 0x3b4752);
    this.sign("ECHO", "MEMORY ARCHIVE", 0, 1.65, -59.45, 2, 1, C.pink);
    this.box(0, 0.06, -58, 5, 0.05, 5, 0x263c48);
    // Roadside cover, placed off the centre navigation line.
    for (const [cx, cz] of [
      [-3, -17],
      [4, -36],
      [-4, -48],
      [4, 8],
    ]) {
      this.solid(cx, cz, 2.2, 1.1, 1.2, 0x4b5055);
      this.box(cx, 1.15, cz, 2.25, 0.12, 1.25, 0x6f7070);
      for (let k = -0.8; k < 1; k += 0.4)
        this.box(
          cx + k,
          0.6,
          cz + 0.62,
          0.16,
          0.7,
          0.025,
          0xe2b259,
          false,
          -0.2,
        );
    }
    // Cables form catenaries across the road.
    const cableMat = new T.LineBasicMaterial({ color: 0x0a151e });
    for (let z = -60; z < 70; z += 16) {
      const points = [];
      for (let j = 0; j <= 20; j++) {
        const x = -12 + j * 1.2;
        points.push(
          new T.Vector3(x, 12 + (x / 12) ** 2 * 2, z + Math.sin(j * 0.15)),
        );
      }
      this.scene.add(
        new T.Line(new T.BufferGeometry().setFromPoints(points), cableMat),
      );
    }
    for (const [px, pz, kind] of [
      [-5, 21, "med"],
      [5, -8, "ammo"],
      [-5, -31, "med"],
      [5, -53, "ammo"],
    ] as const) {
      const root = new T.Group();
      const mesh = new T.Mesh(
        new T.BoxGeometry(0.55, 0.35, 0.45),
        this.material(kind === "med" ? 0xf48677 : 0xc9dc65),
      );
      root.add(mesh);
      const cross = new T.Mesh(
        new T.BoxGeometry(0.35, 0.035, 0.1),
        this.material(kind === "med" ? C.pink : C.lime, true),
      );
      cross.position.y = 0.2;
      root.add(cross);
      root.position.set(px, 0.45, pz);
      this.scene.add(root);
      this.pickups.push({ root, kind, taken: false });
    }
    const car = this.makeCar(0x334b58);
    car.position.set(0, 0, 65);
    this.scene.add(car);
    this.walls.push({ x: 0, z: 65, w: 2.4, d: 4.5 });
    for (let i = 0; i < 7; i++) {
      const car = this.makeCar([0x3d4656, 0x683740, 0x3e5f68][i % 3]);
      car.position.set(
        (i % 2 ? 1 : -1) * (18 + this.rng() * 40),
        13 + (i % 3) * 4,
        -25 + i * 12,
      );
      this.scene.add(car);
      this.cars.push(car);
    }
    for (let i = 0; i < 14; i++) {
      const p = this.makePerson([0x456776, 0x7c4b6b, 0x736653][i % 3], false);
      p.position.set((i % 2 ? -1 : 1) * 9, 0, -64 + i * 10);
      this.scene.add(p);
      this.pedestrians.push(p);
    }
    // Steam columns: clustered translucent geometry, no external textures.
    for (let i = 0; i < 9; i++) {
      const puff = new T.Mesh(
        new T.SphereGeometry(0.4 + i * 0.09, 8, 6),
        this.material(0x8ab6c5, true, 0.045),
      );
      puff.position.set(-7.6 + Math.sin(i) * 0.2, 0.2 + i * 0.3, 29);
      puff.scale.y = 1.6;
      this.scene.add(puff);
    }
  }
  private makeCar(color: number) {
    const g = new T.Group();
    const b = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      c: number,
      glow = false,
    ) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), this.material(c, glow));
      m.position.set(x, y, z);
      g.add(m);
    };
    b(0, 0.55, 0, 2.1, 0.55, 4.3, color);
    b(0, 1, 0, 1.8, 0.55, 2.1, 0x15303c);
    b(0, 1.3, 0.1, 1.8, 0.1, 2, color);
    b(0, 0.67, 2.17, 1.8, 0.13, 0.05, C.pink, true);
    b(0, 0.67, -2.17, 1.8, 0.13, 0.05, C.cyan, true);
    for (const s of [-1, 1])
      for (const z of [-1.4, 1.4]) {
        b(s * 1.02, 0.32, z, 0.25, 0.55, 0.65, 0x101920);
      }
    return this.compact(g);
  }
  private makePerson(color: number, enemy: boolean) {
    const g = new T.Group();
    const add = (
      geo: T.BufferGeometry,
      x: number,
      y: number,
      z: number,
      c: number,
      glow = false,
    ) => {
      const mesh = new T.Mesh(geo, this.material(c, glow));
      mesh.position.set(x, y, z);
      g.add(mesh);
      return mesh;
    };
    add(new T.BoxGeometry(0.52, 0.7, 0.28), 0, 1.1, 0, color);
    add(
      new T.BoxGeometry(0.31, 0.32, 0.29),
      0,
      1.65,
      0,
      enemy ? 0x344656 : 0x807c73,
    );
    add(
      new T.BoxGeometry(0.32, 0.07, 0.02),
      0,
      1.68,
      0.155,
      enemy ? C.pink : C.cyan,
      true,
    );
    for (const s of [-1, 1]) {
      const leg = add(
        new T.BoxGeometry(0.18, 0.73, 0.2),
        s * 0.16,
        0.39,
        0,
        0x1a2936,
      );
      leg.name = "leg";
      add(new T.BoxGeometry(0.15, 0.63, 0.18), s * 0.36, 1.12, 0.02, color);
      add(new T.BoxGeometry(0.2, 0.13, 0.35), s * 0.16, 0.07, 0.06, 0x131d29);
    }
    if (enemy) {
      add(new T.BoxGeometry(0.22, 0.18, 0.64), 0.37, 1.03, 0.3, 0x354958);
      add(new T.BoxGeometry(0.34, 0.07, 0.03), 0, 1.25, 0.16, C.pink, true);
    }
    return this.compact(g);
  }
  // Merge rigid model parts by material, retaining per-actor raycast identity.
  private compact(g: T.Group) {
    const groups = new Map<T.Material, T.BufferGeometry[]>();
    for (const child of [...g.children]) {
      if (!(child instanceof T.Mesh)) continue;
      child.updateMatrix();
      const geo = child.geometry.clone().applyMatrix4(child.matrix);
      const mat = child.material as T.Material;
      if (!groups.has(mat)) groups.set(mat, []);
      groups.get(mat)!.push(geo);
      child.geometry.dispose();
      g.remove(child);
    }
    for (const [mat, geos] of groups) {
      const merged = mergeGeometries(geos, false);
      if (merged) g.add(new T.Mesh(merged, mat));
      geos.forEach((geo) => geo.dispose());
    }
    return g;
  }
  private buildActors() {
    const courier = this.makePerson(0x935443, false);
    courier.position.set(5, 0, 32);
    courier.rotation.y = 0.5;
    courier.name = "Iona";
    this.scene.add(courier);
    for (let i = 0; i < 7; i++) {
      const root = this.makePerson(i % 2 ? 0x46565e : 0x3a4c59, true);
      root.position.set(i % 2 ? -4 : 4, 0, -12 - i * 6.4);
      this.scene.add(root);
      const actor: Actor = {
        id: i,
        root,
        hp: 100,
        cooldown: 1 + i * 0.17,
        stunned: 0,
        alert: 0,
        home: root.position.clone(),
        phase: i * 1.7,
      };
      root.traverse((obj) => {
        if (obj instanceof T.Mesh) {
          obj.userData.actor = actor;
          this.targetMeshes.push(obj);
        }
      });
      this.actors.push(actor);
    }
  }
  private buildLandmarks() {
    // Suspended kinetic hologram: explicit geometric installation, not a copied asset.
    const ringMat = new T.MeshBasicMaterial({
      color: C.cyan,
      transparent: true,
      opacity: 0.8,
    });
    for (let i = 0; i < 3; i++) {
      const ring = new T.Mesh(
        new T.TorusGeometry(3.2 + i * 0.4, 0.035, 6, 90),
        ringMat,
      );
      ring.rotation.set(i * 0.8, 0.2 + i * 0.6, 0);
      this.holo.add(ring);
    }
    const center = new T.Mesh(
      new T.IcosahedronGeometry(1.3, 1),
      new T.MeshBasicMaterial({
        color: C.pink,
        wireframe: true,
        transparent: true,
        opacity: 0.75,
      }),
    );
    this.holo.add(center);
    this.holo.position.set(0, 19, -26);
    this.scene.add(this.holo);
    this.sign(
      "REMEMBER TOMORROW",
      "ORISON / MEMORY AS A SERVICE",
      0,
      15.7,
      -26,
      11,
      1.8,
      C.pink,
    );
    this.sign(
      "BLACKLINE",
      "SECTOR 09 / RESTRICTED FREQUENCY",
      0,
      7.2,
      53,
      12,
      2,
      C.cyan,
      Math.PI,
    );
    this.sign(
      "東 区 09",
      "EAST WARD / KEEP MOVING",
      -10.3,
      8.5,
      37,
      3.5,
      8.5,
      C.pink,
    );
    this.sign("24H", "AUGMENTS / WALK INS", 10.3, 10, 12, 3.5, 7, C.cyan);
    for (const s of [-1, 1]) {
      const l = new T.PointLight(s < 0 ? C.pink : C.cyan, 35, 20, 2);
      l.position.set(s * 7, 5, 10);
      this.scene.add(l);
    }
  }
  private buildWeapon() {
    const b = (
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      c: number,
      glow = false,
    ) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), this.material(c, glow));
      m.position.set(x, y, z);
      this.weapon.add(m);
    };
    b(0, 0, 0, 0.14, 0.16, 0.53, 0x3d4d5a);
    b(0, 0.08, -0.04, 0.17, 0.06, 0.48, 0x697579);
    b(0, -0.17, 0.13, 0.12, 0.25, 0.14, 0x263744);
    b(0, 0.01, -0.37, 0.09, 0.09, 0.24, 0x151f29);
    b(0, 0.127, -0.17, 0.07, 0.035, 0.06, C.lime, true);
    b(0.073, 0.01, 0.07, 0.01, 0.04, 0.16, C.cyan, true);
    b(-0.07, -0.14, 0.23, 0.2, 0.18, 0.37, 0x455462);
    b(0.03, -0.16, 0.39, 0.22, 0.2, 0.4, 0x293b49);
    this.muzzle.rotation.x = -Math.PI / 2;
    this.muzzle.position.z = -0.58;
    this.muzzle.visible = false;
    this.weapon.add(this.muzzle);
    this.weapon.position.set(0.29, -0.24, -0.55);
    this.weapon.scale.setScalar(0.55);
    this.camera.add(this.weapon);
    this.scene.add(this.camera);
  }
  update(dt: number, elapsed: number, active: boolean, reducedMotion: boolean) {
    this.clock += dt;
    this.wet.uniforms.time.value = this.clock;
    this.holo.rotation.y = this.clock * 0.16;
    this.holo.rotation.z = Math.sin(this.clock * 0.1) * 0.12;
    this.objective.children[1].rotation.y += dt;
    this.objective.children[1].position.y =
      2.9 + Math.sin(this.clock * 2) * 0.13;
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];
      if (!reducedMotion) car.position.x += dt * (i % 2 ? 6 : -6);
      if (car.position.x > 85) car.position.x = -85;
      if (car.position.x < -85) car.position.x = 85;
    }
    for (let i = 0; i < this.pedestrians.length; i++) {
      const p = this.pedestrians[i];
      p.position.z += Math.sin(this.clock * 0.35 + i) * dt * 0.35;
      p.rotation.y = i % 2 ? 0 : Math.PI;
      let n = 0;
      p.children.forEach((c) => {
        if (c.name === "leg")
          c.rotation.x = Math.sin(this.clock * 2 + (n++ % 2) * Math.PI) * 0.12;
      });
    }
    if (!reducedMotion) {
      for (let i = 0; i < this.rainPositions.length; i += 6) {
        this.rainPositions[i + 1] -= dt * 17;
        this.rainPositions[i + 4] -= dt * 17;
        if (this.rainPositions[i + 1] < 0) {
          this.rainPositions[i + 1] = 42;
          this.rainPositions[i + 4] = 42.65;
        }
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
    for (const p of this.pickups) {
      if (!p.taken) {
        p.root.rotation.y += dt * 0.5;
        p.root.position.y =
          0.45 + Math.sin(elapsed * 2 + p.root.position.z) * 0.08;
      }
    }
    this.weapon.visible = active;
  }
  resetActors() {
    for (const a of this.actors) {
      a.hp = 100;
      a.alert = 0;
      a.stunned = 0;
      a.cooldown = 1;
      a.root.position.copy(a.home);
      a.root.rotation.set(0, 0, 0);
      a.root.visible = true;
    }
    for (const p of this.pickups) {
      p.taken = false;
      p.root.visible = true;
    }
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>(),
      materials = new Set<T.Material>(),
      textures = new Set<T.Texture>();
    this.scene.traverse((o) => {
      if (o instanceof T.Mesh || o instanceof T.Line) {
        geometries.add(o.geometry);
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          materials.add(m);
          if ("map" in m && m.map instanceof T.Texture) textures.add(m.map);
        }
      }
    });
    geometries.forEach((g) => g.dispose());
    materials.forEach((m) => m.dispose());
    textures.forEach((t) => t.dispose());
  }
}
