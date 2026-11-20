import {
  OVERVIEW,
  PHASES,
  ARCH_SITES,
  SOCIOLOGY_STUDIES,
  SINAI_CANDIDATES,
  CHRONOLOGY_MATRIX,
  ALT_ROUTES,
  REGION_LABELS,
  BIBLIOGRAPHY,
} from './data.js?v=4';
import { DIAGRAMS } from './diagrams.js?v=4';
import { ExodusMapEngine } from './engine.js';

const MODE_LABELS = {
  start: '출발지',
  walk: '🚶 도보 행군',
  sea: '🌊 홍해 도하',
  mountain: '⛰ 산 정상·언약',
  camp: '⛺ 광야 진영',
  river: '🌊 요단강 도하',
};

const state = {
  phaseId: 'all',
  stopId: null,
  is2D: false,
  reliefScale: 1.35,
  showModern: false,
  showRegions: true,
  showArch: true,
  showAlt: false,
  playing: false,
  speedIdx: 0,
  speeds: [1, 2, 0.5],
  researchTab: 'arch',
  archCategory: '전체',
  focusResearchId: null,
};

const dom = {
  shell: document.getElementById('shell'),
  tabs: document.getElementById('tabs'),
  legColors: document.getElementById('legColors'),
  mapStage: document.getElementById('mapStage'),
  labels: document.getElementById('labels'),
  mapEyebrow: document.getElementById('mapEyebrow'),
  mapTitle: document.getElementById('mapTitle'),
  mapMeta: document.getElementById('mapMeta'),
  panel: document.getElementById('panel'),
  panelContent: document.getElementById('panelContent'),

  toolsToggle: document.getElementById('toolsToggle'),
  toolsBar: document.getElementById('toolsBar'),
  fitBtn: document.getElementById('fitBtn'),
  viewBtn: document.getElementById('viewBtn'),
  modernBtn: document.getElementById('modernBtn'),
  regionBtn: document.getElementById('regionBtn'),
  archBtn: document.getElementById('archBtn'),
  altBtn: document.getElementById('altBtn'),

  prevBtn: document.getElementById('prevBtn'),
  playBtn: document.getElementById('playBtn'),
  nextBtn: document.getElementById('nextBtn'),
  track: document.getElementById('track'),
  trackFill: document.getElementById('trackFill'),
  ticks: document.getElementById('ticks'),
  speedBtn: document.getElementById('speedBtn'),

  researchBtn: document.getElementById('researchBtn'),
  pwaBtn: document.getElementById('pwaBtn'),
  sourceBtn: document.getElementById('sourceBtn'),
  helpBtn: document.getElementById('helpBtn'),
  brandLink: document.getElementById('brandLink'),

  researchModal: document.getElementById('researchModal'),
  researchTabs: document.getElementById('researchTabs'),
  researchBody: document.getElementById('researchBody'),
  sourceModal: document.getElementById('sourceModal'),
  helpModal: document.getElementById('helpModal'),
  pwaModal: document.getElementById('pwaModal'),
  pwaInstallRow: document.getElementById('pwaInstallRow'),

  photoLightbox: document.getElementById('photoLightbox'),
  lbCloseBtn: document.getElementById('lbCloseBtn'),
  lbImgWrap: document.getElementById('lbImgWrap'),
  lbImg: document.getElementById('lbImg'),
  lbCaption: document.getElementById('lbCaption'),
  lbCredit: document.getElementById('lbCredit'),
};

let engine = null;
let deferredPrompt = null;

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escRich(str) {
  return esc(str).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
}

function openLightbox(photo) {
  dom.lbImg.src = photo.src;
  dom.lbImg.alt = photo.caption || '';
  dom.lbImgWrap.classList.toggle('lightPlate', Boolean(photo.lightPlate));
  dom.lbCaption.textContent = photo.caption || '';
  dom.lbCredit.textContent = photo.credit ? `출처 · ${photo.credit}` : '';
  if (!dom.photoLightbox.open) dom.photoLightbox.showModal();
}

