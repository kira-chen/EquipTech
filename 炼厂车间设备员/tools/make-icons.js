const fs = require('fs'), path = require('path');
const out = process.argv[2];
const W = (w=26) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const S = W();
const icons = {
  'anomaly-triage-advisor': { cn:'设备异常初判与处置建议', c:['#FF8A65','#E53935'], g:`
    <path d="M256 104 L414 378 Q424 398 402 398 H110 Q88 398 98 378 Z" ${S}/>
    <polyline points="150,318 202,318 226,268 256,356 288,226 312,318 362,318" ${W(22)}/>` },
  'inspection-data-digest': { cn:'巡检点检数据汇总', c:['#60A5FA','#1D4ED8'], g:`
    <rect x="140" y="124" width="232" height="292" rx="30" ${S}/>
    <rect x="200" y="98" width="112" height="54" rx="18" fill="#fff"/>
    <rect x="186" y="300" width="36" height="72" rx="10" fill="#fff"/>
    <rect x="238" y="250" width="36" height="122" rx="10" fill="#fff"/>
    <rect x="290" y="200" width="36" height="172" rx="10" fill="#fff" opacity=".75"/>` },
  'inspection-task-dispatch': { cn:'巡检点检任务清单生成', c:['#818CF8','#4338CA'], g:`
    <rect x="112" y="142" width="44" height="44" rx="10" ${W(20)}/>
    <polyline points="122,164 132,174 148,152" ${W(14)}/>
    <rect x="112" y="234" width="44" height="44" rx="10" ${W(20)}/>
    <polyline points="122,256 132,266 148,244" ${W(14)}/>
    <rect x="112" y="326" width="44" height="44" rx="10" ${W(20)} opacity=".7"/>
    <line x1="196" y1="164" x2="280" y2="164" ${S}/>
    <line x1="196" y1="256" x2="268" y2="256" ${S}/>
    <line x1="196" y1="348" x2="256" y2="348" ${S} opacity=".7"/>
    <path d="M362 392 C330 352 308 322 308 290 A54 54 0 1 1 416 290 C416 322 394 352 362 392 Z" fill="#fff"/>
    <circle cx="362" cy="290" r="20" fill="#4F46E5"/>` },
  'leak-point-tracker': { cn:'泄漏点登记与修复跟踪', c:['#22D3EE','#0E7490'], g:`
    <line x1="100" y1="196" x2="412" y2="196" stroke="#fff" stroke-width="58" stroke-linecap="round"/>
    <rect x="222" y="136" width="68" height="120" rx="16" fill="#fff" stroke="#0E7490" stroke-width="10"/>
    <path d="M256 284 C256 284 200 346 200 380 A56 56 0 0 0 312 380 C312 346 256 284 256 284 Z" fill="#fff"/>
    <circle cx="172" cy="318" r="11" fill="#fff" opacity=".7"/>
    <circle cx="340" cy="306" r="9" fill="#fff" opacity=".55"/>` },
  'lubrication-manager': { cn:'设备润滑五定管理', c:['#FCD34D','#EA580C'], g:`
    <rect x="128" y="236" width="196" height="150" rx="26" ${S}/>
    <rect x="196" y="190" width="60" height="46" rx="10" fill="#fff"/>
    <path d="M324 290 L408 214" ${S}/>
    <path d="M128 266 C84 266 84 346 128 346" ${W(22)}/>
    <path d="M408 256 C408 256 386 284 386 300 A22 22 0 0 0 430 300 C430 284 408 256 408 256 Z" fill="#fff"/>
    <line x1="168" y1="320" x2="284" y2="320" ${W(18)} opacity=".6"/>` },
  'parameter-trend-alert': { cn:'参数越限与劣化趋势预警', c:['#F472B6','#BE185D'], g:`
    <path d="M124 120 V390 H400" ${S}/>
    <line x1="150" y1="188" x2="396" y2="188" stroke="#fff" stroke-width="12" stroke-dasharray="20 16" stroke-linecap="round" opacity=".75"/>
    <polyline points="160,344 208,312 252,328 300,262 352,190" ${S}/>
    <circle cx="352" cy="190" r="30" fill="#fff"/>
    <circle cx="352" cy="190" r="12" fill="#BE185D"/>` },
  'runtime-hours-tracker': { cn:'运行小时与启停次数统计', c:['#4ADE80','#15803D'], g:`
    <circle cx="256" cy="282" r="126" ${S}/>
    <rect x="226" y="98" width="60" height="38" rx="12" fill="#fff"/>
    <line x1="256" y1="136" x2="256" y2="156" ${S}/>
    <line x1="352" y1="168" x2="374" y2="146" ${W(22)}/>
    <path d="M256 282 L256 202" ${S}/>
    <path d="M256 282 L314 316" ${W(22)}/>
    <circle cx="256" cy="282" r="18" fill="#fff"/>` },
  'standby-rotation-reminder': { cn:'备用设备切换与盘车提醒', c:['#C084FC','#7E22CE'], g:`
    <defs><marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
      <path d="M1 1 L9 5 L1 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
    <circle cx="156" cy="256" r="62" fill="#fff"/>
    <path d="M156 256 q14 -30 0 -40" transform="rotate(0 156 256)" fill="none" stroke="#7E22CE" stroke-width="12" stroke-linecap="round"/><path d="M156 256 q14 -30 0 -40" transform="rotate(120 156 256)" fill="none" stroke="#7E22CE" stroke-width="12" stroke-linecap="round"/><path d="M156 256 q14 -30 0 -40" transform="rotate(240 156 256)" fill="none" stroke="#7E22CE" stroke-width="12" stroke-linecap="round"/><circle cx="156" cy="256" r="9" fill="#7E22CE"/>
    <circle cx="356" cy="256" r="62" ${S}/>
    <path d="M356 256 q14 -30 0 -40" transform="rotate(0 356 256)" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/><path d="M356 256 q14 -30 0 -40" transform="rotate(120 356 256)" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/><path d="M356 256 q14 -30 0 -40" transform="rotate(240 356 256)" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/><circle cx="356" cy="256" r="9" fill="#fff"/>
    <path d="M176 160 Q256 104 330 156" ${W(22)} marker-end="url(#ah)"/>
    <path d="M336 352 Q256 408 182 356" ${W(22)} marker-end="url(#ah)" opacity=".75"/>` },
};
let cards = '';
for (const [name, d] of Object.entries(icons)) {
  const id = 'bg-' + name;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.c[0]}"/><stop offset="1" stop-color="${d.c[1]}"/></linearGradient>
    <linearGradient id="hl-${name}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#${id})"/>
  <rect width="512" height="512" rx="112" fill="url(#hl-${name})"/>${d.g}
</svg>
`;
  fs.writeFileSync(path.join(out, name + '.svg'), svg);
  cards += `<figure><img src="${name}.svg"><figcaption><b>${d.cn}</b><span>${name}</span></figcaption></figure>\n`;
}
fs.writeFileSync(path.join(out, '预览.html'), `<!doctype html><meta charset="utf-8"><title>01 类技能图标</title>
<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#f4f5f7;margin:0;padding:32px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:28px}
figure{margin:0;text-align:center}img{width:128px;height:128px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.15))}
figcaption{margin-top:10px;font-size:14px}figcaption span{display:block;color:#888;font-size:12px;margin-top:4px}</style>
<h2>01-日常运行监控与巡检</h2><main>${cards}</main>`);
console.log('ok', Object.keys(icons).length);
