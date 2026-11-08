'use strict';

const assert = require('assert');
const P = require('../js/physics.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok  ' + name);
  } catch (err) {
    console.error('FAIL  ' + name);
    throw err;
  }
}
function close(a, b, eps, msg) {
  assert.ok(Math.abs(a - b) <= eps, `${msg || ''} expected ${b}, got ${a}`);
}

const base = {
  lambdaNm: 632.8,
  dMm: 0.12,
  aMm: 0.03,
  LM: 2.0,
  screenWidthMm: 100,
  lightMode: 'mono'
};

console.log('Double-slit physics');

test('central point is the normalized maximum', () => {
  const s = P.stateAtY(0, base);
  close(s.intensity, 1, 1e-12, 'I(0)');
  close(s.envelope, 1, 1e-12, 'envelope(0)');
  close(s.interference, 1, 1e-12, 'interference(0)');
  close(s.sinTheta, 0, 1e-15, 'sinθ(0)');
});

test('pattern is symmetric about the optical axis', () => {
  for (const y of [0.003, 0.0105, 0.021, 0.042]) {
    close(P.intensityAtY(y, base), P.intensityAtY(-y, base), 1e-14, `I(${y})`);
  }
});

test('interference minima fall at d sinθ = (m + 1/2)λ', () => {
  const sinTheta = base.lambdaNm * 1e-9 / (2 * base.dMm * 1e-3);
  const y = base.LM * Math.tan(Math.asin(sinTheta));
  const s = P.stateAtY(y, base);
  close(s.interference, 0, 1e-24, 'cos²(α)');
  assert.ok(s.intensity < 1e-20, 'intensity at interference minimum');
});

test('interference maxima fall at d sinθ = mλ', () => {
  for (let m = 1; m <= 3; m++) {
    const sinTheta = (m * base.lambdaNm * 1e-9) / (base.dMm * 1e-3);
    const y = base.LM * Math.tan(Math.asin(sinTheta));
    const s = P.stateAtY(y, base);
    close(s.interference, 1, 1e-24, `cos² at m=${m}`);
    close(s.intensity, s.envelope, 1e-24, `I at m=${m}`);
  }
});

test('single-slit envelope vanishes at a sinθ = nλ', () => {
  const sinTheta = base.lambdaNm * 1e-9 / (base.aMm * 1e-3);
  const y = base.LM * Math.tan(Math.asin(sinTheta));
  const s = P.stateAtY(y, base);
  assert.ok(s.envelope < 1e-30, `envelope=${s.envelope}`);
  assert.ok(s.intensity < 1e-30, `intensity=${s.intensity}`);
});

test('integer d/a produces missing orders at m = n d/a', () => {
  const sum = P.summary(base);
  assert.strictEqual(sum.slitRatio, 4);
  assert.strictEqual(sum.missingText, '±4');
  const missing = P.orderPositionsMm(base).filter((o) => o.missing);
  assert.deepStrictEqual(missing.map((o) => o.m).sort((a, b) => a - b), [-4, 4]);
  for (const o of missing) {
    assert.ok(Math.abs(Math.abs(o.yMm) - 42.19605482919317) < 1e-9, 'missing order position');
  }
  assert.deepStrictEqual(P.missingOrders(base).map((o) => o.m), [4]);
});

test('non-integer d/a has no exact missing orders', () => {
  const p = Object.assign({}, base, { aMm: 0.025 });
  assert.deepStrictEqual(P.missingOrders(p), []);
});

test('fringe spacing matches the small-angle limit', () => {
  const spacing = P.fringeSpacingMm(base);
  close(spacing, 10.546666666666667, 1e-12, 'λL/d');
  close(P.firstOrderYMm(base), 10.546813310812793, 1e-12, 'exact y₁');
  assert.ok(Math.abs(P.firstOrderYMm(base) - spacing) / spacing < 1e-4);
});

test('central envelope half-width is exact', () => {
  close(P.firstEnvelopeMinYMm(base), 42.19605482919317, 1e-12);
});

