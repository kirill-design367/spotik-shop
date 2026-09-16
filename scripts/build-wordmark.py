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
import io, os
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = 'node_modules/@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2'
WORD = 'SPOTIK'
OUT = 'lib/wordmark.data.ts'

R_CAP = 1.712   # во сколько раз падает высота прописной
R_HOR = 2.833   # во сколько раз худеет горизонтальный штрих
R_VER = 1.000   # вертикальный штрих не меняется

W_OPEN = 900.0          # раскрытое состояние — самое жирное начертание
NORM_WIDTH = 1000.0     # нормированная ширина чернил слова
CAP_HEIGHT_UNITS = 750.0

# Единственная свободная величина: высота прописной раскрытого состояния
# в долях ширины слова. Ни на одно из шести условий не влияет — задаёт
# только, насколько слово высокое.
CAP_RATIO = float(os.environ.get('WM_CAP_RATIO', '0.235'))
# Добавка к межбуквенному просвету, в долях ширины слова. Ноль — родной
# ритм Unbounded.
TRACK = float(os.environ.get('WM_TRACK', '0')) * NORM_WIDTH

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
    """Вес светлого: единственное, что задаёт отношение cap к горизонтали."""
    target = horizontal_stroke(W_OPEN) / (R_HOR / R_CAP)
    lo, hi = 200.0, W_OPEN
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
        per_letter.append({'ch': ch, 'heavy': sa, 'light': sb, 'shift': adv + idx * 0.0})
        adv += a

    # горизонтальный масштаб: чернила слова ровно NORM_WIDTH
    raw_x = []
    for i, L in enumerate(per_letter):
        off = L['shift']
        raw_x += [c[0] + off for s in L['heavy'] for c in s['coords']]
    span = max(raw_x) - min(raw_x)
    # трекинг добавляет (n-1) просветов, поэтому масштаб решается вместе с ним
    sx = (NORM_WIDTH - TRACK * (len(WORD) - 1)) / span
    left0 = min(raw_x) * sx

    cap_a = CAP_RATIO * NORM_WIDTH
    sy_a = cap_a / CAP_HEIGHT_UNITS
    sy_b = sy_a / R_CAP

    def build(kind, sy):
        out = []
        for idx, L in enumerate(per_letter):
            dx = L['shift'] * sx + idx * TRACK - left0
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
''' % (NORM_WIDTH, n_contours, n_cmds, n_points, W_OPEN, w_light, cap_a,
       arr(lens), arr(ops_flat), arr(ca), arr(cb),
       NORM_WIDTH, cap_A, cap_B, box_h, bottom_a, bottom_b)

    with open(OUT, 'w', encoding='utf-8') as fh:
        fh.write(ts)
    print('записано %s  (%.1f КБ)' % (OUT, len(ts) / 1024))


if __name__ == '__main__':
    main()
