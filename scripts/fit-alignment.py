"""Fit a similarity transform (uniform scale + offset, no rotation expected) that maps the Blender
poster plane (the artwork's own poster, packed poster.jpg) onto the final print image.
Writes qa/alignment/alignment.json and an overlay preview. python3 scripts/fit-alignment.py
Second target: python3 scripts/fit-alignment.py public/image-targets/poster-target-2_cropped.png qa/alignment/target-2
(fit against the CROPPED target image: its width and center are exactly what the engine reports)"""
import cv2, json, numpy as np, sys, os
blend_img = 'public/assets/poster.jpg'
final_img = sys.argv[1] if len(sys.argv) > 1 else 'input/poster_final_1200.png'
out_dir = sys.argv[2] if len(sys.argv) > 2 else 'qa/alignment'; os.makedirs(out_dir, exist_ok=True)
man = json.load(open('public/assets/manifest.json')); pp = man['posterPlane']
A = cv2.imread(blend_img, cv2.IMREAD_GRAYSCALE); B = cv2.imread(final_img, cv2.IMREAD_GRAYSCALE)
sift = cv2.SIFT_create(8000)
ka, da = sift.detectAndCompute(A, None); kb, db = sift.detectAndCompute(B, None)
m = cv2.BFMatcher().knnMatch(da, db, k=2)
good = [x for x, y in m if x.distance < 0.75 * y.distance]
pa = np.float32([ka[g.queryIdx].pt for g in good]); pb = np.float32([kb[g.trainIdx].pt for g in good])
M, inl = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=4.0, maxIters=20000, confidence=0.999)
inl = inl.ravel().astype(bool)
s = float(np.hypot(M[0, 0], M[1, 0])); rot = float(np.degrees(np.arctan2(M[1, 0], M[0, 0])))
res = np.linalg.norm((pa[inl] @ M[:, :2].T + M[:, 2]) - pb[inl], axis=1)
# convert to poster units. Blender poster: width 1 -> A.shape[1] px, center at (0,0), y up.
# Final print: width 1 -> B.shape[1] px, center at (0,0), y up.
wa, ha = A.shape[1], A.shape[0]; wb, hb = B.shape[1], B.shape[0]
def a2px(x, y): return np.array([(x - pp['minX']) / (pp['maxX'] - pp['minX']) * wa, (pp['maxY'] - y) / (pp['maxY'] - pp['minY']) * ha])
def px2b(p): return np.array([p[0] / wb - 0.5, (hb / 2 - p[1]) / wb])
o = px2b(M @ np.append(a2px(0, 0), 1)); ex = px2b(M @ np.append(a2px(1, 0), 1)) - o
scale = float(np.linalg.norm(ex))   # final-print widths per Blender unit
out = {'blenderPoster': blend_img, 'finalPrint': final_img, 'matches': len(good), 'inliers': int(inl.sum()),
       'scale': scale, 'rotationDeg': rot, 'offset': o.tolist(), 'residualPx': {'median': float(np.median(res)), 'p90': float(np.percentile(res, 90))},
       'finalPrintAspect': hb / wb,
       'meaning': 'artwork point p (Blender units, poster width 1) -> print point = offset + scale * p, in print widths, centered, y up'}
json.dump(out, open(f'{out_dir}/alignment.json', 'w'), indent=1)
warp = cv2.warpAffine(cv2.imread(blend_img), M, (wb, hb))
over = cv2.addWeighted(cv2.imread(final_img), 0.5, warp, 0.5, 0)
cv2.imwrite(f'{out_dir}/overlay.jpg', cv2.resize(over, (600, round(600 * hb / wb))))
print(json.dumps(out, indent=1))
