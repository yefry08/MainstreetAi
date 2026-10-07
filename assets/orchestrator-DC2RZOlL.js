const g={gemini:{label:"Google Gemini",hint:"AIza…",models:["gemini-2.0-flash","gemini-2.5-flash"],keys:"https://aistudio.google.com/apikey"},openai:{label:"OpenAI",hint:"sk-…",models:["gpt-4o-mini","gpt-4o"],keys:"https://platform.openai.com/api-keys"},anthropic:{label:"Anthropic",hint:"sk-ant-…",models:["claude-sonnet-4-5","claude-haiku-4-5-20251001"],keys:"https://console.anthropic.com/settings/keys"},groq:{label:"Groq",hint:"gsk_…",models:["llama-3.3-70b-versatile"],keys:"https://console.groq.com/keys"},openrouter:{label:"OpenRouter",hint:"sk-or-…",models:["anthropic/claude-sonnet-4.5","google/gemini-2.0-flash-001"],keys:"https://openrouter.ai/keys"}};function E(o,{model:c,system:t,user:n,maxTokens:i}){const r=c||g[o].models[0];return o==="gemini"?{url:`https://generativelanguage.googleapis.com/v1beta/models/${r}:generateContent`,headers:{"Content-Type":"application/json","x-goog-api-key":"<KEY>"},body:{systemInstruction:{parts:[{text:t}]},contents:[{role:"user",parts:[{text:n}]}],generationConfig:{maxOutputTokens:i,temperature:.4}},pick:e=>{var s,a,l,u;return((u=(l=(a=(s=e==null?void 0:e.candidates)==null?void 0:s[0])==null?void 0:a.content)==null?void 0:l.parts)==null?void 0:u.map(d=>d.text).join(""))??""}}:o==="anthropic"?{url:"https://api.anthropic.com/v1/messages",headers:{"Content-Type":"application/json","x-api-key":"<KEY>","anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},body:{model:r,max_tokens:i,system:t,temperature:.4,messages:[{role:"user",content:n}]},pick:e=>{var s;return((s=e==null?void 0:e.content)==null?void 0:s.map(a=>a.text).join(""))??""}}:{url:{openai:"https://api.openai.com/v1/chat/completions",groq:"https://api.groq.com/openai/v1/chat/completions",openrouter:"https://openrouter.ai/api/v1/chat/completions"}[o],headers:{"Content-Type":"application/json",Authorization:"Bearer <KEY>"},body:{model:r,max_tokens:i,temperature:.4,messages:[{role:"system",content:t},{role:"user",content:n}]},pick:e=>{var s,a,l;return((l=(a=(s=e==null?void 0:e.choices)==null?void 0:s[0])==null?void 0:a.message)==null?void 0:l.content)??""}}}async function y(o,c,{model:t,system:n,user:i,maxTokens:r=700,signal:p}){if(!g[o])throw new Error(`Unknown provider: ${o}`);if(!c)throw new Error("Missing API key");const e=E(o,{model:t,system:n,user:i,maxTokens:r}),s=Object.fromEntries(Object.entries(e.headers).map(([u,d])=>[u,d.replace("<KEY>",c)]));let a;try{a=await fetch(e.url,{method:"POST",headers:s,body:JSON.stringify(e.body),signal:p})}catch(u){throw u.name==="AbortError"?u:new Error(`Could not reach ${g[o].label}. Check your connection, or whether an extension is blocking the request.`)}if(!a.ok){const u={401:"Key rejected (401). Check that it is correct and active.",403:"Access denied (403). The key may not have access to this model.",404:"Model not found (404). Try another of this provider’s models.",429:"Rate limit reached (429). Wait a moment or check your quota."};throw new Error(u[a.status]??`${g[o].label} answered ${a.status}.`)}const l=e.pick(await a.json());if(!l)throw new Error("The provider answered with no content.");return l}function v(o){const c=o.match(/```(?:json)?\s*([\s\S]*?)```/),t=(c?c[1]:o).trim(),n=t.indexOf("{"),i=t.lastIndexOf("}");if(n<0||i<=n)throw new Error("The model did not return JSON.");return JSON.parse(t.slice(n,i+1))}async function q(o,c,t,n){const i=await y(o,c,{model:t,system:"Reply with the single word OK.",user:"Say OK.",maxTokens:16,signal:n});return/ok/i.test(i)}const x=`You are an art director specialising in urban visual identity.
Reply ONLY with valid JSON, no surrounding text.`;async function _(o,c,t,n,i){const r=`City: ${n.name}, ${n.country}.

Choose a palette that visually represents this city: its light, its building
materials, its climate and its character. Do not use generic colours.

Return exactly this JSON:
{
  "ground": "#rrggbb",
  "roads": "#rrggbb",
  "buildings": "#rrggbb",
  "accent": "#rrggbb",
  "sky": "#rrggbb",
  "reason": "one sentence on why these colours represent the city"
}`,p=await y(o,c,{model:t,system:x,user:r,maxTokens:400,signal:i}),e=v(p),s=(a,l)=>typeof a=="string"&&/^#[0-9a-f]{6}$/i.test(a.trim())?a.trim():l;return{ground:s(e.ground,"#e9e3d6"),roads:s(e.roads,"#6e7078"),buildings:s(e.buildings,"#c9c2b4"),accent:s(e.accent,"#d97757"),sky:s(e.sky,"#dceaf2"),reason:typeof e.reason=="string"?e.reason.slice(0,240):""}}const A=`Eres un ingeniero de trafico que ajusta tiempos de semaforo.
Respondes SOLO con JSON valido, sin texto alrededor.

Cada cruce tiene DOS grupos de accesos que alternan: A y B.
Devuelves el reparto de verde [segundos_A, segundos_B].

Reglas:
- Cada verde va entre 8 y 55 segundos.
- REPARTE el tiempo: da mas a la direccion con mas cola y quita a la vacia.
- Manten la suma A+B parecida a la actual. Alargar el ciclo entero aumenta la
  espera de todos, incluso la de la direccion a la que das mas verde.
- No bajes ningun grupo de 8 segundos: dejarias coches atrapados.
- Cambia solo lo necesario. Si la diferencia de cola entre A y B es pequena,
  deja el reparto como esta: mover tiempo por ruido empeora la red.`;async function S(o,c,t,n,i,r=12){const p=n.queues(),e=k(p,r);if(!e.length)return{policy:null,applied:0,considered:0};const s=new Map(n.signals.map(m=>[m.id,m.greens])),a=e.map(([m,f])=>{const w=s.get(m)??[28,28];return`  {"id": ${m}, "cola_A": ${f.byGroup[0]}, "cola_B": ${f.byGroup[1]}, "verde_actual": [${w[0]}, ${w[1]}]}`}).join(`,
`),l=n.metrics(),u=`Estado de la red:
- velocidad media: ${l.meanSpeedKmh.toFixed(1)} km/h
- vehiculos detenidos: ${l.queued} de ${l.vehicles}

Cruces con mas cola:
[
${a}
]

Devuelve el nuevo reparto para cada uno:
{"policy": {"<id>": [<segundos_A>, <segundos_B>]}}`,d=await y(o,c,{model:t,system:A,user:u,maxTokens:600,signal:i});let h;try{h=v(d)}catch{return{policy:null,applied:0,considered:e.length,error:"invalid JSON from the model"}}const b=h.policy??h,O=n.applyPolicy(b);return{policy:b,applied:O,considered:e.length}}const $=4,C=3;function k(o,c){return[...o.entries()].filter(([,t])=>t.total>=$&&Math.abs(t.byGroup[0]-t.byGroup[1])>=C).sort((t,n)=>Math.abs(n[1].byGroup[0]-n[1].byGroup[1])-Math.abs(t[1].byGroup[0]-t[1].byGroup[1])).slice(0,c)}function G(o,c=40){const t=k(o.queues(),c);if(!t.length)return{policy:null,applied:0,considered:0};const n=new Map(o.signals.map(p=>[p.id,p.greens])),i={};for(const[p,e]of t){const[s,a]=n.get(p)??[28,28],l=s+a,u=(e.byGroup[0]+1)/(e.total+2),d=l*u,h=Math.round(s+(d-s)*.5);i[p]=[h,l-h]}const r=o.applyPolicy(i);return{policy:i,applied:r,considered:t.length}}function M({world:o,provider:c,key:t,model:n,everyMs:i=9e3,onTick:r}){let p=!1,e=0;const s=new AbortController,a=async()=>{if(!p){try{const u=await S(c,t,n,o,s.signal);e=0,r==null||r({...u,at:Date.now()})}catch(u){if(u.name==="AbortError"||p)return;if(e++,r==null||r({error:u.message,applied:0,failures:e}),e>=3){p=!0,r==null||r({error:u.message,halted:!0});return}}p||setTimeout(a,i)}},l=setTimeout(a,1200);return()=>{p=!0,clearTimeout(l),s.abort()}}export{g as P,_ as c,G as p,M as s,q as v};
