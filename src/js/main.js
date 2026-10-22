const pages = document.querySelector('.pages');
const panels = [...document.querySelectorAll('.page')];
const canvas = document.querySelector('#background');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const coarsePointer = matchMedia('(pointer: coarse)');

// One progress value moves two transparent screens over a shared background.
// Dragging has resistance; a damped spring settles or returns to the original page.
const resistance = 0.72;
const threshold = 0.16;
let progress = location.hash === '#links' ? 1 : 0;
let currentPage = Math.round(progress);
let animation;
let drag;
let fluid;
let wheelDistance = 0;
let wheelLocked = false;
let wheelTimer;
let suppressClick = false;

function render() {
  const clamped = Math.max(0, Math.min(1, progress));
  panels[0].style.transform = `translate3d(0, ${-progress * 100}%, 0)`;
  panels[1].style.transform = `translate3d(0, ${(1 - progress) * 100}%, 0)`;
  canvas.style.opacity = 1 - clamped;
  // Desktop drags also stir the fluid: keep its simulation running. Only touch
  // devices yield GPU time to page gestures, where smooth navigation takes priority.
  const pauseForGesture = coarsePointer.matches && (animation || drag?.moved);
  fluid?.setActive(!document.hidden && !reducedMotion.matches && !pauseForGesture && clamped < 0.98);
}

function markPage() {
  panels.forEach((panel, index) => {
    panel.inert = index !== currentPage;
    panel.setAttribute('aria-hidden', String(index !== currentPage));
  });
}

function settle(target, velocity = 0, focus = false) {
  cancelAnimationFrame(animation);
  currentPage = target;
  markPage();
  const finish = () => {
    animation = null;
    progress = target;
    render();
    if (focus) {
      panels[target].tabIndex = -1;
      panels[target].focus({ preventScroll: true });
    }
  };
  if (reducedMotion.matches) { finish(); return; }
  let previousTime;
  const step = time => {
    const dt = previousTime ? Math.min((time - previousTime) / 1000, 0.032) : 1 / 60;
    previousTime = time;
    velocity += ((target - progress) * 180 - velocity * 27) * dt;
    progress += velocity * dt;
    if (Math.abs(target - progress) < 0.0005 && Math.abs(velocity) < 0.005) { finish(); return; }
    render();
    animation = requestAnimationFrame(step);
  };
  animation = requestAnimationFrame(step);
  render();
}

function resistBoundary(value) {
  if (value >= 0 && value <= 1) return value;
  const edge = value < 0 ? 0 : 1;
  const excess = value - edge;
  return edge + excess * 0.25 / (1 + Math.abs(excess) * 6);
}

pages.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0 || panels[currentPage].classList.contains('scrollable')) return;
  cancelAnimationFrame(animation);
  animation = null;
  drag = { id: event.pointerId, x: event.clientX, y: event.clientY, start: progress,
    origin: currentPage, lastY: event.clientY, lastTime: event.timeStamp, velocity: 0, moved: false };
  render();
});

pages.addEventListener('pointermove', event => {
  if (!drag || drag.id !== event.pointerId) return;
  const dx = event.clientX - drag.x;
  const dy = drag.y - event.clientY;
  if (!drag.moved) {
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) {
      drag = null;
      if (Math.abs(progress - currentPage) > 0.0005) settle(currentPage);
      else render();
      return;
    }
    if (Math.abs(dy) < 8) return;
    drag.moved = true;
    pages.setPointerCapture(event.pointerId);
  }
  const elapsed = event.timeStamp - drag.lastTime;
  if (elapsed > 0) drag.velocity = (drag.lastY - event.clientY) / elapsed;
  drag.lastY = event.clientY;
  drag.lastTime = event.timeStamp;
  progress = resistBoundary(drag.start + dy / pages.clientHeight * resistance);
  render();
});

function endDrag(cancelled = false, event) {
  if (!drag || (event && drag.id !== event.pointerId)) return;
  const gesture = drag;
  drag = null;
  if (pages.hasPointerCapture(gesture.id)) pages.releasePointerCapture(gesture.id);
  suppressClick = gesture.moved;
  setTimeout(() => { suppressClick = false; }, 0);
  const distance = progress - gesture.origin;
  const velocity = event && event.timeStamp - gesture.lastTime < 100 ? gesture.velocity : 0;
  const flick = Math.abs(velocity) > 0.55 && Math.abs(distance) > 0.035
    && Math.sign(velocity) === Math.sign(distance);
  const target = !cancelled && (Math.abs(distance) > threshold || flick)
    ? Math.max(0, Math.min(1, gesture.origin + Math.sign(distance))) : gesture.origin;
  settle(target, cancelled ? 0 : velocity * 1000 / pages.clientHeight * resistance);
}

pages.addEventListener('pointerup', event => endDrag(false, event));
pages.addEventListener('pointercancel', event => endDrag(true, event));
pages.addEventListener('lostpointercapture', event => endDrag(true, event));

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
window.addEventListener('resize', () => { if (drag) endDrag(true); checkOverflow(); render(); }, { passive: true });
window.addEventListener('hashchange', () => settle(location.hash === '#links' ? 1 : 0));
window.addEventListener('blur', () => { if (drag) endDrag(true); });
document.addEventListener('visibilitychange', () => { if (drag) endDrag(true); render(); });
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) settle(currentPage);
  else if (!fluid) initBackground();
  render();
});

let loadingBackground = false;
async function initBackground() {
  if (reducedMotion.matches || fluid || loadingBackground) return;
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
markPage();
checkOverflow();
document.fonts.ready.then(checkOverflow);
render();
if ('requestIdleCallback' in window) requestIdleCallback(initBackground, { timeout: 1000 });
else setTimeout(initBackground, 0);
