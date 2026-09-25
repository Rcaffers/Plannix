import { build } from 'vite';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Uses an isolated headless profile; never reads the user's browser profile.
const directory = await mkdtemp(path.join(tmpdir(), 'plannix-ai-profile-browser-'));
try {
  await build({ plugins: [{ name: 'ai-profile-test-boundaries', enforce: 'pre', resolveId(source, importer) {
    if (importer?.endsWith('/AiProviderCard.jsx') && source === '../utils/aiConnectionApi.js') return path.resolve('src/components/AiProviderCard.browser-test.jsx');
    if (importer?.endsWith('/Profile.jsx') && source === '../components/DeleteAccountSection') return '\0test-delete-account';
  }, load(id) { if (id === '\0test-delete-account') return 'export default function DeleteAccountSection(){return null}'; } }], configFile: false, logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' }, esbuild: { jsx: 'automatic' },
    build: { outDir: directory, emptyOutDir: false, lib: {
      entry: 'src/components/AiProviderCard.browser-test.jsx', formats: ['iife'], name: 'AiProviderTest', fileName: () => 'test.js', cssFileName: 'test',
    } } });
  await writeFile(path.join(directory, 'index.html'), '<!doctype html><html><head><link rel="stylesheet" href="test.css"></head><body><script src="test.js"></script></body></html>');
  const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  const dom = await new Promise((resolve, reject) => {
    const child = spawn(chrome, ['--headless', '--disable-background-networking', '--disable-component-update',
      '--disable-extensions', '--no-first-run', '--disable-gpu', '--no-default-browser-check',
      `--user-data-dir=${path.join(directory, 'profile')}`, '--dump-dom', '--virtual-time-budget=10000', '--timeout=10000', `file://${directory}/index.html`],
    { stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); child.stdout.destroy(); reject(new Error('Browser test timed out')); }, 30000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('</html>')) {
        clearTimeout(timer);
        // Chrome helpers can retain stdout after dump-dom has finished on macOS.
        child.once('exit', () => resolve(output));
        child.kill(); child.stdout.destroy();
      }
    });
    child.on('exit', (code) => {
      if (!output.includes('</html>') && code !== 0) { clearTimeout(timer); reject(new Error(`Chrome exited with ${code}`)); }
    });
  });
  console.log(dom.match(/<pre>([\s\S]*?)<\/pre>/)?.[1] || dom);
  if (!dom.includes('data-test-result="passed"')) process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
