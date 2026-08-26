import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Why a clean /handoff turn still left work behind (audit 2.8): uncommitted
 * files under planner/<memoryFolder>, or commits the memory repo has not
 * pushed. Null when the handoff landed and pushed. A git error is reported as
 * a problem too; a check that cannot read the repo must not call it clean.
 */
export async function findUnpushedHandoff(repoRoot: string, memoryFolder: string): Promise<string | null> {
  const git = async (...args: string[]) => {
    const { stdout } = await execFileAsync('git', ['-C', repoRoot, ...args], { timeout: 30_000 });
    return stdout.trim();
  };
  try {
    const dirty = await git('status', '--porcelain', '--', `planner/${memoryFolder}`);
    if (dirty) {
      return `planner/${memoryFolder} has ${dirty.split('\n').length} uncommitted file(s)`;
    }
    const ahead = Number(await git('rev-list', '--count', '@{upstream}..HEAD'));
    if (ahead > 0) {
      return `${ahead} commit(s) are not pushed`;
    }
    return null;
  } catch (error) {
    return `git could not read the memory repo: ${error instanceof Error ? error.message : String(error)}`;
  }
}
