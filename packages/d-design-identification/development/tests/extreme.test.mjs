import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertRules, classifyCanvas, countCopy, validateRequest, resolveConstraints, auditRenderedLayout } from '../../runtime/extreme.mjs';

import { loadBundle } from '../../runtime/load-rules.mjs';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const { rules, common } = await loadBundle();
const h = await json('../examples/landscape.request.json');
const v = await json('../examples/portrait.request.json');
const cp = value => JSON.parse(JSON.stringify(value));

test('all eight preset/orientation combinations resolve without QR space', () => {
  for (const request of [h, v]) for (const preset of ['S', 'M', 'L', 'XL']) {
    const p = resolveConstraints({ ...request, preset }, rules, common);
    assert.equal(p.ok, true, JSON.stringify(p.issues));
    assert.equal(p.productionReady, false);
    assert.equal(p.qr, null); assert.equal(p.qrReservedSpace, 0);
    assert.ok(p.textArea.width > 0 && p.textArea.height > 0);
    if (preset === 'XL') assert.equal(p.regions.image.width * p.regions.image.height, request.canvas.width * request.canvas.height);
    else assert.ok(Math.abs(p.regions.information.width * p.regions.information.height / (request.canvas.width * request.canvas.height) - rules.layouts[preset].informationFraction) < 1e-12);
  }
});
test('all supported brand variants and information placements work independently', () => {
  for (const request of [h, v]) {
    const orientation = request === h ? 'landscape' : 'portrait';
    const placements = orientation === 'landscape' ? ['left', 'right'] : ['top', 'bottom'];
    for (const brandVariant of rules.brand.variants[orientation]) for (const informationPlacement of placements) {
      const p = resolveConstraints({ ...request, brandVariant, informationPlacement }, rules, common);
      assert.equal(p.ok, true);
      const { group, slogan } = p.brand;
      if (orientation === 'portrait') assert.ok(Math.abs(group.x + group.width / 2 - slogan.bounds.x - slogan.bounds.width / 2) < 1e-9);
      else if (brandVariant === 'vertical') assert.equal(group.x, slogan.bounds.x);
    }
  }
});
test('10/16 limits include exact boundary and are independent of regular M 12', () => {
  for (const request of [h, v]) for (const preset of ['S', 'M', 'L', 'XL']) {
    assert.equal(validateRequest({ ...request, preset, title: '字'.repeat(10), subtitle: '文'.repeat(16) }, rules).valid, true);
    assert.equal(validateRequest({ ...request, preset, title: '字'.repeat(11) }, rules).valid, false);
    assert.equal(validateRequest({ ...request, preset, subtitle: '文'.repeat(17) }, rules).valid, false);
  }
  assert.equal(validateRequest({ ...h, title: '  \n  ' }, rules).valid, false);
});
test('counting uses normalized graphemes, retains inner punctuation and ignores newlines', () => {
  assert.equal(countCopy('  杭州\n出发  ').count, 4);
  assert.equal(countCopy('A B！').count, 4);
  assert.equal(countCopy('e\u0301').count, 1);
  assert.equal(countCopy('👨‍👩‍👧‍👦').count, 1);
  assert.throws(() => countCopy(10));
});
test('reject QR requests rather than silently allocate an invisible QR box', () => {
  for (const patch of [{ qrEnabled: true }, { qrEnabled: 'false' }, { qr: { url: 'https://example.com' } }, { qr: '' }]) assert.equal(validateRequest({ ...h, ...patch }, rules).valid, false);
  assert.equal(validateRequest({ ...h, url: 'legacy-field' }, rules).valid, false);
});
test('only fixed 6:1 and 1:6 are supported, invalid/extreme dimensions do not fall back', () => {
  for (const canvas of [{ width: 7000, height: 1000, unit: 'px' }, { width: 1000, height: 4000, unit: 'px' }, { width: 1000, height: 1000, unit: 'px' }, { width: 0, height: 1000, unit: 'px' }, { width: '6000', height: 1000, unit: 'px' }, { width: 6000, height: 1000, unit: 'pt' }]) assert.equal(validateRequest({ ...h, canvas }, rules).valid, false);
  assert.equal(classifyCanvas(h.canvas), 'extreme-supported');
  assert.equal(classifyCanvas({ width: 7000, height: 1000, unit: 'mm' }), 'extreme-unsupported');
  assert.equal(classifyCanvas({ width: 1000, height: 4000, unit: 'mm' }), 'extreme-unsupported');
  assert.equal(classifyCanvas({ width: 1920, height: 1080, unit: 'px' }), 'regular');
});
test('brands follow source ratio references and common margin, no separate extreme margin', () => {
  const ph = resolveConstraints(h, rules, common), pv = resolveConstraints(v, rules, common);
  assert.equal(ph.brand.unit, 1000 / 7); assert.equal(pv.brand.unit, 125);
  assert.equal(ph.brand.margin, ph.brand.unit * common.marginInBrandUnits);
  const larger = cp(common); larger.marginInBrandUnits = 1.1;
  const p = resolveConstraints(h, rules, larger);
  assert.equal(p.brand.margin, p.brand.unit * 1.1);
  assert.notEqual(p.brand.margin, ph.brand.margin);
});
test('copy changes do not shrink fonts; empty subtitle allocates no gap', () => {
  const a = resolveConstraints({ ...v, title: '出发' }, rules, common);
  const b = resolveConstraints({ ...v, title: '字'.repeat(10) }, rules, common);
  assert.equal(a.typography.title.fontSize, b.typography.title.fontSize);
  const c = resolveConstraints({ ...v, subtitle: '' }, rules, common);
  assert.equal(c.typography.titleSubtitleGap, 0);
  assert.equal(c.typography.subtitle.text, '');
});
test('same aspect and different target sizes scale geometry and typography proportionally', () => {
  const a = resolveConstraints(h, rules, common);
  const b = resolveConstraints({ ...h, canvas: { width: 600, height: 100, unit: 'mm' } }, rules, common);
  for (const [av, bv] of [[a.brand.margin, b.brand.margin], [a.typography.title.fontSize, b.typography.title.fontSize], [a.textArea.width, b.textArea.width]]) assert.ok(Math.abs(av / 10 - bv) < 1e-9);
});
test('joint-logo gaps stay at 0.5 + 0.55 + 0.5 D; partner order is preserved', () => {
  const p = resolveConstraints({ ...h, partners: [{ assetId: 'partner-1', visibleAspect: 1, heightInBrandUnits: 1 }, { assetId: 'partner-2', visibleAspect: 1.2, heightInBrandUnits: .8 }] }, rules, common);
  assert.equal(p.ok, true);
  const { children, unit: D } = p.brand;
  const a = children[0].bounds, s = children[1], b = children[2].bounds;
  assert.ok(Math.abs(s.x - a.x - a.width - .5 * D) < 1e-9);
  assert.ok(Math.abs(b.x - s.x - .55 * D - .5 * D) < 1e-9);
  assert.equal(children[2].assetId, 'partner-1'); assert.equal(children[4].assetId, 'partner-2');
});
test('portrait wide joint group is blocked, never squeezed into width', () => {
  const p = resolveConstraints({ ...v, partners: [{ assetId: 'partner', visibleAspect: 1, heightInBrandUnits: 1 }] }, rules, common);
  assert.equal(p.ok, false);
  assert.equal(p.brand.unit, 125);
  assert.ok(p.issues.some(i => i.code === 'brand-group-overflow'));
});
test('reject unsupported optional structures and invalid partner metadata', () => {
  assert.equal(validateRequest({ ...h, structure: 'special-lockup' }, rules).valid, false);
  assert.equal(validateRequest({ ...h, brandVariant: 'logo-top' }, rules).valid, false);
  assert.equal(validateRequest({ ...h, partners: [{ assetId: 'x', visibleAspect: 1, heightInBrandUnits: 1.3 }] }, rules).valid, false);
  assert.equal(validateRequest({ ...h, partners: [null] }, rules).valid, false);
  assert.equal(validateRequest({ ...h, partners: [{ assetId: 'a', visibleAspect: -1, heightInBrandUnits: 1 }] }, rules).valid, false);
});
test('tampered QR, caption, content limit and base safe margin cannot pass semantic checks', () => {
  for (const mutator of [r => { r.qr.reserveSpace = true; }, r => { r.qr.renderCaption = true; }, r => { r.content.headline.maxGraphemes = 14; }]) {
    const changed = cp(rules); mutator(changed); assert.throws(() => assertRules(changed, common));
  }
  const badBase = cp(common); badBase.marginInBrandUnits = .5;
  assert.throws(() => assertRules(rules, badBase));
});