function renderPhotoGallery(photos, { strip = false } = {}) {
  if (!photos || photos.length === 0) return '';
  const cls = strip ? 'stopPhotoStrip' : `photoGrid ${photos.length > 1 ? 'multi' : ''}`;
  const items = photos
    .map(
      (p) => `
      <figure class="photoFigure">
        <button
          type="button"
          class="photoThumbBtn ${p.lightPlate ? 'lightPlate' : ''}"
          data-zoom-src="${esc(p.src)}"
          data-zoom-cap="${esc(p.caption)}"
          data-zoom-credit="${esc(p.credit || '')}"
          data-zoom-light="${p.lightPlate ? '1' : ''}"
          aria-label="${esc(p.caption)} 크게 보기"
        >
          <img class="photoThumb" src="${esc(p.src)}" alt="${esc(p.caption)}" loading="lazy" />
          <span class="photoZoomPill">🔍 확대</span>
        </button>
        <figcaption class="photoMeta">
          <div class="photoCap">${esc(p.caption)}</div>
          ${!strip && p.credit ? `<div class="photoCredit">${esc(p.credit)}</div>` : ''}
        </figcaption>
      </figure>`
    )
    .join('');
  return `<div class="${cls}">${items}</div>`;
}

function bindPhotoZoomButtons(rootEl) {
  for (const btn of rootEl.querySelectorAll('[data-zoom-src]')) {
    btn.addEventListener('click', () => {
      openLightbox({
        src: btn.dataset.zoomSrc,
        caption: btn.dataset.zoomCap,
        credit: btn.dataset.zoomCredit,
        lightPlate: btn.dataset.zoomLight === '1',
      });
    });
  }
}

function getActivePhase() {
  return PHASES.find((p) => p.id === state.phaseId) || null;
}

function getActiveStopIndex() {
  const phase = getActivePhase();
  if (!phase) return -1;
  return phase.stops.findIndex((s) => s.id === state.stopId);
}

// ── Top Navigation & Legend ───────────────────────────────────────────────────
function buildTabsAndLegend() {
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'tabBtn active';
  allBtn.dataset.phase = 'all';
  allBtn.style.setProperty('--tc', '#e5b96f');
  allBtn.innerHTML = `<span class="dot"></span><span>전체</span>`;
  allBtn.addEventListener('click', () => selectPhase('all'));
  dom.tabs.appendChild(allBtn);

  for (const phase of PHASES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tabBtn';
    btn.dataset.phase = phase.id;
    btn.style.setProperty('--tc', phase.color);
    btn.innerHTML = `<span class="dot"></span><span>${esc(phase.tab)}</span>`;
    btn.addEventListener('click', () => selectPhase(phase.id));
    dom.tabs.appendChild(btn);

    const legItem = document.createElement('span');
    legItem.className = 'legCItem';
    legItem.innerHTML = `<i style="background:${phase.color}"></i><span>${esc(phase.tab)}</span>`;
    dom.legColors.appendChild(legItem);
  }
}

function updateTopUI() {
  const phase = getActivePhase();
  const color = phase ? phase.color : '#e5b96f';
  dom.shell.style.setProperty('--j', color);

  for (const btn of dom.tabs.querySelectorAll('.tabBtn')) {
    btn.classList.toggle('active', btn.dataset.phase === state.phaseId);
  }

  if (!phase) {
    dom.mapEyebrow.textContent = 'EXODUS 1 – JOSHUA 8';
    dom.mapTitle.textContent = '출애굽의 여정';
    dom.mapMeta.textContent = '출애굽기–여호수아 8장 · 실제 3D 지형 위의 고고학·사회학 탐구';
  } else {
    dom.mapEyebrow.textContent = phase.eyebrow;
    dom.mapTitle.textContent = phase.title;
    dom.mapMeta.textContent = `${phase.ref} · ${phase.period}`;
  }
}

// ── Right Study Panel Rendering ───────────────────────────────────────────────
function renderPanel() {
  if (state.phaseId === 'all') {
    renderOverviewPanel();
  } else {
    renderPhasePanel();
  }
  updatePlayerTrack();
}

