import {test} from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/plan.js';
import worker from '../server/index.js';

function fakeRes(){
  const res={statusCode:0,headers:{},body:'',ended:false};
  res.setHeader=(key,value)=>{res.headers[String(key).toLowerCase()]=value};
  res.status=code=>{res.statusCode=code;return res};
  res.end=payload=>{res.ended=true;if(payload)res.body=Buffer.isBuffer(payload)?payload.toString('utf8'):String(payload);return res};
  return res;
}
function fakeReq({url='/api/plan',method='POST',headers={},body='',ip='203.0.113.44'}={}){
  const listeners={};
  return {url,method,headers:{'host':'unscroll.vercel.app','x-forwarded-proto':'https','content-type':'application/json',...headers},socket:{remoteAddress:ip},
    on(event,fn){listeners[event]=fn;return this},
    resume(){queueMicrotask(()=>{for(const chunk of [Buffer.from(body)])listeners.data?.(chunk);listeners.end?.()});return this}};
}
async function call(req){
  const res=fakeRes();
  req.resume();
  await handler(req,res);
  return res;
}

test('the Vercel function is the same Worker handler, not a reimplementation',async()=>{
  assert.equal(typeof handler,'function');
  assert.equal(typeof worker.fetch,'function');
});

test('rejects a cross-origin POST before reading the body or calling the provider',async()=>{
  const res=await call(fakeReq({headers:{origin:'https://elsewhere.test'},body:'{"interest":"x","availableMinutes":17}'}));
  assert.equal(res.statusCode,403);
});

test('validates input and reports a missing key honestly',async()=>{
  const bad=await call(fakeReq({body:JSON.stringify({interest:'',availableMinutes:17})}));
  assert.equal(bad.statusCode,400);
  const saved=process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try{
    const noKey=await call(fakeReq({body:JSON.stringify({interest:'Python',availableMinutes:17})}));
    assert.equal(noKey.statusCode,503);
  }finally{if(saved!==undefined)process.env.OPENROUTER_API_KEY=saved}
});

test('rejects the wrong method and oversized bodies',async()=>{
  const get=await call(fakeReq({method:'GET'}));
  assert.equal(get.statusCode,405);
  const huge=await call(fakeReq({body:JSON.stringify({interest:'x'.repeat(17000),availableMinutes:17})}));
  assert.equal(huge.statusCode,413);
});

test('returns a real plan through the function with the request body intact',async()=>{
  const originalFetch=globalThis.fetch,originalLog=console.log,originalError=console.error;
  globalThis.fetch=async(url,init)=>{
    assert.equal(url,'https://openrouter.ai/api/v1/chat/completions');
    const payload=JSON.parse(init.body);
    assert.equal(payload.model,'deepseek/deepseek-v4.1-flash');
    const interest=JSON.parse(payload.messages.at(-1).content).interest;
    assert.equal(interest,'I want to understand black holes.');
    const content=JSON.stringify({focus:'Black holes',possibilities:Array.from({length:8},(_,i)=>({title:`practice ${i}`,outcome:'An outcome',prerequisite:'A notebook',tasks:[{title:'Read',minutes:65,action:'Read the NASA overview.',resourceId:'black-holes',resourceUse:'Read the overview.'},{title:'Try',minutes:68,action:'Explain it back.',resourceId:'',resourceUse:''}]}))});
    return new Response(JSON.stringify({choices:[{message:{role:'assistant',content}}],usage:{prompt_tokens:1,completion_tokens:2,total_tokens:3,cost:0}}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  console.log=()=>{};console.error=()=>{};
  const saved=process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY='sk-or-v1-adapter-test';
  try{
    const res=await call(fakeReq({headers:{origin:'https://unscroll.vercel.app','content-type':'application/json'},body:JSON.stringify({interest:'I want to understand black holes.',availableMinutes:133})}));
    assert.equal(res.statusCode,200);
    assert.match(res.headers['content-type'],/application\/json/);
    const data=JSON.parse(res.body);
    assert.equal(data.possibilities.length,8);
    for(const p of data.possibilities)assert.equal(p.tasks.reduce((a,t)=>a+t.minutes,0),133);
    assert.equal(data.possibilities[0].tasks[0].resource.url,'https://science.nasa.gov/universe/black-holes/');
  }finally{
    globalThis.fetch=originalFetch;console.log=originalLog;console.error=originalError;
    if(saved!==undefined)process.env.OPENROUTER_API_KEY=saved;else delete process.env.OPENROUTER_API_KEY;
  }
});