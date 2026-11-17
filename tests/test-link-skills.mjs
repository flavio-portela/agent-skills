// Tests for the Node+ink skill installer (scripts/link-skills.mjs).
//
// Two seams, transposing the old bash suite's two layers one-to-one:
//
// Seam 1: the picker's function interface. The real picker is driven with
// ink-testing-library and simulated stdin (no terminal); the entry point is
// run in-process with a scripted picker stub that records the candidate data
// it was given, so the filesystem assertions exercise the real install code.
//
// Seam 2: the command line. The real process is spawned as a user would run
// it. Guard tests run without a terminal; the tmux runs at the bottom drive
// the real picker through a pseudo-terminal (skipped when tmux is missing).
//
// Run: node --test tests/test-link-skills.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {cpSync, existsSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {render as inkRender} from 'ink-testing-library';
import {pickSkills} from '../installer/picker.mjs';
import {main} from '../installer/entry.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(REPO, 'scripts', 'link-skills.mjs');

const tick = (ms = 50) => new Promise(r => setTimeout(r, ms));
const stripAnsi = s => s.replace(/\x1b\[[0-9;]*m/g, '');
const freshDir = prefix => mkdtempSync(join(tmpdir(), prefix));

// Spawn the real installer as a user would. Stdio is plain pipes, so stdin
// is never a TTY unless a pty layer wraps it.
function runProcess(args, {bin = BIN, cwd = REPO} = {}) {
  return new Promise(resolveResult => {
    const child = spawn(process.execPath, [bin, ...args], {cwd, stdio: ['pipe', 'pipe', 'pipe']});
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => stdout += d);
    child.stderr.on('data', d => stderr += d);
    child.on('close', code => resolveResult({code, stdout, stderr}));
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Seam 2: guards (real process, no terminal)

test('help works without a TTY and documents the flow', async () => {
  const {code, stdout} = await runProcess(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage:/);
});

test('unknown options are rejected with usage before any effect', async () => {
  const base = freshDir('lks-unknown-');
  const {code, stderr} = await runProcess(['--bogus', base]);
  assert.equal(code, 1);
  assert.match(stderr, /unknown option/);
  assert.match(stderr, /Usage:/);
  assert.ok(!existsSync(join(base, '.claude')), 'no effect before argument parsing succeeds');
  rmSync(base, {recursive: true, force: true});
});

test('missing dependencies are a clean error pointing at the one-time install', async () => {
  // A copy of the tool without node_modules: the import of the picker (and
  // its dependencies) must fail into the clean error, not a stack trace.
  const fakeRepo = freshDir('lks-nodeps-');
  cpSync(join(REPO, 'package.json'), join(fakeRepo, 'package.json'));
  cpSync(join(REPO, 'scripts'), join(fakeRepo, 'scripts'), {recursive: true});
  cpSync(join(REPO, 'installer'), join(fakeRepo, 'installer'), {recursive: true});
  const {code, stderr} = await runProcess([join(fakeRepo, 'base')], {bin: join(fakeRepo, 'scripts', 'link-skills.mjs')});
  assert.equal(code, 1);
  assert.match(stderr, /npm install/);
  assert.doesNotMatch(stderr, /Error \[|at /, 'clean error, no stack trace');
  assert.ok(!existsSync(join(fakeRepo, 'base')), 'installs nothing');
  rmSync(fakeRepo, {recursive: true, force: true});
});

test('non-TTY stdin is a clean error and installs nothing', async () => {
  const base = freshDir('lks-ntty-');
  const {code, stderr} = await runProcess([base]);
  assert.equal(code, 1);
  assert.match(stderr, /terminal/);
  assert.deepEqual(readdirSync(base), [], 'installs nothing');
  rmSync(base, {recursive: true, force: true});
});

// ---------------------------------------------------------------------------
// Seam 1: the real picker, driven with simulated stdin (no terminal)

// Test-local scan of the repo, independent of the entry point's own scan,
// so the picker's list assertions hold against the repo, not the code.
function walkSkillMd(dir) {
  const out = [];
  for (const entry of readdirSync(dir, {withFileTypes: true})) {
    if (entry.name === 'node_modules') continue;
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkSkillMd(p));
    else if (entry.isFile() && entry.name === 'SKILL.md') out.push(p);
  }
  return out;
}

// The frontmatter description rules, as the old tool applied them: the
// first description line, surrounding quotes stripped, escaped quotes
// unescaped.
function extractDescription(markdown) {
  const m = /^description:[ \t]*(.*)$/m.exec(markdown);
  if (!m) return '';
  let d = m[1];
  if (d.startsWith('"')) d = d.slice(1);
  if (d.endsWith('"')) d = d.slice(0, -1);
  return d.replaceAll('\\"', '"');
}

function repoCandidates() {
  const out = [];
  for (const bucket of ['engineering', 'productivity']) {
    const dir = join(REPO, 'skills', bucket);
    if (!existsSync(dir)) continue;
    for (const skillMd of walkSkillMd(dir).sort()) {
      const source = dirname(skillMd);
      out.push({name: basename(source), bucket, description: extractDescription(readFileSync(skillMd, 'utf8')), source});
    }
  }
  return out;
}

function renderPicker(candidates, {onResult = () => {}} = {}) {
  let ui;
  const result = pickSkills({candidates, bases: ['/nonexistent/base'], mode: 'link'}, tree => {
    ui = inkRender(tree);
    return ui;
  });
  result.then(onResult);
  ui.stdout.rows = 100;
  ui.stdout.emit('resize');
  return ui;
}

const ROW_RE = /^[> ] \[[x ]\] /;
const rowsOf = frame => frame.split('\n').filter(line => ROW_RE.test(line));

test('picker lists every skill, grouped by bucket, with name, bucket tag and description', async () => {
  const candidates = repoCandidates();
  assert.ok(candidates.length >= 10, 'sanity: the repo lists a healthy number of skills');
  const {lastFrame, unmount} = renderPicker(candidates);
  await tick();
  const frame = stripAnsi(lastFrame());
  const rows = rowsOf(frame);
  assert.equal(rows.length, candidates.length, `one row per skill, no wrapping:\n${frame}`);
  assert.deepEqual(
    rows.map(row => row.replace(ROW_RE, '').split(' ')[0]),
    candidates.map(c => c.name),
    'rows are grouped by bucket (engineering first, then productivity), alphabetical within each bucket',
  );
  for (const [i, c] of candidates.entries()) {
    const row = rows[i];
    assert.ok(row.includes(`(${c.bucket})`), `row for ${c.name} carries its bucket tag`);
    assert.ok(row.includes(c.description.slice(0, 12)), `row for ${c.name} carries its one-line description`);
  }
  unmount();
});

test('picker pre-selects every skill at launch', async () => {
  const candidates = repoCandidates();
  const {lastFrame, unmount} = renderPicker(candidates);
  await tick();
  const checked = rowsOf(stripAnsi(lastFrame())).filter(row => row.includes('[x]')).length;
  assert.equal(checked, candidates.length);
  unmount();
});

test('picker shows the key map in a footer at all times', () => {
  const {lastFrame, unmount} = renderPicker(repoCandidates());
  const frame = stripAnsi(lastFrame());
  for (const token of ['move', 'toggle', 'select all', 'deselect all', 'filter', 'install', 'abort']) {
    assert.ok(frame.includes(token), `footer mentions ${token}:\n${frame}`);
  }
  unmount();
});

const sampleCandidates = [
  {name: 'alpha', bucket: 'engineering', description: 'Build dependable tools', source: '/skills/alpha'},
  {name: 'beta', bucket: 'engineering', description: 'Review code', source: '/skills/beta'},
  {name: 'gamma', bucket: 'productivity', description: 'Write notes', source: '/skills/gamma'},
];

async function drivePicker(t, candidates = sampleCandidates) {
  let result;
  const ui = renderPicker(candidates, {onResult: value => result = value});
  t.after(() => ui.unmount());
  await tick();
  return {
    frame: () => stripAnsi(ui.lastFrame()),
    result: () => result,
    key: async input => { ui.stdin.write(input); await tick(input === '\x1b' ? 150 : 50); },
  };
}

test('picker toggles rows and supports both movement bindings', async t => {
  const ui = await drivePicker(t);
  await ui.key(' ');
  await ui.key('j');
  assert.match(ui.frame(), /> \[x\] beta/);
  await ui.key('\x1b[B');
  assert.match(ui.frame(), /> \[x\] gamma/);
  await ui.key('k');
  await ui.key('\x1b[A');
  assert.match(ui.frame(), /> \[ \] alpha/);
  await ui.key('\r');
  assert.deepEqual(ui.result(), {kind: 'selected', names: ['beta', 'gamma']});
});

test('picker confirms all skills by default', async t => {
  const ui = await drivePicker(t);
  await ui.key('\r');
  assert.deepEqual(ui.result(), {kind: 'selected', names: ['alpha', 'beta', 'gamma']});
});

for (const selectAll of [false, true]) {
  test(`picker deselect-all then select-all (${selectAll}) returns the explicit selection result`, async t => {
    const ui = await drivePicker(t);
    await ui.key('x');
    if (selectAll) await ui.key('a');
    await ui.key('\r');
    assert.deepEqual(ui.result(), selectAll
      ? {kind: 'selected', names: ['alpha', 'beta', 'gamma']}
      : {kind: 'empty'});
  });
}

for (const key of ['\x1b', '\x03']) {
  test(`picker aborts on ${JSON.stringify(key)}`, async t => {
    const ui = await drivePicker(t);
    await ui.key(key);
    assert.deepEqual(ui.result(), {kind: 'aborted'});
  });
}

test('picker filter matches name or description subsequences and isolates typing from list actions', async t => {
  const ui = await drivePicker(t);
  await ui.key('/');
  for (const key of ['A', 'P', 'H']) await ui.key(key);
  assert.equal(rowsOf(ui.frame()).length, 1);
  assert.match(ui.frame(), /alpha/);
  assert.match(ui.frame(), /back to list/);
  await ui.key('\x1b');
  assert.equal(ui.result(), undefined, 'escape leaves the filter rather than aborting');
  assert.equal(rowsOf(ui.frame()).filter(row => row.includes('[x]')).length, 1, 'typing a never deselects any row');
  await ui.key('/');
  for (let i = 0; i < 3; i++) await ui.key('\x7f');
  for (const key of ['r', 'v', 'c']) await ui.key(key);
  assert.equal(rowsOf(ui.frame()).length, 1);
  assert.match(ui.frame(), /beta/);
  await ui.key('z');
  assert.match(ui.frame(), /No skills match/);
  await ui.key('\x03');
  assert.deepEqual(ui.result(), {kind: 'aborted'});
});

for (const selectAll of [false, true]) {
  test(`picker all-selection keys apply to the whole selection even while filtered (${selectAll})`, async t => {
    const ui = await drivePicker(t);
    await ui.key('/');
    await ui.key('b');
    await ui.key('\x1b');
    await ui.key('x');
    if (selectAll) await ui.key('a');
    await ui.key('\r');
    assert.deepEqual(ui.result(), selectAll
      ? {kind: 'selected', names: ['alpha', 'beta', 'gamma']}
      : {kind: 'empty'});
  });
}

test('picker scrolls the list and keeps the key map visible in a short terminal', async t => {
  const candidates = Array.from({length: 50}, (_, i) => ({
    name: `skill-${i}`, bucket: 'engineering', description: 'A useful skill', source: `/skills/${i}`,
  }));
  const ui = renderPicker(candidates);
  t.after(() => ui.unmount());
  ui.stdout.rows = 10;
  ui.stdout.emit('resize');
  await tick();
  for (let i = 0; i < 49; i++) { ui.stdin.write('j'); await tick(20); }
  const frame = stripAnsi(ui.lastFrame());
  assert.ok(frame.split('\n').length <= 10, frame);
  assert.match(frame, /> \[x\] skill-49/);
  assert.match(frame, /filter/);
  assert.match(frame, /abort/);
});

// Seam 1: entry contract with a scripted picker and real filesystem.
async function runEntry(args, result, run = main) {
  const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
  const log = console.log;
  const error = console.error;
  const stdout = [];
  const stderr = [];
  let input;
  Object.defineProperty(process.stdin, 'isTTY', {value: true, configurable: true});
  console.log = line => stdout.push(line);
  console.error = line => stderr.push(line);
  try {
    const code = await run(args, {pick: async data => {
      input = data;
      return typeof result === 'function' ? result(data) : result;
    }});
    return {code, input, stdout: stdout.join('\n'), stderr: stderr.join('\n')};
  } finally {
    console.log = log;
    console.error = error;
    if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
    else delete process.stdin.isTTY;
  }
}

test('entry defaults to the home base directory', async () => {
  const {input, code} = await runEntry([], {kind: 'empty'});
  assert.equal(code, 0);
  assert.deepEqual(input.bases, [homedir()]);
});

test('entry discovers new nested skills, ignores node_modules, and extracts the first description with legacy quoting', async t => {
  const repo = freshDir('lks-scan-');
  t.after(() => rmSync(repo, {recursive: true, force: true}));
  mkdirSync(join(repo, 'installer'));
  cpSync(join(REPO, 'installer/entry.mjs'), join(repo, 'installer/entry.mjs'));
  for (const [path, description] of [
    ['skills/engineering/nested/zed', String.raw`"Say \"hello\""`],
    ['skills/engineering/alpha', 'Plain first line'],
    ['skills/engineering/node_modules/ignored', 'Not a skill'],
  ]) {
    mkdirSync(join(repo, path), {recursive: true});
    writeFileSync(join(repo, path, 'SKILL.md'), `---\nname: unused\ndescription: ${description}\n  continuation ignored\n---\ndescription: not the first\n`);
  }
  const {main: fixtureMain} = await import(pathToFileURL(join(repo, 'installer/entry.mjs')));
  const {input} = await runEntry([join(repo, 'base')], {kind: 'empty'}, fixtureMain);
  assert.deepEqual(input.candidates, [
    {name: 'alpha', bucket: 'engineering', description: 'Plain first line', source: join(repo, 'skills/engineering/alpha')},
    {name: 'zed', bucket: 'engineering', description: 'Say "hello"', source: join(repo, 'skills/engineering/nested/zed')},
  ]);
});

test('entry scans every skill and links the selection into both harnesses of every base', async t => {
  const dir = freshDir('lks-contract-');
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  const bases = [join(dir, 'base a'), join(dir, 'base b')];
  const {code, input, stdout} = await runEntry(bases, {kind: 'selected', names: ['tdd', 'code-review']});
  assert.equal(code, 0);
  assert.deepEqual(input.bases, bases);
  assert.equal(input.mode, 'link');
  assert.deepEqual(input.candidates, repoCandidates());
  const lines = [];
  for (const base of bases) {
    for (const sub of ['.claude/skills', '.agents/skills']) {
      const dest = join(base, sub);
      assert.deepEqual(readdirSync(dest), ['code-review', 'tdd']);
      for (const name of ['code-review', 'tdd']) {
        const source = join(REPO, 'skills/engineering', name);
        assert.ok(lstatSync(join(dest, name)).isSymbolicLink());
        assert.equal(readlinkSync(join(dest, name)), source);
        lines.push(`linked ${name} -> ${source} (${dest})`);
      }
    }
  }
  assert.equal(stdout, lines.join('\n'));
});

test('entry replaces selected directories, files and links but leaves all unselected entries untouched', async t => {
  const base = freshDir('lks-additive-');
  t.after(() => rmSync(base, {recursive: true, force: true}));
  for (const sub of ['.claude/skills', '.agents/skills']) {
    const dest = join(base, sub);
    mkdirSync(join(dest, 'tdd'), {recursive: true});
    writeFileSync(join(dest, 'tdd/old'), 'replace me');
    symlinkSync('/missing/old-source', join(dest, 'pr'));
    writeFileSync(join(dest, 'wizard'), 'replace file');
    mkdirSync(join(dest, 'foreign'));
    writeFileSync(join(dest, 'foreign/NOTE'), 'hand edited');
    symlinkSync('/missing/keep', join(dest, 'teach'));
  }
  const {code} = await runEntry([base], {kind: 'selected', names: ['tdd', 'pr', 'wizard']});
  assert.equal(code, 0);
  for (const sub of ['.claude/skills', '.agents/skills']) {
    const dest = join(base, sub);
    for (const name of ['tdd', 'pr', 'wizard']) {
      assert.equal(readlinkSync(join(dest, name)), join(REPO, 'skills/engineering', name));
    }
    assert.equal(readFileSync(join(dest, 'foreign/NOTE'), 'utf8'), 'hand edited');
    assert.equal(readlinkSync(join(dest, 'teach')), '/missing/keep');
    assert.deepEqual(readdirSync(dest).sort(), ['foreign', 'pr', 'tdd', 'teach', 'wizard']);
  }
});

for (const viaParent of [false, true]) {
  test(`entry preflights all harness skill directories and refuses repo symlinks (parent: ${viaParent})`, async t => {
    const dir = freshDir('lks-repo-guard-');
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    const first = join(dir, 'first');
    const bad = join(dir, 'bad');
    // Use a disposable repo so a regressed guard cannot damage real skills.
    const repo = join(dir, 'repo');
    const source = join(repo, 'skills/engineering/tdd');
    mkdirSync(source, {recursive: true});
    const markdown = '---\nname: tdd\ndescription: A fixture skill\n---\n';
    writeFileSync(join(source, 'SKILL.md'), markdown);
    mkdirSync(join(repo, 'installer'));
    cpSync(join(REPO, 'installer/entry.mjs'), join(repo, 'installer/entry.mjs'));
    const {main: fixtureMain} = await import(pathToFileURL(join(repo, 'installer/entry.mjs')));
    mkdirSync(join(bad, '.agents'), {recursive: true});
    if (viaParent) symlinkSync(join(repo, 'skills'), join(bad, '.claude'));
    else symlinkSync(join(repo, 'skills/engineering'), join(bad, '.agents/skills'));
    const {code, stderr} = await runEntry([first, bad], {kind: 'selected', names: ['tdd']}, fixtureMain);
    assert.equal(code, 1);
    assert.match(stderr, /symlink.*repo/);
    assert.ok(!existsSync(first), 'guard runs before any base is modified');
    assert.ok(!existsSync(join(bad, '.agents/skills')) || !viaParent);
    assert.deepEqual(readdirSync(join(repo, 'skills')), ['engineering']);
    assert.deepEqual(readdirSync(join(repo, 'skills/engineering')), ['tdd']);
    assert.ok(!lstatSync(source).isSymbolicLink());
    assert.deepEqual(readdirSync(source), ['SKILL.md']);
    assert.equal(readFileSync(join(source, 'SKILL.md'), 'utf8'), markdown);
  });
}

const hasTmux = spawnSync('tmux', ['-V']).status === 0;
const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";

for (const scenario of [
  {name: 'Enter installs all into the default home base', keys: ['Enter'], code: 0, install: true},
  {name: 'Esc aborts', keys: ['Escape'], code: 130, message: 'Aborted'},
  {name: 'ctrl+c aborts', keys: ['C-c'], code: 130, message: 'Aborted'},
  {name: 'empty selection is a no-op', keys: ['x', 'Enter'], code: 0, message: 'Nothing selected'},
]) {
  test(`real PTY: ${scenario.name}`, {skip: !hasTmux, timeout: 15000}, async t => {
    const dir = freshDir('lks-pty-');
    const base = join(dir, 'home');
    const rcFile = join(dir, 'rc');
    const socket = `lks-${process.pid}-${basename(dir)}`;
    const tmux = (...args) => spawnSync('tmux', ['-L', socket, ...args], {encoding: 'utf8'});
    t.after(() => {
      tmux('kill-server');
      rmSync(dir, {recursive: true, force: true});
    });
    const command = `env HOME=${shellQuote(base)} TERM=xterm-256color ${shellQuote(process.execPath)} ${shellQuote(BIN)}; printf '%s' "$?" > ${shellQuote(rcFile)}; sleep 30`;
    const started = tmux('new-session', '-d', '-s', 'installer', '-x', '120', '-y', '40', command);
    assert.equal(started.status, 0, started.stderr);
    let ready = false;
    for (let i = 0; i < 100; i++) {
      const frame = tmux('capture-pane', '-p', '-t', 'installer').stdout;
      if (frame.includes('Select skills to install') && frame.includes('abort')) { ready = true; break; }
      await tick();
    }
    assert.ok(ready, 'picker appears in the real terminal');
    for (const key of scenario.keys) {
      assert.equal(tmux('send-keys', '-t', 'installer', key).status, 0);
      await tick(150);
    }
    for (let i = 0; i < 100 && !existsSync(rcFile); i++) await tick();
    assert.ok(existsSync(rcFile), 'installer exits after the key');
    assert.equal(readFileSync(rcFile, 'utf8'), String(scenario.code));
    const output = tmux('capture-pane', '-p', '-S', '-1000', '-t', 'installer').stdout;
    if (scenario.install) {
      const candidates = repoCandidates();
      for (const sub of ['.claude/skills', '.agents/skills']) {
        assert.deepEqual(readdirSync(join(base, sub)).sort(), candidates.map(c => c.name).sort());
        for (const item of candidates) assert.equal(readlinkSync(join(base, sub, item.name)), item.source);
      }
      assert.match(output, /linked code-review ->/);
    } else {
      assert.ok(!existsSync(base), 'no installation effects');
      assert.ok(output.includes(scenario.message), output);
    }
  });
}

for (const kind of ['aborted', 'empty']) {
  test(`entry propagates ${kind} without creating any directories`, async t => {
    const dir = freshDir('lks-noop-');
    t.after(() => rmSync(dir, {recursive: true, force: true}));
    const base = join(dir, 'base');
    const {code, stdout, stderr} = await runEntry([base], {kind});
    assert.equal(code, kind === 'aborted' ? 130 : 0);
    assert.equal(kind === 'aborted' ? stderr : stdout,
      kind === 'aborted' ? 'Aborted. Nothing installed.' : 'Nothing selected. Nothing installed.');
    assert.ok(!existsSync(base));
  });
}
