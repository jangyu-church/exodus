import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const ELEV_SCALE_BASE = 0.00105; // meters -> world units at reliefScale=1

export class ExodusMapEngine {
  constructor(container, labelsRoot, callbacks) {
    this.container = container;
    this.labelsRoot = labelsRoot;
    this.callbacks = callbacks || {};

    this.meta = null;
    this.heightData = null;
    this.maskData = null;

    this.reliefScale = 1.35;
    this.targetReliefScale = 1.35;
    this.is2D = false;

    this.showModern = false;
    this.showRegions = true;
    this.showArch = true;
    this.showAlt = false;

    this.activePhaseId = 'all';
    this.activeStopId = null;

    this.phases = [];
    this.archSites = [];
    this.regionLabels = [];
    this.altRoutes = [];
    this.sinaiCandidates = [];

    this.phaseLineObjects = new Map();
    this.altLineObjects = [];
    this.lineMaterials = [];
    this.landmarkGroups = [];

    this.stopLabels = [];
    this.regionLabelEls = [];
    this.archLabelEls = [];
    this.altLabelEls = [];

    this.camAnim = null;
    this.playState = {
      playing: false,
      phaseId: null,
      progress: 0,
      speed: 1,
      lastStopIdx: -1,
    };

    this._clock = new THREE.Clock();
    this._v3 = new THREE.Vector3();
    this._dirtyMesh = false;
  }

  async init({ phases, archSites, regionLabels, altRoutes, sinaiCandidates }) {
    this.phases = phases;
    this.archSites = archSites;
    this.regionLabels = regionLabels;
    this.altRoutes = altRoutes;
    this.sinaiCandidates = sinaiCandidates;

    const [metaRes, heightRes, maskImg, reliefTex] = await Promise.all([
      fetch('./data/meta.json').then((r) => r.json()),
      fetch('./data/height.bin').then((r) => r.arrayBuffer()),
      this._loadImage('./data/seamask.png'),
      this._loadTexture('./data/relief.jpg'),
    ]);

    this.meta = metaRes;
    this.heightData = new Int16Array(heightRes);
    this.maskData = this._extractMaskPixels(maskImg);

    this._setupScene(reliefTex);
    this._buildTerrainMesh(reliefTex);
    this._buildBasePlinth();
    this._buildRoutes();
    this._buildAltRoutes();
    this._buildBeacon();
    this._buildAvatar();
    this._buildLandmarks();
    this._buildOverlayLabels();

    this._bindResize();
    this.fitOverview(false);
    this._animate();
  }

  _loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  _loadTexture(url) {
    return new Promise((resolve, reject) => {
      const loader = new THREE.TextureLoader();
      loader.load(url, resolve, undefined, reject);
    });
  }

  _extractMaskPixels(img) {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return ctx.getImageData(0, 0, img.width, img.height).data;
  }

  _mercY(lat) {
    const rad = (lat * Math.PI) / 180;
    return Math.log(Math.tan(Math.PI / 4 + rad / 2));
  }

  latLonToUV(lat, lon) {
    const u = (lon - this.meta.west) / (this.meta.east - this.meta.west);
    const v =
      (this.meta.mercYNorth - this._mercY(lat)) /
      (this.meta.mercYNorth - this.meta.mercYSouth);
    return { u, v };
  }

  latLonToXZ(lat, lon) {
    const { u, v } = this.latLonToUV(lat, lon);
    return {
      x: (u - 0.5) * this.meta.worldW,
      z: (v - 0.5) * this.meta.worldH,
    };
  }

  sampleTerrainAtUV(u, v) {
    const gw = this.meta.gridW;
    const gh = this.meta.gridH;
    const fx = Math.max(0, Math.min(1, u)) * (gw - 1);
    const fy = Math.max(0, Math.min(1, v)) * (gh - 1);
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(gw - 1, x0 + 1);
    const y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;

    const e00 = this.heightData[y0 * gw + x0];
    const e10 = this.heightData[y0 * gw + x1];
    const e01 = this.heightData[y1 * gw + x0];
    const e11 = this.heightData[y1 * gw + x1];
    const meters = (e00 + (e10 - e00) * tx) * (1 - ty) + (e01 + (e11 - e01) * tx) * ty;

    const nx = Math.round(fx);
    const ny = Math.round(fy);
    const mIdx = (ny * gw + nx) * 4;
    const isOcean = this.maskData[mIdx] > 128;
    const isLake = this.maskData[mIdx + 1] > 128;

    return { meters, isOcean, isLake };
  }

  getSurfaceY(lat, lon, scaleOverride = null) {
    const { u, v } = this.latLonToUV(lat, lon);
    const { meters, isOcean } = this.sampleTerrainAtUV(u, v);
    const sc = scaleOverride ?? this.reliefScale;
    if (isOcean) return 0;
    return Math.max(-550, meters) * ELEV_SCALE_BASE * sc;
  }

