/* global Physics */
(function () {
  'use strict';

  const P = window.Physics;
  if (!P) {
    throw new Error('Physics engine failed to load.');
  }

  const $ = (selector, root) => (root || document).querySelector(selector);
  const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const clamp01 = (v) => clamp(v, 0, 1);
  const STORAGE_KEY = 'double-slit-lab.records.v1';

  const el = {
    canvas: $('#screenCanvas'),
    headerStatus: $('#headerStatus'),
    farfieldBadge: $('#farfieldBadge'),
    resetBtn: $('#resetBtn'),
    resetBtn2: $('#resetBtn2'),

    lambda: $('#lambda'),
    slitDistance: $('#slitDistance'),
    slitWidth: $('#slitWidth'),
    screenDistance: $('#screenDistance'),
    screenWidth: $('#screenWidth'),
    outLambda: $('#outLambda'),
    outD: $('#outD'),
    outA: $('#outA'),
    outL: $('#outL'),
    outWidth: $('#outWidth'),
    lambdaSwatch: $('#lambdaSwatch'),
    lambdaControl: $('#lambdaControl'),
    aTicks: $('#aTicks'),

    lightButtons: $$('[data-light]'),
    detectionButtons: $$('[data-detection]'),
    envelopeToggle: $('#envelopeToggle'),
    showEnvelope: $('#showEnvelope'),

    presetSelect: $('#presetSelect'),
    photonBar: $('#photonBar'),
    photonCount: $('#photonCount'),
    emitOne: $('#emitOne'),
    autoEmit: $('#autoEmit'),
    emitMany: $('#emitMany'),
    clearPhotons: $('#clearPhotons'),

    probeY: $('#probeY'),
    probeSin: $('#probeSin'),
    probeDelta: $('#probeDelta'),
    probeOrder: $('#probeOrder'),
    probeEnv: $('#probeEnv'),
    probeIntensity: $('#probeIntensity'),

    metricValue: $('#metricValue'),
    metricSpacing: $('#metricSpacing'),
    metricNote: $('#metricNote'),
    metricFirst: $('#metricFirst'),
    metricEnvelope: $('#metricEnvelope'),
    metricOrders: $('#metricOrders'),
    metricRatio: $('#metricRatio'),
    metricNF: $('#metricNF'),
    firstUnit: $('#firstUnit'),
    envelopeUnit: $('#envelopeUnit'),

    readoutMode: $('#readoutMode'),
    monoFormula: $('#monoFormula'),
    whiteFormula: $('#whiteFormula'),
    probeOrderBadge: $('#probeOrderBadge'),
    betaValue: $('#betaValue'),
    alphaValue: $('#alphaValue'),
    deltaValue: $('#deltaValue'),
    factorEnv: $('#factorEnv'),
    factorEnvBar: $('#barEnv'),
    factorInt: $('#factorInt'),
    factorIntBar: $('#barInt'),
    conclusion: $('#conclusion'),
    screenDescription: $('#screenDescription'),
    statusLine: $('#statusLine'),

    recordBtn: $('#recordBtn'),
    exportRecords: $('#exportRecords'),
    exportCurve: $('#exportCurve'),
    clearRecords: $('#clearRecords'),
    recordsBody: $('#recordsBody'),
    recordsTable: $('#recordsTable'),
    recordsEmpty: $('#recordsEmpty'),

    bench: $('#benchSvg'),
    beamPath: $('#beamPath'),
    slitTop: $('#slitTop'),
    slitBottom: $('#slitBottom'),
    labelD: $('#labelD'),
    labelA: $('#labelA'),
    dimD: $('#dimD'),
    rayTop: $('#rayTop'),
    rayBottom: $('#rayBottom'),
    rayTop2: $('#rayTop2'),
    rayBottom2: $('#rayBottom2'),
    rayGroup: $('#rayGroup'),
    waveGroup: $('#waveGroup')
  };

  const ctx = el.canvas.getContext('2d');
  const buffer = document.createElement('canvas');
  buffer.width = 1600;
  buffer.height = 520;

  const state = {
    params: P.normalizeParams(P.DEFAULTS),
    probeYM: 0,
    showEnvelope: true,
    records: [],
    view: null,
    layout: null,
    stripBuffer: null,
    stripBufferCtx: null,
    stripCacheKey: '',
    chartCache: null,
    needsDraw: true,
    needsResize: true,
    statusTimer: 0,
    dragging: false,
    photon: {
      sampler: null,
      samplerKey: '',
      count: 0,
      auto: false,
      rate: 1400,
      accumulator: 0,
      lastTs: 0,
      lastUi: 0,
      histBins: 240,
      hist: new Uint32Array(240),
      buffer,
      bctx: buffer.getContext('2d')
    }
  };

  state.photon.bctx.globalCompositeOperation = 'lighter';

  const PRESETS = {
    hene: { lambdaNm: 632.8, dMm: 0.12, aMm: 0.03, LM: 2.0, screenWidthMm: 100, lightMode: 'mono' },
    green: { lambdaNm: 532.0, dMm: 0.10, aMm: 0.025, LM: 2.0, screenWidthMm: 100, lightMode: 'mono' },
    missing: { lambdaNm: 632.8, dMm: 0.12, aMm: 0.03, LM: 2.0, screenWidthMm: 120, lightMode: 'mono' },
    dense: { lambdaNm: 632.8, dMm: 0.15, aMm: 0.03, LM: 2.0, screenWidthMm: 60, lightMode: 'mono' }
  };

  function fmt(value, digits) {
    return Number(value).toFixed(digits == null ? 2 : digits);
  }

  function signed(value, digits) {
    const d = digits == null ? 2 : digits;
    const threshold = 0.5 * Math.pow(10, -d);
    if (Math.abs(value) < threshold) return (0).toFixed(d);
    return (value > 0 ? '+' : '') + value.toFixed(d);
  }

  function setUnit(node, value, unit) {
    node.textContent = value;
    if (unit) {
      const small = document.createElement('small');
      small.textContent = unit;
      node.append(' ', small);
    }
  }

  function paramsKey() {
    const p = state.params;
    return [
      p.lambdaNm,
      p.dMm,
      p.aMm,
      p.LM,
      p.screenWidthMm,
      p.lightMode,
      p.detectionMode
    ].join('|');
  }

  function setStatus(message, ms) {
    window.clearTimeout(state.statusTimer);
    el.statusLine.textContent = message || '';
    if (message && ms !== 0) {
      state.statusTimer = window.setTimeout(function () {
        el.statusLine.textContent = '';
      }, ms == null ? 4200 : ms);
    }
  }

  function invalidate() {
    state.needsDraw = true;
  }

  /* ------------------------------------------------------------------ *
   * Controls
   * ------------------------------------------------------------------ */

  function updateRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const value = Number(input.value);
    const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
    input.style.setProperty('--fill', pct.toFixed(2) + '%');
  }

  function syncControls() {
    const p = state.params;
    const isWhite = p.lightMode === 'white';
    const aMax = Math.min(P.LIMITS.aMm[1], p.dMm - 0.005);

    el.lambda.value = String(p.lambdaNm);
    el.slitDistance.value = String(p.dMm);
    el.slitWidth.max = aMax.toFixed(3);
    el.slitWidth.value = String(p.aMm);
    el.screenDistance.value = String(p.LM);
    el.screenWidth.value = String(p.screenWidthMm);

    el.outLambda.textContent = isWhite ? '白光' : fmt(p.lambdaNm, 1) + ' nm';
    el.outD.textContent = fmt(p.dMm, 3) + ' mm';
    el.outA.textContent = fmt(p.aMm, 3) + ' mm';
    el.outL.textContent = fmt(p.LM, 2) + ' m';
    el.outWidth.textContent = fmt(p.screenWidthMm, 0) + ' mm';

    if (el.aTicks && el.aTicks.children.length === 3) {
      el.aTicks.children[0].textContent = '0.01';
      el.aTicks.children[1].textContent = fmt((0.01 + aMax) / 2, 3);
      el.aTicks.children[2].textContent = fmt(aMax, 3) + ' mm';
    }

    el.lambda.disabled = isWhite;
    el.lambdaControl.classList.toggle('is-disabled', isWhite);
    el.envelopeToggle.hidden = isWhite;

    const swatch = isWhite
      ? 'linear-gradient(90deg, #4b00ff 0%, #00c8ff 24%, #00ff6a 48%, #ffe000 72%, #ff3b00 100%)'
      : P.spectralHex(p.lambdaNm);
    el.lambdaSwatch.style.background = swatch;
    el.lambdaSwatch.style.boxShadow = isWhite
      ? '0 0 10px rgba(255,255,255,.45)'
      : '0 0 10px ' + swatch;

    el.lightButtons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.light === p.lightMode));
    });
    el.detectionButtons.forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.detection === p.detectionMode));
    });

    el.showEnvelope.checked = state.showEnvelope;
    el.photonBar.hidden = p.detectionMode !== 'photon';

    updateRangeFill(el.lambda);
    updateRangeFill(el.slitDistance);
    updateRangeFill(el.slitWidth);
    updateRangeFill(el.screenDistance);
    updateRangeFill(el.screenWidth);

    updateSchematic();
  }

  function setParam(key, rawValue) {
    const next = Object.assign({}, state.params);
    next[key] = Number(rawValue);
    const normalized = P.normalizeParams(next);
    const geometryKeys = ['lambdaNm', 'dMm', 'aMm', 'LM', 'screenWidthMm'];
    const geometryChanged = geometryKeys.some(function (k) {
      return normalized[k] !== state.params[k];
    });

    if (key === 'aMm' && Math.abs(normalized.aMm - Number(rawValue)) > 1e-9) {
      setStatus('缝宽 a 已限制在 d − 0.005 mm 以内，保持两条缝分离。', 3200);
    }

    state.params = normalized;
    state.probeYM = clamp(state.probeYM, -normalized.screenWidthMm / 2, normalized.screenWidthMm / 2);

    if (geometryChanged) {
      resetPhotons({ silent: true });
    }

    syncControls();
    syncReadouts();
    updatePhotonUI();
    invalidate();
  }

  function setLightMode(mode) {
    if (mode !== 'mono' && mode !== 'white') return;
    if (state.params.lightMode === mode) return;

    stopAuto();
    state.params = P.normalizeParams(Object.assign({}, state.params, { lightMode: mode }));
    resetPhotons({ silent: true });
    syncAll();
    setStatus(
      mode === 'white'
        ? '白光模式：各波长独立干涉，中央白纹、边缘彩色。'
        : '单色光模式：条纹由单一波长决定。',
      4200
    );
  }

  function setDetectionMode(mode) {
    if (mode !== 'continuous' && mode !== 'photon') return;
    if (state.params.detectionMode === mode) return;

    if (mode === 'continuous') stopAuto();
    state.params = P.normalizeParams(Object.assign({}, state.params, { detectionMode: mode }));
    if (mode === 'photon') ensureSampler();

    syncAll();
    setStatus(
      mode === 'photon'
        ? '单光子模式：每个探测点独立按归一化强度 I(y) 抽样。'
        : '连续光模式：屏幕显示理论强度分布。',
      4200
    );
  }

  function applyPreset(name) {
    const preset = PRESETS[name];
    if (!preset) return;
    stopAuto();
    state.params = P.normalizeParams(Object.assign({}, state.params, preset));
    state.probeYM = 0;
    resetPhotons({ silent: true });
    syncAll();
    const labels = {
      hene: '氦氖激光 632.8 nm',
      green: '绿光 532 nm',
      missing: '缺级演示 d/a = 4',
      dense: '密条纹 d = 0.15 mm'
    };
    setStatus('已载入预设：' + labels[name] + '。', 3200);
  }

  function resetAll() {
    stopAuto();
    state.params = P.normalizeParams(P.DEFAULTS);
    state.probeYM = 0;
    state.showEnvelope = true;
    resetPhotons({ silent: true });
    syncAll();
    setStatus('已恢复标准参数。', 3000);
  }

  /* ------------------------------------------------------------------ *
   * Readouts and conclusions
   * ------------------------------------------------------------------ */

  function syncReadouts() {
    const p = state.params;
    const isWhite = p.lightMode === 'white';
    const sum = P.summary(p);

    el.metricValue.classList.toggle('is-range', isWhite);
    el.firstUnit.hidden = isWhite;
    el.envelopeUnit.hidden = isWhite;

    let headerText;
    if (isWhite) {
      const spacingMin = (400e-9 * p.LM) / (p.dMm * 1e-3) * 1e3;
      const spacingMax = (680e-9 * p.LM) / (p.dMm * 1e-3) * 1e3;
      el.metricSpacing.textContent = fmt(spacingMin, 1) + '–' + fmt(spacingMax, 1);
      el.metricNote.textContent = '400–680 nm 的条纹间距范围';
      el.metricFirst.textContent = '—';
      el.metricEnvelope.textContent = '—';
      el.metricOrders.textContent = '连续谱';
      el.metricRatio.textContent = fmt(sum.slitRatio, 2);
      el.readoutMode.textContent = '白光';
      headerText = p.detectionMode === 'photon' ? '白光 · 单光子' : '白光 · 6500 K 连续谱';
    } else {
      el.metricSpacing.textContent = fmt(sum.fringeSpacingMm, 2);
      el.metricNote.textContent = '小角近似 Δy ≈ λL/d';
      el.metricFirst.textContent = fmt(sum.firstOrderYMm, 2);
      el.metricEnvelope.textContent = fmt(sum.firstEnvelopeMinYMm, 2);
      const orders = P.orderPositionsMm(p);
      const visibleMax = orders.length
        ? Math.max.apply(null, orders.filter(function (o) { return !o.missing; }).map(function (o) { return Math.abs(o.m); }))
        : 0;
      el.metricOrders.textContent =
        sum.maxOrder === 0
          ? '仅中央'
          : '±' + visibleMax + (sum.missingOrders.length ? '（缺 ' + sum.missingText + '）' : '');
      el.metricRatio.textContent = fmt(sum.slitRatio, 2);
      el.readoutMode.textContent = p.detectionMode === 'photon' ? '单光子' : '单色光';
      headerText =
        (p.detectionMode === 'photon' ? '单光子' : '相干单色光') + ' · ' + fmt(p.lambdaNm, 1) + ' nm';
    }

    if (el.headerStatus.textContent !== headerText) {
      el.headerStatus.textContent = headerText;
    }

    el.metricNF.textContent = fmt(sum.fresnelNumber, 3);
    const farFieldOK = sum.fresnelNumber <= 0.09;
    el.farfieldBadge.textContent = farFieldOK ? '远场成立' : '近场警告';
    el.farfieldBadge.classList.toggle('is-warn', !farFieldOK);

    el.monoFormula.hidden = isWhite;
    el.whiteFormula.hidden = !isWhite;

    syncProbeReadout();
    syncConclusion();
    updateScreenDescription(sum);
  }

  function syncProbeReadout() {
    const p = state.params;
    const isWhite = p.lightMode === 'white';
    const s = P.stateAtY(state.probeYM, p);

    setUnit(el.probeY, signed(s.yM * 1e3, 2), 'mm');
    el.probeSin.textContent = s.sinTheta.toFixed(5);
    setUnit(el.probeDelta, s.pathDiffNm.toFixed(1), 'nm');

    if (isWhite) {
      el.probeOrder.textContent = '—';
      el.probeEnv.textContent = '—';
      el.probeIntensity.textContent = (p.detectionMode === 'photon'
        ? P.whiteLightDetectionAtY(state.probeYM, p)
        : P.whiteLightLuminance(state.probeYM, p)).toFixed(3);
      el.probeOrderBadge.textContent = p.detectionMode === 'photon' ? '白光 · 光子' : '白光';
    } else {
      el.probeOrder.textContent = s.order.toFixed(3);
      el.probeEnv.textContent = s.envelope.toFixed(3);
      el.probeIntensity.textContent = s.intensity.toFixed(3);
      el.probeOrderBadge.textContent = 'm = ' + s.order.toFixed(2);
      el.betaValue.textContent = s.beta.toFixed(3);
      el.alphaValue.textContent = s.alpha.toFixed(3);
      el.deltaValue.textContent = s.pathDiffNm.toFixed(1);
      el.factorEnv.textContent = s.envelope.toFixed(3);
      el.factorInt.textContent = s.interference.toFixed(3);
      el.factorEnvBar.style.width = (clamp01(s.envelope) * 100).toFixed(1) + '%';
      el.factorIntBar.style.width = (clamp01(s.interference) * 100).toFixed(1) + '%';
    }
  }

  function syncConclusion() {
    const p = state.params;
    const isWhite = p.lightMode === 'white';
    const sum = P.summary(p);
    let text;

    if (isWhite) {
      text =
        '白光由连续谱组成：中央零级让所有波长重合为白色，高级次因 λL/d 不同而展开成彩色；再往外，各波长条纹相互重叠，颜色趋于柔和。';
      if (p.detectionMode === 'photon') {
        text += ' 单光子图样按光子通量加权抽样，与视亮度曲线略有差异。';
      }
    } else if (sum.maxOrder === 0) {
      text = '当前视场只覆盖中央明纹；增大视场或减小缝距 d，可以让更多干涉级次进入屏幕。';
    } else {
      const orders = P.orderPositionsMm(p);
      const visible = orders.filter(function (o) {
        return !o.missing && Math.abs(o.m) > 0;
      });
      const visibleMax = visible.length
        ? Math.max.apply(null, visible.map(function (o) { return Math.abs(o.m); }))
        : 0;

      if (sum.missingOrders.length) {
        text =
          '中央明纹最强；屏内可容纳 ±' + sum.maxOrder + ' 级，' + sum.missingText +
          ' 级与单缝包络零点重合而缺级，实际可见到 ±' + visibleMax +
          ' 级。相邻明纹间距 ' + fmt(sum.fringeSpacingMm, 2) + ' mm。';
      } else {
        text =
          '中央明纹最强；屏内可见 ±' + sum.maxOrder + ' 级，没有严格缺级。相邻明纹间距 ' +
          fmt(sum.fringeSpacingMm, 2) + ' mm。';
      }
    }

    if (p.detectionMode === 'photon') {
      const count = state.photon.count;
      if (count === 0) {
        text += ' 尚未发射光子；点击“发射 1 个”或“自动累积”开始。';
      } else if (count < 200) {
        text += ' 已累积 ' + count.toLocaleString('zh-CN') + ' 个光子，随机性仍很明显。';
      } else if (count < 2000) {
        text += ' 已累积 ' + count.toLocaleString('zh-CN') + ' 个光子，条纹轮廓开始出现。';
      } else {
        text += ' 已累积 ' + count.toLocaleString('zh-CN') + ' 个光子，探测点分布已逼近理论曲线。';
      }
    }

    el.conclusion.textContent = text;
  }

  function updateScreenDescription(sum) {
    const p = state.params;
    const s = P.stateAtY(state.probeYM, p);
    let text = '观察屏，视场 ' + fmt(p.screenWidthMm, 0) + ' 毫米。';

    if (p.lightMode === 'white') {
      text += '白光图样，中央为白色，边缘呈彩色。';
    } else {
      text +=
        '条纹间距约 ' + fmt(P.fringeSpacingMm(p), 2) + ' 毫米，屏内可容纳 ±' +
        (sum ? sum.maxOrder : P.maxOrderOnScreen(p)) + ' 级。';
      if (sum && sum.missingOrders.length) {
        text += '其中 ' + sum.missingText + ' 级缺级。';
      }
    }

    const intensity = p.lightMode === 'white'
      ? (p.detectionMode === 'photon'
        ? P.whiteLightDetectionAtY(state.probeYM, p)
        : P.whiteLightLuminance(state.probeYM, p))
      : s.intensity;
    text += '探测位置 ' + signed(s.yM * 1e3, 2) + ' 毫米，相对强度 ' + intensity.toFixed(3) + '。';
    el.screenDescription.textContent = text;
  }

  function syncAll() {
    syncControls();
    syncReadouts();
    updatePhotonUI();
    invalidate();
  }

  /* ------------------------------------------------------------------ *
   * Photon accumulation
   * ------------------------------------------------------------------ */

  function colorString(rgbLinear, alpha) {
    const srgb = P.linearToSRGB(rgbLinear.map(clamp01));
    return 'rgba(' +
      Math.round(srgb[0] * 255) + ',' +
      Math.round(srgb[1] * 255) + ',' +
      Math.round(srgb[2] * 255) + ',' + alpha + ')';
  }

  function ensureSampler() {
    const p = state.params;
    const key = [p.lambdaNm, p.dMm, p.aMm, p.LM, p.screenWidthMm, p.lightMode].join('|');
    if (!state.photon.sampler || state.photon.samplerKey !== key) {
      state.photon.sampler = P.createPhotonSampler(p, p.lightMode);
      state.photon.samplerKey = key;
    }
  }

  function resetPhotons(options) {
    const opts = options || {};
    const b = state.photon;
    b.bctx.clearRect(0, 0, b.buffer.width, b.buffer.height);
    b.count = 0;
    b.accumulator = 0;
    b.sampler = null;
    b.samplerKey = '';
    b.hist.fill(0);
    b.lastTs = performance.now();
    if (!opts.silent) setStatus('光子记录已清空。', 2400);
    updatePhotonUI();
    syncConclusion();
    invalidate();
  }

  function updatePhotonUI() {
    const b = state.photon;
    el.photonCount.textContent = b.count.toLocaleString('zh-CN');
    el.clearPhotons.disabled = b.count === 0;
    el.autoEmit.setAttribute('aria-pressed', String(b.auto));
    const use = el.autoEmit.querySelector('use');
    if (use) use.setAttribute('href', b.auto ? '#i-pause' : '#i-play');
    const label = el.autoEmit.querySelector('span');
    if (label) label.textContent = b.auto ? '暂停累积' : '自动累积';
    el.photonBar.hidden = state.params.detectionMode !== 'photon';

    const now = performance.now();
    if (now - b.lastUi > 280) {
      b.lastUi = now;
      syncConclusion();
    }
  }

  function emitPhotons(n, forceConclusion) {
    if (state.params.detectionMode !== 'photon' || n <= 0) return;
    ensureSampler();

    const p = state.params;
    const b = state.photon;
    const W = p.screenWidthMm * 1e-3;
    const half = W / 2;
    const bw = b.buffer.width;
    const bh = b.buffer.height;
    const fixedCore = p.lightMode === 'mono' ? colorString(P.spectralLinearRGB(p.lambdaNm), 0.56) : null;
    const fixedHalo = p.lightMode === 'mono' ? colorString(P.spectralLinearRGB(p.lambdaNm), 0.09) : null;

    for (let i = 0; i < n; i++) {
      const sample = b.sampler.sample();
      const x = clamp(((sample.yM + half) / W) * bw, 0, bw - 1);
      const y = Math.random() * bh;
      const core = fixedCore || colorString(sample.rgbLinear, 0.56);
      const halo = fixedHalo || colorString(sample.rgbLinear, 0.09);

      b.bctx.fillStyle = halo;
      b.bctx.fillRect(x - 2.8, y - 2.8, 5.6, 5.6);
      b.bctx.fillStyle = core;
      b.bctx.fillRect(x - 1.2, y - 1.2, 2.4, 2.4);

      const bin = clamp(Math.floor(((sample.yM + half) / W) * b.histBins), 0, b.histBins - 1);
      b.hist[bin]++;
    }

    b.count += n;
    updatePhotonUI();
    if (forceConclusion) syncConclusion();
    invalidate();
  }

  function stopAuto() {
    if (!state.photon.auto) return;
    state.photon.auto = false;
    state.photon.accumulator = 0;
    updatePhotonUI();
  }

  function toggleAuto() {
    if (state.params.detectionMode !== 'photon') return;
    const b = state.photon;
    if (b.auto) {
      stopAuto();
      setStatus('已暂停累积。', 2400);
      return;
    }
    ensureSampler();
    b.auto = true;
    b.accumulator = 0;
    b.lastTs = performance.now();
    updatePhotonUI();
    setStatus('自动累积中：每个探测点独立抽样。', 3200);
  }

  /* ------------------------------------------------------------------ *
   * Records
   * ------------------------------------------------------------------ */

  function loadRecords() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        state.records = parsed.filter(function (r) {
          return r && typeof r === 'object' && typeof r.ts === 'number';
        }).slice(-40);
      }
    } catch (err) {
      state.records = [];
    }
  }

  function saveRecords() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
    } catch (err) {
      /* Local storage can be unavailable on file://; records still work in memory. */
    }
  }

  function renderRecords() {
    el.recordsBody.textContent = '';
    const hasRecords = state.records.length > 0;
    el.recordsTable.hidden = !hasRecords;
    el.recordsEmpty.hidden = hasRecords;

    state.records.forEach(function (record) {
      const tr = document.createElement('tr');
      const values = [
        formatTime(record.ts),
        record.lightMode === 'white' ? '白光' : '单色',
        record.lightMode === 'white' ? '—' : fmt(record.lambdaNm, 1) + ' nm',
        fmt(record.dMm, 3) + ' mm',
        fmt(record.aMm, 3) + ' mm',
        fmt(record.LM, 2) + ' m',
        record.lightMode === 'white' ? record.spacingRange + ' mm' : fmt(record.spacingMm, 2) + ' mm',
        record.lightMode === 'white' ? '—' : fmt(record.envelopeMm, 2) + ' mm',
        record.orders
      ];

      values.forEach(function (value) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      });

      const action = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'row-delete';
      button.dataset.id = record.id;
      button.setAttribute('aria-label', '删除这条记录');
      button.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>';
      action.appendChild(button);
      tr.appendChild(action);
      el.recordsBody.appendChild(tr);
    });
  }

  function formatTime(ts) {
    try {
      return new Date(ts).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    } catch (err) {
      return '—';
    }
  }

  function recordCurrent() {
    const p = state.params;
    const sum = P.summary(p);
    const isWhite = p.lightMode === 'white';
    const spacingMin = (400e-9 * p.LM) / (p.dMm * 1e-3) * 1e3;
    const spacingMax = (680e-9 * p.LM) / (p.dMm * 1e-3) * 1e3;

    const orders = P.orderPositionsMm(p);
    const visibleMax = orders.length
      ? Math.max.apply(null, orders.filter(function (o) { return !o.missing; }).map(function (o) { return Math.abs(o.m); }))
      : 0;
    const orderText = isWhite
      ? '连续谱'
      : (sum.maxOrder === 0
        ? '仅中央'
        : '±' + visibleMax + (sum.missingOrders.length ? '（缺 ' + sum.missingText + '）' : ''));

    const record = {
      id: String(Date.now()) + '-' + Math.random().toString(36).slice(2, 7),
      ts: Date.now(),
      lightMode: p.lightMode,
      lambdaNm: isWhite ? null : p.lambdaNm,
      dMm: p.dMm,
      aMm: p.aMm,
      LM: p.LM,
      screenWidthMm: p.screenWidthMm,
      spacingMm: isWhite ? null : sum.fringeSpacingMm,
      spacingRange: isWhite ? fmt(spacingMin, 1) + '–' + fmt(spacingMax, 1) : null,
      envelopeMm: isWhite ? null : sum.firstEnvelopeMinYMm,
      orders: orderText,
      fresnelNumber: sum.fresnelNumber
    };

    state.records.push(record);
    if (state.records.length > 40) state.records.shift();
    saveRecords();
    renderRecords();
    setStatus('已记录第 ' + state.records.length + ' 组数据。', 3000);
  }

  function csvCell(value) {
    const text = value == null ? '' : String(value);
    if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function downloadText(filename, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 800);
  }

  function exportRecordsCSV() {
    if (!state.records.length) {
      setStatus('还没有可导出的记录。', 2600);
      return;
    }
    const rows = [
      ['时间', '光源', '波长_nm', '缝距_d_mm', '缝宽_a_mm', '屏距_L_m', '视场_mm', '条纹间距_mm', '包络半宽_mm', '可见级次', '远场_NF']
    ];
    state.records.forEach(function (r) {
      rows.push([
        new Date(r.ts).toISOString(),
        r.lightMode === 'white' ? '白光' : '单色光',
        r.lightMode === 'white' ? '' : r.lambdaNm,
        r.dMm,
        r.aMm,
        r.LM,
        r.screenWidthMm,
        r.lightMode === 'white' ? r.spacingRange : r.spacingMm,
        r.lightMode === 'white' ? '' : r.envelopeMm,
        r.orders,
        r.fresnelNumber
      ]);
    });
    downloadText('double-slit-records.csv', '\ufeff' + rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\n'));
    setStatus('已导出 ' + state.records.length + ' 组记录。', 3000);
  }

  function exportCurveCSV() {
    const p = state.params;
    const samples = P.curve(p, 1201);
    const rows = [
      ['模式', 'y_mm', 'sin_theta', 'I_norm', 'detection_prob', 'luminance', 'envelope', 'interference', 'path_diff_nm', 'R_linear', 'G_linear', 'B_linear']
    ];
    samples.forEach(function (s) {
      rows.push([
        p.lightMode === 'white' ? 'white' : 'mono',
        s.yMm.toFixed(4),
        s.sinTheta.toFixed(8),
        s.intensity.toFixed(8),
        s.detection == null ? '' : s.detection.toFixed(8),
        s.luminance == null ? '' : s.luminance.toFixed(8),
        s.envelope == null ? '' : s.envelope.toFixed(8),
        s.interference == null ? '' : s.interference.toFixed(8),
        s.pathDiffNm.toFixed(4),
        s.rgbLinear ? s.rgbLinear[0].toFixed(6) : '',
        s.rgbLinear ? s.rgbLinear[1].toFixed(6) : '',
        s.rgbLinear ? s.rgbLinear[2].toFixed(6) : ''
      ]);
    });
    downloadText('double-slit-intensity.csv', '\ufeff' + rows.map(function (row) {
      return row.map(csvCell).join(',');
    }).join('\n'));
    setStatus('已导出当前强度曲线（1201 个采样点）。', 3200);
  }

  function clearRecords() {
    if (!state.records.length) {
      setStatus('记录已经是空的。', 2200);
      return;
    }
    if (!window.confirm('清空所有实验记录？')) return;
    state.records = [];
    saveRecords();
    renderRecords();
    setStatus('实验记录已清空。', 2400);
  }

  /* ------------------------------------------------------------------ *
   * Schematic
   * ------------------------------------------------------------------ */

  function updateSchematic() {
    const p = state.params;
    const sep = 10 + ((p.dMm - 0.04) / (0.15 - 0.04)) * 22;
    const slitH = 2 + ((p.aMm - 0.01) / (0.05 - 0.01)) * 4;
    const topCenter = 84 - sep / 2;
    const bottomCenter = 84 + sep / 2;

    el.slitTop.setAttribute('y', (topCenter - slitH / 2).toFixed(2));
    el.slitTop.setAttribute('height', slitH.toFixed(2));
    el.slitBottom.setAttribute('y', (bottomCenter - slitH / 2).toFixed(2));
    el.slitBottom.setAttribute('height', slitH.toFixed(2));

    el.labelD.setAttribute('y', '88');
    el.labelA.setAttribute('y', (topCenter - 4).toFixed(2));
    el.dimD.setAttribute('d', 'M102 ' + topCenter.toFixed(2) + ' V ' + bottomCenter.toFixed(2));

    el.rayTop.setAttribute('d', 'M116 ' + topCenter.toFixed(2) + ' L282 48');
    el.rayBottom.setAttribute('d', 'M116 ' + bottomCenter.toFixed(2) + ' L282 120');
    el.rayTop2.setAttribute('d', 'M116 ' + bottomCenter.toFixed(2) + ' L282 58');
    el.rayBottom2.setAttribute('d', 'M116 ' + topCenter.toFixed(2) + ' L282 110');

    const color = p.lightMode === 'white' ? '#e7e2d2' : P.spectralHex(p.lambdaNm);
    el.beamPath.style.stroke = color;
    el.beamPath.style.filter = 'drop-shadow(0 0 3px ' + color + '88)';
    el.rayGroup.style.stroke = color;
  }

  /* ------------------------------------------------------------------ *
   * Canvas
   * ------------------------------------------------------------------ */

  function resizeCanvas() {
    const rect = el.canvas.getBoundingClientRect();
    const w = Math.max(280, Math.round(rect.width));
    const h = Math.max(300, Math.round(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelW = Math.round(w * dpr);
    const pixelH = Math.round(h * dpr);
    const changed = el.canvas.width !== pixelW || el.canvas.height !== pixelH;

    if (changed) {
      el.canvas.width = pixelW;
      el.canvas.height = pixelH;
      state.stripBuffer = null;
      state.stripBufferCtx = null;
      state.stripCacheKey = '';
      state.chartCache = null;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    state.view = { w, h, dpr };
    state.layout = computeLayout(w, h);
    state.needsResize = false;
  }

  function computeLayout(w, h) {
    const padL = w < 520 ? 34 : 46;
    const padR = w < 520 ? 14 : 22;
    const stripTop = 34;
    const stripH = Math.round(h * 0.46);
    const chartTop = stripTop + stripH + 20;
    const rulerY = h - 24;
    const available = rulerY - chartTop - 24;
    const chartH = Math.max(54, Math.min(Math.round(h * 0.27), available));
    const plotL = padL;
    const plotR = w - padR;
    const plotW = Math.max(120, plotR - plotL);
    return {
      w,
      h,
      plotL,
      plotR,
      plotW,
      stripTop,
      stripH,
      stripBottom: stripTop + stripH,
      chartTop,
      chartH,
      chartBottom: chartTop + chartH,
      rulerY,
      centerX: plotL + plotW / 2
    };
  }

  function draw() {
    if (state.needsResize || !state.view) resizeCanvas();
    if (!state.view) return;

    const view = state.view;
    const layout = computeLayout(view.w, view.h);
    state.layout = layout;

    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    ctx.fillStyle = '#05090a';
    ctx.fillRect(0, 0, view.w, view.h);

    const glow = ctx.createRadialGradient(view.w / 2, 0, 0, view.w / 2, 0, view.h * 0.95);
    glow.addColorStop(0, 'rgba(47,183,174,.065)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, view.w, view.h);

    if (state.params.detectionMode === 'photon') {
      drawPhotonStrip(layout);
    } else {
      drawStripContinuous(layout);
    }
    drawChart(layout);
    drawRuler(layout);
    drawOrderMarkers(layout);
    drawProbe(layout);
    drawCorners(layout);

    state.needsDraw = false;
  }

  function drawStripContinuous(layout) {
    const p = state.params;
    const isWhite = p.lightMode === 'white';
    const step = isWhite ? 2 : 1;
    const cols = Math.max(2, Math.ceil(layout.plotW / step));
    const key = paramsKey() + '|' + layout.plotW + '|' + isWhite;

    if (state.stripCacheKey !== key || !state.stripBuffer) {
      if (!state.stripBuffer || state.stripBuffer.width !== cols) {
        state.stripBuffer = document.createElement('canvas');
        state.stripBuffer.width = cols;
        state.stripBuffer.height = 1;
        state.stripBufferCtx = state.stripBuffer.getContext('2d');
      }
      const bufCtx = state.stripBufferCtx;
      const image = bufCtx.createImageData(cols, 1);
      const W = p.screenWidthMm * 1e-3;
      const monoRGB = isWhite ? null : P.spectralLinearRGB(p.lambdaNm);

      for (let i = 0; i < cols; i++) {
        const x0 = layout.plotL + (i + 0.25) * step;
        const x1 = layout.plotL + (i + 0.75) * step;
        const y0 = ((x0 - layout.plotL) / layout.plotW - 0.5) * W;
        const y1 = ((x1 - layout.plotL) / layout.plotW - 0.5) * W;
        let rgb;

        if (isWhite) {
          const a = P.whiteLightStateAtY(y0, p);
          const b = P.whiteLightStateAtY(y1, p);
          rgb = [
            (a.rgbLinear[0] + b.rgbLinear[0]) / 2,
            (a.rgbLinear[1] + b.rgbLinear[1]) / 2,
            (a.rgbLinear[2] + b.rgbLinear[2]) / 2
          ];
        } else {
          const intensity = (P.intensityAtY(y0, p) + P.intensityAtY(y1, p)) / 2;
          rgb = [monoRGB[0] * intensity, monoRGB[1] * intensity, monoRGB[2] * intensity];
        }

        const srgb = P.linearToSRGB(rgb);
        const offset = i * 4;
        image.data[offset] = Math.round(clamp01(srgb[0]) * 255);
        image.data[offset + 1] = Math.round(clamp01(srgb[1]) * 255);
        image.data[offset + 2] = Math.round(clamp01(srgb[2]) * 255);
        image.data[offset + 3] = 255;
      }

      bufCtx.putImageData(image, 0, 0);
      state.stripCacheKey = key;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(
      state.stripBuffer,
      0, 0, state.stripBuffer.width, 1,
      layout.plotL, layout.stripTop, layout.plotW, layout.stripH
    );

    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(layout.plotL + 0.5, layout.stripTop + 0.5, layout.plotW - 1, layout.stripH - 1);
  }

  function drawPhotonStrip(layout) {
    ctx.fillStyle = '#05090a';
    ctx.fillRect(layout.plotL, layout.stripTop, layout.plotW, layout.stripH);

    if (state.photon.count > 0) {
      ctx.drawImage(
        state.photon.buffer,
        0, 0, state.photon.buffer.width, state.photon.buffer.height,
        layout.plotL, layout.stripTop, layout.plotW, layout.stripH
      );
    } else {
      ctx.fillStyle = 'rgba(247,248,244,.24)';
      ctx.font = '10px "Avenir Next", "PingFang SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('等待光子', layout.centerX, layout.stripTop + layout.stripH / 2);
    }

    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(layout.plotL + 0.5, layout.stripTop + 0.5, layout.plotW - 1, layout.stripH - 1);
  }

  function getChartCache(layout) {
    const p = state.params;
    const key = paramsKey() + '|' + Math.round(layout.plotW) + '|' + state.showEnvelope;
    if (state.chartCache && state.chartCache.key === key) return state.chartCache;

    const N = Math.max(2, Math.round(layout.plotW));
    const intensity = new Float32Array(N);
    const envelope = p.lightMode === 'white' ? null : new Float32Array(N);
    const W = p.screenWidthMm * 1e-3;

    for (let i = 0; i < N; i++) {
      const yM = ((i + 0.5) / N - 0.5) * W;
      if (p.lightMode === 'white') {
        intensity[i] = p.detectionMode === 'photon'
          ? P.whiteLightDetectionAtY(yM, p)
          : P.whiteLightLuminance(yM, p);
      } else {
        const s = P.stateAtY(yM, p);
        intensity[i] = s.intensity;
        envelope[i] = s.envelope;
      }
    }

    state.chartCache = { key: key, intensity: intensity, envelope: envelope, N: N };
    return state.chartCache;
  }

  function drawChart(layout) {
    const p = state.params;
    const isWhite = p.lightMode === 'white';
    const { plotL, plotW, chartTop, chartH, chartBottom } = layout;
    const cache = getChartCache(layout);

    ctx.fillStyle = 'rgba(255,255,255,.018)';
    ctx.fillRect(plotL, chartTop, plotW, chartH);

    ctx.font = '8px "Avenir Next", "PingFang SC", sans-serif';
    ctx.textBaseline = 'middle';

    for (let i = 0; i <= 4; i++) {
      const value = i / 4;
      const y = chartBottom - chartH * value;
      ctx.strokeStyle = i === 0 || i === 4
        ? 'rgba(255,255,255,.12)'
        : 'rgba(255,255,255,.06)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(plotL, y + 0.5);
      ctx.lineTo(plotL + plotW, y + 0.5);
      ctx.stroke();
    }

    ctx.fillStyle = 'rgba(247,248,244,.38)';
    ctx.textAlign = 'right';
    ctx.fillText('0', plotL - 7, chartBottom);
    ctx.fillText('0.5', plotL - 7, chartBottom - chartH / 2);
    ctx.fillText('1.0', plotL - 7, chartTop);
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(247,248,244,.34)';
    ctx.fillText('相对强度 I/I₀', plotL, chartTop - 8);

    if (p.detectionMode === 'photon' && state.photon.count > 0) {
      const hist = state.photon.hist;
      let maxHist = 0;
      for (let i = 0; i < hist.length; i++) {
        if (hist[i] > maxHist) maxHist = hist[i];
      }
      if (maxHist > 0) {
        const binW = plotW / hist.length;
        ctx.fillStyle = 'rgba(47,183,174,.16)';
        for (let i = 0; i < hist.length; i++) {
          const barH = chartH * (hist[i] / maxHist) * 0.86;
          if (barH > 0) {
            ctx.fillRect(plotL + i * binW, chartBottom - barH, Math.max(1, binW - 0.5), barH);
          }
        }
      }
    }

    const gradient = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
    gradient.addColorStop(0, 'rgba(47,183,174,.14)');
    gradient.addColorStop(1, 'rgba(47,183,174,0)');

    ctx.beginPath();
    for (let i = 0; i < cache.N; i++) {
      const x = plotL + (i / (cache.N - 1)) * plotW;
      const y = chartBottom - clamp01(cache.intensity[i]) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineTo(plotL + plotW, chartBottom);
    ctx.lineTo(plotL, chartBottom);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    for (let i = 0; i < cache.N; i++) {
      const x = plotL + (i / (cache.N - 1)) * plotW;
      const y = chartBottom - clamp01(cache.intensity[i]) * chartH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(142,232,223,.9)';
    ctx.lineWidth = 1.6;
    ctx.setLineDash(p.detectionMode === 'photon' ? [5, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (!isWhite && state.showEnvelope && cache.envelope) {
      ctx.beginPath();
      for (let i = 0; i < cache.N; i++) {
        const x = plotL + (i / (cache.N - 1)) * plotW;
        const y = chartBottom - clamp01(cache.envelope[i]) * chartH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(214,161,58,.58)';
      ctx.lineWidth = 1.1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    drawChartLegend(layout, isWhite);

    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.lineWidth = 1;
    ctx.strokeRect(plotL + 0.5, chartTop + 0.5, plotW - 1, chartH - 1);
  }

  function drawChartLegend(layout, isWhite) {
    const p = state.params;
    const y = layout.chartTop + 12;
    const right = layout.plotL + layout.plotW - 6;
    const width = 142;
    const left = right - width;

    ctx.fillStyle = 'rgba(5,9,10,.58)';
    ctx.fillRect(left - 4, y - 9, width + 8, 18);
    ctx.font = '8px "Avenir Next", "PingFang SC", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    let x = left;
    if (p.detectionMode === 'photon') {
      ctx.fillStyle = 'rgba(47,183,174,.35)';
      ctx.fillRect(x, y - 3, 8, 6);
      x += 12;
      ctx.fillStyle = 'rgba(247,248,244,.58)';
      ctx.fillText('实测', x, y);
      x += 29;

      ctx.strokeStyle = 'rgba(142,232,223,.9)';
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 11, y);
      ctx.stroke();
      ctx.setLineDash([]);
      x += 15;
      ctx.fillStyle = 'rgba(247,248,244,.58)';
      ctx.fillText('理论', x, y);
    } else {
      ctx.strokeStyle = 'rgba(142,232,223,.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 11, y);
      ctx.stroke();
      x += 15;
      ctx.fillStyle = 'rgba(247,248,244,.58)';
      ctx.fillText(isWhite ? '视亮度' : '强度', x, y);
      x += isWhite ? 37 : 23;

      if (!isWhite && state.showEnvelope) {
        ctx.strokeStyle = 'rgba(214,161,58,.65)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + 11, y);
        ctx.stroke();
        ctx.setLineDash([]);
        x += 15;
        ctx.fillStyle = 'rgba(247,248,244,.58)';
        ctx.fillText('包络', x, y);
      }
    }
  }

  function formatTick(value, step) {
    if (Math.abs(value) < 1e-9) return '0';
    return step < 1 ? value.toFixed(1) : value.toFixed(0);
  }

  function drawRuler(layout) {
    const p = state.params;
    const Wmm = p.screenWidthMm;
    const pxPerMm = layout.plotW / Wmm;
    const candidates = [0.5, 1, 2, 5, 10, 20, 50];
    let step = 50;
    for (let i = 0; i < candidates.length; i++) {
      if (candidates[i] * pxPerMm >= 64) {
        step = candidates[i];
        break;
      }
    }
    const minor = step / 5;

    ctx.strokeStyle = 'rgba(255,255,255,.22)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(layout.plotL, layout.rulerY + 0.5);
    ctx.lineTo(layout.plotR, layout.rulerY + 0.5);
    ctx.stroke();

    ctx.font = '8px "Avenir Next", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    const start = Math.ceil((-Wmm / 2) / minor) * minor;
    for (let value = start; value <= Wmm / 2 + 1e-9; value += minor) {
      const x = layout.centerX + value * pxPerMm;
      if (x < layout.plotL - 0.5 || x > layout.plotR + 0.5) continue;
      const isMajor = Math.abs(value / step - Math.round(value / step)) < 1e-6;
      ctx.strokeStyle = isMajor ? 'rgba(255,255,255,.32)' : 'rgba(255,255,255,.13)';
      ctx.beginPath();
      ctx.moveTo(x, layout.rulerY);
      ctx.lineTo(x, layout.rulerY + (isMajor ? 6 : 3));
      ctx.stroke();
      if (isMajor) {
        ctx.fillStyle = 'rgba(247,248,244,.42)';
        ctx.fillText(formatTick(value, step), x, layout.rulerY + 9);
      }
    }

    ctx.fillStyle = 'rgba(247,248,244,.32)';
    ctx.textAlign = 'right';
    ctx.fillText('mm', layout.plotR, layout.rulerY + 9);
  }

  function drawOrderMarkers(layout) {
    const p = state.params;
    if (p.lightMode === 'white') return;

    const orders = P.orderPositionsMm(p);
    const Wmm = p.screenWidthMm;
    ctx.font = '8px "Avenir Next", "PingFang SC", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    let lastLabelX = -1e9;

    orders.forEach(function (order) {
      const x = layout.centerX + (order.yMm / Wmm) * layout.plotW;
      if (x < layout.plotL - 1 || x > layout.plotR + 1) return;

      ctx.strokeStyle = order.missing ? 'rgba(214,161,58,.9)' : 'rgba(247,248,244,.38)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, layout.stripTop - 5);
      ctx.lineTo(x, layout.stripTop - 1);
      ctx.stroke();

      const label = (order.m === 0 ? '0' : (order.m > 0 ? '+' : '') + order.m) + (order.missing ? ' 缺' : '');
      if (x - lastLabelX > 31 && x > layout.plotL + 10 && x < layout.plotR - 10) {
        ctx.fillStyle = order.missing ? 'rgba(214,161,58,.9)' : 'rgba(247,248,244,.44)';
        ctx.fillText(label, x, layout.stripTop - 7);
        lastLabelX = x;
      }
    });
  }

  function drawProbe(layout) {
    const p = state.params;
    const x = layout.centerX + (state.probeYM / (p.screenWidthMm * 1e-3)) * layout.plotW;

    ctx.save();
    ctx.strokeStyle = 'rgba(142,232,223,.72)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, layout.stripTop - 3);
    ctx.lineTo(x, layout.rulerY + 2);
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(x, layout.stripTop - 14, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(142,232,223,.95)';
    ctx.fill();
    ctx.strokeStyle = '#05090a';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawCorners(layout) {
    const x0 = layout.plotL + 4;
    const x1 = layout.plotL + layout.plotW - 4;
    const y0 = layout.stripTop + 4;
    const y1 = layout.stripBottom - 4;
    const len = 7;

    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y0 + len);
    ctx.lineTo(x0, y0);
    ctx.lineTo(x0 + len, y0);
    ctx.moveTo(x1 - len, y0);
    ctx.lineTo(x1, y0);
    ctx.lineTo(x1, y0 + len);
    ctx.moveTo(x0, y1 - len);
    ctx.lineTo(x0, y1);
    ctx.lineTo(x0 + len, y1);
    ctx.moveTo(x1 - len, y1);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, y1 - len);
    ctx.stroke();
  }

  /* ------------------------------------------------------------------ *
   * Pointer / keyboard probe
   * ------------------------------------------------------------------ */

  function setProbeFromClientX(clientX) {
    const layout = state.layout;
    if (!layout) return;
    const rect = el.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const W = state.params.screenWidthMm;
    const yMm = ((x - layout.plotL) / layout.plotW - 0.5) * W;
    state.probeYM = clamp(yMm * 1e-3, -W / 2 * 1e-3, W / 2 * 1e-3);
    syncProbeReadout();
    updateScreenDescription(P.summary(state.params));
    invalidate();
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    state.dragging = true;
    el.canvas.focus({ preventScroll: true });
    el.canvas.setPointerCapture(event.pointerId);
    setProbeFromClientX(event.clientX);
    event.preventDefault();
  }

  function onPointerMove(event) {
    if (!state.dragging) return;
    setProbeFromClientX(event.clientX);
    event.preventDefault();
  }

  function onPointerUp(event) {
    if (!state.dragging) return;
    state.dragging = false;
    if (el.canvas.hasPointerCapture(event.pointerId)) {
      el.canvas.releasePointerCapture(event.pointerId);
    }
  }

  function onCanvasKeyDown(event) {
    const W = state.params.screenWidthMm;
    const step = (event.shiftKey ? 5 : 0.5) * 1e-3;
    let handled = true;

    if (event.key === 'ArrowLeft') {
      state.probeYM = clamp(state.probeYM - step, -W / 2 * 1e-3, W / 2 * 1e-3);
    } else if (event.key === 'ArrowRight') {
      state.probeYM = clamp(state.probeYM + step, -W / 2 * 1e-3, W / 2 * 1e-3);
    } else if (event.key === 'Home') {
      state.probeYM = 0;
    } else if (event.key === 'PageUp') {
      state.probeYM = clamp(state.probeYM + W / 10 * 1e-3, -W / 2 * 1e-3, W / 2 * 1e-3);
    } else if (event.key === 'PageDown') {
      state.probeYM = clamp(state.probeYM - W / 10 * 1e-3, -W / 2 * 1e-3, W / 2 * 1e-3);
    } else {
      handled = false;
    }

    if (handled) {
      event.preventDefault();
      syncProbeReadout();
      updateScreenDescription(P.summary(state.params));
      invalidate();
    }
  }

  /* ------------------------------------------------------------------ *
   * Main loop
   * ------------------------------------------------------------------ */

  function loop(ts) {
    const b = state.photon;
    if (state.params.detectionMode === 'photon' && b.auto) {
      if (!b.lastTs) b.lastTs = ts;
      const dt = clamp((ts - b.lastTs) / 1000, 0, 0.1);
      b.lastTs = ts;
      b.accumulator += dt * b.rate;
      const n = Math.floor(b.accumulator);
      if (n > 0) {
        b.accumulator -= n;
        emitPhotons(n);
      }
    } else {
      b.lastTs = ts;
      b.accumulator = 0;
    }

    if (state.needsDraw) draw();
    window.requestAnimationFrame(loop);
  }

  /* ------------------------------------------------------------------ *
   * Wiring
   * ------------------------------------------------------------------ */

  function bind() {
    el.lambda.addEventListener('input', function () { setParam('lambdaNm', el.lambda.value); });
    el.slitDistance.addEventListener('input', function () { setParam('dMm', el.slitDistance.value); });
    el.slitWidth.addEventListener('input', function () { setParam('aMm', el.slitWidth.value); });
    el.screenDistance.addEventListener('input', function () { setParam('LM', el.screenDistance.value); });
    el.screenWidth.addEventListener('input', function () { setParam('screenWidthMm', el.screenWidth.value); });

    el.lightButtons.forEach(function (button) {
      button.addEventListener('click', function () { setLightMode(button.dataset.light); });
    });
    el.detectionButtons.forEach(function (button) {
      button.addEventListener('click', function () { setDetectionMode(button.dataset.detection); });
    });

    el.showEnvelope.addEventListener('change', function () {
      state.showEnvelope = el.showEnvelope.checked;
      state.chartCache = null;
      invalidate();
    });

    el.presetSelect.addEventListener('change', function () {
      const value = el.presetSelect.value;
      if (!value) return;
      applyPreset(value);
      el.presetSelect.value = '';
    });

    el.resetBtn.addEventListener('click', resetAll);
    el.resetBtn2.addEventListener('click', resetAll);

    el.emitOne.addEventListener('click', function () {
      emitPhotons(1, true);
      setStatus('发射 1 个光子。', 1200);
    });
    el.autoEmit.addEventListener('click', toggleAuto);
    el.emitMany.addEventListener('click', function () {
      emitPhotons(10000, true);
      setStatus('快进 10,000 个光子。', 2600);
    });
    el.clearPhotons.addEventListener('click', function () {
      resetPhotons({ silent: false });
    });

    el.recordBtn.addEventListener('click', recordCurrent);
    el.exportRecords.addEventListener('click', exportRecordsCSV);
    el.exportCurve.addEventListener('click', exportCurveCSV);
    el.clearRecords.addEventListener('click', clearRecords);

    el.recordsBody.addEventListener('click', function (event) {
      const button = event.target.closest('button[data-id]');
      if (!button) return;
      state.records = state.records.filter(function (record) {
        return record.id !== button.dataset.id;
      });
      saveRecords();
      renderRecords();
      setStatus('已删除一条记录。', 2200);
    });

    el.canvas.addEventListener('pointerdown', onPointerDown);
    el.canvas.addEventListener('pointermove', onPointerMove);
    el.canvas.addEventListener('pointerup', onPointerUp);
    el.canvas.addEventListener('pointercancel', onPointerUp);
    el.canvas.addEventListener('keydown', onCanvasKeyDown);

    if ('ResizeObserver' in window) {
      const observer = new ResizeObserver(function () {
        state.needsResize = true;
        state.needsDraw = true;
      });
      observer.observe(el.canvas);
    }
    window.addEventListener('resize', function () {
      state.needsResize = true;
      state.needsDraw = true;
    });
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) state.photon.lastTs = performance.now();
    });
  }

  function init() {
    loadRecords();
    bind();
    syncAll();
    renderRecords();
    window.requestAnimationFrame(loop);
    window.setTimeout(function () {
      if (!state.photon.count) {
        setStatus('提示：拖动屏上的青色探测线，或使用 ← → 键移动。', 5200);
      }
    }, 900);
  }

  init();
})();
