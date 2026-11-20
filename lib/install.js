import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from 'node:fs';
import path from 'node:path';

// The harness key maps to the dot directory that holds its skills folder.
export const HARNESS_DOT_DIRS = {
  agents: '.agents',
  claude: '.claude',
};

// Expand a skill selection ('all' or an explicit name list) to concrete names.
export function expandSkills(requested, skills) {
  if (requested === 'all') return skills.map((s) => s.name);
  return [...requested];
}

/**
 * Discover installable skills in a managed checkout: every
 * skills/<bucket>/<name>/ folder that holds a SKILL.md.
 * @param {string} sourceDir Root of the managed checkout.
 * @returns {{name: string, bucket: string, dir: string}[]} Sorted by bucket, then name.
 */
export function discoverSkills(sourceDir) {
  const skillsRoot = path.join(sourceDir, 'skills');
  const skills = [];
  for (const bucket of readdirSync(skillsRoot).sort()) {
    const bucketDir = path.join(skillsRoot, bucket);
    if (!statSync(bucketDir).isDirectory()) continue;
    for (const name of readdirSync(bucketDir).sort()) {
      const dir = path.join(bucketDir, name);
      if (statSync(dir).isDirectory() && existsSync(path.join(dir, 'SKILL.md'))) {
        skills.push({ name, bucket, dir });
      }
    }
  }
  return skills;
}

// lstat so that broken symlinks count as existing entries too.
function entryExists(targetPath) {
  try {
    lstatSync(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Install the skills selected in `plan` from the managed checkout into
 * the harness skill directories under `plan.baseDir`.
 *
 * @param {object} plan
 * @param {string} plan.sourceDir Root of the managed checkout.
 * @param {string} plan.baseDir Base directory to install into.
 * @param {string[]|'all'} plan.skills Skill names, or 'all' for every discovered skill.
 * @param {'symlink'|'copy'} plan.mode How skills are installed.
 * @param {string[]} plan.harnessDirs Subset of ['agents', 'claude'].
 * @param {boolean} plan.force Replace existing entries instead of skipping them.
 * @returns {{installed: {skill: string, path: string}[], skipped: {skill: string, path: string, reason: string}[]}}
 * @throws {Error} If a requested skill name is not in the managed checkout.
 */
export function installSkills(plan) {
  const all = discoverSkills(plan.sourceDir);
  if (plan.skills !== 'all') {
    const unknown = plan.skills.filter((name) => !all.some((s) => s.name === name));
    if (unknown.length > 0) {
      throw new Error(
        `Unknown skill name(s): ${unknown.join(', ')}. Valid names: ${all.map((s) => s.name).join(', ')}`,
      );
    }
  }
  const names = expandSkills(plan.skills, all);
  const selected = all.filter((s) => names.includes(s.name));
  const installed = [];
  const skipped = [];
  for (const skill of selected) {
    for (const harness of plan.harnessDirs) {
      const dotDir = HARNESS_DOT_DIRS[harness];
      const harnessSkillsDir = path.join(plan.baseDir, dotDir, 'skills');
      mkdirSync(harnessSkillsDir, { recursive: true });
      const targetPath = path.join(harnessSkillsDir, skill.name);
      if (entryExists(targetPath)) {
        if (!plan.force) {
          skipped.push({ skill: skill.name, path: targetPath, reason: 'already exists' });
          continue;
        }
        rmSync(targetPath, { recursive: true });
      }
      if (plan.mode === 'copy') {
        cpSync(skill.dir, targetPath, { recursive: true });
      } else {
        symlinkSync(skill.dir, targetPath);
      }
      installed.push({ skill: skill.name, path: targetPath });
    }
  }
  return { installed, skipped };
}
