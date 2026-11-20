import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOTSTRAP = path.join(REPO_ROOT, 'install.sh');

let tmpRoot;
let fixtureRepo;
let fakeHome;

// Build a minimal stand-in for GitHub: a git repo that looks like a clone
// of this one (CLI files copied from the repo under test, plus a small
// skills tree). The bootstrap clones it as if it were the remote.
function buildFixtureRepo(dir) {
  copyFileSync(path.join(REPO_ROOT, 'package.json'), path.join(dir, 'package.json'));
  copyFileSync(path.join(REPO_ROOT, 'package-lock.json'), path.join(dir, 'package-lock.json'));
  mkdirSync(path.join(dir, 'bin'), { recursive: true });
  copyFileSync(path.join(REPO_ROOT, 'bin', 'agent-skills.js'), path.join(dir, 'bin', 'agent-skills.js'));
  mkdirSync(path.join(dir, 'lib'), { recursive: true });
  copyFileSync(path.join(REPO_ROOT, 'lib', 'install.js'), path.join(dir, 'lib', 'install.js'));
  for (const [bucket, name] of [
    ['engineering', 'alpha'],
    ['productivity', 'gamma'],
  ]) {
    const d = path.join(dir, 'skills', bucket, name);
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture skill ${name}\n---\n`);
  }
  execFileSync('git', ['init', '-b', 'main'], { cwd: dir });
  execFileSync('git', ['add', '-A'], { cwd: dir });
  execFileSync('git', ['-c', 'user.email=fixture@test', '-c', 'user.name=fixture', 'commit', '-m', 'fixture'], { cwd: dir });
}

before(() => {
  tmpRoot = path.join(tmpdir(), `agent-skills-bootstrap-test-${process.pid}`);
  fixtureRepo = path.join(tmpRoot, 'fixture-repo');
  fakeHome = path.join(tmpRoot, 'fake-home');
  mkdirSync(fixtureRepo, { recursive: true });
  mkdirSync(fakeHome, { recursive: true });
  buildFixtureRepo(fixtureRepo);
});

after(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const childEnv = () => ({
  ...process.env,
  HOME: fakeHome,
  AGENT_SKILLS_REPO: fixtureRepo,
  PATH: `${path.join(fakeHome, '.local', 'bin')}:${process.env.PATH}`,
});

test(
  'bootstrap installs the managed checkout, the shim, and a working CLI',
  { timeout: 240000 },
  () => {
    // Run the bootstrap with a redirected HOME so the managed checkout and
    // the shim land in the fake home. detached: true gives the child its
    // own session (no controlling terminal), which keeps the run
    // deterministic on developer machines too: the bootstrap reports that
    // it could not launch the interactive installer instead of hanging on
    // prompts.
    const run = spawnSync('sh', [BOOTSTRAP], {
      env: childEnv(),
      encoding: 'utf8',
      detached: true,
      timeout: 200000,
    });
    assert.equal(run.status, 0, `bootstrap exited 0\nstdout:\n${run.stdout}\nstderr:\n${run.stderr}`);

    // Managed checkout exists at the documented default location.
    const managedRepo = path.join(fakeHome, '.agent-skills', 'repo');
    assert.ok(existsSync(path.join(managedRepo, '.git')), 'managed checkout is a git clone');
    assert.ok(existsSync(path.join(managedRepo, 'skills', 'engineering', 'alpha', 'SKILL.md')), 'managed checkout has the fixture skills');
    assert.ok(existsSync(path.join(managedRepo, 'node_modules', '@inquirer', 'prompts')), 'production dependencies were installed');

    // Shim exists at ~/.local/bin/agent-skills and is executable.
    const shim = path.join(fakeHome, '.local', 'bin', 'agent-skills');
    const shimStat = lstatSync(shim);
    assert.ok(shimStat.isFile(), 'shim is a regular file');
    assert.ok(statSync(shim).mode & 0o100, 'shim is executable');
    assert.match(readFileSync(shim, 'utf8'), /node .*bin\/agent-skills\.js/, 'shim runs the CLI entry file with node');

    // The command responds when ~/.local/bin is on PATH.
    const help = spawnSync('agent-skills', [], { env: childEnv(), encoding: 'utf8' });
    assert.equal(help.status, 0, `agent-skills on PATH responds\n${help.stdout}\n${help.stderr}`);
    assert.match(help.stdout, /Usage:/);
    assert.match(help.stdout, /install/);

    // A real fully-flagged install through the shim works into a temp target.
    const target = path.join(tmpRoot, 'target');
    mkdirSync(target, { recursive: true });
    const installRun = spawnSync(
      'agent-skills',
      ['install', '--all', '--symlink', '--harness', 'both', '--dir', target],
      { env: childEnv(), encoding: 'utf8', timeout: 60000 },
    );
    assert.equal(installRun.status, 0, `flagged install through the shim\nstdout:\n${installRun.stdout}\nstderr:\n${installRun.stderr}`);

    const alphaLink = path.join(target, '.agents', 'skills', 'alpha');
    assert.ok(lstatSync(alphaLink).isSymbolicLink(), 'alpha installed as a symlink under .agents/skills');
    assert.equal(readlinkSync(alphaLink), path.join(managedRepo, 'skills', 'engineering', 'alpha'), 'symlink points into the managed checkout');
    assert.ok(existsSync(path.join(target, '.claude', 'skills', 'gamma')), 'gamma installed under .claude/skills');
    assert.match(installRun.stdout, /Installed 4 skill entries/);
  },
);
