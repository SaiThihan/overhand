/**
 * The thin GPU layer under the attention map: one full-frame fragment shader per atmosphere (Observatory's night sky,
 * Koi Pond's water), on a WebGL2 canvas behind the SVG. It draws at half resolution and at most 8 frames a second while
 * moving, one frame when still, nothing in a hidden tab. Without WebGL2 (or on a lost context) it reports false and the
 * world's 2D ground shows instead.
 */

const VERT = `#version 300 es
out vec2 uv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  uv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const COMMON = `#version 300 es
precision mediump float;
uniform float t;
uniform vec2 res;
in vec2 uv;
out vec4 o;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * n(p); p *= 2.03; a *= 0.5; } return s; }
`;

/** Night sky: deep navy, a drifting milky way band, stars that twinkle slowly. */
const SKY = `${COMMON}
void main() {
  vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
  float r = length(p - vec2(0.0, -0.05));
  vec3 c = mix(vec3(0.043, 0.094, 0.188), vec3(0.016, 0.027, 0.051), smoothstep(0.0, 0.75, r));
  vec2 q = mat2(0.85, -0.53, 0.53, 0.85) * p;
  float band = exp(-q.y * q.y * 30.0) * fbm(q * 4.0 + vec2(t * 0.004, 0.0));
  c += vec3(0.62, 0.72, 0.85) * band * 0.16;
  vec2 cell = uv * res / 4.0;
  float s = h(floor(cell));
  float tw = 0.6 + 0.4 * sin(t * 0.6 + s * 40.0);
  float dot = smoothstep(0.45, 0.0, length(fract(cell) - 0.5));
  c += vec3(0.9, 0.93, 0.97) * step(0.993, s) * dot * tw * 0.7;
  o = vec4(c, 1.0);
}`;

/** Water at dusk: deep teal, soft caustic light moving slowly across it. */
const WATER = `${COMMON}
void main() {
  vec2 p = (uv - 0.5) * vec2(res.x / res.y, 1.0);
  float r = length(p - vec2(0.0, -0.05));
  vec3 c = mix(vec3(0.086, 0.267, 0.282), vec3(0.027, 0.102, 0.110), smoothstep(0.0, 0.8, r));
  vec2 q = p * 6.0;
  float w = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    q += vec2(sin(q.y * 1.3 + t * 0.07 + fi), cos(q.x * 1.1 - t * 0.06 + fi)) * 0.45;
    w += abs(sin(q.x + q.y));
  }
  float caustic = pow(1.0 - clamp(w / 3.0, 0.0, 1.0), 6.0);
  c += vec3(0.55, 0.75, 0.72) * caustic * 0.22 * (1.0 - smoothstep(0.2, 0.75, r));
  o = vec4(c, 1.0);
}`;

export type Atmosphere = "sky" | "water";

/** A running atmosphere: `still` holds it on one frame; `destroy` frees the GPU. */
export interface AtmosphereHandle {
  setStill: (still: boolean) => void;
  destroy: () => void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (!s) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
}

/** Starts `kind` on `canvas`, or returns null when there's no WebGL2 (the 2D ground is the fallback). */
export function startAtmosphere(canvas: HTMLCanvasElement, kind: Atmosphere, still: boolean): AtmosphereHandle | null {
  const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, powerPreference: "low-power" });
  if (!gl) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, kind === "sky" ? SKY : WATER);
  const prog = gl.createProgram();
  if (!vs || !fs || !prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  // biome-ignore lint/correctness/useHookAtTopLevel: WebGL's useProgram, not a React hook
  gl.useProgram(prog);
  const uT = gl.getUniformLocation(prog, "t");
  const uRes = gl.getUniformLocation(prog, "res");
  const t0 = performance.now();
  let moving = !still;
  let raf = 0;
  let wait: ReturnType<typeof setTimeout> | undefined;
  // a handle used after destroy (an effect's setStill in the commit that dropped it) must not restart the loop on a
  // lost context (release/soak.ts)
  let gone = false;

  const draw = () => {
    // half resolution: the atmosphere is soft, and a quarter of the pixels is a quarter of the cost
    const w = Math.max(1, Math.round(canvas.clientWidth / 2));
    const hgt = Math.max(1, Math.round(canvas.clientHeight / 2));
    if (canvas.width !== w || canvas.height !== hgt) {
      canvas.width = w;
      canvas.height = hgt;
    }
    gl.viewport(0, 0, w, hgt);
    gl.uniform1f(uT, (performance.now() - t0) / 1000);
    gl.uniform2f(uRes, w, hgt);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // 8 frames a second: sleep 125 ms between frames instead of waking the page on every display frame
  const loop = () => {
    raf = 0;
    if (gone || !moving || document.hidden) return;
    draw();
    wait = setTimeout(() => {
      wait = undefined;
      raf = requestAnimationFrame(loop);
    }, 125);
  };
  const resume = () => {
    if (gone || document.hidden) return;
    draw();
    if (moving && !raf && !wait) raf = requestAnimationFrame(loop);
  };
  const ro = new ResizeObserver(() => draw());
  ro.observe(canvas);
  document.addEventListener("visibilitychange", resume);
  resume();
  return {
    setStill(s) {
      moving = !s;
      resume();
    },
    destroy() {
      gone = true;
      cancelAnimationFrame(raf);
      clearTimeout(wait);
      ro.disconnect();
      document.removeEventListener("visibilitychange", resume);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
