import { pathToFileURL } from 'node:url';

export async function setupGitHooks({ env = process.env, cwd = process.cwd(),
  load = () => import('simple-git-hooks') } = {}) {
  const omitted = String(env.npm_config_omit || '').split(/[\s,]+/);
  if (env.NODE_ENV === 'production' || omitted.includes('dev')
    || ['true', '1'].includes(env.npm_config_production)) return 'skipped';
  try {
    const module = await load();
    const findGitRoot = module.getGitProjectRoot || module.default?.getGitProjectRoot;
    if (findGitRoot && !findGitRoot(cwd)) throw new Error();
    const install = module.setHooksFromConfig || module.default?.setHooksFromConfig;
    if (typeof install !== 'function') throw new Error();
    await install(cwd, []);
    return 'installed';
  } catch {
    throw new Error('Development Git-hook setup failed. Install development dependencies and check the Git repository.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setupGitHooks().catch(() => {
    console.error('Development Git-hook setup failed. Install development dependencies and check the Git repository.');
    process.exitCode = 1;
  });
}
