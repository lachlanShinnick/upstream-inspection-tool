import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  createPhotoCapture,
  encodePhoto,
  openCamera,
  PHOTO_MAX_BYTES,
} from "../src/lib/cameraCapture.ts";

const originals = new Map();
function replaceGlobal(name, value) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

// Model encoding size/driver failures. Real JPEG/orientation and camera speed
// also require the browser/device checks in docs/camera-capture.md.
function canvases(encode = () => new Blob(["jpeg"], { type: "image/jpeg" })) {
  const created = [];
  const draws = [];
  const encodes = [];
  replaceGlobal("document", {
    createElement(tag) {
      assert.equal(tag, "canvas");
      const canvas = {
        width: 0, height: 0,
        getContext() {
          return { drawImage(source) { draws.push(source); } };
        },
        toBlob(callback, type, quality) {
          encodes.push({ width: this.width, height: this.height, quality });
          callback(encode(this, quality, type));
        },
      };
      created.push(canvas);
      return canvas;
    },
  });
  return { created, draws, encodes };
}
const video = { videoWidth: 1920, videoHeight: 1080 };
const track = { kind: "video", readyState: "live" };

test("requests a high-resolution rear stream; rejected constraints retry the old request", async () => {
  const requests = [];
  const stream = {};
  replaceGlobal("navigator", { mediaDevices: { async getUserMedia(constraints) {
    requests.push(constraints);
    if (requests.length === 1) throw new DOMException("unsupported", "OverconstrainedError");
    return stream;
  } } });
  assert.equal(await openCamera(), stream);
  assert.equal(requests[0].video.width.ideal, 3840);
  assert.equal(requests[0].video.height.ideal, 2880);
  assert.deepEqual(requests[1], { video: { facingMode: { ideal: "environment" } }, audio: false });
});

test("permission denial is not retried", async () => {
  let calls = 0;
  replaceGlobal("navigator", { mediaDevices: { async getUserMedia() {
    calls++;
    throw new DOMException("denied", "NotAllowedError");
  } } });
  await assert.rejects(openCamera(), { name: "NotAllowedError" });
  assert.equal(calls, 1);
});

test("portrait dimensions are preserved and small images are never enlarged", async () => {
  const { created } = canvases();
  const portrait = await encodePhoto({}, 3024, 4032);
  assert.deepEqual([portrait.width, portrait.height], [2880, 3840]);
  const small = await encodePhoto({}, 640, 480);
  assert.deepEqual([small.width, small.height], [640, 480]);
  assert.ok(created.every((c) => c.width === 0 && c.height === 0));
});

test("oversized scenes reduce quality then pixels, and snapshot the video only once", async () => {
  const source = {};
  const { draws, encodes, created } = canvases((canvas) => ({
    size: canvas.width * canvas.height,
    type: "image/jpeg",
  }));
  const shot = await encodePhoto(source, 4032, 3024);
  assert.ok(shot.blob.size <= PHOTO_MAX_BYTES);
  assert.ok(shot.width < 3840);
  assert.deepEqual(encodes.slice(0, 3).map((e) => e.quality), [0.9, 0.85, 0.8]);
  assert.equal(draws.filter((s) => s === source).length, 1);
  assert.deepEqual([shot.width, shot.height], [encodes.at(-1).width, encodes.at(-1).height]);
  assert.ok(created.every((c) => c.width === 0 && c.height === 0));
});

test("missing or partial ImageCapture falls back without changing the track", async () => {
  for (const ImageCapture of [undefined, class {}]) {
    const { draws } = canvases();
    replaceGlobal("window", { ImageCapture });
    const shot = await createPhotoCapture(track)(video);
    assert.deepEqual([shot.width, shot.height], [1920, 1080]);
    assert.equal(draws[0], video);
  }
});

test("a throwing ImageCapture constructor falls back", async () => {
  canvases();
  replaceGlobal("window", { ImageCapture: class {
    constructor() { throw new Error("unsupported track"); }
    takePhoto() {}
  } });
  assert.equal((await createPhotoCapture(track)(video)).width, 1920);
});

