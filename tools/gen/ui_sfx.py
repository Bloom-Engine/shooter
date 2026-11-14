#!/usr/bin/env python3
"""UI sounds (plan 4.2), synthesised: no service, no cost. Writes assets/sounds/ui_*.wav for
back, tab, tick, toggle, error and start. ui_move and ui_select predate this script.

    python3 tools/gen/ui_sfx.py        (run from the repository root; needs numpy)
"""
import numpy as np, wave
SR = 44100


def env(n, a, d):
    t = np.arange(n) / SR
    return np.minimum(1, t / a) * np.exp(-t / d)


def tone(f, dur, a=0.002, d=0.05, h=0.0, slide=0.0):
    n = int(SR * dur); t = np.arange(n) / SR
    ph = 2 * np.pi * (f * t + 0.5 * slide * t * t)
    s = np.sin(ph) + h * np.sin(2 * ph) * 0.5 + h * np.sin(3 * ph) * 0.25
    return s * env(n, a, d)


def noise(dur, d=0.01):
    n = int(SR * dur)
    return (np.random.RandomState(7).rand(n) * 2 - 1) * env(n, 0.0005, d)


def mix(*parts):
    n = max(len(p) for p in parts); o = np.zeros(n)
    for p in parts:
        o[:len(p)] += p
    return o


def delay(s, ms):
    return np.concatenate([np.zeros(int(SR * ms / 1000)), s])


def save(name, s, gain=0.6):
    s = s / max(1e-9, np.abs(s).max()) * gain
    fade = int(SR * 0.004); s[-fade:] *= np.linspace(1, 0, fade)
    w = wave.open('assets/sounds/' + name + '.wav', 'wb')
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((s * 32767).astype('<i2').tobytes()); w.close()
    print(name, round(len(s) / SR, 3), 's')


save('ui_back', mix(tone(520, 0.16, d=0.045, h=0.3, slide=-1400), noise(0.02) * 0.25))
save('ui_tab', mix(tone(700, 0.10, d=0.03, h=0.2), delay(tone(940, 0.12, d=0.035, h=0.2), 45), noise(0.015) * 0.2))
save('ui_tick', mix(tone(1500, 0.05, d=0.012, h=0.1), noise(0.012, 0.004) * 0.5), 0.4)
save('ui_toggle', mix(tone(880, 0.09, d=0.03, h=0.4), noise(0.02, 0.006) * 0.4), 0.5)
save('ui_error', mix(tone(170, 0.22, d=0.07, h=0.9), delay(tone(150, 0.2, d=0.06, h=0.9), 90)), 0.55)
save('ui_start', mix(tone(330, 0.5, a=0.004, d=0.16, h=0.5), delay(tone(495, 0.5, d=0.18, h=0.4), 70),
                     delay(tone(660, 0.7, d=0.25, h=0.3), 140), noise(0.03) * 0.2), 0.6)