function renderOverviewPanel() {
  const statsHtml = OVERVIEW.stats
    .map(
      (st) => `
      <div class="statTile">
        <strong>${esc(st.val)}</strong>
        <span>${esc(st.label)}</span>
      </div>`
    )
    .join('');

  const cardsHtml = PHASES.map(
    (p, idx) => `
    <button type="button" class="jCard" data-open-phase="${p.id}" style="--jc:${p.color}">
      <div class="jCardTop">
        <strong>${idx + 1}. ${esc(p.title)}</strong>
        <span>${esc(p.ref)}</span>
      </div>
      <p>${escRich(p.summary)}</p>
      <div class="jCardFoot">
        <span>약 ${p.distKm.toLocaleString()}km</span>
        <span>주요 정차 ${p.stopCount}곳</span>
        <span>관련 발굴 ${p.archCount}건</span>
      </div>
    </button>`
  ).join('');

  dom.panelContent.innerHTML = `
    <div class="eyebrow">${esc(OVERVIEW.eyebrow)}</div>
    <h2 class="pTitle">${esc(OVERVIEW.title)}</h2>
    <div class="pSub">본문 ${esc(OVERVIEW.ref)} · ${esc(OVERVIEW.period)}</div>
    <p class="pSummary">${esc(OVERVIEW.summary)}</p>
    <div class="statGrid">${statsHtml}</div>
    <div class="jCards">${cardsHtml}</div>
    <button type="button" class="archBannerBtn" id="panelOpenArchBtn">
      <div>
        <strong>🏛 고고학 발굴 · 사회학 연구 아카이브 열기</strong>
        <span>14개 발굴·금석문 보고서, 6개 사회학 모델, SVG 도해 및 학술 문헌</span>
      </div>
      <span>→</span>
    </button>
  `;

  for (const el of dom.panelContent.querySelectorAll('[data-open-phase]')) {
    el.addEventListener('click', () => selectPhase(el.dataset.openPhase));
  }
  const banner = document.getElementById('panelOpenArchBtn');
  if (banner) banner.addEventListener('click', () => openResearchModal('arch'));
  dom.panel.scrollTop = 0;
}

function renderPhasePanel() {
  const phase = getActivePhase();
  if (!phase) return;
  const stopIdx = Math.max(0, getActiveStopIndex());
  const stop = phase.stops[stopIdx] || phase.stops[0];

  const linkedArch = (stop.archIds || [])
    .map((id) => ARCH_SITES.find((a) => a.id === id))
    .filter(Boolean);

  const archCards = linkedArch
    .map(
      (a) => `
      <button type="button" class="miniCard" data-open-arch="${a.id}">
        <span class="miniBadge">🏛</span>
        <div>
          <strong>${esc(a.name)}</strong>
          <span>${esc(a.director)} · 클릭하여 발굴 성과·사진 보기</span>
        </div>
      </button>`
    )
    .join('');

  const stopPhotos = [];
  const seenSrc = new Set();
  for (const a of linkedArch) {
    for (const p of a.photos || []) {
      if (!seenSrc.has(p.src) && stopPhotos.length < 2) {
        seenSrc.add(p.src);
        stopPhotos.push(p);
      }
    }
  }
  const stopPhotoHtml = renderPhotoGallery(stopPhotos, { strip: true });

  const socCards = (stop.socIds || [])
    .map((id) => SOCIOLOGY_STUDIES.find((s) => s.id === id))
    .filter(Boolean)
    .map(
      (s) => `
      <button type="button" class="miniCard soc" data-open-soc="${s.id}">
        <span class="miniBadge">📚</span>
        <div>
          <strong>${esc(s.scholar)}</strong>
          <span>${esc(s.lens)} · 클릭하여 연구 보기</span>
        </div>
      </button>`
    )
    .join('');

  const modeStr = MODE_LABELS[stop.mode] || '이동';
  const moveText =
    stop.mode === 'start'
      ? `여정 출발지 (${phase.tab})`
      : `이전 지점에서 약 ${stop.distKm}km · ${modeStr}`;

  const bsUrl = `https://www.bskorea.or.kr/bible/korbibReadpage.php?version=GAE&book=${encodeURIComponent(
    stop.bsBook
  )}&chap=${encodeURIComponent(stop.bsChap)}`;

  const stopRowsHtml = phase.stops
    .map((s) => {
      const isActive = s.id === stop.id;
      const isPass = s.num === null;
      return `
      <button type="button" class="stopRow ${isActive ? 'active' : ''}" data-stop-id="${s.id}">
        <span class="rowNo ${isPass ? 'pass' : ''}">${isPass ? '' : s.num}</span>
        <span class="rowText">
          <strong>${esc(s.name)}</strong>
          <span>${esc(s.title)} · ${esc(s.ref)}</span>
        </span>
      </button>`;
    })
    .join('');

  dom.panelContent.innerHTML = `
    <div class="eyebrow">${esc(phase.eyebrow)}</div>
    <h2 class="pTitle">${esc(phase.title)}</h2>
    <div class="pSub">본문 ${esc(phase.ref)} · ${esc(phase.period)}</div>
    <p class="pSummary">${esc(phase.summary)}</p>

    <div class="statGrid three">
      <div class="statTile"><strong>약 ${phase.distKm}km</strong><span>여정 거리</span></div>
      <div class="statTile"><strong>${phase.stops.length}곳</strong><span>주요·경유지</span></div>
      <div class="statTile"><strong>${phase.archCount}건</strong><span>핵심 발굴</span></div>
    </div>

    <div class="kwCard">
      <div class="kwHead">
        <span>히브리어 원어 한 단어</span>
        <span>${esc(phase.keyword.ref)}</span>
      </div>
      <div class="kwTerm">
        <span class="kwHeb">${esc(phase.keyword.hebrew)}</span>
        <span class="kwTranslit">${esc(phase.keyword.translit)}</span>
        <span class="kwGloss">${esc(phase.keyword.gloss)}</span>
      </div>
      <p class="kwNote">${esc(phase.keyword.note)}</p>
    </div>

    <div class="stopCard" id="stopDetailCard">
      <div class="sHead">
        <span class="sNo ${stop.num === null ? 'pass' : ''}">${stop.num === null ? '•' : stop.num}</span>
        <div>
          <div class="sNameRow">
            <span class="sName">${esc(stop.name)}</span>
            <span class="sHeb">${esc(stop.hebrew)}</span>
            <span class="confPill conf-${esc(stop.confidence)}">${esc(stop.confidence)}</span>
          </div>
          <div class="sModern">${esc(stop.modern)}</div>
        </div>
      </div>

      <div class="sMove">${esc(moveText)}</div>
      <h3 class="sTitle">${esc(stop.title)}</h3>
      <p class="sBody">${esc(stop.body)}</p>

      ${stop.note ? `<div class="sNote">${esc(stop.note)}</div>` : ''}
      ${stopPhotoHtml}
      ${archCards || socCards ? `<div class="miniCards">${archCards}${socCards}</div>` : ''}

      <a class="refLink" href="${bsUrl}" target="_blank" rel="noopener noreferrer">
        📖 ${esc(stop.ref)} 읽기 (개역개정) ↗
      </a>
    </div>

    <div class="stopListHead">
      <span>여정의 장소</span>
      <span>${phase.stops.length}곳</span>
    </div>
    <div class="stopList">${stopRowsHtml}</div>
  `;

  for (const row of dom.panelContent.querySelectorAll('[data-stop-id]')) {
    row.addEventListener('click', () => selectStop(phase.id, row.dataset.stopId, true));
  }
  for (const card of dom.panelContent.querySelectorAll('[data-open-arch]')) {
    card.addEventListener('click', () => openResearchModal('arch', card.dataset.openArch));
  }
  for (const card of dom.panelContent.querySelectorAll('[data-open-soc]')) {
    card.addEventListener('click', () => openResearchModal('soc', card.dataset.openSoc));
  }
  bindPhotoZoomButtons(dom.panelContent);
}

