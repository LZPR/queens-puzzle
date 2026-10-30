/* 分层卡面与镭射光：立绘是原有透明 PNG，角度/视差/反光由 CSS 变量驱动。 */
const pictures = new Map();
const dex = p => String(p.id).padStart(3, '0');
export function cardScene(p, interactive = true) {
  const scene = document.createElement('div');
  scene.className = 'poke-scene';
  scene.innerHTML = `<div class="poke-card" data-card-id="${p.id}" style="--poke-color:${p.color};--poke-night:${p.night}"
    ${interactive ? 'tabindex="0" role="group"' : 'aria-hidden="true"'} aria-label="${p.name}的镭射卡，拖动或按方向键转动，双击或按 Home 回正">
    <div class="poke-card-base"></div><div class="poke-card-world"><i></i><i></i><i></i></div>
    <div class="poke-card-orbit"></div><div class="poke-card-foil"></div>
    <div class="poke-card-heading"><span>NO. ${dex(p)}</span><b>${p.type}</b></div>
    <img class="poke-card-art" src="${p.art}" alt="${p.name}" draggable="false">
    <div class="poke-card-name"><b>${p.name}</b><span>${p.english}</span></div>
    <div class="poke-card-foot"><span>QUEENS COLLECTION</span><b>✦ HOLO</b></div>
    <div class="poke-card-glare"></div></div>`;
  const card = scene.firstElementChild;
  card.querySelector('img').addEventListener('error', e => { e.target.hidden = true; card.classList.add('art-unavailable'); });
  if (interactive) attachTilt(card);
  return scene;
}
function attachTilt(card) {
  let pointer = null, origin = null, x = 0, y = 0;
  const clamp = n => Math.max(-1, Math.min(1, n));
  const set = (nx, ny) => {
    x = clamp(nx); y = clamp(ny);
    card.style.setProperty('--tilt-x', (x * 22) + 'deg');
    card.style.setProperty('--tilt-y', (-y * 18) + 'deg');
    card.style.setProperty('--parallax-x', (x * 17) + 'px');
    card.style.setProperty('--parallax-y', (y * 14) + 'px');
    card.style.setProperty('--glare-x', (50 + x * 38) + '%');
    card.style.setProperty('--glare-y', (50 + y * 38) + '%');
    card.style.setProperty('--foil-angle', (125 + x * 40 - y * 25) + 'deg');
  };
  card.addEventListener('pointerdown', e => {
    if (pointer !== null || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointer = e.pointerId; origin = { x: e.clientX, y: e.clientY, tiltX: x, tiltY: y };
    card.setPointerCapture(pointer); card.classList.add('is-dragging');
  });
  card.addEventListener('pointermove', e => {
    if (pointer !== e.pointerId) return;
    const width = card.offsetWidth;
    set(origin.tiltX + (e.clientX - origin.x) / (width * .6), origin.tiltY + (e.clientY - origin.y) / (width * .6));
  });
  const release = e => {
    if (e.pointerId !== pointer) return;
    if (card.hasPointerCapture(pointer)) card.releasePointerCapture(pointer);
    pointer = null; card.classList.remove('is-dragging');
  };
  card.addEventListener('pointerup', release);
  card.addEventListener('pointercancel', release);
  card.addEventListener('lostpointercapture', release);
  card.addEventListener('dblclick', () => set(0, 0));
  card.addEventListener('keydown', e => {
    const step = .18;
    if (e.key === 'ArrowLeft') set(x - step, y);
    else if (e.key === 'ArrowRight') set(x + step, y);
    else if (e.key === 'ArrowUp') set(x, y - step);
    else if (e.key === 'ArrowDown') set(x, y + step);
    else if (e.key === 'Home') set(0, 0);
    else return;
    e.preventDefault(); e.stopPropagation();
  });
}

/** 先翻成同款卡面的平面快照，翻完再装入可交互的分层卡面。 */
export function cardPicture(p) {
  if (!pictures.has(p.id)) pictures.set(p.id, (async () => {
    let image = '';
    try {
      const response = await fetch(p.art, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error('art');
      const data = await response.blob();
      const src = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(data);
      });
      image = `<image href="${src}" x="87" y="70" width="226" height="225"/>`;
    } catch (_) { image = '<circle cx="200" cy="177" r="52" fill="none" stroke="#fff" stroke-width="3"/><path d="M148 177h104" stroke="#fff" stroke-width="3"/><circle cx="200" cy="177" r="13" fill="#fff"/>'; }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">
      <defs><linearGradient id="edge" x2="1" y2="1"><stop stop-color="#8cf8e0"/><stop offset=".25" stop-color="#f1bbf5"/><stop offset=".55" stop-color="#fff0a4"/><stop offset="1" stop-color="#86cfff"/></linearGradient>
      <linearGradient id="bg" x2=".9" y2="1"><stop stop-color="${p.night}"/><stop offset="1" stop-color="#151b37"/></linearGradient></defs>
      <rect width="400" height="400" fill="#161b32"/><rect x="78" y="15" width="244" height="342" rx="18" fill="url(#edge)"/>
      <rect x="85" y="22" width="230" height="328" rx="12" fill="url(#bg)"/>
      <circle cx="200" cy="170" r="86" fill="${p.color}" opacity=".24"/><circle cx="200" cy="170" r="97" fill="none" stroke="${p.color}" stroke-opacity=".6"/>
      <g fill="#fff" font-family="sans-serif"><text x="99" y="48" font-size="10">NO. ${dex(p)}</text><text x="300" y="48" text-anchor="end" font-size="10">${p.type}</text>
      ${image}<text x="200" y="302" text-anchor="middle" font-size="23" font-weight="bold">${p.name}</text>
      <text x="200" y="319" text-anchor="middle" font-size="10" letter-spacing="2">${p.english}</text>
      <text x="100" y="339" font-size="7" letter-spacing="1">QUEENS COLLECTION</text><text x="300" y="339" text-anchor="end" font-size="9">✦ HOLO</text></g></svg>`;
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  })());
  return pictures.get(p.id);
}
