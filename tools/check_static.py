#!/usr/bin/env python3
"""Phase 7.2 - the checks that need no build, no engine and no window.

Run by tools/check.sh and by the GitHub workflow on every push. Each one exists because the
thing it guards fails late and quietly otherwise:

  worlds      every arena in arenas.json parses; every entity has a modelRef (the loader rejects the
              whole world for one without) and a drawn one exists (`_gizmo_*` names a logic
              entity and is no file); one primary player_spawn; the
              wave plan names known creatures, known patterns and a known type; an objective
              wave has its site (without one it silently becomes an ordinary wave)
  assets      every assets/ path written as a literal in src/ exists
  generated   src/strings.ts is what tools/gen/strings_table.py writes (someone edited the
              generated file instead of the table)
  tables      every `KIND_*` table in src/ has as many entries as there are kinds (a short one
              is a TypeError the moment that kind is alive)
  hygiene     the player's files and .env are not tracked; nothing tracked is over 95 MB;
              every JSON under assets/ parses; every Python tool compiles

Prints one line per finding, `FAIL <check>: ...`, then a summary line. Exit 1 on any FAIL.
"""
import glob
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT)

KINDS = ['skitter', 'stalker', 'ravager', 'bruiser', 'colossus', 'spitter', 'bombard', 'matriarch']
LEGACY = ['dretch', 'mantis', 'marauder', 'dragoon', 'tyrant', 'adv_mantis', 'adv_marauder',
          'adv_dragoon', 'basilisk', 'adv_basilisk']
PATTERNS = ['round', 'front', 'ambush', 'flank', 'far', 'near', 'surround']
TYPES = ['kill', 'hold', 'nests']

fails = []
counts = {}


def fail(check, msg):
    fails.append('FAIL %s: %s' % (check, msg))


def tick(check, n=1):
    counts[check] = counts.get(check, 0) + n


def check_worlds():
    man = json.load(open('assets/worlds/arenas.json'))
    for a in man['arenas']:
        path = a['path']
        if not os.path.exists(path):
            fail('worlds', '%s is listed in arenas.json and does not exist' % path)
            continue
        try:
            w = json.load(open(path))
        except ValueError as e:
            fail('worlds', '%s does not parse: %s' % (path, e))
            continue
        name = os.path.basename(path)
        if 'terrain' not in w or not w['terrain']:
            fail('worlds', '%s has no terrain (everything stands at a NaN height)' % name)
        prim = 0
        spawners = 0
        roles = {}
        waves = None
        for e in w['entities']:
            ud = e.get('userData') or {}
            ref = e.get('modelRef')
            if not ref:
                fail('worlds', '%s: entity %s has no modelRef' % (name, e.get('id')))
            elif not os.path.basename(ref).startswith('_gizmo') and not os.path.exists(ref):
                fail('worlds', '%s: entity %s points at %s, which does not exist'
                     % (name, e.get('id'), ref))
            kind = ud.get('kind')
            if kind == 'player_spawn' and str(ud.get('primary', '0')) == '1':
                prim += 1
            if kind == 'enemy_spawner':
                spawners += 1
            if kind == 'objective':
                roles[ud.get('role')] = roles.get(ud.get('role'), 0) + 1
            if kind == 'wave_config':
                try:
                    waves = json.loads(ud.get('waves', '[]'))
                except ValueError as e2:
                    fail('worlds', '%s: wave_config.waves does not parse: %s' % (name, e2))
            tick('entities')
        if prim != 1:
            fail('worlds', '%s has %d primary player spawns (want 1)' % (name, prim))
        if spawners < 1:
            fail('worlds', '%s has no enemy_spawner' % name)
        if not waves:
            fail('worlds', '%s has no waves' % name)
            continue
        for i, wv in enumerate(waves):
            n = i + 1
            for raw in str(wv.get('enemy', '')).split(','):
                k = raw.strip().rstrip('!')
                if k not in KINDS and k not in LEGACY:
                    fail('worlds', '%s wave %d names an unknown creature "%s"' % (name, n, raw))
            total = 0
            for g in [x for x in str(wv.get('groups', '')).split(',') if x]:
                parts = g.split(':')
                if len(parts) != 3 or parts[1] not in PATTERNS:
                    fail('worlds', '%s wave %d has a bad group "%s"' % (name, n, g))
                    continue
                total += int(parts[0])
            if wv.get('groups') and total != int(wv.get('count', 0)):
                fail('worlds', '%s wave %d: groups hold %d, count says %s'
                     % (name, n, total, wv.get('count')))
            t = wv.get('type', 'kill')
            if t not in TYPES:
                fail('worlds', '%s wave %d has an unknown type "%s"' % (name, n, t))
            if t == 'hold' and roles.get('hold', 0) < 1:
                fail('worlds', '%s wave %d is a hold wave and the world has no hold site' % (name, n))
            if t == 'nests' and roles.get('nest', 0) < 1:
                fail('worlds', '%s wave %d is a nest wave and the world has no nest' % (name, n))
            tick('waves')
        tick('worlds')


