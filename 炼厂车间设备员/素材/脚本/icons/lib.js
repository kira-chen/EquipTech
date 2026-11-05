// 图标公共部分：配色、底板、材质渐变和常用小部件。
// 三种风格：A 扁平（白色线条）、C 块面（白到浅灰蓝的实心块面）、D 拟物（彩色材质）。
// 画布 512×512，主体放在 100–412 之间；C、D 的底板下沿留 16 做厚度，主体整体上移 6。
// 注意：渐变默认按图形包围盒计算，水平/竖直直线的包围盒宽或高为 0，用渐变描边会画不出来。
// 直线描边用纯色或 userSpaceOnUse 渐变（如 wfu），需要渐变的长条改用 rect。

// ---------- A 扁平 ----------
const W = (w=26) => `fill="none" stroke="#fff" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
const S = W();
// 深色描边，k 为图标底色的深端
const D = (k, w) => `fill="none" stroke="${k}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"`;
// 右下角徽标：白底圆，外圈用底色隔开下层图形
const badge = (cx, cy, r, k, inner) => `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="#fff" stroke="${k}" stroke-width="14"/>${inner}`;
const tick = (cx, cy, k, w=14) => `<polyline points="${cx-22},${cy+2} ${cx-6},${cy+18} ${cx+24},${cy-14}" ${D(k,w)}/>`;
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
const star = (cx, cy, r, extra='', fill='#fff') => { const p = [];
  for (let i = 0; i < 10; i++) { const a = -Math.PI/2 + i*Math.PI/5, rr = i % 2 ? r*.45 : r; p.push(`${Math.round(cx + rr*Math.cos(a))},${Math.round(cy + rr*Math.sin(a))}`); }
  return `<polygon points="${p.join(' ')}" fill="${fill}" stroke="${fill}" stroke-width="8" stroke-linejoin="round"${extra}/>`; };
// 以 (cx,cy) 为圆心、角度 deg 处从 r1 到 r2 的径向短线
const ray = (cx, cy, deg, r1, r2, a) => { const t = deg*Math.PI/180, c = Math.cos(t), s = Math.sin(t);
  return `<line x1="${Math.round(cx+r1*c)}" y1="${Math.round(cy+r1*s)}" x2="${Math.round(cx+r2*c)}" y2="${Math.round(cy+r2*s)}" ${a}/>`; };
const arrowDef = (id, color='#fff') => `<defs><marker id="${id}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3" orient="auto-start-reverse">
      <path d="M1 1 L9 5 L1 9" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>`;
const C = {
  red:['#F87171','#B91C1C'], orange:['#FB923C','#C2410C'], amber:['#FBBF24','#B45309'], yellow:['#FACC15','#A16207'],
  lime:['#A3E635','#4D7C0F'], green:['#4ADE80','#15803D'], emerald:['#34D399','#047857'], teal:['#2DD4BF','#0F766E'],
  cyan:['#22D3EE','#0E7490'], sky:['#38BDF8','#0369A1'], blue:['#60A5FA','#1D4ED8'], indigo:['#818CF8','#4338CA'],
  violet:['#A78BFA','#6D28D9'], purple:['#C084FC','#7E22CE'], fuchsia:['#E879F9','#A21CAF'], pink:['#F472B6','#BE185D'],
  rose:['#FB7185','#BE123C'], slate:['#94A3B8','#334155'],
};

// ---------- 底板 ----------
const shade = (hex, f) => '#' + [1, 3, 5].map(i => Math.round(parseInt(hex.slice(i, i+2), 16) * f).toString(16).padStart(2, '0')).join('').toUpperCase();
const plateDefs = (name, c) => `
    <linearGradient id="bg-${name}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c[0]}"/><stop offset="1" stop-color="${c[1]}"/></linearGradient>
    <linearGradient id="hl-${name}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
const plateFlat = name => `
  <rect width="512" height="512" rx="112" fill="url(#bg-${name})"/>
  <rect width="512" height="512" rx="112" fill="url(#hl-${name})"/>`;
// 带厚度的底板：下沿深色边 + 顶部亮边
const plate3d = (name, c) => `
  <rect y="14" width="512" height="498" rx="112" fill="${shade(c[1], .62)}"/>
  <rect width="512" height="496" rx="112" fill="url(#bg-${name})"/>
  <rect width="512" height="496" rx="112" fill="url(#hl-${name})"/>
  <rect x="3" y="3" width="506" height="490" rx="109" fill="none" stroke="url(#rim)" stroke-width="6"/>`;