function renderedCandidate(plan, { actual = false } = {}) {
  const components = [
    ...plan.brand.children.filter(c => c.bounds).map(c => ({ ...c, bounds: { ...c.bounds } })),
    { ...plan.brand.slogan, bounds: { ...plan.brand.slogan.bounds } }
  ];
  let y = plan.textArea.y;
  for (const [key, role] of [['title', 'headline'], ['subtitle', 'subtitle']]) {
    const f = plan.typography[key]; if (!f.text) continue;
    const height = f.fontSize;
    // Synthetic metadata fixture checks auditor behavior; it is not a real-font visual acceptance test.
    components.push({ id: key, role, text: f.text, bounds: { x: plan.textArea.x, y, width: f.fontSize * f.count, height }, fontSize: f.fontSize, lineAdvance: f.lineAdvance, trackingEm: f.trackingEm, metrics: { mode: actual ? 'actual-font' : 'estimated', assetId: f.assetId, missingGlyphs: 0, lineCount: 1, maxLineWidth: f.fontSize * f.count } });
    y += height + plan.typography.titleSubtitleGap;
  }
  return { canvas: plan.canvas, components, qrReservedSpace: 0, textLogicalGap: plan.typography.titleSubtitleGap };
}
test('missing or estimated render measurements never produce a complete pass', () => {
  const p = resolveConstraints(h, rules, common);
  assert.equal(auditRenderedLayout(p, null).passed, false);
  const a = auditRenderedLayout(p, renderedCandidate(p));
  assert.equal(a.passed, false); assert.equal(a.productionReady, false);
  assert.ok(a.results.some(r => r.id === 'title-font-and-capacity' && r.status === 'review'));
});
test('audit catches QR caption, modified copy, incorrect font size and outside bounds', () => {
  const p = resolveConstraints(h, rules, common);
  const r = renderedCandidate(p, { actual: true });
  r.components.push({ id: 'qr_caption', role: 'qr-caption', bounds: { x: 100, y: 100, width: 10, height: 10 } });
  const title = r.components.find(c => c.role === 'headline');
  title.text = '字'.repeat(11); title.fontSize /= 2; title.bounds.x = -1;
  const a = auditRenderedLayout(p, r);
  for (const id of ['no-qr', 'title-copy', 'title-font-and-capacity', 'title-safe-margin', 'title-region']) assert.ok(a.results.some(row => row.id === id && row.status === 'fail'), id);
});
test('audit detects wrong output size, asset substitution, omitted brand and overlap', () => {
  const p = resolveConstraints(h, rules, common), r = renderedCandidate(p, { actual: true });
  r.canvas = { ...r.canvas, width: 7000 };
  r.components.find(c => c.role === 'logo').assetId = 'unapproved-logo';
  r.components = r.components.filter(c => c.role !== 'slogan');
  const title = r.components.find(c => c.role === 'headline'), subtitle = r.components.find(c => c.role === 'subtitle');
  subtitle.bounds = { ...title.bounds };
  const a = auditRenderedLayout(p, r);
  for (const id of ['canvas', 'brand_logo', 'brand_slogan', 'component-collision']) assert.ok(a.results.some(row => row.id === id && row.status === 'fail'), id);
});
