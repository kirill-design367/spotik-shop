#!/usr/bin/env python3
"""
Сборка шрифтовых сабсетов проекта.

В проекте один наборный шрифт — Golos Text. Он несёт весь русский текст
и весь интерфейс. Вордмарк набором не пользуется вовсе: слово SPOTIK
запечено в контуры (scripts/build-wordmark.py), поэтому шрифтового файла
для него нет и в критическом пути его вес равен нулю.

Знаки у Golos разложены по скриптам: цифры, пунктуация и « » — в latin,
№ в cyrillic, ₽ в latin-ext. Собираем три сабсета и склеиваем их
через unicode-range в lib/fontface.ts.
"""
import os
from fontTools.ttLib import TTFont
from fontTools import subset

GOLOS = "node_modules/@fontsource-variable/golos-text/files"
OUT = "public/fonts"
os.makedirs(OUT, exist_ok=True)

# U+00A0 обязателен: разряды в ценах «1 490 ₽» разделяются именно им.
PUNCT = "  !\"#%&'()*+,-./0123456789:;=?@[]_{}|~«»—–…“”„‘’•·"
LAT_TXT = PUNCT + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
CYR_TXT = " №" + "".join(chr(c) for c in range(0x0410, 0x0450)) + "Ёё"
SYM_TXT = "₽"


def load(p):
    f = TTFont(p)
    f.flavor = None
    return f


def save(font, name):
    font.flavor = "woff2"
    p = os.path.join(OUT, name)
    font.save(p)
    return p, os.path.getsize(p)


def do_subset(font, text):
    opts = subset.Options()
    opts.layout_features = ['kern', 'liga', 'calt', 'ccmp', 'locl', 'rlig']
    opts.name_IDs = ['*']
    opts.name_legacy = False
    opts.notdef_outline = False
    opts.recalc_bounds = True
    opts.drop_tables += ['DSIG']
    s = subset.Subsetter(options=opts)
    s.populate(text=text)
    s.subset(font)
    return font


for sub, text, name in (
    ("latin", LAT_TXT, "golos-latin.woff2"),
    ("cyrillic", CYR_TXT, "golos-cyrillic.woff2"),
    ("latin-ext", SYM_TXT, "golos-symbols.woff2"),
):
    f = load("%s/golos-text-%s-wght-normal.woff2" % (GOLOS, sub))
    do_subset(f, text)
    p, sz = save(f, name)
    print("%-28s %-34s %6.1f KB" % (name, p, sz / 1024))
