const pages = document.querySelector('.pages');
const panels = [...document.querySelectorAll('.page')];
const contents = panels.map(panel => panel.querySelector('.intro-content, .profile'));
const canvas = document.querySelector('#background');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

// One progress value moves two transparent screens over a shared background.
// Dragging has resistance; a damped spring settles or returns to the original page.
const resistance = 0.72;
const threshold = 0.16;
const touchThreshold = 0.1;
let progress = location.hash === '#links' ? 1 : 0;
let currentPage = Math.round(progress);
let animation;
let drag;
let fluid;
let wheelDistance = 0;
let wheelLocked = false;
let wheelTimer;
let suppressClick = false;
let multiTouch = false;
let edgeOffset = 0;

function resetNativeScroll() {
  // Page position belongs to progress, never to a restored hidden scroll offset.
  pages.scrollTop = 0;
  pages.scrollLeft = 0;
}

function render() {
  resetNativeScroll();
  const clamped = Math.max(0, Math.min(1, progress));
  panels[0].style.transform = `translate3d(0, ${-progress * 100}%, 0)`;
  panels[1].style.transform = `translate3d(0, ${(1 - progress) * 100}%, 0)`;
  contents.forEach((content, index) => {
    content.style.transform = `translate3d(0, ${index === currentPage ? edgeOffset : 0}px, 0)`;
  });
  canvas.style.opacity = 1 - clamped;
  // Keep visible fluid continuous on both mouse and touch, including held drags.
  fluid?.setActive(!document.hidden && !reducedMotion.matches && clamped < 0.98);
}

function markPage() {
  panels.forEach((panel, index) => {
    panel.inert = index !== currentPage;
    panel.setAttribute('aria-hidden', String(index !== currentPage));
  });
}

function settle(target, velocity = 0, focus = false) {
  cancelAnimationFrame(animation);
  if (target !== currentPage) edgeOffset = 0;
  currentPage = target;
  markPage();
  const finish = () => {
    animation = null;
    progress = target;
    edgeOffset = 0;
    render();
    if (focus) {
      panels[target].tabIndex = -1;
      panels[target].focus({ preventScroll: true });
    }
  };
  if (reducedMotion.matches) { finish(); return; }
  let previousTime;
  let edgeVelocity = 0;
  const step = time => {
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.032) : 1 / 60;
    previousTime = time;
    velocity += ((target - progress) * 180 - velocity * 27) * dt;
    progress = Math.max(0, Math.min(1, progress + velocity * dt));
    edgeVelocity += (-edgeOffset * 180 - edgeVelocity * 27) * dt;
    edgeOffset += edgeVelocity * dt;
    if (Math.abs(target - progress) < 0.0005 && Math.abs(velocity) < 0.005
        && Math.abs(edgeOffset) < 0.1 && Math.abs(edgeVelocity) < 0.5) { finish(); return; }
    render();
    animation = requestAnimationFrame(step);
  };
  animation = requestAnimationFrame(step);
  render();
}

function resistBoundary(value) {
  // The gesture has resistance between pages, but cannot lift the outer edges.
  return Math.max(0, Math.min(1, value));
}

function beginDrag(event) {
  if (!event.isPrimary || event.button !== 0) return;
  cancelAnimationFrame(animation);
  animation = null;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: progress,
    origin: currentPage, height: pages.clientHeight, lastY: event.clientY,
    lastTime: event.timeStamp, velocity: 0, moved: false, target: event.target, scrolled: false,
    pointerType: event.pointerType };
  render();
}

