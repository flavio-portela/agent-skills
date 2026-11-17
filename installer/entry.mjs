// Entry point for the Node+ink skill installer.
//
// Argument parsing, the interactive-terminal guard, the repository scan, the
// install, and the post-install summary live here. The picker is an
// injectable dependency defaulting to the real ink picker, so the contract
// tests can script the selection without a terminal.

import {cpSync, readdirSync, readFileSync, mkdirSync, rmSync, symlinkSync, realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {basename, dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const REPO = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const BUCKETS = ['engineering', 'productivity'];
const HARNESS_SUBDIRS = ['.claude/skills', '.agents/skills'];

function usageText() {
  return [
    'Usage: link-skills.mjs [--copy] [DIR ...]',
    '',
    'Interactively select the skills from this repository to install into the',
    '.claude/skills and .agents/skills directories under each DIR, creating them',
    'as needed. All skills are pre-selected, so pressing Enter installs everything.',
    'Requires Node.js and an interactive terminal.',
    '',
    "One-time setup: run 'npm install' in the repository root.",
    '',
    '  DIR ...   Base directories (default: $HOME). Skills are placed in',
    '            DIR/.claude/skills and DIR/.agents/skills.',
    '  --copy    Copy skill folders instead of symlinking (the default). Copies are',
    '            snapshots; re-run after a git pull to refresh them.',
  ].join('\n');
}

// Parse the command line: help and copy flags, base directory arguments, and the
// rejection of unknown options before anything else happens.
function parseArgs(argv) {
  const bases = [];
  let mode = 'link';
  for (const arg of argv) {
    if (arg === '-h' || arg === '--help') {
      return {help: true, bases};
    }
    if (arg === '--copy') {
      mode = 'copy';
      continue;
    }
    if (arg.startsWith('-')) {
      return {error: arg, bases};
    }
    bases.push(arg);
  }
  return {bases, mode};
}

function scanSkills() {
  const candidates = [];
  function walk(dir, bucket) {
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== 'node_modules') walk(path, bucket);
      else if (entry.isFile() && entry.name === 'SKILL.md') {
        const source = dirname(path);
        const line = /^description:[\t ]*(.*)$/m.exec(readFileSync(path, 'utf8'))?.[1] ?? '';
        const description = line.replace(/^"/, '').replace(/"$/, '').replaceAll('\\"', '"');
        candidates.push({name: basename(source), bucket, description, source});
      }
    }
  }
  for (const bucket of BUCKETS) {
    const dir = join(REPO, 'skills', bucket);
    try {
      walk(dir, bucket);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  return candidates.sort((a, b) => BUCKETS.indexOf(a.bucket) - BUCKETS.indexOf(b.bucket)
    || (join(a.source, 'SKILL.md') < join(b.source, 'SKILL.md') ? -1 : 1));
}

// Resolve existing ancestors too: a harness parent can itself be a symlink,
// even when the final skills directory has not been created yet.
function resolvedDestination(path) {
  try {
    return realpathSync(path);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
    return join(resolvedDestination(dirname(path)), basename(path));
  }
}

export async function main(argv, {pick: injectedPick} = {}) {
  const parsed = parseArgs(argv);
  if (parsed.help) {
    console.log(usageText());
    return 0;
  }
  if (parsed.error !== undefined) {
    console.error(`error: unknown option: ${parsed.error}`);
    console.error(usageText());
    return 1;
  }
  const bases = parsed.bases.length > 0 ? parsed.bases : [homedir()];

  // The picker is the only dependency on the Node packages. A missing
  // node_modules must read as a setup hint, not a stack trace.
  let pick = injectedPick;
  if (!pick) {
    try {
      ({pickSkills: pick} = await import('./picker.mjs'));
    } catch (err) {
      if (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND') {
        console.error("error: the installer's dependencies are not installed.");
        console.error("Run 'npm install' in the repository root, then re-run.");
        return 1;
      }
      throw err;
    }
  }

  if (!process.stdin.isTTY) {
    console.error('error: an interactive terminal is required, but stdin is not a TTY.');
    return 1;
  }

  const candidates = scanSkills();
  const result = await pick({candidates, bases, mode: parsed.mode});
  if (result.kind === 'aborted') {
    console.error('Aborted. Nothing installed.');
    return 130;
  }
  if (result.kind === 'empty') {
    console.log('Nothing selected. Nothing installed.');
    return 0;
  }
  const destinations = bases.flatMap(base => HARNESS_SUBDIRS.map(sub => join(base, sub)));
  for (const dest of destinations) {
    const resolved = resolvedDestination(resolve(dest));
    if (resolved !== resolve(dest) && (resolved === REPO || resolved.startsWith(REPO + sep))) {
      console.error(`error: ${dest} is a symlink into this repo (${resolved}).`);
      console.error('Remove the symlink and re-run; the installer will recreate it as a real directory.');
      return 1;
    }
  }
  const names = new Set(result.names);
  for (const dest of destinations) {
    mkdirSync(dest, {recursive: true});
    for (const item of candidates.filter(c => names.has(c.name))) {
      const target = join(dest, item.name);
      rmSync(target, {recursive: true, force: true});
      if (parsed.mode === 'copy') cpSync(item.source, target, {recursive: true});
      else symlinkSync(item.source, target);
      console.log(`${parsed.mode === 'copy' ? 'copied' : 'linked'} ${item.name} -> ${item.source} (${dest})`);
    }
  }
  return 0;
}
