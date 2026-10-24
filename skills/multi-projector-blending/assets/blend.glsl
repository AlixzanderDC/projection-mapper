// Multi-projector blending helpers — GLSL ES 3.00 (WebGL2). Drop into a composite/output pass.
// Lineage: Paul Bourke "Edge blending using commodity projectors" (2004) → ofxProjectorBlend → TouchDesigner projectorBlend.
// All functions return factors to MULTIPLY the gamma-encoded colour by, unless noted.

// --- Bourke soft-edge ramp. x in [0,1] across the overlap (0 = this projector's edge, 1 = fully inside).
// p: curve power (1 = linear, 2 = usual). a: luminance/mid-point (0.5 = symmetric).
float blendRamp(float x, float p, float a) {
  x = clamp(x, 0.0, 1.0);
  return x <= 0.5 ? a * pow(2.0 * x, p)
                  : 1.0 - (1.0 - a) * pow(2.0 * (1.0 - x), p);
}

// --- Four-edge blend for one output. px = pixel position (origin bottom-left), res = output size,
// w = blend widths in pixels (left, right, top, bottom), 0 = no blend on that edge.
// Returns the linear-light weight for this projector at this pixel (0..1).
float edgeWeight(vec2 px, vec2 res, vec4 w, float p, float a) {
  float f = 1.0;
  if (w.x > 0.0) f *= blendRamp(px.x / w.x, p, a);                 // left
  if (w.y > 0.0) f *= blendRamp((res.x - px.x) / w.y, p, a);       // right
  if (w.z > 0.0) f *= blendRamp((res.y - px.y) / w.z, p, a);       // top
  if (w.w > 0.0) f *= blendRamp(px.y / w.w, p, a);                 // bottom
  return f;
}

// --- Convert a linear-light weight to a per-channel factor for gamma-encoded colour.
// gamma = measured projector gamma per channel (e.g. vec3(2.2)). Multiplying the encoded colour by
// pow(w, 1/gamma) makes the emitted LIGHT scale by w, so two projectors' light sums to 1 in the overlap.
vec3 encodedFactor(float w, vec3 gamma) {
  return pow(vec3(w), 1.0 / gamma);
}

// --- Black-level lift. Adds light in areas covered by fewer projectors so black matches the overlap.
// color: encoded colour after blending. lift: how much extra black (as an encoded value, e.g. 0.02) this
// pixel needs; pass (1 - coverageFraction) * maxLift, or sample a beta map (MPCDI). Applied in linear light.
vec3 blackLevelLift(vec3 color, float lift, vec3 gamma) {
  vec3 lin = pow(max(color, 0.0), gamma);
  lin = max(lin, vec3(pow(lift, gamma.x)));   // never darker than the lifted floor
  return pow(lin, 1.0 / gamma);
}

// --- Incidence-angle weight for 3-D surfaces (spheres, domes, objects). n = unit surface normal at the
// lit point (world), p = the point, projPos[] = projector positions (world), self = this projector's index.
// Each projector computes the SAME denominator, so weights sum to 1 across projectors by construction.
// k = sharpness (1..4). Returns the linear-light weight; feed it to encodedFactor().
const int MAX_PROJ = 8;
float incidenceWeight(vec3 n, vec3 p, vec3 projPos[MAX_PROJ], int count, int self, float k) {
  float sum = 0.0, mine = 0.0;
  for (int i = 0; i < MAX_PROJ; i++) {
    if (i >= count) break;
    float c = max(0.0, dot(n, normalize(projPos[i] - p)));   // cos(incidence); <0 = facing away
    float w = pow(c, k);
    sum += w;
    if (i == self) mine = w;
  }
  return sum > 0.0 ? mine / sum : 0.0;
}

// --- Example composite:
// vec3 c = texture(uScene, vUV).rgb;                      // warped content for this output
// float w = edgeWeight(gl_FragCoord.xy, uRes, uBlendW, 2.0, 0.5);
// c *= encodedFactor(w, uGamma);
// c = blackLevelLift(c, uBlackLift * (1.0 - w), uGamma);  // optional
// outColor = vec4(c, 1.0);