  _setupScene(reliefTex) {
    const w = this.container.clientWidth || 1000;
    const h = this.container.clientHeight || 700;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0c1715);
    this.scene.fog = new THREE.FogExp2(0x0c1715, 0.011);

    this.camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 140);
    this.camera.position.set(0, 18.5, 16.5);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.container.insertBefore(this.renderer.domElement, this.labelsRoot);

    reliefTex.colorSpace = THREE.SRGBColorSpace;
    reliefTex.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xfff1dc, 0x1a302d, 0.72);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xffe8c6, 1.35);
    sun.position.set(-14, 18, -12);
    this.scene.add(sun);

    const fill = new THREE.DirectionalLight(0x8bc2d4, 0.35);
    fill.position.set(14, 9, 14);
    this.scene.add(fill);

    this.controls = new MapControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.075;
    this.controls.maxPolarAngle = Math.PI * 0.43;
    this.controls.minPolarAngle = 0.03;
    this.controls.minDistance = 2.6;
    this.controls.maxDistance = 38;
    this.controls.panSpeed = 0.85;
    this.controls.rotateSpeed = 0.65;
    this.controls.zoomSpeed = 0.9;
  }

  _buildTerrainMesh(reliefTex) {
    const segX = 320;
    const segY = 300;
    const geom = new THREE.PlaneGeometry(this.meta.worldW, this.meta.worldH, segX, segY);
    geom.rotateX(-Math.PI / 2);

    const pos = geom.attributes.position;
    const uvAttr = geom.attributes.uv;
    this._vertexSamples = new Float32Array(pos.count);
    this._vertexOcean = new Uint8Array(pos.count);

    for (let i = 0; i < pos.count; i++) {
      const u = uvAttr.getX(i);
      const v = 1 - uvAttr.getY(i);
      const { meters, isOcean } = this.sampleTerrainAtUV(u, v);
      this._vertexSamples[i] = Math.max(-550, meters);
      this._vertexOcean[i] = isOcean ? 1 : 0;
    }

    const mat = new THREE.MeshStandardMaterial({
      map: reliefTex,
      roughness: 0.84,
      metalness: 0.05,
    });

    this.terrainMesh = new THREE.Mesh(geom, mat);
    this.scene.add(this.terrainMesh);
    this._applyTerrainHeights(true);
  }

  _applyTerrainHeights(recomputeNormals = false) {
    const pos = this.terrainMesh.geometry.attributes.position;
    const sc = this.reliefScale * ELEV_SCALE_BASE;
    for (let i = 0; i < pos.count; i++) {
      const y = this._vertexOcean[i] ? 0 : this._vertexSamples[i] * sc;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
    if (recomputeNormals) {
      this.terrainMesh.geometry.computeVertexNormals();
    }
  }

  _buildBasePlinth() {
    const plinthGeom = new THREE.BoxGeometry(this.meta.worldW + 0.06, 0.9, this.meta.worldH + 0.06);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x0b1614,
      roughness: 0.95,
      metalness: 0.05,
    });
    const plinth = new THREE.Mesh(plinthGeom, plinthMat);
    plinth.position.y = -0.78;
    this.scene.add(plinth);
  }

  _subdivideLatLonPath(points, subSteps = 10) {
    const out = [];
    for (let i = 0; i < points.length - 1; i++) {
      const [lat0, lon0] = points[i];
      const [lat1, lon1] = points[i + 1];
      for (let s = 0; s < subSteps; s++) {
        const t = s / subSteps;
        out.push([lat0 + (lat1 - lat0) * t, lon0 + (lon1 - lon0) * t]);
      }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  _buildPhaseLinePositions(densePoints, extraHeight = 0.055) {
    const coords = [];
    for (const [lat, lon] of densePoints) {
      const { x, z } = this.latLonToXZ(lat, lon);
      const y = this.getSurfaceY(lat, lon) + extraHeight;
      coords.push(x, y, z);
    }
    return coords;
  }

  _buildRoutes() {
    const w = this.container.clientWidth || 1000;
    const h = this.container.clientHeight || 700;

    for (const phase of this.phases) {
      const dense = this._subdivideLatLonPath(phase.waypoints, 12);
      const coords = this._buildPhaseLinePositions(dense, 0.055);

      const geom = new LineGeometry();
      geom.setPositions(coords);

      const mat = new LineMaterial({
        color: new THREE.Color(phase.color).getHex(),
        linewidth: 3.4,
        transparent: true,
        opacity: 0.92,
        depthTest: true,
        resolution: new THREE.Vector2(w, h),
      });
      this.lineMaterials.push(mat);

      const line = new Line2(geom, mat);
      line.computeLineDistances();
      line.renderOrder = 4;
      this.scene.add(line);

      // Compute stop progress fractions along dense path for playback
      const cumDist = [0];
      for (let i = 1; i < dense.length; i++) {
        const p0 = this.latLonToXZ(dense[i - 1][0], dense[i - 1][1]);
        const p1 = this.latLonToXZ(dense[i][0], dense[i][1]);
        cumDist.push(cumDist[i - 1] + Math.hypot(p1.x - p0.x, p1.z - p0.z));
      }
      const totalLen = cumDist[cumDist.length - 1] || 1;
      const denseFracs = cumDist.map((d) => d / totalLen);

      const stopFracs = [];
      let minIdxSearch = 0;
      for (const stop of phase.stops) {
        const sXZ = this.latLonToXZ(stop.lat, stop.lon);
        let bestIdx = minIdxSearch;
        let bestDist = Infinity;
        for (let k = minIdxSearch; k < dense.length; k++) {
          const dXZ = this.latLonToXZ(dense[k][0], dense[k][1]);
          const dist = Math.hypot(dXZ.x - sXZ.x, dXZ.z - sXZ.z);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = k;
          }
        }
        minIdxSearch = bestIdx;
        stopFracs.push(denseFracs[bestIdx]);
      }

      this.phaseLineObjects.set(phase.id, {
        phase,
        dense,
        denseFracs,
        stopFracs,
        line,
        mat,
      });
    }
  }

  _buildAltRoutes() {
    const w = this.container.clientWidth || 1000;
    const h = this.container.clientHeight || 700;

    for (const alt of this.altRoutes) {
      const dense = this._subdivideLatLonPath(alt.points, 10);
      const coords = this._buildPhaseLinePositions(dense, 0.068);
      const geom = new LineGeometry();
      geom.setPositions(coords);

      const mat = new LineMaterial({
        color: new THREE.Color(alt.color).getHex(),
        linewidth: 2.6,
        dashed: true,
        dashScale: 1,
        dashSize: 0.24,
        gapSize: 0.14,
        transparent: true,
        opacity: 0.9,
        resolution: new THREE.Vector2(w, h),
      });
      this.lineMaterials.push(mat);

      const line = new Line2(geom, mat);
      line.computeLineDistances();
      line.visible = this.showAlt;
      line.renderOrder = 5;
      this.scene.add(line);

      this.altLineObjects.push({ alt, dense, line, mat });
    }
  }

  _updateAllRouteElevations() {
    for (const obj of this.phaseLineObjects.values()) {
      const coords = this._buildPhaseLinePositions(obj.dense, 0.055);
      obj.line.geometry.setPositions(coords);
      obj.line.computeLineDistances();
    }
    for (const obj of this.altLineObjects) {
      const coords = this._buildPhaseLinePositions(obj.dense, 0.068);
      obj.line.geometry.setPositions(coords);
      obj.line.computeLineDistances();
    }
    for (const lm of this.landmarkGroups) {
      lm.group.position.y = this.getSurfaceY(lm.lat, lm.lon) + 0.01;
    }
    if (this.activeStopMeta) {
      const { lat, lon } = this.activeStopMeta;
      this.beaconGroup.position.y = this.getSurfaceY(lat, lon) + 0.02;
    }
  }

  _buildBeacon() {
    this.beaconGroup = new THREE.Group();
    this.beaconGroup.visible = false;

    const beamTex = this._makeBeamTexture();
    const beamGeom = new THREE.CylinderGeometry(0.035, 0.15, 2.3, 20, 1, true);
    beamGeom.translate(0, 1.15, 0);
    const beamMat = new THREE.MeshBasicMaterial({
      map: beamTex,
      color: 0xffd27a,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.beaconBeam = new THREE.Mesh(beamGeom, beamMat);
    this.beaconGroup.add(this.beaconBeam);

    const ringGeom = new THREE.RingGeometry(0.11, 0.17, 32);
    ringGeom.rotateX(-Math.PI / 2);
    this.beaconRingMat = new THREE.MeshBasicMaterial({
      color: 0xffe4a0,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.beaconRing = new THREE.Mesh(ringGeom, this.beaconRingMat);
    this.beaconRing.position.y = 0.03;
    this.beaconGroup.add(this.beaconRing);

    const orbGeom = new THREE.SphereGeometry(0.06, 16, 16);
    this.beaconOrbMat = new THREE.MeshBasicMaterial({ color: 0xfff3c4 });
    const orb = new THREE.Mesh(orbGeom, this.beaconOrbMat);
    orb.position.y = 0.08;
    this.beaconGroup.add(orb);

    this.scene.add(this.beaconGroup);
  }

  _makeBeamTexture() {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 128;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 128, 0, 0);
    grad.addColorStop(0.0, 'rgba(255,255,255,1.0)');
    grad.addColorStop(0.28, 'rgba(255,230,170,0.65)');
    grad.addColorStop(1.0, 'rgba(255,210,120,0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 16, 128);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }

  _buildAvatar() {
    this.avatarGroup = new THREE.Group();
    this.avatarGroup.visible = false;

    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xf4c76b,
      emissive: 0x704810,
      metalness: 0.7,
      roughness: 0.25,
    });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x5c3a1f, roughness: 0.8 });

    // Stylized Ark / Caravan emblem
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.1), goldMat);
    box.position.y = 0.08;
    const poleL = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.28, 8), baseMat);
    poleL.rotation.z = Math.PI / 2;
    poleL.position.set(0, 0.05, 0.06);
    const poleR = poleL.clone();
    poleR.position.z = -0.06;

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffd67a,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      })
    );
    halo.position.y = 0.09;

    this.avatarGroup.add(box, poleL, poleR, halo);
    this.scene.add(this.avatarGroup);
  }

  _buildLandmarks() {
    const stoneMat = new THREE.MeshStandardMaterial({ color: 0xc9b48d, roughness: 0.88 });
    const brickMat = new THREE.MeshStandardMaterial({ color: 0xb88c58, roughness: 0.9 });
    const tentMat = new THREE.MeshStandardMaterial({ color: 0xd99b52, roughness: 0.75 });
    const palmMat = new THREE.MeshStandardMaterial({ color: 0x528246, roughness: 0.8 });
    const goldMat = new THREE.MeshStandardMaterial({
      color: 0xefc063,
      emissive: 0x5e3c09,
      roughness: 0.35,
    });

    const placed = new Set();
    for (const phase of this.phases) {
      for (const stop of phase.stops) {
        if (!stop.landmark) continue;
        const key = `${stop.lat.toFixed(2)},${stop.lon.toFixed(2)}`;
        if (placed.has(key)) continue;
        placed.add(key);

        const g = new THREE.Group();
        const { x, z } = this.latLonToXZ(stop.lat, stop.lon);
        const y = this.getSurfaceY(stop.lat, stop.lon) + 0.01;
        g.position.set(x, y, z);

        if (stop.landmark === 'city') {
          const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.15), brickMat);
          b1.position.set(0, 0.04, 0);
          const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.08), stoneMat);
          b2.position.set(0.06, 0.065, -0.04);
          g.add(b1, b2);
        } else if (stop.landmark === 'fort') {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.16), brickMat);
          wall.position.y = 0.035;
          const t1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.11, 0.05), stoneMat);
          t1.position.set(-0.06, 0.055, -0.06);
          const t2 = t1.clone();
          t2.position.set(0.06, 0.055, 0.06);
          g.add(wall, t1, t2);
        } else if (stop.landmark === 'mountain') {
          const pillar = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.19, 5), goldMat);
          pillar.position.y = 0.095;
          g.add(pillar);
        } else if (stop.landmark === 'tabernacle') {
          const tent = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.11, 4), tentMat);
          tent.rotation.y = Math.PI / 4;
          tent.position.y = 0.055;
          const court = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.025, 0.16), stoneMat);
          court.position.y = 0.012;
          g.add(court, tent);
        } else if (stop.landmark === 'oasis') {
          for (let k = 0; k < 2; k++) {
            const crown = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.07, 6), palmMat);
            crown.position.set(k * 0.07 - 0.035, 0.07, k * 0.03);
            g.add(crown);
          }
        } else if (stop.landmark === 'altar') {
          const altar = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.11), stoneMat);
          altar.position.y = 0.03;
          g.add(altar);
        }

        this.scene.add(g);
        this.landmarkGroups.push({ group: g, lat: stop.lat, lon: stop.lon });
      }
    }
  }

  _buildOverlayLabels() {
    this.labelsRoot.innerHTML = '';

    // 1) Region & sea labels
    this.regionLabelEls = this.regionLabels.map((reg) => {
      const el = document.createElement('div');
      el.className = `lb ${reg.kind === 'sea' ? 'sea' : 'region'}`;
      el.textContent = reg.name;
      this.labelsRoot.appendChild(el);
      return { el, lat: reg.lat, lon: reg.lon, kind: reg.kind };
    });

    // 2) Archaeological site pins (in-bounds)
    this.archLabelEls = this.archSites
      .filter((s) => !s.offMap)
      .map((site) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'lb arch';
        el.innerHTML = `<span class="archIcon">🏛</span><span class="archTxt">${site.name.split('(')[0].trim()}</span>`;
        el.title = `${site.name} — 클릭하여 발굴 보고서 보기`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.callbacks.onArchClick) this.callbacks.onArchClick(site.id);
        });
        this.labelsRoot.appendChild(el);
        return { el, site };
      });

    // 3) Alternative Mount Sinai Candidate markers
    this.altLabelEls = this.sinaiCandidates
      .filter((c) => c.id !== 'jebel-musa')
      .map((cand) => {
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'lb altCand';
        el.innerHTML = `<span class="candDot"></span><span>${cand.name.split('(')[0].trim()} (후보)</span>`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.callbacks.onAltCandClick) this.callbacks.onAltCandClick(cand.id);
        });
        this.labelsRoot.appendChild(el);
        return { el, cand };
      });

    // 4) Stop pins (will refresh dynamically per active phase)
    this._rebuildStopLabels();
  }

  _rebuildStopLabels() {
    for (const item of this.stopLabels) item.el.remove();
    this.stopLabels = [];

    if (this.activePhaseId === 'all') {
      // Show curated anchor landmarks across all 5 phases without crowding
      const overviewAnchors = [
        { phaseId: 'calling', stopId: 'ramesses-build', label: '라암셋 · 고센' },
        { phaseId: 'exodus', stopId: 'yam-suph', label: '얌 수프 (갈대 바다)' },
        { phaseId: 'sinai', stopId: 'mt-sinai', label: '시내산 · 호렙' },
        { phaseId: 'wilderness', stopId: 'kadesh-1', label: '가데스 바네아' },
        { phaseId: 'wilderness', stopId: 'ezion-geber', label: '에시온게벨' },
        { phaseId: 'canaan', stopId: 'mt-nebo', label: '느보산' },
        { phaseId: 'canaan', stopId: 'jericho', label: '여리고' },
        { phaseId: 'canaan', stopId: 'mt-ebal', label: '에발산 · 세겜' },
      ];
      for (const item of overviewAnchors) {
        const phase = this.phases.find((p) => p.id === item.phaseId);
        const stop = phase.stops.find((s) => s.id === item.stopId);
        if (!stop) continue;

        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'lb city overviewPin';
        el.style.setProperty('--pin-color', phase.color);
        el.innerHTML = `<span class="pinDot"></span><span class="pinTxt">${item.label}${
          this.showModern ? `<small class="modSub">${stop.modern.replace('오늘날 · ', '')}</small>` : ''
        }</span>`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          if (this.callbacks.onStopClick) this.callbacks.onStopClick(phase.id, stop.id);
        });
        this.labelsRoot.appendChild(el);
        this.stopLabels.push({ el, lat: stop.lat, lon: stop.lon, stop, phase, isPass: false });
      }
      return;
    }

    const phase = this.phases.find((p) => p.id === this.activePhaseId);
    if (!phase) return;

    // Merge multi-visit numbered stops at identical coords (e.g. Kadesh 2·5)
    const mergedMap = new Map();
    const list = [];
    for (const stop of phase.stops) {
      if (stop.num === null) {
        list.push({ stop, nums: [], primaryStop: stop });
        continue;
      }
      const key = `${stop.lat.toFixed(3)},${stop.lon.toFixed(3)}`;
      if (mergedMap.has(key)) {
        mergedMap.get(key).nums.push(stop.num);
        if (stop.id === this.activeStopId) {
          mergedMap.get(key).primaryStop = stop;
        }
      } else {
        const entry = { stop, nums: [stop.num], primaryStop: stop };
        mergedMap.set(key, entry);
        list.push(entry);
      }
    }

    for (const entry of list) {
      const s = entry.primaryStop;
      const isPass = entry.nums.length === 0;
      const isActive = s.id === this.activeStopId;

      const el = document.createElement('button');
      el.type = 'button';
      el.className = `lb city ${isPass ? 'pass' : ''} ${isActive ? 'active' : ''}`;
      el.style.setProperty('--pin-color', phase.color);

      if (isPass) {
        el.innerHTML = `<span class="passRing"></span><span class="pinTxt">${s.name}</span>`;
      } else {
        const badgeText = entry.nums.join('·');
        el.innerHTML = `<span class="pinNum">${badgeText}</span><span class="pinTxt">${s.name}${
          this.showModern ? `<small class="modSub">${s.modern.replace('오늘날 · ', '')}</small>` : ''
        }</span>`;
      }

      el.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.callbacks.onStopClick) this.callbacks.onStopClick(phase.id, s.id);
      });
      this.labelsRoot.appendChild(el);
      this.stopLabels.push({ el, lat: s.lat, lon: s.lon, stop: s, phase, isPass });
    }
  }

  setPhase(phaseId, stopId = null, shouldFly = true) {
    this.activePhaseId = phaseId;
    this.activeStopId = stopId;

    for (const [id, obj] of this.phaseLineObjects.entries()) {
      if (phaseId === 'all') {
        obj.mat.opacity = 0.88;
        obj.mat.linewidth = 3.2;
      } else if (id === phaseId) {
        obj.mat.opacity = 1.0;
        obj.mat.linewidth = 4.6;
      } else {
        obj.mat.opacity = 0.17;
        obj.mat.linewidth = 2.0;
      }
    }

    if (stopId && phaseId !== 'all') {
      const phase = this.phases.find((p) => p.id === phaseId);
      const stop = phase?.stops.find((s) => s.id === stopId);
      if (stop) {
        this._placeBeacon(stop, phase.color);
      }
    } else {
      this.beaconGroup.visible = false;
      this.activeStopMeta = null;
    }

    this._rebuildStopLabels();

    if (shouldFly) {
      if (stopId && phaseId !== 'all') {
        const phase = this.phases.find((p) => p.id === phaseId);
        const stop = phase?.stops.find((s) => s.id === stopId);
        if (stop) this.focusCoord(stop.lat, stop.lon, 6.2);
      } else if (phaseId === 'all') {
        this.fitOverview(true);
      } else {
        this.fitPhase(phaseId, true);
      }
    }
  }

  setStop(phaseId, stopId, shouldFly = true) {
    if (this.activePhaseId !== phaseId) {
      this.setPhase(phaseId, stopId, shouldFly);
      return;
    }
    this.activeStopId = stopId;
    const phase = this.phases.find((p) => p.id === phaseId);
    const stop = phase?.stops.find((s) => s.id === stopId);
    if (stop) {
      this._placeBeacon(stop, phase.color);
      if (shouldFly) this.focusCoord(stop.lat, stop.lon, 5.6);
    }
    this._rebuildStopLabels();
  }

  _placeBeacon(stop, hexColor) {
    const { x, z } = this.latLonToXZ(stop.lat, stop.lon);
    const y = this.getSurfaceY(stop.lat, stop.lon) + 0.02;
    this.beaconGroup.position.set(x, y, z);
    this.beaconGroup.visible = true;
    this.activeStopMeta = stop;

    const col = new THREE.Color(hexColor);
    this.beaconBeam.material.color.copy(col).lerp(new THREE.Color(0xffffff), 0.35);
    this.beaconRingMat.color.copy(col).lerp(new THREE.Color(0xffffff), 0.4);
  }

  focusCoord(lat, lon, distance = 5.6) {
    const { x, z } = this.latLonToXZ(lat, lon);
    const y = Math.max(0, this.getSurfaceY(lat, lon));
    const target = new THREE.Vector3(x, y, z);
    const offset = this.is2D
      ? new THREE.Vector3(0, distance * 1.45, 0.02)
      : new THREE.Vector3(0, distance * 0.85, distance * 0.92);
    this._animateCamera(target, target.clone().add(offset));
  }

  fitPhase(phaseId, animate = true) {
    if (phaseId === 'all') {
      this.fitOverview(animate);
      return;
    }
    const phase = this.phases.find((p) => p.id === phaseId);
    if (!phase) return;

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [lat, lon] of phase.waypoints) {
      const { x, z } = this.latLonToXZ(lat, lon);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const span = Math.max(maxX - minX, maxZ - minZ, 3.8);
    const dist = Math.min(26, Math.max(5.5, span * 1.28));

    const target = new THREE.Vector3(cx, 0.35, cz);
    const camPos = this.is2D
      ? new THREE.Vector3(cx, dist * 1.38, cz + 0.02)
      : new THREE.Vector3(cx, dist * 0.82, cz + dist * 0.88);

    if (animate) this._animateCamera(target, camPos);
    else {
      this.controls.target.copy(target);
      this.camera.position.copy(camPos);
      this.controls.update();
    }
  }

  fitOverview(animate = true) {
    const target = new THREE.Vector3(-0.3, 0.2, 0.3);
    const camPos = this.is2D
      ? new THREE.Vector3(-0.3, 27.5, 0.32)
      : new THREE.Vector3(-0.3, 18.2, 16.5);

    if (animate) this._animateCamera(target, camPos);
    else {
      this.controls.target.copy(target);
      this.camera.position.copy(camPos);
      this.controls.update();
    }
  }

  set2D(flag) {
    this.is2D = flag;
    const target = this.controls.target.clone();
    const dist = this.camera.position.distanceTo(target);
    const camPos = flag
      ? new THREE.Vector3(target.x, Math.max(4.5, dist), target.z + 0.02)
      : new THREE.Vector3(target.x, dist * 0.68, target.z + dist * 0.72);
    this._animateCamera(target, camPos);
  }

  setReliefScale(val) {
    this.targetReliefScale = val;
  }

  setToggles({ showModern, showRegions, showArch, showAlt }) {
    if (showModern !== undefined) {
      this.showModern = showModern;
      this._rebuildStopLabels();
    }
    if (showRegions !== undefined) this.showRegions = showRegions;
    if (showArch !== undefined) this.showArch = showArch;
    if (showAlt !== undefined) {
      this.showAlt = showAlt;
      for (const obj of this.altLineObjects) obj.line.visible = showAlt;
    }
  }

  startPlayback(phaseId, fromProgress = null) {
    if (phaseId === 'all') return;
    const obj = this.phaseLineObjects.get(phaseId);
    if (!obj) return;
    this.playState.playing = true;
    this.playState.phaseId = phaseId;
    if (fromProgress !== null) {
      this.playState.progress = Math.max(0, Math.min(1, fromProgress));
    }
    this.avatarGroup.visible = true;
  }

  pausePlayback() {
    this.playState.playing = false;
  }

  setPlaybackProgress(phaseId, progress01) {
    const obj = this.phaseLineObjects.get(phaseId);
    if (!obj) return;
    this.playState.phaseId = phaseId;
    this.playState.progress = Math.max(0, Math.min(1, progress01));
    this.avatarGroup.visible = true;
    this._positionAvatarAtProgress(obj, this.playState.progress);
  }

  setPlaybackSpeed(spd) {
    this.playState.speed = spd;
  }

  getStopProgress(phaseId, stopIdx) {
    const obj = this.phaseLineObjects.get(phaseId);
    if (!obj) return 0;
    return obj.stopFracs[stopIdx] ?? 0;
  }

  _positionAvatarAtProgress(obj, prog) {
    const fracs = obj.denseFracs;
    const pts = obj.dense;
    let idx = 0;
    while (idx < fracs.length - 2 && fracs[idx + 1] < prog) idx++;
    const f0 = fracs[idx];
    const f1 = fracs[idx + 1] ?? 1;
    const local = f1 > f0 ? (prog - f0) / (f1 - f0) : 0;

    const [lat0, lon0] = pts[idx];
    const [lat1, lon1] = pts[Math.min(pts.length - 1, idx + 1)];
    const lat = lat0 + (lat1 - lat0) * local;
    const lon = lon0 + (lon1 - lon0) * local;

    const { x, z } = this.latLonToXZ(lat, lon);
    const y = this.getSurfaceY(lat, lon) + 0.08;
    this.avatarGroup.position.set(x, y, z);

    const pNext = this.latLonToXZ(lat1, lon1);
    const dx = pNext.x - x;
    const dz = pNext.z - z;
    if (Math.abs(dx) + Math.abs(dz) > 0.0001) {
      this.avatarGroup.rotation.y = Math.atan2(dx, dz);
    }
    return { lat, lon };
  }

  _animateCamera(target, camPos, duration = 0.72) {
    this.camAnim = {
      startTarget: this.controls.target.clone(),
      endTarget: target,
      startPos: this.camera.position.clone(),
      endPos: camPos,
      elapsed: 0,
      duration,
    };
  }

  _bindResize() {
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(this.container);
  }

  resize() {
    const w = this.container.clientWidth || 100;
    const h = this.container.clientHeight || 100;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    for (const mat of this.lineMaterials) {
      mat.resolution.set(w, h);
    }
  }

  _projectToScreen(lat, lon, heightOffset = 0.14) {
    const { x, z } = this.latLonToXZ(lat, lon);
    const y = this.getSurfaceY(lat, lon) + heightOffset;
    this._v3.set(x, y, z).project(this.camera);
    if (this._v3.z > 1) return null;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    return {
      sx: (this._v3.x * 0.5 + 0.5) * w,
      sy: (-this._v3.y * 0.5 + 0.5) * h,
    };
  }

  _updateLabelsProjection() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const camDist = this.camera.position.distanceTo(this.controls.target);

    for (const item of this.stopLabels) {
      const p = this._projectToScreen(item.lat, item.lon, 0.14);
      if (!p || p.sx < -80 || p.sx > w + 80 || p.sy < -40 || p.sy > h + 40) {
        item.el.style.display = 'none';
      } else {
        item.el.style.display = '';
        item.el.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px)`;
      }
    }

    for (const reg of this.regionLabelEls) {
      if (!this.showRegions || (camDist < 4.5 && reg.kind === 'region')) {
        reg.el.style.display = 'none';
        continue;
      }
      const p = this._projectToScreen(reg.lat, reg.lon, 0.08);
      if (!p || p.sx < -40 || p.sx > w + 40 || p.sy < -30 || p.sy > h + 30) {
        reg.el.style.display = 'none';
      } else {
        reg.el.style.display = '';
        reg.el.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px)`;
      }
    }

    for (const arch of this.archLabelEls) {
      if (!this.showArch) {
        arch.el.style.display = 'none';
        continue;
      }
      const p = this._projectToScreen(arch.site.lat, arch.site.lon, 0.28);
      if (!p || p.sx < -60 || p.sx > w + 60 || p.sy < -30 || p.sy > h + 30) {
        arch.el.style.display = 'none';
      } else {
        arch.el.style.display = '';
        arch.el.classList.toggle('compact', camDist > 14.5);
        arch.el.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px)`;
      }
    }

    for (const cand of this.altLabelEls) {
      if (!this.showAlt) {
        cand.el.style.display = 'none';
        continue;
      }
      const p = this._projectToScreen(cand.cand.lat, cand.cand.lon, 0.24);
      if (!p || p.sx < -60 || p.sx > w + 60 || p.sy < -30 || p.sy > h + 30) {
        cand.el.style.display = 'none';
      } else {
        cand.el.style.display = '';
        cand.el.style.transform = `translate(${p.sx.toFixed(1)}px, ${p.sy.toFixed(1)}px)`;
      }
    }

    // Landmark zoom visibility
    const showModels = camDist < 17.5;
    for (const lm of this.landmarkGroups) {
      lm.group.visible = showModels;
    }
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    const dt = Math.min(0.05, this._clock.getDelta());
    const t = this._clock.elapsedTime;

    // Smooth relief exaggeration transition
    if (Math.abs(this.targetReliefScale - this.reliefScale) > 0.002) {
      this.reliefScale += (this.targetReliefScale - this.reliefScale) * Math.min(1, dt * 8);
      const done = Math.abs(this.targetReliefScale - this.reliefScale) <= 0.005;
      if (done) this.reliefScale = this.targetReliefScale;
      this._applyTerrainHeights(done);
      this._updateAllRouteElevations();
    }

    // Smooth camera animation
    if (this.camAnim) {
      this.camAnim.elapsed += dt;
      const u = Math.min(1, this.camAnim.elapsed / this.camAnim.duration);
      const ease = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      this.controls.target.lerpVectors(this.camAnim.startTarget, this.camAnim.endTarget, ease);
      this.camera.position.lerpVectors(this.camAnim.startPos, this.camAnim.endPos, ease);
      if (u >= 1) this.camAnim = null;
    }

    // Beacon pulse
    if (this.beaconGroup.visible) {
      const s = 1 + 0.38 * ((t * 1.4) % 1);
      this.beaconRing.scale.set(s, s, 1);
      this.beaconRingMat.opacity = 0.85 * (1 - ((t * 1.4) % 1));
    }

    // Timeline playback
    if (this.playState.playing && this.playState.phaseId) {
      const obj = this.phaseLineObjects.get(this.playState.phaseId);
      if (obj) {
        this.playState.progress += dt * 0.055 * this.playState.speed;
        const pos = this._positionAvatarAtProgress(obj, Math.min(1, this.playState.progress));
        this.avatarGroup.position.y += Math.abs(Math.sin(t * 7)) * 0.025;

        // Gentle camera follow without overriding user rotation
        const worldPos = this.latLonToXZ(pos.lat, pos.lon);
        this.controls.target.lerp(new THREE.Vector3(worldPos.x, 0.25, worldPos.z), Math.min(1, dt * 2.5));

        // Check stop arrival triggers
        let reachedIdx = 0;
        for (let i = 0; i < obj.stopFracs.length; i++) {
          if (this.playState.progress + 0.003 >= obj.stopFracs[i]) reachedIdx = i;
        }
        if (reachedIdx !== this.playState.lastStopIdx) {
          this.playState.lastStopIdx = reachedIdx;
          if (this.callbacks.onPlaybackStop) {
            this.callbacks.onPlaybackStop(this.playState.phaseId, reachedIdx, this.playState.progress);
          }
        } else if (this.callbacks.onPlaybackTick) {
          this.callbacks.onPlaybackTick(this.playState.progress);
        }

        if (this.playState.progress >= 1) {
          this.playState.playing = false;
          this.playState.progress = 1;
          if (this.callbacks.onPlaybackEnd) this.callbacks.onPlaybackEnd();
        }
      }
    }

    // Clamp pan bounds gently
    const hw = this.meta.worldW * 0.48;
    const hh = this.meta.worldH * 0.48;
    this.controls.target.x = Math.max(-hw, Math.min(hw, this.controls.target.x));
    this.controls.target.z = Math.max(-hh, Math.min(hh, this.controls.target.z));

    this.controls.update();
    this._updateLabelsProjection();
    this.renderer.render(this.scene, this.camera);
  }
}
