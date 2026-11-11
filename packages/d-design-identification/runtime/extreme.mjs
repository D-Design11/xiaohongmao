/** Pure constraint resolver. No network, AI call, image generation or production renderer. */
const finitePositive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const clone = value => JSON.parse(JSON.stringify(value));
const issue = (code, message, source, severity = 'error') => ({ code, message, source, severity });
const intersect = (a, b, e = 0) => a.x < b.x + b.width - e && a.x + a.width > b.x + e && a.y < b.y + b.height - e && a.y + a.height > b.y + e;
const bounds = (x, y, width, height) => ({ x, y, width, height });
const rectValid = b => b && [b.x, b.y, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0;
const contains = (outer, inner, e = 0) => inner.x >= outer.x - e && inner.y >= outer.y - e && inner.x + inner.width <= outer.x + outer.width + e && inner.y + inner.height <= outer.y + outer.height + e;
const close = (a, b, e) => Math.abs(a - b) <= e;

export function countCopy(value) {
  if (typeof value !== 'string') throw new TypeError('文案必须是字符串。');
  const text = value.normalize('NFC').replace(/\r\n?/g, '\n').trim();
  const counted = text.replace(/\n/g, '');
  if (!Intl.Segmenter) throw new Error('运行环境需要 Intl.Segmenter；不能退化为 UTF-16 长度计数。');
  const count = [...new Intl.Segmenter('zh', { granularity: 'grapheme' }).segment(counted)].length;
  return { text, count };
}

export function assertRules(rules, common) {
  const fail = message => { throw new Error(`规则包无效：${message}`); };
  if (rules?.id !== 'd-design-extreme-identification' || rules.schemaVersion !== 1) fail('标识或版本不支持。');
  if (rules.canvas?.profiles?.landscape?.widthToHeight !== 6 || rules.canvas?.profiles?.portrait?.widthToHeight !== 1 / 6) fail('本包只支持6:1和1:6。');
  if (rules.content?.headline?.maxGraphemes !== 10 || rules.content?.subtitle?.maxGraphemes !== 16) fail('不得覆盖已确认的10/16字限制。');
  for (const key of ['enabled', 'reserveSpace', 'createPlaceholder', 'renderCaption', 'inheritOrdinaryPositionLinkage']) if (rules.qr?.[key] !== false) fail('二维码必须完全关闭。');
  if (rules.scope?.enabledStructure !== 'brand-pillar' || rules.brand?.margin?.mode !== 'inherit') fail('结构或边距继承规则不正确。');
  if (rules.canvas.profiles.landscape.logoHeightShortEdgeFactor !== 1 / 7 || rules.canvas.profiles.portrait.logoHeightShortEdgeFactor !== 1 / 8) fail('标识推荐比例与本包依据不一致。');
  for (const [id, f] of [['S', 1 / 3], ['M', .5], ['L', 2 / 3]]) if (rules.layouts?.[id]?.informationFraction !== f || rules.layouts[id].mode !== 'split') fail('分割比例不正确。');
  if (rules.layouts?.XL?.mode !== 'overlay' || rules.layouts.XL.informationFraction !== null) fail('XL应为全画面。');
  if (rules.appearance?.blackOverlay !== false || rules.appearance?.automaticDarkening !== false) fail('必须保留原图。');
  if (!finitePositive(rules.canvas.ratioEpsilon) || rules.canvas.ratioEpsilon > .000001) fail('比例数值容差过大。');
  if (common?.id !== 'd-design-common-identification-snapshot' || !finitePositive(common.marginInBrandUnits) || common.marginInBrandUnits < 1) fail('缺少有效的共用边距。');
  for (const key of ['logoVisibleAspect', 'sloganVisibleAspect', 'minSloganHeightInBrandUnits']) if (!finitePositive(common[key])) fail(`共用组件参数${key}不正确。`);
  if (common.minSloganHeightInBrandUnits < 1) fail('口号不能小于1D。');
  const t = common.typography;
  for (const key of ['referenceShortEdge', 'referenceTextWidth', 'referenceTitleSubtitleGap']) if (!finitePositive(t?.[key])) fail('缺少文字基准。');
  for (const k of ['headline', 'subtitle']) {
    const f = t[k];
    if (!f?.assetId || !finitePositive(f.referenceEm) || !finitePositive(f.lineAdvanceEm) || f.lineAdvanceEm < 1 || !Number.isFinite(f.trackingEm) || !Number.isInteger(f.maxLines) || f.maxLines < 1) fail('文字组件参数不完整。');
  }
  const j = common.jointBrand;
  if (j?.maxPartners !== 2 || JSON.stringify(j.partnerHeightRange) !== '[0.8,1.2]' || j.separatorWidthInBrandUnits !== .55 || j.gapBeforeSeparatorInBrandUnits !== .5 || j.gapAfterSeparatorInBrandUnits !== .5) fail('联合标识间距或比例不正确。');
  return true;
}

export function classifyCanvas(canvas) {
  if (!canvas || !finitePositive(canvas.width) || !finitePositive(canvas.height) || !['px', 'mm'].includes(canvas.unit)) return 'invalid';
  const r = canvas.width / canvas.height;
  if (Math.abs(r - 6) / 6 <= .000001 || Math.abs(r - 1 / 6) / (1 / 6) <= .000001) return 'extreme-supported';
  return r >= 6 || r <= 1 / 4 ? 'extreme-unsupported' : 'regular';
}

export function validateRequest(input, rules) {
  const errors = [], warnings = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { valid: false, errors: [issue('request-format', '需求必须是对象。', 'request.schema.json')], warnings };
  const allowed = ['canvas', 'preset', 'title', 'subtitle', 'structure', 'brandVariant', 'informationPlacement', 'qrEnabled', 'qr', 'partners'];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) errors.push(issue('unknown-field', `不支持字段 ${key}；先通过后台适配层映射项目字段。`, 'request.schema.json'));
  const canvas = input.canvas;
  let orientation = null;
  if (!canvas || typeof canvas !== 'object' || !finitePositive(canvas.width) || !finitePositive(canvas.height) || !rules.canvas.units.includes(canvas.unit)) errors.push(issue('canvas-invalid', '请提供有效的成品宽、高和px/mm单位。', 'user-fixed-ratio'));
  else {
    if (Object.keys(canvas).some(k => !['width', 'height', 'unit'].includes(k))) errors.push(issue('canvas-fields', '画布含有未支持字段。', 'request.schema.json'));
    orientation = canvas.width > canvas.height ? 'landscape' : 'portrait';
    const expected = rules.canvas.profiles[orientation].widthToHeight;
    if (Math.abs(canvas.width / canvas.height - expected) / expected > rules.canvas.ratioEpsilon) errors.push(issue('unsupported-ratio', '本规则仅支持横版6:1、竖版1:6；不能按最近比例回退。', 'user-fixed-ratio'));
  }
  if (!Object.hasOwn(rules.layouts, input.preset)) errors.push(issue('preset-invalid', '请选择S、M、L或XL。', 'scope'));
  if (input.structure !== undefined && input.structure !== 'brand-pillar') errors.push(issue('structure-not-enabled', '本版运行模块启用品牌柱；独立识别区和特殊组合请按参考说明接入。', 'scope'));
  let title = { text: '', count: 0 }, subtitle = { text: '', count: 0 };
  for (const [field, max, required] of [['title', 10, true], ['subtitle', 16, false]]) {
    const value = input[field] ?? (required ? null : '');
    if (typeof value !== 'string') { errors.push(issue(`${field}-type`, `${field === 'title' ? '主标题' : '副标题'}必须是文字。`, 'content')); continue; }
    const copy = countCopy(value);
    if (field === 'title') title = copy; else subtitle = copy;
    if (required && !copy.count) errors.push(issue('title-required', '请填写主标题。', 'content'));
    if (copy.count > max) errors.push(issue(`${field}-too-long`, `${field === 'title' ? '主标题' : '副标题'}最多${max}字，当前${copy.count}字。`, 'user-copy-and-no-qr'));
    if (copy.text.split('\n').length > 2) errors.push(issue(`${field}-too-many-lines`, '候选模板最多两行；请减少手动换行。', 'proposal-v1'));
  }
  if ((input.qrEnabled !== undefined && input.qrEnabled !== false) || (input.qr !== undefined && input.qr !== null)) errors.push(issue('qr-forbidden', '极端尺寸不使用二维码；关闭二维码且不预留二维码区域。', 'user-copy-and-no-qr'));
  const variant = input.brandVariant ?? (orientation && rules.brand.defaultVariant[orientation]);
  if (orientation && !rules.brand.variants[orientation].includes(variant)) errors.push(issue('brand-variant', '品牌柱排列与画布方向不匹配。', 'brand.variants'));
  const placement = input.informationPlacement ?? (orientation && rules.placement.defaultInformation[orientation]);
  const allowedPlacement = orientation === 'landscape' ? rules.placement.landscapeInformation : rules.placement.portraitInformation;
  if (orientation && !allowedPlacement.includes(placement)) errors.push(issue('information-placement', '信息区位置与画布方向不匹配。', 'placement'));
  const partners = input.partners ?? [];
  if (!Array.isArray(partners) || partners.length > 2) errors.push(issue('partner-count', '联合标识最多支持两个合作方。', 'common-shared'));
  else for (const p of partners) {
    if (!p || typeof p !== 'object' || typeof p.assetId !== 'string' || !p.assetId || !finitePositive(p.visibleAspect) || !Number.isFinite(p.heightInBrandUnits) || p.heightInBrandUnits < .8 || p.heightInBrandUnits > 1.2 || Object.keys(p).some(k => !['assetId', 'visibleAspect', 'heightInBrandUnits'].includes(k))) errors.push(issue('partner-metadata', '合作方需要有效资产ID、可见宽高比和0.8D～1.2D高度。', 'common-shared'));
  }
  return { valid: !errors.length, errors, warnings, normalized: { canvas: clone(canvas ?? {}), preset: input.preset, title: title.text, subtitle: subtitle.text, counts: { title: title.count, subtitle: subtitle.count }, structure: 'brand-pillar', orientation, brandVariant: variant, informationPlacement: placement, qrEnabled: false, qr: null, partners: Array.isArray(partners) ? clone(partners) : [] } };
}

