#!/usr/bin/env python3
"""
Сборка шрифтовых сабсетов проекта.

Двадцать первая итерация сменила наборную гарнитуру и оставила выбор
за арт-директором: на странице /fonts стоят четыре кандидата рядом,
в четырёх ролях набора. Поэтому сабсеты собираются СРАЗУ ДЛЯ ВСЕХ
кандидатов, а какой из них боевой — решает одна строка в lib/fontface.ts.

Вордмарк набором не пользуется вовсе: слово SPOTIK запечено в контуры
(scripts/build-wordmark.py), поэтому шрифтового файла для него нет
и в критическом пути его вес равен нулю. Unbounded в наборный текст
не допускается ни при каких условиях.

Знаки у всех четырёх разложены по скриптам ОДИНАКОВО (проверено чтением
cmap каждого бинарника): цифры, пунктуация и « » — в latin, № в cyrillic,
₽ в latin-ext. Поэтому схема сабсетов одна на всех, а склеиваются они
через unicode-range в lib/fontface.ts.
"""
import os
from fontTools.ttLib import TTFont
from fontTools import subset

SRC = "node_modules/@fontsource-variable"
OUT = "public/fonts"
os.makedirs(OUT, exist_ok=True)

# U+00A0 обязателен: разряды в ценах «1 490 ₽» разделяются именно им.
PUNCT = "  !\"#%&'()*+,-./0123456789:;=?@[]_{}|~«»—–…“”„‘’•·"
LAT_TXT = PUNCT + "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
CYR_TXT = " №" + "".join(chr(c) for c in range(0x0410, 0x0450)) + "Ёё"
SYM_TXT = "₽"

# имя в пакете fontsource → префикс наших файлов
FAMILIES = {
    "inter": "inter",
    "onest": "onest",
    "manrope": "manrope",
    "geologica": "geologica",
    "golos-text": "golos",
}


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


total = {}
for pkg, slug in FAMILIES.items():
    acc = 0
    for sub, text, tail in (
        ("latin", LAT_TXT, "latin"),
        ("cyrillic", CYR_TXT, "cyrillic"),
        ("latin-ext", SYM_TXT, "symbols"),
    ):
        src = "%s/%s/files/%s-%s-wght-normal.woff2" % (SRC, pkg, pkg, sub)
        f = load(src)
        do_subset(f, text)
        name = "%s-%s.woff2" % (slug, tail)
        p, sz = save(f, name)
        acc += sz
        print("%-22s %-30s %6.1f KB" % (pkg, name, sz / 1024))
    total[slug] = acc

print()
for slug, sz in sorted(total.items(), key=lambda kv: kv[1]):
    print("  всего %-12s %6.1f KB" % (slug, sz / 1024))
