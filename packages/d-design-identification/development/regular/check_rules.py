"""Check candidate M layouts using real supplied font advances and draw a diagram.

Not a production renderer: brand and QR rectangles in the proof are placeholders.
Run with Python 3 + Pillow. Pass --font-dir when using this package elsewhere.
"""
import argparse
import itertools
import json
import unicodedata
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / 'development/results'
RESULTS.mkdir(exist_ok=True)
from load_rules import load_regular_rules
RULES = load_regular_rules(ROOT)
FONT_DIR = None


def font(kind, size):
    filename = 'HYQiHei-65S.otf' if kind == 'title' else 'HYQiHei-50S.otf'
    return ImageFont.truetype(str(FONT_DIR / filename), max(1, round(size)))


def clean(text):
    return unicodedata.normalize('NFC', text.replace('\r\n', '\n').replace('\r', '\n')).strip()


def graphemes(text):
    # Handles combining marks and joiners in this candidate checker. A product
    # input layer should use a full Unicode grapheme segmenter, e.g. Intl.Segmenter.
    out = []
    for ch in text:
        if out and (unicodedata.combining(ch) or ch in '\ufe0e\ufe0f\u200d' or out[-1].endswith('\u200d')):
            out[-1] += ch
        else:
            out.append(ch)
    return out


def width(text, kind, em):
    return font(kind, 1000).getlength(text) * em / 1000


def rect(x, y, w, h):
    return {'x': x, 'y': y, 'width': w, 'height': h}


def bottom(r):
    return r['y'] + r['height']


def right(r):
    return r['x'] + r['width']


def inside(a, b):
    return a['x'] >= b['x'] - 1e-6 and a['y'] >= b['y'] - 1e-6 and right(a) <= right(b) + 1e-6 and bottom(a) <= bottom(b) + 1e-6


def overlap(a, b):
    return min(right(a), right(b)) - max(a['x'], b['x']) > 1e-6 and min(bottom(a), bottom(b)) - max(a['y'], b['y']) > 1e-6


def wrap(text, kind, em, available, max_lines, max_per_line=None):
    lines = []
    for paragraph in text.split('\n'):
        if not paragraph:
            raise ValueError('empty-line')
        line = ''
        for cluster in graphemes(paragraph):
            next_line = line + cluster
            full = max_per_line and len(graphemes(next_line)) > max_per_line
            if line and (full or width(next_line, kind, em) > available + 1e-6):
                lines.append(line)
                line = cluster
            else:
                line = next_line
            if width(line, kind, em) > available + 1e-6:
                raise ValueError('single-glyph-too-wide')
        lines.append(line)
    if len(lines) > max_lines:
        raise ValueError('text-overflow')
    return lines


def qr_anchor(variant, W, C, m, Q, G, title_bottom, title_gap):
    # Does not depend on M's split fraction; S/L/XL use their own title_bottom.
    anchor = variant['qr_anchor']
    if anchor == 'bottom-left-safe':
        return rect(m, C-m-G, Q, G)
    if anchor == 'bottom-right-safe':
        return rect(W-m-Q, C-m-G, Q, G)
    if anchor == 'below-title-left':
        return rect(m, title_bottom+title_gap, Q, G)
    raise ValueError('unknown-QR-anchor')


def validate_copy(preset, title, subtitle=''):
    """Shared confirmed copy caps; typography for S/L remains uncalibrated."""
    if preset not in RULES['copy_limits']:
        raise ValueError('copy-preset-not-defined')
    rule = RULES['copy_limits'][preset]
    title, subtitle = clean(title), clean(subtitle)
    n_title = len(graphemes(title.replace('\n', '')))
    n_subtitle = len(graphemes(subtitle.replace('\n', '')))
    if not n_title:
        raise ValueError('title-empty')
    if n_title > rule['title_max_graphemes']:
        raise ValueError('title-over-preset-limit')
    if n_subtitle > rule['subtitle_max_graphemes']:
        raise ValueError('subtitle-over-18')
    return title, subtitle, n_title, n_subtitle