export function resolveConstraints(input, rules, common) {
  assertRules(rules, common);
  const v = validateRequest(input, rules);
  if (!v.valid) return { ok: false, issues: v.errors, previewCandidate: false };
  const n = v.normalized, { width: W, height: C, unit } = n.canvas;
  const B = Math.min(W, C), D = B * rules.canvas.profiles[n.orientation].logoHeightShortEdgeFactor;
  const m = common.marginInBrandUnits * D, epsilon = B * .000001, preset = rules.layouts[n.preset];
  const full = bounds(0, 0, W, C);
  let information = full, image = full;
  if (preset.mode === 'split') {
    const f = preset.informationFraction;
    if (n.orientation === 'landscape') {
      information = bounds(n.informationPlacement === 'left' ? 0 : W * (1 - f), 0, W * f, C);
      image = bounds(n.informationPlacement === 'left' ? W * f : 0, 0, W * (1 - f), C);
    } else {
      information = bounds(0, n.informationPlacement === 'top' ? 0 : C * (1 - f), W, C * f);
      image = bounds(0, n.informationPlacement === 'top' ? C * f : 0, W, C * (1 - f));
    }
  }
  const j = common.jointBrand;
  const partnerSpecs = n.partners.map(p => ({ ...p, width: p.visibleAspect * p.heightInBrandUnits * D, height: p.heightInBrandUnits * D }));
  const groupH = Math.max(D, ...partnerSpecs.map(p => p.height));
  const groupW = common.logoVisibleAspect * D + partnerSpecs.reduce((s, p) => s + (j.gapBeforeSeparatorInBrandUnits + j.separatorWidthInBrandUnits + j.gapAfterSeparatorInBrandUnits) * D + p.width, 0);
  const sloganH = D * Math.max(rules.brand.slogan.defaultHeightInBrandUnits, common.minSloganHeightInBrandUnits);
  const sloganW = sloganH * common.sloganVisibleAspect;
  let group, slogan;
  if (n.orientation === 'landscape') {
    group = bounds(m, m, groupW, groupH);
    slogan = n.brandVariant === 'horizontal' ? bounds(W - m - sloganW, m + (groupH - sloganH) / 2, sloganW, sloganH) : bounds(m, C - m - sloganH, sloganW, sloganH);
  } else {
    group = bounds((W - groupW) / 2, n.brandVariant === 'logo-top' ? m : C - m - groupH, groupW, groupH);
    slogan = bounds((W - sloganW) / 2, n.brandVariant === 'logo-top' ? C - m - sloganH : m, sloganW, sloganH);
  }
  const children = [{ id: 'brand_logo', role: 'logo', assetId: 'didi.chuxing.logo.horizontal.reverse', bounds: bounds(group.x, group.y + (groupH - D) / 2, common.logoVisibleAspect * D, D) }];
  let cursor = group.x + common.logoVisibleAspect * D;
  partnerSpecs.forEach((p, index) => {
    cursor += j.gapBeforeSeparatorInBrandUnits * D;
    children.push({ id: `brand_separator_${index + 1}`, role: 'separator', assetId: j.separatorAssetId, x: cursor, reservedWidth: j.separatorWidthInBrandUnits * D, groupCenterY: group.y + groupH / 2, status: 'requires-approved-asset-and-visible-bounds' });
    cursor += (j.separatorWidthInBrandUnits + j.gapAfterSeparatorInBrandUnits) * D;
    children.push({ id: `brand_partner_${index + 1}`, role: 'partner', assetId: p.assetId, bounds: bounds(cursor, group.y + (groupH - p.height) / 2, p.width, p.height) });
    cursor += p.width;
  });
  const safeCanvas = bounds(m, m, W - 2 * m, C - 2 * m);
  const x = Math.max(information.x + m, m), right = Math.min(information.x + information.width - m, W - m);
  let top = Math.max(information.y + m, m), bottom = Math.min(information.y + information.height - m, C - m);
  const initialTextArea = bounds(x, top, right - x, bottom - top);
  for (const brand of [group, slogan]) if (intersect(initialTextArea, brand)) {
    if (brand.y + brand.height / 2 <= information.y + information.height / 2) top = Math.max(top, brand.y + brand.height + D);
    else bottom = Math.min(bottom, brand.y - D);
  }
  const textArea = bounds(x, top, right - x, bottom - top);
  const t = common.typography, k = B / t.referenceShortEdge, scale = Math.min(k, Math.max(0, textArea.width) / t.referenceTextWidth);
  const textComponents = {};
  for (const [field, key] of [['title', 'headline'], ['subtitle', 'subtitle']]) {
    const f = t[key], em = f.referenceEm * scale;
    textComponents[field] = { text: n[field], count: n.counts[field], assetId: f.assetId, fontSize: em, lineAdvance: em * f.lineAdvanceEm, trackingEm: f.trackingEm, maxLines: f.maxLines, maxGraphemes: field === 'title' ? 10 : 16, status: 'candidate', boundsRequirement: 'must fit textArea using actual font metrics' };
  }
  const errors = [], reviews = [
    issue('typography-candidate', '字号、行距、字距、文本起点和计数口径仍为候选配置，不是PDF原文。', 'proposal-v1', 'review'),
    issue('actual-font-measurement-required', '本模块只计算约束；真实字体测量和渲染结果需要交给布局器核验。', 'typography', 'review'),
    issue('asset-and-crop-review', '需核对素材可用范围、标识配色与图片主体裁切。', 'appearance', 'review'),
    issue('approved-palette-required', '信息区颜色从已批准品牌色配置读取；本包未决定#FF6400/#FF6600冲突。', 'common-shared', 'review')
  ];
  if (!rectValid(safeCanvas) || !rectValid(textArea)) errors.push(issue('text-region-empty', '品牌区域和安全边距占用后没有可用文字区域。', 'brand'));
  if (!contains(safeCanvas, group, epsilon)) errors.push(issue('brand-group-overflow', '整个标识组无法满足共用边距；请换合规合作方资产或转人工，不能压缩间距。', 'common-shared'));
  if (!contains(safeCanvas, slogan, epsilon)) errors.push(issue('slogan-overflow', '识别口号无法满足共用边距。', 'brand'));
  if (intersect(group, slogan, epsilon)) errors.push(issue('brand-collision', '联合标识与口号重叠。', 'brand'));
  if (partnerSpecs.length) reviews.push(issue('joint-assets-required', '合作方及联乘符号必须来自已批准资产；当前包没有附带这些二进制文件。', 'common-shared', 'review'));
  return {
    ok: !errors.length, previewCandidate: !errors.length, productionReady: false,
    rule: { id: rules.id, version: rules.version, status: rules.status, commonVersion: common.version },
    request: n, canvas: { width: W, height: C, unit, shortEdge: B },
    regions: { information, image, mode: preset.mode },
    brand: { unit: D, margin: m, unitMeaning: 'visible DiDi smile emblem height', logoSizeStatus: 'spec-recommended-profile', group, children, slogan: { id: 'brand_slogan', role: 'slogan', assetId: 'didi.chuxing.slogan.single-line.reverse', bounds: slogan }, safeCanvas },
    textArea, typography: { scale, baseScale: k, status: 'candidate', titleSubtitleGap: n.subtitle ? t.referenceTitleSubtitleGap * k : 0, ...textComponents },
    qr: null, qrReservedSpace: 0, appearance: clone(rules.appearance),
    optionalIndependentBrandZone: { enabled: false, referenceSize: n.orientation === 'landscape' ? W / 6 : C / 6, note: '独立识别区与图文区域不同；当前未启用该结构。' },
    issues: [...errors, ...reviews]
  };
}

