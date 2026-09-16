#!/usr/bin/env python3
"""
ПРОВЕРКА СОВПАДЕНИЯ ТОПОЛОГИИ КОНТУРОВ.

Морф точка-в-точку возможен только если у обоих состояний одинаковая
структура: столько же контуров, столько же точек в каждом и те же флаги
on/off-curve в том же порядке. Это не декларация — здесь она проверяется
на трёх уровнях, независимо от сборочного скрипта:

  1. В бинарнике. Оба веса инстанцируются из ОДНОГО вариативного файла
     Unbounded, и сравниваются endPtsOfContours и массив флагов.
  2. В запечённых данных lib/wordmark.data.ts — длины массивов и сумма
     точек по командам.
  3. Дополнительно, на живой странице, последовательности команд d
     сравниваются в scripts/verify-morph.mjs.
"""
import io, re, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = 'node_modules/@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2'
WORD = 'SPOTIK'
W_A, W_B = 900.0, 467.24


def load(w):
    f = TTFont(SRC)
    f.flavor = None
    bio = io.BytesIO()
    f.save(bio)
    bio.seek(0)
    f = TTFont(bio)
    instancer.instantiateVariableFont(f, {'wght': w}, inplace=True, updateFontNames=False)
    return f


def struct(f, ch):
    glyf = f['glyf']
    gn = f.getBestCmap()[ord(ch)]
    g = glyf[gn]
    g.expand(glyf)
    assert not g.isComposite(), f'{ch} составной'
    ends = list(g.endPtsOfContours)
    # только бит 0 — on-curve; остальные биты это способ упаковки, не форма
    flags = [int(x) & 1 for x in g.flags]
    return ends, flags


fa, fb = load(W_A), load(W_B)
print(f'Источник один: {SRC}')
print(f'Инстансы: wght {W_A} и wght {W_B}\n')
print(f'{"литера":8}{"контуров":>10}{"точек":>8}{"endPts":>10}{"флаги":>10}')
bad = 0
total_c = total_p = 0
for ch in WORD:
    ea, la = struct(fa, ch)
    eb, lb = struct(fb, ch)
    same_e = ea == eb
    same_f = la == lb
    if not (same_e and same_f):
        bad += 1
    total_c += len(ea)
    total_p += len(la)
    print(
        f'{ch:8}{len(ea):>10}{len(la):>8}'
        f'{("совпал" if same_e else "РАЗНЫЙ"):>10}{("совпали" if same_f else "РАЗНЫЕ"):>10}'
    )
print(f'\nвсего контуров {total_c}, сырых точек {total_p}')

src = open('lib/wordmark.data.ts', encoding='utf-8').read()


def arr(name):
    m = re.search(rf'{name}\s*=\s*(?:new\s+\w+Array\()?\[([^\]]*)\]', src, re.S)
    return [float(x) for x in m.group(1).replace('\n', ' ').split(',') if x.strip()]


op = arr('WM_OPS')
co = arr('WM_CONTOURS')
a = arr('WM_OPEN')
b = arr('WM_TIGHT')
pts = 0
i = 0
for n in co:
    pts += 1                      # стартовая точка M
    for _ in range(int(n)):
        pts += 1 if op[i] == 1 else 2
        i += 1
print('\nЗапечённые данные lib/wordmark.data.ts')
print(f'  контуров {len(co)}, команд {len(op)}, точек {pts}')
print(f'  WM_OPEN  {len(a)//2} точек')
print(f'  WM_TIGHT {len(b)//2} точек')
ok_baked = len(a) == len(b) == pts * 2
print(f'  длины массивов {"совпадают" if ok_baked else "РАЗОШЛИСЬ"}')

print()
if bad == 0 and ok_baked:
    print('ТОПОЛОГИЯ СОВПАДАЕТ ПОЛНОСТЬЮ: точки только двигаются.')
else:
    print('ТОПОЛОГИЯ НЕ СОВПАДАЕТ.')
    sys.exit(1)
