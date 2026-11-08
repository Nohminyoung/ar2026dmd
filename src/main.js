// Visitor flow: start -> permissions -> scan poster -> stabilize -> anchor once -> play once -> end buttons.
import * as THREE from 'three';
import { loadArtwork } from './asset-loader.js';
import { ArtworkPlayer } from './artwork-player.js';
import { PlaybackClock } from './playback-clock.js';
import { AnchorPolicy } from './anchor-policy.js';
import { SessionState, S } from './session-state.js';
import { ArRuntime, waitForXR8, compatibility } from './ar-runtime.js';

const $ = (id) => document.getElementById(id);
// ?qa=1 : QA only. Exposes internals and draws the artwork on the live marker pose (never used to latch).
const QA = new URLSearchParams(location.search).get('qa') === '1';
const ui = {
  app: $('app'), canvas: $('camerafeed'), intro: $('intro'), start: $('start'), bar: $('load-bar'), loadText: $('load-text'),
  hud: $('hud'), status: $('status'), reset: $('reset'), close: $('close'), end: $('end'), replay: $('replay'), home: $('home'),
  error: $('error'), errTitle: $('error-title'), errText: $('error-text'), retry: $('retry'), inapp: $('inapp'), url: $('page-url'), copy: $('copy-url'),
};

const MSG = {
  scanning: '포스터를 찾아보세요',
  found: '포스터를 찾았어요. 위치를 맞추고 있어요',
  back: '조금 뒤로 물러나 주세요',
  move: '주변을 천천히 비추면 이어서 재생됩니다',
  slowStable: '휴대폰을 천천히 움직여 주변도 함께 비춰 주세요',
  loading: (p) => `작품을 불러오는 중… ${p}%`,
  relocate: '위치가 맞지 않으면 ‘위치 다시 맞추기’를 눌러 주세요',
};

// ---------------- config + assets (start downloading immediately) ----------------
let config = null, targetData = null, player = null, assetsError = null, loadedBytes = 0, totalBytes = 0;
const configP = fetch('/config.json').then((r) => r.json()).then((c) => { config = c; return c; });
const targetP = configP.then((c) => fetch(c.targetJsonUrl)).then((r) => { if (!r.ok) throw new Error('target'); return r.json(); }).then((t) => (targetData = t));
const assetsP = (async () => {
  const head = await fetch('/assets/manifest.json').then((r) => r.json());
  totalBytes = head.bodies.packed.bytes + Object.values(head.animation).reduce((s, a) => s + a.bytes, 0) + head.tips.geometry.bytes;
  const data = await loadArtwork('/assets/', { onProgress: (b) => { loadedBytes = b; showLoad(); } });
  const tl = new THREE.TextureLoader();
  const atlas = await tl.loadAsync('/assets/' + data.manifest.images['atlas.png'].url);
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  player = new ArtworkPlayer(data, { atlasTexture: atlas });
  loadedBytes = totalBytes; showLoad();
  return player;
})().catch((e) => { assetsError = e; showLoad(); throw e; });
assetsP.catch(() => {});

function pct() { return totalBytes ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0; }
function showLoad() {
  ui.bar.style.width = (player ? 100 : pct()) + '%';
  ui.loadText.textContent = assetsError ? '작품을 불러오지 못했어요. 네트워크를 확인하고 새로고침해 주세요.'
    : player ? `준비됐어요 · ${(totalBytes / 1e6).toFixed(0)}MB` : `작품을 불러오는 중… ${pct()}%`;
}

// ---------------- in-app browsers ----------------
const INAPP = /KAKAOTALK|Instagram|FBAN|FBAV|NAVER\(inapp|Line\/|DaumApps|everytimeApp|Snapchat|; wv\)/i;
if (INAPP.test(navigator.userAgent)) { ui.inapp.hidden = false; ui.url.textContent = location.href; }
ui.copy.addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(location.href); ui.copy.textContent = '복사했어요'; }
  catch { const r = document.createRange(); r.selectNodeContents(ui.url); getSelection().removeAllRanges(); getSelection().addRange(r); ui.copy.textContent = '길게 눌러 복사'; }
});

// ---------------- session ----------------
const runtime = new ArRuntime({ onSceneReady, onFrame, onImage, onTracking, onCameraStatus, onError: (e) => fail('engine', e) });
let policy = null, clock = null, attached = false, trackingLimitedAt = 0, pendingLatch = null;
const session = new SessionState((next) => { ui.app.dataset.state = next; render(); });

