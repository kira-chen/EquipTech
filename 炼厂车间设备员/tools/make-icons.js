// 生成 50 个设备员技能图标：素材/图标/<分类>/<技能名>.svg、.png（128×128）和预览.html
// 用法：node tools/make-icons.js [输出根目录]   PNG 用本机 Chrome 无头模式导出，找不到 Chrome 时只出 SVG
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const root = process.argv[2] || path.join(__dirname, '../素材/图标');
const SIZE = 128;
const W = (w=26) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const S = W();
// 深色描边，k 为图标底色的深端
const D = (k, w) => `fill="none" stroke="${k}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
// 右下角徽标：白底圆，外圈用底色隔开下层图形
const badge = (cx, cy, r, k, inner) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${k}" stroke-width="14"/>${inner}`;
const tick = (cx, cy, k) => `<polyline points="${cx-22},${cy+2} ${cx-6},${cy+18} ${cx+24},${cy-14}" ${D(k,14)}/>`;
const mag = (cx, cy, r, k) => { const a = Math.round(cx + r*.72), b = Math.round(cy + r*.72), e = a + 50, f = b + 50; return `
    <line x1="${a}" y1="${b}" x2="${e}" y2="${f}" stroke="${k}" stroke-width="60" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="${r+20}" fill="${k}"/>
    <line x1="${a}" y1="${b}" x2="${e}" y2="${f}" stroke="#fff" stroke-width="32" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" ${W(24)}/>`; };
// 斜 45° 的铅笔，笔尖朝左下
const pencil = (cx, cy, len, k) => { const t = cy - len/2, b = cy + len/2;
  const body = a => `<rect x="${cx-22}" y="${t}" width="44" height="${len}" rx="8" ${a}/><polygon points="${cx-22},${b} ${cx+22},${b} ${cx},${b+40}" ${a}/>`;
  return `
    <g transform="rotate(45 ${cx} ${cy})">${body(`fill="${k}" stroke="${k}" stroke-width="28" stroke-linejoin="round"`)}${body('fill="#fff"')}
    <line x1="${cx-22}" y1="${t+30}" x2="${cx+22}" y2="${t+30}" stroke="${k}" stroke-width="8"/></g>`; };
// 开口扳手，rot 为旋转角度
const wrench = (cx, cy, rot, k) => { const h = cy - 70;
  const draw = (c, d) => `<path d="M${cx+22} ${h-38} A44 44 0 1 1 ${cx-22} ${h-38}" fill="none" stroke="${c}" stroke-width="${30+d}" stroke-linecap="round"/><line x1="${cx}" y1="${cy-26}" x2="${cx}" y2="${cy+100}" stroke="${c}" stroke-width="${34+d}" stroke-linecap="round"/>`;
  return `
    <g transform="rotate(${rot} ${cx} ${cy})">${draw(k, 28)}${draw('#fff', 0)}</g>`; };
const star = (cx, cy, r, extra='') => { const p = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI/2 + i*Math.PI/5, rr = i % 2 ? r*.45 : r; p.push(`${Math.round(cx + rr*Math.cos(a))},${Math.round(cy + rr*Math.sin(a))}`); }
  return `<polygon points="${p.join(' ')}" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"${extra}/>`; };
// 以 (cx,cy) 为圆心、角度 deg 处从 r1 到 r2 的径向短线
const ray = (cx, cy, deg, r1, r2, a) => { const t = deg*Math.PI/180, c = Math.cos(t), s = Math.sin(t);
  return `<line x1="${Math.round(cx+r1*c)}" y1="${Math.round(cy+r1*s)}" x2="${Math.round(cx+r2*c)}" y2="${Math.round(cy+r2*s)}" ${a}/>`; };
const arrowDef = id => `<defs><marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
      <path d="M1 1 L9 5 L1 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`;
