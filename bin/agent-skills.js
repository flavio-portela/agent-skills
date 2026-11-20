#!/usr/bin/env node
// agent-skills CLI: installs skills from the managed checkout into a
// harness's skill directories. The TTY layer (flags plus prompts) only
// produces a plan object; all install behaviour lives in lib/install.js.

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { discoverSkills, expandSkills, HARNESS_DOT_DIRS, installSkills } from '../lib/install.js';

const THIS_FILE = fileURLToPath(import.meta.url);
const SOURCE_DIR = path.dirname(path.dirname(THIS_FILE));

// A reader that closes the pipe early (e.g. `agent-skills install ... | head`)
// surfaces as EPIPE in Node instead of SIGPIPE. Exit quietly like a POSIX
// writer would, rather than dumping a stack trace.
for (const stream of [process.stdout, process.stderr]) {
  stream.on('error', (err) => {
    if (err.code === 'EPIPE') process.exit(141);
    throw err;
  });
}

const HARNESS_TO_DIRS = {
  agents: ['agents'],
  claude: ['claude'],
  both: ['agents', 'claude'],
};

const HELP = `agent-skills: install skills from the managed checkout into your harness's skill directories.

Usage:
  agent-skills install [flags]

Flags:
  --all               Install every skill
  --skill a,b         Install exactly the named skills (comma-separated)
  --symlink           Link skills into the managed checkout (default)
  --copy              Copy skill folders instead of linking
  --harness <dir>     agents | claude | both (default: both)
  --dir <path>        Base directory to install into (default: current directory)
  --force             Replace existing entries at the target paths

A fully flagged run (skills, mode, and harness given) is non-interactive.
Any decision not given as a flag is asked for interactively.
`;

class UsageError extends Error {}

function parseFlags(argv) {
  const flags = { skills: undefined, mode: undefined, harness: undefined, dir: undefined, force: false };
  const needValue = (name, value) => {
    if (value === undefined || value === '') throw new UsageError(`Missing value for ${name}`);
    return value;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--all') {
      if (flags.skills !== undefined) throw new UsageError('Use --all or --skill, not both.');
      flags.skills = 'all';
    } else if (arg === '--skill') {
      if (flags.skills !== undefined) throw new UsageError('Use --all or --skill, not both.');
      const names = needValue('--skill', argv[++i])
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length === 0) throw new UsageError('--skill needs at least one name, e.g. --skill tdd,wizard');
      flags.skills = names;
    } else if (arg === '--symlink') {
      if (flags.mode === 'copy') throw new UsageError('Use --symlink or --copy, not both.');
      flags.mode = 'symlink';
    } else if (arg === '--copy') {
      if (flags.mode === 'symlink') throw new UsageError('Use --symlink or --copy, not both.');
      flags.mode = 'copy';
    } else if (arg === '--harness') {
      const value = needValue('--harness', argv[++i]);
      if (!(value in HARNESS_TO_DIRS)) {
        throw new UsageError(`Invalid --harness value: ${value}. Expected agents, claude, or both.`);
      }
      flags.harness = value;
    } else if (arg === '--dir') {
      flags.dir = path.resolve(needValue('--dir', argv[++i]));
    } else if (arg === '--force') {
      flags.force = true;
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    } else {
      throw new UsageError(`Unknown flag: ${arg}`);
    }
  }
  return flags;
}

async function askSkillSelection(skills) {
  const { checkbox, Separator } = await import('@inquirer/prompts');
  const choices = [];
  const buckets = [...new Set(skills.map((s) => s.bucket))];
  for (const bucket of buckets) {
    choices.push(new Separator(bucket));
    for (const skill of skills.filter((s) => s.bucket === bucket)) {
      choices.push({ name: skill.name, value: skill.name, checked: true });
    }
  }
  return checkbox({
    message: 'Select the skills to install',
    choices,
    required: true,
  });
}