function render() {
  const st = session.state;
  ui.intro.hidden = !(st === S.IDLE || st === S.STARTING);
  ui.start.disabled = st === S.STARTING;
  ui.start.textContent = st === S.STARTING ? '카메라를 준비하고 있어요…' : 'AR 시작';
  ui.hud.hidden = !session.isCamera();
  ui.end.hidden = st !== S.ENDED;
  ui.error.hidden = st !== S.ERROR;
  ui.reset.classList.remove('attention');
  if (st === S.SCANNING) setStatus(MSG.scanning);
  if (st === S.STABILIZING) setStatus(MSG.found);
  if (st === S.PLAYING || st === S.ENDED) setStatus('');
  if (st === S.TRACKING_PAUSED) setStatus(MSG.move, true);
}
function setStatus(t, warn = false) { ui.status.textContent = t; ui.status.classList.toggle('warn', warn); }

function fail(kind, err) {
  console.warn('[AR]', kind, err);
  const map = {
    motion: ['동작 센서 권한이 필요해요', '아이폰에서 ‘동작 및 방향 접근’을 허용해야 작품을 공간에 고정할 수 있어요. 페이지를 새로고침한 뒤 다시 시작하고, 물어보면 ‘허용’을 눌러 주세요.'],
    camera: ['카메라를 열 수 없어요', '카메라 권한이 꺼져 있거나 다른 앱이 카메라를 쓰고 있어요. 브라우저 설정에서 이 사이트의 카메라를 허용하고, 다른 앱을 닫은 뒤 다시 시도해 주세요.'],
    unsupported: ['이 브라우저에서는 AR을 쓸 수 없어요', '아이폰은 iOS 16.4 이상의 Safari, 안드로이드는 최신 Chrome에서 열어 주세요. 운영체제와 브라우저를 업데이트하면 될 수 있어요.'],
    network: ['불러오기에 실패했어요', '인터넷 연결을 확인하고 페이지를 새로고침해 주세요.'],
    engine: ['AR을 시작하지 못했어요', '페이지를 새로고침한 뒤 다시 시도해 주세요.'],
  };
  const [t, d] = map[kind] || map.engine;
  ui.errTitle.textContent = t; ui.errText.textContent = d + (err?.reasons?.length ? ` (${err.reasons.join(', ')})` : '');
  teardown();
  if (!session.send('FAIL')) { session.state = S.ERROR; render(); }
}

// ---------------- start (one tap) ----------------
ui.start.addEventListener('click', () => {
  if (!(session.state === S.IDLE || session.state === S.ERROR)) return;     // no double start
  // iOS: ask motion/orientation inside the tap, before any await, so the user activation is still valid
  const asks = [];
  for (const C of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
    if (C && typeof C.requestPermission === 'function') asks.push(C.requestPermission().catch(() => 'denied'));
  }
  session.send('START');
  begin(asks);
});
ui.retry.addEventListener('click', () => location.reload());

async function begin(asks) {
  try {
    const results = await Promise.all(asks);
    if (results.some((r) => r !== 'granted')) return fail('motion');
    let XR8;
    try { XR8 = await waitForXR8(); } catch (e) { return fail('network', e); }
    const compat = compatibility(XR8);
    if (!compat.ok) return fail('unsupported', compat);
    try { await targetP; } catch (e) { return fail('network', e); }
    policy = new AnchorPolicy(config.targetName, config.anchor);
    clock = null; attached = false;
    await runtime.start({ canvas: ui.canvas, targetData, maxPixelRatio: config.render?.maxPixelRatio ?? 1.5 });
  } catch (e) { fail('engine', e); }
}

function onCameraStatus(status, reason) {
  if (status === 'hasStream' && session.state === S.STARTING) session.send('CAMERA_READY');
  if (status === 'failed') fail('camera', { reasons: reason ? [String(reason)] : [] });
}

function onSceneReady() { attach(); }
function attach() {
  if (attached || !player || !runtime.scene) return;
  runtime.contentAlignment.add(player.root);
  clock = new PlaybackClock(player.duration);
  attached = true;
}
assetsP.then(() => { attach(); if (pendingLatch && session.state === S.STABILIZING) latch(pendingLatch); }).catch(() => {});

