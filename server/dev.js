import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import handler from './handler.js';

const root=resolve('dist');
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
  if(req.url.startsWith('/api/')) return handler(req,res);
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+'\\')&&!file.startsWith(root+'/')){res.writeHead(403).end();return;}
  try{const data=await readFile(file);res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(data);}catch{res.writeHead(404).end('Not found');}
});
server.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log(`TEACO: http://127.0.0.1:${process.env.PORT||4173}`));