// ── Phase & Stop Navigation ───────────────────────────────────────────────────
function selectPhase(phaseId, targetStopId = null, shouldFly = true) {
  pausePlayback();
  state.phaseId = phaseId;
  if (phaseId === 'all') {
    state.stopId = null;
  } else {
    const phase = PHASES.find((p) => p.id === phaseId);
    state.stopId = targetStopId || phase.stops[0].id;
  }

  updateTopUI();
  renderPanel();
  if (engine) {
    engine.setPhase(state.phaseId, state.stopId, shouldFly);
    if (state.phaseId !== 'all') {
      const idx = Math.max(0, getActiveStopIndex());
      engine.setPlaybackProgress(state.phaseId, engine.getStopProgress(state.phaseId, idx));
    }
  }
}

function selectStop(phaseId, stopId, shouldFly = true) {
  pausePlayback();
  if (state.phaseId !== phaseId) {
    selectPhase(phaseId, stopId, shouldFly);
    return;
  }
  state.stopId = stopId;
  renderPhasePanel();
  updatePlayerTrack();

  if (engine) {
    engine.setStop(phaseId, stopId, shouldFly);
    const idx = Math.max(0, getActiveStopIndex());
    engine.setPlaybackProgress(phaseId, engine.getStopProgress(phaseId, idx));
  }

  const activeRow = dom.panelContent.querySelector(`.stopRow[data-stop-id="${stopId}"]`);
  if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function stepStop(delta) {
  if (state.phaseId === 'all') {
    const first = PHASES[0];
    selectPhase(first.id, first.stops[0].id, true);
    return;
  }
  const phase = getActivePhase();
  if (!phase) return;
  const curIdx = Math.max(0, getActiveStopIndex());
  const nextIdx = curIdx + delta;

  if (nextIdx >= 0 && nextIdx < phase.stops.length) {
    selectStop(phase.id, phase.stops[nextIdx].id, true);
  } else if (nextIdx >= phase.stops.length) {
    const pIdx = PHASES.findIndex((p) => p.id === phase.id);
    if (pIdx < PHASES.length - 1) {
      const np = PHASES[pIdx + 1];
      selectPhase(np.id, np.stops[0].id, true);
    }
  } else if (nextIdx < 0) {
    const pIdx = PHASES.findIndex((p) => p.id === phase.id);
    if (pIdx > 0) {
      const pp = PHASES[pIdx - 1];
      selectPhase(pp.id, pp.stops[pp.stops.length - 1].id, true);
    }
  }
}

// ── Timeline Player ───────────────────────────────────────────────────────────
function updatePlayerTrack() {
  const phase = getActivePhase();
  dom.ticks.innerHTML = '';

  if (!phase || !engine) {
    dom.trackFill.style.width = '0%';
    return;
  }

  const curIdx = Math.max(0, getActiveStopIndex());
  const curFrac = engine.getStopProgress(phase.id, curIdx);
  dom.trackFill.style.width = `${(curFrac * 100).toFixed(1)}%`;

  phase.stops.forEach((s, idx) => {
    const f = engine.getStopProgress(phase.id, idx);
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.className = `tickDot ${s.num === null ? 'pass' : ''} ${idx <= curIdx ? 'passed' : ''} ${
      idx === curIdx ? 'active' : ''
    }`;
    dot.style.left = `${(f * 100).toFixed(2)}%`;
    dot.title = `${s.num ? `${s.num}. ` : ''}${s.name}`;
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      selectStop(phase.id, s.id, true);
    });
    dom.ticks.appendChild(dot);
  });
}