test('far-field criterion is satisfied across the full UI range', () => {
  const combos = [
    { lambdaNm: 400, dMm: 0.15, aMm: 0.05, LM: 1.2 },
    { lambdaNm: 680, dMm: 0.15, aMm: 0.05, LM: 1.2 },
    { lambdaNm: 400, dMm: 0.04, aMm: 0.035, LM: 4.0 },
    { lambdaNm: 680, dMm: 0.04, aMm: 0.035, LM: 4.0 }
  ];
  for (const c of combos) {
    const nf = P.fresnelNumber(c);
    assert.ok(nf <= 0.09 + 1e-12, `N_F=${nf} for ${JSON.stringify(c)}`);
  }
});

test('parameter normalization keeps a < d and inside limits', () => {
  const p = P.normalizeParams({ dMm: 0.04, aMm: 0.05, lambdaNm: 999, LM: 0.1, screenWidthMm: 999 });
  assert.ok(p.aMm < p.dMm, 'a < d');
  assert.strictEqual(p.lambdaNm, 680);
  assert.strictEqual(p.LM, 1.2);
  assert.strictEqual(p.screenWidthMm, 120);
});

test('CIE analytic fit gives the equal-energy white point', () => {
  let X = 0;
  let Y = 0;
  let Z = 0;
  for (let l = 380; l <= 780; l++) {
    const c = P.cieXYZ(l);
    X += c.X;
    Y += c.Y;
    Z += c.Z;
  }
  close(X / (X + Y + Z), 1 / 3, 0.002, 'x');
  close(Y / (X + Y + Z), 1 / 3, 0.002, 'y');
});

test('spectral colours map to the expected sRGB primary', () => {
  const argmax = (rgb) => rgb.indexOf(Math.max(...rgb));
  assert.strictEqual(argmax(P.spectralLinearRGB(632.8)), 0, '632.8 nm red');
  assert.strictEqual(argmax(P.spectralLinearRGB(532)), 1, '532 nm green');
  assert.strictEqual(argmax(P.spectralLinearRGB(450)), 2, '450 nm blue');
  const deepRed = P.spectralLinearRGB(750);
  assert.ok(deepRed[0] > deepRed[1] && deepRed[0] > deepRed[2], '750 nm display colour is red');
});

test('white-mode summary uses the shortest wavelength for a conservative N_F', () => {
  const white = Object.assign({}, base, { lightMode: 'white' });
  close(
    P.summary(white).fresnelNumber,
    P.fresnelNumber(Object.assign({}, base, { lambdaNm: 400 })),
    1e-15
  );
});

test('white light is white-balanced at the centre without clipping', () => {
  const w = P.whiteLightStateAtY(0, Object.assign({}, base, { lightMode: 'white' }));
  close(w.luminance, 1, 1e-12);
  close(w.detection, 1, 1e-12);
  for (const c of w.rgbLinearRaw) close(c, 1, 1e-12, 'unclamped white balance');
  for (const c of w.rgbLinear) close(c, 1, 1e-12, 'white balance');
  const side = P.whiteLightStateAtY(0.0105, Object.assign({}, base, { lightMode: 'white' }));
  for (const c of side.rgbLinear) assert.ok(c >= 0 && c <= 1 + 1e-12, 'display RGB in range');
});

test('white-light pattern is symmetric and bounded', () => {
  const p = Object.assign({}, base, { lightMode: 'white' });
  for (const y of [0.003, 0.0105, 0.021, 0.042]) {
    const a = P.whiteLightStateAtY(y, p);
    const b = P.whiteLightStateAtY(-y, p);
    close(a.luminance, b.luminance, 1e-14, `luminance(${y})`);
    for (let i = 0; i < 3; i++) close(a.rgbLinear[i], b.rgbLinear[i], 1e-14, `rgb(${y})`);
    assert.ok(a.luminance >= 0 && a.luminance <= 1 + 1e-12);
  }
});

test('single-slit CDF depends on wavelength', () => {
  const a = P.buildCDF(base, 450);
  const b = P.buildCDF(base, 650);
  assert.ok(Math.abs(a.total - b.total) > 1, 'CDF totals should differ with λ');
});

