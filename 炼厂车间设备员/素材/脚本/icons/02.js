// 02-缺陷报修与检修管理：每个技能的 flat（A 扁平）、solid（C 块面）、real（D 拟物）字形，可以是字符串或接收底色深端 k 的函数
const { W, S, D, badge, tick, mag, pencil, wrench, star, ray, arrowDef, C, badgeC, magC, pencilC, wrenchC, docC, groundShadow, checkD, warnD, magD, pencilD, wrenchD, clockD, docD } = require('./lib');
// 等轴测薄板：顶面菱形 + 左右两个侧面，y 为顶点纵坐标
const tile = (y, top, left, right) => `
    <polygon points="212,${y} 316,${y+52} 212,${y+104} 108,${y+52}" fill="${top}"/>
    <polygon points="108,${y+52} 212,${y+104} 212,${y+124} 108,${y+72}" fill="${left}"/>
    <polygon points="212,${y+104} 316,${y+52} 316,${y+72} 212,${y+124}" fill="${right}"/>`;
// 箭头三角：圆弧终点 (x,y)、终点处顺时针切向角 deg
const head = (x, y, deg, fill) => { const t = deg*Math.PI/180, tx = Math.cos(t), ty = Math.sin(t), nx = -ty, ny = tx;
  return `<polygon points="${Math.round(x+tx*38)},${Math.round(y+ty*38)} ${Math.round(x+nx*34)},${Math.round(y+ny*34)} ${Math.round(x-nx*34)},${Math.round(y-ny*34)}" fill="${fill}" stroke="${fill}" stroke-width="8" stroke-linejoin="round"/>`; };

