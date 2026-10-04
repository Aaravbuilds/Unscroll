import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const DEFAULT_MODEL='deepseek/deepseek-v4.1-flash';

async function readEnvFile(file){
  let text;
  try{text=await readFile(file,'utf8')}catch{return {}}
  const values={};
  for(const raw of text.split(/\r?\n/)){
    const line=raw.trim();
    if(!line||line.startsWith('#'))continue;
    const eq=line.indexOf('=');
    if(eq<1)continue;
    const key=line.slice(0,eq).trim();
    let value=line.slice(eq+1).trim();
    if(value.length>1&&((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'"))))value=value.slice(1,-1);
    values[key]=value;
  }
  return values;
}

const fileEnv=await readEnvFile(path.join(root,'.env'));
const pick=(key,fallback='')=>process.env[key]||fileEnv[key]||fallback;
const env={
  OPENROUTER_API_KEY:pick('OPENROUTER_API_KEY'),
  OPENROUTER_MODEL:pick('OPENROUTER_MODEL',DEFAULT_MODEL),
  RATE_LIMIT_PER_MINUTE:pick('RATE_LIMIT_PER_MINUTE','3')
};
const port=Number(pick('PORT','8787'))||8787;

const bundle=path.join(root,'dist','server','index.js');
let worker;
try{worker=(await import(pathToFileURL(bundle).href)).default}
catch(error){
  console.error('Could not load dist/server/index.js. Run `npm run build` first.');
  console.error(String(error?.message||error));
  process.exit(1);
}
if(typeof worker?.fetch!=='function'){console.error('dist/server/index.js does not export a Worker fetch handler.');process.exit(1)}

const SKIP_HEADERS=new Set(['connection','keep-alive','transfer-encoding','upgrade','host','content-length','accept-encoding']);
function readBody(req){
  return new Promise((resolve,reject)=>{
    const chunks=[];
    req.on('data',chunk=>chunks.push(chunk));
    req.on('end',()=>resolve(Buffer.concat(chunks)));
    req.on('error',reject);
  });
}

const server=createServer(async(req,res)=>{
  const started=Date.now();
  try{
    const host=req.headers.host||`localhost:${port}`;
    const url=new URL(req.url||'/',`http://${host}`);
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers)){
      if(SKIP_HEADERS.has(key)||value===undefined)continue;
      headers.set(key,Array.isArray(value)?value.join(', '):value);
    }
    if(!headers.has('cf-connecting-ip'))headers.set('CF-Connecting-IP',req.socket.remoteAddress||'local');
    const method=(req.method||'GET').toUpperCase();
    const withBody=method!=='GET'&&method!=='HEAD';
    const response=await worker.fetch(new Request(url,withBody?{method,headers,body:await readBody(req)}:{method,headers}),env);
    const payload=Buffer.from(await response.arrayBuffer());
    const outHeaders={};
    response.headers.forEach((value,key)=>{outHeaders[key]=value});
    res.writeHead(response.status,outHeaders);
    res.end(payload);
    console.log(`${method} ${url.pathname} -> ${response.status} ${Date.now()-started}ms`);
  }catch(error){
    console.error('Request failed:',error);
    if(!res.headersSent)res.writeHead(500,{'Content-Type':'application/json'});
    res.end(JSON.stringify({error:'Local server error.'}));
  }
});

server.on('error',error=>{
  if(error.code==='EADDRINUSE')console.error(`Port ${port} is already in use. Set PORT to something else, e.g. PORT=8788 npm run dev.`);
  else console.error(error);
  process.exit(1);
});
server.listen(port,()=>{
  console.log(`UNSCROLL dev server on http://localhost:${port}`);
  console.log(`model: ${env.OPENROUTER_MODEL}`);
  console.log(env.OPENROUTER_API_KEY?'OpenRouter key loaded from environment/.env':'No OPENROUTER_API_KEY found. Add one to .env (see .env.example) or /api/plan will answer 503.');
});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>process.exit(0))});