test('photon sampler follows the intensity distribution', () => {
  const sampler = P.createPhotonSampler(base, 'mono');
  const bins = new Array(20).fill(0);
  const N = 40000;
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const s = sampler.sample();
    assert.ok(s.yM >= -0.05 && s.yM <= 0.05, 'sample inside screen');
    sum += s.yM;
    const idx = Math.min(19, Math.max(0, Math.floor(((s.yM + 0.05) / 0.1) * 20)));
    bins[idx]++;
  }
  assert.ok(Math.abs(sum / N) < 0.0005, 'mean near zero');
  const central = bins[9] + bins[10];
  const edge = bins[0] + bins[1] + bins[18] + bins[19];
  assert.ok(central > edge * 4, `central=${central}, edge=${edge}`);
  // The two first-order maxima near ±10.5 mm should be populated.
  assert.ok(bins[11] > 0 && bins[8] > 0);
});

test('white-light photon sampler returns spectrum and position', () => {
  const sampler = P.createPhotonSampler(Object.assign({}, base, { lightMode: 'white' }), 'white');
  for (let i = 0; i < 3000; i++) {
    const s = sampler.sample();
    assert.ok(s.lambdaNm >= 380 && s.lambdaNm <= 780);
    assert.ok(s.yM >= -0.05 && s.yM <= 0.05);
    assert.strictEqual(s.rgbLinear.length, 3);
  }
});

test('white-light photon wavelength marginal follows photon-flux weights', () => {
  const p = Object.assign({}, base, { lightMode: 'white' });
  const sampler = P.createPhotonSampler(p, 'white');
  const N = 20000;
  const counts = new Map();
  for (let i = 0; i < N; i++) {
    const s = sampler.sample();
    counts.set(s.lambdaNm, (counts.get(s.lambdaNm) || 0) + 1);
  }
  let total = 0;
  const expected = [];
  for (const s of P.WHITE_SAMPLES) {
    const w = s.photonWeight * P.buildCDF(p, s.lambdaNm).total;
    expected.push({ lambdaNm: s.lambdaNm, w });
    total += w;
  }
  let maxDiff = 0;
  for (const e of expected) {
    const observed = (counts.get(e.lambdaNm) || 0) / N;
    maxDiff = Math.max(maxDiff, Math.abs(observed - e.w / total));
  }
  assert.ok(maxDiff < 0.01, `white photon λ marginal max error ${maxDiff}`);
});

test('white-light photon marginal matches photon-flux detection probability', () => {
  const p = Object.assign({}, base, { lightMode: 'white' });
  const sampler = P.createPhotonSampler(p, 'white');
  const bins = 24;
  const counts = new Array(bins).fill(0);
  const N = 30000;
  for (let i = 0; i < N; i++) {
    const s = sampler.sample();
    const idx = Math.min(bins - 1, Math.max(0, Math.floor(((s.yM + 0.05) / 0.1) * bins)));
    counts[idx]++;
  }
  const expected = new Array(bins).fill(0);
  let expectedTotal = 0;
  for (let i = 0; i < bins; i++) {
    const y0 = -0.05 + (i / bins) * 0.1;
    const y1 = -0.05 + ((i + 1) / bins) * 0.1;
    let sum = 0;
    for (let k = 0; k < 16; k++) {
      const y = y0 + ((k + 0.5) / 16) * (y1 - y0);
      sum += P.whiteLightDetectionAtY(y, p);
    }
    expected[i] = sum / 16;
    expectedTotal += expected[i];
  }
  for (let i = 0; i < bins; i++) expected[i] /= expectedTotal;
  let maxDiff = 0;
  for (let i = 0; i < bins; i++) {
    maxDiff = Math.max(maxDiff, Math.abs(counts[i] / N - expected[i]));
  }
  assert.ok(maxDiff < 0.02, `white photon marginal max bin error ${maxDiff}`);
});

test('curve export has the requested length and normalized centre', () => {
  const c = P.curve(base, 1001);
  assert.strictEqual(c.length, 1001);
  const centre = c[500];
  close(centre.yMm, 0, 1e-9);
  close(centre.intensity, 1, 1e-12);
  assert.strictEqual(c[0].envelope !== null, true);
});

