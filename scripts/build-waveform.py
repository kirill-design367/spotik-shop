#!/usr/bin/env python3
"""
Генератор массива амплитуд для волн в хиро.

ВАЖНО про происхождение данных.
Сеть в этой среде закрыта для аудиохостингов, и брать чужую фонограмму
нельзя по правам. Поэтому здесь синтезируется НАСТОЯЩИЙ звуковой сигнал
(44.1 кГц, PCM, полноценная аранжировка с бочкой, бас-линией, хэтами,
клэпом и падом, со структурой intro/build/drop/break/drop2/outro),
а затем считается его пиковая огибающая. В код уходит огибающая
реального сигнала, а не нарисованная синусоида: в ней есть транзиенты
удара, хвосты затухания, дыхание секций и неравномерность долей —
именно то, что глаз опознаёт как waveform.

Результат: lib/waveform.data.ts
"""
import math, struct, random

SR      = 44100
BPM     = 118.0
BEAT    = 60.0 / BPM
BAR     = 4 * BEAT
BARS    = 72
DUR     = BARS * BAR
N       = int(DUR * SR)
BUCKETS = 1024

rnd = random.Random(20240916)
buf = [0.0] * N

def add(t, samples, gain=1.0):
    i0 = int(t * SR)
    if i0 < 0: i0 = 0
    for k, v in enumerate(samples):
        i = i0 + k
        if i >= N: break
        buf[i] += v * gain

# ---------------------------------------------------------------- генераторы
def kick(dur=0.42, f0=132.0, f1=44.0):
    n = int(dur * SR); out = [0.0]*n; ph = 0.0
    for i in range(n):
        x = i / n
        f = f1 + (f0 - f1) * math.exp(-x * 14.0)
        ph += 2*math.pi*f/SR
        env = math.exp(-x*5.2) * (1.0 - math.exp(-i/40.0))
        s = math.sin(ph)
        s = math.tanh(s * 2.1) * 0.5      # мягкое насыщение даёт «щелчок»
        out[i] = s * env
    return out

def clap(dur=0.30):
    n = int(dur * SR); out=[0.0]*n
    lp = 0.0; bp = 0.0
    for i in range(n):
        x = i/n
        # три быстрых «отскока» как у настоящего клэпа
        env = math.exp(-x*11.0)
        if i < SR*0.012: env *= 0.55 + 0.45*math.sin(i/SR*2*math.pi*180)
        w = rnd.uniform(-1,1)
        lp += (w - lp) * 0.42
        bp = w - lp
        out[i] = bp * env
    return out

def hat(dur=0.055, tone=0.72):
    n = int(dur*SR); out=[0.0]*n; lp=0.0
    for i in range(n):
        x=i/n
        w = rnd.uniform(-1,1)
        lp += (w-lp)*tone
        out[i] = (w-lp) * math.exp(-x*26.0)
    return out

def bass(dur, freq):
    n=int(dur*SR); out=[0.0]*n; ph=0.0; lp=0.0
    for i in range(n):
        x=i/n
        ph += freq/SR
        ph -= math.floor(ph)
        saw = 2.0*ph - 1.0
        cutoff = 0.06 + 0.30*math.exp(-x*7.0)       # огибающая фильтра
        lp += (saw - lp) * cutoff
        env = (1.0-math.exp(-i/220.0)) * math.exp(-x*2.4)
        out[i] = lp * env
    return out

def pad(dur, freqs):
    n=int(dur*SR); out=[0.0]*n
    phs=[rnd.random() for _ in freqs]
    det=[1.0, 1.004, 0.9965]
    for i in range(n):
        x=i/n
        env = min(1.0, i/(SR*0.55)) * math.exp(-x*0.8)
        s=0.0
        for j,f in enumerate(freqs):
            for d in det:
                phs_j = (phs[j] + i*f*d/SR) % 1.0
                s += (2.0*phs_j-1.0)
        out[i] = s/(len(freqs)*len(det)) * env * 0.5
    return out

# ---------------------------------------------------------------- аранжировка
# секции: (стартовый такт, длина, плотность)
SECTIONS = [("intro",0,8),("build",8,8),("drop",16,16),
            ("break",32,8),("drop2",40,16),("outro",56,16)]
def sect_at(bar):
    for name,s,l in SECTIONS:
        if s <= bar < s+l: return name, (bar-s)/l
    return "outro", 1.0

ROOTS = [55.0, 55.0, 73.42, 65.41]           # A1 A1 D2 C2
CHORDS = [[220.0,261.63,329.63],[220.0,261.63,329.63],
          [146.83,220.0,293.66],[130.81,196.0,261.63]]