function moveDrag(event) {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = drag.y - event.clientY;
  // Large text/short screens can scroll inside a panel. At its edge, the same
  // touch continues into the page gesture rather than disabling navigation.
  const panel = panels[drag.origin];
  if (event.pointerType === 'touch' && !drag.moved && panel.classList.contains('scrollable')) {
    const top = panel.scrollTop;
    const next = Math.max(0, Math.min(panel.scrollHeight - panel.clientHeight,
      top + drag.lastY - event.clientY));
    if (Math.abs(next - top) > 0.1) {
      panel.scrollTop = next;
      drag.scrolled = true;
      drag.x = event.clientX; drag.y = event.clientY;
      drag.lastY = event.clientY; drag.lastTime = event.timeStamp;
      return;
    }
  }
  if (!drag.moved) {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      drag = null;
      if (Math.abs(progress - currentPage) > 0.0005 || edgeOffset) settle(currentPage);
      else render();
      return;
    }
    if (Math.abs(dy) < 8) return;
    drag.moved = true;
    if (event.pointerType !== 'touch') pages.setPointerCapture(event.pointerId);
  }
  const elapsed = event.timeStamp - drag.lastTime;
  if (elapsed > 0) drag.velocity = (drag.lastY - event.clientY) / elapsed;
  drag.lastY = event.clientY;
  drag.lastTime = event.timeStamp;
  const proposed = drag.start + dy / drag.height * resistance;
  progress = resistBoundary(proposed);
  // Only central content yields at touch boundaries. The pages and background
  // stay fixed, with increasing resistance and a small maximum displacement.
  const overflow = (proposed - progress) * drag.height / resistance;
  const limit = Math.min(80, drag.height * 0.1);
  edgeOffset = event.pointerType === 'touch' && !reducedMotion.matches
    ? -Math.sign(overflow) * limit * (1 - Math.exp(-Math.abs(overflow) * 0.32 / limit)) : 0;
  render();
}

function endDrag(cancelled = false, event) {
  if (!drag || (event && drag.id !== event.pointerId)) return;
  const gesture = drag;
  drag = null;
  if (typeof gesture.id === 'number' && pages.hasPointerCapture(gesture.id)) pages.releasePointerCapture(gesture.id);
  suppressClick = gesture.moved;
  setTimeout(() => { suppressClick = false; }, 0);
  const distance = progress - gesture.origin;
  const velocity = event && event.timeStamp - gesture.lastTime < 100 ? gesture.velocity : 0;
  const touch = gesture.pointerType === 'touch';
  const flick = Math.abs(velocity) > (touch ? 0.4 : 0.55) && Math.abs(distance) > 0.035
    && Math.sign(velocity) === Math.sign(distance);
  const target = !cancelled && (Math.abs(distance) > (touch ? touchThreshold : threshold) || flick)
    ? Math.max(0, Math.min(1, gesture.origin + Math.sign(distance))) : gesture.origin;
  settle(target, cancelled ? 0 : velocity * 1000 / gesture.height * resistance);
}

// Touch uses one explicit, non-passive stream. Pointer events still drive mouse
// and pen, but never process a second copy of the same finger gesture.
pages.addEventListener('pointerdown', event => { if (event.pointerType !== 'touch') beginDrag(event); });
pages.addEventListener('pointermove', event => { if (event.pointerType !== 'touch') moveDrag(event); });
pages.addEventListener('pointerup', event => { if (event.pointerType !== 'touch') endDrag(false, event); });
pages.addEventListener('pointercancel', event => { if (event.pointerType !== 'touch') endDrag(true, event); });
pages.addEventListener('lostpointercapture', event => { if (event.pointerType !== 'touch') endDrag(true, event); });

function touchPoint(touch, event) {
  return { pointerId: `touch-${touch.identifier}`, pointerType: 'touch', isPrimary: true,
    button: 0, clientX: touch.clientX, clientY: touch.clientY, timeStamp: event.timeStamp, target: event.target };
}
const blockDefault = event => { if (event.cancelable) event.preventDefault(); };
pages.addEventListener('touchstart', event => {
  if (event.touches.length !== 1 || multiTouch) {
    multiTouch = true;
    blockDefault(event);
    endDrag(true);
    return;
  }
  beginDrag(touchPoint(event.touches[0], event));
}, { passive: false });
// Root capture also blocks iOS rubber-banding and pinch defaults at either edge.
document.addEventListener('touchmove', event => {
  blockDefault(event);
  if (multiTouch || event.touches.length !== 1) { multiTouch = true; endDrag(true); return; }
  moveDrag(touchPoint(event.touches[0], event));
}, { passive: false, capture: true });
document.addEventListener('touchend', event => {
  if (multiTouch) { blockDefault(event); multiTouch = event.touches.length > 0; return; }
  const touch = Array.from(event.changedTouches).find(value => `touch-${value.identifier}` === drag?.id);
  if (touch) {
    const tappedLink = !drag.moved && !drag.scrolled ? drag.target?.closest?.('a') : null;
    blockDefault(event);
    endDrag(false, touchPoint(touch, event));
    // Explicit tap activation survives tiny touchmove jitter; preventDefault
    // above suppresses the duplicate delayed compatibility click on iOS.
    tappedLink?.click();
  }
}, { passive: false });
document.addEventListener('touchcancel', event => {
  endDrag(true);
  multiTouch = event.touches.length > 0;
}, { passive: true });
for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(type, blockDefault, { passive: false });
}
document.addEventListener('dblclick', event => { if (event.pointerType === 'touch') blockDefault(event); });

