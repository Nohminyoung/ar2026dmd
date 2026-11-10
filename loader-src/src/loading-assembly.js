const SVG_NS = 'http://www.w3.org/2000/svg';
const TRACE_MS = 680;
const FLIGHT_MS = 440;
const IMPACT_MS = 1400;
const TRACE_FRAMES = 24;
const svgNode = tag => document.createElementNS(SVG_NS, tag);

function splitArtwork(field, icon) {
  field.innerHTML = icon.svg;
  const parts = [];
  for (const source of [...field.children]) {
    // The source artwork uses absolute movetos. Split islands while keeping
    // each cutout on its surrounding path (including islands inside holes).
    const contours = source.getAttribute('d')?.match(/M[^M]*/g);
    if (!contours || contours.length < 2) {
      parts.push(source);
      continue;
    }
    const paths = contours.map(d => {
      const path = source.cloneNode(false);
      path.setAttribute('d', d);
      field.append(path);
      return path;
    });
    const boxes = paths.map(path => path.getBBox());
    const parents = boxes.map((box, index) => {
      const sample = paths[index].getPointAtLength(paths[index].getTotalLength() * .37);
      let parent = -1, smallestArea = Infinity;
      for (const [j, outer] of boxes.entries()) {
        const area = outer.width * outer.height;
        if (area <= box.width * box.height || area >= smallestArea) continue;
        if (outer.x <= box.x && outer.y <= box.y &&
            outer.x + outer.width >= box.x + box.width && outer.y + outer.height >= box.y + box.height &&
            paths[j].isPointInFill(sample)) {
          parent = j;
          smallestArea = area;
        }
      }
      return parent;
    });
    source.remove();
    for (const [i, path] of paths.entries()) {
      let depth = 0;
      for (let p = parents[i]; p !== -1; p = parents[p]) depth++;
      if (depth % 2 === 0) {
        parts.push(path);
      } else {
        const parent = paths[parents[i]];
        parent.setAttribute('d', parent.getAttribute('d') + contours[i]);
        path.remove();
      }
    }
  }
  if (parts.length > 1) return parts;

  // A continuous silhouette still needs movable pieces. Four SVG viewports
  // cut it in its own coordinates, retaining its original curves and cutouts.
  const {x, y, width, height} = field.getBBox();
  field.replaceChildren();
  const mask = svgNode('clipPath');
  mask.id = 'intro-loader-cut';
  mask.append(parts[0].cloneNode(true));
  field.append(mask);
  const cut = svgNode('path');
  cut.setAttribute('d', `M${x + width/2} ${y}v${height}M${x} ${y + height/2}h${width}`);
  cut.setAttribute('clip-path', 'url(#intro-loader-cut)');
  cut.setAttribute('fill', 'none');
  return [0, 1, 2, 3].map(i => {
    const tile = document.createElementNS(SVG_NS, 'svg');
    const left = x + (i % 2) * width / 2, top = y + Math.floor(i / 2) * height / 2;
    tile.setAttribute('x', left);
    tile.setAttribute('y', top);
    tile.setAttribute('width', width / 2);
    tile.setAttribute('height', height / 2);
    tile.setAttribute('viewBox', [left, top, width / 2, height / 2].join(' '));
    tile.setAttribute('overflow', 'hidden');
    tile.append(parts[0].cloneNode(true), cut.cloneNode(true));
    return tile;
  });
}

