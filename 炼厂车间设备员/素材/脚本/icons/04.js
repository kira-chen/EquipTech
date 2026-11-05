// 04-台账档案与资料管理：每个技能的 flat（A 扁平）、solid（C 块面）、real（D 拟物）字形，可以是字符串或接收底色深端 k 的函数
const { W, S, D, badge, tick, mag, pencil, wrench, star, ray, arrowDef, C, badgeC, magC, pencilC, wrenchC, docC, groundShadow, checkD, warnD, magD, pencilD, wrenchD, clockD, docD } = require('./lib');
// n 齿齿轮，r 为齿顶半径
const gear = (cx, cy, r, fill, n = 8) => { const p = [], w = Math.PI / n * .55;
  for (let i = 0; i < n; i++) { const a = i * 2 * Math.PI / n;
    for (const [d, rr] of [[-w * 1.35, r * .8], [-w * .8, r], [w * .8, r], [w * 1.35, r * .8]])
      p.push(`${Math.round(cx + rr * Math.cos(a + d))},${Math.round(cy + rr * Math.sin(a + d))}`); }
  return `<polygon points="${p.join(' ')}" fill="${fill}" stroke-linejoin="round"/>`; };

module.exports = { name: '04-台账档案与资料管理', icons: {
  'equipment-ledger-query': { cn:'设备台账查询', c:C.blue, flat: k => `
    <rect x="104" y="112" width="250" height="230" rx="24" ${S}/>
    <line x1="104" y1="186" x2="354" y2="186" ${W(22)}/>
    <line x1="104" y1="264" x2="290" y2="264" ${W(22)}/>
    <line x1="190" y1="112" x2="190" y2="342" ${W(22)}/>${mag(346, 334, 56, k)}`,
    solid: k => `
    <rect x="104" y="112" width="250" height="230" rx="24" fill="url(#wf)"/>
    <path d="M104 186 V136 Q104 112 128 112 H330 Q354 112 354 136 V186 Z" fill="${k}" opacity=".75"/>
    <path d="M104 186 H190 V342 H128 Q104 342 104 318 Z" fill="${k}" opacity=".12"/>
    <rect x="186" y="186" width="8" height="156" fill="${k}" opacity=".18"/>
    <rect x="104" y="260" width="250" height="6" fill="${k}" opacity=".15"/>
    <rect x="126" y="140" width="40" height="18" rx="9" fill="#fff" opacity=".9"/>
    <rect x="214" y="140" width="96" height="18" rx="9" fill="#fff" opacity=".9"/>
    <rect x="126" y="214" width="40" height="18" rx="9" fill="${k}" opacity=".3"/>
    <rect x="214" y="214" width="80" height="18" rx="9" fill="${k}" opacity=".3"/>
    <rect x="126" y="290" width="40" height="18" rx="9" fill="${k}" opacity=".3"/>${magC(346, 334, 56, k)}`,
    real: `
    <g filter="url(#ds)">
      <rect x="100" y="108" width="258" height="238" rx="22" fill="url(#paper)"/>
      <path d="M100 168 V130 Q100 108 122 108 H336 Q358 108 358 130 V168 Z" fill="#1E3A8A"/>
      <rect x="100" y="168" width="80" height="178" fill="#DBEAFE"/>
      <rect x="180" y="108" width="6" height="238" fill="#CBD5E1"/>
      <rect x="100" y="224" width="258" height="6" fill="#CBD5E1"/>
      <rect x="100" y="284" width="258" height="6" fill="#CBD5E1"/>
      <rect x="208" y="188" width="92" height="16" rx="8" fill="#94A3B8"/>
      <rect x="208" y="248" width="70" height="16" rx="8" fill="#94A3B8"/>
    </g>${magD(346, 334, 56)}` },
  'moc-change-assistant': { cn:'设备变更管理辅助', c:C.violet, flat:`
    <rect x="104" y="112" width="140" height="140" rx="28" ${S}/>
    <rect x="268" y="260" width="140" height="140" rx="28" fill="#fff"/>
    <path d="M272 182 H306 Q338 182 338 214 V236" ${W(22)}/>
    <polyline points="310,208 338,236 366,208" ${W(22)}/>
    <path d="M242 330 H206 Q174 330 174 298 V280" ${W(22)} opacity=".7"/>
    <polyline points="146,306 174,278 202,306" ${W(22)} opacity=".7"/>`,
    solid: k => `
    <rect x="104" y="112" width="140" height="140" rx="28" fill="url(#wf2)"/>
    <rect x="120" y="118" width="108" height="10" rx="5" fill="#fff" opacity=".8"/>
    <circle cx="174" cy="186" r="32" fill="${k}" opacity=".35"/>
    <rect x="268" y="260" width="140" height="140" rx="28" fill="url(#wf)"/>
    <rect x="284" y="266" width="108" height="10" rx="5" fill="#fff"/>
    <rect x="304" y="298" width="68" height="68" rx="14" fill="${k}" opacity=".5"/>
    <path d="M272 182 H306 Q338 182 338 214 V236" fill="none" stroke="url(#wfu)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
    <polyline points="308,208 338,238 368,208" fill="none" stroke="url(#wfu)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M242 330 H206 Q174 330 174 298 V280" fill="none" stroke="url(#wfu)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>
    <polyline points="144,308 174,278 204,308" fill="none" stroke="url(#wfu)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round" opacity=".75"/>`,
    real: `
    ${groundShadow(338, 410, 74, 10)}
    <g filter="url(#ds)">${gear(174, 182, 72, 'url(#rg-slate)')}
      <circle cx="174" cy="182" r="40" fill="#94A3B8"/>
      <circle cx="174" cy="182" r="17" fill="#334155"/>
    </g>
    <g filter="url(#ds)">${gear(338, 330, 72, 'url(#rg-orange)')}
      <circle cx="338" cy="330" r="40" fill="url(#rg-amber)"/>
      <circle cx="338" cy="330" r="17" fill="#fff"/>
    </g>
    <g filter="url(#ds2)">
      <path d="M272 182 H306 Q338 182 338 214 V230" ${W(26)}/>
      <polyline points="308,204 338,234 368,204" ${W(26)}/>
      <path d="M242 330 H206 Q174 330 174 298 V284" ${W(26)}/>
      <polyline points="144,308 174,278 204,308" ${W(26)}/>
    </g>` },
  'nameplate-ocr-intake': { cn:'铭牌识别与台账录入', c:C.slate, flat: k => `
    <path d="M112 176 V140 Q112 112 140 112 H176" ${S}/>
    <path d="M336 112 H372 Q400 112 400 140 V176" ${S}/>
    <path d="M400 336 V372 Q400 400 372 400 H336" ${S}/>
    <path d="M176 400 H140 Q112 400 112 372 V336" ${S}/>
    <rect x="164" y="186" width="184" height="140" rx="16" fill="#fff"/>
    <circle cx="184" cy="206" r="7" fill="${k}"/><circle cx="328" cy="206" r="7" fill="${k}"/>
    <circle cx="184" cy="306" r="7" fill="${k}"/><circle cx="328" cy="306" r="7" fill="${k}"/>
    <line x1="210" y1="236" x2="302" y2="236" ${D(k,14)}/>
    <line x1="210" y1="276" x2="272" y2="276" ${D(k,14)}/>`,
    solid: k => `
    ${['M112 176 V140 Q112 112 140 112 H176', 'M336 112 H372 Q400 112 400 140 V176', 'M400 336 V372 Q400 400 372 400 H336', 'M176 400 H140 Q112 400 112 372 V336']
      .map(d => `<path d="${d}" fill="none" stroke="url(#wfu)" stroke-width="28" stroke-linecap="round" stroke-linejoin="round"/>`).join('')}
    <rect x="160" y="182" width="192" height="148" rx="18" fill="url(#wf)"/>
    <rect x="176" y="188" width="160" height="10" rx="5" fill="#fff"/>
    <rect x="160" y="300" width="192" height="30" rx="15" fill="${k}" opacity=".1"/>
    <circle cx="184" cy="214" r="9" fill="${k}" opacity=".45"/><circle cx="328" cy="214" r="9" fill="${k}" opacity=".45"/>
    <circle cx="184" cy="298" r="9" fill="${k}" opacity=".45"/><circle cx="328" cy="298" r="9" fill="${k}" opacity=".45"/>
    <rect x="210" y="226" width="96" height="18" rx="9" fill="${k}" opacity=".6"/>
    <rect x="210" y="264" width="64" height="18" rx="9" fill="${k}" opacity=".35"/>`,
    real: `
    ${['M112 176 V140 Q112 112 140 112 H176', 'M336 112 H372 Q400 112 400 140 V176', 'M400 336 V372 Q400 400 372 400 H336', 'M176 400 H140 Q112 400 112 372 V336']
      .map(d => `<path d="${d}" ${W(24)}/>`).join('')}
    <g filter="url(#ds)">
      <rect x="156" y="180" width="200" height="152" rx="16" fill="url(#lg-amber)"/>
      <rect x="166" y="190" width="180" height="132" rx="10" fill="none" stroke="#FDE68A" stroke-width="4" opacity=".8"/>
      <rect x="196" y="222" width="120" height="20" rx="10" fill="#78350F" opacity=".85"/>
      <rect x="196" y="264" width="84" height="20" rx="10" fill="#78350F" opacity=".6"/>
    </g>
    <rect x="124" y="244" width="264" height="26" rx="13" fill="#22D3EE" opacity=".35"/>
    <rect x="124" y="252" width="264" height="10" rx="5" fill="#67E8F9"/>` },
  'special-equipment-inspection-due': { cn:'特种设备定检到期管理', c:C.orange, flat: k => `
    <rect x="176" y="78" width="32" height="30" rx="8" fill="#fff"/>
    <rect x="128" y="104" width="128" height="272" rx="64" ${S}/>
    <line x1="142" y1="240" x2="242" y2="240" ${W(18)} opacity=".6"/>
    <line x1="158" y1="380" x2="146" y2="414" ${W(22)}/>
    <line x1="226" y1="380" x2="238" y2="414" ${W(22)}/>
    <rect x="268" y="252" width="148" height="148" rx="26" fill="#fff" stroke="${k}" stroke-width="14"/>
    <line x1="275" y1="298" x2="409" y2="298" stroke="${k}" stroke-width="10"/>
    <line x1="342" y1="322" x2="342" y2="352" ${D(k,16)}/>
    <circle cx="342" cy="376" r="9" fill="${k}"/>`,
    solid: k => `
    <rect x="176" y="78" width="32" height="34" rx="8" fill="url(#wf2)"/>
    <path d="M150 376 L136 414" fill="none" stroke="url(#wfu)" stroke-width="24" stroke-linecap="round"/>
    <path d="M234 376 L248 414" fill="none" stroke="url(#wfu)" stroke-width="24" stroke-linecap="round"/>
    <rect x="128" y="104" width="128" height="276" rx="64" fill="url(#wf)"/>
    <path d="M192 104 A64 64 0 0 1 256 168 V316 A64 64 0 0 1 192 380 Z" fill="url(#wf2)"/>
    <rect x="128" y="236" width="128" height="10" fill="${k}" opacity=".25"/>
    <rect x="146" y="150" width="14" height="70" rx="7" fill="#fff"/>
    <rect x="264" y="248" width="156" height="156" rx="30" fill="${k}"/>
    <rect x="274" y="258" width="136" height="136" rx="22" fill="url(#wf)"/>
    <path d="M274 300 V280 Q274 258 296 258 H388 Q410 258 410 280 V300 Z" fill="${k}" opacity=".55"/>
    <rect x="333" y="318" width="18" height="40" rx="9" fill="${k}"/>
    <circle cx="342" cy="374" r="10" fill="${k}"/>`,
    real: `
    ${groundShadow(256, 412, 150, 12)}
    <rect x="178" y="76" width="28" height="36" rx="6" fill="url(#steelH)"/>
    <rect x="140" y="360" width="18" height="52" rx="6" fill="#334155"/>
    <rect x="226" y="360" width="18" height="52" rx="6" fill="#334155"/>
    <g filter="url(#ds)">
      <rect x="124" y="100" width="136" height="282" rx="68" fill="url(#lh-steel)"/>
      <rect x="124" y="232" width="136" height="12" fill="#6B7280" opacity=".6"/>
      <rect x="150" y="140" width="16" height="72" rx="8" fill="#fff" opacity=".85"/>
    </g>
    <g filter="url(#ds)">
      <rect x="270" y="236" width="150" height="160" rx="22" fill="url(#paper)"/>
      <path d="M270 292 V258 Q270 236 292 236 H398 Q420 236 420 258 V292 Z" fill="url(#lg-red)"/>
      <rect x="302" y="220" width="14" height="36" rx="7" fill="#334155"/>
      <rect x="374" y="220" width="14" height="36" rx="7" fill="#334155"/>
      ${[0, 1].map(r => [0, 1, 2].map(c => `<rect x="${292 + c*40}" y="${310 + r*40}" width="28" height="28" rx="6" fill="${r === 1 && c === 2 ? '#EF4444' : '#CBD5E1'}"/>`).join('')).join('')}
    </g>` },
  'technical-document-finder': { cn:'技术资料检索与原文引用', c:C.emerald, flat:`
    <path d="M256 156 C214 126 160 120 108 132 V372 C160 360 214 366 256 396 C298 366 352 360 404 372 V132 C352 120 298 126 256 156 Z" ${S}/>
    <line x1="256" y1="156" x2="256" y2="396" ${W(20)}/>
    <line x1="150" y1="200" x2="218" y2="200" ${W(18)} opacity=".75"/>
    <line x1="150" y1="250" x2="218" y2="250" ${W(18)} opacity=".75"/>
    <line x1="150" y1="300" x2="200" y2="300" ${W(18)} opacity=".75"/>
    <line x1="294" y1="200" x2="362" y2="200" ${W(18)} opacity=".75"/>
    <rect x="282" y="228" width="92" height="44" rx="12" fill="#fff"/>
    <line x1="294" y1="300" x2="350" y2="300" ${W(18)} opacity=".75"/>`,
    solid: k => `
    <path d="M256 156 C214 126 160 120 108 132 V372 C160 360 214 366 256 396 Z" fill="url(#wf)"/>
    <path d="M256 156 C298 126 352 120 404 132 V372 C352 360 298 366 256 396 Z" fill="url(#wf2)"/>
    <rect x="248" y="156" width="16" height="240" rx="8" fill="${k}" opacity=".25"/>
    ${[200, 250, 300].map((y, i) => `<rect x="146" y="${y-10}" width="${i === 2 ? 56 : 74}" height="20" rx="10" fill="${k}" opacity=".3"/>`).join('')}
    <rect x="290" y="190" width="74" height="20" rx="10" fill="${k}" opacity=".3"/>
    <rect x="282" y="228" width="92" height="44" rx="12" fill="${k}" opacity=".55"/>
    <rect x="290" y="290" width="60" height="20" rx="10" fill="${k}" opacity=".3"/>`,
    real: `
    ${groundShadow(256, 410, 160, 12)}
    <g filter="url(#ds)">
      <path d="M256 176 C210 146 150 142 94 154 V394 C150 382 210 386 256 414 C302 386 362 382 418 394 V154 C362 142 302 146 256 176 Z" fill="url(#lg-blue)"/>
      <path d="M256 156 C214 126 160 120 108 132 V372 C160 360 214 366 256 396 Z" fill="url(#paper)"/>
      <path d="M256 156 C298 126 352 120 404 132 V372 C352 360 298 366 256 396 Z" fill="url(#face)"/>
      <rect x="236" y="156" width="40" height="240" fill="url(#lh-slate)" opacity=".22"/>
      ${[200, 250, 300].map((y, i) => `<rect x="146" y="${y-8}" width="${i === 2 ? 56 : 74}" height="16" rx="8" fill="#CBD5E1"/>`).join('')}
      <rect x="292" y="192" width="72" height="16" rx="8" fill="#CBD5E1"/>
      <rect x="282" y="230" width="94" height="38" rx="10" fill="#FDE047"/>
      <rect x="294" y="241" width="70" height="16" rx="8" fill="#94A3B8"/>
      <rect x="292" y="292" width="58" height="16" rx="8" fill="#CBD5E1"/>
      <path d="M368 120 V182 L382 170 L396 182 V124 Z" fill="url(#lg-red)"/>
    </g>` },
  'valve-instrument-calibration-ledger': { cn:'安全阀校验台账到期管理', c:C.red, flat:`
    <line x1="104" y1="336" x2="408" y2="336" ${W(30)}/>
    <polygon points="160,280 256,336 160,392" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>
    <polygon points="352,280 256,336 352,392" fill="#fff" stroke="#fff" stroke-width="16" stroke-linejoin="round"/>
    <line x1="256" y1="336" x2="256" y2="212" ${W(20)}/>
    <polyline points="256,212 222,200 290,180 222,160 290,140 256,128" ${W(16)}/>
    <rect x="216" y="102" width="80" height="26" rx="10" fill="#fff"/>`,
    solid: k => `
    <rect x="96" y="312" width="320" height="48" rx="14" fill="url(#wf)"/>
    <rect x="96" y="312" width="320" height="14" rx="7" fill="#fff" opacity=".7"/>
    <rect x="132" y="292" width="26" height="88" rx="8" fill="url(#wf2)"/>
    <rect x="354" y="292" width="26" height="88" rx="8" fill="url(#wf2)"/>
    <polygon points="172,282 256,336 172,390" fill="url(#wf)" stroke="#fff" stroke-width="14" stroke-linejoin="round"/>
    <polygon points="340,282 256,336 340,390" fill="url(#wf2)" stroke="#E2E8F0" stroke-width="14" stroke-linejoin="round"/>
    <circle cx="256" cy="336" r="22" fill="${k}" opacity=".35"/>
    <rect x="244" y="206" width="24" height="120" rx="8" fill="url(#wf2)"/>
    <polyline points="256,214 220,202 292,182 220,162 292,142 256,130" fill="none" stroke="url(#wfu)" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="210" y="98" width="92" height="34" rx="12" fill="url(#wf)"/>
    <rect x="218" y="102" width="76" height="8" rx="4" fill="#fff"/>`,
    real: `
    ${groundShadow(256, 404, 170, 16)}
    <rect x="80" y="316" width="352" height="58" rx="10" fill="url(#steelV)"/>
    <rect x="140" y="294" width="30" height="102" rx="6" fill="url(#steelH)"/>
    <rect x="342" y="294" width="30" height="102" rx="6" fill="url(#steelH)"/>
    ${[310, 345, 380].map(y => `<circle cx="155" cy="${y}" r="5" fill="#374151"/><circle cx="357" cy="${y}" r="5" fill="#374151"/>`).join('')}
    <ellipse cx="256" cy="344" rx="76" ry="64" fill="url(#steelR)"/>
    <path d="M222 292 L290 292 L280 232 L232 232 Z" fill="url(#steelH)"/>
    <rect x="224" y="128" width="12" height="108" rx="5" fill="url(#steelH)"/>
    <rect x="276" y="128" width="12" height="108" rx="5" fill="url(#steelH)"/>
    <polyline points="256,226 234,214 278,198 234,182 278,166 234,150 256,138" fill="none" stroke="url(#brass)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="206" y="100" width="100" height="36" rx="12" fill="url(#steelH)"/>
    <rect x="214" y="104" width="84" height="8" rx="4" fill="#fff" opacity=".7"/>
    <path d="M288 246 Q320 236 346 214" fill="none" stroke="#F8FAFC" stroke-width="5"/>
    <g transform="rotate(14 386 212)" filter="url(#ds)">
      <rect x="338" y="176" width="100" height="72" rx="12" fill="#fff"/>
      <circle cx="352" cy="212" r="7" fill="#CBD5E1"/>
      <polyline points="372,212 388,228 418,196" fill="none" stroke="#16A34A" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>
    </g>` },
} };
