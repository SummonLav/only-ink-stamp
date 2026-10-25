import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = resolve(root, 'dist');
await mkdir(out, { recursive: true });
for (const name of ['poster.css', 'poster.js', 'poster-model.js', 'poster-storage.js', 'poster-renderer.js', 'stamp-engine.js', 'stamp-worker.js']) {
  await copyFile(resolve(root, 'assets/studio', name), resolve(out, name));
}
const html = await readFile(resolve(root, 'assets/studio/poster.html'), 'utf8');
await writeFile(resolve(out, 'index.html'), html);
await copyFile(resolve(root, 'docs/images/source.png'), resolve(out, 'demo.png'));
await copyFile(resolve(root, 'docs/examples/metrocard.json'), resolve(out, 'demo.json'));
console.log('Built browser studio in dist/');
