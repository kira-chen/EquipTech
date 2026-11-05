// 05-备品备件与物资：每个技能的 flat（A 扁平）、solid（C 块面）、real（D 拟物）字形，可以是字符串或接收底色深端 k 的函数
const { W, S, D, badge, tick, mag, pencil, wrench, star, ray, arrowDef, C, badgeC, magC, pencilC, wrenchC, docC, groundShadow, checkD, warnD, magD, pencilD, wrenchD, clockD, docD } = require('./lib');

module.exports = { name: '05-备品备件与物资', icons: {
  'spare-parts-consumption-analysis': { cn:'备件消耗分析', c:C.fuchsia, flat:`
    <path d="M240 152 A124 124 0 1 0 364 276 H240 Z" ${S}/>
    <path d="M272 244 V120 A124 124 0 0 1 396 244 Z" fill="#fff" stroke="#fff" stroke-width="10" stroke-linejoin="round"/>`,
    solid: k => `
    <path d="M240 152 A124 124 0 1 0 364 276 H240 Z" fill="url(#wf)"/>
    <path d="M240 276 H116 A124 124 0 0 0 240 400 Z" fill="${k}" opacity=".28"/>
    <path d="M272 244 V120 A124 124 0 0 1 396 244 Z" fill="url(#wf2)" stroke="#E2E8F0" stroke-width="8" stroke-linejoin="round"/>
    <path d="M286 141 A104 104 0 0 1 375 230" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round"/>`,
    real: `
    ${groundShadow(250, 406, 150)}
    <g filter="url(#ds)">
      <path d="M236 166 A120 120 0 1 0 356 286 H236 Z" fill="#1E3A8A"/>
      <path d="M236 152 A120 120 0 1 0 356 272 H236 Z" fill="url(#rg-blue)"/>
      <path d="M145 230 A100 100 0 0 1 202 178" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".55"/>
      <path d="M268 254 V134 A120 120 0 0 1 388 254 Z" fill="#9A3412"/>
      <path d="M268 240 V120 A120 120 0 0 1 388 240 Z" fill="url(#rg-orange)"/>
    </g>` },
  'spare-parts-demand': { cn:'备件需求提报', c:C.lime, flat: k => `
    <path d="M244 112 L372 172 V316 L244 376 L116 316 V172 Z" ${S}/>
    <polyline points="116,172 244,232 372,172" ${S}/>
    <line x1="244" y1="232" x2="244" y2="376" ${S}/>${badge(372, 368, 56, k, `
    <line x1="372" y1="342" x2="372" y2="394" ${D(k,16)}/><line x1="346" y1="368" x2="398" y2="368" ${D(k,16)}/>`)}`,
    solid: k => `
    <polygon points="116,172 244,232 244,376 116,316" fill="url(#wf)" stroke="url(#wf)" stroke-width="12" stroke-linejoin="round"/>
    <polygon points="244,232 372,172 372,316 244,376" fill="url(#wf2)" stroke="url(#wf2)" stroke-width="12" stroke-linejoin="round"/>
    <polygon points="244,112 372,172 244,232 116,172" fill="#fff" stroke="#fff" stroke-width="12" stroke-linejoin="round"/>
    <polygon points="166,149 194,135 322,195 294,209" fill="${k}" opacity=".3"/>
    <polygon points="294,209 322,195 322,262 294,276" fill="${k}" opacity=".22"/>${badgeC(372, 368, 50, k, `
    <line x1="372" y1="344" x2="372" y2="392" ${D(k,16)}/><line x1="348" y1="368" x2="396" y2="368" ${D(k,16)}/>`)}`,
    real: `
    <defs>
      <linearGradient id="kraftL" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EBC48F"/><stop offset="1" stop-color="#C8924F"/></linearGradient>
      <linearGradient id="kraftR" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#C98F4C"/><stop offset="1" stop-color="#9A6530"/></linearGradient>
    </defs>
    ${groundShadow(244, 398, 150)}
    <g filter="url(#ds)">
      <polygon points="116,172 244,232 244,376 116,316" fill="url(#kraftL)" stroke="url(#kraftL)" stroke-width="10" stroke-linejoin="round"/>
      <polygon points="244,232 372,172 372,316 244,376" fill="url(#kraftR)" stroke="url(#kraftR)" stroke-width="10" stroke-linejoin="round"/>
      <polygon points="244,112 372,172 244,232 116,172" fill="#F5D9AB" stroke="#F5D9AB" stroke-width="10" stroke-linejoin="round"/>
      <polygon points="166,149 194,135 322,195 294,209" fill="#FCEBD0"/>
      <polygon points="294,209 322,195 322,262 294,276" fill="#E9CFA4"/>
      <polygon points="146,238 214,270 214,322 146,290" fill="#fff" opacity=".9"/>
    </g>
    <g filter="url(#ds2)">
      <circle cx="372" cy="364" r="48" fill="url(#rg-blue)"/>
      <rect x="364" y="338" width="16" height="52" rx="8" fill="#fff"/>
      <rect x="346" y="356" width="52" height="16" rx="8" fill="#fff"/>
    </g>` },
  'spare-parts-inventory-query': { cn:'备件库存查询', c:C.cyan, flat:`
    <path d="M100 212 L256 124 L412 212" ${S}/>
    <path d="M132 200 V396 M380 200 V396" ${S}/>
    <rect x="220" y="216" width="72" height="72" rx="10" fill="#fff" opacity=".6"/>
    <rect x="176" y="304" width="72" height="72" rx="10" fill="#fff"/>
    <rect x="264" y="304" width="72" height="72" rx="10" fill="#fff" opacity=".8"/>`,
    solid: k => `
    <path d="M132 214 L256 144 L380 214 V396 H132 Z" fill="url(#wf2)"/>
    <path d="M100 214 L256 126 L412 214" fill="none" stroke="#fff" stroke-width="30" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="164" y="254" width="184" height="142" rx="10" fill="${k}" opacity=".35"/>
    <rect x="224" y="262" width="64" height="64" rx="10" fill="url(#wf2)"/>
    <rect x="184" y="332" width="64" height="64" rx="10" fill="#fff"/>
    <rect x="264" y="332" width="64" height="64" rx="10" fill="url(#wf)"/>
    <rect x="232" y="268" width="48" height="8" rx="4" fill="#fff"/>`,
    real: `
    <defs>
      <linearGradient id="kraft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EBC48F"/><stop offset="1" stop-color="#B57D3E"/></linearGradient>
    </defs>
    ${groundShadow(256, 404, 170)}
    <g filter="url(#ds)">
      <path d="M132 228 L256 156 L380 228 V396 H132 Z" fill="url(#paper)"/>
      <path d="M96 222 L256 128 L416 222 L400 242 L256 158 L112 242 Z" fill="url(#lg-red)" stroke="url(#lg-red)" stroke-width="8" stroke-linejoin="round"/>
      <rect x="172" y="256" width="168" height="140" fill="url(#steelV)"/>
      ${[280, 306, 332, 358].map(y => `<rect x="172" y="${y}" width="168" height="8" fill="#374151" opacity=".75"/>`).join('')}
    </g>
    <g filter="url(#ds2)">
      <rect x="182" y="326" width="70" height="70" rx="6" fill="url(#kraft)"/>
      <rect x="209" y="326" width="16" height="70" fill="#FCEBD0" opacity=".85"/>
      <rect x="262" y="326" width="70" height="70" rx="6" fill="url(#kraft)"/>
      <rect x="289" y="326" width="16" height="70" fill="#FCEBD0" opacity=".85"/>
    </g>` },
} };
