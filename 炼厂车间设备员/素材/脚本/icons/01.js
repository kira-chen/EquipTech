// 01-日常运行监控与巡检：每个技能的 flat（A 扁平）、solid（C 块面）、real（D 拟物）字形，可以是字符串或接收底色深端 k 的函数
const { W, S, D, badge, tick, mag, pencil, wrench, star, ray, arrowDef, C, badgeC, magC, pencilC, wrenchC, docC, groundShadow, checkD, warnD, magD, pencilD, wrenchD, clockD, docD } = require('./lib');

// 叶轮的三片叶片
const blades = (cx, cy, color, w = 12, extra = '') => [0, 120, 240].map(a =>
  `<path d="M${cx} ${cy} q14 -30 0 -40" transform="rotate(${a} ${cx} ${cy})" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${extra}/>`).join('');
// 油滴，(cx, top) 为尖端，r 为下部圆半径
const drop = (cx, top, r, fill) => `<path d="M${cx} ${top} C${cx} ${top} ${cx-r} ${top+r*1.1} ${cx-r} ${top+r*1.75} A${r} ${r} 0 0 0 ${cx+r} ${top+r*1.75} C${cx+r} ${top+r*1.1} ${cx} ${top} ${cx} ${top} Z" fill="${fill}"/>`;
const PIN = 'M362 392 C330 352 308 322 308 290 A54 54 0 1 1 416 290 C416 322 394 352 362 392 Z';
const TRI = 'M256 104 L414 378 Q424 398 402 398 H110 Q88 398 98 378 Z';
const ticks = (cx, cy, r1, r2, a) => Array.from({ length: 12 }, (_, i) => ray(cx, cy, i * 30, r1, r2, a)).join('');

