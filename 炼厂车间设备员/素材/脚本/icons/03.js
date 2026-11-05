// 03-承包商与作业现场管理：每个技能的 flat（A 扁平）、solid（C 块面）、real（D 拟物）字形，可以是字符串或接收底色深端 k 的函数
const { W, S, D, badge, tick, mag, pencil, wrench, star, ray, arrowDef, C, badgeC, magC, pencilC, wrenchC, docC, groundShadow, checkD, warnD, magD, pencilD, wrenchD, clockD, docD } = require('./lib');

module.exports = { name: '03-承包商与作业现场管理', icons: {
  'contractor-performance-log': { cn:'承包商表现记录', c:C.amber, flat: k => `
    <path d="M152 262 C152 188 198 140 256 140 C314 140 360 188 360 262 Z" fill="#fff"/>
    <line x1="256" y1="160" x2="256" y2="226" ${D(k,14)}/>
    <rect x="116" y="252" width="280" height="42" rx="21" fill="#fff"/>
    ${star(168, 366, 36)}${star(256, 366, 36)}${star(344, 366, 36, ' opacity=".45"')}`,
    solid: k => `
    <path d="M152 262 C152 188 198 140 256 140 C314 140 360 188 360 262 Z" fill="url(#wf)"/>
    <path d="M256 140 C314 140 360 188 360 262 H256 Z" fill="url(#wf2)"/>
    <rect x="240" y="146" width="32" height="116" rx="14" fill="${k}" opacity=".3"/>
    <path d="M178 240 C180 200 204 170 234 158" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".9"/>
    <rect x="116" y="252" width="280" height="42" rx="21" fill="url(#wf2)"/>
    <rect x="132" y="256" width="248" height="10" rx="5" fill="#fff" opacity=".8"/>
    ${star(168, 366, 36, '', 'url(#wf)')}${star(256, 366, 36, '', 'url(#wf)')}${star(344, 366, 36, ' opacity=".45"', 'url(#wf)')}`,
    real: `
    <g transform="translate(256 268) scale(1.1) translate(-256 -268)">
    <g filter="url(#ds)">
      <path d="M150 258 C150 182 198 132 256 132 C314 132 362 182 362 258 Z" fill="url(#face)"/>
      <path d="M232 136 Q256 128 280 136 V258 H232 Z" fill="url(#lh-blue)"/>
      <path d="M176 236 C178 196 200 166 226 154" fill="none" stroke="#fff" stroke-width="12" stroke-linecap="round"/>
      <rect x="108" y="250" width="296" height="40" rx="20" fill="url(#paper)"/>
      <rect x="108" y="276" width="296" height="14" rx="7" fill="#CBD5E1"/>
    </g>
    <g filter="url(#ds2)">
      <rect x="116" y="318" width="280" height="84" rx="42" fill="url(#lg-blue)"/>
      ${star(176, 360, 30, '', 'url(#lg-yellow)')}${star(256, 360, 30, '', 'url(#lg-yellow)')}${star(336, 360, 30, '', '#93A8D6')}
    </g></g>` },
  'contractor-qualification-check': { cn:'承包商资质核验', c:C.sky, flat: k => `
    <rect x="100" y="130" width="312" height="230" rx="30" ${S}/>
    <circle cx="184" cy="214" r="34" fill="#fff"/>
    <path d="M132 312 C132 276 158 258 184 258 C210 258 236 276 236 312 Z" fill="#fff"/>
    <line x1="276" y1="206" x2="360" y2="206" ${W(22)}/>
    <line x1="276" y1="254" x2="332" y2="254" ${W(22)}/>${badge(368, 360, 56, k, tick(368, 360, k))}`,
    solid: k => `
    <rect x="100" y="130" width="312" height="230" rx="30" fill="url(#wf)"/>
    <path d="M100 180 V160 Q100 130 130 130 H382 Q412 130 412 160 V180 Z" fill="${k}" opacity=".18"/>
    <rect x="130" y="146" width="110" height="18" rx="9" fill="${k}" opacity=".5"/>
    <rect x="124" y="196" width="120" height="140" rx="16" fill="${k}" opacity=".7"/>
    <circle cx="184" cy="244" r="28" fill="#fff"/>
    <path d="M140 336 C140 304 160 288 184 288 C208 288 228 304 228 336 Z" fill="url(#wf)"/>
    <rect x="272" y="214" width="96" height="20" rx="10" fill="${k}" opacity=".3"/>
    <rect x="272" y="258" width="64" height="20" rx="10" fill="${k}" opacity=".3"/>${badgeC(372, 362, 50, k, tick(372, 362, k, 18))}`,
    real: `
    <g filter="url(#ds)">
      <rect x="96" y="128" width="320" height="236" rx="24" fill="url(#paper)"/>
      <path d="M96 178 V152 Q96 128 120 128 H392 Q416 128 416 152 V178 Z" fill="#1E3A8A"/>
      <rect x="124" y="146" width="112" height="14" rx="7" fill="#fff" opacity=".85"/>
      <rect x="124" y="198" width="112" height="136" rx="14" fill="#DBEAFE"/>
      <circle cx="180" cy="248" r="28" fill="url(#rg-blue)"/>
      <path d="M134 334 C134 298 156 282 180 282 C204 282 226 298 226 334 Z" fill="url(#lg-blue)"/>
      <rect x="262" y="210" width="118" height="18" rx="9" fill="#CBD5E1"/>
      <rect x="262" y="250" width="86" height="18" rx="9" fill="#CBD5E1"/>
    </g>${checkD(376, 362, 48)}` },
  'cross-operation-conflict': { cn:'交叉作业冲突检测', c:C.rose, flat: k => `
    <line x1="130" y1="382" x2="372" y2="140" ${S}/>
    <polyline points="300,140 372,140 372,212" ${S}/>
    <line x1="382" y1="382" x2="140" y2="140" ${S}/>
    <polyline points="212,140 140,140 140,212" ${S}/>
    <circle cx="256" cy="256" r="50" fill="#fff" stroke="${k}" stroke-width="14"/>
    <line x1="256" y1="232" x2="256" y2="260" ${D(k,16)}/>
    <circle cx="256" cy="284" r="9" fill="${k}"/>`,
    solid: k => `${arrowC(-45, 'url(#wf2)')}${arrowC(45, 'url(#wf)')}${badgeC(256, 256, 46, k, `
    <rect x="248" y="226" width="16" height="38" rx="8" fill="${k}"/>
    <circle cx="256" cy="284" r="10" fill="${k}"/>`)}`,
    real: `
    <g filter="url(#ds2)">${arrowC(-45, 'url(#lh-green)')}</g>
    <g filter="url(#ds2)">${arrowC(45, 'url(#lh-blue)')}</g>${warnD(256, 262, 58)}` },
  'site-supervision-points': { cn:'现场作业监督要点', c:C.teal, flat: k => `
    <path d="M92 256 C160 160 352 160 420 256 C352 352 160 352 92 256 Z" ${S}/>
    <circle cx="256" cy="256" r="64" fill="#fff"/>
    <circle cx="256" cy="256" r="26" fill="${k}"/>
    <circle cx="274" cy="238" r="9" fill="#fff"/>`,
    solid: k => `
    <path d="M92 256 C160 160 352 160 420 256 C352 352 160 352 92 256 Z" fill="url(#wf)"/>
    <path d="M92 256 C160 160 352 160 420 256 C352 220 160 220 92 256 Z" fill="${k}" opacity=".12"/>
    <circle cx="256" cy="256" r="68" fill="${k}" opacity=".55"/>
    <circle cx="256" cy="256" r="30" fill="${k}"/>
    <circle cx="280" cy="232" r="13" fill="#fff"/>`,
    real: `
    <g filter="url(#ds)">
      <path d="M88 256 C158 154 354 154 424 256 C354 358 158 358 88 256 Z" fill="url(#face)"/>
      <circle cx="256" cy="256" r="72" fill="url(#rg-blue)"/>
      <path d="M88 256 C158 154 354 154 424 256 C354 206 158 206 88 256 Z" fill="#0F172A" opacity=".14"/>
      <circle cx="256" cy="256" r="32" fill="#0F172A"/>
      <circle cx="282" cy="230" r="15" fill="#fff"/>
    </g>` },
} };
// 粗箭头块：竖直朝上画好后绕中心旋转
function arrowC(rot, fill) { return `
    <g transform="rotate(${rot} 256 256)">
      <rect x="234" y="140" width="44" height="282" rx="22" fill="${fill}"/>
      <polygon points="256,84 312,158 200,158" fill="${fill}" stroke="none"/></g>`; }
