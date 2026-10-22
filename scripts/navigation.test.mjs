import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const code = fs.readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
function setup({ reduced = false, coarse = false, hash = '', overflow = false } = {}) {
  const handlers = new Map();
  let frames = [];
  const timers = new Map();
  let timerId = 0;
  function element() {
    const classes = new Set();
    return { style: {}, attrs: {}, clientHeight: 800, scrollHeight: overflow ? 1200 : 800,
      classList: { add: key => classes.add(key), contains: key => classes.has(key),
        toggle: (key, on) => on ? classes.add(key) : classes.delete(key) },
      setAttribute(key, value) { this.attrs[key] = value; },
      focus() { this.focused = true; },
      addEventListener(type, fn) { handlers.set(type, fn); },
      setPointerCapture() {}, hasPointerCapture() { return false; } };
  }
  const pages = element(), panels = [element(), element()], canvas = element();
  const document = { hidden: false, documentElement: element(), fonts: { ready: Promise.resolve() },
    querySelector: key => key === '.pages' ? pages : canvas,
    querySelectorAll: () => panels, addEventListener(type, fn) { handlers.set(type, fn); } };
  const backgroundStates = [];
  const context = vm.createContext({ document, location: { hash }, console, backgroundStates,
    matchMedia: query => ({ matches: query.includes('pointer') ? coarse : reduced, addEventListener() {} }),
    window: { addEventListener() {} }, requestIdleCallback() {},
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
      target: { closest: () => null }, preventDefault() {}, stopPropagation() {}, ...fields });
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
  return { emit, finish, swipe, panels, pages, backgroundStates,
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
test('Overflow content can scroll naturally instead of being captured by gestures', () => {
  const ui = setup({ overflow: true });
  ui.swipe(600, 100); assert.equal(ui.current(), 0);
  ui.emit('wheel', { deltaY: 200 }); assert.equal(ui.current(), 0);
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

test('Touch gestures still pause fluid and resume after returning to the intro', () => {
  const ui = setup({ coarse: true });
  ui.emit('pointerdown');
  ui.emit('pointermove', { clientY: 560, timeStamp: 1500 });
  assert.equal(ui.backgroundStates.at(-1), false);
  ui.emit('pointercancel', { clientY: 560, timeStamp: 2000 });
  ui.finish();
  assert.equal(ui.current(), 0);
  assert.equal(ui.backgroundStates.at(-1), true);
});
