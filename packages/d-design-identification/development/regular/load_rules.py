"""Project common components into the original regular development-check API."""
import copy
import json


def load_regular_rules(root):
    def read(name):
        return json.loads((root / name).read_text(encoding='utf-8'))
    r, c, assets = read('rules/regular.json'), read('rules/common.json'), read('references/asset-bindings.json')
    assets = {a['asset_id']: a for a in assets['assets']}
    b, logo, slogan = r['brand'], assets[c['logoAssetId']], assets[c['sloganAssetId']]
    b['safe_margin_H'], b['safe_margin_source'] = c['marginInBrandUnits'], c['marginSource']
    b['visible_logo_aspect'] = logo['metadata']['visible_aspect_ratio']
    vb = logo['metadata']['visible_bounds_px']
    b['visible_logo_bounds_reference_px'] = [vb[k] for k in ['left', 'top', 'right', 'bottom']]
    b['logo_file_dimensions_reference_px'] = [logo['metadata']['canvas_px'][k] for k in ['width', 'height']]
    b['slogan'] = dict(min_height_H=c['minSloganHeightInBrandUnits'], default_height_H=c['defaultSloganHeightInBrandUnits'],
        height_source=c['sloganHeightSource'], visible_aspect=slogan['metadata']['visible_aspect_ratio'],
        bounds_convention=c['sloganBoundsConvention'], bounds_convention_status=c['sloganBoundsStatus'], draw_mode='approved-asset-only')
    b['image_treatment'] = c['imageTreatment']
    b['information_color'] = dict(candidate=c['informationColor']['regularPreviewCandidate'],
        raster_sample=c['informationColor']['observedRasterValue'], status='verify-approved-brand-color')
    r['units']['reference_short_edge'] = c['typography']['referenceShortEdge']
    r['joint_brand'] = copy.deepcopy(c['jointBrand'])
    r['title_line_break_policy'] = copy.deepcopy(c['semanticTitleLineBreak'])
    for field, key in [('title', 'headline'), ('subtitle', 'subtitle')]:
        item, t = r['M']['text'][field], c['typography'][key]
        a = assets[t['assetId']]
        item['family_candidate' if field == 'title' else 'family'] = a['metadata']['family_names'][0]
        item['postscript'] = a['metadata']['postscript_name']
        item['reference_em'] = t['referenceEm']
        item['reference_line_advance'] = t['referenceEm'] * t['lineAdvanceEm']
        item['tracking_em'] = t['trackingEm']
    r['M']['text']['counting'] = copy.deepcopy(c['textCounting'])
    r['M']['text']['title_subtitle_gap_reference'] = c['typography']['referenceTitleSubtitleGap']
    return r
