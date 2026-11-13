import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/content.ts', 'src/popup.ts'],
  outdir: 'dist', bundle: true, format: 'iife', target: 'chrome120',
  loader: { '.css': 'text' }, legalComments: 'none',
});
for (const name of ['manifest.json', 'popup.html', 'popup.css']) {
  await copyFile(`extension/${name}`, `dist/${name}`);
}
console.log('Chrome 插件已建立：dist/');