const C = {
  red:['#F87171','#B91C1C'], orange:['#FB923C','#C2410C'], amber:['#FBBF24','#B45309'], yellow:['#FACC15','#A16207'],
  lime:['#A3E635','#4D7C0F'], green:['#4ADE80','#15803D'], emerald:['#34D399','#047857'], teal:['#2DD4BF','#0F766E'],
  cyan:['#22D3EE','#0E7490'], sky:['#38BDF8','#0369A1'], blue:['#60A5FA','#1D4ED8'], indigo:['#818CF8','#4338CA'],
  violet:['#A78BFA','#6D28D9'], purple:['#C084FC','#7E22CE'], fuchsia:['#E879F9','#A21CAF'], pink:['#F472B6','#BE185D'],
  rose:['#FB7185','#BE123C'], slate:['#94A3B8','#334155'],
};
// g 可以是字符串，或接收底色深端 k 的函数
const groups = {
'01-日常运行监控与巡检': {
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
},
'02-缺陷报修与检修管理': {
  'completion-acceptance': { cn:'检修完工验收', c:C.emerald, g: k => `
    <path d="M206 314 L180 414 L218 398 L242 428 L262 340 Z" fill="#fff" opacity=".8"/>
    <path d="M306 314 L332 414 L294 398 L270 428 L250 340 Z" fill="#fff" opacity=".8"/>
    <circle cx="256" cy="220" r="118" fill="#fff"/>
    <polyline points="198,222 240,264 318,182" ${D(k,30)}/>` },
  'defect-intake-grading': { cn:'设备缺陷登记与分级', c:C.orange, g:`
    <rect x="104" y="128" width="208" height="256" rx="30" ${S}/>
    <line x1="208" y1="188" x2="208" y2="272" ${W(30)}/>
    <circle cx="208" cy="324" r="18" fill="#fff"/>
    <rect x="346" y="128" width="64" height="64" rx="16" fill="#fff"/>
    <rect x="346" y="224" width="64" height="64" rx="16" fill="#fff" opacity=".7"/>
    <rect x="346" y="320" width="64" height="64" rx="16" fill="#fff" opacity=".4"/>` },
  'equipment-handover-check': { cn:'检修前设备交出确认', c:C.amber, g: k => `
    <path d="M196 236 V184 A60 60 0 0 1 316 184 V236" ${S}/>
    <rect x="156" y="226" width="200" height="164" rx="30" fill="#fff"/>
    <circle cx="256" cy="292" r="22" fill="${k}"/>
    <rect x="246" y="300" width="20" height="46" rx="8" fill="${k}"/>${badge(370, 370, 52, k, tick(370, 370, k))}` },
  'maintenance-demand-rollup': { cn:'检修需求汇总上报', c:C.sky, g:`
    <polygon points="212,128 316,180 212,232 108,180" fill="#fff" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>
    <polyline points="108,242 212,294 316,242" ${S}/>
    <polyline points="108,306 212,358 316,306" ${S} opacity=".7"/>
    <line x1="392" y1="384" x2="392" y2="150" ${S}/>
    <polyline points="352,190 392,150 432,190" ${S}/>` },
  'maintenance-record-archive': { cn:'检修记录归档', c:C.teal, g:`
    <rect x="112" y="128" width="288" height="84" rx="22" fill="#fff"/>
    <path d="M136 212 V356 Q136 388 168 388 H344 Q376 388 376 356 V212" ${S}/>
    <line x1="222" y1="276" x2="290" y2="276" ${W(28)}/>` },
  'overhaul-process-check-bridge': { cn:'车间检修方案安全措施核查入口', c:C.blue, g: k => `
    <rect x="112" y="100" width="200" height="268" rx="28" ${S}/>
    <line x1="158" y1="170" x2="266" y2="170" ${W(22)}/>
    <line x1="158" y1="226" x2="240" y2="226" ${W(22)}/>
    <line x1="158" y1="282" x2="214" y2="282" ${W(22)}/>
    <path d="M346 236 L424 262 V318 C424 366 392 398 346 416 C300 398 268 366 268 318 V262 Z" fill="#fff" stroke="${k}" stroke-width="14" stroke-linejoin="round"/>
    <polyline points="314,322 338,346 380,300" ${D(k,16)}/>` },
  'permit-precheck-bridge': { cn:'车间作业票预检入口', c:C.fuchsia, g: k => `
    <path d="M132 120 H364 Q392 120 392 148 V184 A26 26 0 0 0 392 236 V272 Q392 300 364 300 H132 Q104 300 104 272 V236 A26 26 0 0 0 104 184 V148 Q104 120 132 120 Z" ${S}/>
    <line x1="168" y1="150" x2="168" y2="270" stroke="#fff" stroke-width="10" stroke-dasharray="14 14" stroke-linecap="round" opacity=".75"/>
    <line x1="214" y1="176" x2="340" y2="176" ${W(22)}/>
    <line x1="214" y1="228" x2="290" y2="228" ${W(22)}/>${mag(340, 330, 54, k)}` },
  'repair-plan-assistant': { cn:'检修方案辅助编制', c:C.lime, g: k => `
    <rect x="112" y="100" width="210" height="276" rx="28" ${S}/>
    <line x1="158" y1="170" x2="276" y2="170" ${W(22)}/>
    <line x1="158" y1="226" x2="250" y2="226" ${W(22)}/>
    <line x1="158" y1="282" x2="210" y2="282" ${W(22)}/>${wrench(336, 336, 45, k)}` },
  'repeat-failure-detector': { cn:'重复故障识别', c:C.red, g:`
    ${arrowDef('ah-repeat')}
    <path d="M143 215 A120 120 0 0 1 348 179" ${S} marker-end="url(#ah-repeat)"/>
    <path d="M369 297 A120 120 0 0 1 164 333" ${S} marker-end="url(#ah-repeat)"/>
    <polygon points="272,166 204,270 248,270 236,350 308,244 262,244" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>` },
  'turnaround-workshop-tracker': { cn:'大检修车间侧跟踪', c:C.violet, g: k => `
    <line x1="112" y1="116" x2="112" y2="396" ${W(20)} opacity=".6"/>
    <rect x="140" y="132" width="160" height="56" rx="18" fill="#fff"/>
    <polyline points="196,160 212,176 242,146" ${D(k,12)}/>
    <rect x="204" y="228" width="180" height="56" rx="18" fill="#fff" opacity=".85"/>
    <rect x="268" y="324" width="132" height="56" rx="18" fill="#fff" opacity=".55"/>` },
  'work-order-generator': { cn:'维修通知单草稿生成', c:C.indigo, g: k => `
    <rect x="112" y="100" width="220" height="290" rx="28" ${S}/>
    <line x1="158" y1="170" x2="286" y2="170" ${W(22)}/>
    <line x1="158" y1="226" x2="256" y2="226" ${W(22)}/>
    <line x1="158" y1="282" x2="214" y2="282" ${W(22)}/>${pencil(348, 300, 150, k)}` },
  'work-order-tracker': { cn:'维修工单跟踪与催办', c:C.cyan, g: k => `
    <rect x="112" y="100" width="220" height="290" rx="28" ${S}/>
    <line x1="158" y1="170" x2="286" y2="170" ${W(22)}/>
    <line x1="158" y1="226" x2="256" y2="226" ${W(22)}/>
    <line x1="158" y1="282" x2="214" y2="282" ${W(22)}/>${badge(352, 344, 66, k, `
    <line x1="352" y1="344" x2="352" y2="306" ${D(k,14)}/><line x1="352" y1="344" x2="380" y2="362" ${D(k,14)}/>`)}` },
},
'03-承包商与作业现场管理': {
  'contractor-performance-log': { cn:'承包商表现记录', c:C.amber, g: k => `
    <path d="M152 262 C152 188 198 140 256 140 C314 140 360 188 360 262 Z" fill="#fff"/>
    <line x1="256" y1="160" x2="256" y2="226" ${D(k,14)}/>
    <rect x="116" y="252" width="280" height="42" rx="21" fill="#fff"/>
    ${star(168, 366, 36)}${star(256, 366, 36)}${star(344, 366, 36, ' opacity=".45"')}` },
  'contractor-qualification-check': { cn:'承包商资质核验', c:C.sky, g: k => `
    <rect x="100" y="130" width="312" height="230" rx="30" ${S}/>
    <circle cx="184" cy="214" r="34" fill="#fff"/>
    <path d="M132 312 C132 276 158 258 184 258 C210 258 236 276 236 312 Z" fill="#fff"/>
    <line x1="276" y1="206" x2="360" y2="206" ${W(22)}/>
    <line x1="276" y1="254" x2="332" y2="254" ${W(22)}/>${badge(368, 360, 56, k, tick(368, 360, k))}` },
  'cross-operation-conflict': { cn:'交叉作业冲突检测', c:C.rose, g: k => `
    <line x1="130" y1="382" x2="372" y2="140" ${S}/>
    <polyline points="300,140 372,140 372,212" ${S}/>
    <line x1="382" y1="382" x2="140" y2="140" ${S}/>
    <polyline points="212,140 140,140 140,212" ${S}/>
    <circle cx="256" cy="256" r="50" fill="#fff" stroke="${k}" stroke-width="14"/>
    <line x1="256" y1="232" x2="256" y2="260" ${D(k,16)}/>
    <circle cx="256" cy="284" r="9" fill="${k}"/>` },
  'site-supervision-points': { cn:'现场作业监督要点', c:C.teal, g: k => `
    <path d="M92 256 C160 160 352 160 420 256 C352 352 160 352 92 256 Z" ${S}/>
    <circle cx="256" cy="256" r="64" fill="#fff"/>
    <circle cx="256" cy="256" r="26" fill="${k}"/>
    <circle cx="274" cy="238" r="9" fill="#fff"/>` },
},
'04-台账档案与资料管理': {
  'equipment-ledger-query': { cn:'设备台账查询', c:C.blue, g: k => `
    <rect x="104" y="112" width="250" height="230" rx="24" ${S}/>
    <line x1="104" y1="186" x2="354" y2="186" ${W(22)}/>
    <line x1="104" y1="264" x2="290" y2="264" ${W(22)}/>
    <line x1="190" y1="112" x2="190" y2="342" ${W(22)}/>${mag(346, 334, 56, k)}` },
  'moc-change-assistant': { cn:'设备变更管理辅助', c:C.violet, g:`
    <rect x="104" y="112" width="140" height="140" rx="28" ${S}/>
    <rect x="268" y="260" width="140" height="140" rx="28" fill="#fff"/>
    <path d="M272 182 H306 Q338 182 338 214 V236" ${W(22)}/>
    <polyline points="310,208 338,236 366,208" ${W(22)}/>
    <path d="M242 330 H206 Q174 330 174 298 V280" ${W(22)} opacity=".7"/>
    <polyline points="146,306 174,278 202,306" ${W(22)} opacity=".7"/>` },
  'nameplate-ocr-intake': { cn:'铭牌识别与台账录入', c:C.slate, g: k => `
    <path d="M112 176 V140 Q112 112 140 112 H176" ${S}/>
    <path d="M336 112 H372 Q400 112 400 140 V176" ${S}/>
    <path d="M400 336 V372 Q400 400 372 400 H336" ${S}/>
    <path d="M176 400 H140 Q112 400 112 372 V336" ${S}/>
    <rect x="164" y="186" width="184" height="140" rx="16" fill="#fff"/>
    <circle cx="184" cy="206" r="7" fill="${k}"/><circle cx="328" cy="206" r="7" fill="${k}"/>
    <circle cx="184" cy="306" r="7" fill="${k}"/><circle cx="328" cy="306" r="7" fill="${k}"/>
    <line x1="210" y1="236" x2="302" y2="236" ${D(k,14)}/>
    <line x1="210" y1="276" x2="272" y2="276" ${D(k,14)}/>` },
  'special-equipment-inspection-due': { cn:'特种设备定检到期管理', c:C.orange, g: k => `
    <rect x="176" y="78" width="32" height="30" rx="8" fill="#fff"/>
    <rect x="128" y="104" width="128" height="272" rx="64" ${S}/>
    <line x1="142" y1="240" x2="242" y2="240" ${W(18)} opacity=".6"/>
    <line x1="158" y1="380" x2="146" y2="414" ${W(22)}/>
    <line x1="226" y1="380" x2="238" y2="414" ${W(22)}/>
    <rect x="268" y="252" width="148" height="148" rx="26" fill="#fff" stroke="${k}" stroke-width="14"/>
    <line x1="275" y1="298" x2="409" y2="298" stroke="${k}" stroke-width="10"/>
    <line x1="342" y1="322" x2="342" y2="352" ${D(k,16)}/>
    <circle cx="342" cy="376" r="9" fill="${k}"/>` },
  'technical-document-finder': { cn:'技术资料检索与原文引用', c:C.emerald, g:`
    <path d="M256 156 C214 126 160 120 108 132 V372 C160 360 214 366 256 396 C298 366 352 360 404 372 V132 C352 120 298 126 256 156 Z" ${S}/>
    <line x1="256" y1="156" x2="256" y2="396" ${W(20)}/>
    <line x1="150" y1="200" x2="218" y2="200" ${W(18)} opacity=".75"/>
    <line x1="150" y1="250" x2="218" y2="250" ${W(18)} opacity=".75"/>
    <line x1="150" y1="300" x2="200" y2="300" ${W(18)} opacity=".75"/>
    <line x1="294" y1="200" x2="362" y2="200" ${W(18)} opacity=".75"/>
    <rect x="282" y="228" width="92" height="44" rx="12" fill="#fff"/>
    <line x1="294" y1="300" x2="350" y2="300" ${W(18)} opacity=".75"/>` },
  'valve-instrument-calibration-ledger': { cn:'安全阀校验台账到期管理', c:C.red, g:`
    <line x1="104" y1="336" x2="408" y2="336" ${W(30)}/>
    <polygon points="160,280 256,336 160,392" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>
    <polygon points="352,280 256,336 352,392" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>
    <line x1="256" y1="336" x2="256" y2="212" ${W(20)}/>
    <polyline points="256,212 222,200 290,180 222,160 290,140 256,128" ${W(16)}/>
    <rect x="216" y="102" width="80" height="26" rx="10" fill="#fff"/>` },
},
'05-备品备件与物资': {
  'spare-parts-consumption-analysis': { cn:'备件消耗分析', c:C.fuchsia, g:`
    <path d="M240 152 A124 124 0 1 0 364 276 H240 Z" ${S}/>
    <path d="M272 244 V120 A124 124 0 0 1 396 244 Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>` },
  'spare-parts-demand': { cn:'备件需求提报', c:C.lime, g: k => `
    <path d="M244 112 L372 172 V316 L244 376 L116 316 V172 Z" ${S}/>
    <polyline points="116,172 244,232 372,172" ${S}/>
    <line x1="244" y1="232" x2="244" y2="376" ${S}/>${badge(372, 368, 56, k, `
    <line x1="372" y1="342" x2="372" y2="394" ${D(k,16)}/><line x1="346" y1="368" x2="398" y2="368" ${D(k,16)}/>`)}` },
  'spare-parts-inventory-query': { cn:'备件库存查询', c:C.cyan, g:`
    <path d="M100 212 L256 124 L412 212" ${S}/>
    <path d="M132 200 V396 M380 200 V396" ${S}/>
    <rect x="220" y="216" width="72" height="72" rx="10" fill="#fff" opacity=".6"/>
    <rect x="176" y="304" width="72" height="72" rx="10" fill="#fff"/>
    <rect x="264" y="304" width="72" height="72" rx="10" fill="#fff" opacity=".8"/>` },
},
'06-报表与沟通': {
  'equipment-daily-report': { cn:'车间设备日报', c:C.amber, g:`
    <rect x="124" y="100" width="264" height="312" rx="32" ${S}/>
    <circle cx="256" cy="204" r="38" fill="#fff"/>
    ${[0,45,90,135,180,225,270,315].map(a => ray(256, 204, a, 56, 74, W(16))).join('')}
    <line x1="176" y1="318" x2="336" y2="318" ${W(22)}/>
    <line x1="176" y1="364" x2="292" y2="364" ${W(22)}/>` },
  'equipment-event-notice': { cn:'设备事件通报起草', c:C.rose, g:`
    <path d="M168 296 L188 380 H226 L212 296" ${W(20)}/>
    <path d="M120 216 H176 L320 136 V376 L176 296 H120 Q104 296 104 280 V232 Q104 216 120 216 Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>
    <path d="M360 212 Q388 256 360 300" ${W(22)}/>
    <path d="M392 176 Q440 256 392 336" ${W(22)} opacity=".7"/>` },
  'equipment-weekly-monthly-report': { cn:'设备周报月报', c:C.indigo, g:`
    <rect x="112" y="132" width="288" height="264" rx="32" ${S}/>
    <line x1="112" y1="208" x2="400" y2="208" ${W(22)}/>
    <line x1="184" y1="104" x2="184" y2="156" ${S}/>
    <line x1="328" y1="104" x2="328" y2="156" ${S}/>
    ${[234, 284, 334].map((y, r) => [150, 208, 266, 324].map(x => `<rect x="${x}" y="${y}" width="36" height="34" rx="8" fill="#fff"${r === 1 ? '' : ' opacity=".45"'}/>`).join('')).join('\n    ')}` },
  'inspection-evidence-package': { cn:'迎检资料准备', c:C.teal, g:`
    <path d="M108 168 Q108 140 136 140 H216 L248 172 H376 Q404 172 404 200 V364 Q404 392 376 392 H136 Q108 392 108 364 Z" ${S}/>
    <line x1="108" y1="216" x2="404" y2="216" ${W(18)} opacity=".6"/>
    <polyline points="196,294 236,334 316,254" ${W(30)}/>` },
  'meeting-material-builder': { cn:'设备会议汇报稿', c:C.sky, g:`
    <rect x="104" y="112" width="304" height="208" rx="24" ${S}/>
    <line x1="256" y1="320" x2="256" y2="364" ${S}/>
    <line x1="256" y1="352" x2="196" y2="410" ${S}/>
    <line x1="256" y1="352" x2="316" y2="410" ${S}/>
    <rect x="178" y="236" width="36" height="50" rx="8" fill="#fff" opacity=".7"/>
    <rect x="238" y="200" width="36" height="86" rx="8" fill="#fff" opacity=".85"/>
    <rect x="298" y="164" width="36" height="122" rx="8" fill="#fff"/>` },
  'self-audit-form-filler': { cn:'自查表预填', c:C.violet, g: k => `
    <rect x="108" y="100" width="224" height="300" rx="28" ${S}/>
    <rect x="146" y="142" width="36" height="36" rx="8" fill="#fff"/><polyline points="154,160 162,168 176,152" ${D(k,8)}/>
    <line x1="208" y1="160" x2="290" y2="160" ${W(20)}/>
    <rect x="146" y="218" width="36" height="36" rx="8" fill="#fff"/><polyline points="154,236 162,244 176,228" ${D(k,8)}/>
    <line x1="208" y1="236" x2="280" y2="236" ${W(20)}/>
    <rect x="148" y="296" width="32" height="32" rx="8" ${W(10)} opacity=".7"/>
    <line x1="208" y1="312" x2="254" y2="312" ${W(20)} opacity=".7"/>${pencil(352, 300, 150, k)}` },
  'shift-handover-record': { cn:'设备员工作交接记录', c:C.emerald, g: k => `
    <line x1="120" y1="140" x2="372" y2="140" ${S}/>
    <polyline points="332,100 372,140 332,180" ${S}/>
    <line x1="392" y1="372" x2="140" y2="372" ${S}/>
    <polyline points="180,332 140,372 180,412" ${S}/>
    <rect x="200" y="196" width="112" height="120" rx="18" fill="#fff"/>
    <line x1="226" y1="232" x2="286" y2="232" ${D(k,12)}/>
    <line x1="226" y1="258" x2="286" y2="258" ${D(k,12)}/>
    <line x1="226" y1="284" x2="264" y2="284" ${D(k,12)}/>` },
},
'07-隐患事故与合规': {
  'failure-case-retrieval': { cn:'故障案例检索', c:C.blue, g: k => `
    <rect x="160" y="104" width="232" height="168" rx="24" fill="#fff" opacity=".45"/>
    <rect x="112" y="148" width="232" height="168" rx="24" fill="#fff"/>
    <line x1="148" y1="196" x2="260" y2="196" ${D(k,16)}/>
    <line x1="148" y1="236" x2="300" y2="236" ${D(k,16)}/>
    <line x1="148" y1="276" x2="220" y2="276" ${D(k,16)}/>${mag(344, 344, 54, k)}` },
  'failure-investigation-assistant': { cn:'故障调查辅助', c:C.purple, g:`
    <line x1="104" y1="256" x2="352" y2="256" ${S}/>
    <path d="M352 196 L416 256 L352 316 Z" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>
    ${[168, 248, 328].map(x => `<line x1="${x}" y1="256" x2="${x-44}" y2="160" ${W(20)}/><line x1="${x}" y1="256" x2="${x-44}" y2="352" ${W(20)}/>`).join('\n    ')}` },
  'hazard-closure-tracker': { cn:'隐患整改闭环跟踪', c:C.orange, g:`
    ${arrowDef('ah-hazard')}
    <path d="M351 176 A124 124 0 1 1 234 134" ${S} marker-end="url(#ah-hazard)"/>
    <polyline points="196,262 240,306 320,214" ${W(30)}/>` },
  'regulation-compliance-check': { cn:'法规制度符合性自查', c:C.slate, g:`
    <line x1="256" y1="128" x2="256" y2="388" ${S}/>
    <line x1="180" y1="396" x2="332" y2="396" ${S}/>
    <line x1="132" y1="168" x2="380" y2="168" ${S}/>
    <circle cx="256" cy="124" r="20" fill="#fff"/>
    <polyline points="104,284 132,168 160,284" ${W(12)}/>
    <path d="M92 280 H172 A40 40 0 0 1 92 280 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>
    <polyline points="352,284 380,168 408,284" ${W(12)}/>
    <path d="M340 280 H420 A40 40 0 0 1 340 280 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>` },
  'safety-environmental-device-check': { cn:'安全环保设施状态检查', c:C.green, g: k => `
    <path d="M256 104 L392 152 V256 C392 336 334 386 256 412 C178 386 120 336 120 256 V152 Z" ${S}/>
    <path d="M256 330 C196 296 192 228 256 176 C320 228 316 296 256 330 Z" fill="#fff"/>
    <line x1="256" y1="214" x2="256" y2="316" ${D(k,12)}/>
    <line x1="256" y1="330" x2="256" y2="360" ${W(14)}/>` },
},
'08-知识与能力支持': {
  'equipment-energy-analysis': { cn:'设备能效分析', c:C.yellow, g:`
    <path d="M112 324 A144 144 0 0 1 400 324" ${S}/>
    ${[210, 240, 300, 330].map(a => ray(256, 324, a, 100, 116, W(16))).join('')}
    <polygon points="274,196 214,296 252,296 238,372 300,266 262,266" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>` },
  'equipment-knowledge-qa': { cn:'设备专业知识问答', c:C.blue, g:`
    <path d="M152 112 H360 Q408 112 408 160 V296 Q408 344 360 344 H236 L164 404 V344 H152 Q104 344 104 296 V160 Q104 112 152 112 Z" ${S}/>
    <path d="M214 196 A42 42 0 1 1 288 223 Q256 240 256 266" ${W(28)}/>
    <circle cx="256" cy="306" r="16" fill="#fff"/>` },
  'operator-anomaly-guide': { cn:'操作工异常识别指引卡', c:C.orange, g: k => `
    <line x1="256" y1="112" x2="256" y2="400" ${S}/>
    <line x1="196" y1="404" x2="316" y2="404" ${S}/>
    <path d="M140 140 H340 L380 180 L340 220 H140 Q124 220 124 204 V156 Q124 140 140 140 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>
    <line x1="176" y1="164" x2="176" y2="184" ${D(k,14)}/>
    <circle cx="176" cy="202" r="7" fill="${k}"/>
    <line x1="212" y1="180" x2="320" y2="180" ${D(k,14)}/>
    <path d="M372 248 H172 L132 288 L172 328 H372 Q388 328 388 312 V264 Q388 248 372 248 Z" fill="${k}" stroke="#fff" stroke-width="26" stroke-linejoin="round"/>` },
  'training-material-generator': { cn:'培训材料与考题生成', c:C.violet, g:`
    <path d="M168 250 V318 C168 362 344 362 344 318 V250" ${S}/>
    <polygon points="256,138 412,206 256,274 100,206" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>
    <line x1="380" y1="220" x2="380" y2="316" ${W(14)}/>
    <circle cx="380" cy="328" r="16" fill="#fff"/>` },
  'worklog-todo-manager': { cn:'工作日志与待办管理', c:C.teal, g:`
    <rect x="140" y="100" width="248" height="312" rx="28" ${S}/>
    ${[168, 256, 344].map(y => `<line x1="112" y1="${y}" x2="164" y2="${y}" ${W(20)}/>`).join('')}
    <polyline points="204,180 218,194 244,166" ${W(16)}/><line x1="268" y1="180" x2="344" y2="180" ${W(20)}/>
    <polyline points="204,256 218,270 244,242" ${W(16)}/><line x1="268" y1="256" x2="344" y2="256" ${W(20)}/>
    <circle cx="224" cy="332" r="14" ${W(12)} opacity=".7"/><line x1="268" y1="332" x2="324" y2="332" ${W(20)} opacity=".7"/>` },
},
};

