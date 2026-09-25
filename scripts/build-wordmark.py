#!/usr/bin/env python3
"""
ЗАПЕКАНИЕ ВОРДМАРКА В КОНТУРЫ.

Слово SPOTIK — не текст. Это два набора точек контуров, между которыми
рантайм интерполирует по прогрессу скролла.

── ШЕСТЬ УСЛОВИЙ АРТ-ДИРЕКТОРА (замер эталона на 1920×1080) ─────────────────
    1. верх чернил неподвижен, слово меняется только вниз
    2. слово не обрезано краями, отступ ~0.65 % ширины с каждой стороны
    3. каждая литера сохраняет свою ширину и своё положение по горизонтали
    4. высота прописной падает в 1.712 раза
    5. горизонтальные штрихи худеют в 2.833 раза
    6. вертикальные штрихи не меняются

── КАК ЭТО ПОСТРОЕНО: ГОРИЗОНТАЛЬ ОТ ЖИРНОГО, ВЕРТИКАЛЬ ОТ СВЕТЛОГО ─────────
Ключевое наблюдение. У вариативного шрифта точки соответствуют друг другу
по всему пространству начертаний: таблица gvar хранит смещения уже
существующих точек. Значит точку номер i жирного и точку номер i светлого
можно разобрать по координатам и собрать обратно крест-накрест.

Сжатое состояние строится так:

    x берётся у ЖИРНОГО начертания,  y берётся у СВЕТЛОГО.

Что из этого следует, по условиям:

  • x сжатого состояния тождественно равен x раскрытого. Значит ширина
    каждой литеры, её положение и толщина вертикальных штрихов совпадают
    не приблизительно, а ПОБИТОВО — условия 2, 3 и 6 выполнены точно.
    Причём на КАЖДОМ кадре морфа, а не только на концах: интерполяция
    между равными числами их не меняет, x во время движения стоит.

  • y берётся у светлого и масштабируется. Высота прописной у обоих
    начертаний одна и та же (750 юнитов, это константа рисунка), поэтому
    отношение высот задаётся только вертикальными масштабами. Толщина
    горизонтального штриха берётся у светлого — а вес светлого подобран
    так, чтобы отношение вышло ровно 2.833 при отношении высот 1.712.

Одно уравнение на вес светлого:

    H(wA) / H(wB) = R_гор / R_выс = 2.833 / 1.712 = 1.6548

Двоичным поиском по замеру: wA = 900, wB = 467.24.

── ПОЧЕМУ НЕ ПРЕЖНИЙ СПОСОБ ─────────────────────────────────────────────────
В прошлой итерации сжатое состояние было целым светлым начертанием,
неравномерно отмасштабированным. Оно давало верные четыре числа, но
ширина слова держалась за счёт схлопывания межбуквенных просветов —
на глаз это читалось как «литеры разъезжаются в ширину».

Если вместо этого поджимать светлое начертание политерно, до ширины
жирного, вертикальные штрихи худеют на 32…36 % (замерено: O −35.8 %,
T −36.0 %, P −33.8 %, K −32.5 %) — условие 6 рушится. Скрещивание
координат снимает выбор: обе величины выходят точно.
"""
import io, math, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = 'node_modules/@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2'
WORD = 'SPOTIK'
OUT = os.environ.get('WM_OUT', 'lib/wordmark.data.ts')

R_CAP = 1.712   # во сколько раз падает высота прописной
R_HOR = 2.833   # во сколько раз худеет горизонтальный штрих
R_VER = 1.000   # вертикальный штрих не меняется

# Вес раскрытого состояния. Ось wght у Unbounded идёт 200…900, и пара весов
# связана уравнением ниже: чем светлее раскрытое, тем светлее должно быть
# сжатое. Самый светлый раскрытый вес, для которого сжатое ещё попадает
# на ось, — 299.21 (там сжатое садится ровно на 200). Ниже решения нет.
W_OPEN = float(os.environ.get('WM_WEIGHT', '440'))
W_AXIS_MIN = 200.0
NORM_WIDTH = 1000.0     # нормированная ширина чернил слова
CAP_HEIGHT_UNITS = 750.0