module.exports = { name: '02-缺陷报修与检修管理', icons: {
  'completion-acceptance': { cn:'检修完工验收', c:C.emerald, flat: k => `
    <path d="M206 314 L180 414 L218 398 L242 428 L262 340 Z" fill="#fff" opacity=".8"/>
    <path d="M306 314 L332 414 L294 398 L270 428 L250 340 Z" fill="#fff" opacity=".8"/>
    <circle cx="256" cy="220" r="118" fill="#fff"/>
    <polyline points="198,222 240,264 318,182" ${D(k,30)}/>`,
    solid: k => `
    <path d="M206 314 L180 414 L218 398 L242 428 L262 340 Z" fill="url(#wf)"/>
    <path d="M306 314 L332 414 L294 398 L270 428 L250 340 Z" fill="url(#wf2)"/>
    <circle cx="256" cy="220" r="118" fill="url(#wf)"/>
    <circle cx="256" cy="220" r="94" fill="${k}" opacity=".14"/>
    <path d="M166 192 A94 94 0 0 1 236 128" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
    <polyline points="198,222 240,264 318,182" ${D(k,30)}/>`,
    real: `
    ${groundShadow(256, 432, 110, 12)}
    <path d="M206 314 L180 414 L218 398 L242 428 L262 340 Z" fill="url(#lg-red)"/>
    <path d="M306 314 L332 414 L294 398 L270 428 L250 340 Z" fill="url(#lg-red)"/>
    <g filter="url(#ds)">
      <circle cx="256" cy="220" r="118" fill="url(#rg-amber)"/>
      <circle cx="256" cy="220" r="104" fill="none" stroke="#FDE68A" stroke-width="6" opacity=".8"/>
      <circle cx="256" cy="220" r="86" fill="url(#face)"/>
      <polyline points="208,222 244,258 310,190" fill="none" stroke="#16A34A" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/></g>` },
  'defect-intake-grading': { cn:'设备缺陷登记与分级', c:C.orange, flat:`
    <rect x="104" y="128" width="208" height="256" rx="30" ${S}/>
    <line x1="208" y1="188" x2="208" y2="272" ${W(30)}/>
    <circle cx="208" cy="324" r="18" fill="#fff"/>
    <rect x="346" y="128" width="64" height="64" rx="16" fill="#fff"/>
    <rect x="346" y="224" width="64" height="64" rx="16" fill="#fff" opacity=".7"/>
    <rect x="346" y="320" width="64" height="64" rx="16" fill="#fff" opacity=".4"/>`,
    solid: k => `
    <rect x="104" y="128" width="208" height="256" rx="30" fill="url(#wf)"/>
    <rect x="120" y="140" width="176" height="14" rx="7" fill="#fff"/>
    <rect x="194" y="180" width="28" height="104" rx="14" fill="${k}" opacity=".75"/>
    <circle cx="208" cy="326" r="19" fill="${k}" opacity=".75"/>
    ${[[128, .6], [224, .32], [320, .08]].map(([y, o]) => `<rect x="346" y="${y}" width="64" height="64" rx="16" fill="url(#wf)"/><rect x="358" y="${y+12}" width="40" height="40" rx="10" fill="${k}" opacity="${o}"/>`).join('\n    ')}`,
    real: `
    ${groundShadow(256, 410, 165)}
    <g filter="url(#ds)"><rect x="100" y="120" width="208" height="272" rx="24" fill="url(#paper)"/>
      <rect x="128" y="316" width="128" height="18" rx="9" fill="#CBD5E1"/>
      <rect x="128" y="348" width="84" height="18" rx="9" fill="#CBD5E1"/></g>${warnD(204, 222, 66)}
    <g filter="url(#ds)"><rect x="330" y="120" width="92" height="272" rx="26" fill="url(#lh-slate)"/>
      <circle cx="376" cy="174" r="30" fill="url(#rg-red)"/>
      <circle cx="376" cy="256" r="30" fill="url(#rg-orange)"/>
      <circle cx="376" cy="338" r="30" fill="url(#rg-yellow)"/></g>` },
  'equipment-handover-check': { cn:'检修前设备交出确认', c:C.amber, flat: k => `
    <path d="M196 236 V184 A60 60 0 0 1 316 184 V236" ${S}/>
    <rect x="156" y="226" width="200" height="164" rx="30" fill="#fff"/>
    <circle cx="256" cy="292" r="22" fill="${k}"/>
    <rect x="246" y="300" width="20" height="46" rx="8" fill="${k}"/>${badge(370, 370, 52, k, tick(370, 370, k))}`,
    solid: k => `
    <path d="M196 236 V184 A60 60 0 0 1 316 184 V236" fill="none" stroke="url(#wfu)" stroke-width="30" stroke-linecap="round"/>
    <rect x="156" y="226" width="200" height="164" rx="30" fill="url(#wf)"/>
    <rect x="174" y="238" width="164" height="14" rx="7" fill="#fff"/>
    <circle cx="256" cy="292" r="22" fill="${k}" opacity=".8"/>
    <rect x="246" y="300" width="20" height="46" rx="8" fill="${k}" opacity=".8"/>${badgeC(370, 370, 46, k, tick(370, 370, k, 16))}`,
    real: `
    ${groundShadow(256, 412, 130)}
    <g filter="url(#ds)">
      <path d="M196 240 V184 A60 60 0 0 1 316 184 V240" fill="none" stroke="url(#steelH)" stroke-width="30" stroke-linecap="round"/>
      <rect x="152" y="226" width="208" height="172" rx="32" fill="url(#lg-red)"/>
      <rect x="172" y="238" width="168" height="16" rx="8" fill="#fff" opacity=".35"/>
      <circle cx="256" cy="298" r="23" fill="#1F2937"/>
      <rect x="246" y="306" width="20" height="48" rx="8" fill="#1F2937"/></g>${checkD(372, 378, 44)}` },
  'maintenance-demand-rollup': { cn:'检修需求汇总上报', c:C.sky, flat:`
    <polygon points="212,128 316,180 212,232 108,180" fill="#fff" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>
    <polyline points="108,242 212,294 316,242" ${S}/>
    <polyline points="108,306 212,358 316,306" ${S} opacity=".7"/>
    <line x1="392" y1="384" x2="392" y2="150" ${S}/>
    <polyline points="352,190 392,150 432,190" ${S}/>`,
    solid: k => `
    ${tile(248, 'url(#wf2)', '#B9C7D8', '#A9B9CC')}${tile(188, 'url(#wf2)', '#C9D5E3', '#B9C7D8')}${tile(128, 'url(#wf)', '#D5DFEB', '#C5D2E0')}
    <polygon points="212,140 292,180 212,220 132,180" fill="${k}" opacity=".12"/>
    <rect x="378" y="176" width="30" height="208" rx="15" fill="url(#wf)"/>
    <polygon points="346,200 393,146 440,200" fill="url(#wf)" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>`,
    real: `
    ${groundShadow(232, 400, 170)}
    <g filter="url(#ds2)">${tile(250, 'url(#lg-amber)', '#B45309', '#92400E')}</g>
    <g filter="url(#ds2)">${tile(190, 'url(#lg-green)', '#15803D', '#166534')}</g>
    <g filter="url(#ds2)">${tile(130, 'url(#paper)', '#CBD5E1', '#94A3B8')}</g>
    <g filter="url(#ds)"><rect x="374" y="180" width="36" height="206" rx="12" fill="url(#lh-orange)"/>
      <polygon points="340,204 392,144 444,204" fill="url(#lg-orange)" stroke="#FB923C" stroke-width="10" stroke-linejoin="round"/></g>` },
  'maintenance-record-archive': { cn:'检修记录归档', c:C.teal, flat:`
    <rect x="112" y="128" width="288" height="84" rx="22" fill="#fff"/>
    <path d="M136 212 V356 Q136 388 168 388 H344 Q376 388 376 356 V212" ${S}/>
    <line x1="222" y1="276" x2="290" y2="276" ${W(28)}/>`,
    solid: k => `
    <rect x="136" y="200" width="240" height="188" rx="26" fill="url(#wf2)"/>
    <rect x="112" y="128" width="288" height="84" rx="22" fill="url(#wf)"/>
    <rect x="130" y="138" width="252" height="14" rx="7" fill="#fff"/>
    <rect x="136" y="212" width="240" height="14" fill="${k}" opacity=".18"/>
    <rect x="208" y="262" width="96" height="30" rx="15" fill="${k}" opacity=".55"/>`,
    real: `
    ${groundShadow(256, 406, 150)}
    <g filter="url(#ds)">
      <rect x="150" y="112" width="130" height="110" rx="10" fill="url(#lg-blue)" transform="rotate(-8 215 167)"/>
      <rect x="252" y="118" width="112" height="104" rx="10" fill="url(#paper)" transform="rotate(6 308 170)"/>
      <rect x="136" y="214" width="240" height="180" rx="22" fill="url(#lg-kraft)"/>
      <rect x="112" y="188" width="288" height="60" rx="18" fill="url(#lg-kraft)"/>
      <rect x="128" y="194" width="256" height="14" rx="7" fill="#fff" opacity=".4"/>
      <rect x="200" y="282" width="112" height="62" rx="12" fill="url(#paper)"/>
      <rect x="220" y="304" width="72" height="18" rx="9" fill="#94A3B8"/></g>` },
  'overhaul-process-check-bridge': { cn:'车间检修方案安全措施核查入口', c:C.blue, flat: k => `
    <rect x="112" y="100" width="200" height="268" rx="28" ${S}/>
    <line x1="158" y1="170" x2="266" y2="170" ${W(22)}/>
    <line x1="158" y1="226" x2="240" y2="226" ${W(22)}/>
    <line x1="158" y1="282" x2="214" y2="282" ${W(22)}/>
    <path d="M346 236 L424 262 V318 C424 366 392 398 346 416 C300 398 268 366 268 318 V262 Z" fill="#fff" stroke="${k}" stroke-width="14" stroke-linejoin="round"/>
    <polyline points="314,322 338,346 380,300" ${D(k,16)}/>`,
    solid: k => `${docC(112, 100, 200, 268, k, [.6, .46, .3])}
    <path d="M346 226 L432 255 V318 C432 370 396 404 346 424 C296 404 260 370 260 318 V255 Z" fill="${k}"/>
    <path d="M346 240 L420 265 V318 C420 362 390 392 346 410 C302 392 272 362 272 318 V265 Z" fill="url(#wf)"/>
    <path d="M346 240 V410 C302 392 272 362 272 318 V265 Z" fill="#fff"/>
    <polyline points="312,322 338,348 382,298" ${D(k,18)}/>`,
    real: `
    ${groundShadow(256, 412, 160)}
    <g filter="url(#ds)">
      <rect x="108" y="108" width="212" height="284" rx="22" fill="url(#lg-amber)"/>
      <rect x="126" y="140" width="176" height="234" rx="10" fill="url(#paper)"/>
      <rect x="170" y="94" width="88" height="42" rx="12" fill="url(#steelV)"/>
      <rect x="150" y="174" width="128" height="16" rx="8" fill="#CBD5E1"/>
      <rect x="150" y="212" width="100" height="16" rx="8" fill="#CBD5E1"/>
      <rect x="150" y="250" width="70" height="16" rx="8" fill="#CBD5E1"/></g>
    <g filter="url(#ds)">
      <path d="M346 232 L428 260 V318 C428 368 394 400 346 420 C298 400 264 368 264 318 V260 Z" fill="url(#lg-green)"/>
      <path d="M346 246 V406 C304 388 278 360 278 318 V270 Z" fill="#fff" opacity=".18"/>
      <polyline points="312,324 338,350 382,300" fill="none" stroke="#fff" stroke-width="20" stroke-linecap="round" stroke-linejoin="round"/></g>` },
  'permit-precheck-bridge': { cn:'车间作业票预检入口', c:C.fuchsia, flat: k => `
    <path d="M132 120 H364 Q392 120 392 148 V184 A26 26 0 0 0 392 236 V272 Q392 300 364 300 H132 Q104 300 104 272 V236 A26 26 0 0 0 104 184 V148 Q104 120 132 120 Z" ${S}/>
    <line x1="168" y1="150" x2="168" y2="270" stroke="#fff" stroke-width="10" stroke-dasharray="14 14" stroke-linecap="round" opacity=".75"/>
    <line x1="214" y1="176" x2="340" y2="176" ${W(22)}/>
    <line x1="214" y1="228" x2="290" y2="228" ${W(22)}/>${mag(340, 330, 54, k)}`,
    solid: k => `
    <path d="M132 120 H364 Q392 120 392 148 V184 A26 26 0 0 0 392 236 V272 Q392 300 364 300 H132 Q104 300 104 272 V236 A26 26 0 0 0 104 184 V148 Q104 120 132 120 Z" fill="url(#wf)"/>
    <rect x="124" y="132" width="248" height="14" rx="7" fill="#fff"/>
    <line x1="168" y1="156" x2="168" y2="270" stroke="${k}" stroke-width="10" stroke-dasharray="14 14" stroke-linecap="round" opacity=".4"/>
    <rect x="204" y="166" width="140" height="22" rx="11" fill="${k}" opacity=".5"/>
    <rect x="204" y="216" width="90" height="22" rx="11" fill="${k}" opacity=".3"/>${magC(340, 330, 54, k)}`,
    real: `
    ${groundShadow(250, 408, 160)}
    <g filter="url(#ds2)">
      <path d="M132 120 H364 Q392 120 392 148 V184 A26 26 0 0 0 392 236 V272 Q392 300 364 300 H132 Q104 300 104 272 V236 A26 26 0 0 0 104 184 V148 Q104 120 132 120 Z" fill="url(#lg-yellow)"/>
      <path d="M132 120 H174 V300 H132 Q104 300 104 272 V236 A26 26 0 0 0 104 184 V148 Q104 120 132 120 Z" fill="#F97316" opacity=".85"/>
      <line x1="174" y1="136" x2="174" y2="286" stroke="#fff" stroke-width="8" stroke-dasharray="12 12" stroke-linecap="round"/>
      <rect x="204" y="162" width="140" height="22" rx="11" fill="#A16207" opacity=".55"/>
      <rect x="204" y="210" width="90" height="22" rx="11" fill="#A16207" opacity=".35"/></g>${magD(340, 330, 54)}` },
  'repair-plan-assistant': { cn:'检修方案辅助编制', c:C.lime, flat: k => `
    <rect x="112" y="100" width="210" height="276" rx="28" ${S}/>
    <line x1="158" y1="170" x2="276" y2="170" ${W(22)}/>
    <line x1="158" y1="226" x2="250" y2="226" ${W(22)}/>
    <line x1="158" y1="282" x2="210" y2="282" ${W(22)}/>${wrench(336, 336, 45, k)}`,
    solid: k => `${docC(112, 100, 210, 276, k, [.6, .44, .24])}${wrenchC(336, 336, 45, k)}`,
    real: `
    ${groundShadow(250, 408, 160)}
    <g filter="url(#ds)">
      <rect x="108" y="100" width="218" height="282" rx="20" fill="url(#lg-blue)"/>
      ${[150, 200, 250, 300, 350].map(y => `<rect x="120" y="${y}" width="194" height="3" fill="#fff" opacity=".18"/>`).join('')}
      ${[160, 210, 260].map(x => `<rect x="${x}" y="112" width="3" height="258" fill="#fff" opacity=".18"/>`).join('')}
      <circle cx="186" cy="190" r="44" fill="none" stroke="#fff" stroke-width="10"/>
      <circle cx="186" cy="190" r="14" fill="#fff"/>
      <rect x="146" y="272" width="120" height="14" rx="7" fill="#fff" opacity=".9"/>
      <rect x="146" y="304" width="80" height="14" rx="7" fill="#fff" opacity=".7"/></g>${wrenchD(336, 336, 45, '#334155')}` },
  'repeat-failure-detector': { cn:'重复故障识别', c:C.red, flat:`
    ${arrowDef('ah-repeat')}
    <path d="M143 215 A120 120 0 0 1 348 179" ${S} marker-end="url(#ah-repeat)"/>
    <path d="M369 297 A120 120 0 0 1 164 333" ${S} marker-end="url(#ah-repeat)"/>
    <polygon points="272,166 204,270 248,270 236,350 308,244 262,244" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>`,
    solid: k => `
    <path d="M143 215 A120 120 0 0 1 348 179" fill="none" stroke="url(#wfu)" stroke-width="30" stroke-linecap="round"/>${head(348, 179, 50, '#F4F7FB')}
    <path d="M369 297 A120 120 0 0 1 164 333" fill="none" stroke="url(#wfu)" stroke-width="30" stroke-linecap="round"/>${head(164, 333, 230, '#DCE5F0')}
    <circle cx="256" cy="256" r="82" fill="url(#wf)"/>
    <polygon points="267,194 220,266 250,266 242,322 292,248 260,248" fill="${k}" stroke="${k}" stroke-width="8" stroke-linejoin="round"/>`,
    real: `
    ${groundShadow(256, 410, 130)}
    <g filter="url(#ds)">
      <path d="M143 215 A120 120 0 0 1 348 179" fill="none" stroke="url(#steelV)" stroke-width="30" stroke-linecap="round"/>${head(348, 179, 50, '#E5E7EB')}
      <path d="M369 297 A120 120 0 0 1 164 333" fill="none" stroke="url(#steelV)" stroke-width="30" stroke-linecap="round"/>${head(164, 333, 230, '#9CA3AF')}
      <polygon points="272,166 204,270 248,270 236,350 308,244 262,244" fill="url(#lg-yellow)" stroke="#FACC15" stroke-width="10" stroke-linejoin="round"/></g>` },
  'turnaround-workshop-tracker': { cn:'大检修车间侧跟踪', c:C.violet, flat: k => `
    <line x1="112" y1="116" x2="112" y2="396" ${W(20)} opacity=".6"/>
    <rect x="140" y="132" width="160" height="56" rx="18" fill="#fff"/>
    <polyline points="196,160 212,176 242,146" ${D(k,12)}/>
    <rect x="204" y="228" width="180" height="56" rx="18" fill="#fff" opacity=".85"/>
    <rect x="268" y="324" width="132" height="56" rx="18" fill="#fff" opacity=".55"/>`,
    solid: k => `
    <rect x="104" y="116" width="16" height="280" rx="8" fill="url(#wf2)"/>
    <rect x="140" y="132" width="160" height="56" rx="18" fill="url(#wf)"/>
    <polyline points="196,160 212,176 242,146" ${D(k,12)}/>
    <rect x="204" y="228" width="180" height="56" rx="18" fill="url(#wf)"/>
    <rect x="204" y="228" width="100" height="56" rx="18" fill="${k}" opacity=".3"/>
    <rect x="268" y="324" width="132" height="56" rx="18" fill="url(#wf2)" opacity=".75"/>`,
    real: `
    ${groundShadow(256, 414, 170)}
    <g filter="url(#ds)">
      <rect x="92" y="104" width="328" height="300" rx="24" fill="url(#paper)"/>
      <rect x="120" y="136" width="150" height="54" rx="16" fill="url(#lg-green)"/>
      <polyline points="174,163 190,179 218,149" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="180" y="224" width="200" height="54" rx="16" fill="#FED7AA"/>
      <rect x="180" y="224" width="120" height="54" rx="16" fill="url(#lg-orange)"/>
      <rect x="250" y="312" width="140" height="54" rx="16" fill="url(#lg-slate)" opacity=".55"/>
      <rect x="320" y="118" width="8" height="268" rx="4" fill="#DC2626"/></g>` },
  'work-order-generator': { cn:'维修通知单草稿生成', c:C.indigo, flat: k => `
    <rect x="112" y="100" width="220" height="290" rx="28" ${S}/>
    <line x1="158" y1="170" x2="286" y2="170" ${W(22)}/>
    <line x1="158" y1="226" x2="256" y2="226" ${W(22)}/>
    <line x1="158" y1="282" x2="214" y2="282" ${W(22)}/>${pencil(348, 300, 150, k)}`,
    solid: k => `${docC(112, 100, 220, 290, k)}${pencilC(348, 300, 150, k)}`,
    real: `
    ${groundShadow(236, 406, 150)}${docD(112, 96, 228, 298, '#EA580C')}${pencilD(348, 300, 150)}` },
  'work-order-tracker': { cn:'维修工单跟踪与催办', c:C.cyan, flat: k => `
    <rect x="112" y="100" width="220" height="290" rx="28" ${S}/>
    <line x1="158" y1="170" x2="286" y2="170" ${W(22)}/>
    <line x1="158" y1="226" x2="256" y2="226" ${W(22)}/>
    <line x1="158" y1="282" x2="214" y2="282" ${W(22)}/>${badge(352, 344, 66, k, `
    <line x1="352" y1="344" x2="352" y2="306" ${D(k,14)}/><line x1="352" y1="344" x2="380" y2="362" ${D(k,14)}/>`)}`,
    solid: k => `${docC(112, 100, 220, 290, k)}${badgeC(352, 344, 64, k, `
    <circle cx="352" cy="344" r="48" fill="#fff"/>
    <line x1="352" y1="344" x2="352" y2="308" ${D(k,14)}/><line x1="352" y1="344" x2="380" y2="362" ${D(k,14)}/>
    <circle cx="352" cy="344" r="9" fill="${k}"/>`)}`,
    real: `
    ${groundShadow(236, 404, 150)}${docD(112, 96, 228, 298)}
    <rect x="140" y="300" width="64" height="26" rx="13" fill="#22C55E"/>
    <rect x="214" y="300" width="50" height="26" rx="13" fill="#F59E0B"/>${clockD(352, 352)}` },
} };
