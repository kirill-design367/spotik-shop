#!/usr/bin/env python3
"""
Аудит шрифтового бинарника: читает таблицы cmap и fvar НАПРЯМУЮ из файла,
без доверия к описанию на сайте шрифта.

Использование:  python3 scripts/font-audit.py <file.ttf|file.woff2> [...]
"""
import struct, sys, os, io

# ---- контрольные наборы -------------------------------------------------
CYR_BASIC = [(0x0410, 0x044F)]                      # А-я
CYR_YO    = [0x0401, 0x0451]                        # Ё ё
LAT_SPOTIK = list("SPOTIK")
# буквы, которые ТЗ просит проверить на нейтральность (наличие в первую очередь)
CYR_CHECK  = list("ЖФЩЪЫЬЭЮЯжфщъыьэюя")
RU_PANGRAM = "Съешь же ещё этих мягких французских булок, да выпей чаю"

def read_font(path):
    data = open(path,'rb').read()
    if data[:4] == b'wOF2':
        import brotli
        from fontTools.ttLib import TTFont
        f = TTFont(path)
        bio = io.BytesIO(); f.flavor=None; f.save(bio); return bio.getvalue()
    return data

def tables(data):
    tag = data[:4]
    off = 0
    if tag == b'ttcf':
        off = struct.unpack('>I', data[12:16])[0]
    num = struct.unpack('>H', data[off+4:off+6])[0]
    out = {}
    for i in range(num):
        p = off + 12 + i*16
        t, cs, o, l = struct.unpack('>4sIII', data[p:p+16])
        out[t.decode('latin-1')] = (o, l)
    return out

def parse_cmap(data, off, length):
    """Возвращает set кодпоинтов из ВСЕХ юникодных подтаблиц cmap."""
    n = struct.unpack('>H', data[off+2:off+4])[0]
    cps = set()
    subs = []
    for i in range(n):
        p = off + 4 + i*8
        pid, eid, so = struct.unpack('>HHI', data[p:p+8])
        subs.append((pid, eid, off+so))
    for pid, eid, so in subs:
        fmt = struct.unpack('>H', data[so:so+2])[0]
        # только юникодные: platform 0 (Unicode) и 3/1, 3/10 (Windows UCS-2/UCS-4)
        if not (pid == 0 or (pid == 3 and eid in (1, 10))):
            continue
        if fmt == 4:
            segX2 = struct.unpack('>H', data[so+6:so+8])[0]
            seg = segX2 // 2
            base = so + 14
            ends   = struct.unpack('>%dH'%seg, data[base:base+segX2]); base += segX2 + 2
            starts = struct.unpack('>%dH'%seg, data[base:base+segX2]); base += segX2
            deltas = struct.unpack('>%dh'%seg, data[base:base+segX2]); base += segX2
            ro_off = base
            ros    = struct.unpack('>%dH'%seg, data[base:base+segX2])
            for k in range(seg):
                if starts[k] > ends[k]: continue
                for c in range(starts[k], min(ends[k], 0xFFFF)+1):
                    if ros[k] == 0:
                        g = (c + deltas[k]) & 0xFFFF
                    else:
                        gp = ro_off + k*2 + ros[k] + (c - starts[k])*2
                        if gp+2 > len(data): continue
                        g = struct.unpack('>H', data[gp:gp+2])[0]
                        if g: g = (g + deltas[k]) & 0xFFFF
                    if g: cps.add(c)
        elif fmt == 12:
            ngroups = struct.unpack('>I', data[so+12:so+16])[0]
            for k in range(ngroups):
                p = so + 16 + k*12
                s, e, gi = struct.unpack('>III', data[p:p+12])
                if e - s > 0x20000: e = s + 0x20000
                for c in range(s, e+1): cps.add(c)
        elif fmt == 6:
            first, cnt = struct.unpack('>HH', data[so+6:so+10])
            for k in range(cnt):
                g = struct.unpack('>H', data[so+10+k*2:so+12+k*2])[0]
                if g: cps.add(first+k)
    return cps

def parse_fvar(data, off):
    major, minor, axesOff, _, axisCount, axisSize, icount, isize = struct.unpack('>HHHHHHHH', data[off:off+16])
    axes = []
    for i in range(axisCount):
        p = off + axesOff + i*axisSize
        tag, mn, dflt, mx, flags, nameID = struct.unpack('>4sIIIHH', data[p:p+20])
        f2d = lambda v: struct.unpack('>i', struct.pack('>I', v))[0] / 65536.0
        axes.append((tag.decode('latin-1'), f2d(mn), f2d(dflt), f2d(mx)))
    return axes

def audit(path):
    name = os.path.basename(path)
    print("=" * 78)
    print("ФАЙЛ:", name, " (%.1f KB)" % (os.path.getsize(path)/1024))
    data = read_font(path)
    tb = tables(data)
    print("таблиц в бинарнике:", len(tb), "|", " ".join(sorted(tb)))
    if 'cmap' not in tb:
        print("  !! нет cmap"); return
    o, l = tb['cmap']
    cps = parse_cmap(data, o, l)
    print("всего кодпоинтов в cmap:", len(cps))

    have_basic = sum(1 for c in range(0x0410, 0x0450) if c in cps)
    print("  Кириллица А–я (U+0410–U+044F): %d / 64  %s" % (have_basic, "OK" if have_basic == 64 else "НЕПОЛНО"))
    yo = all(c in cps for c in CYR_YO)
    print("  Ё U+0401 / ё U+0451:", "OK" if yo else "НЕТ")
    miss = [ch for ch in CYR_CHECK if ord(ch) not in cps]
    print("  Ж Ф Щ Ъ Ы Ь Э Ю Я (+строчные):", "все есть" if not miss else "НЕТ: "+" ".join(miss))
    lat = [ch for ch in LAT_SPOTIK if ord(ch) not in cps]
    print("  Латиница S P O T I K:", "все есть" if not lat else "НЕТ: "+" ".join(lat))
    pang = [ch for ch in set(RU_PANGRAM) if ch.strip() and ord(ch) not in cps]
    print("  Русская панграмма целиком:", "OK" if not pang else "НЕТ: "+" ".join(sorted(pang)))
    ext = sum(1 for c in range(0x0450, 0x0460) if c in cps)
    print("  Кириллица расширенная U+0450–045F: %d / 16" % ext)
    # рубль
    print("  ₽ U+20BD:", "есть" if 0x20BD in cps else "нет")

    if 'fvar' in tb:
        axes = parse_fvar(data, tb['fvar'][0])
        print("  ВАРИАТИВНЫЙ. Осей: %d" % len(axes))
        for tag, mn, df, mx in axes:
            print("     %-5s %10.1f … %-10.1f (по умолчанию %.1f)" % (tag, mn, mx, df))
    else:
        print("  СТАТИЧЕСКИЙ (нет таблицы fvar)")
    return cps

if __name__ == '__main__':
    for p in sys.argv[1:]:
        try: audit(p)
        except Exception as e:
            print("ОШИБКА", p, type(e).__name__, e)