# Единственная свободная величина: высота прописной раскрытого состояния
# в долях ширины слова. Ни на одно из шести условий не влияет — задаёт
# только, насколько слово высокое.
CAP_RATIO = float(os.environ.get('WM_CAP_RATIO', '0.235'))
# ── ПРОСВЕТ МЕРЯЕТСЯ ПО РАСТРУ, И ЭТО КРАТЧАЙШЕЕ РАССТОЯНИЕ ────────────────
#
# ⚠️ ПРЕЖНЯЯ МЕРА БЫЛА ДРУГОЙ, И ИМЕННО ОНА ДАВАЛА «ПРОСВЕТЫ РАЗНЫЕ».
# Она считала СРЕДНЮЮ ширину просвета по всей высоте литеры, обрезая
# глубину: это площадь белого, делённая на высоту. Глаз так не читает.
# Между двумя соседними буквами он видит ОДНО место — самое узкое,
# и именно оно решает, слиплись буквы или разъехались. Замер по растру
# готового слова на 390 показал цену прежней меры прямо: пары шли
# 15, 0, 5, 5, 26 px, то есть P и O СМЫКАЛИСЬ, а I и K расходились
# на четверть сантиметра. По апрошам шрифта было 10, 6, 13, 9, 14 —
# то есть оптическое выравнивание делало хуже, чем ничего.
#
# Теперь просвет — это КРАТЧАЙШЕЕ ГОРИЗОНТАЛЬНОЕ РАССТОЯНИЕ между
# закрашенными пикселями двух соседей, и меряется оно на растре слова
# в его экранном размере, а не в шрифтовых юнитах.
RENDER_W = float(os.environ.get('WM_RENDER_W', '385'))
# Высота чернил к ширине слова на 390×844: 556 px при ширине 385 (Р-38).
# Нужна только числу строк растра — в горизонтальное расстояние она
# не входит вовсе, поэтому на 1920 те же просветы выходят пропорционально
# ширине и в долях слова не меняются.
VIEW_RATIO = float(os.environ.get('WM_VIEW_RATIO', '1.444'))
# Растр для РЕШЕНИЯ берётся мельче экранного: на целых пикселях просветы
# квантуются, и решатель топтался бы в пределах пикселя. Приговор при
# этом выносится по НАСТОЯЩЕМУ растру 390 — он и печатается.
SUP = int(os.environ.get('WM_SUP', '8'))

_cache = {}


def load(w):
    key = round(w, 3)
    if key in _cache:
        return _cache[key]
    f = TTFont(SRC)
    f.flavor = None
    bio = io.BytesIO()
    f.save(bio)
    bio.seek(0)
    f = TTFont(bio)
    instancer.instantiateVariableFont(f, {'wght': key}, inplace=True, updateFontNames=False)
    _cache[key] = f
    return f


def glyph_contours(f, ch):
    """Контуры литеры как список списков (x, y, on_curve). Форма не трогается."""
    glyf = f['glyf']
    gn = f.getBestCmap()[ord(ch)]
    g = glyf[gn]
    g.expand(glyf)
    assert not g.isComposite(), f'{ch} составной, соответствие точек не гарантировано'
    co, flags, ends = g.coordinates, g.flags, list(g.endPtsOfContours)
    out, s = [], 0
    for e in ends:
        out.append([(co[j][0], co[j][1], bool(flags[j] & 1)) for j in range(s, e + 1)])
        s = e + 1
    return out, f['hmtx'][gn][0]


def to_segments(contours):
    """
    Контуры TrueType → последовательность команд SVG.

    Между двумя off-curve точками формат подразумевает точку на кривой
    посередине. Делаем её явной: тогда список команд у обоих состояний
    совпадает буква в букву, а подразумеваемая точка — линейная функция
    соседних, поэтому интерполяция от этого не страдает.
    """
    result = []
    for pts in contours:
        start_i = next((i for i, p in enumerate(pts) if p[2]), None)
        if start_i is None:
            seq = pts[:]
            start = ((pts[0][0] + pts[-1][0]) / 2, (pts[0][1] + pts[-1][1]) / 2)
        else:
            seq = pts[start_i:] + pts[:start_i]
            start = (seq[0][0], seq[0][1])
            seq = seq[1:]
        ops, coords = [], [start]
        i = 0
        while i < len(seq):
            p = seq[i]
            if p[2]:
                ops.append(1)  # L
                coords.append((p[0], p[1]))
                i += 1
            else:
                nxt = seq[i + 1] if i + 1 < len(seq) else (start[0], start[1], True)
                if nxt[2]:
                    end = (nxt[0], nxt[1])
                    i += 2
                else:
                    end = ((p[0] + nxt[0]) / 2, (p[1] + nxt[1]) / 2)
                    i += 1
                ops.append(2)  # Q
                coords.append((p[0], p[1]))
                coords.append(end)
        result.append({'ops': ops, 'coords': coords})
    return result