// ---------- C、D 共用材质（每个 C/D 图标都带上，按 id 引用） ----------
// 彩色材质：rg-<色> 球面高光，lg-<色> 上亮下暗，lh-<色> 圆柱（左暗中亮右暗）
const HUES = {
  red:['#FECACA','#EF4444','#991B1B'], orange:['#FED7AA','#F97316','#9A3412'], amber:['#FDE68A','#F59E0B','#92400E'],
  yellow:['#FEF9C3','#FACC15','#A16207'], green:['#BBF7D0','#22C55E','#166534'], teal:['#99F6E4','#14B8A6','#115E59'],
  blue:['#BFDBFE','#3B82F6','#1E3A8A'], indigo:['#C7D2FE','#6366F1','#3730A3'], violet:['#DDD6FE','#8B5CF6','#5B21B6'],
  slate:['#E2E8F0','#64748B','#1E293B'], steel:['#F9FAFB','#C4C9D1','#4B5563'], kraft:['#F3DFBC','#C99A5E','#8A5A2B'],
};
const hueDefs = Object.entries(HUES).map(([n, [l, m, d]]) => `
    <radialGradient id="rg-${n}" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${l}"/><stop offset=".5" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></radialGradient>
    <linearGradient id="lg-${n}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${l}"/><stop offset=".45" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></linearGradient>
    <linearGradient id="lh-${n}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${d}"/><stop offset=".3" stop-color="${l}"/><stop offset=".7" stop-color="${m}"/><stop offset="1" stop-color="${d}"/></linearGradient>`).join('');
const materialDefs = `
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="ds" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="10" stdDeviation="9" flood-color="#000" flood-opacity=".3"/></filter>
    <filter id="ds2" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-color="#000" flood-opacity=".25"/></filter>
    <linearGradient id="wf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#DCE6F2"/></linearGradient>
    <linearGradient id="wf2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#EEF2F7"/><stop offset="1" stop-color="#C5D2E0"/></linearGradient>
    <linearGradient id="wfu" gradientUnits="userSpaceOnUse" x1="0" y1="96" x2="0" y2="416"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#CFDAE7"/></linearGradient>
    <linearGradient id="steelV" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F3F4F6"/><stop offset=".35" stop-color="#D1D5DB"/><stop offset=".75" stop-color="#9CA3AF"/><stop offset="1" stop-color="#6B7280"/></linearGradient>
    <linearGradient id="steelH" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9CA3AF"/><stop offset=".3" stop-color="#F3F4F6"/><stop offset=".7" stop-color="#C4C9D1"/><stop offset="1" stop-color="#6B7280"/></linearGradient>
    <radialGradient id="steelR" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#F9FAFB"/><stop offset=".5" stop-color="#C4C9D1"/><stop offset="1" stop-color="#4B5563"/></radialGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#B45309"/><stop offset=".45" stop-color="#FDE68A"/><stop offset="1" stop-color="#D97706"/></linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#E8EEF5"/></linearGradient>
    <radialGradient id="face" cx=".4" cy=".35" r=".8"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#E2E8F0"/></radialGradient>
    <radialGradient id="glass" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".4" stop-color="#E0F2FE" stop-opacity=".7"/><stop offset="1" stop-color="#7DD3FC" stop-opacity=".55"/></radialGradient>${hueDefs}`;

// ---------- C 块面部件 ----------
// 圆形徽标：底色外圈 + 浅灰蓝面
const badgeC = (cx, cy, r, k, inner) => `
    <circle cx="${cx}" cy="${cy}" r="${r+10}" fill="${k}"/>
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#wf)"/>${inner}`;
const magC = (cx, cy, r, k) => { const a = Math.round(cx + r*.72), b = Math.round(cy + r*.72), e = a + 50, f = b + 50; return `
    <line x1="${a}" y1="${b}" x2="${e}" y2="${f}" stroke="${k}" stroke-width="64" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="${r+22}" fill="${k}"/>
    <line x1="${a}" y1="${b}" x2="${e}" y2="${f}" stroke="url(#wfu)" stroke-width="36" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy}" r="${r+12}" fill="url(#wf)"/>
    <circle cx="${cx}" cy="${cy}" r="${r-12}" fill="${k}" opacity=".35"/>
    <path d="M${cx-r*.55} ${cy-r*.1} A${r*.55} ${r*.55} 0 0 1 ${cx-r*.05} ${cy-r*.58}" fill="none" stroke="#fff" stroke-width="10" stroke-linecap="round" opacity=".8"/>`; };