def layout(W, C, profile_id, variant_id, title, subtitle='', caption=True, partners=()):
    title, subtitle, n_title, n_subtitle = validate_copy('M', title, subtitle)
    text_rules = RULES['M']['text']
    copy_rule = RULES['copy_limits']['M']
    if W <= 0 or C <= 0 or W == C:
        raise ValueError('unsupported-orientation-profile')
    orientation = 'landscape' if W > C else 'portrait'
    profiles = {p['id']: p for p in RULES['brand']['profiles']}
    if profile_id not in profiles or profiles[profile_id]['orientation'] != orientation:
        raise ValueError('unsupported-orientation-profile')
    variant = next((v for v in RULES['variants'] if v['id'] == variant_id), None)
    if not variant or variant['orientation'] != orientation:
        raise ValueError('variant-orientation-conflict')
    if variant['subtitle'] == 'absent' and subtitle or variant['subtitle'] == 'present' and not subtitle:
        raise ValueError('portrait-variant-conflict')
    B = min(W, C)
    k = B / RULES['units']['reference_short_edge']
    H = B / profiles[profile_id]['short_edge_denominator']
    m = H * RULES['brand']['safe_margin_H']
    T = W/2-2*m if orientation == 'landscape' else W-2*m
    if T <= 0:
        raise ValueError('no-safe-text-region')
    t = min(k, T / RULES['units']['text_capacity_reference_width'])
    Fh, Lh = text_rules['title']['reference_em']*t, text_rules['title']['reference_line_advance']*t
    Fs, Ls = text_rules['subtitle']['reference_em']*t, text_rules['subtitle']['reference_line_advance']*t
    gap = text_rules['title_subtitle_gap_reference']*k
    title_lines = wrap(title, 'title', Fh, T, text_rules['title']['max_lines'])
    subtitle_cap = copy_rule['wrap_threshold'] if 'subtitle' in copy_rule['wrap_threshold_applies_to'] else None
    subtitle_lines = wrap(subtitle, 'subtitle', Fs, T, 2, subtitle_cap) if subtitle else []
    ty = text_rules['landscape_top_reference']*k if orientation == 'landscape' else C/2+text_rules['portrait_split_to_title_reference']*k
    boxes = {'title': rect(m, ty, T, Fh+(len(title_lines)-1)*Lh)}
    if subtitle:
        boxes['subtitle'] = rect(m, bottom(boxes['title'])+gap, T, Fs+(len(subtitle_lines)-1)*Ls)
    qr_rules = RULES['qr']
    Q = qr_rules['reference_square_side']*k
    cap = qr_rules['caption']
    G = Q + (cap['reference_gap']+cap['reference_line_advance'])*k if caption else Q
    boxes['qr'] = qr_anchor(variant, W, C, m, Q, G, bottom(boxes['title']), gap)
    Hs = H*RULES['brand']['slogan']['default_height_H']
    Ws = Hs*RULES['brand']['slogan']['visible_aspect']
    slogan_anchors = {
        'top-right-safe': (W-m-Ws, m),
        'bottom-left-safe': (m, C-m-Hs),
        'bottom-right-safe': (W-m-Ws, C-m-Hs),
        'top-left-safe': (m, m),
    }
    sx, sy = slogan_anchors[variant['slogan_anchor']]
    boxes['slogan'] = rect(sx, sy, Ws, Hs)
    if len(partners) not in RULES['joint_brand']['partner_counts']:
        raise ValueError('partner-count')
    brand_w, brand_h = RULES['brand']['visible_logo_aspect']*H, H
    for partner_aspect, partner_height_H in partners:
        if not 0.8 <= partner_height_H <= 1.2 or partner_aspect <= 0:
            raise ValueError('partner-height-out-of-range')
        brand_w += 1.55*H + partner_aspect*partner_height_H*H
        brand_h = max(brand_h, partner_height_H*H)
    by = m if variant['brand_anchor'] == 'top-left-safe' else C-m-brand_h
    boxes['brand'] = rect(m, by, brand_w, brand_h)
    safe = rect(m, m, W-2*m, C-2*m)
    # Title may start closer than H to the split in the provided sample. The
    # split is an internal edge: only the outer canvas has a mandatory H inset.
    info_content = rect(m, 0, W/2-2*m, C) if orientation == 'landscape' else rect(m, C/2, W-2*m, C/2)
    problems = []
    for name, box in boxes.items():
        if not inside(box, safe):
            problems.append('safe-boundary-overflow:' + name)
        if name in ('title', 'subtitle', 'brand') and not inside(box, info_content):
            problems.append('information-region-overflow:' + name)
    for (an, a), (bn, b) in itertools.combinations(boxes.items(), 2):
        if overlap(a, b):
            problems.append('component-collision:' + an + ':' + bn)
    if problems:
        raise ValueError(';'.join(problems))
    return {'canvas': {'width': W, 'height': C}, 'profile': profile_id, 'variant': variant_id,
            'B': B, 'k': k, 't': t, 'brand_H': H, 'safe_margin': m,
            'font_title_em': Fh, 'font_subtitle_em': Fs, 'title_line_advance': Lh,
            'subtitle_line_advance': Ls, 'title_subtitle_gap': gap,
            'title': title, 'subtitle': subtitle, 'title_lines': title_lines,
            'subtitle_lines': subtitle_lines, 'title_count': n_title, 'subtitle_count': n_subtitle,
            'qr_side': Q, 'qr_group_height': G, 'caption': caption, 'boxes': boxes,
            'line_widths': {'title': [width(x, 'title', Fh) for x in title_lines],
                            'subtitle': [width(x, 'subtitle', Fs) for x in subtitle_lines]},
            'partners': list(partners), 'problems': []}


