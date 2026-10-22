import test from 'node:test';
import assert from 'node:assert/strict';
import { startFluid } from '../src/js/background.js';

// Exercise actual engine control flow, resource ownership and per-finger input.
// The GL substitute does not certify visual quality or real GPU performance.
const devices = [
  { name: 'Desktop accepted glow', touch: false, width: 1316, height: 900, webgl2: true, linear: true, sunrays: false, splats: 5, intensity: 0.4 },
  { name: 'Tablet unchanged glow', touch: true, width: 820, height: 1180, webgl2: true, linear: true, sunrays: true, intensity: 0.4 },
  { name: 'Phone without optional float32 filtering', touch: true, width: 390, height: 844, webgl2: true, linear: false, sunrays: true, splats: 12, intensity: 0.5 },
  { name: 'Legacy phone without linear filtering', touch: true, width: 390, height: 844, webgl2: false, linear: false, sunrays: true, splats: 12, intensity: 0.5 },
];
for (const device of devices) {
  test(`${device.name}: glow, rotation cleanup and independent fingers`, () => {
    const saved = Object.fromEntries(['window', 'document', 'matchMedia', 'requestAnimationFrame',
      'cancelAnimationFrame', 'Image'].map(key => [key, globalThis[key]]));
    const textures = new Set(), framebuffers = new Set(), frames = new Map(), handlers = new Map();
    const shaderSources = [], colors = [], intensities = [];
    let frameId = 0;
    const canvas = { clientWidth: device.width, clientHeight: device.height, width: device.width, height: device.height };
    const constants = new Map();
    const uniforms = ['uTexture','uBloom','uSunrays','uDithering','ditherScale','texelSize','dyeTexelSize',
      'curl','dt','uVelocity','uCurl','uPressure','uDivergence','dissipation','weight','threshold','curve',
      'intensity','value','aspectRatio','point','color','radius','uTarget','uSource'];
    const methods = {
      getExtension: name => name === 'OES_texture_half_float' ? { HALF_FLOAT_OES: 36193 }
        : name.endsWith('_linear') && !device.linear ? null : {},
      createTexture: () => { const value = {}; textures.add(value); return value; },
      createFramebuffer: () => { const value = {}; framebuffers.add(value); return value; },
      deleteTexture: value => textures.delete(value), deleteFramebuffer: value => framebuffers.delete(value),
      createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}),
      checkFramebufferStatus: () => gl.FRAMEBUFFER_COMPLETE, getShaderParameter: () => true,
      getProgramParameter: (_, param) => param === gl.ACTIVE_UNIFORMS ? uniforms.length : true,
      getActiveUniform: (_, index) => ({ name: uniforms[index] }), getUniformLocation: (_, name) => name,
      shaderSource: (_, source) => shaderSources.push(source),
      uniform3f: (name, ...values) => { if (name === 'color') colors.push(values); },
      uniform1f: (name, value) => { if (name === 'intensity') intensities.push(value); },
    };
    const gl = new Proxy({}, { get(_, key) {
      if (key === 'drawingBufferWidth') return canvas.width;
      if (key === 'drawingBufferHeight') return canvas.height;
      if (methods[key]) return methods[key];
      if (/^[A-Z0-9_]+$/.test(key)) {
        if (!constants.has(key)) constants.set(key, constants.size + 1);
        return constants.get(key);
      }
      return () => {};
    } });
    canvas.getContext = name => name === 'webgl2' && !device.webgl2 ? null : gl;
    const frame = () => { const [id, callback] = frames.entries().next().value; frames.delete(id); callback(); };
    const finger = (identifier, clientX, clientY) => ({ identifier, clientX, clientY });
    try {
      globalThis.window = { devicePixelRatio: 3, screen: { width: device.width, height: device.height } };
      globalThis.document = { addEventListener(type, fn) { handlers.set(type, fn); } };
      globalThis.matchMedia = () => ({ matches: device.touch });
      globalThis.Image = class {};
      globalThis.requestAnimationFrame = fn => { frames.set(++frameId, fn); return frameId; };
      globalThis.cancelAnimationFrame = id => frames.delete(id);
      const fluid = startFluid(canvas);
      assert.ok(shaderSources.some(source => source.includes('#define BLOOM') && source.includes('#define SHADING')));
      assert.equal(shaderSources.some(source => source.includes('#define SUNRAYS')), device.sunrays);
      assert.equal(intensities.at(-1), device.intensity);
      if (device.splats) assert.equal(colors.length, device.splats * 2);
      else assert.ok(colors.length >= 10 && colors.length <= 48);
      const live = [textures.size, framebuffers.size];
      fluid.setActive(true);
      for (let index = 0; index < 6; index++) {
        [canvas.clientWidth, canvas.clientHeight] = [canvas.clientHeight, canvas.clientWidth]; frame();
        assert.deepEqual([textures.size, framebuffers.size], live, 'Rotation must not accumulate GPU buffers');
      }
      if (device.touch) {
        handlers.get('touchstart')({ changedTouches: [finger(1, 40, 90), finger(2, 200, 300)] });
        colors.length = 0;
        handlers.get('touchmove')({ touches: [finger(1, 65, 120), finger(2, 240, 330)] }); frame();
        assert.equal(colors.length, 4, 'Each of two fingers must inject velocity and dye');
        handlers.get('touchend')({ changedTouches: [finger(1, 65, 120)] }); colors.length = 0;
        handlers.get('touchmove')({ touches: [finger(1, 90, 160), finger(2, 265, 350)] }); frame();
        assert.equal(colors.length, 2, 'Releasing one finger must not release the other');
        handlers.get('touchcancel')({ changedTouches: [finger(2, 265, 350)] }); colors.length = 0;
        handlers.get('touchmove')({ touches: [finger(2, 280, 375)] }); frame();
        assert.equal(colors.length, 0, 'Cancelled fingers must not remain stuck down');
      }
      fluid.dispose(); assert.equal(frames.size, 0);
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
      }
    }
  });
}
