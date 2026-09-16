#!/usr/bin/env python3
"""
ЗАПЕКАНИЕ ВОРДМАРКА В КОНТУРЫ.

Слово SPOTIK перестаёт быть текстом. Оно превращается в два набора точек
контуров, между которыми рантайм интерполирует по прогрессу скролла.

── ПОЧЕМУ ТОПОЛОГИЯ СОВПАДАЕТ ───────────────────────────────────────────────
Оба состояния берутся из ОДНОГО вариативного бинарника Unbounded. По формату
OpenType таблица gvar хранит смещения уже существующих точек: число контуров,
число точек в каждом контуре и флаги on/off-curve одинаковы по всему
пространству начертаний. Поэтому при морфе точки только двигаются.

Ни упрощения, ни оптимизации, ни переупорядочивания путей здесь нет и быть
не может: любое из этого разорвало бы соответствие точек. Совпадение
проверяется утверждениями ниже и печатается в отчёт.

── КАК ПОЛУЧЕНЫ ЦЕЛЕВЫЕ СООТНОШЕНИЯ ─────────────────────────────────────────
Цели (замеры арт-директора на референсе, переход раскрытое → сжатое):
    высота прописной     ÷ 1.712
    горизонтальный штрих ÷ 2.833
    вертикальный штрих   × 1.000
    ширина слова         постоянна

У Unbounded одна ось, wght. Обозначим для веса w:
    C      высота прописной в юнитах (у Unbounded константа 750)
    H(w)   толщина горизонтали — высота перекладины T
    V(w)   толщина вертикали   — ширина стойки I
    W(w)   ширина чернил слова
и пусть состояние масштабируется неравномерно на (sx, sy), а между литерами
добавляется трекинг t. Тогда на экране:
    cap = C·sy        горизонталь = H(w)·sy
    вертикаль = V(w)·sx        ширина = W(w)·sx + 5t

Отсюда отношение cap к горизонтали зависит ТОЛЬКО от веса, и первое
уравнение решается по весам:
    H(wA)/H(wB) = R_гор / R_выс = 2.833 / 1.712 = 1.6548
При wA = 900 это даёт wB = 467.2 (найдено бинарным поиском по замеру).

Дальше:
    sy_A / sy_B = R_выс = 1.712
    sx_B / sx_A = V(wA)/V(wB) = 258/157 = 1.643
и трекинг добирает ширину до одинаковой.

── ЧТО ИЗ ЭТОГО СЛЕДУЕТ, И ЭТО НАДО ЗНАТЬ ───────────────────────────────────
Сжатое состояние получает горизонтальный масштаб в 1.643 раза больше
раскрытого, а его чернила при этом уже на 6 % уже. В сумме чернила сжатого
состояния шире чернил раскрытого в 1.54 раза. Ширина слова обязана остаться
прежней — значит, разницу забирают межбуквенные просветы: в раскрытом
состоянии они большие, в сжатом их нет.

Это не выбор, а следствие целевых чисел и метрик Unbounded. Перебор всех
допустимых пар весов даёт от 35.1 % до 37.8 % ширины в просветах;
пара 900/467 — минимум.

Итог читается так: слово начинает разреженным и высоким, а сжимаясь,
литеры сдвигаются вплотную и расплющиваются. Движение осмысленное.

── РУЧКА ПРОПОРЦИИ ──────────────────────────────────────────────────────────
Относительное искажение между состояниями задано целями и равно 2.813.
Свободен только выбор, КУДА его положить. ASPECT — во сколько раз ужато
раскрытое состояние относительно натуральных пропорций Unbounded:
    ASPECT = 1.000  раскрытое натуральное, сжатое растянуто в 2.81 раза
    ASPECT = 1.678  искажение поровну, по 1.68 в каждую сторону
    ASPECT = 2.813  сжатое натуральное, раскрытое ужато в 2.81 раза
Чем больше ASPECT, тем крупнее вордмарк по высоте и тем уже литеры
в раскрытом состоянии.
"""
import io, json, math, os, sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

