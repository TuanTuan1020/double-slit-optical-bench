/*
 * Double-slit physics engine
 * --------------------------
 * Ideal scalar diffraction in the Fraunhofer (far-field) regime:
 *
 *   E(θ) ∝ sinc(π a sinθ / λ) · cos(π d sinθ / λ)
 *   I(θ) = I₀ · sinc²(π a sinθ / λ) · cos²(π d sinθ / λ)
 *
 * y on the screen is mapped with the exact geometry sinθ = y / √(y² + L²),
 * not the small-angle approximation. The parameter ranges in the UI keep the
 * full-aperture Fresnel number N_F = (d + a)² / (λL) at or below 0.09, so the
 * Fraunhofer far-field formula is justified.
 *
 * White light is an incoherent sum of monochromatic intensities over a
 * 6500 K black-body spectrum, converted through the CIE 1931 2° observer
 * (Wyman–Sloan–Shirley analytic fit) and white-balanced at the centre fringe.
 *
 * Single-photon detections are sampled from the normalized intensity
 * distribution (Born rule). For white light, λ is sampled from the photon-flux
 * marginal ∝ w_photon(λ)·Z(λ), then y | λ from I(y | λ)/Z(λ).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Physics = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const C = 299792458;
  const H = 6.62607015e-34;
  const K_B = 1.380649e-23;
  const HC_OVER_K = (H * C) / K_B; // 1.438776877...e-2 m·K

  const DEFAULTS = Object.freeze({
    lambdaNm: 632.8,
    dMm: 0.12,
    aMm: 0.03,
    LM: 2.0,
    screenWidthMm: 100,
    lightMode: 'mono', // 'mono' | 'white'
    detectionMode: 'continuous' // 'continuous' | 'photon'
  });

  const LIMITS = Object.freeze({
    lambdaNm: [400, 680],
    dMm: [0.04, 0.15],
    aMm: [0.01, 0.05],
    LM: [1.2, 4.0],
    screenWidthMm: [20, 120]
  });

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clamp01 = (v) => clamp(v, 0, 1);

  function finiteOr(value, fallback) {
    if (value == null) return fallback;
    if (typeof value === 'boolean') return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function normalizeParams(input) {
    const p = Object.assign({}, DEFAULTS, input || {});
    const lambdaNm = clamp(finiteOr(p.lambdaNm, DEFAULTS.lambdaNm), LIMITS.lambdaNm[0], LIMITS.lambdaNm[1]);
    const dMm = clamp(finiteOr(p.dMm, DEFAULTS.dMm), LIMITS.dMm[0], LIMITS.dMm[1]);
    const aMax = Math.min(LIMITS.aMm[1], dMm - 0.005);
    const aMm = clamp(finiteOr(p.aMm, DEFAULTS.aMm), LIMITS.aMm[0], Math.max(LIMITS.aMm[0], aMax));
    const LM = clamp(finiteOr(p.LM, DEFAULTS.LM), LIMITS.LM[0], LIMITS.LM[1]);
    const screenWidthMm = clamp(finiteOr(p.screenWidthMm, DEFAULTS.screenWidthMm), LIMITS.screenWidthMm[0], LIMITS.screenWidthMm[1]);
    return {
      lambdaNm,
      dMm,
      aMm,
      LM,
      screenWidthMm,
      lightMode: p.lightMode === 'white' ? 'white' : 'mono',
      detectionMode: p.detectionMode === 'photon' ? 'photon' : 'continuous'
    };
  }

  function toPhysical(p) {
    const n = normalizeParams(p);
    return {
      lambdaM: n.lambdaNm * 1e-9,
      dM: n.dMm * 1e-3,
      aM: n.aMm * 1e-3,
      L: n.LM,
      W: n.screenWidthMm * 1e-3,
      params: n
    };
  }

  function sinc(x) {
    if (Math.abs(x) < 1e-12) return 1;
    return Math.sin(x) / x;
  }

  function sinc2(x) {
    const s = sinc(x);
    return s * s;
  }

  /**
   * Exact screen geometry: sinθ = y / √(y² + L²).
   * Returns everything needed for a readout at one screen position.
   */
  function stateAtY(yM, params, lambdaNm) {
    const ph = toPhysical(params);
    const lambdaM = (lambdaNm == null ? ph.lambdaM : lambdaNm * 1e-9);
    const r = Math.hypot(yM, ph.L);
    const sinTheta = yM / r;
    const theta = Math.atan2(yM, ph.L);
    const beta = (Math.PI * ph.aM * sinTheta) / lambdaM;
    const alpha = (Math.PI * ph.dM * sinTheta) / lambdaM;
    const envelope = sinc2(beta);
    const interference = Math.cos(alpha) * Math.cos(alpha);
    const intensity = envelope * interference;
    const pathDiffM = ph.dM * sinTheta;
    return {
      yM,
      sinTheta,
      theta,
      beta,
      alpha,
      envelope,
      interference,
      intensity,
      pathDiffM,
      pathDiffNm: pathDiffM * 1e9,
      order: pathDiffM / lambdaM,
      lambdaM,
      lambdaNm: lambdaM * 1e9
    };
  }

  function intensityAtY(yM, params) {
    return stateAtY(yM, params).intensity;
  }

  function intensityAtSinTheta(sinTheta, params, lambdaNm) {
    const ph = toPhysical(params);
    const lambdaM = (lambdaNm == null ? ph.lambdaM : lambdaNm * 1e-9);
    const beta = (Math.PI * ph.aM * sinTheta) / lambdaM;
    const alpha = (Math.PI * ph.dM * sinTheta) / lambdaM;
    const envelope = sinc2(beta);
    const interference = Math.cos(alpha) * Math.cos(alpha);
    return { intensity: envelope * interference, envelope, interference, beta, alpha };
  }

  function maxOrderOnScreen(params) {
    const ph = toPhysical(params);
    const half = ph.W / 2;
    const sinThetaMax = half / Math.hypot(half, ph.L);
    return Math.floor((sinThetaMax * ph.dM) / ph.lambdaM + 1e-12);
  }

  function fringeSpacingMm(params) {
    const ph = toPhysical(params);
    return (ph.lambdaM * ph.L) / ph.dM * 1e3;
  }

  function firstOrderYMm(params) {
    const ph = toPhysical(params);
    const s = ph.lambdaM / ph.dM;
    return ph.L * Math.tan(Math.asin(clamp(s, -1, 1))) * 1e3;
  }

  function firstEnvelopeMinYMm(params) {
    const ph = toPhysical(params);
    const s = ph.lambdaM / ph.aM;
    return ph.L * Math.tan(Math.asin(clamp(s, -1, 1))) * 1e3;
  }

  function fresnelNumber(params) {
    const ph = toPhysical(params);
    // The full double-slit aperture spans d + a. Using the full extent is
    // the conservative Fraunhofer criterion.
    const aperture = ph.dM + ph.aM;
    return (aperture * aperture) / (ph.lambdaM * ph.L);
  }

  function isMissingOrderForPhysical(m, ph) {
    // An interference maximum m is exactly missing when it coincides with a
    // single-slit zero: m * a / d must be an integer. The central maximum
    // (m = 0) is never a missing order.
    if (m === 0) return false;
    const n = (m * ph.aM) / ph.dM;
    return Math.abs(n - Math.round(n)) < 1e-9;
  }

  function isMissingOrder(m, params) {
    return isMissingOrderForPhysical(m, toPhysical(params));
  }

  function orderPositionsMm(params) {
    const ph = toPhysical(params);
    const maxM = maxOrderOnScreen(params);
    const out = [];
    for (let m = -maxM; m <= maxM; m++) {
      const s = (m * ph.lambdaM) / ph.dM;
      if (Math.abs(s) >= 1) continue;
      const yMm = ph.L * Math.tan(Math.asin(s)) * 1e3;
      const state = stateAtY(yMm * 1e-3, params);
      out.push({
        m,
        yMm,
        envelope: state.envelope,
        intensity: state.intensity,
        missing: isMissingOrderForPhysical(m, ph)
      });
    }
    return out;
  }

  function missingOrders(params) {
    const ph = toPhysical(params);
    const maxM = maxOrderOnScreen(params);
    const out = [];
    for (let m = 1; m <= maxM; m++) {
      if (!isMissingOrderForPhysical(m, ph)) continue;
      const s = (m * ph.lambdaM) / ph.dM;
      const yMm = ph.L * Math.tan(Math.asin(s)) * 1e3;
      out.push({ m, n: Math.round((m * ph.aM) / ph.dM), yMm });
    }
    return out;
  }

  function visibleOrderCount(params) {
    const orders = orderPositionsMm(params);
    return orders.filter((o) => !o.missing).length;
  }

  function centralEnvelopeOrderCount(params) {
    const ph = toPhysical(params);
    const ratio = ph.dM / ph.aM;
    // Orders strictly inside the central envelope: |m| < d/a.
    return Math.max(0, Math.ceil(ratio - 1e-12) - 1);
  }

  /* ------------------------------------------------------------------ *
   * CIE 1931 2° colour matching functions
   * Wyman, Sloan & Shirley (2013), JCGT 2(2), multi-lobe Gaussian fit.
   * ------------------------------------------------------------------ */
  function piecewiseGaussian(x, mu, s1, s2) {
    const t = (x - mu) / (x < mu ? s1 : s2);
    return Math.exp(-0.5 * t * t);
  }

  function cieXYZ(lambdaNm) {
    const l = lambdaNm;
    const X =
      1.056 * piecewiseGaussian(l, 599.8, 37.9, 31.0) +
      0.362 * piecewiseGaussian(l, 442.0, 16.0, 26.7) -
      0.065 * piecewiseGaussian(l, 501.1, 20.4, 26.2);
    const Y =
      0.821 * piecewiseGaussian(l, 568.8, 46.9, 40.5) +
      0.286 * piecewiseGaussian(l, 530.9, 16.3, 31.1);
    const Z =
      1.217 * piecewiseGaussian(l, 437.0, 11.8, 36.0) +
      0.681 * piecewiseGaussian(l, 459.0, 26.0, 13.8);
    return { X, Y, Z };
  }

  const XYZ_TO_LINEAR_SRGB = [
    [3.2406, -1.5372, -0.4986],
    [-0.9689, 1.8758, 0.0415],
    [0.0557, -0.2040, 1.0570]
  ];

  function xyzToLinearSRGB(X, Y, Z) {
    const m = XYZ_TO_LINEAR_SRGB;
    return [
      m[0][0] * X + m[0][1] * Y + m[0][2] * Z,
      m[1][0] * X + m[1][1] * Y + m[1][2] * Z,
      m[2][0] * X + m[2][1] * Y + m[2][2] * Z
    ];
  }

  function linearToSRGBChannel(c) {
    const v = clamp01(c);
    return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  }

  function linearToSRGB(rgb) {
    return rgb.map(linearToSRGBChannel);
  }

  function spectralLinearRGB(lambdaNm) {
    // The sRGB display gamut cannot represent the extreme red end of the
    // spectrum; clamp the *display colour* to 400-680 nm. The white-light
    // integration still uses the full 380-780 nm spectrum.
    const displayNm = clamp(lambdaNm, 400, 680);
    const c = cieXYZ(displayNm);
    const rgb = xyzToLinearSRGB(c.X, c.Y, c.Z).map((v) => Math.max(0, v));
    const max = Math.max(rgb[0], rgb[1], rgb[2], 1e-12);
    return rgb.map((v) => v / max);
  }

  function spectralSRGB(lambdaNm) {
    return linearToSRGB(spectralLinearRGB(lambdaNm));
  }

  function spectralHex(lambdaNm) {
    const rgb = spectralSRGB(lambdaNm).map((v) => Math.round(clamp01(v) * 255));
    return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function spectralCss(lambdaNm, intensity) {
    const rgb = spectralLinearRGB(lambdaNm).map((v) => v * clamp01(intensity));
    const srgb = linearToSRGB(rgb).map((v) => Math.round(clamp01(v) * 255));
    return `rgb(${srgb[0]}, ${srgb[1]}, ${srgb[2]})`;
  }

  /* ------------------------------------------------------------------ *
   * White light: 6500 K black-body spectrum, incoherent sum.
   * ------------------------------------------------------------------ */
  const WHITE_TEMPERATURE = 6500;
  const SPECTRUM_MIN = 380;
  const SPECTRUM_MAX = 780;
  const SPECTRUM_STEP = 5;

  function planckRelative(lambdaM, T) {
    const x = HC_OVER_K / (lambdaM * T);
    // Drop the constant prefactor; only relative spectral weights matter.
    return 1 / (Math.pow(lambdaM, 5) * Math.expm1(x));
  }

  const WHITE_SAMPLES = (() => {
    const samples = [];
    let total = 0;
    for (let l = SPECTRUM_MIN; l <= SPECTRUM_MAX; l += SPECTRUM_STEP) {
      const w = planckRelative(l * 1e-9, WHITE_TEMPERATURE);
      samples.push({ lambdaNm: l, weight: w, cmf: cieXYZ(l) });
      total += w;
    }
    samples.forEach((s) => (s.weight /= total));
    // Photon flux per unit wavelength is proportional to λ·Bλ. Keep a
    // separate normalized weight for single-photon sampling, so the
    // continuous (photometric) and photon-counting views are both honest.
    let photonTotal = 0;
    samples.forEach((s) => {
      s.photonWeight = s.weight * s.lambdaNm;
      photonTotal += s.photonWeight;
    });
    samples.forEach((s) => (s.photonWeight /= photonTotal));
    return samples;
  })();

  const WHITE_CENTER = (() => {
    let X = 0;
    let Y = 0;
    let Z = 0;
    for (const s of WHITE_SAMPLES) {
      const c = cieXYZ(s.lambdaNm);
      X += s.weight * c.X;
      Y += s.weight * c.Y;
      Z += s.weight * c.Z;
    }
    return { X, Y, Z };
  })();

  const WHITE_CENTER_RGB = xyzToLinearSRGB(WHITE_CENTER.X, WHITE_CENTER.Y, WHITE_CENTER.Z);

  function whiteLightStateAtY(yM, params) {
    const ph = toPhysical(params);
    const r = Math.hypot(yM, ph.L);
    const sinTheta = yM / r;
    let X = 0;
    let Y = 0;
    let Z = 0;
    let detection = 0;
    for (const s of WHITE_SAMPLES) {
      const lambdaM = s.lambdaNm * 1e-9;
      const beta = (Math.PI * ph.aM * sinTheta) / lambdaM;
      const alpha = (Math.PI * ph.dM * sinTheta) / lambdaM;
      const i = sinc2(beta) * Math.cos(alpha) * Math.cos(alpha);
      const c = s.cmf;
      X += s.weight * i * c.X;
      Y += s.weight * i * c.Y;
      Z += s.weight * i * c.Z;
      detection += s.photonWeight * i;
    }
    const Xn = X / WHITE_CENTER.X;
    const Yn = Y / WHITE_CENTER.Y;
    const Zn = Z / WHITE_CENTER.Z;
    const rawRGB = xyzToLinearSRGB(X, Y, Z);
    const balancedRGB = rawRGB.map((v, i) => v / WHITE_CENTER_RGB[i]);
    const rgb = balancedRGB.map(clamp01);
    return {
      yM,
      sinTheta,
      theta: Math.atan2(yM, ph.L),
      luminance: clamp01(Yn),
      detection: clamp01(detection),
      rgbLinear: rgb,
      rgbLinearRaw: balancedRGB,
      rgbSRGB: linearToSRGB(rgb),
      X: Xn,
      Y: Yn,
      Z: Zn
    };
  }

  function whiteLightLuminance(yM, params) {
    return whiteLightStateAtY(yM, params).luminance;
  }

  function whiteLightDetectionAtY(yM, params) {
    return whiteLightStateAtY(yM, params).detection;
  }

  /* ------------------------------------------------------------------ *
   * Photon sampling
   * ------------------------------------------------------------------ */
  const CDF_BINS = 2048;

  function buildCDF(params, lambdaNm) {
    const ph = toPhysical(params);
    const lambdaM = (lambdaNm == null ? ph.lambdaM : lambdaNm * 1e-9);
    const cdf = new Float64Array(CDF_BINS);
    let sum = 0;
    for (let i = 0; i < CDF_BINS; i++) {
      const y = -ph.W / 2 + ((i + 0.5) / CDF_BINS) * ph.W;
      const sinTheta = y / Math.hypot(y, ph.L);
      const beta = (Math.PI * ph.aM * sinTheta) / lambdaM;
      const alpha = (Math.PI * ph.dM * sinTheta) / lambdaM;
      const cosA = Math.cos(alpha);
      sum += sinc2(beta) * cosA * cosA;
      cdf[i] = sum;
    }
    if (sum <= 0) {
      for (let i = 0; i < CDF_BINS; i++) cdf[i] = i + 1;
      return { cdf, total: CDF_BINS, W: ph.W };
    }
    return { cdf, total: sum, W: ph.W };
  }

  function sampleFromCDF(c, u) {
    const target = u * c.total;
    let lo = 0;
    let hi = c.cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c.cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return -c.W / 2 + ((lo + 0.5) / c.cdf.length) * c.W;
  }

  function createPhotonSampler(params, lightMode) {
    const n = normalizeParams(params);
    const mode = lightMode || n.lightMode;
    if (mode !== 'white') {
      const c = buildCDF(n, n.lambdaNm);
      return {
        mode: 'mono',
        sample() {
          return {
            yM: sampleFromCDF(c, Math.random()),
            lambdaNm: n.lambdaNm,
            rgbLinear: spectralLinearRGB(n.lambdaNm)
          };
        }
      };
    }

    // For a joint density p(λ, y) ∝ w(λ) I(y | λ), sampling λ ∝ w(λ)Z(λ)
    // and then y ∝ I(y | λ) is unbiased. Z(λ) is the screen integral, which
    // is proportional to each CDF's total.
    const cdfCache = new Map();
    const lambdaCDF = [];
    let total = 0;
    for (const s of WHITE_SAMPLES) {
      const c = buildCDF(n, s.lambdaNm);
      cdfCache.set(s.lambdaNm, c);
      total += s.photonWeight * c.total;
    }
    let acc = 0;
    for (const s of WHITE_SAMPLES) {
      const c = cdfCache.get(s.lambdaNm);
      acc += (s.photonWeight * c.total) / total;
      lambdaCDF.push(acc);
    }
    return {
      mode: 'white',
      sample() {
        const u = Math.random();
        let lo = 0;
        let hi = lambdaCDF.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (lambdaCDF[mid] < u) lo = mid + 1;
          else hi = mid;
        }
        const lambdaNm = WHITE_SAMPLES[lo].lambdaNm;
        return {
          yM: sampleFromCDF(cdfCache.get(lambdaNm), Math.random()),
          lambdaNm,
          rgbLinear: spectralLinearRGB(lambdaNm)
        };
      }
    };
  }

  /* ------------------------------------------------------------------ *
   * Curves and data export helpers
   * ------------------------------------------------------------------ */
  function curve(params, n) {
    const p = normalizeParams(params);
    const ph = toPhysical(p);
    const count = Math.max(2, Math.floor(n || 1200));
    const out = [];
    for (let i = 0; i < count; i++) {
      const yM = -ph.W / 2 + (i / (count - 1)) * ph.W;
      if (p.lightMode === 'white') {
        const w = whiteLightStateAtY(yM, p);
        out.push({
          yMm: yM * 1e3,
          sinTheta: w.sinTheta,
          intensity: p.detectionMode === 'photon' ? w.detection : w.luminance,
          detection: w.detection,
          luminance: w.luminance,
          envelope: null,
          interference: null,
          pathDiffNm: ph.dM * w.sinTheta * 1e9,
          rgbLinear: w.rgbLinear
        });
      } else {
        const s = stateAtY(yM, p);
        out.push({
          yMm: yM * 1e3,
          sinTheta: s.sinTheta,
          intensity: s.intensity,
          envelope: s.envelope,
          interference: s.interference,
          pathDiffNm: s.pathDiffNm,
          rgbLinear: null
        });
      }
    }
    return out;
  }

  function summary(params) {
    const p = normalizeParams(params);
    const maxM = maxOrderOnScreen(p);
    const missing = missingOrders(p);
    const ph = toPhysical(p);
    const half = ph.W / 2;
    const edgeAngle = Math.atan2(half, ph.L);
    return {
      params: p,
      fringeSpacingMm: fringeSpacingMm(p),
      firstOrderYMm: firstOrderYMm(p),
      firstEnvelopeMinYMm: firstEnvelopeMinYMm(p),
      maxOrder: maxM,
      visibleOrderCount: visibleOrderCount(p),
      missingOrders: missing,
      missingText: missing.length ? missing.map((o) => `±${o.m}`).join('、') : '无',
      centralEnvelopeOrders: centralEnvelopeOrderCount(p),
      edgeAngleDeg: (edgeAngle * 180) / Math.PI,
      slitRatio: ph.dM / ph.aM,
      // White light has no single λ. Use the shortest wavelength in the
      // continuous spectrum for a conservative far-field display.
      fresnelNumber: fresnelNumber(
        p.lightMode === 'white' ? Object.assign({}, p, { lambdaNm: LIMITS.lambdaNm[0] }) : p
      )
    };
  }

  return {
    DEFAULTS,
    LIMITS,
    clamp,
    normalizeParams,
    toPhysical,
    sinc,
    sinc2,
    stateAtY,
    intensityAtY,
    intensityAtSinTheta,
    maxOrderOnScreen,
    fringeSpacingMm,
    firstOrderYMm,
    firstEnvelopeMinYMm,
    fresnelNumber,
    orderPositionsMm,
    missingOrders,
    visibleOrderCount,
    centralEnvelopeOrderCount,
    cieXYZ,
    xyzToLinearSRGB,
    linearToSRGB,
    linearToSRGBChannel,
    spectralLinearRGB,
    spectralSRGB,
    spectralHex,
    spectralCss,
    whiteLightStateAtY,
    whiteLightLuminance,
    whiteLightDetectionAtY,
    WHITE_SAMPLES,
    WHITE_CENTER,
    WHITE_TEMPERATURE,
    buildCDF,
    sampleFromCDF,
    createPhotonSampler,
    curve,
    summary
  };
});