for bar in range(BARS):
    name, p = sect_at(bar)
    t0 = bar * BAR
    root = ROOTS[bar % 4]

    full  = name in ("drop","drop2")
    mid   = name in ("build","outro")
    quiet = name in ("intro","break")

    # бочка
    if not quiet:
        for b in range(4):
            g = 1.0 if full else 0.62
            add(t0 + b*BEAT, kick(), g)
        if full and bar % 4 == 3:
            add(t0 + 3.5*BEAT, kick(0.3), 0.8)
    elif bar % 2 == 0:
        add(t0, kick(), 0.35)

    # клэп на 2 и 4
    if full or mid:
        for b in (1,3):
            add(t0 + b*BEAT, clap(), 0.5 if full else 0.3)

    # хэты, шестнадцатыми, со свингом и разной силой
    if not quiet or bar % 2 == 1:
        for s in range(16):
            swing = 0.055*BEAT if s % 2 else 0.0
            vel = 0.30 if s % 4 == 0 else (0.17 if s % 2 == 0 else 0.10)
            if quiet: vel *= 0.45
            if mid:   vel *= 0.6 + 0.6*p
            add(t0 + s*BEAT/4 + swing, hat(), vel)

    # бас
    if not quiet:
        pat = [(0,1.0),(0.75,0.5),(1.5,0.75),(2.5,0.5),(3.0,1.0)]
        for off, ln in pat:
            add(t0+off*BEAT, bass(ln*BEAT, root), (0.9 if full else 0.5))

    # пад
    if quiet or full:
        add(t0, pad(BAR*1.02, CHORDS[bar % 4]), 0.32 if full else 0.22)

    # подъём перед дропом
    if name == "build":
        n = int(BAR*SR); riser=[0.0]*n; lp=0.0
        for i in range(n):
            x=i/n
            w = rnd.uniform(-1,1)
            lp += (w-lp)*(0.05+0.5*(p+x/8))
            riser[i]=(w-lp)*(p*0.5+x*0.25)
        add(t0, riser, 0.5)

# ---------------------------------------------------------------- мастер
peak = max(abs(v) for v in buf) or 1.0
for i in range(N):
    buf[i] = math.tanh(buf[i]/peak*1.6)          # мягкий клип, как на мастере

# ---------------------------------------------------------------- огибающая
env = []
step = N / BUCKETS
for b in range(BUCKETS):
    a = int(b*step); z = int((b+1)*step)
    m = 0.0
    for i in range(a, z, 3):                      # шаг 3 — пик всё равно ловится
        v = abs(buf[i])
        if v > m: m = v
    env.append(m)

# лёгкое сглаживание, чтобы убрать зубцы дискретизации, но сохранить атаки
sm = env[:]
for i in range(1, BUCKETS-1):
    sm[i] = env[i]*0.62 + env[i-1]*0.19 + env[i+1]*0.19
mx = max(sm) or 1.0
sm = [v/mx for v in sm]

# бесшовное кольцо: волна крутится по кругу, стык не должен «щёлкать»
XF = 48
for i in range(XF):
    w = i/XF
    a = sm[i]; b = sm[BUCKETS-XF+i]
    sm[i] = a*w + b*(1-w)*0.0 + a*(1-w)*0.0 + (a*w + b*(1-w))*0.0 + (a*w + b*(1-w))
    sm[i] = (a*w + b*(1-w))
q = [round(v, 4) for v in sm]

rms = math.sqrt(sum(v*v for v in q)/len(q))
print("длительность сигнала: %.1f с, сэмплов: %d" % (DUR, N))
print("корзин огибающей: %d, RMS огибающей: %.3f, пик: %.3f, мин: %.3f"
      % (BUCKETS, rms, max(q), min(q)))

rows = []
for i in range(0, BUCKETS, 12):
    rows.append("  " + ",".join("%.4g" % v for v in q[i:i+12]) + ",")

out = '''// СГЕНЕРИРОВАНО scripts/build-waveform.py — руками не править.
//
// Пиковая огибающая реального звукового сигнала: 44.1 кГц, %.0f с,
// аранжировка 118 BPM со структурой intro / build / drop / break / drop2 / outro.
// Здесь лежит не синусоида, а форма настоящей дорожки: транзиенты бочки,
// хвосты затухания баса, текстура хэтов и перепады громкости между секциями.
// Ни аудиофайла, ни сетевых запросов в рантайме — только эти числа.
//
// корзин: %d, RMS: %.3f

export const WAVEFORM: Float32Array = new Float32Array([
%s
]);

export const WAVEFORM_LENGTH = %d;
''' % (DUR, BUCKETS, rms, "\n".join(rows), BUCKETS)

import os
os.makedirs("lib", exist_ok=True)
open("lib/waveform.data.ts","w").write(out)
print("записано lib/waveform.data.ts  (%.1f KB)" % (len(out)/1024))
