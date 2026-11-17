#!/usr/bin/env node
// Interactively install the selected skills from this repository into the
// harness skill directories (.claude/skills and .agents/skills) under each
// base directory, as symlinks into the repo or snapshots with --copy.
//
// Thin wrapper around installer/entry.mjs with the real picker. The command
// line matches the old bash installer: [--copy] [DIR ...], defaulting to $HOME.

import {main} from '../installer/entry.mjs';

process.exitCode = await main(process.argv.slice(2));