def horizontal_stroke(w):
    """Толщина горизонтали в юнитах — высота перекладины T."""
    T, _ = glyph_contours(load(w), 'T')
    bar = max(T, key=lambda c: max(p[0] for p in c) - min(p[0] for p in c))
    return max(p[1] for p in bar) - min(p[1] for p in bar)


def solve_light_weight():
    """
    Вес светлого: единственное, что задаёт отношение cap к горизонтали.

    Если требуемая горизонталь тоньше, чем на краю оси, решения НЕТ —
    и подгонять молча нельзя: это сломало бы условие 4 или 5. Вместо
    подгонки скрипт падает и называет предельный вес.
    """
    target = horizontal_stroke(W_OPEN) / (R_HOR / R_CAP)
    floor = horizontal_stroke(W_AXIS_MIN)
    if target < floor:
        lo, hi = W_AXIS_MIN, 900.0
        for _ in range(60):
            m = (lo + hi) / 2
            if horizontal_stroke(m) > floor * (R_HOR / R_CAP):
                hi = m
            else:
                lo = m
        raise SystemExit(
            'РЕШЕНИЯ НЕТ. При раскрытом весе %.2f сжатому нужна горизонталь %.2f,\n'
            'а тоньше %.2f ось wght не даёт (её край %g).\n'
            'Самый светлый раскрытый вес, который ещё решается: %.2f.'
            % (W_OPEN, target, floor, W_AXIS_MIN, (lo + hi) / 2))
    lo, hi = W_AXIS_MIN, W_OPEN
    for _ in range(50):
        mid = (lo + hi) / 2
        if horizontal_stroke(mid) > target:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


# ── замеры по растеризованному контуру ──────────────────────────────────────

def flatten(segs, steps=64):
    """Сегменты → замкнутые полилинии. Только для ЗАМЕРОВ, в выдачу не идёт."""
    polys = []
    for seg in segs:
        pts = seg['coords']
        poly = [pts[0]]
        p = 1
        for op in seg['ops']:
            if op == 1:
                poly.append(pts[p]); p += 1
            else:
                c, e = pts[p], pts[p + 1]; p += 2
                a = poly[-1]
                for t in range(1, steps + 1):
                    u = t / steps; v = 1 - u
                    poly.append((v * v * a[0] + 2 * v * u * c[0] + u * u * e[0],
                                 v * v * a[1] + 2 * v * u * c[1] + u * u * e[1]))
        polys.append(poly)
    return polys


def runs_at(polys, y):
    """Отрезки чернил на горизонтали y, слева направо."""
    xs = []
    for poly in polys:
        for i in range(len(poly)):
            a, b = poly[i], poly[(i + 1) % len(poly)]
            if (a[1] <= y < b[1]) or (b[1] <= y < a[1]):
                xs.append(a[0] + (y - a[1]) / (b[1] - a[1]) * (b[0] - a[0]))
    xs.sort()
    return [(xs[i], xs[i + 1]) for i in range(0, len(xs) - 1, 2)]


def bbox(segs):
    xs = [c[0] for s in segs for c in s['coords']]
    ys = [c[1] for s in segs for c in s['coords']]
    return min(xs), min(ys), max(xs), max(ys)


# ── просветы: кратчайшее расстояние по растру ───────────────────────────────

def raster_edges(segs, dx, kx, ky, y_top, rows):
    """
    РАСТЕРИЗУЕТ литеру и отдаёт по каждой строке пикселей крайний левый
    и крайний правый ЗАКРАШЕННЫЙ столбец (или None, если чернил на этой
    строке нет вовсе).

    Строка закрашена там, где её ЦЕНТР попал внутрь отрезка чернил, —
    это и есть обычная растеризация без сглаживания. Сглаживание тут
    не нужно и вредно: полупрозрачный край не «закрашенный пиксель»,
    а замер обязан отвечать на вопрос «где кончаются чернила».
    """
    polys = [[((x + dx) * kx, (y_top - y) * ky) for (x, y) in poly]
             for poly in flatten(segs)]
    out = []
    for r in range(rows):
        runs = runs_at(polys, r + 0.5)
        lo = hi = None
        for (a, b) in runs:
            ca, cb = math.ceil(a - 0.5), math.floor(b - 0.5)
            if cb < ca:
                continue
            lo = ca if lo is None else min(lo, ca)
            hi = cb if hi is None else max(hi, cb)
        out.append((lo, hi))
    return out


