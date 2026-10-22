import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
function setup({ reduced = false, coarse = false, hash = '', overflow = false, restoredScroll = 0 } = {}) {
  const handlers = new Map();
  let frames = [];
  const timers = new Map();
  let timerId = 0;
  function element() {
    const classes = new Set();
    return { style: {}, attrs: {}, clientHeight: 800, clientWidth: 390, scrollTop: 0,
      scrollHeight: overflow ? 1200 : 800,
      classList: { add: key => classes.add(key), contains: key => classes.has(key),
        toggle: (key, on) => on ? classes.add(key) : classes.delete(key) },
      setAttribute(key, value) { this.attrs[key] = value; },
      focus() { this.focused = true; },
      addEventListener(type, fn) { handlers.set(type, fn); },
      setPointerCapture() {}, hasPointerCapture() { return false; } };
  }
  const pages = element(), panels = [element(), element()], canvas = element();
  const contents = [element(), element()];
  panels.forEach((panel, index) => { panel.querySelector = () => contents[index]; });
  pages.scrollTop = restoredScroll;
  const history = { scrollRestoration: 'auto' };
  const document = { hidden: false, documentElement: element(), fonts: { ready: Promise.resolve() },
    querySelector: key => key === '.pages' ? pages : canvas,
    querySelectorAll: () => panels, addEventListener(type, fn) { handlers.set(type, fn); } };
  const backgroundStates = [];
  const context = vm.createContext({ document, location: { hash }, history, console, backgroundStates,
    matchMedia: query => ({ matches: query.includes('pointer') ? coarse : reduced, addEventListener() {} }),
    window: { addEventListener(type, fn) { handlers.set('window:' + type, fn); } }, requestIdleCallback() {},
    requestAnimationFrame(fn) { frames.push(fn); return fn; },
    cancelAnimationFrame(fn) { frames = frames.filter(value => value !== fn); },
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); } });
  context.window.requestIdleCallback = context.requestIdleCallback;
  vm.runInContext(code, context, { importModuleDynamically() { throw Error('Unexpected background load'); } });
  vm.runInContext('fluid = { setActive: value => backgroundStates.push(value) }; render();', context);
  function emit(type, fields = {}) {
    handlers.get(type)({ isPrimary: true, button: 0, pointerId: 1, clientX: 200, clientY: 600,
      timeStamp: 0, deltaX: 0, deltaY: 0, deltaMode: 0,
      target: { closest: () => null }, cancelable: true,
      preventDefault() {}, stopPropagation() {}, ...fields });
  }
  function finish() {
    for (let count = 0; frames.length && count < 300; count++) {
      const batch = frames; frames = [];
      batch.forEach(fn => fn((count + 1) * 16.667));
    }
    assert.equal(frames.length, 0, 'Spring must settle');
  }
  function swipe(from, to, duration = 500, cancelled = false) {
    emit('pointerdown', { clientY: from });
    emit('pointermove', { clientY: to, timeStamp: duration });
    emit(cancelled ? 'pointercancel' : 'pointerup', { clientY: to, timeStamp: duration + 10 });
    finish();
  }
  return { emit, finish, swipe, panels, contents, pages, canvas, history, backgroundStates,
    current: () => panels[1].attrs['aria-hidden'] === 'false' ? 1 : 0,
    flushTimers: () => { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); } };
}

test('Small deliberate drags return; committed drags move in both directions repeatedly', () => {
  const ui = setup();
  ui.swipe(600, 530); assert.equal(ui.current(), 0);
  for (let i = 0; i < 4; i++) {
    ui.swipe(600, 300); assert.equal(ui.current(), 1);
    ui.swipe(300, 360); assert.equal(ui.current(), 1);
    ui.swipe(300, 600); assert.equal(ui.current(), 0);
  }
});
test('A clear fast flick commits; cancelled and horizontal gestures return', () => {
  const ui = setup();
  ui.swipe(600, 490, 70); assert.equal(ui.current(), 1);
  ui.swipe(300, 600, 200, true); assert.equal(ui.current(), 1);
  ui.emit('pointerdown');
  ui.emit('pointermove', { clientX: 500, clientY: 580 });
  ui.finish(); assert.equal(ui.current(), 1);
});
test('Boundary drags settle without exposing another screen', () => {
  const ui = setup();
  ui.swipe(300, 700); assert.equal(ui.current(), 0);
  assert.equal(ui.panels[0].style.transform, 'translate3d(0, 0%, 0)');
  ui.swipe(600, 300); ui.swipe(600, 200); assert.equal(ui.current(), 1);
  assert.equal(ui.panels[1].style.transform, 'translate3d(0, 0%, 0)');
});
test('Wheel noise and one inertial burst cannot make accidental return trips', () => {
  const ui = setup();
  ui.emit('wheel', { deltaY: 20 }); assert.equal(ui.current(), 0);
  ui.emit('wheel', { deltaY: 60 }); ui.finish(); assert.equal(ui.current(), 1);
  ui.emit('wheel', { deltaY: -300 }); ui.finish(); assert.equal(ui.current(), 1);
  ui.flushTimers(); ui.emit('wheel', { deltaY: -100 }); ui.finish(); assert.equal(ui.current(), 0);
});
test('Click, keyboard, deep link, and reduced motion keep navigation accessible', () => {
  const ui = setup({ reduced: true, hash: '#links' }); assert.equal(ui.current(), 1);
  ui.emit('keydown', { key: 'Home' }); assert.equal(ui.current(), 0);
  assert.equal(ui.panels[0].focused, true); assert.equal(ui.panels[1].inert, true);
  ui.emit('click', { target: { closest: () => ({ hash: '#links' }) } }); assert.equal(ui.current(), 1);
  ui.emit('keydown', { key: 'PageUp' }); assert.equal(ui.current(), 0);
});
test('Overflow panels retain pointer navigation and keyboard access', () => {
  const ui = setup({ overflow: true });
  ui.swipe(600, 100); assert.equal(ui.current(), 1);
  ui.emit('wheel', { deltaY: -200 }); assert.equal(ui.current(), 1);
  ui.emit('keydown', { key: 'PageUp' }); ui.finish(); assert.equal(ui.current(), 0);
  ui.emit('keydown', { key: 'PageDown' }); ui.finish(); assert.equal(ui.current(), 1);
});