// Trackpad inertia can send many events; one uninterrupted burst changes one page.
pages.addEventListener('wheel', event => {
  if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)
      || panels[currentPage].classList.contains('scrollable')) return;
  event.preventDefault();
  clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => { wheelLocked = false; wheelDistance = 0; }, 220);
  if (wheelLocked || drag) return;
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? pages.clientHeight : 1);
  if (Math.sign(delta) !== Math.sign(wheelDistance)) wheelDistance = 0;
  wheelDistance += delta;
  if (Math.abs(wheelDistance) < 65) return;
  wheelLocked = true;
  settle(Math.max(0, Math.min(1, currentPage + Math.sign(wheelDistance))));
}, { passive: false });

pages.addEventListener('click', event => {
  if (suppressClick) { event.preventDefault(); event.stopPropagation(); return; }
  const anchor = event.target.closest('a[href^="#"]');
  if (!anchor) return;
  event.preventDefault();
  settle(anchor.hash === '#links' ? 1 : 0, 0, true);
}, { capture: true });

document.addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === ' ' && event.target.closest('a, button')) return;
  const forward = ['ArrowDown', 'PageDown', 'End', ' '].includes(event.key);
  const backward = ['ArrowUp', 'PageUp', 'Home', 'Escape'].includes(event.key);
  if (!forward && !backward) return;
  if (panels[currentPage].classList.contains('scrollable') && ['ArrowDown', 'ArrowUp', ' '].includes(event.key)) return;
  event.preventDefault();
  settle(forward ? 1 : 0, 0, true);
});

function checkOverflow() {
  panels.forEach(panel => panel.classList.toggle('scrollable', panel.scrollHeight > panel.clientHeight + 2));
}
let viewportWidth = pages.clientWidth;
window.addEventListener('load', () => { resetNativeScroll(); checkOverflow(); render(); });
window.addEventListener('pageshow', () => { resetNativeScroll(); render(); });
pages.addEventListener('scroll', resetNativeScroll, { passive: true });
window.addEventListener('resize', () => {
  // Mobile browser chrome can resize height while a finger is down. Do not
  // cancel a valid swipe for that; its scale was captured when it started.
  if (drag && pages.clientWidth !== viewportWidth) endDrag(true);
  viewportWidth = pages.clientWidth;
  checkOverflow(); render();
}, { passive: true });
window.addEventListener('hashchange', () => settle(location.hash === '#links' ? 1 : 0));
window.addEventListener('blur', () => { multiTouch = false; if (drag) endDrag(true); });
document.addEventListener('visibilitychange', () => { if (drag) endDrag(true); render(); });
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) settle(currentPage);
  else if (!fluid) initBackground();
  render();
});

let loadingBackground = false;
let backgroundLost = false;
canvas.addEventListener('webglcontextlost', event => {
  event.preventDefault();
  backgroundLost = true;
  fluid?.dispose();
  fluid = null;
});
canvas.addEventListener('webglcontextrestored', () => {
  backgroundLost = false;
  initBackground();
});
async function initBackground() {
  if (backgroundLost || reducedMotion.matches || fluid || loadingBackground) return;
  loadingBackground = true;
  try {
    const { startFluid } = await import('./background.js');
    fluid = startFluid(canvas);
    render();
  } catch (error) {
    console.info('Fluid background unavailable; using static background.', error.message);
  } finally { loadingBackground = false; }
}

document.documentElement.classList.add('enhanced');
resetNativeScroll();
panels.forEach(panel => { panel.scrollTop = 0; });
markPage();
checkOverflow();
document.fonts.ready.then(checkOverflow);
render();
setTimeout(initBackground, 0);
