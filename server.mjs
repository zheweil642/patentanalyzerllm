import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { handle } from './api.mjs';
try {
  process.loadEnvFile(new URL('.env', import.meta.url));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}
const port = 8787;
http
  .createServer(async (req, res) => {
    try {
      if (!['127.0.0.1:' + port, 'localhost:' + port].includes(req.headers.host)) {
        res.writeHead(403).end();
        return;
      }
      const url = new URL(req.url, 'http://' + req.headers.host);
      if (url.pathname.startsWith('/api/')) {
        let chunks = [],
          size = 0;
        for await (const c of req) {
          size += c.length;
          if (size > 300000) {
            res.writeHead(413).end();
            return;
          }
          chunks.push(c);
        }
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Buffer.concat(chunks) } : {}),
        });
        let r = await handle(request, { ...process.env, LOCAL_MODE: 'true' });
        if (req.method === 'GET' && url.pathname === '/api/status') {
          const status = await r.json();
          try {
            const health = await fetch('http://127.0.0.1:11434/api/tags', {
              signal: AbortSignal.timeout(3000),
            });
            if (!health.ok) throw new Error();
            const tags = await health.json();
            status.providers[0].ready =
              tags.models?.some((m) => m.name === status.providers[0].model) === true;
            status.localMessage = status.providers[0].ready
              ? '本機 Qwen 已就緒，無 API 用量費，目前不限制使用次數。'
              : 'Ollama 已啟動，但尚未安裝指定的 Qwen 模型。';
          } catch {
            status.providers[0].ready = false;
            status.localMessage = '無法連接本機 Ollama，請先開啟 Ollama 再開始分析。';
          }
          r = Response.json(status, { headers: { 'cache-control': 'no-store' } });
        }
        res.writeHead(r.status, Object.fromEntries(r.headers));
        if (r.body) {
          const reader = r.body.getReader();
          const cancel = () => {
            reader.cancel().catch(() => {});
          };
          res.once('close', cancel);
          try {
            while (!res.destroyed) {
              const { done, value } = await reader.read();
              if (done) break;
              res.write(Buffer.from(value));
            }
          } finally {
            res.off('close', cancel);
            reader.releaseLock();
          }
        }
        res.end();
      } else {
        const files = {
          '/': 'index.html',
          '/index.html': 'index.html',
          '/app.js': 'app.js',
          '/library.js': 'library.js',
          '/similarity.js': 'similarity.js',
          '/battery-patents.json': 'battery-patents.json',
          '/style.css': 'style.css',
          '/favicon.svg': 'favicon.svg',
          '/patent-parser.js': '../patents.mjs',
        };
        const f = files[url.pathname];
        if (!f) {
          res.writeHead(404).end();
          return;
        }
        const mime = f.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : f.endsWith('.js') || f.endsWith('.mjs')
            ? 'text/javascript'
            : f.endsWith('.css')
              ? 'text/css'
              : f.endsWith('.svg')
                ? 'image/svg+xml'
                : 'text/html; charset=utf-8';
        res.writeHead(200, {
          'content-type': mime,
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
        });
        res.end(await readFile(new URL('public/' + f, import.meta.url)));
      }
    } catch {
      res.writeHead(500).end('服務暫時無法回應');
    }
  })
  .on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `連接埠 ${port} 已被使用。若專利研判室已啟動，請直接開啟 http://127.0.0.1:${port}/ 。\n若要改由 VS Code 啟動，請先在原本執行網站的終端機按 Ctrl+C，再按 F5。`,
      );
    } else {
      console.error('網站啟動失敗：' + error.message);
    }
    process.exitCode = 1;
  })
  .listen(port, '127.0.0.1', () => console.log('Local: http://127.0.0.1:8787'));