test('Desktop slow vertical drags keep fluid running until release', () => {
  const ui = setup();
  ui.emit('pointerdown');
  ui.emit('pointermove', { clientY: 560, timeStamp: 1500 });
  assert.equal(ui.backgroundStates.at(-1), true, 'Holding a slow desktop drag must not freeze the fluid');
  ui.emit('pointerup', { clientY: 560, timeStamp: 2500 });
  ui.finish();
  assert.equal(ui.current(), 0);
  assert.equal(ui.backgroundStates.at(-1), true);
});

test('Touch drags keep visible fluid alive instead of freezing it', () => {
  const ui = setup({ coarse: true });
  ui.emit('pointerdown');
  ui.emit('pointermove', { clientY: 560, timeStamp: 1500 });
  assert.equal(ui.backgroundStates.at(-1), true);
  ui.emit('pointercancel', { clientY: 560, timeStamp: 2000 });
  ui.finish();
  assert.equal(ui.current(), 0);
  assert.equal(ui.backgroundStates.at(-1), true);
});

function finger(y, identifier = 7) { return { identifier, clientX: 200, clientY: y }; }
function touchStart(ui, y) { ui.emit('touchstart', { touches: [finger(y)], timeStamp: 0 }); }
function touchMove(ui, y, timeStamp = 500) {
  let prevented = false;
  ui.emit('touchmove', { touches: [finger(y)], timeStamp, preventDefault() { prevented = true; } });
  assert.equal(prevented, true, 'Native pan/zoom must be prevented');
}
function touchEnd(ui, y, timeStamp = 520) {
  ui.emit('touchend', { touches: [], changedTouches: [finger(y)], timeStamp }); ui.finish();
}
test('iOS touch stream switches up and down without duplicate pointer handling', () => {
  const ui = setup({ coarse: true });
  for (let i = 0; i < 3; i++) {
    ui.emit('pointerdown', { pointerType: 'touch' });
    touchStart(ui, 600); touchMove(ui, 300);
    ui.emit('pointercancel', { pointerType: 'touch' });
    touchEnd(ui, 300); assert.equal(ui.current(), 1);
    touchStart(ui, 300); touchMove(ui, 600); touchEnd(ui, 600); assert.equal(ui.current(), 0);
  }
});
test('iOS browser height changes do not cancel the swipe', () => {
  const ui = setup({ coarse: true });
  touchStart(ui, 600); touchMove(ui, 450, 300);
  ui.pages.clientHeight = 720;
  ui.emit('window:resize');
  touchMove(ui, 300, 600); touchEnd(ui, 300, 620);
  assert.equal(ui.current(), 1);
});
test('Overflow touch content scrolls internally and switches at its boundary', () => {
  const ui = setup({ coarse: true, overflow: true });
  touchStart(ui, 700); touchMove(ui, 200); touchEnd(ui, 200);
  assert.equal(ui.current(), 0); assert.equal(ui.panels[0].scrollTop, 400);
  touchStart(ui, 600); touchMove(ui, 300); touchEnd(ui, 300); assert.equal(ui.current(), 1);
  touchStart(ui, 300); touchMove(ui, 600); touchEnd(ui, 600); assert.equal(ui.current(), 0);
});
test('Pinch is blocked, cancelled cleanly, and does not latch later swipes', () => {
  const ui = setup({ coarse: true });
  touchStart(ui, 600);
  let blocked = false;
  ui.emit('touchstart', { touches: [finger(600), finger(400, 8)], preventDefault() { blocked = true; } });
  assert.equal(blocked, true);
  ui.emit('touchend', { touches: [], changedTouches: [finger(600), finger(400, 8)] }); ui.finish();
  touchStart(ui, 600); touchMove(ui, 300); touchEnd(ui, 300); assert.equal(ui.current(), 1);
});
test('Outward touch drags cannot lift the first or last page', () => {
  const ui = setup({ coarse: true });
  touchStart(ui, 300); touchMove(ui, 600);
  assert.equal(ui.panels[0].style.transform, 'translate3d(0, 0%, 0)'); touchEnd(ui, 600);
  touchStart(ui, 600); touchMove(ui, 300); touchEnd(ui, 300);
  touchStart(ui, 600); touchMove(ui, 300);
  assert.equal(ui.panels[1].style.transform, 'translate3d(0, 0%, 0)'); touchEnd(ui, 300);
});