function layOutPieces(field, icon) {
  const [vx, vy, width, height] = icon.viewBox.split(/\s+/).map(Number);
  const cx = vx + width / 2, cy = vy + height / 2;
  field.setAttribute('viewBox', icon.viewBox);
  field.setAttribute('fill', icon.color);
  const pieces = splitArtwork(field, icon).map(art => {
    const node = document.createElementNS(SVG_NS, 'g');
    field.append(node);
    node.append(art);
    // getBBox ignores viewport clipping, so measure cut tiles by their viewport.
    const box = art.localName === 'svg'
      ? art.viewBox.baseVal : node.getBBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    return {node, x, y, w: box.width + 12, h: box.height + 12,
      radius: Math.hypot(box.width, box.height) / 2, bearing: Math.atan2(y - cy, x - cx)};
  });
  pieces.sort((a, b) => a.bearing - b.bearing);
  let spread = width * .68;
  for (const [i, piece] of pieces.entries()) {
    const angle = (i + .5) / pieces.length * Math.PI * 2 - Math.PI;
    const distance = .95 + .12 * Math.sin(i * 2);
    piece.dx = Math.cos(angle) * distance;
    piece.dy = Math.sin(angle) * distance;
    piece.spin = i % 3 === 1 ? -1 : 1;
    for (let j = 0; j < i; j++) {
      const other = pieces[j];
      const gap = Math.hypot(piece.dx - other.dx, piece.dy - other.dy);
      spread = Math.max(spread, (piece.radius + other.radius + 32) / gap);
    }
  }
  let extent = width;
  for (const piece of pieces) {
    piece.homeX = cx + piece.dx * spread;
    piece.homeY = cy + piece.dy * spread;
    extent = Math.max(extent, Math.max(Math.abs(piece.dx), Math.abs(piece.dy)) * spread + piece.radius + 24);
  }
  field.setAttribute('viewBox', [cx - extent, cy - extent, 2 * extent, 2 * extent].join(' '));
  pieces.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  return {pieces, cx, cy, extent};
}

// All moving surfaces are HTML layers. The compositor can play their transform
// and opacity tracks while the main thread builds geometry and prepares WebGL.
function animateAt(node, keyframes, start, duration, options = {}) {
  const animation = node.animate(keyframes, {duration, ...options});
  animation.startTime = start;
  return animation;
}

function transform(piece, x, y, angle) {
  return `translate(${100 * (x - piece.x) / piece.w}%,${100 * (y - piece.y) / piece.h}%) rotate(${angle}rad)`;
}

function floatingPose(piece, elapsed) {
  const phase = piece.bearing + elapsed / piece.period * Math.PI * 2;
  return {x: piece.homeX + 4 * Math.sin(phase), y: piece.homeY + 4 * Math.cos(phase),
    angle: piece.roll + .09 * Math.sin(phase)};
}

function floatPiece(piece, start) {
  const frames = Array.from({length:9}, (_, step) => {
    const {x, y, angle} = floatingPose(piece, piece.period * step / 8);
    return {transform:transform(piece, x, y, angle)};
  });
  piece.float = animateAt(piece.tile, frames, start, piece.period, {iterations:Infinity});
}

function createTile(piece, index, layout, stage, defs, icon, frames) {
  const {cx, cy, extent} = layout;
  const left = piece.x - piece.w / 2, top = piece.y - piece.h / 2;
  const tile = document.createElement('div');
  tile.className = 'intro-loader-tile';
  Object.assign(tile.style, {
    left: (left - cx + extent) * 50 / extent + '%',
    top: (top - cy + extent) * 50 / extent + '%',
    width: piece.w * 50 / extent + '%', height: piece.h * 50 / extent + '%'
  });
  const shape = piece.node;
  shape.id = 'intro-loader-part-' + index;
  for (const path of shape.querySelectorAll('path,polygon,rect,circle')) path.setAttribute('pathLength', '1');
  defs.append(shape);

  // Paint the progressively traced contours once. Sliding this strip reveals
  // the next trace frame without repainting SVG strokes during scene setup.
  const strip = document.createElement('div');
  strip.className = 'intro-loader-strip';
  strip.style.width = frames * 100 + '%';
  const ink = svgNode('svg');
  ink.setAttribute('viewBox', `0 0 ${piece.w * frames} ${piece.h}`);
  ink.setAttribute('fill', 'none');
  ink.setAttribute('stroke', '#677680');
  ink.style.stroke = `color-mix(in srgb, ${icon.color} 55%, #d5dbe0)`;
  ink.setAttribute('stroke-width', '3');
  ink.setAttribute('stroke-linejoin', 'round');
  for (let i = frames === 1 ? 0 : 1; i < frames; i++) {
    const use = svgNode('use');
    use.setAttribute('href', '#' + shape.id);
    use.setAttribute('transform', `translate(${i * piece.w - left} ${-top})`);
    if (i < frames - 1) {
      use.setAttribute('stroke-dasharray', '1 1');
      use.setAttribute('stroke-dashoffset', 1 - i / (frames - 1));
    }
    ink.append(use);
  }
  strip.append(ink);
  tile.append(strip);
  stage.append(tile);
  return {tile, strip};
}