async function runInstall(flags) {
  const skills = discoverSkills(SOURCE_DIR);
  if (skills.length === 0) {
    process.stderr.write(`No skills found under ${path.join(SOURCE_DIR, 'skills')}. Is this the managed checkout of the agent-skills repo?\n`);
    process.exit(1);
  }

  let prompted = false;

  // 1. Skills
  let skillSelection;
  if (flags.skills === 'all') {
    skillSelection = 'all';
  } else if (flags.skills) {
    skillSelection = flags.skills;
  } else {
    skillSelection = await askSkillSelection(skills);
    prompted = true;
  }

  // 2. Mode
  let mode = flags.mode;
  if (!mode) {
    const { select } = await import('@inquirer/prompts');
    mode = await select({
      message: 'How should skills be installed?',
      choices: [
        {
          name: 'symlink',
          value: 'symlink',
          description: 'Live-linked to the managed checkout. Re-running the one-liner updates installed skills.',
        },
        {
          name: 'copy',
          value: 'copy',
          description: 'Self-contained folders under the target directory.',
        },
      ],
      default: 'symlink',
    });
    prompted = true;
  }

  // 3. Harness dirs
  let harnessDirs = flags.harness ? HARNESS_TO_DIRS[flags.harness] : undefined;
  if (!harnessDirs) {
    const { select } = await import('@inquirer/prompts');
    const answer = await select({
      message: 'Which harness skill directories should receive the skills?',
      choices: [
        { name: 'both (.agents/skills and .claude/skills)', value: 'both' },
        { name: '.agents/skills', value: 'agents' },
        { name: '.claude/skills', value: 'claude' },
      ],
      default: 'both',
    });
    harnessDirs = HARNESS_TO_DIRS[answer];
    prompted = true;
  }

  const baseDir = flags.dir ?? process.cwd();

  const selectedNames = expandSkills(skillSelection, skills);
  const selectedSkills = skills.filter((s) => selectedNames.includes(s.name));

  // 4. Confirm. Interactive runs only; a fully flagged run proceeds at once.
  if (prompted) {
    const { confirm } = await import('@inquirer/prompts');
    const lines = [];
    for (const harness of harnessDirs) {
      const dotDir = HARNESS_DOT_DIRS[harness];
      for (const skill of selectedSkills) {
        lines.push(`  ${path.join(baseDir, dotDir, 'skills', skill.name)}`);
      }
    }
    process.stdout.write(
      `Will install ${selectedSkills.length} skill(s) as ${mode === 'copy' ? 'copies' : 'symlinks'}:\n${lines.join('\n')}\n`,
    );
    const ok = await confirm({ message: 'Proceed with this install?', default: true });
    if (!ok) {
      process.stdout.write('Install cancelled.\n');
      process.exit(0);
    }
  }

  const plan = {
    sourceDir: SOURCE_DIR,
    baseDir,
    skills: skillSelection === 'all' ? 'all' : selectedNames,
    mode,
    harnessDirs,
    force: flags.force,
  };

  const result = installSkills(plan);

  // End-of-run summary.
  if (result.installed.length > 0) {
    const n = result.installed.length;
    process.stdout.write(`Installed ${n} skill ${n === 1 ? 'entry' : 'entries'} (${mode}):\n`);
    for (const entry of result.installed) {
      process.stdout.write(`  ${entry.path}\n`);
    }
  }
  if (result.skipped.length > 0) {
    const n = result.skipped.length;
    process.stdout.write(`Skipped ${n} existing ${n === 1 ? 'entry' : 'entries'} (re-run with --force to replace):\n`);
    for (const entry of result.skipped) {
      process.stdout.write(`  ${entry.path} (${entry.reason})\n`);
    }
  }
  if (result.installed.length === 0 && result.skipped.length === 0) {
    process.stdout.write('Nothing to do.\n');
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (argv[0] !== 'install') {
    process.stderr.write(`Unknown command: ${argv[0]}\n\n${HELP}`);
    process.exit(1);
  }

  let flags;
  try {
    flags = parseFlags(argv.slice(1));
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`agent-skills: ${err.message}\n\nRun 'agent-skills' for usage.\n`);
      process.exit(1);
    }
    throw err;
  }

  // Prompts need a real terminal. A run that would prompt without one
  // fails with the fully flagged equivalent instead.
  const needsPrompts = !flags.skills || !flags.mode || !flags.harness;
  if (needsPrompts && !process.stdin.isTTY) {
    process.stderr.write(
      'No interactive terminal available, and this run needs prompts.\n' +
        'Pass every decision as a flag instead, e.g.:\n' +
        '  agent-skills install --all --symlink --harness both\n',
    );
    process.exit(1);
  }

  try {
    await runInstall(flags);
  } catch (err) {
    if (err.name === 'ExitPromptError') {
      process.stdout.write('Install cancelled.\n');
      process.exit(1);
    }
    process.stderr.write(`agent-skills: ${err.message}\n`);
    process.exit(1);
  }
}

main();