test('summary reports the expected visible-order count', () => {
  const sum = P.summary(base);
  assert.strictEqual(sum.maxOrder, 4);
  assert.strictEqual(sum.visibleOrderCount, 7);
  assert.strictEqual(sum.centralEnvelopeOrders, 3);
});

test('rational d/a produces missing orders at integer m = n d/a', () => {
  const p15 = { lambdaNm: 400, dMm: 0.075, aMm: 0.05, LM: 2, screenWidthMm: 100 };
  assert.deepStrictEqual(P.missingOrders(p15).map((o) => o.m), [3]);
  assert.ok(P.orderPositionsMm(p15).find((o) => o.m === 3).missing);

  const p25 = { lambdaNm: 400, dMm: 0.125, aMm: 0.05, LM: 2, screenWidthMm: 120 };
  assert.deepStrictEqual(P.missingOrders(p25).map((o) => o.m), [5]);
  assert.ok(P.orderPositionsMm(p25).find((o) => o.m === 5).missing);
});

test('near-integer d/a is low-intensity but not labelled an exact missing order', () => {
  const p = { lambdaNm: 632.8, dMm: 0.051, aMm: 0.025, LM: 2, screenWidthMm: 100 };
  assert.deepStrictEqual(P.missingOrders(p), []);
  const o = P.orderPositionsMm(p).find((x) => x.m === 2);
  assert.ok(o, 'm=2 should be in the screen');
  assert.strictEqual(o.missing, false);
  assert.ok(o.envelope < 1e-3, 'but its envelope is nearly zero');
});

test('full-aperture Fresnel number uses d + a', () => {
  const p = { lambdaNm: 400, dMm: 0.15, aMm: 0.05, LM: 1.2 };
  close(P.fresnelNumber(p), (0.0002 * 0.0002) / (400e-9 * 1.2), 1e-12);
});

test('non-finite and null parameters fall back to defaults', () => {
  const p = P.normalizeParams({ lambdaNm: NaN, dMm: undefined, aMm: Infinity, LM: null, screenWidthMm: 'x' });
  for (const key of ['lambdaNm', 'dMm', 'aMm', 'LM', 'screenWidthMm']) {
    assert.ok(Number.isFinite(p[key]), `${key} should be finite`);
  }
  const q = P.normalizeParams({ lambdaNm: '', dMm: null, aMm: '', LM: null, screenWidthMm: undefined });
  assert.strictEqual(q.lambdaNm, 632.8);
  assert.strictEqual(q.dMm, 0.12);
  assert.strictEqual(q.aMm, 0.03);
  assert.strictEqual(q.LM, 2.0);
  assert.strictEqual(q.screenWidthMm, 100);
});

test('spectral display colours clamp exactly at 400 and 680 nm', () => {
  assert.deepStrictEqual(P.spectralLinearRGB(380), P.spectralLinearRGB(400));
  assert.deepStrictEqual(P.spectralLinearRGB(780), P.spectralLinearRGB(680));
});

test('full parameter grid keeps N_F at or below 0.09', () => {
  let maxNF = 0;
  let worst = null;
  for (let lambda = 400; lambda <= 680; lambda += 20) {
    for (let di = 4; di <= 15; di++) {
      const dMm = di / 100;
      const aMax = Math.min(50, di * 10 - 5);
      for (let ai = 10; ai <= aMax; ai += 5) {
        const aMm = ai / 1000;
        for (let li = 12; li <= 40; li += 2) {
          const LM = li / 10;
          const nf = P.fresnelNumber({ lambdaNm: lambda, dMm, aMm, LM });
          if (nf > maxNF) {
            maxNF = nf;
            worst = { lambda, dMm, aMm, LM };
          }
        }
      }
    }
  }
  assert.ok(maxNF <= 0.09 + 1e-12, `max N_F=${maxNF}`);
  close(maxNF, 0.08333333333333333, 1e-12, 'worst-case N_F');
  assert.deepStrictEqual(worst, { lambda: 400, dMm: 0.15, aMm: 0.05, LM: 1.2 });
});

console.log(`\n${passed} tests passed`);
