// 07-隐患事故与合规：每个技能的 flat（A 扁平）、solid（C 块面）、real（D 拟物）字形，可以是字符串或接收底色深端 k 的函数
const { W, S, D, badge, tick, mag, pencil, wrench, star, ray, arrowDef, C, badgeC, magC, pencilC, wrenchC, docC, groundShadow, checkD, warnD, magD, pencilD, wrenchD, clockD, docD } = require('./lib');

module.exports = { name: '07-隐患事故与合规', icons: {
  'failure-case-retrieval': { cn:'故障案例检索', c:C.blue, flat: k => `
    <rect x="160" y="104" width="232" height="168" rx="24" fill="#fff" opacity=".45"/>
    <rect x="112" y="148" width="232" height="168" rx="24" fill="#fff"/>
    <line x1="148" y1="196" x2="260" y2="196" ${D(k,16)}/>
    <line x1="148" y1="236" x2="300" y2="236" ${D(k,16)}/>
    <line x1="148" y1="276" x2="220" y2="276" ${D(k,16)}/>${mag(344, 344, 54, k)}`,
    solid: k => `
    <rect x="160" y="104" width="232" height="168" rx="24" fill="url(#wf2)"/>
    <rect x="176" y="114" width="200" height="10" rx="5" fill="#fff" opacity=".7"/>
    <rect x="112" y="148" width="232" height="168" rx="24" fill="url(#wf)"/>
    <rect x="112" y="148" width="232" height="48" rx="24" fill="${k}" opacity=".16"/>
    <rect x="144" y="162" width="104" height="20" rx="10" fill="${k}" opacity=".55"/>
    <rect x="144" y="222" width="152" height="20" rx="10" fill="${k}" opacity=".3"/>
    <rect x="144" y="266" width="84" height="20" rx="10" fill="${k}" opacity=".3"/>${magC(344, 344, 54, k)}`,
    real: `
    ${groundShadow(248, 410, 150)}
    <g filter="url(#ds2)">
      <path d="M164 118 Q164 100 182 100 H246 L266 118 H372 Q392 118 392 138 V268 Q392 288 372 288 H184 Q164 288 164 268 Z" fill="url(#lg-amber)"/>
    </g>${docD(112, 144, 230, 184, '#B91C1C', [.62, .74, .4])}${magD(344, 344, 54)}` },
  'failure-investigation-assistant': { cn:'故障调查辅助', c:C.purple, flat:`
    <line x1="104" y1="256" x2="352" y2="256" ${S}/>
    <path d="M352 196 L416 256 L352 316 Z" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>
    ${[168, 248, 328].map(x => `<line x1="${x}" y1="256" x2="${x-44}" y2="160" ${W(20)}/><line x1="${x}" y1="256" x2="${x-44}" y2="352" ${W(20)}/>`).join('\n    ')}`,
    solid: k => `
    ${[168, 248, 328].map(x => `<line x1="${x}" y1="256" x2="${x-44}" y2="160" stroke="url(#wfu)" stroke-width="24" stroke-linecap="round"/><line x1="${x}" y1="256" x2="${x-44}" y2="352" stroke="#D5DFEB" stroke-width="24" stroke-linecap="round"/>
    <circle cx="${x-44}" cy="160" r="16" fill="${k}" opacity=".45"/><circle cx="${x-44}" cy="352" r="16" fill="${k}" opacity=".45"/>`).join('\n    ')}
    <rect x="96" y="242" width="268" height="28" rx="14" fill="url(#wf)"/>
    <rect x="108" y="245" width="244" height="8" rx="4" fill="#fff"/>
    <polygon points="352,190 422,256 352,256" fill="#fff" stroke="#fff" stroke-width="14" stroke-linejoin="round"/>
    <polygon points="352,256 422,256 352,322" fill="#D5DFEB" stroke="#D5DFEB" stroke-width="14" stroke-linejoin="round"/>`,
    real: `
    ${groundShadow(256, 404, 160)}
    <g filter="url(#ds)"><rect x="92" y="116" width="328" height="270" rx="26" fill="url(#paper)"/></g>
    ${[176, 248, 320].map(x => `<line x1="${x}" y1="250" x2="${x-38}" y2="168" stroke="#6366F1" stroke-width="20" stroke-linecap="round"/><line x1="${x}" y1="250" x2="${x-38}" y2="332" stroke="#6366F1" stroke-width="20" stroke-linecap="round"/>
    <circle cx="${x-38}" cy="168" r="22" fill="url(#rg-amber)"/><circle cx="${x-38}" cy="332" r="22" fill="url(#rg-amber)"/>`).join('\n    ')}
    <rect x="120" y="236" width="230" height="28" rx="14" fill="#334155"/>
    <path d="M342 204 L398 250 L342 296 Z" fill="url(#lg-red)" stroke="#DC2626" stroke-width="10" stroke-linejoin="round"/>` },
  'hazard-closure-tracker': { cn:'隐患整改闭环跟踪', c:C.orange, flat:`
    ${arrowDef('ah-hazard')}
    <path d="M351 176 A124 124 0 1 1 234 134" ${S} marker-end="url(#ah-hazard)"/>
    <polyline points="196,262 240,306 320,214" ${W(30)}/>`,
    solid: k => `
    <path d="M351 176 A124 124 0 1 1 234 134" fill="none" stroke="url(#wfu)" stroke-width="34" stroke-linecap="round"/>
    <polygon points="270,128 228,170 220,100" fill="#fff" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>
    <circle cx="256" cy="256" r="86" fill="url(#wf)"/>
    <path d="M198 228 A64 64 0 0 1 250 194" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>
    <polyline points="210,260 244,294 304,226" ${D(k,28)}/>`,
    real: `
    ${groundShadow(256, 410, 140)}
    <g filter="url(#ds2)">
      <path d="M357 168 A132 132 0 1 1 232 126" fill="none" stroke="#2563EB" stroke-width="30" stroke-linecap="round"/>
      <path d="M357 168 A132 132 0 1 1 232 126" fill="none" stroke="#93C5FD" stroke-width="8" stroke-linecap="round" opacity=".85"/>
      <polygon points="276,120 226,164 218,90" fill="#2563EB" stroke="#2563EB" stroke-width="12" stroke-linejoin="round"/>
    </g>${warnD(248, 262, 64)}${checkD(320, 322, 36)}` },
  'regulation-compliance-check': { cn:'法规制度符合性自查', c:C.slate, flat:`
    <line x1="256" y1="128" x2="256" y2="388" ${S}/>
    <line x1="180" y1="396" x2="332" y2="396" ${S}/>
    <line x1="132" y1="168" x2="380" y2="168" ${S}/>
    <circle cx="256" cy="124" r="20" fill="#fff"/>
    <polyline points="104,284 132,168 160,284" ${W(12)}/>
    <path d="M92 280 H172 A40 40 0 0 1 92 280 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>
    <polyline points="352,284 380,168 408,284" ${W(12)}/>
    <path d="M340 280 H420 A40 40 0 0 1 340 280 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>`,
    solid: k => `
    <polyline points="100,280 132,170 164,280" fill="none" stroke="${k}" stroke-width="10" stroke-linejoin="round"/>
    <polyline points="348,280 380,170 412,280" fill="none" stroke="${k}" stroke-width="10" stroke-linejoin="round"/>
    <rect x="242" y="128" width="28" height="262" rx="12" fill="url(#wf2)"/>
    <rect x="176" y="382" width="160" height="30" rx="15" fill="url(#wf)"/>
    <rect x="120" y="154" width="272" height="28" rx="14" fill="url(#wf)"/>
    <rect x="132" y="157" width="248" height="8" rx="4" fill="#fff"/>
    <circle cx="256" cy="128" r="24" fill="url(#wf)"/>
    <path d="M86 278 H178 A46 46 0 0 1 86 278 Z" fill="url(#wf2)"/>
    <rect x="84" y="272" width="96" height="14" rx="7" fill="#fff"/>
    <path d="M334 278 H426 A46 46 0 0 1 334 278 Z" fill="url(#wf2)"/>
    <rect x="332" y="272" width="96" height="14" rx="7" fill="#fff"/>`,
    real: `
    ${groundShadow(256, 410, 110)}
    <g filter="url(#ds)">
      <polyline points="100,280 132,174 164,280" fill="none" stroke="#92400E" stroke-width="6" stroke-linejoin="round"/>
      <polyline points="348,280 380,174 412,280" fill="none" stroke="#92400E" stroke-width="6" stroke-linejoin="round"/>
      <rect x="240" y="132" width="32" height="258" rx="12" fill="url(#lh-amber)"/>
      <path d="M196 384 H316 L336 412 H176 Z" fill="url(#lg-amber)" stroke="#F59E0B" stroke-width="8" stroke-linejoin="round"/>
      <rect x="116" y="158" width="280" height="26" rx="13" fill="url(#lg-amber)"/>
      <circle cx="256" cy="130" r="26" fill="url(#rg-amber)"/>
      <path d="M84 278 H180 A48 48 0 0 1 84 278 Z" fill="url(#lg-amber)"/>
      <ellipse cx="132" cy="278" rx="48" ry="9" fill="#FDE68A"/>
      <path d="M332 278 H428 A48 48 0 0 1 332 278 Z" fill="url(#lg-amber)"/>
      <ellipse cx="380" cy="278" rx="48" ry="9" fill="#FDE68A"/>
    </g>` },
  'safety-environmental-device-check': { cn:'安全环保设施状态检查', c:C.green, flat: k => `
    <path d="M256 104 L392 152 V256 C392 336 334 386 256 412 C178 386 120 336 120 256 V152 Z" ${S}/>
    <path d="M256 330 C196 296 192 228 256 176 C320 228 316 296 256 330 Z" fill="#fff"/>
    <line x1="256" y1="214" x2="256" y2="316" ${D(k,12)}/>
    <line x1="256" y1="330" x2="256" y2="360" ${W(14)}/>`,
    solid: k => `
    <path d="M256 104 L392 152 V256 C392 336 334 386 256 412 C178 386 120 336 120 256 V152 Z" fill="url(#wf)"/>
    <path d="M256 104 L392 152 V256 C392 336 334 386 256 412 Z" fill="url(#wf2)" opacity=".85"/>
    <path d="M150 170 L256 132 L362 170" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M256 336 C190 300 186 226 256 170 C326 226 322 300 256 336 Z" fill="${k}" opacity=".85"/>
    <path d="M256 210 V350" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>`,
    real: `
    ${groundShadow(256, 414, 120)}
    <g filter="url(#ds)">
      <path d="M256 96 L400 146 V256 C400 342 338 394 256 420 C174 394 112 342 112 256 V146 Z" fill="url(#steelR)"/>
      <path d="M256 120 L378 162 V258 C378 330 326 374 256 396 C186 374 134 330 134 258 V162 Z" fill="url(#lg-blue)"/>
      <path d="M256 120 L378 162 V258 C378 330 326 374 256 396 Z" fill="#1E3A8A" opacity=".25"/>
    </g>
    <g filter="url(#ds2)">
      <path d="M256 340 C192 304 188 230 256 174 C324 230 320 304 256 340 Z" fill="url(#rg-green)"/>
      <path d="M256 214 V352" fill="none" stroke="#DCFCE7" stroke-width="10" stroke-linecap="round"/>
    </g>` },
} };
