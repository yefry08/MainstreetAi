import{c as f,p as v}from"./ai-BJoiKdGu.js";const $=`You are an art director specialising in urban visual identity.
Reply ONLY with valid JSON, no surrounding text.`;async function E(n,l,t,s,u){const a=`City: ${s.name}, ${s.country}.

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
}`,r=await f(n,l,{model:t,system:$,user:a,maxTokens:400,signal:u}),e=v(r),o=(i,c)=>typeof i=="string"&&/^#[0-9a-f]{6}$/i.test(i.trim())?i.trim():c;return{ground:o(e.ground,"#e9e3d6"),roads:o(e.roads,"#6e7078"),buildings:o(e.buildings,"#c9c2b4"),accent:o(e.accent,"#d97757"),sky:o(e.sky,"#dceaf2"),reason:typeof e.reason=="string"?e.reason.slice(0,240):""}}const M=`Eres un ingeniero de trafico que ajusta tiempos de semaforo.
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
  deja el reparto como esta: mover tiempo por ruido empeora la red.`;async function O(n,l,t,s,u,a=12){const r=s.queues(),e=A(r,a);if(!e.length)return{policy:null,applied:0,considered:0};const o=new Map(s.signals.map(g=>[g.id,g.greens])),i=e.map(([g,b])=>{const h=o.get(g)??[28,28];return`  {"id": ${g}, "cola_A": ${b.byGroup[0]}, "cola_B": ${b.byGroup[1]}, "verde_actual": [${h[0]}, ${h[1]}]}`}).join(`,
`),c=s.metrics(),d=`Estado de la red:
- velocidad media: ${c.meanSpeedKmh.toFixed(1)} km/h
- vehiculos detenidos: ${c.queued} de ${c.vehicles}

Cruces con mas cola:
[
${i}
]

Devuelve el nuevo reparto para cada uno:
{"policy": {"<id>": [<segundos_A>, <segundos_B>]}}`,y=await f(n,l,{model:t,system:M,user:d,maxTokens:600,signal:u});let p;try{p=v(y)}catch{return{policy:null,applied:0,considered:e.length,error:"invalid JSON from the model"}}const m=p.policy??p,S=s.applyPolicy(m);return{policy:m,applied:S,considered:e.length}}const _=4,G=3;function A(n,l){return[...n.entries()].filter(([,t])=>t.total>=_&&Math.abs(t.byGroup[0]-t.byGroup[1])>=G).sort((t,s)=>Math.abs(s[1].byGroup[0]-s[1].byGroup[1])-Math.abs(t[1].byGroup[0]-t[1].byGroup[1])).slice(0,l)}function P(n,l=40){const t=A(n.queues(),l);if(!t.length)return{policy:null,applied:0,considered:0};const s=new Map(n.signals.map(r=>[r.id,r.greens])),u={};for(const[r,e]of t){const[o,i]=s.get(r)??[28,28],c=o+i,d=(e.byGroup[0]+1)/(e.total+2),y=c*d,p=Math.round(o+(y-o)*.5);u[r]=[p,c-p]}const a=n.applyPolicy(u);return{policy:u,applied:a,considered:t.length}}function C({world:n,provider:l,key:t,model:s,everyMs:u=9e3,onTick:a}){let r=!1,e=0;const o=new AbortController,i=async()=>{if(!r){try{const d=await O(l,t,s,n,o.signal);e=0,a==null||a({...d,at:Date.now()})}catch(d){if(d.name==="AbortError"||r)return;if(e++,a==null||a({error:d.message,applied:0,failures:e}),e>=3){r=!0,a==null||a({error:d.message,halted:!0});return}}r||setTimeout(i,u)}},c=setTimeout(i,1200);return()=>{r=!0,clearTimeout(c),o.abort()}}export{E as c,P as p,C as s};
