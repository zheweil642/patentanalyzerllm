import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
const assets = {};
for (const f of ['index.html', 'style.css', 'app.js', 'library.js', 'similarity.js', 'favicon.svg'])
  assets['/' + f] = await readFile('public/' + f, 'utf8');
assets['/patent-parser.js'] = (await readFile('patents.mjs', 'utf8')).split(
  'function decodeEntities',
)[0];
assets['/battery-patents.json'] = await readFile('public/battery-patents.json', 'utf8');
const api =
  (await readFile('pipeline.mjs', 'utf8')) +
  '\n' +
  (await readFile('evidence.mjs', 'utf8')) +
  '\n' +
  (await readFile('access.mjs', 'utf8')) +
  '\n' +
  (await readFile('api.mjs', 'utf8')).replace(
    /^import\s+\{[^}]*\}\s+from\s+['"]\.\/(?:access|patents|evidence|pipeline)\.mjs['"];?\r?\n/gm,
    '',
  );
await writeFile(
  'dist/server/index.js',
  api +
    '\nconst assets=' +
    JSON.stringify(assets) +
    ';\nexport default {async fetch(request,env){const path=new URL(request.url).pathname;if(path.startsWith("/api/"))return handle(request,env);const p=path==="/"?"/index.html":path;if(!assets[p])return new Response("Not found",{status:404});return new Response(assets[p],{headers:{"content-type":p.endsWith(".css")?"text/css":p.endsWith(".js")?"text/javascript":p.endsWith(".svg")?"image/svg+xml":"text/html; charset=utf-8","x-content-type-options":"nosniff","referrer-policy":"no-referrer","cache-control":"no-store"}})}};',
);
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
console.log('Built Worker and local application.');