def draw_proof(results):
    im = Image.new('RGB', (1600, 1680), '#F3F3F1')
    d = ImageDraw.Draw(im)
    def text(xy, value, size=22, fill='#17191B', kind='title'):
        d.text(xy, value, font=font(kind, size), fill=fill)
    text((52, 40), 'D-Design / M 版式位置示意', 38)
    text((52, 102), '四种固定组合 · 主标题 12 字 / 副标题 18 字容量验证 · 候选参数', 23, '#66696C', 'subtitle')
    text((52, 141), '图中品牌与二维码均为位置框；不是可下载生产物料。', 18, '#787C7F', 'subtitle')
    panels = [(40,185,780,725),(820,185,1560,725),(40,755,780,1610),(820,755,1560,1610)]
    labels = [('H-A / 横版 · 二维码左下','口号右上；标识左上'),('H-B / 横版 · 二维码右下','口号左下；标识左上'),('V-A / 竖版 · 无副标题','二维码跟随标题；口号右下'),('V-B / 竖版 · 有副标题','二维码右下；口号左上')]
    for result, panel, label in zip(results, panels, labels):
        x0,y0,x1,y1=panel
        d.rounded_rectangle(panel, radius=20, fill='white', outline='#DFE1DF', width=1)
        text((x0+25,y0+20),label[0],24)
        text((x0+25,y0+58),label[1],18,'#73777B','subtitle')
        W,C=result['canvas'].values()
        scale=min((x1-x0-50)/W,(y1-y0-155)/C)
        ox=x0+(x1-x0-W*scale)/2;oy=y0+100
        def xybox(box):
            return [ox+box['x']*scale,oy+box['y']*scale,ox+right(box)*scale,oy+bottom(box)*scale]
        d.rectangle([ox,oy,ox+W*scale,oy+C*scale],fill='#DFE3E5')
        if W>C:
            d.rectangle([ox,oy,ox+W*scale/2,oy+C*scale],fill='#FF6600')
            imagecenter=(ox+3*W*scale/4,oy+C*scale/2)
        else:
            d.rectangle([ox,oy+C*scale/2,ox+W*scale,oy+C*scale],fill='#FF6600')
            imagecenter=(ox+W*scale/2,oy+C*scale/4)
        region_label='图片区域'
        f=font('subtitle',20)
        d.text((imagecenter[0]-f.getlength(region_label)/2,imagecenter[1]-10),region_label,font=f,fill='#9CA3A7')
        for name in ('brand','slogan','qr'):
            b=result['boxes'][name];rb=xybox(b)
            if name=='qr':rb[3]=rb[1]+result['qr_side']*scale
            d.rectangle(rb,fill='#FFFFFF',outline='#777D80',width=1)
            value={'brand':'标识组','slogan':'口号框','qr':'QR'}[name]
            fs=max(9,min(15,round((rb[3]-rb[1])*0.56)))
            f=font('subtitle',fs)
            d.text(((rb[0]+rb[2]-f.getlength(value))/2,(rb[1]+rb[3]-fs)/2-1),value,font=f,fill='#42474B')
            if name=='qr' and result['caption']:
                cap=RULES['qr']['caption'];fs=max(5,round(cap['reference_em']*result['k']*scale));f=font('subtitle',fs)
                tx=ox+(b['x']+b['width']/2)*scale-f.getlength(cap['text'])/2
                ty=rb[3]+cap['reference_gap']*result['k']*scale
                d.text((tx,ty),cap['text'],font=f,fill='white')
        for name,kind,em,advance in [('title','title',result['font_title_em'],result['title_line_advance']),('subtitle','subtitle',result['font_subtitle_em'],result['subtitle_line_advance'])]:
            if name not in result['boxes']:continue
            b=result['boxes'][name];f=font(kind,em*scale)
            for i,line in enumerate(result[name+'_lines']):
                ink=f.getbbox(line)
                d.text((ox+b['x']*scale-ink[0],oy+(b['y']+i*advance)*scale-ink[1]),line,font=f,fill='white')
        text((x0+25,y1-44),f"H={result['brand_H']:.2f}  ·  QR={result['qr_side']:.0f}  ·  参考短边 2126 px",16,'#73777B','subtitle')
    text((52,1632),'位置逻辑已确认；字号、间距与统一 QR 系数仍为待视觉确认的建议。',19,'#66696C','subtitle')
    im.save(RESULTS/'regular-geometry-proof.png')


