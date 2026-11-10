# 결합 웹 AR

제6회 청주대학교 디지털미디어디자인학과 졸업전시 포스터 ‘결합’을 휴대폰 브라우저에서 보는 웹 AR입니다.
QR을 스캔하면 로딩 화면(`public/loader`, 원본 소스는 `loader-src/`)이 실제 다운로드 진행률대로 차오르고, 끝나면 바로 카메라 권한을 묻습니다. 시작 버튼은 없습니다. 아이폰 Safari는 동작 센서 권한을 터치 안에서만 물을 수 있어서, 로딩 중에 화면을 한 번 눌렀으면 일반 모드(공간 고정), 안 눌렀으면 ‘이미지 전용 모드’(동작 센서 없이 포스터를 따라 붙음, 포스터가 화면에서 벗어나면 잠깐 멈춤)로 바로 시작합니다. 카톡 등 앱 안 브라우저에서만 Safari/Chrome 안내 화면이 나옵니다. 벽의 포스터를 비추면, 작품이 그 자리에 고정되어 재생됩니다. 재생은 두 부분입니다: ① 빠르게(1.5배) 펼쳐진 뒤 펼쳐진 모습에서 멈추고 ‘화면을 터치하면 포스터로 돌아가요’가 뜸 → ② 화면을 한 번 터치하면 천천히(0.7배) 포스터로 돌아감.
재생이 끝나면 ‘다시 체험하기 / 홈페이지 바로 가기’가 나타나고, 카메라 화면에서는 언제든 ‘위치 다시 맞추기’를 누를 수 있습니다.

- 콘텐츠 원본: `input/MotionPoster_smooth.blend` (웹 배포 제외). 추출 결과만 `public/assets/`에 들어갑니다.
- 인식 마커: 최종 포스터 `input/poster_final_RGB.pdf` → `public/image-targets/poster-target*`
- 엔진: 8th Wall Distributed Engine Binary `@8thwall/engine-binary@1.0.0` (이미지 타깃 + SLAM), three.js `0.160.0`, Vite `8.3.6`

## 필요한 것

- Node.js 22.12 이상 (`node -v`)
- Blender 5.2 LTS (웹 자산을 다시 추출할 때만). 이 저장소의 자산은 Blender 5.2.3으로 추출했습니다.

## 명령

```sh
npm ci              # 정확한 버전 설치 (package-lock.json)
npm run dev         # 엔진 복사 후 개발 서버. 휴대폰 테스트는 HTTPS가 필요하므로 배포본으로 하세요
npm run build       # 엔진 복사 후 dist/ 생성 (Blender를 실행하지 않음)
npm run preview     # 빌드 결과 확인
npm test            # 공간 고정 규칙 · 화면 상태 · 재생 시계 단위 테스트
```

개발 미리보기(카메라 없음, 블렌더 카메라 구도): `npm run dev` 후 `/preview.html`, 특정 시점 정지 화면은 `/preview.html?t=7.1`.

## Blender → 웹 자산 다시 만들기

블렌더 파일을 고쳤을 때만 합니다. 원본 파일은 저장하지 않습니다.

```sh
# Blender 실행 파일 위치 (예시)
#   macOS:   /Applications/Blender.app/Contents/MacOS/Blender
#   Windows: "C:\Program Files\Blender Foundation\Blender 5.2\blender.exe"
#   Linux:   blender
export BLENDER_BIN=/Applications/Blender.app/Contents/MacOS/Blender      # Windows PowerShell: $env:BLENDER_BIN="C:\...\blender.exe"

"$BLENDER_BIN" --background --disable-autoexec input/MotionPoster_smooth.blend --python scripts/inspect-blend.py -- --out qa/inspect-report.json --images-out qa/packed
"$BLENDER_BIN" --background --disable-autoexec input/MotionPoster_smooth.blend --python scripts/export-web-assets.py -- --out public/assets
npm run pack-geometry      # public/assets/bodies-geo.bin -> bodies-geo.meshopt.gzb (원본 bin은 build-cache/로 이동)
python3 scripts/fit-alignment.py   # (OpenCV 필요) 블렌더 포스터 ↔ 최종 인쇄물 정렬값 계산 → qa/alignment/alignment.json
```

추출 결과는 `public/assets/manifest.json`에 시간·좌표·배열 형식·해시가 모두 기록됩니다. 요점:

- 시간축: 장면의 Time Stretching(1.2배)이 적용된 프레임 1–325, 30fps → 10.83초. 모든 조각·선·끝점·색 변화가 같은 시간을 씁니다.
- 좌표: Blender 월드 XYZ 그대로 = three.js XYZ (포스터는 XY 평면, 관객은 +Z, 포스터 폭 1).
- 선: 매 프레임 네 제어점(P0=첫 점, P1=첫 점 오른쪽 핸들, P2=둘째 점 왼쪽 핸들, P3=둘째 점)과 Bevel Factor Start/End를 기록하고, 웹은 호 길이 기준 [start, end] 구간만 그립니다. 이 파일은 선을 미리 잘라 둔 구조가 아니라 ◆ 조절 곡선(NLA)이 보이는 구간을 정하므로, 성장률을 두 번 곱하지 않습니다.
- 회전: 쿼터니언 xyzw, 인접 프레임 부호 정리, 프레임 사이 정규화 보간.
- 압축: 조각 형상은 meshoptimizer(무손실) + gzip, 애니메이션은 int16 양자화(최대 오차 2e-5 단위) + 프레임 간 차분 + gzip.

