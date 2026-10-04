import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/index.js';

const ENDPOINT='https://openrouter.ai/api/v1/chat/completions';
const MODEL='deepseek/deepseek-v4.1-flash';
const KEY='sk-or-test-key-not-real';

function plan(count,minutes){
  return {focus:'Python functions',possibilities:Array.from({length:count},(_,i)=>({title:`practice step ${i+1}`,outcome:'One working function',prerequisite:'A Python editor',tasks:[{title:'Read',minutes:minutes-2,action:'Read the defining-functions section and note the argument names.',resourceId:'python-functions',resourceUse:'Read the defining-functions section.'},{title:'Try',minutes:2,action:'Define add(a,b), return a+b and run two calls.',resourceId:'',resourceUse:''}]}))};
}
function completion(count,minutes){
  return new Response(JSON.stringify({id:'gen-test',object:'chat.completion',created:0,model:MODEL,choices:[{index:0,finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(plan(count,minutes))}}],usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30,cost:0.001}}),{status:200,headers:{'Content-Type':'application/json'}});
}
function providerError(status,message){
  return new Response(JSON.stringify({error:{code:status,message}}),{status,headers:{'Content-Type':'application/json'}});
}
async function withStub(handler,run){
  const originalFetch=globalThis.fetch,originalError=console.error,originalLog=console.log,originalWarn=console.warn;
  globalThis.fetch=handler;console.error=()=>{};console.log=()=>{};console.warn=()=>{};
  try{return await run()}finally{globalThis.fetch=originalFetch;console.error=originalError;console.log=originalLog;console.warn=originalWarn}
}
let requestCounter=0;
function post(body,extra={}){
  return worker.fetch(new Request('https://unscroll.test/api/plan',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':`198.51.100.${requestCounter+=1}`},body:JSON.stringify(body)}),{OPENROUTER_API_KEY:KEY,...extra});
}

test('calls deepseek/deepseek-v4.1-flash on the documented OpenRouter endpoint',async()=>{
  const seen=[];
  const response=await withStub(async(url,init)=>{seen.push({url,init});return completion(5,17)},()=>post({interest:'Python functions confuse me',availableMinutes:17}));
  assert.equal(response.status,200);
  assert.equal(seen.length,1);
  assert.equal(seen[0].url,ENDPOINT);
  assert.equal(seen[0].init.method,'POST');
  assert.equal(seen[0].init.headers.Authorization,`Bearer ${KEY}`);
  assert.equal(seen[0].init.headers['Content-Type'],'application/json');
  const payload=JSON.parse(seen[0].init.body);
  assert.equal(payload.model,MODEL);
  assert.equal(payload.stream,false);
  assert.equal(payload.reasoning.enabled,false);
  assert.equal(payload.temperature,0.2);
  assert.equal(payload.response_format.type,'json_schema');
  assert.equal(payload.response_format.json_schema.name,'unscroll_plan');
  assert.equal(payload.response_format.json_schema.strict,true);
  assert.equal(payload.response_format.json_schema.schema.properties.possibilities.minItems,5);
  assert.ok(payload.max_tokens>=5000,'a 5-possibility plan needs more than the old fixed 4000 budget');
  assert.ok(Array.isArray(payload.messages)&&payload.messages.length===2);
  assert.equal(payload.messages[0].role,'system');
  assert.equal(payload.messages[1].role,'user');
  const data=await response.json();
  assert.equal(data.possibilities.length,5);
  assert.equal(data.possibilities[0].tasks[0].resource.url,'https://docs.python.org/3/tutorial/controlflow.html#defining-functions');
});

test('a longer budget asks for and bounds a larger plan',async()=>{
  const seen=[];
  await withStub(async(url,init)=>{seen.push(JSON.parse(init.body));return completion(10,280)},()=>post({interest:'something interesting',availableMinutes:280}));
  assert.equal(seen[0].possibilities,undefined);
  assert.equal(seen[0].response_format.json_schema.schema.properties.possibilities.minItems,10);
  assert.ok(seen[0].max_tokens>5000);
});

test('OPENROUTER_MODEL overrides the default model',async()=>{
  const seen=[];
  await withStub(async(url,init)=>{seen.push(JSON.parse(init.body));return completion(5,17)},()=>post({interest:'Python functions confuse me',availableMinutes:17},{OPENROUTER_MODEL:'deepseek/deepseek-v4.1-flash-alt'}));
  assert.equal(seen[0].model,'deepseek/deepseek-v4.1-flash-alt');
});

test('an unusable model override cannot escape the model slug',async()=>{
  const seen=[];
  await withStub(async(url,init)=>{seen.push(JSON.parse(init.body));return completion(5,17)},()=>post({interest:'Python functions confuse me',availableMinutes:17},{OPENROUTER_MODEL:'evil model"; rm -rf /'}));
  assert.equal(seen[0].model,MODEL);
});

test('retries a rate-limited generation with backoff',async()=>{
  const seen=[];
  const response=await withStub(async(url,init)=>{seen.push(init);return seen.length===1?providerError(429,'Rate limit exceeded'):completion(5,17)},()=>post({interest:'Python functions confuse me',availableMinutes:17}));
  assert.equal(response.status,200);
  assert.equal(seen.length,2);
});

test('retries an upstream failure that was not billed',async()=>{
  const seen=[];
  const response=await withStub(async(url,init)=>{seen.push(init);return seen.length<3?providerError(502,'Provider returned error'):completion(5,17)},()=>post({interest:'Python functions confuse me',availableMinutes:17}));
  assert.equal(response.status,200);
  assert.equal(seen.length,3);
});

test('falls back to the default DeepSeek model when the requested model is unknown',async()=>{
  const seen=[];
  const response=await withStub(async(url,init)=>{const body=JSON.parse(init.body);seen.push(body.model);return body.model===MODEL?completion(5,17):providerError(404,'No provider can serve this model')},()=>post({interest:'Python functions confuse me',availableMinutes:17},{OPENROUTER_MODEL:'acme/not-a-model'}));
  assert.equal(response.status,200);
  assert.deepEqual(seen,['acme/not-a-model',MODEL]);
});

test('repairs malformed model output instead of forwarding it',async()=>{
  const seen=[];
  const response=await withStub(async(url,init)=>{seen.push(JSON.parse(init.body));return seen.length===1?new Response(JSON.stringify({choices:[{message:{role:'assistant',content:'Sorry, here is a plan in prose.'}}]}),{status:200,headers:{'Content-Type':'application/json'}}):completion(5,17)},()=>post({interest:'Python functions confuse me',availableMinutes:17}));
  assert.equal(response.status,200);
  assert.equal(seen.length,2);
  assert.equal(seen[1].messages.at(-1).role,'user');
  assert.match(seen[1].messages.at(-1).content,/Repair the response/);
});

test('drops a structured-output mode the model rejects',async()=>{
  const seen=[];
  const response=await withStub(async(url,init)=>{const body=JSON.parse(init.body);seen.push(body);return seen.length===1?providerError(400,'response_format is not supported'):completion(5,17)},()=>post({interest:'Python functions confuse me',availableMinutes:17}));
  assert.equal(response.status,200);
  assert.equal(seen[0].response_format.type,'json_schema');
  assert.equal(seen[1].response_format,undefined);
});

test('a plan with the wrong minute total is never returned',async()=>{
  let calls=0;
  const response=await withStub(async()=>{calls+=1;return completion(5,18)},()=>post({interest:'Python functions confuse me',availableMinutes:17}));
  assert.equal(response.status,502);
  assert.equal(calls,3);
  const data=await response.json();
  assert.equal(typeof data.error,'string');
  assert.equal(data.error.includes(KEY),false);
});

test('provider failures are reported honestly without leaking the key',async()=>{
  for(const [status,expected] of [[401,503],[402,503],[403,503],[429,429]]){
    const response=await withStub(async()=>providerError(status,'nope'),()=>post({interest:'Python functions confuse me',availableMinutes:17}));
    assert.equal(response.status,expected);
    assert.equal((await response.text()).includes(KEY),false);
  }
});

test('the rate limiter honours RATE_LIMIT_PER_MINUTE',async()=>{
  const env={OPENROUTER_API_KEY:KEY,RATE_LIMIT_PER_MINUTE:'1'};
  let calls=0;
  const seen=[];
  const run=()=>worker.fetch(new Request('https://unscroll.test/api/plan',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.9'},body:JSON.stringify({interest:'Python functions confuse me',availableMinutes:17})}),env);
  await withStub(async(url,init)=>{calls+=1;seen.push(init);return completion(5,17)},async()=>{
    assert.equal((await run()).status,200);
    assert.equal((await run()).status,429);
  });
  assert.equal(calls,1);
  assert.equal(seen.length,1);
});