test('Touch boundaries move only central content with capped resistance and spring back', () => {
  const ui = setup({ coarse: true });
  const offset = index => Number(ui.contents[index].style.transform.match(/, ([-\d.]+)px/)[1]);
  touchStart(ui, 300); touchMove(ui, 450);
  const small = offset(0);
  assert.ok(small > 0 && small < 48);
  assert.equal(ui.canvas.style.opacity, 1);
  touchMove(ui, 900);
  assert.ok(offset(0) > small && offset(0) < 80);
  touchEnd(ui, 900);
  assert.equal(offset(0), 0);
  touchStart(ui, 600); touchMove(ui, 300); touchEnd(ui, 300);
  touchStart(ui, 600); touchMove(ui, 200);
  assert.ok(offset(1) < 0 && offset(1) > -80);
  assert.equal(ui.canvas.style.opacity, 0);
  ui.emit('touchcancel', { touches: [] }); ui.finish();
  assert.equal(offset(1), 0);
  assert.equal(ui.current(), 1);
});

test('Boundary feedback clears when reversing, adding fingers, or using reduced motion', () => {
  const ui = setup({ coarse: true });
  touchStart(ui, 300); touchMove(ui, 600);
  touchMove(ui, 200);
  assert.equal(ui.contents[0].style.transform, 'translate3d(0, 0px, 0)');
  touchMove(ui, 600);
  ui.emit('touchstart', { touches: [finger(600), finger(400, 8)] }); ui.finish();
  assert.equal(ui.contents[0].style.transform, 'translate3d(0, 0px, 0)');
  const desktop = setup();
  desktop.swipe(300, 700);
  assert.equal(desktop.contents[0].style.transform, 'translate3d(0, 0px, 0)');
  const reduced = setup({ reduced: true, coarse: true });
  touchStart(reduced, 300); touchMove(reduced, 600);
  assert.equal(reduced.contents[0].style.transform, 'translate3d(0, 0px, 0)');
});

test('A slightly jittery touch tap activates its link exactly once', () => {
  const ui = setup({ coarse: true });
  let clicks = 0;
  const link = { click() { clicks++; } };
  ui.emit('touchstart', { touches: [finger(600)], target: { closest: () => link } });
  touchMove(ui, 598, 50); touchEnd(ui, 598, 80);
  assert.equal(clicks, 1);
  ui.emit('touchstart', { touches: [finger(600)], target: { closest: () => link } });
  touchMove(ui, 300); touchEnd(ui, 300);
  assert.equal(clicks, 1, 'A swipe must not also activate the link');
});

test('A normal slow phone swipe commits without requiring an exaggerated drag', () => {
  const ui = setup({ coarse: true });
  touchStart(ui, 600); touchMove(ui, 550, 600); touchEnd(ui, 550, 650);
  assert.equal(ui.current(), 0, 'A small drag still returns');
  touchStart(ui, 600); touchMove(ui, 480, 600); touchEnd(ui, 480, 650);
  assert.equal(ui.current(), 1);
  touchStart(ui, 300); touchMove(ui, 420, 600); touchEnd(ui, 420, 650);
  assert.equal(ui.current(), 0);
});

test('Cold load and browser page restoration cannot scroll the second panel over first-page fluid', () => {
  const ui = setup({ coarse: true, restoredScroll: 800 });
  assert.equal(ui.pages.scrollTop, 0);
  assert.equal(ui.current(), 0);
  assert.equal(ui.history.scrollRestoration, 'manual');
  assert.equal(ui.canvas.style.opacity, 1);
  for (const type of ['window:load', 'window:pageshow', 'scroll']) {
    ui.pages.scrollTop = 800;
    ui.emit(type);
    assert.equal(ui.pages.scrollTop, 0);
    assert.equal(ui.current(), 0);
  }
});
test('Restoring a native scroll offset on the links page never reveals its fluid background', () => {
  const ui = setup({ coarse: true });
  touchStart(ui, 600); touchMove(ui, 300); touchEnd(ui, 300);
  ui.pages.scrollTop = 800;
  ui.emit('window:pageshow');
  assert.equal(ui.pages.scrollTop, 0);
  assert.equal(ui.current(), 1);
  assert.equal(ui.canvas.style.opacity, 0);
  assert.equal(ui.backgroundStates.at(-1), false);
});
