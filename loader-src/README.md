# 유연한 결합 · 메인 로딩 애니메이션

ZIP을 모두 풀고 `index.html`을 브라우저에서 여세요. 인터넷 연결이나 설치 없이 재생됩니다. 매번 33개 아이콘 중 하나를 무작위로 골라 윤곽선을 그리고, 진행률에 맞춰 조각을 모은 뒤 원본 색으로 채웁니다. 끝나면 **다시 재생**을 눌러 다시 볼 수 있습니다.

## 파일 구성

- `index.html`은 점무늬 배경과 다시 재생 버튼을 갖춘 예제입니다.
- `demo.js`는 미리보기용 진행률을 시간에 따라 올립니다.
- `js/main-intro-loading.js`는 전시 사이트 메인에서 사용하는 실행 파일입니다. 아이콘 데이터가 내장되어 있습니다.
- `css/loader.css`에는 로더 배치, 퍼센트 서체, 화면 전환, 동작 줄이기 설정이 있습니다.
- `src/loading.js`는 진행률과 종료 상태를, `src/loading-assembly.js`는 윤곽선 그리기와 조각 움직임을 제어합니다. `src/icons.json`에 33개 원본 SVG의 경로, 색상, 작가명이 있습니다.
- `fonts/`에는 퍼센트 표시에 쓰는 Rajdhani Regular와 라이선스가 들어 있습니다.

## 다른 페이지에 붙이기

1. `css/`, `js/`, `fonts/`를 같은 구조로 복사합니다.
2. 예제의 `<head>`에서 로더 스타일시트, `intro-loading` 클래스를 붙이는 스크립트, `js/main-intro-loading.js`를 불러오는 스크립트를 복사합니다.
3. 예제의 `#introLoader` 요소 전체를 본문의 `<main>` 앞에 둡니다. 로딩 중에는 스크립트가 `<main>`의 조작을 잠급니다. 로딩이 끝날 때 서서히 나타날 콘텐츠에 `data-loading-content`를 붙이세요. 점무늬 배경을 쓰려면 예제의 `body` 배경 스타일도 복사합니다.
4. 예제에서 `demo.js`를 불러오던 위치에 실제 로딩 코드를 연결합니다. 작업이 진행될 때 `update(퍼센트)`, 모든 준비가 끝났을 때 `finish()`, 오류로 로딩을 중단할 때 `fail()`을 호출합니다.

```js
// 같은 비중의 이미지들을 준비하는 경우
async function prepareImages(images) {
  const loader = window.MainIntroLoading;
  let ready = 0;
  try {
    await Promise.all(images.map(async (image) => {
      await image.decode();
      ready += 1;
      loader.update(100 * ready / images.length);
    }));
    loader.finish();
  } catch (error) {
    loader.fail();
    console.error(error);
  }
}
```

`update()`는 최대 99%까지 표시합니다. `finish()`가 마지막 조각을 결합한 뒤 100%를 표시하고 본문을 엽니다.

## 원본 수정하기

크기와 서체는 `css/loader.css`에서 바로 바꿀 수 있습니다. 아이콘이나 조립 움직임을 바꾸려면 `src/`의 해당 파일을 수정한 다음, Node.js와 npm이 있는 환경에서 이 폴더를 열고 실행 파일을 다시 만드세요.

```sh
npx esbuild@0.28.2 src/loading.js --bundle --minify --format=iife --target=chrome110,safari16 --outfile=js/main-intro-loading.js
```