const pencilC = (cx, cy, len, k) => { const t = cy - len/2, b = cy + len/2;
  return `
    <g transform="rotate(45 ${cx} ${cy})">
      <rect x="${cx-24}" y="${t-12}" width="48" height="${len+24}" rx="12" fill="${k}" stroke="${k}" stroke-width="24"/>
      <polygon points="${cx-24},${b} ${cx+24},${b} ${cx},${b+44}" fill="${k}" stroke="${k}" stroke-width="24" stroke-linejoin="round"/>
      <rect x="${cx-22}" y="${t}" width="22" height="${len}" fill="#fff"/><rect x="${cx}" y="${t}" width="22" height="${len}" fill="#D5DFEB"/>
      <polygon points="${cx-22},${b} ${cx},${b} ${cx},${b+40}" fill="#fff"/><polygon points="${cx},${b} ${cx+22},${b} ${cx},${b+40}" fill="#D5DFEB"/>
      <rect x="${cx-22}" y="${t+22}" width="44" height="12" fill="${k}" opacity=".45"/></g>`; };
const wrenchC = (cx, cy, rot, k) => { const h = cy - 70;
  const draw = (c, d) => `<path d="M${cx+22} ${h-38} A44 44 0 1 1 ${cx-22} ${h-38}" fill="none" stroke="${c}" stroke-width="${34+d}" stroke-linecap="round"/><rect x="${cx-19-d/2}" y="${cy-40-d/2}" width="${38+d}" height="${146+d}" rx="${19+d/2}" fill="${c}"/>`;
  return `
    <g transform="rotate(${rot} ${cx} ${cy})">${draw(k, 24)}${draw('#E9EFF6', 0)}<rect x="${cx-19}" y="${cy-40}" width="19" height="146" rx="9" fill="#fff"/></g>`; };
// 实心文档：浅灰蓝纸面 + 顶部色条 + 若干行（rows 为每行宽度）
const docC = (x, y, w, h, k, rows=[.64, .5, .32]) => `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28" fill="url(#wf)"/>
    <rect x="${x}" y="${y}" width="${w}" height="56" rx="28" fill="${k}" opacity=".18"/>
    <rect x="${x+36}" y="${y+18}" width="${Math.round(w*.44)}" height="20" rx="10" fill="${k}" opacity=".55"/>
    ${rows.map((r, i) => `<rect x="${x+36}" y="${y+90+i*48}" width="${Math.round(w*r)}" height="20" rx="10" fill="${k}" opacity=".3"/>`).join('')}`;

// ---------- D 拟物部件 ----------
const groundShadow = (cx, cy, rx, ry=14) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="#000" opacity=".18"/>`;
// 绿色对勾球
const checkD = (cx, cy, r=40) => `
    <g filter="url(#ds2)"><circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#rg-green)"/>
    <polyline points="${cx-r*.42},${cy+r*.02} ${cx-r*.1},${cy+r*.34} ${cx+r*.46},${cy-r*.3}" fill="none" stroke="#fff" stroke-width="${Math.round(r*.26)}" stroke-linecap="round" stroke-linejoin="round"/></g>`;
// 黄色警示三角
const warnD = (cx, cy, s=60) => `
    <g filter="url(#ds2)"><path d="M${cx} ${cy-s} L${cx+s*1.1} ${cy+s*.8} H${cx-s*1.1} Z" fill="url(#lg-amber)" stroke="#FBBF24" stroke-width="${Math.round(s*.28)}" stroke-linejoin="round"/>
    <line x1="${cx}" y1="${cy-s*.35}" x2="${cx}" y2="${cy+s*.22}" stroke="#1F2937" stroke-width="${Math.round(s*.2)}" stroke-linecap="round"/>
    <circle cx="${cx}" cy="${cy+s*.52}" r="${Math.round(s*.11)}" fill="#1F2937"/></g>`;
// 放大镜：钢圈 + 玻璃镜片 + 深色胶柄
const magD = (cx, cy, r) => { const a = cx + r*.72, b = cy + r*.72;
  return `
    <g filter="url(#ds)">
      <g transform="rotate(-45 ${a} ${b})"><rect x="${a-18}" y="${b+4}" width="36" height="88" rx="16" fill="url(#lh-slate)"/></g>
      <circle cx="${cx}" cy="${cy}" r="${r+14}" fill="url(#steelR)"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#glass)"/>
      <path d="M${cx-r*.6} ${cy-r*.05} A${r*.6} ${r*.6} 0 0 1 ${cx-r*.05} ${cy-r*.62}" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" opacity=".9"/></g>`; };