SRC = 'node_modules/@fontsource-variable/unbounded/files/unbounded-latin-wght-normal.woff2'
WORD = 'SPOTIK'
OUT = 'lib/wordmark.data.ts'

R_CAP = 1.712   # во сколько раз падает высота прописной
R_HOR = 2.833   # во сколько раз худеет горизонтальный штрих
R_VER = 1.000   # вертикальный штрих не меняется

W_OPEN = 900.0          # раскрытое состояние — самое жирное начертание
ASPECT = float(os.environ.get('WM_ASPECT', '2.05'))
NORM_WIDTH = 1000.0     # нормированная ширина чернил, одинаковая у обоих состояний

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
    """Контуры литеры как список списков (x, y, on_curve). Без изменений формы."""
    glyf = f['glyf']
    gn = f.getBestCmap()[ord(ch)]
    g = glyf[gn]
    g.expand(glyf)
    assert not g.isComposite(), f'{ch} составной, соответствие точек не гарантировано'
    co = g.coordinates
    flags = g.flags
    ends = list(g.endPtsOfContours)
    out = []
    s = 0
    for e in ends:
        out.append([(co[j][0], co[j][1], bool(flags[j] & 1)) for j in range(s, e + 1)])
        s = e + 1
    return out, f['hmtx'][gn][0], g.xMin, g.xMax


def measure(w):
    f = load(w)
    T, _, _, _ = glyph_contours(f, 'T')
    I, _, _, _ = glyph_contours(f, 'I')
    bar = max(T, key=lambda c: max(p[0] for p in c) - min(p[0] for p in c))
    H = max(p[1] for p in bar) - min(p[1] for p in bar)
    V = max(p[0] for p in I[0]) - min(p[0] for p in I[0])
    adv = 0
    lo, hi = None, None
    for ch in WORD:
        _, a, xmin, xmax = glyph_contours(f, ch)
        lo = adv + xmin if lo is None else min(lo, adv + xmin)
        hi = adv + xmax if hi is None else max(hi, adv + xmax)
        adv += a
    return {'H': H, 'V': V, 'C': 750.0, 'W': hi - lo, 'left': lo}


def solve_tight_weight():
    """Вес сжатого состояния: единственное, что задаёт отношение cap к горизонтали."""
    need = R_HOR / R_CAP
    target = measure(W_OPEN)['H'] / need
    lo, hi = 200.0, W_OPEN
    for _ in range(46):
        mid = (lo + hi) / 2
        if measure(mid)['H'] > target:
            hi = mid
        else:
            lo = mid
    return (lo + hi) / 2


def to_segments(contours):
    """
    Контуры TrueType → последовательность команд SVG.

    Между двумя off-curve точками формат подразумевает точку на кривой
    посередине. Мы делаем её явной: тогда список команд у обоих состояний
    совпадает буква в букву, а подразумеваемая точка — линейная функция
    соседних, поэтому интерполяция от этого не страдает.
    """
    result = []
    for pts in contours:
        n = len(pts)
        start_i = next((i for i, p in enumerate(pts) if p[2]), None)
        if start_i is None:
            # контур целиком из off-curve: начинаем с подразумеваемой середины
            sx = (pts[0][0] + pts[-1][0]) / 2
            sy = (pts[0][1] + pts[-1][1]) / 2
            seq = pts[:]
            start = (sx, sy)
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


def build_state(w, sx, sy, track, left0):
    """Точки слова в нормированных координатах: x вправо, y ВНИЗ (как в SVG)."""
    f = load(w)
    all_c = []
    adv = 0.0
    for idx, ch in enumerate(WORD):
        cont, a, _, _ = glyph_contours(f, ch)
        dx = adv * sx + idx * track - left0
        for seg in to_segments(cont):
            all_c.append({
                'ops': seg['ops'],
                'coords': [(x * sx + dx, -y * sy) for (x, y) in seg['coords']],
            })
        adv += a
    return all_c


