// Development preview without camera: Blender camera framing, optional orbit, ?t=seconds for stills.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { loadArtwork } from './asset-loader.js';
import { ArtworkPlayer } from './artwork-player.js';
import { PlaybackClock } from './playback-clock.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') || innerWidth), H = +(q.get('h') || innerHeight);
const hud = document.getElementById('hud');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: q.has('t') });
renderer.setPixelRatio(q.has('w') ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(W, H); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.NoToneMapping;
renderer.setClearColor(new THREE.Color().setRGB(0.0025, 0.0025, 0.0025, THREE.LinearSRGBColorSpace));
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const data = await loadArtwork('/assets/', { onProgress: (b) => (hud.textContent = `loading ${(b / 1e6).toFixed(1)} MB`) });
const m = data.manifest;
const fovY = 2 * Math.atan((m.camera.sensor[1] / 2) / m.camera.lensMm) * 180 / Math.PI;
const camera = new THREE.PerspectiveCamera(fovY, W / H, 0.01, 100);
camera.position.set(...m.camera.position);
const tl = new THREE.TextureLoader();
const [atlas, poster] = await Promise.all([tl.loadAsync('/assets/' + m.images['atlas.png'].url), tl.loadAsync('/assets/' + m.images['poster.jpg'].url)]);
atlas.colorSpace = poster.colorSpace = THREE.SRGBColorSpace;
atlas.anisotropy = 4;
const player = new ArtworkPlayer(data, { atlasTexture: atlas, posterTexture: poster, showPoster: q.get('poster') !== '0' });
player.setResolution(W * renderer.getPixelRatio(), H * renderer.getPixelRatio());
scene.add(player.root);
window.__player = player; window.__render = () => renderer.render(scene, camera); window.__renderer = renderer;
if (q.has('t')) {
  player.setTime(+q.get('t'));
  renderer.render(scene, camera);
  hud.textContent = '';
  window.__ready = true;
} else {
  const controls = new OrbitControls(camera, renderer.domElement);
  const clock = new PlaybackClock(player.duration); clock.start();
  renderer.setAnimationLoop((now) => {
    if (clock.tick(now)) setTimeout(() => { clock.reset(); clock.start(); }, 1000);
    player.setTime(clock.elapsed); controls.update(); renderer.render(scene, camera);
    hud.textContent = `${clock.elapsed.toFixed(2)} / ${player.duration.toFixed(2)} s · chunks ${player.chunkCount}`;
  });
}