def min_gaps(per_letter, off, state, render_w, ratio):
    """
    Пять просветов слова в пикселях растра шириной `render_w`.

    ПРОСВЕТ = КРАТЧАЙШЕЕ ГОРИЗОНТАЛЬНОЕ РАССТОЯНИЕ между закрашенными
    пикселями двух соседних литер: по каждой строке, где чернила есть
    У ОБЕИХ, берётся расстояние от правого края левой до левого края
    правой, и из этих чисел берётся наименьшее. Строки, где у одной
    из литер чернил нет, в счёт не идут вовсе: между «ничем» и чернилами
    расстояния не существует, и прежняя мера подставляла там край
    габарита — отсюда и шла добрая половина её вранья.

    Величина может быть отрицательной: габариты соседей законно
    перекрываются (круглая O заходит под вынос перекладины T, Р-20),
    и тогда это глубина захода.
    """
    xs = [c[0] + off[i] for i, L in enumerate(per_letter)
          for s in L['heavy'] for c in s['coords']]
    x0, span = min(xs), max(xs) - min(xs)
    kx = render_w / span
    ys = [c[1] for L in per_letter for s in L[state] for c in s['coords']]
    y_top, y_bot = max(ys), min(ys)
    rows = max(2, int(round(render_w * ratio)))
    ky = rows / (y_top - y_bot)
    edges = [raster_edges(L[state], off[i] - x0, kx, ky, y_top, rows)
             for i, L in enumerate(per_letter)]
    out = []
    for i in range(len(per_letter) - 1):
        best = None
        for (_, ra), (lb, _) in zip(edges[i], edges[i + 1]):
            if ra is None or lb is None:
                continue
            g = lb - ra - 1
            best = g if best is None else min(best, g)
        out.append(0 if best is None else best)
    return out


def raster_offsets(per_letter, natural):
    """
    Выставляет ПЯТЬ ПРОСВЕТОВ РАВНЫМИ, двигая только P, O, T, I.

    ── ПОЧЕМУ S И K НЕ ДВИГАЮТСЯ ───────────────────────────────────────────
    Постановка. И заодно это значит, что габарит слова не меняется вовсе:
    крайние чернила — левый край S и правый край K, — а значит нормировка
    ширины, отступы от краёв экрана и высота знака остаются прежними.
    Пять просветов при четырёх подвижных литерах — ровно четыре равенства
    на четыре неизвестных: решение есть, и оно единственное.

    ── ПОЧЕМУ РЕШАЕТСЯ В ОДИН ХОД ──────────────────────────────────────────
    Просвет пары — это МИНИМУМ по строкам, а сдвиг двигает всю литеру
    целиком: строки от него не зависят, поэтому

        просвет(i) = (off[i+1] - off[i]) + m(i),

    где m(i) снято с растра один раз. Связь линейная, сумма просветов
    при неподвижных S и K постоянна, значит цель — это среднее, а сдвиги
    выписываются сразу. Проходов несколько только из-за квантования
    растра: сдвиг в долю пикселя меняет, какой именно столбец окажется
    закрашенным.

    ── ПОЧЕМУ ОДИН НАБОР СДВИГОВ НА ОБА СОСТОЯНИЯ ──────────────────────────
    У сжатого состояния штрихи тоньше, поэтому все просветы там шире
    на 4…5 px, и шире НЕ ОДИНАКОВО: разброс этой добавки 3 px. Значит
    выровнять оба состояния в ноль одним набором нельзя. Выравнивается
    ПОЛУСУММА, и тогда каждому состоянию достаётся половина разброса —
    меньше пикселя в каждую сторону от своего среднего. Это дешевле,
    чем сдвиги врозь: врозь сломалось бы условие 6 (x обоих состояний
    тождественны), и литеры ездили бы по горизонтали весь морф.
    """
    off = list(natural)
    kx = RENDER_W / (max(c[0] + off[i] for i, L in enumerate(per_letter)
                         for s in L['heavy'] for c in s['coords'])
                     - min(c[0] + off[i] for i, L in enumerate(per_letter)
                           for s in L['heavy'] for c in s['coords']))
    w_sup, rt = RENDER_W * SUP, VIEW_RATIO
    before = (min_gaps(per_letter, off, 'heavy', RENDER_W, rt),
              min_gaps(per_letter, off, 'light', RENDER_W, rt / R_CAP))
    for _ in range(24):
        a = min_gaps(per_letter, off, 'heavy', w_sup, rt)
        b = min_gaps(per_letter, off, 'light', w_sup, rt / R_CAP)
        mid = [(x + y) / 2 for x, y in zip(a, b)]
        target = sum(mid) / len(mid)
        if max(mid) - min(mid) < 0.5:          # полпикселя экранного растра
            break
        corr = 0.0
        for i in range(len(mid)):
            corr += (target - mid[i]) / (kx * SUP)
            if i + 1 < len(off) - 1:
                off[i + 1] += corr
    off[-1] = natural[-1]
    after = (min_gaps(per_letter, off, 'heavy', RENDER_W, rt),
             min_gaps(per_letter, off, 'light', RENDER_W, rt / R_CAP))
    return off, before, after