# Literal paths the code tries and survives without (it asks fileExists first).
OPTIONAL = {
    'assets/music/music_boss.ogg',   # plan 5.5: the boss bed, made in Suno when Ralph gets to it
}


def check_asset_literals():
    rx = re.compile(r"""['"](assets/[A-Za-z0-9_./-]+\.[A-Za-z0-9]+)['"]""")
    for src in sorted(glob.glob('src/*.ts')):
        text = open(src, encoding='utf-8').read()
        for m in rx.finditer(text):
            p = m.group(1)
            line = text.count('\n', 0, m.start()) + 1
            start = text.rfind('\n', 0, m.start()) + 1
            full = text[start:text.find('\n', m.end())]
            if full.lstrip().startswith('//') or full.lstrip().startswith('*'):
                continue
            tick('asset paths')
            if os.path.exists(p) or p in OPTIONAL:
                continue
            # A path the same line guards with fileExists is allowed to be absent.
            if 'fileExists' in full:
                continue
            fail('assets', '%s:%d names %s, which does not exist' % (src, line, p))


def check_generated():
    target = 'src/strings.ts'
    before = open(target, 'rb').read()
    r = subprocess.run([sys.executable, 'tools/gen/strings_table.py'],
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    after = open(target, 'rb').read()
    if r.returncode != 0:
        fail('generated', 'tools/gen/strings_table.py failed: %s'
             % r.stdout.decode('utf-8', 'replace')[-300:])
    elif after != before:
        fail('generated', '%s is not what tools/gen/strings_table.py writes: edit the table, '
             'not the generated file' % target)
    open(target, 'wb').write(before)
    tick('generated')


def check_kind_tables():
    rx = re.compile(r'^(?:export )?const (KIND_[A-Z0-9_]+)(?::[^=]+)? = \[([^\]]*)\];', re.M)
    for src in sorted(glob.glob('src/*.ts')):
        text = open(src, encoding='utf-8').read()
        for m in rx.finditer(text):
            body = re.sub(r'//[^\n]*', '', m.group(2))
            n = len([x for x in body.split(',') if x.strip()])
            tick('kind tables')
            if n != len(KINDS):
                fail('tables', '%s: %s has %d entries, there are %d kinds'
                     % (src, m.group(1), n, len(KINDS)))


def check_hygiene():
    tracked = subprocess.run(['git', 'ls-files'], stdout=subprocess.PIPE).stdout.decode().split('\n')
    tracked = [t for t in tracked if t]
    for t in tracked:
        if t in ('settings.json', 'profile.json', 'level.txt', '.env') or t.endswith('/.env'):
            fail('hygiene', '%s is tracked and must not be' % t)
        if os.path.exists(t) and os.path.getsize(t) > 95 * 1024 * 1024:
            fail('hygiene', '%s is %d MB (GitHub refuses 100)' % (t, os.path.getsize(t) >> 20))
    tick('tracked files', len(tracked))
    for t in tracked:
        if t.startswith('assets/') and t.endswith('.json') and os.path.exists(t):
            try:
                json.load(open(t))
            except ValueError as e:
                fail('hygiene', '%s does not parse: %s' % (t, e))
        if t.startswith('tools/') and t.endswith('.py') and os.path.exists(t):
            try:
                compile(open(t, encoding='utf-8').read(), t, 'exec')
            except SyntaxError as e:
                fail('hygiene', '%s does not compile: %s' % (t, e))


def main():
    check_worlds()
    check_asset_literals()
    check_generated()
    check_kind_tables()
    check_hygiene()
    for f in fails:
        print(f)
    summary = ', '.join('%d %s' % (counts[k], k) for k in
                        ['worlds', 'waves', 'entities', 'asset paths', 'kind tables', 'tracked files']
                        if k in counts)
    print(('%d failed; ' % len(fails) if fails else '') + summary)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