// ---------------- image + tracking events ----------------
function onImage(type, d) {
  if (!policy) return;
  if (type === 'lost') {
    policy.lost(d?.name);
    if (session.state === S.STABILIZING) session.send('TARGET_LOST');
    return;
  }
  if (QA) { window.__qa.lastImage = { type, d: JSON.parse(JSON.stringify(d)), t: performance.now() };
    if (!policy.latched && player && attached && d.scaledWidth) { runtime.setAnchor({ position: d.position, quaternion: d.rotation, width: d.scale * d.scaledWidth }, config.markerToArtwork); player.setTime(0); } }
  if (policy.latched) return;                                  // placement is decided once
  if (session.state === S.SCANNING) session.send('TARGET_SEEN');
  if (session.state !== S.STABILIZING) return;
  // distance check: the whole animation needs room in front of the poster
  const cam = runtime.cameraPosition();
  const width = d.scale * d.scaledWidth;
  if (cam && width > 0) {
    const dist = Math.hypot(cam.x - d.position.x, cam.y - d.position.y, cam.z - d.position.z) / width;
    if (dist < (config.anchor.minViewDistanceInPosterWidths ?? 1.6)) { policy.lost(); setStatus(MSG.back, true); return; }
  }
  const r = policy.observe(d, performance.now());
  if (r.state === 'waiting-tracking') setStatus(MSG.slowStable);
  else if (r.state === 'stabilizing') setStatus(MSG.found);
  else if (r.state === 'latched') latch(r.pose);
}

function latch(pose) {
  if (!player || !attached) { pendingLatch = pose; setStatus(MSG.loading(pct())); return; }
  pendingLatch = null;
  runtime.setAnchor(pose, config.markerToArtwork);
  clock.reset(); player.setTime(0);
  if (session.send('LATCHED')) clock.start();
}

function onTracking(status, reason) {
  if (QA) window.__qa.tracking.push([status, reason]);
  if (!policy) return;
  policy.setTracking(status, reason);
  const normal = status === 'NORMAL';
  if (session.state === S.PLAYING && !normal) { clock.pause(); trackingLimitedAt = performance.now(); session.send('TRACKING_LIMITED'); }
  else if (session.state === S.TRACKING_PAUSED && normal) { session.send('TRACKING_NORMAL'); clock.start(); }
}

function onFrame(now) {
  if (!attached) return;
  const r = runtime.renderer;
  if (r) { const v = r.getDrawingBufferSize(new THREE.Vector2()); player.setResolution(v.x, v.y); }
  if (session.state === S.PLAYING) {
    const ended = clock.tick(now);
    player.setTime(clock.elapsed);
    if (ended) session.send('END');
  } else if (session.state === S.TRACKING_PAUSED && now - trackingLimitedAt > (config.anchor.trackingLostResetHintMs ?? 8000)) {
    setStatus(MSG.relocate, true); ui.reset.classList.add('attention');
  }
}

// ---------------- buttons ----------------
ui.reset.addEventListener('click', () => {
  if (!session.isCamera()) return;
  clock?.pause(); clock?.reset(); player?.setTime(0); pendingLatch = null;
  runtime.clearAnchor(); policy?.unlatch();
  session.send('RESET');
});
ui.replay.addEventListener('click', () => {
  if (session.state !== S.ENDED) return;
  clock.reset(); player.setTime(0);
  session.send('REPLAY');
  if (policy.trackingReady()) clock.start();
  else { trackingLimitedAt = performance.now(); session.send('TRACKING_LIMITED'); }
});
ui.home.addEventListener('click', () => {
  const url = config?.homepageUrl;
  if (!url || !/^https:\/\//.test(url)) { setStatus('홈페이지 주소가 아직 설정되지 않았어요', true); return; }
  teardown();
  location.assign(url);
});
ui.close.addEventListener('click', () => { teardown(); session.send('CLOSE'); });

function teardown() {
  clock?.pause();
  runtime.clearAnchor();
  runtime.stop();
  policy = null; pendingLatch = null;
}

// ---------------- page lifecycle: no time jumps ----------------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clock?.pause(); runtime.pause(); }
  else {
    runtime.resume();
    if (session.state === S.PLAYING && policy?.trackingReady()) clock.start();
  }
});
window.addEventListener('pagehide', () => teardown());

render(); showLoad();
if (QA) window.__qa = { runtime, session, get policy() { return policy; }, get player() { return player; }, tracking: [] };
