// Clean data-driven chronology timeline SVG (artifact diagrams replaced by authentic museum & excavation photographs)

export const DIAGRAMS = {
  chronology: {
    title: '출애굽 연대기 · 이집트 왕조 · 핵심 고고학 금석문 타임라인 (1800–800 BC)',
    caption: '이집트 문헌, 초기/후기 연대설, 그리고 가나안 산악지대 철기 I기 촌락 폭발 시점을 한눈에 대조합니다.',
    svg: `<svg viewBox="0 0 640 250" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="출애굽 연대기 타임라인">
      <rect width="640" height="250" rx="10" fill="#0d1917" stroke="rgba(229,185,111,0.28)"/>
      <text x="22" y="28" fill="#e5b96f" font-size="13" font-weight="700">CHRONOLOGY &amp; STRATIGRAPHY — 1800 BC ~ 800 BC 이집트·가나안 비교 연표</text>

      <!-- Timeline Axis -->
      <line x1="36" y1="126" x2="604" y2="126" stroke="#e5b96f" stroke-width="2"/>
      <g fill="#b7c8c3" font-size="10.5" text-anchor="middle">
        <line x1="40" y1="120" x2="40" y2="132" stroke="#e5b96f"/><text x="40" y="146">1800 BC</text>
        <line x1="152" y1="120" x2="152" y2="132" stroke="#e5b96f"/><text x="152" y="146">1600 BC</text>
        <line x1="264" y1="120" x2="264" y2="132" stroke="#e5b96f"/><text x="264" y="146">1400 BC</text>
        <line x1="376" y1="120" x2="376" y2="132" stroke="#e5b96f"/><text x="376" y="146">1200 BC</text>
        <line x1="488" y1="120" x2="488" y2="132" stroke="#e5b96f"/><text x="488" y="146">1000 BC</text>
        <line x1="600" y1="120" x2="600" y2="132" stroke="#e5b96f"/><text x="600" y="146">800 BC</text>
      </g>

      <!-- Top Row: Historical / Archaeological Anchors -->
      <g font-size="10">
        <rect x="44" y="48" width="96" height="36" rx="5" fill="#172b26" stroke="#d9a44c"/>
        <text x="92" y="64" text-anchor="middle" fill="#ffd99a" font-weight="700">브루클린 파피루스</text>
        <text x="92" y="77" text-anchor="middle" fill="#b7c8c3">아바리스 셈족 정착</text>
        <line x1="92" y1="84" x2="92" y2="126" stroke="#d9a44c" stroke-dasharray="2 2"/>

        <rect x="148" y="48" width="84" height="36" rx="5" fill="#172b26" stroke="#9fb8b3"/>
        <text x="190" y="64" text-anchor="middle" fill="#f2ebd9" font-weight="700">여리고 MB 파괴</text>
        <text x="190" y="77" text-anchor="middle" fill="#b7c8c3">c.1550 힉소스 추방</text>
        <line x1="180" y1="84" x2="180" y2="126" stroke="#9fb8b3" stroke-dasharray="2 2"/>

        <rect x="240" y="48" width="94" height="36" rx="5" fill="#172b26" stroke="#63c5da"/>
        <text x="287" y="64" text-anchor="middle" fill="#9de8fa" font-weight="700">솔렙 신전 비문</text>
        <text x="287" y="77" text-anchor="middle" fill="#b7c8c3">yhw3 (c.1380)</text>
        <line x1="275" y1="84" x2="275" y2="126" stroke="#63c5da" stroke-dasharray="2 2"/>

        <rect x="342" y="48" width="110" height="36" rx="5" fill="#231c18" stroke="#df5f3c"/>
        <text x="397" y="64" text-anchor="middle" fill="#ffad92" font-weight="700">메르넵타 석비 (1208)</text>
        <text x="397" y="77" text-anchor="middle" fill="#f2ebd9">산악지대 4실 가옥 급증</text>
        <line x1="371" y1="84" x2="371" y2="126" stroke="#df5f3c" stroke-dasharray="2 2"/>

        <rect x="460" y="48" width="146" height="36" rx="5" fill="#172b26" stroke="#9c6ee0"/>
        <text x="533" y="64" text-anchor="middle" fill="#d2b6ff" font-size="9.5" font-weight="700">팀나 · 가데스 · 메사 · 발람</text>
        <text x="533" y="77" text-anchor="middle" fill="#b7c8c3" font-size="9.5">철기 구리·요새·비문(9–8C)</text>
        <line x1="572" y1="84" x2="572" y2="126" stroke="#9c6ee0" stroke-dasharray="2 2"/>
      </g>

      <!-- Bottom Row: Biblical Chronology Debates -->
      <rect x="218" y="162" width="66" height="44" rx="6" fill="rgba(61,143,224,0.22)" stroke="#3d8fe0"/>
      <text x="251" y="180" text-anchor="middle" fill="#90c8ff" font-size="10.5" font-weight="700">초기 연대설</text>
      <text x="251" y="196" text-anchor="middle" fill="#f2ebd9" font-size="10">c. 1446 BC</text>

      <rect x="320" y="162" width="76" height="44" rx="6" fill="rgba(223,95,60,0.24)" stroke="#df5f3c"/>
      <text x="358" y="180" text-anchor="middle" fill="#ffaa8f" font-size="10.5" font-weight="700">후기 연대설</text>
      <text x="358" y="196" text-anchor="middle" fill="#f2ebd9" font-size="10">c. 1270–1250</text>

      <rect x="404" y="162" width="194" height="44" rx="6" fill="rgba(53,168,122,0.18)" stroke="#35a87a"/>
      <text x="501" y="180" text-anchor="middle" fill="#82e8bf" font-size="10.5" font-weight="700">민족형성 · 문화기억 종합 모델</text>
      <text x="501" y="196" text-anchor="middle" fill="#cddad5" font-size="10">13–12C 산악 정착 + 소수 탈출 기억 융합</text>

      <text x="36" y="232" fill="#9fb8b3" font-size="10.5">※ 람세스 2세 치세(1279–1213 BC): 피-람세스(칸티르) 건설과 메르넵타 석비 사이의 13세기 맥락이 다수 학설의 교차점</text>
    </svg>`,
  },
};