const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', process.env.CHROME].find(p => p && fs.existsSync(p));
const toPng = (svg, png) => execFileSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--default-background-color=00000000', `--window-size=${SIZE},${SIZE}`, `--screenshot=${png}`, 'file://' + svg], { stdio: 'ignore' });
const style = `<style>body{font-family:-apple-system,"PingFang SC",sans-serif;background:#f4f5f7;margin:0;padding:32px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:28px;margin-bottom:40px}
figure{margin:0;text-align:center}img{width:128px;height:128px;filter:drop-shadow(0 6px 14px rgba(0,0,0,.15))}
figcaption{margin-top:10px;font-size:14px}figcaption span{display:block;color:#888;font-size:12px;margin-top:4px}</style>`;
let all = '', n = 0;
for (const [cat, icons] of Object.entries(groups)) {
  const out = path.join(root, cat);
  fs.mkdirSync(out, { recursive: true });
  let cards = '', allCards = '';
  for (const [name, d] of Object.entries(icons)) {
    const id = 'bg-' + name;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${d.c[0]}"/><stop offset="1" stop-color="${d.c[1]}"/></linearGradient>
    <linearGradient id="hl-${name}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#${id})"/>
  <rect width="512" height="512" rx="112" fill="url(#hl-${name})"/>${typeof d.g === 'function' ? d.g(d.c[1]) : d.g}
</svg>
`;
    const file = path.join(out, name + '.svg');
    fs.writeFileSync(file, svg);
    if (chrome) toPng(path.resolve(file), path.join(out, name + '.png'));
    const fig = src => `<figure><img src="${src}"><figcaption><b>${d.cn}</b><span>${name}</span></figcaption></figure>\n`;
    cards += fig(name + '.svg');
    allCards += fig(`${cat}/${name}.svg`);
    n++;
  }
  fs.writeFileSync(path.join(out, '预览.html'), `<!doctype html><meta charset="utf-8"><title>${cat.slice(0, 2)} 类技能图标</title>
${style}
<h2>${cat}</h2><main>${cards}</main>`);
  all += `<h2>${cat}</h2><main>${allCards}</main>\n`;
}
fs.writeFileSync(path.join(root, '预览.html'), `<!doctype html><meta charset="utf-8"><title>设备员技能图标</title>
${style}
${all}`);
console.log('ok', n, chrome ? 'svg+png' : 'svg（未找到 Chrome，未导出 PNG）');