def main():
    w_tight = solve_tight_weight()
    mo, mt = measure(W_OPEN), measure(w_tight)

    # Относительные масштабы из уравнений
    ratio_sx = (mo['V'] / mt['V']) * R_VER          # sx_B / sx_A
    ratio_sy = 1.0 / R_CAP                          # sy_B / sy_A

    # Раскрытое состояние ужато по горизонтали в ASPECT раз относительно
    # натуральных пропорций: sx_A = sy_A / ASPECT.
    # Масштаб выбираем так, чтобы у сжатого состояния трекинг был нулевым —
    # это его предел, дальше литеры начали бы налезать друг на друга.
    sx_a = 1.0
    sx_b = sx_a * ratio_sx
    sy_a = sx_a * ASPECT
    sy_b = sy_a * ratio_sy

    ink_a = mo['W'] * sx_a
    ink_b = mt['W'] * sx_b
    total = max(ink_a, ink_b)                       # общая ширина слова
    track_a = (total - ink_a) / (len(WORD) - 1)
    track_b = (total - ink_b) / (len(WORD) - 1)
    assert track_a >= -1e-9 and track_b >= -1e-9, 'трекинг ушёл в минус'

    # нормируем так, чтобы ширина чернил была ровно NORM_WIDTH у обоих
    k = NORM_WIDTH / total
    sx_a, sy_a, track_a = sx_a * k, sy_a * k, track_a * k
    sx_b, sy_b, track_b = sx_b * k, sy_b * k, track_b * k

    A = build_state(W_OPEN, sx_a, sy_a, track_a, mo['left'] * sx_a)
    B = build_state(w_tight, sx_b, sy_b, track_b, mt['left'] * sx_b)

    # ── проверка соответствия точек ──────────────────────────────────────
    assert len(A) == len(B), 'разное число контуров'
    for i, (a, b) in enumerate(zip(A, B)):
        assert a['ops'] == b['ops'], f'контур {i}: разная последовательность команд'
        assert len(a['coords']) == len(b['coords']), f'контур {i}: разное число точек'
    n_contours = len(A)
    n_points = sum(len(c['coords']) for c in A)
    n_cmds = sum(len(c['ops']) for c in A)

    # Габариты чернил: у S и O есть свес ниже базовой линии и выше высоты
    # прописной. Именно его резал contain: paint в прошлой итерации, поэтому
    # рамка обязана включать свес, а не заканчиваться на базовой линии.
    def box(state):
        xs = [c[0] for seg in state for c in seg['coords']]
        ys = [c[1] for seg in state for c in seg['coords']]
        return min(xs), min(ys), max(xs), max(ys)
    bax = box(A); bbx = box(B)
    box_y0 = min(bax[1], bbx[1])   # верх (y растёт вниз, значит это минимум)
    box_y1 = max(bax[3], bbx[3])   # низ, включая свес под базовой линией

    cap_a = mo['C'] * sy_a
    cap_b = mt['C'] * sy_b
    hor_a, hor_b = mo['H'] * sy_a, mt['H'] * sy_b
    ver_a, ver_b = mo['V'] * sx_a, mt['V'] * sx_b

    print('── РЕШЕНИЕ ──────────────────────────────────────────────────────')
    print('вес раскрытого  %.1f' % W_OPEN)
    print('вес сжатого     %.2f  (найден по отношению cap к горизонтали)' % w_tight)
    print('ASPECT          %.3f  (ужатие раскрытого относительно натурального)' % ASPECT)
    print('масштабы        раскрытое sx %.4f sy %.4f трекинг %.1f' % (sx_a, sy_a, track_a))
    print('                сжатое    sx %.4f sy %.4f трекинг %.1f' % (sx_b, sy_b, track_b))
    print()
    print('── ГЕОМЕТРИЯ В НОРМИРОВАННЫХ ЕДИНИЦАХ (ширина слова = 1000) ─────')
    print('                     раскрытое   сжатое   отношение   цель   расхождение')
    for name, a, b, target in (
        ('высота прописной', cap_a, cap_b, R_CAP),
        ('горизонт. штрих ', hor_a, hor_b, R_HOR),
        ('вертик. штрих   ', ver_a, ver_b, R_VER),
    ):
        got = a / b
        print('%s %10.2f %8.2f %11.4f %6.3f %+11.2f%%'
              % (name, a, b, got, target, (got - target) / target * 100))
    print('ширина чернил    %10.2f %8.2f' % (mo['W'] * sx_a, mt['W'] * sx_b))
    print('просвет между литерами %6.2f %8.2f  (%.1f%% и %.1f%% ширины слова)'
          % (track_a, track_b, track_a * 5 / NORM_WIDTH * 100, track_b * 5 / NORM_WIDTH * 100))
    print()
    print('── ТОПОЛОГИЯ ────────────────────────────────────────────────────')
    print('контуров %d, команд %d, точек %d — совпадает в обоих состояниях'
          % (n_contours, n_cmds, n_points))
    print('габариты чернил по y: %.2f … %.2f  (свес под базовой линией %.2f)'
          % (box_y0, box_y1, box_y1))

    # ── запись ───────────────────────────────────────────────────────────
    ops_flat, lens, coords_a, coords_b = [], [], [], []
    for a, b in zip(A, B):
        lens.append(len(a['ops']))
        ops_flat.extend(a['ops'])
        for (x, y) in a['coords']:
            coords_a.extend([round(x, 2), round(y, 2)])
        for (x, y) in b['coords']:
            coords_b.extend([round(x, 2), round(y, 2)])

    def arr(v, per=12):
        rows = []
        for i in range(0, len(v), per):
            rows.append('  ' + ','.join('%g' % x for x in v[i:i + per]) + ',')
        return '\n'.join(rows)

    ts = '''// СГЕНЕРИРОВАНО scripts/build-wordmark.py — руками не править.
//
// Слово SPOTIK, запечённое в контуры из вариативного бинарника Unbounded
// в двух состояниях. Оба состояния имеют одинаковую топологию: одно и то же
// число контуров, одну и ту же последовательность команд и одно и то же
// число точек, поэтому при морфе точки только двигаются.
//
// Координаты нормированы: ширина чернил ровно %g у обоих состояний,
// базовая линия на y = 0, ось y направлена вниз как в SVG.
//
// контуров %d, команд %d, точек %d
// вес раскрытого %g, вес сжатого %.2f, ASPECT %.3f

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

/** Сжатое состояние: пары x, y, ровно столько же и в том же порядке. */
export const WM_TIGHT = new Float32Array([
%s
]);

/** Ширина чернил слова в нормированных единицах, одинакова у обоих состояний. */
export const WM_WIDTH = %g;

/** Высота прописной: раскрытое и сжатое, в тех же единицах. */
export const WM_CAP_OPEN = %.3f;
export const WM_CAP_TIGHT = %.3f;

/**
 * Габариты чернил по вертикали, объединение обоих состояний.
 * Включают свес S и O ниже базовой линии: именно его в прошлой итерации
 * срезал contain: paint, и рамка обязана его вмещать.
 */
export const WM_BOX_TOP = %.3f;
export const WM_BOX_BOTTOM = %.3f;
''' % (NORM_WIDTH, n_contours, n_cmds, n_points, W_OPEN, w_tight, ASPECT,
       arr(lens), arr(ops_flat, 24), arr(coords_a), arr(coords_b),
       NORM_WIDTH, cap_a, cap_b, box_y0, box_y1)

    with open(OUT, 'w') as fh:
        fh.write(ts)
    print('\nзаписано %s  (%.1f КБ)' % (OUT, len(ts) / 1024))
    json.dump({'capOpen': cap_a, 'capTight': cap_b, 'weightTight': w_tight,
               'trackOpen': track_a, 'trackTight': track_b, 'aspect': ASPECT,
               'points': n_points, 'contours': n_contours},
              open('.shots/wordmark-solve.json', 'w'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    os.makedirs('.shots', exist_ok=True)
    main()
