import * as THREE from 'three';
import { makeMarchMaterial } from 'orion/galaxy/volume.js';

// Sky cubemap for views from inside the galaxy (L2-L4). The volume and the procedural objects are rendered into
// the six faces of a half-float cube in GALAXY axes (so galactic rotation needs no compensation), centred on the camera
// position at capture time. Time-sliced: volume tiles with scissor, then objects per face, assembled through a 2D
// target and blitted into the cube face. Re-captured when the camera has moved more than 1 % of the distance to the
// nearest arm crest.

// GL cube-face bases: forward f, right r, up u (direction of increasing t). The camera basis is (r, u, -f).
const FACES = [
  [[1, 0, 0], [0, 0, -1], [0, -1, 0]], [[-1, 0, 0], [0, 0, 1], [0, -1, 0]],
  [[0, 1, 0], [1, 0, 0], [0, 0, 1]], [[0, -1, 0], [1, 0, 0], [0, 0, -1]],
  [[0, 0, 1], [1, 0, 0], [0, -1, 0]], [[0, 0, -1], [-1, 0, 0], [0, -1, 0]],
];
const TILES = 4;

const BG_VERT = /* glsl */ `varying vec3 vDir;
void main() { vDir = position; gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0); gl_Position.z = gl_Position.w; }`;
// Star-cloud granularity: the cube (face ~512) resolves the band only to ~0.2 deg, so a direction-space noise layer
// breaks it into clouds and dark lanes. Multiplicative with mean ~1, confined to low |b| and scaled by how bright the
// cell already is relative to its colour (bright star clouds get clumpier, dark lanes stay dark).
const BG_FRAG = /* glsl */ `uniform samplerCube tCube; uniform mat3 uRot; uniform float uWeight, uGran; varying vec3 vDir;
float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn3(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1, 0, 0)), f.x), mix(h3(i + vec3(0, 1, 0)), h3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h3(i + vec3(0, 0, 1)), h3(i + vec3(1, 0, 1)), f.x), mix(h3(i + vec3(0, 1, 1)), h3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
float fbm3(vec3 p) { float s = 0.0, a = 0.5; for (int k = 0; k < 4; k++) { s += a * vn3(p); p = p * 2.07 + 3.1; a *= 0.5; } return s / 0.9375; }
void main() {
  vec3 d = normalize(uRot * vDir);
  vec3 c = texture(tCube, d).rgb;
  float ab = abs(d.z), band = 1.0 - smoothstep(0.0, 0.24, ab), sat = 1.0 - smoothstep(0.08, 0.5, ab);
  // anisotropic: clouds are stretched along the plane (compress z before sampling)
  vec3 q = vec3(d.xy, d.z * 1.8);
  float n1 = fbm3(q * 28.0), n2 = fbm3(q * 90.0 + 11.0);
  // contrast ~2x the first pass: the real Scutum/Sagittarius star clouds run ~3-5x between cloud and rift at this scale
  // (Great Rift windows vs. the cloud cores); the old 0.55..1.45 swing read as half that. Mean stays ~1 so the integrated
  // band brightness the volume gives is unchanged, and the narrower n2 keeps fine grain from washing the clouds out.
  float cl = smoothstep(0.25, 0.8, n1);
  float g = (0.3 + 1.45 * cl) * (0.78 + 0.44 * n2) * 0.93;
  // the faint diffuse floor toward the poles/corners: suppress its reddish tint
  float L = dot(c, vec3(0.3, 0.5, 0.2));
  c = mix(vec3(L) * vec3(0.98, 0.98, 1.04), c, 0.3 + 0.7 * sat);
  c *= mix(1.0, g, band * uGran);
  gl_FragColor = vec4(c * uWeight, 1.0);
}`;
const BLIT_FRAG = /* glsl */ `uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = vec4(texture2D(tSrc, vUv).rgb, 1.0); }`;

