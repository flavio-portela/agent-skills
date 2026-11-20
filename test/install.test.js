import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { installSkills } from '../lib/install.js';

let tmpRoot;
let sourceDir;
let baseDir;

function makeSourceTree(dir) {
  const skill = (bucket, name, extra = {}) => {
    const d = path.join(dir, 'skills', bucket, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: test skill ${name}\n---\n`);
    for (const [file, content] of Object.entries(extra)) {
      writeFileSync(path.join(d, file), content);
    }
  };
  skill('engineering', 'alpha');
  skill('engineering', 'beta', { 'notes.md': 'beta supporting file' });
  skill('productivity', 'gamma');
}

before(() => {
  tmpRoot = path.join(tmpdir(), `agent-skills-test-${process.pid}`);
  mkdirSync(tmpRoot, { recursive: true });
  sourceDir = path.join(tmpRoot, 'source');
  makeSourceTree(sourceDir);
});

function freshBase(label) {
  const base = path.join(tmpRoot, `base-${label}`);
  mkdirSync(base, { recursive: true });
  return base;
}

test('installs every skill as a symlink into the agents harness dir', () => {
  const baseDir = freshBase('all');
  const result = installSkills({
    sourceDir,
    baseDir,
    skills: 'all',
    mode: 'symlink',
    harnessDirs: ['agents'],
    force: false,
  });

  for (const [name, bucket] of [
    ['alpha', 'engineering'],
    ['beta', 'engineering'],
    ['gamma', 'productivity'],
  ]) {
    const targetPath = path.join(baseDir, '.agents', 'skills', name);
    assert.ok(lstatSync(targetPath).isSymbolicLink(), `${name}: target is a symlink`);
    assert.equal(
      readlinkSync(targetPath),
      path.join(sourceDir, 'skills', bucket, name),
      `${name}: symlink points into the source tree`,
    );
    assert.match(
      readFileSync(path.join(targetPath, 'SKILL.md'), 'utf8'),
      new RegExp(`name: ${name}`),
      `${name}: content resolves through the symlink`,
    );
  }

  assert.deepEqual(result.installed.map((e) => e.skill).sort(), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(result.skipped, []);
});

test('installs only the requested skills', () => {
  const baseDir = freshBase('subset');
  const result = installSkills({
    sourceDir,
    baseDir,
    skills: ['beta'],
    mode: 'symlink',
    harnessDirs: ['agents'],
    force: false,
  });

  assert.ok(existsSync(path.join(baseDir, '.agents', 'skills', 'beta')));
  assert.ok(!existsSync(path.join(baseDir, '.agents', 'skills', 'alpha')));
  assert.ok(!existsSync(path.join(baseDir, '.agents', 'skills', 'gamma')));
  assert.deepEqual(result.installed.map((e) => e.skill), ['beta']);
});

test('copy mode copies the skill folder, not a link', () => {
  const baseDir = freshBase('copy');
  const result = installSkills({
    sourceDir,
    baseDir,
    skills: ['beta'],
    mode: 'copy',
    harnessDirs: ['agents'],
    force: false,
  });

  const targetPath = path.join(baseDir, '.agents', 'skills', 'beta');
  assert.ok(lstatSync(targetPath).isDirectory(), 'target is a real directory');
  assert.ok(!lstatSync(targetPath).isSymbolicLink(), 'target is not a symlink');
  assert.equal(readFileSync(path.join(targetPath, 'SKILL.md'), 'utf8'), readFileSync(path.join(sourceDir, 'skills', 'engineering', 'beta', 'SKILL.md'), 'utf8'), 'SKILL.md content matches the source');
  assert.equal(readFileSync(path.join(targetPath, 'notes.md'), 'utf8'), 'beta supporting file', 'supporting files match the source');
  assert.deepEqual(result.installed.map((e) => e.skill), ['beta']);
});

test('harnessDirs both writes under both harness dirs, creating missing ones', () => {
  const baseDir = freshBase('both');
  assert.ok(!existsSync(path.join(baseDir, '.agents')));
  assert.ok(!existsSync(path.join(baseDir, '.claude')));

  const result = installSkills({
    sourceDir,
    baseDir,
    skills: 'all',
    mode: 'symlink',
    harnessDirs: ['agents', 'claude'],
    force: false,
  });

  for (const dotDir of ['.agents', '.claude']) {
    for (const name of ['alpha', 'beta', 'gamma']) {
      const targetPath = path.join(baseDir, dotDir, 'skills', name);
      assert.ok(lstatSync(targetPath).isSymbolicLink(), `${dotDir}/${name}: symlink exists and the dir was created`);
    }
  }

  assert.equal(result.installed.length, 6);
  assert.deepEqual(result.installed.map((e) => e.path).sort(), [
    path.join(baseDir, '.agents', 'skills', 'alpha'),
    path.join(baseDir, '.agents', 'skills', 'beta'),
    path.join(baseDir, '.agents', 'skills', 'gamma'),
    path.join(baseDir, '.claude', 'skills', 'alpha'),
    path.join(baseDir, '.claude', 'skills', 'beta'),
    path.join(baseDir, '.claude', 'skills', 'gamma'),
  ].sort());
});

test('existing target entries are skipped and reported, never touched', () => {
  const baseDir = freshBase('skip');
  const harnessSkillsDir = path.join(baseDir, '.agents', 'skills');
  // A hand-written folder.
  mkdirSync(path.join(harnessSkillsDir, 'alpha'), { recursive: true });
  writeFileSync(path.join(harnessSkillsDir, 'alpha', 'mine.md'), 'my own work');
  // A plain file squatting on a skill name.
  writeFileSync(path.join(harnessSkillsDir, 'beta'), 'a plain file named beta');
  // A broken symlink squatting on a skill name.
  const missing = path.join(tmpRoot, 'does-not-exist');
  symlinkSync(missing, path.join(harnessSkillsDir, 'gamma'));

  const result = installSkills({
    sourceDir,
    baseDir,
    skills: 'all',
    mode: 'symlink',
    harnessDirs: ['agents'],
    force: false,
  });

  assert.deepEqual(result.installed, []);
  assert.equal(result.skipped.length, 3);
  for (const entry of result.skipped) {
    assert.ok(entry.skill);
    assert.ok(entry.path);
    assert.equal(typeof entry.reason, 'string');
    assert.ok(entry.reason.length > 0);
  }
  assert.deepEqual(result.skipped.map((e) => e.skill).sort(), ['alpha', 'beta', 'gamma']);
  assert.equal(readFileSync(path.join(harnessSkillsDir, 'alpha', 'mine.md'), 'utf8'), 'my own work', 'hand-written folder is untouched');
  assert.equal(readFileSync(path.join(harnessSkillsDir, 'beta'), 'utf8'), 'a plain file named beta', 'plain file is untouched');
  assert.equal(readlinkSync(path.join(harnessSkillsDir, 'gamma')), missing, 'existing (broken) symlink is untouched');
});

test('other skills install normally when one target already exists', () => {
  const baseDir = freshBase('skip-partial');
  const harnessSkillsDir = path.join(baseDir, '.agents', 'skills');
  mkdirSync(path.join(harnessSkillsDir, 'alpha'), { recursive: true });

  const result = installSkills({
    sourceDir,
    baseDir,
    skills: 'all',
    mode: 'symlink',
    harnessDirs: ['agents'],
    force: false,
  });

  assert.deepEqual(result.installed.map((e) => e.skill).sort(), ['beta', 'gamma']);
  assert.deepEqual(result.skipped.map((e) => e.skill), ['alpha']);
  assert.ok(lstatSync(path.join(harnessSkillsDir, 'beta')).isSymbolicLink());
});

test('force replaces existing target entries with a fresh install', () => {
  const baseDir = freshBase('force');
  const harnessSkillsDir = path.join(baseDir, '.agents', 'skills');
  mkdirSync(path.join(harnessSkillsDir, 'alpha'), { recursive: true });
  writeFileSync(path.join(harnessSkillsDir, 'alpha', 'mine.md'), 'my own work');
  symlinkSync(path.join(tmpRoot, 'gone'), path.join(harnessSkillsDir, 'gamma'));

  const result = installSkills({
    sourceDir,
    baseDir,
    skills: 'all',
    mode: 'symlink',
    harnessDirs: ['agents'],
    force: true,
  });

  const alphaTarget = path.join(harnessSkillsDir, 'alpha');
  assert.ok(lstatSync(alphaTarget).isSymbolicLink(), 'replaced folder is now a symlink');
  assert.equal(readlinkSync(alphaTarget), path.join(sourceDir, 'skills', 'engineering', 'alpha'));
  assert.ok(!existsSync(path.join(harnessSkillsDir, 'alpha', 'mine.md')), 'previous contents are gone');
  const gammaTarget = path.join(harnessSkillsDir, 'gamma');
  assert.equal(readlinkSync(gammaTarget), path.join(sourceDir, 'skills', 'productivity', 'gamma'), 'broken symlink replaced');
  assert.deepEqual(result.installed.map((e) => e.skill).sort(), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(result.skipped, []);
});

test('force replaces an existing target entry in copy mode', () => {
  const baseDir = freshBase('force-copy');
  const harnessSkillsDir = path.join(baseDir, '.claude', 'skills');
  mkdirSync(path.join(harnessSkillsDir, 'beta'), { recursive: true });
  writeFileSync(path.join(harnessSkillsDir, 'beta', 'stale.md'), 'stale content');

  const result = installSkills({
    sourceDir,
    baseDir,
    skills: ['beta'],
    mode: 'copy',
    harnessDirs: ['claude'],
    force: true,
  });

  const betaTarget = path.join(harnessSkillsDir, 'beta');
  assert.ok(lstatSync(betaTarget).isDirectory(), 'target is a fresh directory');
  assert.ok(!existsSync(path.join(betaTarget, 'stale.md')), 'stale file from the previous entry is gone');
  assert.equal(readFileSync(path.join(betaTarget, 'notes.md'), 'utf8'), 'beta supporting file', 'source content is present');
  assert.deepEqual(result.installed.map((e) => e.skill), ['beta']);
  assert.deepEqual(result.skipped, []);
});

test('unknown skill names fail the run and list the valid names', () => {
  const baseDir = freshBase('unknown');
  assert.throws(
    () =>
      installSkills({
        sourceDir,
        baseDir,
        skills: ['nope'],
        mode: 'symlink',
        harnessDirs: ['agents'],
        force: false,
      }),
    (err) => {
      assert.match(err.message, /nope/, 'the typo is named');
      for (const name of ['alpha', 'beta', 'gamma']) {
        assert.match(err.message, new RegExp(`\\b${name}\\b`), `valid name ${name} is listed`);
      }
      return true;
    },
  );
  assert.ok(!existsSync(path.join(baseDir, '.agents')), 'nothing was written before the failure');
});
