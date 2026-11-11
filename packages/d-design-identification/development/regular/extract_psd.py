"""Read PSD v1 layer records and text metadata without modifying the source.

This is a limited metadata reader, not a general PSD renderer. Text run sizes
are retained along with transforms; layer names are not used as actual copy.
"""
import argparse
import json
import math
import struct
from pathlib import Path


class Reader:
    def __init__(self, data):
        self.d, self.p = data, 0

    def take(self, n):
        v = self.d[self.p:self.p+n]
        if len(v) != n:
            raise ValueError("Truncated PSD structure")
        self.p += n
        return v

    def num(self, fmt):
        return struct.unpack('>' + fmt, self.take(struct.calcsize('>' + fmt)))[0]

    def unicode(self):
        return self.take(self.num('I') * 2).decode('utf-16-be', errors='replace').rstrip('\0')

    def key(self):
        n = self.num('I')
        return self.take(n or 4).decode('latin1')

    def descriptor(self):
        name, cls = self.unicode(), self.key()
        fields = {}
        for _ in range(self.num('I')):
            key, typ = self.key(), self.take(4).decode('ascii')
            fields[key] = self.value(typ)
        return {'class': cls, 'name': name, 'fields': fields}

    def value(self, typ):
        if typ in ('Objc', 'GlbO'):
            return self.descriptor()
        if typ == 'TEXT':
            return self.unicode()
        if typ == 'enum':
            return {'type': self.key(), 'value': self.key()}
        if typ == 'doub':
            return self.num('d')
        if typ == 'UntF':
            return {'unit': self.take(4).decode('ascii'), 'value': self.num('d')}
        if typ == 'long':
            return self.num('i')
        if typ == 'comp':
            return self.num('q')
        if typ == 'bool':
            return bool(self.num('B'))
        if typ in ('tdta', 'alis'):
            return self.take(self.num('I'))
        if typ == 'VlLs':
            return [self.value(self.take(4).decode('ascii')) for _ in range(self.num('I'))]
        if typ in ('type', 'GlbC'):
            return {'name': self.unicode(), 'class': self.key()}
        raise ValueError('Unsupported descriptor type ' + typ)


class EngineReader:
    def __init__(self, data):
        self.d, self.p = data, 0

    def space(self):
        while self.p < len(self.d) and self.d[self.p] in b' \r\n\t\0':
            self.p += 1

    def read(self):
        self.space()
        if self.d[self.p:self.p+2] == b'<<':
            self.p += 2
            result = {}
            while True:
                self.space()
                if self.d[self.p:self.p+2] == b'>>':
                    self.p += 2
                    return result
                k = self.read()
                result[k] = self.read()
        c = self.d[self.p]
        if c == ord('['):
            self.p += 1
            result = []
            while True:
                self.space()
                if self.d[self.p] == ord(']'):
                    self.p += 1
                    return result
                result.append(self.read())
        if c == ord('('):
            self.p += 1
            result, depth = bytearray(), 1
            while depth:
                c = self.d[self.p]
                self.p += 1
                if c == 92:
                    c = self.d[self.p]
                    self.p += 1
                    escapes = {110: 10, 114: 13, 116: 9, 98: 8, 102: 12}
                    if c in b'01234567':
                        octal = bytes([c])
                        for _ in range(2):
                            if self.d[self.p] in b'01234567':
                                octal += bytes([self.d[self.p]])
                                self.p += 1
                            else:
                                break
                        result.append(int(octal, 8))
                    else:
                        result.append(escapes.get(c, c))
                elif c == 40:
                    depth += 1
                    result.append(c)
                elif c == 41:
                    depth -= 1
                    if depth:
                        result.append(c)
                else:
                    result.append(c)
            b = bytes(result)
            return b.decode('utf-16') if b.startswith((b'\xfe\xff', b'\xff\xfe')) else b.decode('latin1')
        start = self.p
        if c == ord('/'):
            self.p += 1
            start += 1
        while self.p < len(self.d) and self.d[self.p] not in b' \r\n\t\0[]<>()/':
            self.p += 1
        if self.p == start:
            raise ValueError('Unexpected engine token at ' + str(self.p))
        token = self.d[start:self.p].decode('ascii')
        if c == ord('/'):
            return token
        if token in ('true', 'false'):
            return token == 'true'
        try:
            return float(token) if '.' in token else int(token)
        except ValueError:
            return token


