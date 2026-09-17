// 依存追加なしの生WebGL1ライティングプレビュー。平面 / 球の2モード。
// 平面: ビューアに正対するのでTBN自明(T+X,B+Y,N+Z)。
// 球: 各頂点でnormal/tangentを計算し、フラグメントでTBN行列を組んで接空間法線をワールドへ変換する。

export type PreviewShape = 'plane' | 'sphere';

const PLANE_VERT = `
attribute vec2 aPos;
attribute vec2 aUv;
uniform vec2 uScale;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos * uScale, 0.0, 1.0);
}`;

const PLANE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uNormal;
uniform sampler2D uAlbedo;
uniform sampler2D uAo;
uniform bool uUseAlbedo;
uniform bool uUseAo;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uIntensity;
void main() {
  vec3 n = normalize(texture2D(uNormal, vUv).rgb * 2.0 - 1.0);
  vec3 L = normalize(uLightDir);
  float diff = max(dot(n, L), 0.0);
  vec3 albedo = uUseAlbedo ? texture2D(uAlbedo, vUv).rgb : vec3(0.8);
  float ao = uUseAo ? texture2D(uAo, vUv).r : 1.0;
  gl_FragColor = vec4(albedo * ao * (uAmbient + uIntensity * diff), 1.0);
}`;

const SPHERE_VERT = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aTangent;
attribute vec2 aUv;
uniform float uAspect;
uniform float uScale;
uniform mat3 uRot;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
void main() {
  vUv = aUv;
  vec3 nn = uRot * aNormal;
  vec3 tt = uRot * aTangent;
  vN = nn;
  vT = tt;
  vB = cross(nn, tt);
  vec3 p = (uRot * aPos) * uScale;
  gl_Position = vec4(p.x / uAspect, p.y, p.z, 1.0);
}`;

const SPHERE_FRAG = `
precision highp float;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vT;
varying vec3 vB;
uniform sampler2D uNormal;
uniform sampler2D uAlbedo;
uniform sampler2D uAo;
uniform bool uUseAlbedo;
uniform bool uUseAo;
uniform vec3 uLightDir;
uniform float uAmbient;
uniform float uIntensity;
void main() {
  vec3 tn = texture2D(uNormal, vUv).rgb * 2.0 - 1.0;
  vec3 N = normalize(vT * tn.x + vB * tn.y + vN * tn.z);
  vec3 L = normalize(uLightDir);
  float diff = max(dot(N, L), 0.0);
  vec3 albedo = uUseAlbedo ? texture2D(uAlbedo, vUv).rgb : vec3(0.8);
  float ao = uUseAo ? texture2D(uAo, vUv).r : 1.0;
  gl_FragColor = vec4(albedo * ao * (uAmbient + uIntensity * diff), 1.0);
}`;

export interface PreviewParams {
  ambient: number;
  intensity: number;
  autoRotate: boolean;
  shape: PreviewShape;
}

export interface PreviewRenderer {
  setNormal(url: string): Promise<void>;
  setAlbedo(url: string | null): Promise<void>;
  setAo(url: string | null): Promise<void>;
  setLightFromCursor(nx: number, ny: number): void;
  setRotation(yaw: number, pitch: number): void;
  setParams(p: PreviewParams): void;
  start(): void;
  dispose(): void;
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('Failed to create shader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader compile: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function linkProgram(gl: WebGLRenderingContext, vert: string, frag: string): WebGLProgram {
  const prog = gl.createProgram();
  if (!prog) throw new Error('Failed to create program');
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, vert));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error('link: ' + gl.getProgramInfoLog(prog));
  }
  return prog;
}

/** 共通のライト/テクスチャ uniform を引く。 */
function lightUniforms(gl: WebGLRenderingContext, prog: WebGLProgram) {
  gl.useProgram(prog);
  gl.uniform1i(gl.getUniformLocation(prog, 'uNormal'), 0);
  gl.uniform1i(gl.getUniformLocation(prog, 'uAlbedo'), 1);
  gl.uniform1i(gl.getUniformLocation(prog, 'uAo'), 2);
  return {
    uUseAlbedo: gl.getUniformLocation(prog, 'uUseAlbedo'),
    uUseAo: gl.getUniformLocation(prog, 'uUseAo'),
    uLightDir: gl.getUniformLocation(prog, 'uLightDir'),
    uAmbient: gl.getUniformLocation(prog, 'uAmbient'),
    uIntensity: gl.getUniformLocation(prog, 'uIntensity'),
  };
}

