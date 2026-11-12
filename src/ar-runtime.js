// Thin wrapper around the 8th Wall engine binary (XR8): image target + world tracking (SLAM), three.js scene.
// The engine script (/vendor/xr/xr.js, data-preload-chunks="slam") is loaded by index.html.
import * as THREE from 'three';

export function waitForXR8(timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    if (window.XR8) return resolve(window.XR8);
    const t = setTimeout(() => reject(Object.assign(new Error('engine load timeout'), { code: 'network' })), timeoutMs);
    window.addEventListener('xrloaded', () => { clearTimeout(t); resolve(window.XR8); }, { once: true });
  });
}

// device: 'MOBILE' (phones, tablets in mobile mode) or 'ANY' (also tablets whose browser says it is a computer)
export function compatibility(XR8, device = 'MOBILE') {
  try {
    const allowedDevices = XR8.XrConfig.device()[device];
    const ok = XR8.XrDevice.isDeviceBrowserCompatible({ allowedDevices });
    const reasons = ok ? [] : (XR8.XrDevice.incompatibleReasons?.({ allowedDevices }) || []);
    return { ok, reasons };
  } catch (e) { return { ok: true, reasons: [], note: String(e) }; }
}

export class ArRuntime {
  constructor(hooks) {
    this.h = hooks; this.running = false; this.scene = null;
    this.worldAnchor = new THREE.Group(); this.worldAnchor.name = 'worldAnchor';
    this.contentAlignment = new THREE.Group(); this.contentAlignment.name = 'contentAlignment';
    this.worldAnchor.add(this.contentAlignment);
    this.worldAnchor.visible = false;
    this._lastTracking = '';
  }

  // worldTracking:false = image-only mode (no motion sensors needed); the artwork then follows the poster while it is in view
  async start({ canvas, targetData, maxPixelRatio = 1.5, worldTracking = true }) {
    if (this.running) return;
    const XR8 = await waitForXR8();
    window.THREE = THREE;                                  // XR8.Threejs expects a global THREE
    XR8.XrController.configure({ disableWorldTracking: !worldTracking, scale: worldTracking ? 'absolute' : 'responsive', imageTargetData: Array.isArray(targetData) ? targetData : [targetData] });
    if (XR8.Threejs.configure) XR8.Threejs.configure({ renderCameraTexture: false }); // GlTextureRenderer draws the camera once
    const self = this;
    const forward = (type) => ({ detail }) => self.h.onImage?.(type, detail);
    const module = {
      name: 'gyeolhap-ar',
      onStart: () => {
        const { scene, camera, renderer } = XR8.Threejs.xrScene();
        self.scene = scene; self.camera = camera; self.renderer = renderer;
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.NoToneMapping;
        scene.add(self.worldAnchor);
        self.h.onSceneReady?.(scene, camera, renderer);
      },
      onUpdate: ({ processCpuResult }) => {
        const r = processCpuResult?.reality;
        if (r && (r.trackingStatus || r.trackingReason)) self._tracking(r.trackingStatus, r.trackingReason);
        self.h.onFrame?.(performance.now());
      },
      onCameraStatusChange: ({ status, reason }) => self.h.onCameraStatus?.(status, reason),
      onException: (err) => self.h.onError?.(err),
      listeners: [
        { event: 'reality.imagefound', process: forward('found') },
        { event: 'reality.imageupdated', process: forward('updated') },
        { event: 'reality.imagelost', process: forward('lost') },
        { event: 'reality.trackingstatus', process: ({ detail }) => self._tracking(detail?.status, detail?.reason) },
      ],
    };
    XR8.addCameraPipelineModules([
      XR8.GlTextureRenderer.pipelineModule(),
      XR8.Threejs.pipelineModule(),
      XR8.XrController.pipelineModule(),
      module,
    ]);
    // the engine draws into the canvas' pixel size: keep it at the window size (DPR capped), like XRExtras.FullWindowCanvas
    this._fit = () => {
      const r = Math.min(window.devicePixelRatio || 1, maxPixelRatio);
      // size from the window, never from the canvas itself: three.js writes canvas.style.width/height = pixel size,
      // so measuring the canvas would grow it by the pixel ratio on every start (the camera kept zooming in)
      const box = (canvas.parentElement || document.documentElement).getBoundingClientRect();
      const vw = box.width || window.innerWidth, vh = box.height || window.innerHeight;
      // big tablet screens: cap the drawing size (~2.4 MP) so the GPU keeps up
      const k = Math.min(1, Math.sqrt(2.4e6 / Math.max(1, vw * r * vh * r)));
      const w = Math.round(vw * r * k), h = Math.round(vh * r * k);
      canvas.style.width = '100%'; canvas.style.height = '100%';
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    };
    this._fit();
    window.addEventListener('resize', this._fit); window.addEventListener('orientationchange', this._fit);
    this.running = true;
    XR8.run({ canvas, cameraConfig: { direction: XR8.XrConfig.camera().BACK } });
  }

  _tracking(status, reason) {
    const key = `${status}|${reason}`;
    if (key === this._lastTracking) return;
    this._lastTracking = key;
    this.h.onTracking?.(status, reason);
  }

  cameraPosition() { return this.camera ? this.camera.position.clone() : null; }

  setAnchor(pose, alignment) {
    const a = this.worldAnchor;
    a.position.set(pose.position.x, pose.position.y, pose.position.z);
    a.quaternion.set(pose.quaternion.x, pose.quaternion.y, pose.quaternion.z, pose.quaternion.w);
    a.scale.setScalar(pose.width);               // content is normalized to poster width 1
    const c = this.contentAlignment, m = alignment || {};
    c.position.fromArray(m.position || [0, 0, 0]);
    const r = (m.rotationDeg || [0, 0, 0]).map((d) => (d * Math.PI) / 180);
    c.rotation.set(r[0], r[1], r[2]);
    c.scale.setScalar(m.scale || 1);
    a.visible = true;
  }

  clearAnchor() { this.worldAnchor.visible = false; }

  pause() { if (this.running && window.XR8) window.XR8.pause(); }
  resume() { if (this.running && window.XR8) window.XR8.resume(); }

  stop() {
    if (!this.running || !window.XR8) return;
    this.running = false;
    window.removeEventListener('resize', this._fit); window.removeEventListener('orientationchange', this._fit);
    try { this.scene?.remove(this.worldAnchor); } catch { /* scene already gone */ }
    window.XR8.stop();
    window.XR8.clearCameraPipelineModules();
    this.scene = null; this._lastTracking = '';
  }
}