/** Audit structured render metadata. This does not inspect raster pixels. */
export function auditRenderedLayout(plan, rendered) {
  const rows = [];
  const add = (id, status, message, evidence) => rows.push({ id, status, message, evidence });
  if (!plan?.ok) return { passed: false, productionReady: false, results: [{ id: 'plan', status: 'fail', message: '请先解决需求或几何约束错误。' }] };
  if (!rendered || typeof rendered !== 'object' || !Array.isArray(rendered.components)) return { passed: false, productionReady: false, results: [{ id: 'render-metadata', status: 'fail', message: '缺少结构化渲染数据，不能审核。' }] };
  const { width: W, height: C, unit, shortEdge: B } = plan.canvas, e = B * .000001;
  const actualCanvas = rendered.canvas;
  const sameCanvas = actualCanvas && actualCanvas.unit === unit && close(actualCanvas.width, W, e) && close(actualCanvas.height, C, e);
  add('canvas', sameCanvas ? 'pass' : 'fail', '实际画布须与需求的成品宽高及单位一致。', actualCanvas ?? null);
  const cs = rendered.components, ids = new Set();
  const qrComponents = cs.filter(c => /qr|qrcode|qr-code|二维码/i.test(String(c?.role ?? '') + ' ' + String(c?.id ?? '')));
  add('no-qr', !qrComponents.length && (rendered.qrReservedSpace ?? 0) === 0 ? 'pass' : 'fail', '不得包含二维码、二维码说明或预留区。', qrComponents.map(c => c.id));
  const safe = plan.brand.safeCanvas;
  for (const c of cs) {
    if (!c || typeof c.id !== 'string' || ids.has(c.id)) { add('component-identity', 'fail', '组件需要唯一ID。', c?.id ?? null); continue; }
    ids.add(c.id);
    if (['background', 'photo', 'information-background'].includes(c.role)) continue;
    if (!rectValid(c.bounds)) { add(`${c.id}-bounds`, 'fail', '缺少有效的可见内容边界。', c.bounds ?? null); continue; }
    add(`${c.id}-safe-margin`, contains(safe, c.bounds, e) ? 'pass' : 'fail', '可见内容边界须在统一版心内。', { bounds: c.bounds, safeCanvas: safe });
  }
  for (const expected of [...plan.brand.children.filter(c => c.bounds), plan.brand.slogan]) {
    const c = cs.find(v => v?.id === expected.id);
    const matches = c && c.assetId === expected.assetId && rectValid(c.bounds) && ['x', 'y', 'width', 'height'].every(k => close(c.bounds[k], expected.bounds[k], e));
    add(expected.id, matches ? 'pass' : 'fail', '品牌组件应使用计划中的资产与可见边界；联合组使用整组安全边距。', c ?? null);
  }
  if (plan.request.partners.length) {
    for (const separator of plan.brand.children.filter(c => c.role === 'separator')) {
      const c = cs.find(v => v?.id === separator.id);
      const valid = c && c.role === 'separator' && c.assetApproved === true && typeof c.assetId === 'string' && !!c.assetId && rectValid(c.bounds) && close(c.bounds.x, separator.x, e) && close(c.bounds.width, separator.reservedWidth, e) && close(c.bounds.y + c.bounds.height / 2, separator.groupCenterY, e) && contains(plan.brand.group, c.bounds, e);
      add(separator.id, valid ? 'pass' : 'fail', '联乘符号需有已批准资产，宽度0.55D，保持规定间距。', c ?? null);
    }
  }
  const title = cs.find(c => c?.role === 'headline'), subtitle = cs.find(c => c?.role === 'subtitle');
  for (const [key, actual, expected] of [['title', title, plan.typography.title], ['subtitle', subtitle, plan.typography.subtitle]]) {
    if (!expected.text) { add(key, !actual ? 'pass' : 'fail', '空副标题不保留文本框或间距。', actual ?? null); continue; }
    if (!actual || !rectValid(actual.bounds)) { add(key, 'fail', '缺少对应文字组件及可见边界。', null); continue; }
    let sameCopy = false;
    try { const copy = countCopy(actual.text); sameCopy = copy.text === expected.text && copy.count <= expected.maxGraphemes; } catch {}
    add(`${key}-copy`, sameCopy ? 'pass' : 'fail', '渲染文字必须与已确认文案一致并满足字数限制。', actual.text ?? null);
    add(`${key}-region`, contains(plan.textArea, actual.bounds, e) ? 'pass' : 'fail', '文字不得超出可用文本区。', actual.bounds);
    const m = actual.metrics;
    const real = m?.mode === 'actual-font' && m.missingGlyphs === 0 && m.assetId === expected.assetId && Number.isInteger(m.lineCount) && m.lineCount >= 1 && Number.isFinite(m.maxLineWidth) && m.maxLineWidth >= 0;
    const style = real && m.lineCount <= expected.maxLines && m.maxLineWidth <= plan.textArea.width + e && close(actual.fontSize, expected.fontSize, e) && close(actual.lineAdvance, expected.lineAdvance, e) && close(actual.trackingEm, expected.trackingEm, .000001);
    add(`${key}-font-and-capacity`, !real ? 'review' : style ? 'pass' : 'fail', !real ? '缺少真实字体的测量、行数、缺字与样式数据。' : '按模板固定字号、行距、字距核验；文案变化不触发缩字。', m ?? null);
  }
  if (title && subtitle && rectValid(title.bounds) && rectValid(subtitle.bounds)) {
    const gap = subtitle.bounds.y - title.bounds.y - title.bounds.height;
    // Gap is measured between renderer logical boxes; visible glyph bearings may differ.
    const actualGap = rendered.textLogicalGap;
    add('title-subtitle-gap', Number.isFinite(actualGap) ? close(actualGap, plan.typography.titleSubtitleGap, e) ? 'pass' : 'fail' : 'review', '候选间隔用逻辑框测量；不能把字形包围框间隔冒充逻辑间隔。', { logicalGap: actualGap ?? null, visibleGap: gap });
  }
  const foreground = cs.filter(c => c && !['background', 'photo', 'information-background'].includes(c.role) && rectValid(c.bounds));
  for (let i = 0; i < foreground.length; i++) for (let j = i + 1; j < foreground.length; j++) {
    if (intersect(foreground[i].bounds, foreground[j].bounds, e)) add('component-collision', 'fail', '前景组件发生重叠。', [foreground[i].id, foreground[j].id]);
  }
  for (const text of [title, subtitle].filter(c => c && rectValid(c.bounds))) for (const b of [plan.brand.group, plan.brand.slogan.bounds]) {
    const protection = bounds(b.x - plan.brand.unit, b.y - plan.brand.unit, b.width + 2 * plan.brand.unit, b.height + 2 * plan.brand.unit);
    if (intersect(text.bounds, protection, e)) add('brand-protection', 'fail', '文字进入品牌组件的1D保护区。', text.id);
  }
  add('visual-and-assets', 'review', '结构化数据不能证明图片主体、品牌配色、资产授权及实际视觉效果已通过检查。', null);
  return { passed: rows.every(r => r.status === 'pass'), geometryPassed: !rows.some(r => r.status === 'fail'), productionReady: false, results: rows };
}