def clean_descriptor(x):
    if isinstance(x, bytes):
        return {'raw_byte_length': len(x)}
    if isinstance(x, dict):
        return {k: clean_descriptor(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean_descriptor(v) for v in x]
    return x


def parse(path):
    data = path.read_bytes()
    r = Reader(data)
    assert r.take(4) == b'8BPS' and r.num('H') == 1
    r.take(6)
    channels, height, width, depth, mode = [r.num(f) for f in ('H', 'I', 'I', 'H', 'H')]
    r.take(r.num('I'))
    resources = Reader(r.take(r.num('I')))
    resolution = None
    while resources.p + 12 <= len(resources.d):
        assert resources.take(4) == b'8BIM'
        rid = resources.num('H')
        name_length = resources.num('B')
        resources.take(name_length)
        if (name_length + 1) % 2:
            resources.take(1)
        n = resources.num('I')
        payload = resources.take(n)
        if n % 2:
            resources.take(1)
        if rid == 1005:
            hr, hu, wu, vr, vu, htu = struct.unpack('>IHHIHH', payload)
            resolution = {'horizontal_ppi': hr / 65536, 'vertical_ppi': vr / 65536}
    r.num('I')
    layer_info_length = r.num('I')
    count = abs(r.num('h'))
    layers = []
    for i in range(count):
        top, left, bottom, right = [r.num('i') for _ in range(4)]
        ch = r.num('H')
        r.take(ch * 6)
        blend = r.take(12)
        extra = Reader(r.take(r.num('I')))
        extra.take(extra.num('I'))
        extra.take(extra.num('I'))
        n = extra.num('B')
        name = extra.take(n).decode('gb18030', errors='replace')
        extra.take((-(n + 1)) % 4)
        blocks = {}
        while extra.p + 12 <= len(extra.d):
            sig, key, size = extra.take(4), extra.take(4).decode('latin1'), extra.num('I')
            payload = extra.take(size)
            if size % 2 and extra.p < len(extra.d):
                extra.take(1)
            blocks[key] = payload
        if 'luni' in blocks:
            name = Reader(blocks['luni']).unicode()
        layer = {'index': i, 'name': name, 'visible': not bool(blend[10] & 2),
                 'bounds_px': {'x': left, 'y': top, 'width': right-left, 'height': bottom-top},
                 'block_types': list(blocks)}
        if 'TySh' in blocks:
            t = Reader(blocks['TySh'])
            ty_version = t.num('H')
            transform = [t.num('d') for _ in range(6)]
            text_version, descriptor_version = t.num('H'), t.num('I')
            desc = t.descriptor()
            engine = EngineReader(desc['fields']['EngineData']).read()
            font_set = engine.get('ResourceDict', {}).get('FontSet', [])
            style = engine['EngineDict']['StyleRun']
            lengths = style['RunLengthArray']
            runs = []
            for length, run in zip(lengths, style['RunArray']):
                props = run['StyleSheet']['StyleSheetData']
                font_index = props.get('Font')
                sy = math.hypot(transform[2], transform[3])
                sx = math.hypot(transform[0], transform[1])
                effective_size = props.get('FontSize', 0) * sy * props.get('VerticalScale', 1)
                runs.append({'length_utf16': length, 'font': font_set[font_index] if font_index is not None else None,
                             'style': props, 'effective_em_y_canvas_px': effective_size,
                             'effective_em_x_canvas_px': props.get('FontSize', 0) * sx * props.get('HorizontalScale', 1),
                             'effective_leading_y_canvas_px': props.get('Leading', 0) * sy,
                             'tracking_em': props.get('Tracking', 0) / 1000})
            layer['text'] = {'copy': desc['fields'].get('Txt '), 'transform': transform,
                             'style_runs': runs, 'descriptor': clean_descriptor(desc), 'engine': engine}
        layers.append(layer)
    return {'file': str(path), 'width_px': width, 'height_px': height,
            'resolution': resolution, 'layer_count': count, 'layers': layers,
            'limitations': ['Metadata reader supports only the encountered PSD v1 structures.',
                            'Text size combines the stored FontSize, text transform and scale; verify rendered glyphs separately.',
                            'Layer names may be stale; use the actual text descriptor copy.',
                            'Visibility inside groups and flattened export may differ.']}


if __name__ == '__main__':
    folder = Path(__file__).parent
    parser = argparse.ArgumentParser()
    parser.add_argument('--input-dir', type=Path, default=Path.home() / 'Downloads')
    parser.add_argument('--output', type=Path, default=folder.parents[1] / 'development/results/psd-measurements.json')
    args = parser.parse_args()
    results = []
    for orientation in ['横', '竖']:
        source = args.input_dir / ('双节' + orientation + '版情绪社交kv.psd')
        result = parse(source)
        results.append(result)
        brief = {'file': source.name, 'canvas': [result['width_px'], result['height_px']],
                 'resolution': result['resolution'], 'text_layers': []}
        for layer in result['layers']:
            if 'text' not in layer:
                continue
            brief['text_layers'].append({'name': layer['name'], 'visible': layer['visible'],
                'copy': layer['text']['copy'], 'bounds': layer['bounds_px'],
                'transform': layer['text']['transform'],
                'runs': [{k: v for k, v in run.items() if k not in ('style',)} | {'style': {k:v for k,v in run['style'].items() if k in ('FontSize','Leading','AutoLeading','Tracking','HorizontalScale','VerticalScale','FauxBold','AutoKerning')}} for run in layer['text']['style_runs']]})
        print(json.dumps(brief, ensure_ascii=False, indent=2))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding='utf-8')