test("still capture uses the same zoom track and largest advertised still width", async () => {
  const { draws } = canvases();
  let closed = 0;
  let calls = 0;
  const bitmap = { width: 3024, height: 4032, close() { closed++; } };
  replaceGlobal("createImageBitmap", async (_blob, options) => {
    assert.equal(options.imageOrientation, "from-image");
    return bitmap;
  });
  replaceGlobal("window", { ImageCapture: class {
    constructor(receivedTrack) { assert.equal(receivedTrack, track); }
    async getPhotoCapabilities() { return { imageWidth: { max: 4032 } }; }
    async takePhoto(settings) {
      calls++;
      assert.deepEqual(settings, { imageWidth: 4032 });
      return new Blob(["still"]);
    }
  } });
  const capture = createPhotoCapture(track);
  for (let i = 0; i < 3; i++) {
    const shot = await capture(video);
    assert.deepEqual([shot.width, shot.height], [2880, 3840]);
  }
  assert.equal(calls, 3);
  assert.equal(closed, 3);
  assert.ok(draws.every((s) => s === bitmap));
});

test("rejected photo size retries a default still capture", async () => {
  canvases();
  const requests = [];
  replaceGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close() {} }));
  replaceGlobal("window", { ImageCapture: class {
    async getPhotoCapabilities() { return { imageWidth: { max: 4000 } }; }
    async takePhoto(settings) {
      requests.push(settings);
      if (settings) throw new Error("invalid size");
      return new Blob(["still"]);
    }
  } });
  assert.equal((await createPhotoCapture(track)(video)).width, 3840);
  assert.deepEqual(requests, [{ imageWidth: 4000 }, undefined]);
});

test("rejected capability discovery still allows default still capture", async () => {
  canvases();
  replaceGlobal("createImageBitmap", async () => ({ width: 4000, height: 3000, close() {} }));
  replaceGlobal("window", { ImageCapture: class {
    async getPhotoCapabilities() { throw new Error("unsupported"); }
    async takePhoto(settings) {
      assert.equal(settings, undefined);
      return new Blob(["still"]);
    }
  } });
  assert.equal((await createPhotoCapture(track)(video)).width, 3840);
});

test("failed still capture is silent and disabled for subsequent shots", async () => {
  canvases();
  let calls = 0;
  replaceGlobal("window", { ImageCapture: class {
    async takePhoto() { calls++; throw new Error("driver failure"); }
  } });
  const capture = createPhotoCapture(track);
  for (let i = 0; i < 3; i++) assert.equal((await capture(video)).width, 1920);
  assert.equal(calls, 1);
});

test("a hanging still capture times out and subsequent captures use video", async () => {
  canvases();
  let calls = 0;
  let failLate;
  replaceGlobal("window", { ImageCapture: class {
    async getPhotoCapabilities() { return { imageWidth: { max: 4000 } }; }
    takePhoto() { calls++; return new Promise((_, reject) => { failLate = reject; }); }
  } });
  const capture = createPhotoCapture(track);
  assert.equal((await capture(video)).width, 1920);
  failLate(new Error("driver eventually failed"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await capture(video)).width, 1920);
  assert.equal(calls, 1);
});

test("large-canvas failure retries legacy size and quality", async () => {
  const { encodes } = canvases((canvas) => canvas.width > 1920
    ? null : new Blob(["jpeg"], { type: "image/jpeg" }));
  replaceGlobal("window", {});
  const shot = await createPhotoCapture(track)({ videoWidth: 3840, videoHeight: 2160 });
  assert.deepEqual([shot.width, shot.height], [1920, 1080]);
  assert.deepEqual(encodes.at(-1), { width: 1920, height: 1080, quality: 0.85 });
});

test("non-JPEG, empty and null encoder results are never queued as JPEGs", async () => {
  for (const blob of [new Blob(["png"], { type: "image/png" }), new Blob(), null]) {
    const { created } = canvases(() => blob);
    await assert.rejects(encodePhoto({}, 4000, 3000), /encode photo/);
    assert.ok(created.every((c) => c.width === 0 && c.height === 0));
  }
});