function keepLastTraceFrame(piece) {
  if (piece.strip.style.width === '100%') return;
  const ink = piece.strip.firstElementChild;
  ink.replaceChildren(ink.lastElementChild);
  ink.setAttribute('viewBox', `${(TRACE_FRAMES - 1) * piece.w} 0 ${piece.w} ${piece.h}`);
  Object.assign(piece.strip.style, {width:'100%', transform:'none', willChange:'auto'});
}

export function createLoadingAssembly(field, icon, reducedMotion) {
  const layout = layOutPieces(field, icon);
  const {pieces, cx, cy} = layout, stage = field.parentElement;
  const defs = svgNode('defs');
  const mask = field.querySelector('clipPath');
  if (mask) defs.append(mask);
  const whole = svgNode('g');
  whole.innerHTML = icon.svg;
  field.replaceChildren(defs, whole);
  field.style.opacity = '0';

  const now = () => document.timeline.currentTime ?? performance.now();
  const start = now();
  const traced = `translateX(${-100 * (TRACE_FRAMES - 1) / TRACE_FRAMES}%)`;
  let nextFlight = start + TRACE_MS + 160, scheduled = 0, onSettled, finishTimer;
  let quiet = reducedMotion.matches || document.hidden;
  // The stage carries the assembled body between impacts. Free pieces still
  // float independently inside it, and the percentage label stays stationary.
  const drift = Array.from({length:25}, (_, step) => {
    const phase = step / 24 * 2 * Math.PI;
    return {transform:`translate(${2.7 * Math.sin(phase)}%,${1.9 * Math.cos(phase)}%) rotate(${4 * Math.sin(phase)}deg)`};
  });
  function floatStage() {
    animateAt(stage, drift, now(), 6800, {iterations:Infinity});
  }
  if (!quiet) floatStage();
  const impacts = [];
  // Work backwards from the upright artwork. Each hit can spend its angular
  // momentum in one direction and come to rest without unwinding afterwards.
  let restingAngle = 0;
  for (let i = pieces.length - 1; i >= 0; i--) {
    pieces[i].restingAngle = restingAngle;
    const travel = i === 0 ? .46 : 1.55 / Math.sqrt(1 + (i - 1) * .23);
    restingAngle -= pieces[i].spin * travel;
  }
  let initialAngle = restingAngle;
  if (quiet) initialAngle = restingAngle = 0;
  for (const [i, piece] of pieces.entries()) {
    Object.assign(piece, createTile(piece, i, layout, stage, defs, icon, quiet ? 1 : TRACE_FRAMES));
    piece.roll = -piece.spin * (1.2 + .25 * Math.cos(i));
    piece.period = 3200 + i * 91;
    piece.tile.style.transform = transform(piece, piece.homeX, piece.homeY, piece.roll);
    if (!quiet) {
      piece.strip.style.transform = traced;
      floatPiece(piece, start);
      const trace = animateAt(piece.strip, [{transform:'translateX(0%)'}, {transform:traced}],
        start + i * 6, TRACE_MS, {easing:`steps(${TRACE_FRAMES - 1}, end)`, fill:'backwards'});
      trace.finished.then(() => keepLastTraceFrame(piece), () => {});
    }
  }

  function clusterPose(time) {
    let x = cx, y = cy, angle = initialAngle;
    for (const impact of impacts) {
      const t = Math.min(1, Math.max(0, (time - impact.time) / IMPACT_MS));
      const drag = 1 - t;
      const recoil = Math.sin(15 * t) * drag ** 5;
      x += impact.pushX * recoil;
      y += impact.pushY * recoil;
      angle += impact.turn * (1 - drag ** 3);
    }
    return {x, y, angle};
  }

  function attachedPose(piece, cluster) {
    const dx = piece.x - cx, dy = piece.y - cy;
    const cos = Math.cos(cluster.angle), sin = Math.sin(cluster.angle);
    return {x:cluster.x + dx * cos - dy * sin, y:cluster.y + dx * sin + dy * cos, angle:cluster.angle};
  }

  function dock(index, takeoff) {
    const piece = pieces[index], hit = takeoff + FLIGHT_MS;
    if (quiet) {
      piece.tile.style.transform = 'none';
      return;
    }
    const from = piece.float ? floatingPose(piece, takeoff - piece.float.startTime)
      : {x:piece.homeX, y:piece.homeY, angle:piece.roll};
    const seat = attachedPose(piece, clusterPose(hit));
    const angleDelta = seat.angle - from.angle;
    const flightTurn = Math.atan2(Math.sin(angleDelta), Math.cos(angleDelta));
    const approach = [0, .16, .32, .48, .64, .80, .92, 1].map(t => {
      const pull = t * t, arc = Math.sin(Math.PI * t) * piece.spin * 28;
      const x = from.x + (seat.x - from.x) * pull - piece.dy * arc;
      const y = from.y + (seat.y - from.y) * pull + piece.dx * arc;
      return {offset:t, transform:transform(piece, x, y, from.angle + flightTurn * pull)};
    });
    animateAt(piece.tile, approach, takeoff, FLIGHT_MS);
    // Transfer the incoming velocity, including the tangent of its curved
    // approach. Overlapping hits add to the same rigid body's motion.
    const vx = 2 * (seat.x - from.x) + Math.PI * piece.dy * piece.spin * 28;
    const vy = 2 * (seat.y - from.y) - Math.PI * piece.dx * piece.spin * 28;
    const strength = (index === 0 ? 35 : 72) / (Math.sqrt(1 + index * .18) * (Math.hypot(vx, vy) || 1));
    impacts.push({time:hit, pushX:vx * strength, pushY:vy * strength, turn:piece.restingAngle - restingAngle});
    restingAngle = piece.restingAngle;
    const samples = Array.from({length:41}, (_, step) => clusterPose(hit + IMPACT_MS * step / 40));
    for (let j = 0; j <= index; j++) {
      const body = pieces[j];
      const recoil = samples.map(cluster => {
        const {x, y, angle} = attachedPose(body, cluster);
        return {transform:transform(body, x, y, angle)};
      });
      animateAt(body.tile, recoil, hit, IMPACT_MS, {fill:'forwards'});
    }
  }

  function schedule(count) {
    while (scheduled < count) {
      const takeoff = Math.max(now() + 20, nextFlight);
      dock(scheduled++, takeoff);
      nextFlight = takeoff + FLIGHT_MS;
    }
  }
  function stop() {
    clearTimeout(finishTimer);
    reducedMotion.removeEventListener('change', motionChange);
    document.removeEventListener('visibilitychange', motionChange);
    for (const animation of stage.getAnimations({subtree:true})) animation.cancel();
  }
  function complete() {
    stop();
    for (const {tile} of pieces) tile.remove();
    field.style.opacity = '1';
    onSettled();
  }
  function motionChange() {
    const shouldRest = reducedMotion.matches || document.hidden;
    if (quiet === shouldRest) return;
    quiet = shouldRest;
    if (!quiet) {
      floatStage();
      for (const piece of pieces.slice(scheduled)) floatPiece(piece, now());
      return;
    }
    impacts.length = 0;
    initialAngle = restingAngle = 0;
    for (const animation of stage.getAnimations({subtree:true})) animation.cancel();
    for (const piece of pieces) {
      piece.float = null;
      keepLastTraceFrame(piece);
    }
    pieces.slice(0, scheduled).forEach(piece => { piece.tile.style.transform = 'none'; });
    nextFlight = now();
    if (onSettled) complete();
  }
  reducedMotion.addEventListener('change', motionChange);
  document.addEventListener('visibilitychange', motionChange);
  return {
    update(percent) { schedule(Math.ceil(percent / 100 * (pieces.length - 1))); },
    finish(callback) {
      onSettled = callback;
      schedule(pieces.length);
      if (quiet) { complete(); return; }
      const fillAt = nextFlight + IMPACT_MS;
      const settleFrom = getComputedStyle(stage).transform;
      const settleStart = now();
      animateAt(stage, [{transform:settleFrom}, {transform:'none'}], settleStart, fillAt - settleStart,
        {easing:'ease-out', fill:'forwards'});
      animateAt(field, [{opacity:0}, {opacity:1}], fillAt, 230, {fill:'forwards'});
      for (const {tile} of pieces) animateAt(tile, [{opacity:1}, {opacity:0}], fillAt, 230, {fill:'forwards'});
      finishTimer = setTimeout(complete, Math.max(0, fillAt - now()) + 370);
    },
    stop
  };
}
