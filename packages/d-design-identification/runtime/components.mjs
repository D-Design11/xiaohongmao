/** Pure compatibility views. Shared numeric values live only in common.json. */
const clone = value => JSON.parse(JSON.stringify(value));
function asset(assets, id) {
  const found = assets.assets.find(a => a.asset_id === id);
  if (!found) throw new Error(`缺少资产索引：${id}`);
  return found;
}

export function materializeRegularRules(regular, common, assets) {
  if (common.id !== 'd-design-common-identification') throw new Error('共用组件ID不正确。');
  const r = clone(regular), b = r.brand;
  const logo = asset(assets, common.logoAssetId), slogan = asset(assets, common.sloganAssetId);
  b.safe_margin_H = common.marginInBrandUnits;
  b.safe_margin_source = common.marginSource;
  b.visible_logo_aspect = logo.metadata.visible_aspect_ratio;
  const vb = logo.metadata.visible_bounds_px;
  b.visible_logo_bounds_reference_px = [vb.left, vb.top, vb.right, vb.bottom];
  b.logo_file_dimensions_reference_px = [logo.metadata.canvas_px.width, logo.metadata.canvas_px.height];
  b.slogan = {
    min_height_H: common.minSloganHeightInBrandUnits,
    default_height_H: common.defaultSloganHeightInBrandUnits,
    height_source: common.sloganHeightSource,
    visible_aspect: slogan.metadata.visible_aspect_ratio,
    bounds_convention: common.sloganBoundsConvention,
    bounds_convention_status: common.sloganBoundsStatus,
    draw_mode: 'approved-asset-only'
  };
  b.image_treatment = common.imageTreatment;
  b.information_color = {
    candidate: common.informationColor.regularPreviewCandidate,
    raster_sample: common.informationColor.observedRasterValue,
    status: 'verify-approved-brand-color'
  };
  r.units.reference_short_edge = common.typography.referenceShortEdge;
  r.joint_brand = clone(common.jointBrand);
  r.title_line_break_policy = clone(common.semanticTitleLineBreak);
  for (const [field, key] of [['title', 'headline'], ['subtitle', 'subtitle']]) {
    const c = common.typography[key], item = r.M.text[field];
    const a = asset(assets, c.assetId);
    item[field === 'title' ? 'family_candidate' : 'family'] = a.metadata.family_names[0];
    item.postscript = a.metadata.postscript_name;
    item.reference_em = c.referenceEm;
    item.reference_line_advance = c.referenceEm * c.lineAdvanceEm;
    item.tracking_em = c.trackingEm;
  }
  r.M.text.counting = clone(common.textCounting);
  r.M.text.title_subtitle_gap_reference = common.typography.referenceTitleSubtitleGap;
  return r;
}

export function materializeExtremeCommon(common, extreme, assets) {
  if (common.id !== 'd-design-common-identification') throw new Error('共用组件ID不正确。');
  const t = clone(common.typography), j = common.jointBrand;
  // The old resolver takes a snapshot-shaped object. This is a derived view,
  // never another maintained snapshot or an independent source of numbers.
  t.referenceTextWidth = extreme.typography.referenceTextWidth;
  t.headline.maxLines = extreme.typography.headlineMaxLines;
  t.subtitle.maxLines = extreme.typography.subtitleMaxLines;
  return {
    id: 'd-design-common-identification-snapshot', version: common.version,
    status: common.status, marginInBrandUnits: common.marginInBrandUnits,
    logoVisibleAspect: asset(assets, common.logoAssetId).metadata.visible_aspect_ratio,
    sloganVisibleAspect: asset(assets, common.sloganAssetId).metadata.visible_aspect_ratio,
    minSloganHeightInBrandUnits: common.minSloganHeightInBrandUnits,
    typography: t,
    jointBrand: {
      maxPartners: Math.max(...j.partner_counts), partnerHeightRange: clone(j.partner_height_H_range),
      separatorWidthInBrandUnits: j.separator_width_H,
      gapBeforeSeparatorInBrandUnits: j.gap_before_separator_H,
      gapAfterSeparatorInBrandUnits: j.gap_after_separator_H,
      separatorAssetId: null, partnerOrder: 'user-confirmed', preserveAspect: j.preserve_aspect
    },
    informationColor: clone(common.informationColor)
  };
}

export function materializeBundle({ regular, extreme, common, assets, skillText = '', provenance = {} }) {
  return {
    definitions: { regular, extreme, common, assets },
    regular: materializeRegularRules(regular, common, assets),
    rules: clone(extreme), common: materializeExtremeCommon(common, extreme, assets),
    assets, skillText, provenance
  };
}