module.exports = { name: '01-日常运行监控与巡检', icons: {
  'anomaly-triage-advisor': { cn:'设备异常初判与处置建议', c:['#FF8A65','#E53935'], flat:`
    <path d="M256 104 L414 378 Q424 398 402 398 H110 Q88 398 98 378 Z" ${S}/>
    <polyline points="150,318 202,318 226,268 256,356 288,226 312,318 362,318" ${W(22)}/>`,
    solid: k => `
    <path d="${TRI}" fill="url(#wf)" stroke="url(#wf)" stroke-width="20" stroke-linejoin="round"/>
    <path d="M256 104 L414 378 Q424 398 402 398 H256 Z" fill="#C5D2E0" opacity=".45"/>
    <polyline points="150,318 202,318 226,268 256,356 288,226 312,318 362,318" ${D(k,24)}/>`,
    real: `
    ${groundShadow(256, 414, 160, 14)}
    <g filter="url(#ds)"><path d="${TRI}" fill="url(#lg-yellow)" stroke="#FDE047" stroke-width="24" stroke-linejoin="round"/></g>
    <polyline points="150,322 202,322 226,272 256,358 288,230 312,322 362,322" fill="none" stroke="#1F2937" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>` },
  'inspection-data-digest': { cn:'巡检点检数据汇总', c:['#60A5FA','#1D4ED8'], flat:`
    <rect x="140" y="124" width="232" height="292" rx="30" ${S}/>
    <rect x="200" y="98" width="112" height="54" rx="18" fill="#fff"/>
    <rect x="186" y="300" width="36" height="72" rx="10" fill="#fff"/>
    <rect x="238" y="250" width="36" height="122" rx="10" fill="#fff"/>
    <rect x="290" y="200" width="36" height="172" rx="10" fill="#fff" opacity=".75"/>`,
    solid: k => `
    <rect x="140" y="124" width="232" height="292" rx="30" fill="url(#wf2)"/>
    <rect x="160" y="150" width="192" height="246" rx="18" fill="url(#wf)"/>
    <rect x="200" y="98" width="112" height="54" rx="18" fill="${k}"/>
    <rect x="214" y="105" width="84" height="12" rx="6" fill="#fff" opacity=".35"/>
    <rect x="186" y="300" width="36" height="72" rx="10" fill="${k}" opacity=".45"/>
    <rect x="238" y="250" width="36" height="122" rx="10" fill="${k}" opacity=".65"/>
    <rect x="290" y="200" width="36" height="172" rx="10" fill="${k}" opacity=".9"/>`,
    real: `
    ${groundShadow(256, 424, 130, 12)}
    <g filter="url(#ds)">
      <rect x="140" y="124" width="232" height="292" rx="30" fill="url(#lg-amber)"/>
      <rect x="162" y="152" width="188" height="244" rx="14" fill="url(#paper)"/>
      <rect x="200" y="98" width="112" height="54" rx="18" fill="url(#steelV)"/>
      <rect x="236" y="110" width="40" height="14" rx="7" fill="#6B7280"/>
      <rect x="186" y="300" width="36" height="72" rx="8" fill="url(#lg-green)"/>
      <rect x="238" y="250" width="36" height="122" rx="8" fill="url(#lg-blue)"/>
      <rect x="290" y="200" width="36" height="172" rx="8" fill="url(#lg-orange)"/></g>` },
  'inspection-task-dispatch': { cn:'巡检点检任务清单生成', c:['#818CF8','#4338CA'], flat:`
    <rect x="112" y="142" width="44" height="44" rx="10" ${W(20)}/>
    <polyline points="122,164 132,174 148,152" ${W(14)}/>
    <rect x="112" y="234" width="44" height="44" rx="10" ${W(20)}/>
    <polyline points="122,256 132,266 148,244" ${W(14)}/>
    <rect x="112" y="326" width="44" height="44" rx="10" ${W(20)} opacity=".7"/>
    <line x1="196" y1="164" x2="280" y2="164" ${S}/>
    <line x1="196" y1="256" x2="268" y2="256" ${S}/>
    <line x1="196" y1="348" x2="256" y2="348" ${S} opacity=".7"/>
    <path d="M362 392 C330 352 308 322 308 290 A54 54 0 1 1 416 290 C416 322 394 352 362 392 Z" fill="#fff"/>
    <circle cx="362" cy="290" r="20" fill="#4F46E5"/>`,
    solid: k => `
    <rect x="96" y="120" width="232" height="276" rx="28" fill="url(#wf)"/>
    ${[176, 258].map(y => `<rect x="124" y="${y-22}" width="44" height="44" rx="12" fill="${k}"/><polyline points="134,${y} 144,${y+10} 160,${y-10}" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    <rect x="188" y="166" width="104" height="20" rx="10" fill="${k}" opacity=".3"/>
    <rect x="188" y="248" width="90" height="20" rx="10" fill="${k}" opacity=".3"/>
    <rect x="128" y="322" width="36" height="36" rx="10" fill="none" stroke="${k}" stroke-width="8" opacity=".45"/>
    <rect x="188" y="330" width="72" height="20" rx="10" fill="${k}" opacity=".3"/>
    <path d="${PIN}" fill="${k}" stroke="${k}" stroke-width="28" stroke-linejoin="round"/>
    <path d="${PIN}" fill="url(#wf)"/>
    <circle cx="362" cy="290" r="20" fill="${k}"/>`,
    real: `
    ${groundShadow(240, 414, 150, 12)}
    <g filter="url(#ds)">
      <rect x="96" y="116" width="236" height="282" rx="24" fill="url(#paper)"/>
      <path d="M96 156 V140 Q96 116 120 116 H308 Q332 116 332 140 V156 Z" fill="#1E3A8A"/>
      ${[196, 262].map(y => `<rect x="122" y="${y-20}" width="40" height="40" rx="10" fill="url(#lg-green)"/><polyline points="132,${y} 140,${y+8} 154,${y-8}" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/><rect x="182" y="${y-8}" width="110" height="16" rx="8" fill="#CBD5E1"/>`).join('')}
      <rect x="125" y="311" width="34" height="34" rx="9" fill="#fff" stroke="#CBD5E1" stroke-width="6"/>
      <rect x="182" y="320" width="80" height="16" rx="8" fill="#CBD5E1"/></g>
    <g filter="url(#ds)"><path d="${PIN}" fill="url(#rg-red)"/><circle cx="362" cy="290" r="20" fill="#fff"/></g>` },
  'leak-point-tracker': { cn:'泄漏点登记与修复跟踪', c:['#22D3EE','#0E7490'], flat:`
    <line x1="100" y1="196" x2="412" y2="196" stroke="#fff" stroke-width="58" stroke-linecap="round"/>
    <rect x="222" y="136" width="68" height="120" rx="16" fill="#fff" stroke="#0E7490" stroke-width="10"/>
    <path d="M256 284 C256 284 200 346 200 380 A56 56 0 0 0 312 380 C312 346 256 284 256 284 Z" fill="#fff"/>
    <circle cx="172" cy="318" r="11" fill="#fff" opacity=".7"/>
    <circle cx="340" cy="306" r="9" fill="#fff" opacity=".55"/>`,
    solid: k => `
    <rect x="80" y="166" width="352" height="60" rx="20" fill="url(#wf)"/>
    <rect x="94" y="171" width="324" height="12" rx="6" fill="#fff" opacity=".85"/>
    <rect x="218" y="132" width="76" height="128" rx="16" fill="url(#wf2)" stroke="${k}" stroke-width="10"/>
    <rect x="232" y="142" width="48" height="10" rx="5" fill="#fff" opacity=".85"/>
    ${drop(256, 280, 56, 'url(#wf)')}
    <ellipse cx="234" cy="370" rx="11" ry="20" fill="#fff"/>
    <circle cx="172" cy="318" r="12" fill="url(#wf2)"/>
    <circle cx="340" cy="306" r="10" fill="url(#wf2)"/>`,
    real: `
    <ellipse cx="256" cy="426" rx="104" ry="14" fill="url(#lg-amber)" opacity=".85"/>
    <g filter="url(#ds)">
      <rect x="80" y="166" width="352" height="60" rx="8" fill="url(#steelV)"/>
      <rect x="214" y="130" width="84" height="132" rx="12" fill="url(#steelH)"/>
      <rect x="214" y="188" width="84" height="16" fill="#4B5563" opacity=".55"/></g>
    <g filter="url(#ds2)">${drop(256, 262, 52, 'url(#rg-amber)')}
      <ellipse cx="236" cy="348" rx="10" ry="17" fill="#fff" opacity=".8"/></g>` },
  'lubrication-manager': { cn:'设备润滑五定管理', c:['#FCD34D','#EA580C'], flat:`
    <rect x="128" y="236" width="196" height="150" rx="26" ${S}/>
    <rect x="196" y="190" width="60" height="46" rx="10" fill="#fff"/>
    <path d="M324 290 L408 214" ${S}/>
    <path d="M128 266 C84 266 84 346 128 346" ${W(22)}/>
    <path d="M408 256 C408 256 386 284 386 300 A22 22 0 0 0 430 300 C430 284 408 256 408 256 Z" fill="#fff"/>
    <line x1="168" y1="320" x2="284" y2="320" ${W(18)} opacity=".6"/>`,
    solid: k => `
    <path d="M324 300 L402 222" fill="none" stroke="url(#wfu)" stroke-width="30" stroke-linecap="round"/>
    <path d="M132 266 C84 266 84 346 132 346" fill="none" stroke="url(#wfu)" stroke-width="26" stroke-linecap="round"/>
    <rect x="196" y="186" width="60" height="54" rx="12" fill="url(#wf2)"/>
    <rect x="128" y="232" width="196" height="156" rx="28" fill="url(#wf)"/>
    <rect x="146" y="240" width="160" height="12" rx="6" fill="#fff"/>
    <rect x="150" y="296" width="152" height="40" rx="12" fill="${k}" opacity=".35"/>
    ${drop(410, 252, 22, 'url(#wf)')}`,
    real: `
    ${groundShadow(228, 406, 130, 14)}
    <g filter="url(#ds)">
      <polygon points="302,240 316,324 422,234 400,204" fill="url(#steelV)" stroke="#D1D5DB" stroke-width="8" stroke-linejoin="round"/>
      <path d="M132 264 C80 264 80 350 132 350" fill="none" stroke="#1E3A8A" stroke-width="24" stroke-linecap="round"/>
      <rect x="192" y="186" width="68" height="56" rx="12" fill="url(#steelH)"/>
      <rect x="124" y="232" width="204" height="160" rx="28" fill="url(#lh-blue)"/>
      <rect x="150" y="288" width="152" height="48" rx="12" fill="#fff" opacity=".92"/>
      <rect x="170" y="304" width="112" height="16" rx="8" fill="#93C5FD"/></g>
    <g filter="url(#ds2)">${drop(414, 250, 28, '#fff')}${drop(414, 260, 22, 'url(#rg-amber)')}</g>` },
  'parameter-trend-alert': { cn:'参数越限与劣化趋势预警', c:['#F472B6','#BE185D'], flat:`
    <path d="M124 120 V390 H400" ${S}/>
    <line x1="150" y1="188" x2="396" y2="188" stroke="#fff" stroke-width="12" stroke-dasharray="20 16" stroke-linecap="round" opacity=".75"/>
    <polyline points="160,344 208,312 252,328 300,262 352,190" ${S}/>
    <circle cx="352" cy="190" r="30" fill="#fff"/>
    <circle cx="352" cy="190" r="12" fill="#BE185D"/>`,
    solid: k => `
    <rect x="100" y="112" width="312" height="288" rx="30" fill="url(#wf)"/>
    <rect x="120" y="120" width="272" height="12" rx="6" fill="#fff"/>
    <line x1="136" y1="196" x2="376" y2="196" stroke="${k}" stroke-width="10" stroke-dasharray="18 14" stroke-linecap="round" opacity=".55"/>
    <path d="M140 352 L194 318 L242 334 L294 268 L346 196 V368 H140 Z" fill="${k}" opacity=".15"/>
    <polyline points="140,352 194,318 242,334 294,268 346,196" ${D(k,20)}/>
    <circle cx="346" cy="196" r="28" fill="${k}"/><circle cx="346" cy="196" r="11" fill="#fff"/>`,
    real: `
    ${groundShadow(256, 412, 120, 12)}
    <g filter="url(#ds)">
      <rect x="236" y="330" width="40" height="52" fill="url(#steelH)"/>
      <rect x="176" y="376" width="160" height="22" rx="11" fill="url(#steelV)"/>
      <rect x="92" y="104" width="328" height="236" rx="26" fill="url(#lg-slate)"/>
      <rect x="112" y="124" width="288" height="196" rx="14" fill="#0F172A"/></g>
    <line x1="132" y1="180" x2="380" y2="180" stroke="#F87171" stroke-width="8" stroke-dasharray="16 12" stroke-linecap="round"/>
    <path d="M136 290 L188 262 L236 276 L290 222 L342 170 V304 H136 Z" fill="#22C55E" opacity=".2"/>
    <polyline points="136,290 188,262 236,276 290,222 342,170" fill="none" stroke="#4ADE80" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="342" cy="170" r="32" fill="#EF4444" opacity=".35"/>
    <circle cx="342" cy="170" r="18" fill="url(#rg-red)"/>` },
  'runtime-hours-tracker': { cn:'运行小时与启停次数统计', c:['#4ADE80','#15803D'], flat:`
    <circle cx="256" cy="282" r="126" ${S}/>
    <rect x="226" y="98" width="60" height="38" rx="12" fill="#fff"/>
    <line x1="256" y1="136" x2="256" y2="156" ${S}/>
    <line x1="352" y1="168" x2="374" y2="146" ${W(22)}/>
    <path d="M256 282 L256 202" ${S}/>
    <path d="M256 282 L314 316" ${W(22)}/>
    <circle cx="256" cy="282" r="18" fill="#fff"/>`,
    solid: k => `
    <rect x="222" y="94" width="68" height="40" rx="12" fill="url(#wf2)"/>
    <rect x="242" y="130" width="28" height="30" fill="url(#wf2)"/>
    <g transform="rotate(45 362 158)"><rect x="346" y="134" width="32" height="44" rx="8" fill="url(#wf2)"/></g>
    <circle cx="256" cy="282" r="134" fill="url(#wf)"/>
    <circle cx="256" cy="282" r="106" fill="#fff"/>
    <path d="M256 282 V190 A92 92 0 0 1 335 329 Z" fill="${k}" opacity=".18"/>
    ${ticks(256, 282, 92, 102, `${D(k,8)} opacity=".45"`)}
    <line x1="256" y1="282" x2="256" y2="202" ${D(k,22)}/>
    <line x1="256" y1="282" x2="314" y2="316" ${D(k,18)}/>
    <circle cx="256" cy="282" r="16" fill="${k}"/>`,
    real: `
    ${groundShadow(256, 428, 120, 12)}
    <g filter="url(#ds)">
      <rect x="222" y="94" width="68" height="40" rx="12" fill="url(#lg-red)"/>
      <rect x="242" y="130" width="28" height="30" fill="url(#steelH)"/>
      <g transform="rotate(45 362 158)"><rect x="346" y="134" width="32" height="44" rx="8" fill="url(#steelH)"/></g>
      <circle cx="256" cy="282" r="134" fill="url(#steelR)"/>
      <circle cx="256" cy="282" r="110" fill="url(#face)"/></g>
    <path d="M256 282 V190 A92 92 0 0 1 335 329 Z" fill="#F97316" opacity=".85"/>
    ${ticks(256, 282, 94, 104, 'stroke="#94A3B8" stroke-width="8" stroke-linecap="round"')}
    <line x1="256" y1="282" x2="256" y2="204" stroke="#1F2937" stroke-width="18" stroke-linecap="round"/>
    <line x1="256" y1="282" x2="312" y2="314" stroke="#1F2937" stroke-width="14" stroke-linecap="round"/>
    <circle cx="256" cy="282" r="14" fill="url(#rg-red)"/>` },
  'standby-rotation-reminder': { cn:'备用设备切换与盘车提醒', c:['#C084FC','#7E22CE'], flat:`
    <defs><marker id="ah" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
      <path d="M1 1 L9 5 L1 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>
    <circle cx="156" cy="256" r="62" fill="#fff"/>
    <path d="M156 256 q14 -30 0 -40" transform="rotate(0 156 256)" fill="none" stroke="#7E22CE" stroke-width="12" stroke-linecap="round"/><path d="M156 256 q14 -30 0 -40" transform="rotate(120 156 256)" fill="none" stroke="#7E22CE" stroke-width="12" stroke-linecap="round"/><path d="M156 256 q14 -30 0 -40" transform="rotate(240 156 256)" fill="none" stroke="#7E22CE" stroke-width="12" stroke-linecap="round"/><circle cx="156" cy="256" r="9" fill="#7E22CE"/>
    <circle cx="356" cy="256" r="62" ${S}/>
    <path d="M356 256 q14 -30 0 -40" transform="rotate(0 356 256)" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/><path d="M356 256 q14 -30 0 -40" transform="rotate(120 356 256)" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/><path d="M356 256 q14 -30 0 -40" transform="rotate(240 356 256)" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/><circle cx="356" cy="256" r="9" fill="#fff"/>
    <path d="M176 160 Q256 104 330 156" ${W(22)} marker-end="url(#ah)"/>
    <path d="M336 352 Q256 408 182 356" ${W(22)} marker-end="url(#ah)" opacity=".75"/>`,
    solid: k => `
    ${arrowDef('ah-sc')}
    <circle cx="156" cy="256" r="66" fill="url(#wf)"/>${blades(156, 256, k, 14)}<circle cx="156" cy="256" r="10" fill="${k}"/>
    <circle cx="356" cy="256" r="66" fill="url(#wf2)"/>${blades(356, 256, k, 14, ' opacity=".65"')}<circle cx="356" cy="256" r="10" fill="${k}" opacity=".65"/>
    <path d="M176 160 Q256 104 330 156" fill="none" stroke="url(#wfu)" stroke-width="22" stroke-linecap="round" marker-end="url(#ah-sc)"/>
    <path d="M336 352 Q256 408 182 356" fill="none" stroke="url(#wfu)" stroke-width="22" stroke-linecap="round" marker-end="url(#ah-sc)" opacity=".75"/>`,
    real: `
    ${arrowDef('ah-sd', '#FBBF24')}
    <g filter="url(#ds2)"><circle cx="156" cy="256" r="70" fill="url(#steelR)"/><circle cx="156" cy="256" r="54" fill="url(#rg-green)"/>${blades(156, 256, '#fff', 12)}<circle cx="156" cy="256" r="9" fill="#fff"/></g>
    <g filter="url(#ds2)"><circle cx="356" cy="256" r="70" fill="url(#steelR)"/><circle cx="356" cy="256" r="54" fill="url(#rg-slate)"/>${blades(356, 256, '#fff', 12, ' opacity=".8"')}<circle cx="356" cy="256" r="9" fill="#fff" opacity=".8"/></g>
    <path d="M176 160 Q256 104 330 156" fill="none" stroke="#FBBF24" stroke-width="22" stroke-linecap="round" marker-end="url(#ah-sd)"/>
    <path d="M336 352 Q256 408 182 356" fill="none" stroke="#FBBF24" stroke-width="22" stroke-linecap="round" marker-end="url(#ah-sd)" opacity=".8"/>` },
} };