function buildSphere(stacks: number, slices: number): { verts: Float32Array; idx: Uint16Array } {
  const verts: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stacks; i++) {
    const lat = (i / stacks) * Math.PI;
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    for (let j = 0; j <= slices; j++) {
      const lon = (j / slices) * Math.PI * 2;
      const sinLon = Math.sin(lon);
      const cosLon = Math.cos(lon);
      const nx = sinLat * cosLon;
      const ny = cosLat;
      const nz = sinLat * sinLon;
      // tangent = d(pos)/d(lon) を正規化 = (-sinLon, 0, cosLon)（lat非依存・単位長）
      verts.push(nx, ny, nz, nx, ny, nz, -sinLon, 0, cosLon, j / slices, i / stacks);
    }
  }
  for (let i = 0; i < stacks; i++) {
    for (let j = 0; j < slices; j++) {
      const a = i * (slices + 1) + j;
      const b = a + slices + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { verts: new Float32Array(verts), idx: new Uint16Array(idx) };
}

export function createPreviewRenderer(canvas: HTMLCanvasElement): PreviewRenderer {
  const ctx = canvas.getContext('webgl', {
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    depth: true,
  });
  if (!ctx) throw new Error('WebGL not supported');
  const gl: WebGLRenderingContext = ctx;

  // --- 平面 ---
  const planeProg = linkProgram(gl, PLANE_VERT, PLANE_FRAG);
  const planeBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, planeBuf);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 0, 0, 1, -1, 1, 0, -1, 1, 0, 1, 1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const planeAttr = {
    aPos: gl.getAttribLocation(planeProg, 'aPos'),
    aUv: gl.getAttribLocation(planeProg, 'aUv'),
  };
  const planeUScale = gl.getUniformLocation(planeProg, 'uScale');
  const planeLU = lightUniforms(gl, planeProg);

  // --- 球 ---
  const sphereProg = linkProgram(gl, SPHERE_VERT, SPHERE_FRAG);
  const sphere = buildSphere(48, 48);
  const sphereVbo = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, sphereVbo);
  gl.bufferData(gl.ARRAY_BUFFER, sphere.verts, gl.STATIC_DRAW);
  const sphereIbo = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereIbo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, sphere.idx, gl.STATIC_DRAW);
  const sphereAttr = {
    aPos: gl.getAttribLocation(sphereProg, 'aPos'),
    aNormal: gl.getAttribLocation(sphereProg, 'aNormal'),
    aTangent: gl.getAttribLocation(sphereProg, 'aTangent'),
    aUv: gl.getAttribLocation(sphereProg, 'aUv'),
  };
  const sphereUScale = gl.getUniformLocation(sphereProg, 'uScale');
  const sphereUAspect = gl.getUniformLocation(sphereProg, 'uAspect');
  const sphereURot = gl.getUniformLocation(sphereProg, 'uRot');
  const sphereLU = lightUniforms(gl, sphereProg);

  function makeTex(unit: number, rgba: number[]): WebGLTexture {
    const t = gl.createTexture();
    if (!t) throw new Error('Failed to create texture');
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    return t;
  }
  const normalTex = makeTex(0, [128, 128, 255, 255]);
  const albedoTex = makeTex(1, [204, 204, 204, 255]);
  const aoTex = makeTex(2, [255, 255, 255, 255]);

  let aspect = 1;
  let useAlbedo = false;
  let useAo = false;
  let light: [number, number, number] = [-0.4, 0.4, 0.7];
  let ambient = 0.18;
  let intensity = 1.0;
  let autoRotate = false;
  let shape: PreviewShape = 'sphere';
  let angle = 0;
  let rotMat = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
  let raf = 0;
  let disposed = false;

  function loadImg(url: string): Promise<HTMLImageElement> {
    return new Promise((res, rej) => {
      const im = new window.Image();
      im.onload = () => res(im);
      im.onerror = () => rej(new Error('Failed to load image'));
      im.src = url;
    });
  }
  function upload(tex: WebGLTexture, unit: number, img: HTMLImageElement) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  async function setNormal(url: string) {
    const im = await loadImg(url);
    aspect = im.width / Math.max(1, im.height);
    upload(normalTex, 0, im);
  }
  async function setAlbedo(url: string | null) {
    if (!url) {
      useAlbedo = false;
      return;
    }
    const im = await loadImg(url);
    upload(albedoTex, 1, im);
    useAlbedo = true;
  }
  async function setAo(url: string | null) {
    if (!url) {
      useAo = false;
      return;
    }
    const im = await loadImg(url);
    upload(aoTex, 2, im);
    useAo = true;
  }
  function setLightFromCursor(nx: number, ny: number) {
    light = [nx, ny, 0.7];
  }
  // 列優先 R = Rx(pitch) * Ry(yaw)
  function setRotation(yaw: number, pitch: number) {
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    const cx = Math.cos(pitch);
    const sx = Math.sin(pitch);
    rotMat = new Float32Array([cy, sx * sy, -cx * sy, 0, cx, sx, sy, -sx * cy, cx * cy]);
  }
  function setParams(p: PreviewParams) {
    ambient = p.ambient;
    intensity = p.intensity;
    autoRotate = p.autoRotate;
    shape = p.shape;
  }

  function bindTextures() {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, normalTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, albedoTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, aoTex);
  }

  function currentLight(): [number, number, number] {
    if (autoRotate) {
      angle += 0.02;
      return [Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, 0.7];
    }
    return light;
  }

  function draw() {
    if (disposed) return;
    const w = canvas.width;
    const h = canvas.height;
    const ca = w / Math.max(1, h);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0.08, 0.08, 0.09, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const L = currentLight();
    bindTextures();

    if (shape === 'sphere') {
      gl.enable(gl.DEPTH_TEST);
      gl.useProgram(sphereProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, sphereVbo);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sphereIbo);
      const stride = 44;
      gl.enableVertexAttribArray(sphereAttr.aPos);
      gl.vertexAttribPointer(sphereAttr.aPos, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(sphereAttr.aNormal);
      gl.vertexAttribPointer(sphereAttr.aNormal, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(sphereAttr.aTangent);
      gl.vertexAttribPointer(sphereAttr.aTangent, 3, gl.FLOAT, false, stride, 24);
      gl.enableVertexAttribArray(sphereAttr.aUv);
      gl.vertexAttribPointer(sphereAttr.aUv, 2, gl.FLOAT, false, stride, 36);
      gl.uniform1f(sphereUScale, 0.92);
      gl.uniform1f(sphereUAspect, ca);
      gl.uniformMatrix3fv(sphereURot, false, rotMat);
      gl.uniform3f(sphereLU.uLightDir, L[0], L[1], L[2]);
      gl.uniform1f(sphereLU.uAmbient, ambient);
      gl.uniform1f(sphereLU.uIntensity, intensity);
      gl.uniform1i(sphereLU.uUseAlbedo, useAlbedo ? 1 : 0);
      gl.uniform1i(sphereLU.uUseAo, useAo ? 1 : 0);
      gl.drawElements(gl.TRIANGLES, sphere.idx.length, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(planeProg);
      gl.bindBuffer(gl.ARRAY_BUFFER, planeBuf);
      gl.enableVertexAttribArray(planeAttr.aPos);
      gl.vertexAttribPointer(planeAttr.aPos, 2, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(planeAttr.aUv);
      gl.vertexAttribPointer(planeAttr.aUv, 2, gl.FLOAT, false, 16, 8);
      const a = aspect / ca;
      const sx = a > 1 ? 1 : a;
      const sy = a > 1 ? 1 / a : 1;
      gl.uniform2f(planeUScale, sx, sy);
      gl.uniform3f(planeLU.uLightDir, L[0], L[1], L[2]);
      gl.uniform1f(planeLU.uAmbient, ambient);
      gl.uniform1f(planeLU.uIntensity, intensity);
      gl.uniform1i(planeLU.uUseAlbedo, useAlbedo ? 1 : 0);
      gl.uniform1i(planeLU.uUseAo, useAo ? 1 : 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    raf = requestAnimationFrame(draw);
  }

  function start() {
    if (!raf) raf = requestAnimationFrame(draw);
  }
  function dispose() {
    disposed = true;
    if (raf) cancelAnimationFrame(raf);
    gl.deleteTexture(normalTex);
    gl.deleteTexture(albedoTex);
    gl.deleteTexture(aoTex);
    gl.deleteBuffer(planeBuf);
    gl.deleteBuffer(sphereVbo);
    gl.deleteBuffer(sphereIbo);
    gl.deleteProgram(planeProg);
    gl.deleteProgram(sphereProg);
  }

  return { setNormal, setAlbedo, setAo, setLightFromCursor, setRotation, setParams, start, dispose };
}
