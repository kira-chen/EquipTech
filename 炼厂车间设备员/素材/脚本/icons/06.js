// 06-报表与沟通：每个技能的 flat（A 扁平）、solid（C 块面）、real（D 拟物）字形，可以是字符串或接收底色深端 k 的函数
const { W, S, D, badge, tick, mag, pencil, wrench, star, ray, arrowDef, C, badgeC, magC, pencilC, wrenchC, docC, groundShadow, checkD, warnD, magD, pencilD, wrenchD, clockD, docD } = require('./lib');

module.exports = { name: '06-报表与沟通', icons: {
  'equipment-daily-report': { cn:'车间设备日报', c:C.amber, flat:`
    <rect x="124" y="100" width="264" height="312" rx="32" ${S}/>
    <circle cx="256" cy="204" r="38" fill="#fff"/>
    ${[0,45,90,135,180,225,270,315].map(a => ray(256, 204, a, 56, 74, W(16))).join('')}
    <line x1="176" y1="318" x2="336" y2="318" ${W(22)}/>
    <line x1="176" y1="364" x2="292" y2="364" ${W(22)}/>`,
    solid: k => `
    <rect x="124" y="100" width="264" height="312" rx="32" fill="url(#wf)"/>
    <path d="M124 272 V132 Q124 100 156 100 H356 Q388 100 388 132 V272 Z" fill="${k}" opacity=".14"/>
    <rect x="148" y="110" width="216" height="8" rx="4" fill="#fff"/>
    ${[0,45,90,135,180,225,270,315].map(a => ray(256, 190, a, 56, 74, `stroke="${k}" stroke-width="16" stroke-linecap="round" opacity=".45"`)).join('')}
    <circle cx="256" cy="190" r="40" fill="${k}" opacity=".55"/>
    <rect x="172" y="308" width="168" height="20" rx="10" fill="${k}" opacity=".3"/>
    <rect x="172" y="352" width="116" height="20" rx="10" fill="${k}" opacity=".3"/>`,
    real: `
    ${groundShadow(256, 412, 140)}
    <g filter="url(#ds)">
      <rect x="128" y="96" width="256" height="318" rx="28" fill="#334155"/>
      <rect x="140" y="102" width="232" height="10" rx="5" fill="#fff" opacity=".15"/>
      <rect x="150" y="126" width="212" height="266" rx="12" fill="url(#paper)"/>
      ${[0,45,90,135,180,225,270,315].map(a => ray(256, 214, a, 52, 72, 'stroke="#F59E0B" stroke-width="14" stroke-linecap="round"')).join('')}
      <circle cx="256" cy="214" r="38" fill="url(#rg-amber)"/>
      <rect x="182" y="304" width="148" height="18" rx="9" fill="#CBD5E1"/>
      <rect x="182" y="342" width="104" height="18" rx="9" fill="#CBD5E1"/>
      <rect x="206" y="80" width="100" height="46" rx="14" fill="url(#steelV)"/>
      <rect x="236" y="92" width="40" height="12" rx="6" fill="#4B5563"/>
    </g>` },
  'equipment-event-notice': { cn:'设备事件通报起草', c:C.rose, flat:`
    <path d="M168 296 L188 380 H226 L212 296" ${W(20)}/>
    <path d="M120 216 H176 L320 136 V376 L176 296 H120 Q104 296 104 280 V232 Q104 216 120 216 Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>
    <path d="M360 212 Q388 256 360 300" ${W(22)}/>
    <path d="M392 176 Q440 256 392 336" ${W(22)} opacity=".7"/>`,
    solid: k => `
    <path d="M172 296 L190 378 H226 L212 296 Z" fill="url(#wf2)" stroke="url(#wf2)" stroke-width="12" stroke-linejoin="round"/>
    <rect x="104" y="214" width="80" height="84" rx="16" fill="url(#wf2)"/>
    <path d="M176 216 L320 136 V376 L176 296 Z" fill="url(#wf)"/>
    <polygon points="236,183 262,168 262,344 236,329" fill="${k}" opacity=".3"/>
    <path d="M192 216 L304 154" fill="none" stroke="#fff" stroke-width="8" stroke-linecap="round"/>
    <ellipse cx="320" cy="256" rx="24" ry="120" fill="url(#wf2)"/>
    <ellipse cx="323" cy="256" rx="12" ry="96" fill="${k}" opacity=".4"/>
    <path d="M362 212 Q390 256 362 300" fill="none" stroke="url(#wfu)" stroke-width="22" stroke-linecap="round"/>
    <path d="M394 176 Q442 256 394 336" fill="none" stroke="url(#wfu)" stroke-width="22" stroke-linecap="round" opacity=".7"/>`,
    real: `
    ${groundShadow(250, 404, 150)}
    <g filter="url(#ds)">
      <path d="M172 292 L190 380 H228 L214 292 Z" fill="url(#lh-slate)" stroke="url(#lh-slate)" stroke-width="10" stroke-linejoin="round"/>
      <rect x="100" y="212" width="86" height="88" rx="18" fill="url(#lg-red)"/>
      <path d="M180 216 L318 138 V374 L180 296 Z" fill="url(#paper)"/>
      <polygon points="236,184 264,168 264,344 236,328" fill="url(#lg-red)"/>
      <ellipse cx="318" cy="256" rx="28" ry="120" fill="url(#lg-red)"/>
      <ellipse cx="323" cy="256" rx="15" ry="98" fill="#1F2937"/>
    </g>
    <path d="M370 212 Q398 256 370 300" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round"/>
    <path d="M402 176 Q448 256 402 336" fill="none" stroke="#fff" stroke-width="18" stroke-linecap="round" opacity=".7"/>` },
  'equipment-weekly-monthly-report': { cn:'设备周报月报', c:C.indigo, flat:`
    <rect x="112" y="132" width="288" height="264" rx="32" ${S}/>
    <line x1="112" y1="208" x2="400" y2="208" ${W(22)}/>
    <line x1="184" y1="104" x2="184" y2="156" ${S}/>
    <line x1="328" y1="104" x2="328" y2="156" ${S}/>
    ${[234, 284, 334].map((y, r) => [150, 208, 266, 324].map(x => `<rect x="${x}" y="${y}" width="36" height="34" rx="8" fill="#fff"${r === 1 ? '' : ' opacity=".45"'}/>`).join('')).join('\n    ')}`,
    solid: k => `
    <rect x="112" y="132" width="288" height="264" rx="32" fill="url(#wf)"/>
    <path d="M112 212 V164 Q112 132 144 132 H368 Q400 132 400 164 V212 Z" fill="${k}" opacity=".4"/>
    <rect x="136" y="142" width="240" height="8" rx="4" fill="#fff" opacity=".5"/>
    <rect x="170" y="100" width="28" height="64" rx="14" fill="url(#wf2)"/>
    <rect x="314" y="100" width="28" height="64" rx="14" fill="url(#wf2)"/>
    ${[236, 286, 336].map((y, r) => [148, 208, 268, 328].map(x => `<rect x="${x}" y="${y}" width="36" height="34" rx="8" fill="${k}" opacity="${r === 1 ? '.6' : '.2'}"/>`).join('')).join('\n    ')}`,
    real: `
    ${groundShadow(256, 412, 150)}
    <g filter="url(#ds)">
      <rect x="112" y="132" width="288" height="270" rx="28" fill="url(#paper)"/>
      <path d="M112 212 V160 Q112 132 140 132 H372 Q400 132 400 160 V212 Z" fill="url(#lg-red)"/>
      <rect x="138" y="276" width="236" height="50" rx="14" fill="#DBEAFE"/>
      ${[238, 288, 338].map((y, r) => [148, 208, 268, 328].map(x => `<rect x="${x}" y="${y}" width="36" height="34" rx="8" fill="${r === 1 ? 'url(#lg-blue)' : '#E2E8F0'}"/>`).join('')).join('\n      ')}
      <rect x="168" y="102" width="30" height="66" rx="15" fill="url(#steelH)"/>
      <rect x="314" y="102" width="30" height="66" rx="15" fill="url(#steelH)"/>
    </g>` },
  'inspection-evidence-package': { cn:'迎检资料准备', c:C.teal, flat:`
    <path d="M108 168 Q108 140 136 140 H216 L248 172 H376 Q404 172 404 200 V364 Q404 392 376 392 H136 Q108 392 108 364 Z" ${S}/>
    <line x1="108" y1="216" x2="404" y2="216" ${W(18)} opacity=".6"/>
    <polyline points="196,294 236,334 316,254" ${W(30)}/>`,
    solid: k => `
    <path d="M108 168 Q108 140 136 140 H216 L248 172 H376 Q404 172 404 200 V364 Q404 392 376 392 H136 Q108 392 108 364 Z" fill="url(#wf2)"/>
    <rect x="140" y="184" width="232" height="80" rx="10" fill="#fff"/>
    <path d="M108 230 Q108 214 124 214 H388 Q404 214 404 230 V364 Q404 392 376 392 H136 Q108 392 108 364 Z" fill="url(#wf)"/>
    <rect x="128" y="224" width="256" height="8" rx="4" fill="#fff"/>
    <polyline points="196,300 236,340 316,260" ${D(k,30)} opacity=".7"/>`,
    real: `
    ${groundShadow(256, 408, 160)}
    <g filter="url(#ds)">
      <path d="M108 164 Q108 136 136 136 H214 L246 168 H376 Q404 168 404 196 V364 Q404 392 376 392 H136 Q108 392 108 364 Z" fill="#B7791F"/>
      <rect x="138" y="166" width="226" height="120" rx="8" fill="#fff" transform="rotate(-4 251 226)"/>
      <rect x="150" y="180" width="226" height="120" rx="8" fill="#E2E8F0" transform="rotate(3 263 240)"/>
      <path d="M100 232 Q100 216 116 216 H396 Q412 216 412 232 L404 364 Q402 392 376 392 H136 Q110 392 108 364 Z" fill="url(#lg-amber)"/>
      <rect x="118" y="226" width="276" height="8" rx="4" fill="#fff" opacity=".45"/>
    </g>${checkD(370, 360, 48)}` },
  'meeting-material-builder': { cn:'设备会议汇报稿', c:C.sky, flat:`
    <rect x="104" y="112" width="304" height="208" rx="24" ${S}/>
    <line x1="256" y1="320" x2="256" y2="364" ${S}/>
    <line x1="256" y1="352" x2="196" y2="410" ${S}/>
    <line x1="256" y1="352" x2="316" y2="410" ${S}/>
    <rect x="178" y="236" width="36" height="50" rx="8" fill="#fff" opacity=".7"/>
    <rect x="238" y="200" width="36" height="86" rx="8" fill="#fff" opacity=".85"/>
    <rect x="298" y="164" width="36" height="122" rx="8" fill="#fff"/>`,
    solid: k => `
    <line x1="256" y1="320" x2="256" y2="364" stroke="url(#wfu)" stroke-width="26" stroke-linecap="round"/>
    <line x1="256" y1="352" x2="196" y2="410" stroke="url(#wfu)" stroke-width="26" stroke-linecap="round"/>
    <line x1="256" y1="352" x2="316" y2="410" stroke="url(#wfu)" stroke-width="26" stroke-linecap="round"/>
    <rect x="104" y="112" width="304" height="208" rx="24" fill="url(#wf)"/>
    <rect x="124" y="120" width="264" height="8" rx="4" fill="#fff"/>
    <rect x="178" y="236" width="36" height="50" rx="8" fill="${k}" opacity=".3"/>
    <rect x="238" y="200" width="36" height="86" rx="8" fill="${k}" opacity=".45"/>
    <rect x="298" y="164" width="36" height="122" rx="8" fill="${k}" opacity=".65"/>
    <rect x="156" y="292" width="200" height="8" rx="4" fill="${k}" opacity=".25"/>`,
    real: `
    ${groundShadow(256, 430, 140, 12)}
    <g filter="url(#ds2)">
      <rect x="244" y="330" width="24" height="112" rx="10" fill="url(#lh-amber)" transform="rotate(30 256 340)"/>
      <rect x="244" y="330" width="24" height="112" rx="10" fill="url(#lh-amber)" transform="rotate(-30 256 340)"/>
      <rect x="244" y="300" width="24" height="100" rx="8" fill="url(#lh-amber)"/>
    </g>
    <g filter="url(#ds)">
      <rect x="96" y="104" width="320" height="220" rx="20" fill="url(#steelV)"/>
      <rect x="110" y="118" width="292" height="192" rx="10" fill="url(#paper)"/>
      <rect x="168" y="236" width="44" height="56" rx="8" fill="url(#lg-green)"/>
      <rect x="234" y="196" width="44" height="96" rx="8" fill="url(#lg-amber)"/>
      <rect x="300" y="154" width="44" height="138" rx="8" fill="url(#lg-blue)"/>
      <rect x="150" y="290" width="212" height="6" rx="3" fill="#94A3B8"/>
    </g>` },
  'self-audit-form-filler': { cn:'自查表预填', c:C.violet, flat: k => `
    <rect x="108" y="100" width="224" height="300" rx="28" ${S}/>
    <rect x="146" y="142" width="36" height="36" rx="8" fill="#fff"/><polyline points="154,160 162,168 176,152" ${D(k,8)}/>
    <line x1="208" y1="160" x2="290" y2="160" ${W(20)}/>
    <rect x="146" y="218" width="36" height="36" rx="8" fill="#fff"/><polyline points="154,236 162,244 176,228" ${D(k,8)}/>
    <line x1="208" y1="236" x2="280" y2="236" ${W(20)}/>
    <rect x="148" y="296" width="32" height="32" rx="8" ${W(10)} opacity=".7"/>
    <line x1="208" y1="312" x2="254" y2="312" ${W(20)} opacity=".7"/>${pencil(352, 300, 150, k)}`,
    solid: k => `
    <rect x="108" y="100" width="224" height="300" rx="28" fill="url(#wf)"/>
    <rect x="128" y="108" width="184" height="8" rx="4" fill="#fff"/>
    ${[140, 216].map(y => `<rect x="144" y="${y}" width="40" height="40" rx="10" fill="${k}" opacity=".6"/><polyline points="153,${y+20} 162,${y+29} 176,${y+11}" ${W(8)}/>`).join('')}
    <rect x="144" y="292" width="40" height="40" rx="10" fill="${k}" opacity=".2"/>
    <rect x="204" y="150" width="88" height="20" rx="10" fill="${k}" opacity=".3"/>
    <rect x="204" y="226" width="76" height="20" rx="10" fill="${k}" opacity=".3"/>
    <rect x="204" y="302" width="50" height="20" rx="10" fill="${k}" opacity=".2"/>${pencilC(352, 300, 150, k)}`,
    real: `
    ${groundShadow(232, 412, 140)}
    <g filter="url(#ds)">
      <rect x="108" y="96" width="232" height="306" rx="22" fill="url(#paper)"/>
      <path d="M108 136 V118 Q108 96 130 96 H318 Q340 96 340 118 V136 Z" fill="#0F766E"/>
      <rect x="132" y="110" width="90" height="12" rx="6" fill="#fff" opacity=".85"/>
      ${[164, 236].map(y => `<rect x="134" y="${y}" width="44" height="44" rx="10" fill="url(#rg-green)"/><polyline points="145,${y+22} 154,${y+31} 168,${y+13}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
      <rect x="136" y="310" width="40" height="40" rx="10" fill="#F1F5F9" stroke="#CBD5E1" stroke-width="4"/>
      <rect x="196" y="178" width="104" height="16" rx="8" fill="#CBD5E1"/>
      <rect x="196" y="250" width="88" height="16" rx="8" fill="#CBD5E1"/>
      <rect x="196" y="322" width="60" height="16" rx="8" fill="#E2E8F0"/>
    </g>${pencilD(352, 300, 150)}` },
  'shift-handover-record': { cn:'设备员工作交接记录', c:C.emerald, flat: k => `
    <line x1="120" y1="140" x2="372" y2="140" ${S}/>
    <polyline points="332,100 372,140 332,180" ${S}/>
    <line x1="392" y1="372" x2="140" y2="372" ${S}/>
    <polyline points="180,332 140,372 180,412" ${S}/>
    <rect x="200" y="196" width="112" height="120" rx="18" fill="#fff"/>
    <line x1="226" y1="232" x2="286" y2="232" ${D(k,12)}/>
    <line x1="226" y1="258" x2="286" y2="258" ${D(k,12)}/>
    <line x1="226" y1="284" x2="264" y2="284" ${D(k,12)}/>`,
    solid: k => `
    <rect x="116" y="124" width="236" height="32" rx="16" fill="url(#wf)"/>
    <polygon points="334,96 384,140 334,184" fill="#fff" stroke="#fff" stroke-width="14" stroke-linejoin="round"/>
    <rect x="160" y="356" width="236" height="32" rx="16" fill="url(#wf2)"/>
    <polygon points="178,328 128,372 178,416" fill="url(#wf2)" stroke="url(#wf2)" stroke-width="14" stroke-linejoin="round"/>
    <rect x="196" y="192" width="120" height="128" rx="18" fill="#fff"/>
    <rect x="222" y="228" width="68" height="14" rx="7" fill="${k}" opacity=".45"/>
    <rect x="222" y="254" width="68" height="14" rx="7" fill="${k}" opacity=".3"/>
    <rect x="222" y="280" width="44" height="14" rx="7" fill="${k}" opacity=".3"/>`,
    real: `
    ${groundShadow(256, 414, 150)}
    <g filter="url(#ds2)">
      <rect x="112" y="122" width="236" height="36" rx="18" fill="url(#lg-orange)"/>
      <polygon points="330,92 388,140 330,188" fill="url(#lg-orange)" stroke="url(#lg-orange)" stroke-width="12" stroke-linejoin="round"/>
      <rect x="164" y="354" width="236" height="36" rx="18" fill="url(#lg-blue)"/>
      <polygon points="182,324 124,372 182,420" fill="url(#lg-blue)" stroke="url(#lg-blue)" stroke-width="12" stroke-linejoin="round"/>
    </g>${docD(178, 170, 156, 174, '#1E3A8A', [.62, .46])}` },
} };
