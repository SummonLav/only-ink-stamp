import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'dist');
await mkdir(out, { recursive: true });
for (const name of ['style.css', 'app.js', 'browser-studio.js', 'stamp-engine.js', 'stamp-worker.js', 'zip.js']) {
  await copyFile(resolve(root, 'assets/studio', name), resolve(out, name));
}
const html = (await readFile(resolve(root, 'assets/studio/index.html'), 'utf8'))
  .replace('<script src="/app.js"></script>', '<script type="module" src="/browser-studio.js"></script>')
  .replace('保存透明图、纸张图和参数到本地输出目录', '下载透明图、纸张图、原图和参数 ZIP');
await writeFile(resolve(out, 'index.html'), html);
await copyFile(resolve(root, 'docs/images/source.png'), resolve(out, 'demo.png'));
await copyFile(resolve(root, 'docs/examples/metrocard.json'), resolve(out, 'demo.json'));
console.log('Built browser studio in dist/');
