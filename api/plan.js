import worker from '../server/index.js';

const SKIP_HEADERS=new Set(['connection','keep-alive','transfer-encoding','upgrade','host','content-length','accept-encoding']);

function readBody(req){
  return new Promise((resolve,reject)=>{
    const chunks=[];
    req.on('data',chunk=>chunks.push(chunk));
    req.on('end',()=>resolve(Buffer.concat(chunks)));
    req.on('error',reject);
  });
}

export default async function handler(req,res){
  try{
    const proto=String(req.headers['x-forwarded-proto']||'https').split(',')[0].trim();
    const host=String(req.headers['x-forwarded-host']||req.headers.host||'localhost').split(',')[0].trim();
    const url=new URL(req.url||'/api/plan',`${proto}://${host}`);
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers)){
      if(SKIP_HEADERS.has(key)||value===undefined)continue;
      headers.set(key,Array.isArray(value)?value.join(', '):String(value));
    }
    if(!headers.has('cf-connecting-ip'))headers.set('CF-Connecting-IP',String(req.headers['x-real-ip']||req.socket?.remoteAddress||'vercel'));
    const method=(req.method||'POST').toUpperCase();
    const withBody=method!=='GET'&&method!=='HEAD';
    const response=await worker.fetch(new Request(url,withBody?{method,headers,body:await readBody(req)}:{method,headers}),{
      OPENROUTER_API_KEY:process.env.OPENROUTER_API_KEY||'',
      OPENROUTER_MODEL:process.env.OPENROUTER_MODEL||undefined,
      RATE_LIMIT_PER_MINUTE:process.env.RATE_LIMIT_PER_MINUTE||undefined
    });
    const payload=Buffer.from(await response.arrayBuffer());
    response.headers.forEach((value,key)=>res.setHeader(key,value));
    res.status(response.status);
    res.end(payload);
  }catch(error){
    console.error('api/plan failed:',error);
    if(!res.headersSent)res.setHeader('Content-Type','application/json');
    res.status(500);
    res.end(JSON.stringify({error:'We could not reach the planner. Please try again.'}));
  }
}