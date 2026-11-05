// 08-知识与能力支持：每个技能的 flat（A 扁平）、solid（C 块面）、real（D 拟物）字形，可以是字符串或接收底色深端 k 的函数
const { W, S, D, badge, tick, mag, pencil, wrench, star, ray, arrowDef, C, badgeC, magC, pencilC, wrenchC, docC, groundShadow, checkD, warnD, magD, pencilD, wrenchD, clockD, docD } = require('./lib');

module.exports = { name: '08-知识与能力支持', icons: {
  'equipment-energy-analysis': { cn:'设备能效分析', c:C.yellow, flat:`
    <path d="M112 324 A144 144 0 0 1 400 324" ${S}/>
    ${[210, 240, 300, 330].map(a => ray(256, 324, a, 100, 116, W(16))).join('')}
    <polygon points="274,196 214,296 252,296 238,372 300,266 262,266" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>`,
    solid: k => `
    <path d="M100 324 A156 156 0 0 1 412 324 H358 A102 102 0 0 0 154 324 Z" fill="url(#wf)"/>
    <path d="M256 168 A156 156 0 0 1 412 324 H358 A102 102 0 0 0 256 222 Z" fill="url(#wf2)"/>
    ${[210, 240, 300, 330].map(a => ray(256, 324, a, 116, 142, D(k, 10))).join('')}
    <rect x="96" y="318" width="320" height="24" rx="12" fill="url(#wf2)"/>
    <polygon points="276,206 214,306 252,306 238,384 304,276 264,276" fill="#fff" stroke="#fff" stroke-width="20" stroke-linejoin="round"/>
    <polygon points="276,206 214,306 252,306 238,384 304,276 264,276" fill="${k}" stroke="${k}" stroke-width="4" stroke-linejoin="round"/>`,
    real: `
    ${groundShadow(256, 396, 170, 14)}
    <g filter="url(#ds)">
      <path d="M96 330 A160 160 0 0 1 416 330 Z" fill="url(#lg-slate)"/>
      <path d="M96 330 A160 160 0 0 1 416 330" fill="none" stroke="url(#steelV)" stroke-width="16"/>
      <path d="M134 330 A122 122 0 0 1 195 224" fill="none" stroke="#22C55E" stroke-width="24"/>
      <path d="M195 224 A122 122 0 0 1 317 224" fill="none" stroke="#FACC15" stroke-width="24"/>
      <path d="M317 224 A122 122 0 0 1 378 330" fill="none" stroke="#EF4444" stroke-width="24"/>
      <rect x="84" y="322" width="344" height="34" rx="14" fill="url(#steelV)"/>
    </g>
    <g filter="url(#ds2)">
      <polygon points="272,214 218,300 252,300 238,370 300,276 264,276" fill="url(#lg-yellow)" stroke="#FEF08A" stroke-width="8" stroke-linejoin="round"/>
    </g>` },
  'equipment-knowledge-qa': { cn:'设备专业知识问答', c:C.blue, flat:`
    <path d="M152 112 H360 Q408 112 408 160 V296 Q408 344 360 344 H236 L164 404 V344 H152 Q104 344 104 296 V160 Q104 112 152 112 Z" ${S}/>
    <path d="M214 196 A42 42 0 1 1 288 223 Q256 240 256 266" ${W(28)}/>
    <circle cx="256" cy="306" r="16" fill="#fff"/>`,
    solid: k => `
    <path d="M152 112 H360 Q408 112 408 160 V296 Q408 344 360 344 H236 L164 404 V344 H152 Q104 344 104 296 V160 Q104 112 152 112 Z" fill="url(#wf)"/>
    <rect x="144" y="126" width="224" height="10" rx="5" fill="#fff"/>
    <path d="M256 112 H360 Q408 112 408 160 V296 Q408 344 360 344 H256 Z" fill="${k}" opacity=".06"/>
    <path d="M214 196 A42 42 0 1 1 288 223 Q256 240 256 266" ${D(k, 30)}/>
    <circle cx="256" cy="306" r="18" fill="${k}"/>`,
    real: `
    ${groundShadow(250, 412, 150)}
    <g filter="url(#ds2)">
      <path d="M236 104 H380 Q420 104 420 144 V214 Q420 254 380 254 H372 L392 292 L332 254 H236 Q196 254 196 214 V144 Q196 104 236 104 Z" fill="url(#paper)"/>
      <rect x="236" y="136" width="144" height="16" rx="8" fill="#CBD5E1"/>
      <rect x="236" y="168" width="100" height="16" rx="8" fill="#CBD5E1"/>
    </g>
    <g filter="url(#ds)">
      <path d="M132 196 H282 Q322 196 322 236 V326 Q322 366 282 366 H176 L124 404 L136 366 H132 Q92 366 92 326 V236 Q92 196 132 196 Z" fill="url(#rg-orange)"/>
      <path d="M178 258 A30 30 0 1 1 231 277 Q208 290 208 306" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="208" cy="336" r="13" fill="#fff"/>
    </g>` },
  'operator-anomaly-guide': { cn:'操作工异常识别指引卡', c:C.orange, flat: k => `
    <line x1="256" y1="112" x2="256" y2="400" ${S}/>
    <line x1="196" y1="404" x2="316" y2="404" ${S}/>
    <path d="M140 140 H340 L380 180 L340 220 H140 Q124 220 124 204 V156 Q124 140 140 140 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>
    <line x1="176" y1="164" x2="176" y2="184" ${D(k,14)}/>
    <circle cx="176" cy="202" r="7" fill="${k}"/>
    <line x1="212" y1="180" x2="320" y2="180" ${D(k,14)}/>
    <path d="M372 248 H172 L132 288 L172 328 H372 Q388 328 388 312 V264 Q388 248 372 248 Z" fill="${k}" stroke="#fff" stroke-width="26" stroke-linejoin="round"/>`,
    solid: k => `
    <rect x="242" y="112" width="28" height="292" rx="12" fill="url(#wf2)"/>
    <rect x="186" y="390" width="140" height="26" rx="13" fill="url(#wf)"/>
    <path d="M140 136 H340 L384 180 L340 224 H140 Q120 224 120 204 V156 Q120 136 140 136 Z" fill="url(#wf)"/>
    <rect x="136" y="146" width="196" height="8" rx="4" fill="#fff"/>
    <rect x="168" y="158" width="16" height="32" rx="8" fill="${k}"/>
    <circle cx="176" cy="206" r="9" fill="${k}"/>
    <rect x="206" y="172" width="118" height="18" rx="9" fill="${k}" opacity=".45"/>
    <path d="M372 252 H172 L128 296 L172 340 H372 Q392 340 392 320 V272 Q392 252 372 252 Z" fill="url(#wf2)"/>
    <rect x="186" y="287" width="160" height="18" rx="9" fill="${k}" opacity=".3"/>`,
    real: `
    ${groundShadow(256, 418, 110)}
    <g filter="url(#ds)">
      <rect x="240" y="112" width="32" height="292" rx="12" fill="url(#steelH)"/>
      <path d="M190 394 H322 Q334 394 334 406 V420 H178 V406 Q178 394 190 394 Z" fill="url(#lg-slate)"/>
      <path d="M140 132 H340 L386 178 L340 224 H140 Q118 224 118 202 V154 Q118 132 140 132 Z" fill="url(#lg-blue)"/>
      <rect x="164" y="152" width="18" height="34" rx="9" fill="#fff"/>
      <circle cx="173" cy="203" r="10" fill="#fff"/>
      <rect x="204" y="168" width="120" height="18" rx="9" fill="#fff" opacity=".85"/>
      <path d="M372 252 H172 L126 298 L172 344 H372 Q394 344 394 322 V274 Q394 252 372 252 Z" fill="url(#paper)"/>
      <rect x="182" y="289" width="110" height="18" rx="9" fill="#CBD5E1"/>
      <circle cx="340" cy="298" r="20" fill="url(#rg-green)"/>
      <polyline points="330,298 337,306 351,290" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
    </g>` },
  'training-material-generator': { cn:'培训材料与考题生成', c:C.violet, flat:`
    <path d="M168 250 V318 C168 362 344 362 344 318 V250" ${S}/>
    <polygon points="256,138 412,206 256,274 100,206" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>
    <line x1="380" y1="220" x2="380" y2="316" ${W(14)}/>
    <circle cx="380" cy="328" r="16" fill="#fff"/>`,
    solid: k => `
    <path d="M168 240 V318 C168 362 344 362 344 318 V240 Z" fill="url(#wf2)"/>
    <polygon points="256,138 256,274 100,206" fill="#fff" stroke="#fff" stroke-width="14" stroke-linejoin="round"/>
    <polygon points="256,138 412,206 256,274" fill="url(#wf2)" stroke="#E5ECF4" stroke-width="14" stroke-linejoin="round"/>
    <circle cx="256" cy="206" r="14" fill="${k}" opacity=".55"/>
    <path d="M256 206 L380 222" fill="none" stroke="${k}" stroke-width="8" stroke-linecap="round" opacity=".55"/>
    <rect x="373" y="220" width="14" height="92" rx="7" fill="${k}" opacity=".55"/>
    <circle cx="380" cy="326" r="20" fill="${k}" opacity=".7"/>`,
    real: `
    ${groundShadow(252, 418, 150)}
    <g filter="url(#ds2)">
      <rect x="116" y="352" width="272" height="52" rx="10" fill="url(#lg-red)"/>
      <rect x="340" y="362" width="40" height="32" rx="4" fill="#F8FAFC"/>
      <rect x="132" y="300" width="248" height="52" rx="10" fill="url(#lg-blue)"/>
      <rect x="140" y="310" width="40" height="32" rx="4" fill="#F8FAFC"/>
    </g>
    <g filter="url(#ds)">
      <path d="M172 186 V252 C172 292 340 292 340 252 V186 Z" fill="url(#lg-slate)"/>
      <polygon points="256,104 416,166 256,228 96,166" fill="url(#rg-slate)" stroke="#334155" stroke-width="8" stroke-linejoin="round"/>
      <circle cx="256" cy="166" r="12" fill="url(#rg-amber)"/>
      <path d="M256 166 L384 180" fill="none" stroke="#F59E0B" stroke-width="7" stroke-linecap="round"/>
      <rect x="377" y="178" width="14" height="80" rx="7" fill="url(#brass)"/>
      <path d="M370 254 H398 L404 294 H364 Z" fill="url(#lg-amber)"/>
    </g>` },
  'worklog-todo-manager': { cn:'工作日志与待办管理', c:C.teal, flat:`
    <rect x="140" y="100" width="248" height="312" rx="28" ${S}/>
    ${[168, 256, 344].map(y => `<line x1="112" y1="${y}" x2="164" y2="${y}" ${W(20)}/>`).join('')}
    <polyline points="204,180 218,194 244,166" ${W(16)}/><line x1="268" y1="180" x2="344" y2="180" ${W(20)}/>
    <polyline points="204,256 218,270 244,242" ${W(16)}/><line x1="268" y1="256" x2="344" y2="256" ${W(20)}/>
    <circle cx="224" cy="332" r="14" ${W(12)} opacity=".7"/><line x1="268" y1="332" x2="324" y2="332" ${W(20)} opacity=".7"/>`,
    solid: k => `
    <rect x="140" y="100" width="248" height="312" rx="28" fill="url(#wf)"/>
    <path d="M168 100 H196 V412 H168 Q140 412 140 384 V128 Q140 100 168 100 Z" fill="${k}" opacity=".16"/>
    <rect x="212" y="112" width="160" height="10" rx="5" fill="#fff"/>
    ${[168, 256, 344].map(y => `<rect x="108" y="${y-11}" width="64" height="22" rx="11" fill="url(#wf2)"/><rect x="114" y="${y-9}" width="50" height="6" rx="3" fill="#fff"/>`).join('')}
    <polyline points="214,180 228,194 254,166" ${D(k, 16)}/><rect x="272" y="171" width="84" height="18" rx="9" fill="${k}" opacity=".35"/>
    <polyline points="214,256 228,270 254,242" ${D(k, 16)}/><rect x="272" y="247" width="70" height="18" rx="9" fill="${k}" opacity=".35"/>
    <circle cx="234" cy="332" r="14" ${D(k, 10)} opacity=".45"/><rect x="272" y="323" width="56" height="18" rx="9" fill="${k}" opacity=".22"/>`,
    real: `
    ${groundShadow(256, 420, 140)}
    <g filter="url(#ds)">
      <rect x="148" y="100" width="240" height="312" rx="24" fill="url(#paper)"/>
      <path d="M172 100 H200 V412 H172 Q148 412 148 388 V124 Q148 100 172 100 Z" fill="url(#lg-blue)"/>
    </g>
    ${[160, 222, 284, 346].map(y => `<rect x="124" y="${y-10}" width="64" height="20" rx="10" fill="url(#steelV)"/>`).join('')}
    ${[178, 250].map(y => `<circle cx="236" cy="${y}" r="23" fill="url(#rg-green)"/><polyline points="225,${y} 233,${y+9} 248,${y-9}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/><rect x="268" y="${y-8}" width="84" height="16" rx="8" fill="#CBD5E1"/>`).join('')}
    <circle cx="236" cy="322" r="17" fill="none" stroke="#CBD5E1" stroke-width="6"/><rect x="268" y="314" width="40" height="16" rx="8" fill="#CBD5E1"/>${pencilD(372, 332, 118)}` },
} };