function togglePlayback() {
  if (state.playing) {
    pausePlayback();
    return;
  }
  if (state.phaseId === 'all') {
    selectPhase(PHASES[0].id, PHASES[0].stops[0].id, false);
  }
  const phase = getActivePhase();
  if (!phase || !engine) return;

  state.playing = true;
  dom.playBtn.innerHTML = '❚❚ <span>멈춤</span>';
  const curIdx = Math.max(0, getActiveStopIndex());
  const startFrac = curIdx >= phase.stops.length - 1 ? 0 : engine.getStopProgress(phase.id, curIdx);
  engine.playState.lastStopIdx = -1;
  engine.startPlayback(phase.id, startFrac);
}

function pausePlayback() {
  state.playing = false;
  dom.playBtn.innerHTML = '▶ <span>따라가기</span>';
  if (engine) engine.pausePlayback();
}

function cycleSpeed() {
  state.speedIdx = (state.speedIdx + 1) % state.speeds.length;
  const spd = state.speeds[state.speedIdx];
  dom.speedBtn.textContent = `${spd}×`;
  if (engine) engine.setPlaybackSpeed(spd);
}

// ── Research Archive Modal (4 Tabs + SVG Diagrams) ────────────────────────────
function openResearchModal(tab = 'arch', focusId = null) {
  state.researchTab = tab;
  state.focusResearchId = focusId;
  if (tab === 'arch' && focusId) {
    const site = ARCH_SITES.find((a) => a.id === focusId);
    if (site) state.archCategory = '전체';
  }
  updateResearchTabsUI();
  renderResearchBody();
  if (!dom.researchModal.open) dom.researchModal.showModal();

  if (focusId) {
    requestAnimationFrame(() => {
      const target = dom.researchBody.querySelector(`[data-rcard="${focusId}"]`);
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  } else {
    dom.researchBody.scrollTop = 0;
  }
}

function updateResearchTabsUI() {
  for (const btn of dom.researchTabs.querySelectorAll('.mTab')) {
    btn.classList.toggle('active', btn.dataset.rtab === state.researchTab);
  }
}

function renderDiagramBlock(diagramId) {
  const d = DIAGRAMS[diagramId];
  if (!d) return '';
  return `
    <div class="diagramBox">
      ${d.svg}
      <div class="diagramCap"><strong>도해:</strong> ${esc(d.caption)}</div>
    </div>`;
}

function renderResearchBody() {
  if (state.researchTab === 'arch') {
    const cats = ['전체', '이집트·델타', '시나이·광야', '요단 동편', '가나안·비문'];
    const chips = cats
      .map(
        (c) =>
          `<button type="button" class="fChip ${state.archCategory === c ? 'active' : ''}" data-arch-cat="${c}">${c}</button>`
      )
      .join('');

    const filtered =
      state.archCategory === '전체'
        ? ARCH_SITES
        : ARCH_SITES.filter((s) => s.category === state.archCategory);

    const cards = filtered
      .map((s) => {
        const focused = state.focusResearchId === s.id;

        return `
        <article class="rCard ${focused ? 'focused' : ''}" data-rcard="${s.id}">
          <div class="rCardHead">
            <div>
              <div class="eyebrow">${esc(s.category)} · ${esc(s.years)}</div>
              <h3>${esc(s.name)}</h3>
              <div class="rMeta">책임자: ${esc(s.director)} · 위치: ${esc(s.siteModern)}</div>
              ${s.museum ? `<div class="rMeta">소장처/기관: ${esc(s.museum)}</div>` : ''}
            </div>
            ${
              !s.offMap
                ? `<button type="button" class="flyBtn" data-fly-lat="${s.lat}" data-fly-lon="${s.lon}" data-fly-arch="1">🗺 지도에서 보기</button>`
                : ''
            }
          </div>
          <p class="rSection"><strong>발굴·문헌 성과:</strong> ${escRich(s.summary)}</p>
          <p class="rSection"><strong>출애굽 연구 의의:</strong> ${escRich(s.significance)}</p>
          <p class="rSection"><strong>학계 논점:</strong> ${escRich(s.debate)}</p>
          ${renderPhotoGallery(s.photos)}
          <div class="rCitations">📚 ${s.citations.map((c) => esc(c)).join(' · ')}</div>
        </article>`;
      })
      .join('');

    dom.researchBody.innerHTML = `<div class="filterRow">${chips}</div><div class="rGrid">${cards}</div>`;

    for (const chip of dom.researchBody.querySelectorAll('[data-arch-cat]')) {
      chip.addEventListener('click', () => {
        state.archCategory = chip.dataset.archCat;
        state.focusResearchId = null;
        renderResearchBody();
      });
    }
  } else if (state.researchTab === 'soc') {
    const cards = SOCIOLOGY_STUDIES.map((s) => {
      const focused = state.focusResearchId === s.id;
      return `
      <article class="rCard ${focused ? 'focused' : ''}" data-rcard="${s.id}">
        <div class="eyebrow">${esc(s.lens)}</div>
        <h3>${esc(s.scholar)}</h3>
        <div class="rMeta">대표 저작: <em>${esc(s.work)}</em></div>
        <p class="rSection"><strong>핵심 테제:</strong> ${escRich(s.coreThesis)}</p>
        <p class="rSection"><strong>출애굽 서사의 역할:</strong> ${escRich(s.exodusRole)}</p>
        <p class="rSection"><strong>고고·문헌 근거:</strong> ${escRich(s.evidence)}</p>
        ${renderPhotoGallery(s.photos)}
      </article>`;
    }).join('');
    dom.researchBody.innerHTML = `<div class="rGrid">${cards}</div>`;
  } else if (state.researchTab === 'theories') {
    const sinaiRows = SINAI_CANDIDATES.map(
      (c) => `
      <article class="rCard ${state.focusResearchId === c.id ? 'focused' : ''}" data-rcard="${c.id}">
        <div class="rCardHead">
          <div>
            <div class="eyebrow">${esc(c.region)}</div>
            <h3>${esc(c.name)}</h3>
            <div class="rMeta">주요 지지: ${esc(c.proponents)}</div>
          </div>
          <button type="button" class="flyBtn" data-fly-lat="${c.lat}" data-fly-lon="${c.lon}" data-fly-alt="1">🗺 지도에서 보기</button>
        </div>
        <p class="rSection"><strong>긍정 근거:</strong> ${esc(c.pros)}</p>
        <p class="rSection"><strong>학계 비판·한계:</strong> ${esc(c.cons)}</p>
        ${renderPhotoGallery(c.photos)}
      </article>`
    ).join('');

    const chronRows = CHRONOLOGY_MATRIX.map(
      (m) => `
      <tr>
        <td><strong>${esc(m.model)}</strong><br/><small>${esc(m.pharaoh)}</small></td>
        <td>${esc(m.basis)}</td>
        <td>${esc(m.pros)}</td>
        <td>${esc(m.challenges)}</td>
      </tr>`
    ).join('');

    dom.researchBody.innerHTML = `
      <div class="prose">
        <h3>1. 출애굽 연대기 3대 학설 비교</h3>
      </div>
      ${renderDiagramBlock('chronology')}
      <div class="tableScroll">
        <table class="compTable">
          <thead>
            <tr>
              <th>학설 · 해당 파라오</th>
              <th>성경·역사 근거</th>
              <th>강점 (부합점)</th>
              <th>난점 · 반론</th>
            </tr>
          </thead>
          <tbody>${chronRows}</tbody>
        </table>
      </div>
      <div class="prose" style="margin-top:16px;">
        <h3>2. 시내산 4대 후보지 비교</h3>
      </div>
      <div class="rGrid">${sinaiRows}</div>
    `;
  } else if (state.researchTab === 'bib') {
    const items = BIBLIOGRAPHY.map(
      (b) => `<div class="bibItem"><span class="bibCat">${esc(b.cat)}</span> ${esc(b.ref)}</div>`
    ).join('');
    dom.researchBody.innerHTML = `
      <div class="prose">
        <h3>학제간 참고 문헌 및 주요 논문 (16선)</h3>
        <p>고고학·이집트학·금석학·사회학·문화기억 연구를 포괄하는 현대 학계의 주요 저작과 학술 논문 목록입니다.</p>
      </div>
      <div>${items}</div>
    `;
  }

  for (const btn of dom.researchBody.querySelectorAll('[data-fly-lat]')) {
    btn.addEventListener('click', () => {
      const lat = parseFloat(btn.dataset.flyLat);
      const lon = parseFloat(btn.dataset.flyLon);
      if (btn.dataset.flyArch && !state.showArch) {
        state.showArch = true;
        dom.archBtn.classList.add('active');
        engine.setToggles({ showArch: true });
      }
      if (btn.dataset.flyAlt && !state.showAlt) {
        state.showAlt = true;
        dom.altBtn.classList.add('active');
        engine.setToggles({ showAlt: true });
      }
      dom.researchModal.close();
      engine.focusCoord(lat, lon, 4.9);
    });
  }
  bindPhotoZoomButtons(dom.researchBody);
}

// ── Event Bindings ────────────────────────────────────────────────────────────
function bindEvents() {
  dom.brandLink.addEventListener('click', (e) => {
    e.preventDefault();
    selectPhase('all');
  });

  dom.fitBtn.addEventListener('click', () => {
    if (!engine) return;
    if (state.phaseId === 'all') engine.fitOverview(true);
    else engine.fitPhase(state.phaseId, true);
  });

  dom.viewBtn.addEventListener('click', () => {
    state.is2D = !state.is2D;
    dom.viewBtn.classList.toggle('active', state.is2D);
    dom.viewBtn.textContent = state.is2D ? '3D' : '2D';
    if (engine) engine.set2D(state.is2D);
  });

  for (const sBtn of document.querySelectorAll('.sBtn')) {
    sBtn.addEventListener('click', () => {
      for (const b of document.querySelectorAll('.sBtn')) b.classList.remove('active');
      sBtn.classList.add('active');
      state.reliefScale = parseFloat(sBtn.dataset.scale);
      if (engine) engine.setReliefScale(state.reliefScale);
    });
  }

  dom.modernBtn.addEventListener('click', () => {
    state.showModern = !state.showModern;
    dom.modernBtn.classList.toggle('active', state.showModern);
    if (engine) engine.setToggles({ showModern: state.showModern });
  });

  dom.regionBtn.addEventListener('click', () => {
    state.showRegions = !state.showRegions;
    dom.regionBtn.classList.toggle('active', state.showRegions);
    if (engine) engine.setToggles({ showRegions: state.showRegions });
  });

  dom.archBtn.addEventListener('click', () => {
    state.showArch = !state.showArch;
    dom.archBtn.classList.toggle('active', state.showArch);
    if (engine) engine.setToggles({ showArch: state.showArch });
  });

  dom.altBtn.addEventListener('click', () => {
    state.showAlt = !state.showAlt;
    dom.altBtn.classList.toggle('active', state.showAlt);
    if (engine) engine.setToggles({ showAlt: state.showAlt });
  });

  dom.toolsToggle.addEventListener('click', () => {
    const open = dom.toolsBar.classList.toggle('open');
    dom.toolsToggle.setAttribute('aria-expanded', String(open));
  });

  dom.prevBtn.addEventListener('click', () => stepStop(-1));
  dom.nextBtn.addEventListener('click', () => stepStop(1));
  dom.playBtn.addEventListener('click', togglePlayback);
  dom.speedBtn.addEventListener('click', cycleSpeed);

  dom.track.addEventListener('click', (e) => {
    if (state.phaseId === 'all' || !engine) return;
    const rect = dom.track.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const phase = getActivePhase();
    let closestIdx = 0;
    let bestDiff = Infinity;
    phase.stops.forEach((_, idx) => {
      const f = engine.getStopProgress(phase.id, idx);
      const diff = Math.abs(f - frac);
      if (diff < bestDiff) {
        bestDiff = diff;
        closestIdx = idx;
      }
    });
    selectStop(phase.id, phase.stops[closestIdx].id, true);
  });

  dom.researchBtn.addEventListener('click', () => openResearchModal('arch'));
  dom.sourceBtn.addEventListener('click', () => dom.sourceModal.showModal());
  dom.helpBtn.addEventListener('click', () => dom.helpModal.showModal());
  dom.pwaBtn.addEventListener('click', () => dom.pwaModal.showModal());

  for (const tabBtn of dom.researchTabs.querySelectorAll('.mTab')) {
    tabBtn.addEventListener('click', () => {
      state.researchTab = tabBtn.dataset.rtab;
      state.focusResearchId = null;
      updateResearchTabsUI();
      renderResearchBody();
      dom.researchBody.scrollTop = 0;
    });
  }

  for (const closeBtn of document.querySelectorAll('[data-close]')) {
    closeBtn.addEventListener('click', () => {
      const dlg = document.getElementById(closeBtn.dataset.close);
      if (dlg) dlg.close();
    });
  }

  for (const dlg of document.querySelectorAll('dialog.modal, dialog.lightbox')) {
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
  }

  dom.lbCloseBtn.addEventListener('click', () => dom.photoLightbox.close());

  window.addEventListener('keydown', (e) => {
    const anyModalOpen = Array.from(document.querySelectorAll('dialog.modal, dialog.lightbox')).some((d) => d.open);
    if (anyModalOpen) return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlayback();
    } else if (e.code === 'ArrowRight') {
      e.preventDefault();
      stepStop(1);
    } else if (e.code === 'ArrowLeft') {
      e.preventDefault();
      stepStop(-1);
    }
  });

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    dom.pwaInstallRow.innerHTML = `<button type="button" class="pMain" id="triggerPwaInstall">지금 앱 설치하기</button>`;
    const btn = document.getElementById('triggerPwaInstall');
    if (btn) {
      btn.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        dom.pwaModal.close();
      });
    }
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  buildTabsAndLegend();
  bindEvents();
  updateTopUI();
  renderPanel();

  engine = new ExodusMapEngine(dom.mapStage, dom.labels, {
    onStopClick: (phaseId, stopId) => selectStop(phaseId, stopId, true),
    onArchClick: (archId) => openResearchModal('arch', archId),
    onAltCandClick: (candId) => openResearchModal('theories', candId),
    onPlaybackStop: (phaseId, stopIdx, progress) => {
      const phase = PHASES.find((p) => p.id === phaseId);
      if (!phase || !phase.stops[stopIdx]) return;
      state.stopId = phase.stops[stopIdx].id;
      engine.setStop(phaseId, state.stopId, false);
      renderPhasePanel();
      updatePlayerTrack();
      dom.trackFill.style.width = `${(progress * 100).toFixed(1)}%`;
      const activeRow = dom.panelContent.querySelector(`.stopRow[data-stop-id="${state.stopId}"]`);
      if (activeRow) activeRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    onPlaybackTick: (progress) => {
      dom.trackFill.style.width = `${(progress * 100).toFixed(1)}%`;
    },
    onPlaybackEnd: () => {
      pausePlayback();
      dom.trackFill.style.width = '100%';
    },
  });

  await engine.init({
    phases: PHASES,
    archSites: ARCH_SITES,
    regionLabels: REGION_LABELS,
    altRoutes: ALT_ROUTES,
    sinaiCandidates: SINAI_CANDIDATES,
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot().catch((err) => {
  console.error('Exodus app failed to start:', err);
  dom.panelContent.innerHTML = `<div class="sNote">지형 데이터를 불러오는 중 오류가 발생했습니다: ${esc(err.message)}</div>`;
});