export class SkyCube {
  constructor(app, vol, objs, face) {
    this.app = app; this.vol = vol; this.F = face;
    this.rt = new THREE.WebGLCubeRenderTarget(face, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, generateMipmaps: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.tmp = new THREE.WebGLRenderTarget(face, face, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.layer = objs.layer('cube', face);
    this.layer.setCubeProjection(face);
    this.scene = new THREE.Scene();
    this.scene.add(this.layer.group, this.layer.world);
    this.cam = new THREE.PerspectiveCamera(90, 1, 1e-7, 1e7);
    this.march = makeMarchMaterial(vol.shared);
    this.march.uniforms.uTan.value.set(1, 1);
    this.blit = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.,1.); }',
      fragmentShader: BLIT_FRAG, uniforms: { tSrc: { value: this.tmp.texture } }, depthTest: false, depthWrite: false,
    });
    this.bg = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.ShaderMaterial({
      vertexShader: BG_VERT, fragmentShader: BG_FRAG, side: THREE.DoubleSide, depthTest: false, depthWrite: false,
      transparent: true, blending: THREE.AdditiveBlending,
      uniforms: { tCube: { value: this.rt.texture }, uRot: { value: new THREE.Matrix3() }, uWeight: { value: 0 }, uGran: { value: 1 } },
    }));
    this.gran = this.bg.material.uniforms.uGran; // live handle: orion.shared.galaxy.cube.gran.value
    this.bg.frustumCulled = false; this.bg.renderOrder = -10; this.bg.visible = false;
    app.layers.sky.add(this.bg);
    this.ready = false; this.readyAt = 0; this.cap = null;
    this.capG = new Float64Array(3); this.nextG = new Float64Array(3);
    this.rotRT = new Float64Array(9); this.camWorld = new Float64Array(3);
    this._q = new THREE.Quaternion(); this._m = new THREE.Matrix4();
    this.faceQuat = FACES.map(([f, r, u]) => new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3(...r), new THREE.Vector3(...u), new THREE.Vector3(-f[0], -f[1], -f[2]))));
    this.blitScene = vol.quadScene;
  }

  // True when a (re)capture should start for this camera position.
  needsCapture(camG, distArm) {
    if (!this.ready) return true;
    const dx = camG[0] - this.capG[0], dy = camG[1] - this.capG[1], dz = camG[2] - this.capG[2];
    return Math.hypot(dx, dy, dz) > 0.01 * Math.max(distArm, 200);
  }
  start(frame, camG, gain = 1) {
    this.gain = gain;
    this.cap = { g: [camG[0], camG[1], camG[2]], face: 0, tile: 0, phase: 0 };
    const m = frame.galaxyMatrix.elements; // R^T rows = R columns
    const r = this.rotRT;
    r[0] = m[0]; r[1] = m[1]; r[2] = m[2]; r[3] = m[4]; r[4] = m[5]; r[5] = m[6]; r[6] = m[8]; r[7] = m[9]; r[8] = m[10];
    this.camWorld.set(frame.camPos);
    this.nextG.set(this.cap.g);
  }
  get capturing() { return !!this.cap; }

  // Run slices of the capture within a pixel-step budget.
  step(renderer, frame) {
    const cap = this.cap; if (!cap || !this.vol.ready) return;
    const F = this.F, ts = Math.ceil(F / TILES), steps = Math.min(56, frame.tierSettings.volumeSteps);
    let budget = 14e6;
    const prevRT = renderer.getRenderTarget();
    const u = this.march.uniforms;
    while (budget > 0 && cap.face < 6) {
      const [f, r, up] = FACES[cap.face];
      if (cap.phase === 0) {
        if (cap.tile === 0) {
          u.uM.value.fromArray([r[0], r[1], r[2], up[0], up[1], up[2], -f[0], -f[1], -f[2]]);
          this.vol.configure(u, cap.g, steps, this.gain, 0);
        }
        // vol.quad is shared with the live march/accumulate/composite passes: set the material for every tile, or a
        // slice resumed on a later frame renders the live view's last material (stretched hard-edged wedges in the sky).
        this.vol.quad.material = this.march;
        const tx = cap.tile % TILES, ty = (cap.tile / TILES) | 0;
        this.tmp.scissor.set(tx * ts, ty * ts, ts, ts); this.tmp.scissorTest = true;
        renderer.setRenderTarget(this.tmp); renderer.render(this.vol.quadScene, this.vol.quadCam);
        budget -= ts * ts * steps;
        if (++cap.tile >= TILES * TILES) { cap.phase = 1; }
      } else {
        this.tmp.scissorTest = false;
        const L = this.layer;
        L.u.uCamG.value.set(cap.g[0], cap.g[1], cap.g[2]); L.u.uVis.value = 1; L.u.uGainOut.value = this.gain;
        L.placeCube(cap.g); L.fillCatalogue(this.camWorld, this.rotRT);
        this.cam.quaternion.copy(this.faceQuat[cap.face]); this.cam.updateMatrixWorld(true);
        this.scene.updateMatrixWorld(false);
        renderer.setRenderTarget(this.tmp);
        renderer.render(this.scene, this.cam);
        this.vol.quad.material = this.blit;
        renderer.setRenderTarget(this.rt, cap.face);
        renderer.render(this.vol.quadScene, this.vol.quadCam);
        cap.face++; cap.tile = 0; cap.phase = 0;
        budget = 0; // object pass is the heavy one: end the slice
      }
    }
    renderer.setRenderTarget(prevRT);
    if (cap.face >= 6) {
      this.capG.set(cap.g); this.cap = null;
      if (!this.ready) { this.ready = true; this.readyAt = frame.time; }
    }
  }
  ramp(time) { return this.ready ? Math.min(1, (time - this.readyAt) / 1.2) : 0; }

  // Background box: world-axes view directions rotated into galaxy axes for sampling.
  setDisplay(frame, weight) {
    const m = frame.galaxyMatrix.elements, e = this.bg.material.uniforms.uRot.value.elements;
    e[0] = m[0]; e[1] = m[4]; e[2] = m[8]; e[3] = m[1]; e[4] = m[5]; e[5] = m[9]; e[6] = m[2]; e[7] = m[6]; e[8] = m[10];
    this.bg.material.uniforms.uWeight.value = weight;
    this.bg.visible = weight > 0.002;
  }
  dispose() {
    this.app.layers.sky.remove(this.bg);
    this.layer.dispose(); this.rt.dispose(); this.tmp.dispose(); this.march.dispose(); this.blit.dispose(); this.bg.material.dispose(); this.bg.geometry.dispose();
  }
}