def main():
    title='杭州周末出行滴滴好礼相伴'
    subtitle='滴滴打车出游专属福利开启城市惬意旅程'
    assert len(title)==12 and len(subtitle)==18
    checks=[]
    results=[]
    targets=[(3780,2126,'landscape-16-9'),(1920,1080,'landscape-16-9'),(594,420,'landscape-a-series'),(2126,3780,'portrait-9-16'),(1080,1920,'portrait-9-16'),(420,594,'portrait-a-series'),(800,1800,'portrait-rollup')]
    for W,C,profile in targets:
        variants=['H-A','H-B'] if W>C else ['V-A','V-B']
        for v in variants:
            result=layout(W,C,profile,v,title,'' if v=='V-A' else subtitle)
            results.append(result)
            checks.append({'name':f'{W}x{C}/{v}/capacity12-18','passed':True})
    proof=[results[0],results[1],results[6],results[7]]
    same=layout(3780,2126,'landscape-16-9','H-A','杭州出行','周末出发')
    checks.append({'name':'copy-change-keeps-template-font-size','passed':same['font_title_em']==results[0]['font_title_em'] and same['font_subtitle_em']==results[0]['font_subtitle_em']})
    checks.append({'name':'same-short-edge-same-QR-in-both-orientations','passed':results[0]['qr_side']==results[6]['qr_side']==280})
    for count in (1,2):
        r=layout(3780,2126,'landscape-16-9','H-A',title,subtitle,partners=[(2,1)]*count)
        checks.append({'name':f'joint-{count}-partners-wide-landscape','passed':True,'group_width':r['boxes']['brand']['width']})
    cases=[
        ('empty-title',dict(title=''), 'title-empty'),
        ('title-13',dict(title=title+'礼'),'title-over-preset-limit'),
        ('subtitle-19',dict(subtitle=subtitle+'吧'),'subtitle-over-18'),
        ('portrait-no-subtitle-variant-conflict',dict(W=2126,C=3780,profile_id='portrait-9-16',variant_id='V-A'),'portrait-variant-conflict'),
        ('portrait-subtitle-variant-conflict',dict(W=2126,C=3780,profile_id='portrait-9-16',variant_id='V-B',subtitle=''),'portrait-variant-conflict'),
        ('unknown-profile',dict(profile_id='unapproved'),'unsupported-orientation-profile'),
        ('square-profile-not-defined',dict(W=1080,C=1080),'unsupported-orientation-profile'),
        ('partner-height-1.3H',dict(partners=[(2,1.3)]),'partner-height-out-of-range'),
        ('joint-group-too-wide',dict(partners=[(10,1),(10,1)]),'overflow'),
        ('portrait-joint-overlaps-QR',dict(W=2126,C=3780,profile_id='portrait-9-16',variant_id='V-B',partners=[(2,1),(2,1)]),'component-collision'),
    ]
    for name,updates,expected in cases:
        args=dict(W=3780,C=2126,profile_id='landscape-16-9',variant_id='H-A',title=title,subtitle=subtitle)
        args.update(updates)
        try:
            layout(**args)
            checks.append({'name':name,'passed':False,'expected_error':expected})
        except ValueError as e:
            checks.append({'name':name,'passed':expected in str(e),'error':str(e)})
    # Check S/M/L caps and subtitle threshold boundaries without claiming their
    # font sizes or entire layouts are calibrated.
    for preset, rule in RULES['copy_limits'].items():
        threshold = rule['wrap_threshold']
        validate_copy(preset, '杭'*rule['title_max_graphemes'], '州'*18)
        checks.append({'name':f'{preset}/max-title-{rule["title_max_graphemes"]}-subtitle18','passed':True})
        for n,expected_lines in [(threshold,1),(threshold+1,2)]:
            lines=wrap('州'*n,'subtitle',100,1e9,rule['subtitle_max_lines'],threshold)
            checks.append({'name':f'{preset}/subtitle-{n}/threshold-{threshold}','passed':len(lines)==expected_lines})
        lines=wrap('州'*18,'subtitle',100,1e9,rule['subtitle_max_lines'],threshold)
        checks.append({'name':f'{preset}/subtitle18/line-count','passed':len(lines)==rule['subtitle_max_lines']})
        for field in ['title','subtitle']:
            try:
                validate_copy(preset,'杭'*(rule['title_max_graphemes']+1) if field=='title' else '杭州','州'*19 if field=='subtitle' else '')
                checks.append({'name':f'{preset}/{field}-over-limit','passed':False})
            except ValueError as e:
                checks.append({'name':f'{preset}/{field}-over-limit','passed':str(e)==('title-over-preset-limit' if field=='title' else 'subtitle-over-18')})
    # M subtitle stays one line at 10, and wraps at 11.
    for W,C,profile in targets:
        v='H-A' if W>C else 'V-B'
        for n, expected in [(10,1),(11,2)]:
            result=layout(W,C,profile,v,'杭州周末','州'*n)
            checks.append({'name':f'{W}x{C}/M-subtitle{n}/lines{expected}','passed':len(result['subtitle_lines'])==expected})
    # Shared QR function needs a template's actual title bottom, not M geometry.
    for preset in RULES['qr']['applies_to']:
        for v in RULES['variants']:
            W,C=(3780,2126) if v['orientation']=='landscape' else (2126,3780)
            r=qr_anchor(v,W,C,100,280,338,2200,112)
            expected_y=2312 if v['id']=='V-A' else C-100-338
            checks.append({'name':f'{preset}/{v["id"]}/shared-QR-position-logic-only','passed':r['y']==expected_y})
    report={'status':'passed' if all(c['passed'] for c in checks) else 'failed','check_count':len(checks),
        'passed_count':sum(c['passed'] for c in checks),'checks':checks,'M_layouts':results,
        'font_files':{k:str(FONT_DIR/k) for k in ['HYQiHei-65S.otf','HYQiHei-50S.otf']},
        'limitations':['Candidate geometry and supplied-font advance measurements only; not brand approval.',
            'Proof uses placeholders for approved logos, slogan, partner assets and QR.',
            'No real QR payload, scan test, browser render or print-production test.',
            'The source PSDs and candidate text fonts differ in portrait; replacement remains subject to visual review.',
            'Shared QR checks for S/L/XL do not validate their entire layouts or typography.',
            'Grapheme helper covers this sample; product implementation needs full Unicode segmentation and glyph coverage validation.']}
    (RESULTS/'regular-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    draw_proof(proof)
    print(json.dumps({'status':report['status'],'checks':len(checks),'passed':report['passed_count'],'failed':[c for c in checks if not c['passed']]},ensure_ascii=False))
    if report['status']!='passed':raise SystemExit(1)


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    default=None
    parser.add_argument('--font-dir',type=Path,required=True)
    args=parser.parse_args()
    FONT_DIR=args.font_dir
    main()
