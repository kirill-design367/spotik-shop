#!/usr/bin/env python3
"""
Сборка шрифтовых сабсетов проекта.

1) spotik-wordmark.woff2  — только S P O T I K, ВСЕ 13 осей Roboto Flex.
   Это критический ресурс первого экрана, поэтому он должен быть крошечным.
2) spotik-text-latin.woff2 / spotik-text-cyrillic.woff2 — текстовый шрифт,
   оси урезаны до wght, чтобы не тащить gvar на 13 осей ради абзацев.
"""
import os, re, sys, subprocess, io
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib import instancer

SRC = "node_modules/@fontsource-variable/roboto-flex/files"
OUT = "public/fonts"
os.makedirs(OUT, exist_ok=True)

LATIN = SRC + "/roboto-flex-latin-full-normal.woff2"
CYR   = SRC + "/roboto-flex-cyrillic-full-normal.woff2"

def load(p):
    f = TTFont(p)
    f.flavor = None
    return f

def save(font, name):
    font.flavor = "woff2"
    p = os.path.join(OUT, name)
    font.save(p)
    return p, os.path.getsize(p)

def do_subset(font, text=None, unicodes=None, keep_all_axes=True):
    opts = subset.Options()
    opts.layout_features = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'rlig']
    opts.name_IDs = ['*']
    opts.name_legacy = False
    opts.notdef_outline = False
    opts.recalc_bounds = True
    opts.drop_tables += ['DSIG']
    opts.retain_gids = False
    s = subset.Subsetter(options=opts)
    if text:
        s.populate(text=text)
    else:
        s.populate(unicodes=unicodes)
    s.subset(font)
    return font

# ------------------------------------------------------------------ вордмарк
wm = load(LATIN)
do_subset(wm, text="SPOTIK")
p, sz = save(wm, "spotik-wordmark.woff2")
print("вордмарк (S P O T I K, 13 осей): %-42s %6.1f KB" % (p, sz/1024))

# ------------------------------------------------------------------ текст
# Roboto Flex у Fontsource разложен по скриптам, поэтому нужные знаки лежат
# в разных файлах: « » — в latin, № в cyrillic, ₽ в latin-ext.
# Собираем три крошечных сабсета и склеиваем их в CSS через unicode-range.
PUNCT_LAT = " !\"#%&'()*+,-./0123456789:;=?@[]_{}|~«»—–…“”„‘’•·"
LAT_TXT = PUNCT_LAT + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
CYR_TXT = "№" + "".join(chr(c) for c in range(0x0410, 0x0450)) + "Ёё"
SYM_TXT = "₽"

TEXT_PARTS = (
    (LATIN,                                    LAT_TXT, "spotik-text-latin.woff2"),
    (CYR,                                      CYR_TXT, "spotik-text-cyrillic.woff2"),
    (SRC + "/roboto-flex-latin-ext-full-normal.woff2", SYM_TXT, "spotik-text-symbols.woff2"),
)

PIN = {"wght": (100, 400, 1000),
       "opsz": 18, "GRAD": 0, "wdth": 100, "slnt": 0,
       "XOPQ": 96, "YOPQ": 79, "XTRA": 468,
       "YTUC": 712, "YTLC": 514, "YTAS": 750, "YTDE": -203, "YTFI": 738}

for src, text, name in TEXT_PARTS:
    f = load(src)
    f = instancer.instantiateVariableFont(f, PIN, inplace=True, updateFontNames=False)
    do_subset(f, text=text)
    p, sz = save(f, name)
    print("текст %-28s %-40s %6.1f KB" % (name, p, sz / 1024))

# ------------------------------------------------- голос: Golos Text
# Roboto Flex несёт приём (вордмарк и крупные числа), но кириллица у него
# адаптированная. Golos Text рисовался от кириллицы, у него шире строчная
# и спокойнее Ж/Ф/Щ — русский текст на нём читается заметно лучше.
# Знаки опять разложены по скриптам: цифры, пунктуация и « » — в latin,
# № в cyrillic, ₽ в latin-ext. Собираем три сабсета и склеиваем unicode-range.
GOLOS = "node_modules/@fontsource-variable/golos-text/files"
for sub, text, name in (
    ("latin", LAT_TXT, "golos-latin.woff2"),
    ("cyrillic", CYR_TXT, "golos-cyrillic.woff2"),
    ("latin-ext", SYM_TXT, "golos-symbols.woff2"),
):
    f = load("%s/golos-text-%s-wght-normal.woff2" % (GOLOS, sub))
    do_subset(f, text=text)
    p, sz = save(f, name)
    print("голос %-28s %-40s %6.1f KB" % (name, p, sz / 1024))

# --------------------------------------------- шрифты-кандидаты для /fonts
# Для страницы сравнения кладём кириллический + латинский сабсет каждого.
CANDIDATES = {
    "wix-madefor-display": "wix",
    "golos-text": "golos",
    "unbounded": "unbounded",
}
for pkg, short in CANDIDATES.items():
    d = "node_modules/@fontsource-variable/%s/files" % pkg
    for sub, tag in (("latin", "lat"), ("cyrillic", "cyr")):
        pat = re.compile(r"-%s-(full|wght|standard)-normal\.woff2$" % sub)
        cands = [x for x in os.listdir(d) if pat.search(x)]
        if not cands:
            print("  пропуск", pkg, sub); continue
        f = load(os.path.join(d, cands[0]))
        do_subset(f, text=(LAT_TXT + "SPOTIK") if sub == "latin" else CYR_TXT)
        p, sz = save(f, "cand-%s-%s.woff2" % (short, tag))
        print("кандидат %-12s %-8s %-38s %6.1f KB" % (short, tag, p, sz/1024))