def main():
    w_light = solve_light_weight()
    fa, fb = load(W_OPEN), load(w_light)

    # ── раскладка: продвижения берём у ЖИРНОГО, он задаёт x обоих состояний ──
    per_letter = []
    adv = 0.0
    for idx, ch in enumerate(WORD):
        ca, a = glyph_contours(fa, ch)
        cb, _ = glyph_contours(fb, ch)
        sa, sb = to_segments(ca), to_segments(cb)
        assert len(sa) == len(sb), f'{ch}: разное число контуров'
        for x, y in zip(sa, sb):
            assert x['ops'] == y['ops'], f'{ch}: разная последовательность команд'
            assert len(x['coords']) == len(y['coords']), f'{ch}: разное число точек'
        per_letter.append({'ch': ch, 'heavy': sa, 'light': sb,
                           'shift': adv, 'n': len(sa)})
        adv += a

    natural = [L['shift'] for L in per_letter]
    offsets, gaps_before, gaps_after = raster_offsets(per_letter, natural)
    if os.environ.get('WM_NO_OPTICAL'):   # только для сравнительных рендеров
        offsets, gaps_after = list(natural), gaps_before
    for L, o in zip(per_letter, offsets):
        L['shift'] = o

    # горизонтальный масштаб: чернила слова ровно NORM_WIDTH
    raw_x = []
    for L in per_letter:
        raw_x += [c[0] + L['shift'] for s in L['heavy'] for c in s['coords']]
    span = max(raw_x) - min(raw_x)
    sx = NORM_WIDTH / span
    left0 = min(raw_x) * sx

    cap_a = CAP_RATIO * NORM_WIDTH
    sy_a = cap_a / CAP_HEIGHT_UNITS
    sy_b = sy_a / R_CAP

    def build(kind, sy):
        out = []
        for idx, L in enumerate(per_letter):
            dx = L['shift'] * sx - left0
            for hs, ls in zip(L['heavy'], L['light']):
                src_y = hs if kind == 'open' else ls
                coords = [(xh * sx + dx, -yy * sy)
                          for (xh, _), (_, yy) in zip(hs['coords'], src_y['coords'])]
                out.append({'ops': hs['ops'], 'coords': coords, 'letter': idx})
        return out

    A = build('open', sy_a)
    B = build('tight', sy_b)

    # верх чернил на ноль в обоих состояниях — условие 1
    topA = min(c[1] for s in A for c in s['coords'])
    topB = min(c[1] for s in B for c in s['coords'])
    for s in A:
        s['coords'] = [(x, y - topA) for (x, y) in s['coords']]
    for s in B:
        s['coords'] = [(x, y - topB) for (x, y) in s['coords']]

    # ── топология ───────────────────────────────────────────────────────────
    assert len(A) == len(B), 'разное число контуров'
    for i, (a, b) in enumerate(zip(A, B)):
        assert a['ops'] == b['ops'], f'контур {i}: разная последовательность команд'
        assert len(a['coords']) == len(b['coords']), f'контур {i}: разное число точек'
    n_contours, n_cmds = len(A), sum(len(c['ops']) for c in A)
    n_points = sum(len(c['coords']) for c in A)

    # ── проверки условий ────────────────────────────────────────────────────
    def letter_segs(state, idx):
        return [s for s in state if s['letter'] == idx]

    print('── РЕШЕНИЕ ──────────────────────────────────────────────────────')
    print('вес жирного (x обоих состояний, y раскрытого)  %.1f' % W_OPEN)
    print('вес светлого (y сжатого состояния)             %.2f' % w_light)
    print('высота прописной раскрытого %.2f при ширине слова %.0f (WM_CAP_RATIO %.3f)'
          % (cap_a, NORM_WIDTH, CAP_RATIO))
    print()

    print('── УСЛОВИЕ 1: ВЕРХ ЧЕРНИЛ НЕПОДВИЖЕН ───────────────────────────')
    # минимум линейной интерполяции по t: проверяем весь ход, не только концы
    worst_t, worst = 0.0, 0.0
    for k in range(0, 201):
        t = k / 200
        top = min((1 - t) * ay + t * by
                  for sa, sb in zip(A, B)
                  for (_, ay), (_, by) in zip(sa['coords'], sb['coords']))
        if top < worst:
            worst, worst_t = top, t
    print('верх раскрытого 0.000, верх сжатого 0.000')
    print('наибольший выход выше линии за весь ход: %.6f ед. при t=%.2f' % (-worst, worst_t))

    print()
    print('── ПРОСВЕТЫ МЕЖДУ ЛИТЕРАМИ ────────────────────────────────────')
    print('Кратчайшее горизонтальное расстояние между закрашенными пикселями')
    print('соседних литер, по растру слова шириной %g px — это телефон 390.' % RENDER_W)
    print('  пара    раскрытое: апроши → стало   сжатое: апроши → стало')
    for i in range(len(WORD) - 1):
        print('  %s–%s %13d → %-6d %12d → %-6d'
              % (WORD[i], WORD[i + 1],
                 gaps_before[0][i], gaps_after[0][i],
                 gaps_before[1][i], gaps_after[1][i]))
    for k, nm in ((0, 'раскрытое'), (1, 'сжатое  ')):
        print('  разброс, %s: по апрошам %d px, стало %d px'
              % (nm, max(gaps_before[k]) - min(gaps_before[k]),
                 max(gaps_after[k]) - min(gaps_after[k])))
    print('  сдвиг литер относительно апрошей, px на 390:  %s'
          % ', '.join('%s %+.1f' % (WORD[i], (per_letter[i]['shift'] - natural[i]) * sx * RENDER_W / NORM_WIDTH)
                      for i in range(len(WORD))))
    print()

    print('── УСЛОВИЕ 3: ШИРИНА И ПОЛОЖЕНИЕ КАЖДОЙ ЛИТЕРЫ ─────────────────')
    print('литера   левый край A / B          ширина A / B           расхождение')
    max_dx = 0.0
    for idx, L in enumerate(per_letter):
        ba, bb = bbox(letter_segs(A, idx)), bbox(letter_segs(B, idx))
        d = max(abs(ba[0] - bb[0]), abs((ba[2] - ba[0]) - (bb[2] - bb[0])))
        max_dx = max(max_dx, d)
        print('  %s    %9.3f /%9.3f   %9.3f /%9.3f    %.2e'
              % (L['ch'], ba[0], bb[0], ba[2] - ba[0], bb[2] - bb[0], d))
    print('наибольшее расхождение по x: %.2e ед.' % max_dx)

    print()
    print('── УСЛОВИЯ 4, 5, 6: ВЕРТИКАЛЬНАЯ ГЕОМЕТРИЯ ─────────────────────')
    iI, iT, iO, iP, iK = 4, 3, 2, 1, 5
    bIa, bIb = bbox(letter_segs(A, iI)), bbox(letter_segs(B, iI))
    cap_A, cap_B = bIa[3] - bIa[1], bIb[3] - bIb[1]

    def bar_thickness(state):
        segs = letter_segs(state, iT)
        bar = max(segs, key=lambda s: max(c[0] for c in s['coords']) - min(c[0] for c in s['coords']))
        ys = [c[1] for c in bar['coords']]
        return max(ys) - min(ys)

    hor_A, hor_B = bar_thickness(A), bar_thickness(B)

    def stems(state, idx):
        """
        Вертикальные штрихи литеры на середине её высоты.

        Наклонные участки (диагонали K, кривые S и P) на горизонтальном
        срезе тоже дают отрезок чернил, но штрихами не являются: у них
        есть вертикальная составляющая, и при утоньшении по вертикали они
        обязаны меняться. Отделяем их по устойчивости краёв: у стойки обе
        границы почти вертикальны, то есть при сдвиге среза на 4 % высоты
        почти не едут по x.
        """
        segs = letter_segs(state, idx)
        b = bbox(segs)
        h = b[3] - b[1]
        polys = flatten(segs)
        y = (b[1] + b[3]) / 2
        d = h * 0.04
        mid, up, dn = runs_at(polys, y), runs_at(polys, y - d), runs_at(polys, y + d)
        if not (len(mid) == len(up) == len(dn)):
            return []
        out = []
        for (a0, a1), (u0, u1), (d0, d1) in zip(mid, up, dn):
            slope = max(abs(u0 - a0), abs(d0 - a0), abs(u1 - a1), abs(d1 - a1)) / d
            out.append((round(a1 - a0, 4), slope < 0.25))
        return out

    rows = [
        ('высота прописной (I)', cap_A, cap_B, R_CAP),
        ('горизонт. штрих (перекладина T)', hor_A, hor_B, R_HOR),
    ]
    print('%-34s %9s %9s %9s %7s %10s' % ('', 'раскрытое', 'сжатое', 'отношение', 'цель', 'откл.'))
    for name, a, b, tgt in rows:
        print('%-34s %9.3f %9.3f %9.4f %7.3f %+9.3f%%'
              % (name, a, b, a / b, tgt, (a / b / tgt - 1) * 100))
    worst_stem = 0.0
    slanted = []
    for ch, idx in (('S', 0), ('P', iP), ('O', iO), ('T', iT), ('I', iI), ('K', iK)):
        sa, sb = stems(A, idx), stems(B, idx)
        if len(sa) != len(sb) or not sa:
            continue
        n = 0
        for (x, is_stem), (y, _) in zip(sa, sb):
            if not is_stem:
                slanted.append((ch, x, y))
                continue
            n += 1
            lbl = 'вертик. штрих %s' % ch + ('' if len(sa) == 1 else ' #%d' % n)
            dev = (x / y / R_VER - 1) * 100
            worst_stem = max(worst_stem, abs(dev))
            print('%-34s %9.3f %9.3f %9.4f %7.3f %+9.3f%%'
                  % (lbl, x, y, x / y, R_VER, dev))
    print('наибольшее отклонение вертикального штриха: %.4f %%' % worst_stem)
    if slanted:
        print()
        print('Наклонные и криволинейные участки — НЕ штрихи. У них есть')
        print('вертикальная составляющая, поэтому горизонтальный срез через них')
        print('обязан меняться: это и есть утоньшение по вертикали, а не дефект.')
        for ch, x, y in slanted:
            print('  %s: срез %.2f → %.2f (в %.3f раза)' % (ch, x, y, x / y))

    bax, bbx = bbox(A), bbox(B)

    # Нижняя кромка нужна футеру: там слово прижато низом и растёт вверх.
    # Если самая нижняя точка на обоих состояниях ОДНА И ТА ЖЕ, низ на любом
    # кадре — линейная интерполяция двух чисел, и рантайму хватит их двоих.
    def lowest_index(state):
        best, bi = -1e9, -1
        k = 0
        for s_ in state:
            for (_, y) in s_['coords']:
                if y > best:
                    best, bi = y, k
                k += 1
        return bi, best
    iaL, bottom_a = lowest_index(A)
    ibL, bottom_b = lowest_index(B)
    lin_ok = iaL == ibL
    err = 0.0
    if lin_ok:
        for kk in range(201):
            t = kk / 200
            real = max((1 - t) * ay + t * by
                       for sa, sb in zip(A, B)
                       for (_, ay), (_, by) in zip(sa['coords'], sb['coords']))
            err = max(err, abs(real - ((1 - t) * bottom_a + t * bottom_b)))

    print()
    print('── НИЖНЯЯ КРОМКА (нужна футеру) ────────────────────────────────')
    print('низ раскрытого %.3f, низ сжатого %.3f' % (bottom_a, bottom_b))
    print('самая нижняя точка %s (индексы %d и %d); ошибка линейной оценки за весь ход %.2e'
          % ('одна и та же' if lin_ok else 'РАЗНАЯ', iaL, ibL, err))

    print()
    print('── ГАБАРИТЫ ────────────────────────────────────────────────────')
    print('чернила по x: %.3f … %.3f (ширина %.3f)' % (bax[0], bax[2], bax[2] - bax[0]))
    print('чернила по y: раскрытое 0 … %.3f, сжатое 0 … %.3f' % (bax[3], bbx[3]))
    print('контуров %d, команд %d, точек %d — совпадает в обоих состояниях'
          % (n_contours, n_cmds, n_points))
    print('контуров на литеру: %s' % ', '.join('%s %d' % (L['ch'], L['n']) for L in per_letter))

    box_h = max(bax[3], bbx[3])

    # ── запись ──────────────────────────────────────────────────────────────
    ops_flat, lens, ca, cb = [], [], [], []
    for a, b in zip(A, B):
        lens.append(len(a['ops']))
        ops_flat.extend(a['ops'])
        for (x, y) in a['coords']:
            ca.extend([round(x, 2), round(y, 2)])
        for (x, y) in b['coords']:
            cb.extend([round(x, 2), round(y, 2)])

    def arr(v, per=12):
        return '\n'.join('  ' + ','.join('%g' % x for x in v[i:i + per]) + ','
                         for i in range(0, len(v), per))

    ts = '''// СГЕНЕРИРОВАНО scripts/build-wordmark.py — руками не править.
//
// Слово SPOTIK, запечённое в контуры из вариативного бинарника Unbounded
// в двух состояниях. Топология одна и та же: столько же контуров, та же
// последовательность команд, столько же точек — при морфе точки только
// двигаются.
//
// Сжатое состояние собрано скрещиванием координат: x взят у ЖИРНОГО
// начертания, y у СВЕТЛОГО. Поэтому x обоих состояний тождественно равны,
// и ширина литер, их положение и толщина вертикальных штрихов не меняются
// ни на одном кадре морфа.
//
// Координаты нормированы: ширина чернил ровно %g, верх чернил на y = 0
// у ОБОИХ состояний, ось y направлена вниз как в SVG.
//
// контуров %d, команд %d, точек %d
// вес жирного %g, вес светлого %.2f, высота прописной %.2f

/** Длина каждого контура в командах. */
export const WM_CONTOURS = new Uint16Array([
%s
]);

/** Команды подряд: 1 — линия (одна точка), 2 — квадратичная кривая (две точки). */
export const WM_OPS = new Uint8Array([
%s
]);

/** Раскрытое состояние: пары x, y. */
export const WM_OPEN = new Float32Array([
%s
]);

/** Сжатое состояние: пары x, y. Значения x совпадают с раскрытым. */
export const WM_TIGHT = new Float32Array([
%s
]);

/**
 * Сколько контуров приходится на каждую литеру, по порядку S P O T I K.
 * Рантайм режет по этим числам слово на шесть групп: вход «пианино»
 * двигает каждую литеру отдельным трансформом.
 */
export const WM_LETTER_CONTOURS = [%s] as const;

/** Ширина чернил слова в этих координатах. */
export const WM_WIDTH = %g;

/** Высота прописной раскрытого и сжатого состояния. */
export const WM_CAP_OPEN = %.3f;
export const WM_CAP_TIGHT = %.3f;

/** Высота рамки: от верха чернил до низа самого высокого состояния. */
export const WM_BOX_HEIGHT = %.3f;

/**
 * Низ чернил в каждом состоянии. Самая нижняя точка у обоих состояний одна
 * и та же, поэтому низ на промежуточном кадре — линейная интерполяция этих
 * двух чисел, без обхода массива. Нужен футеру: там слово прижато низом.
 */
export const WM_BOTTOM_OPEN = %.3f;
export const WM_BOTTOM_TIGHT = %.3f;

/**
 * Линия прописных: верх ПЛОСКИХ литер P, T, I, K.
 *
 * Круглые S и O выходят выше неё на овершут рисунка, и именно их апекс
 * лежит на y = 0 — то есть «верх чернил» и «линия прописных» это две
 * разные высоты, между ними %.2f %% высоты прописной. Футеру это нужно,
 * чтобы срез зелёного поля читался на всех шести литерах, а не только
 * на двух круглых.
 */
export const WM_CAP_TOP_OPEN = %.3f;
export const WM_CAP_TOP_TIGHT = %.3f;
''' % (NORM_WIDTH, n_contours, n_cmds, n_points, W_OPEN, w_light, cap_a,
       arr(lens), arr(ops_flat), arr(ca), arr(cb),
       ', '.join(str(L['n']) for L in per_letter),
       NORM_WIDTH, cap_A, cap_B, box_h, bottom_a, bottom_b,
       bIa[1] / cap_A * 100, bIa[1], bIb[1])

    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(ts)
    print('записано %s  (%.1f КБ)' % (OUT, len(ts) / 1024))


if __name__ == '__main__':
    main()
