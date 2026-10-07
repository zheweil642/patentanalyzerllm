import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {handle} from './api.mjs';
try{process.loadEnvFile(new URL('.env',import.meta.url));}catch(e){if(e.code!=='ENOENT')throw e;}
const port=8787;
http.createServer(async(req,res)=>{try{
 if(!['127.0.0.1:'+port,'localhost:'+port].includes(req.headers.host)){res.writeHead(403).end();return;}
 const url=new URL(req.url,'http://'+req.headers.host);
 if(url.pathname.startsWith('/api/')){
 let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>300000){res.writeHead(413).end();return;}chunks.push(c);}
 const request=new Request(url,{method:req.method,headers:req.headers,...(req.method!=='GET'&&req.method!=='HEAD'?{body:Buffer.concat(chunks)}:{})});
 const r=await handle(request,{...process.env,LOCAL_MODE:'true'});res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
 }else{const files={'/':'index.html','/index.html':'index.html','/app.js':'app.js','/style.css':'style.css','/favicon.svg':'favicon.svg'};const f=files[url.pathname];if(!f){res.writeHead(404).end();return;}const mime=f.endsWith('.js')?'text/javascript':f.endsWith('.css')?'text/css':f.endsWith('.svg')?'image/svg+xml':'text/html; charset=utf-8';res.writeHead(200,{'content-type':mime,'x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(await readFile(new URL('public/'+f,import.meta.url)));}
 }catch{res.writeHead(500).end('服務暫時無法回應');}}).listen(port,'127.0.0.1',()=>console.log('Local: http://127.0.0.1:8787'));