## 마커 바꾸기

최종 인쇄 파일이 바뀌면:

```sh
pdftoppm -png -singlefile -scale-to-x 1200 -scale-to-y 1800 input/<새 포스터>.pdf input/poster_final_1200
printf '%s\n' input/poster_final_1200.png 1 y public/image-targets poster-target | OVERWRITE_FILES=true npx --no-install image-target-cli
python3 scripts/fit-alignment.py     # 결과의 scale/offset을 public/config.json의 markerToArtwork에 반영
```

CLI 입력: 평면(flat), 기본 중앙 크롭(3:4, 위 100px부터 높이 1600px). 크롭 중심 = 포스터 중심이라 별도 보정이 없습니다.

## 설정 `public/config.json`

| 항목 | 값 |
|---|---|
| `playback.segments` | 두 부분 재생: `fromFrame`/`toFrame`(블렌더 프레임, 30fps), `speed`(1.5 = 1.5배 빠르게), `holdAtEnd: true`면 그 끝에서 터치를 기다림. 기본값 1→301 ×1.5 멈춤, 301→390 ×0.7 |
| `playback.tapHint` | 멈춰 있을 때 보이는 안내 문구 |
| `homepageUrl` | `https://www.dmd2026.com/` (재생 후 ‘홈페이지 바로 가기’) |
| `productionUrl` | 배포 후 확정 주소를 넣습니다 (현재 `null`, 예정 `https://ar.dmd2026.com/`) |
| `markerToArtwork` | 작품 ↔ 인쇄물 정렬. scale 1.0052, 회전 0 (SIFT 2,176점, 중앙 오차 0.1px) |
| `markerPhysicalWidth/Height` | 포스터 자체가 마커라 필요 없어서 `null` |
| `anchor.*` | 고정 전 안정화 조건(650ms, 3표본 이상, 폭 5%, 위치 3%, 회전 10°), 최소 관람 거리(포스터 폭의 1.6배) |
| `render.maxPixelRatio` | 1.5 |

## Vercel 배포

1. 이 폴더를 GitHub 저장소로 올립니다. `.gitignore`가 원본 `.blend`, `input/`, `node_modules/`, `dist/`, 엔진 복사본을 제외합니다.
2. Vercel → Add New → Project → 저장소 Import. 설정: **Framework Preset: Vite / Root Directory: 이 폴더 / Install: `npm ci` / Build: `npm run build` / Output: `dist`**
3. 배포 후 Settings → Domains에서 `ar.dmd2026.com`을 추가하고, dmd2026.com의 DNS 관리 화면에 Vercel이 알려 주는 레코드(보통 `ar` CNAME)를 넣습니다.
4. Deployment Protection이 켜져 있으면 관람객에게 로그인이 요구되므로 Production은 공개로 둡니다.
5. 확정 주소로 QR 생성: `npm run qr -- https://ar.dmd2026.com/` → `delivery/ar-qr.png`, `ar-qr.svg`, `ar-qr.json`(디코딩 검증 결과)

## 라이선스 표시

8th Wall 엔진은 Niantic Spatial, Inc.의 XR Engine License Agreement를 따릅니다(무료 전시 사용 가능, 엔진 단독 유료 판매 불가).
첫 화면 하단에 저작권 표시와 라이선스·보증 부인 고지 링크(`/vendor/xr/LICENSE-engine-binary.txt`)를 두었습니다. 지우지 마세요.

## 검증 상태

`qa/` 참고. 자동 검사와 실제 기기 검사를 구분합니다.

| 항목 | 상태 |
|---|---|
| 원본 해시 유지, 추출 정밀도, 블렌더 렌더 ↔ 웹 비교 8시점 (실루엣 89–97% 일치) | 완료 (`qa/compare/`) |
| 단위 테스트: 1회 고정, 고정 후 마커 이벤트 무시, 추적 일시정지/재개, 리셋·재체험, 시계 점프 없음 | 완료 (`npm test`) |
| 빌드 산출물에 엔진 chunk·타깃·자산 포함 | 완료 |
| 가짜 카메라로 포스터 인식 이벤트 수신, 추적 초기화 중 고정 안 함, 작품 방향·위치가 인쇄물 가장자리에 맞음 | 완료 (헤드리스, 합성 영상) |
| 실제 아이폰 Safari / 안드로이드 Chrome: 권한, 인식, 공간 고정, 시차, 종료·리셋, 성능(삼각형 약 430만 개) | **미검증** |
| Vercel Production, 도메인, 최종 QR 실물 스캔 | **미검증** (계정 연결 필요) |