// 黄色铅笔，斜 45°，笔尖朝左下
const pencilD = (cx, cy, len) => { const t = cy - len/2, b = cy + len/2;
  return `
    <g transform="rotate(45 ${cx} ${cy})" filter="url(#ds)">
      <rect x="${cx-22}" y="${t-6}" width="44" height="30" rx="10" fill="#F472B6"/>
      <rect x="${cx-22}" y="${t+20}" width="44" height="20" fill="url(#steelH)"/>
      <rect x="${cx-22}" y="${t+40}" width="44" height="${len-40}" fill="url(#lh-yellow)"/>
      <polygon points="${cx-22},${b} ${cx+22},${b} ${cx},${b+42}" fill="#F5D0A9"/>
      <polygon points="${cx-8},${b+26} ${cx+8},${b+26} ${cx},${b+42}" fill="#374151"/></g>`; };
// 钢制开口扳手；edge 给出描边色时先画一圈深色轮廓，用于浅色底板
const wrenchD = (cx, cy, rot, edge) => { const h = cy - 70;
  return `
    <g transform="rotate(${rot} ${cx} ${cy})" filter="url(#ds)">${edge ? `
      <rect x="${cx-25}" y="${cy-46}" width="50" height="158" rx="25" fill="${edge}"/>
      <path d="M${cx+22} ${h-38} A44 44 0 1 1 ${cx-22} ${h-38}" fill="none" stroke="${edge}" stroke-width="48" stroke-linecap="round"/>` : ''}
      <rect x="${cx-19}" y="${cy-40}" width="38" height="146" rx="19" fill="url(#steelH)"/>
      <path d="M${cx+22} ${h-38} A44 44 0 1 1 ${cx-22} ${h-38}" fill="none" stroke="#B8BEC7" stroke-width="36" stroke-linecap="round"/>
      <path d="M${cx-40} ${h-4} A44 44 0 0 1 ${cx-24} ${h-36}" fill="none" stroke="#F3F4F6" stroke-width="10" stroke-linecap="round"/></g>`; };
// 橙色闹钟
const clockD = (cx, cy, r=76) => `
    <g filter="url(#ds)">
      <path d="M${cx-52} ${cy-52} A34 34 0 0 1 ${cx-16} ${cy-86} Z" transform="rotate(-8 ${cx-34} ${cy-68})" fill="url(#lg-orange)"/>
      <path d="M${cx+52} ${cy-52} A34 34 0 0 0 ${cx+16} ${cy-86} Z" transform="rotate(8 ${cx+34} ${cy-68})" fill="url(#lg-orange)"/>
      <line x1="${cx-38}" y1="${cy+56}" x2="${cx-52}" y2="${cy+72}" stroke="#9A3412" stroke-width="12" stroke-linecap="round"/>
      <line x1="${cx+38}" y1="${cy+56}" x2="${cx+52}" y2="${cy+72}" stroke="#9A3412" stroke-width="12" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#rg-orange)"/>
      <circle cx="${cx}" cy="${cy}" r="${Math.round(r*.76)}" fill="url(#face)"/>
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy-r*.5}" stroke="#1F2937" stroke-width="10" stroke-linecap="round"/>
      <line x1="${cx}" y1="${cy}" x2="${cx+r*.37}" y2="${cy+r*.21}" stroke="#1F2937" stroke-width="10" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cy}" r="8" fill="#DC2626"/></g>`;
// 纸质文档：深蓝页眉 + 灰色行（rows 为每行宽度占比）
const docD = (x, y, w, h, head='#1E3A8A', rows=[.74, .58, .66]) => `
    <g filter="url(#ds)">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="url(#paper)"/>
      <path d="M${x} ${y+40} V${y+24} Q${x} ${y} ${x+24} ${y} H${x+w-24} Q${x+w} ${y} ${x+w} ${y+24} V${y+40} Z" fill="${head}"/>
      <rect x="${x+28}" y="${y+14}" width="${Math.round(w*.37)}" height="12" rx="6" fill="#fff" opacity=".85"/>
      ${rows.map((r, i) => `<rect x="${x+28}" y="${y+74+i*40}" width="${Math.round(w*r)}" height="16" rx="8" fill="#CBD5E1"/>`).join('')}</g>`;

module.exports = { W, S, D, badge, tick, mag, pencil, wrench, star, ray, arrowDef, C, shade,
  plateDefs, plateFlat, plate3d, materialDefs,
  badgeC, magC, pencilC, wrenchC, docC,
  groundShadow, checkD, warnD, magD, pencilD, wrenchD, clockD, docD };
