# Inspection camera quality

The shared capture screen uses `ImageCapture.takePhoto()` on the live rear-camera
track where available. It requests the largest advertised still width (letting
the browser choose the matching height), then encodes a bounded JPEG. This is
a still-camera exposure, rather than an enlargement of the preview. The browser
and camera driver determine the available resolution and processing; it is not
a promise of the phone's advertised 48/200MP mode or native-camera HDR quality.

There is no camera-app handoff or extra confirmation. The existing track's zoom
slider remains connected. One shot is processed/saved at a time; the shutter
becomes available after local saving, independently of network upload. Still
exposure and encoding can take longer than the old video snapshot.

## Browser paths

- Android Chrome and other supporting Chromium browsers use still capture.
- Safari added Image Capture in **18.4**, including iOS 18.4. Newer iPhones can
  use this path too; the earlier assumption that all iPhones lack it is outdated.
- Older Safari, default Firefox, absent methods, constructor failures, failed
  captures, or undecodable stills fall back to the live video frame. No user
  error is shown just because the better path is unavailable.
- A still size rejected by the driver retries with default still settings.
  Repeated failure disables still capture for that camera session. A stuck
  `takePhoto()` falls back after four seconds (capability discovery has a
  separate one-second bound, normally completed before the first shutter).
- All devices request ideal 3840×2880 video dimensions, without mandatory
  minimums or cropping constraints. Browsers may deliver less, including the
  old 720p/1080p resolution. If opening that stream fails, the original rear-camera
  request is retried. If high-resolution canvas processing fails, encoding
  retries at the old 1920px / 0.85 settings.

Detection is by capability, not user agent. Actual still quality, zoom,
orientation, and capture speed must be checked on the team's devices.

Sources: [WebKit's Safari 18.4 release notes](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/),
[Chrome's Image Capture guide](https://developer.chrome.com/blog/imagecapture),
[browser compatibility data](https://github.com/mdn/browser-compat-data/blob/main/api/ImageCapture.json).

## Quality, size, and upload budget

- **3840px maximum long edge**, preserving aspect ratio and never upscaling.
  A 4:3 capture becomes at most 3840×2880 (11.1MP); compared with the old
  1920px cap, that is twice the linear detail and four times the pixels at the
  same aspect ratio, provided the camera supplies enough source detail.
- **JPEG quality 0.90**, with a **3,000,000-byte hard ceiling** before IndexedDB.
  Oversized images try 0.85, then 0.80, then reduce dimensions until they fit.
  This matters for noisy shed interiors and highly detailed scenes: resolution
  and quality settings alone cannot guarantee upload size.
- Budget approximately **1–3MB per photo**, with smaller files for simple scenes
  or lower-resolution devices. This is an estimate, not a measured phone range.
  The uncapped original is transient; the bounded JPEG is the saved copy.
- `serverActions.bodySizeLimit` stays at **8mb**. Photos travel as binary
  multipart data, not base64, so the cap leaves substantial request overhead.
- Graph simple PUT currently supports **250MB**, not the old comment's 4MB.
  No upload-session change is required for these bounded files. The existing
  queue retries whole uploads; it does not resume partial mobile transfers.
  [Microsoft's upload documentation](https://learn.microsoft.com/en-us/graph/api/driveitem-put-content?view=graph-rest-1.0).
- At 1Mbps upstream, 1–3MB takes approximately **8–24 seconds** per photo before
  network/server overhead; at 0.25Mbps, **32–96 seconds**. Capture does not wait
  for upload. Interrupted requests can consume the full transfer again.
- 100 unsynced photos need roughly **100–300MB**, plus database overhead.
  Browser storage quotas/eviction and available disk space still apply. No
  pending photos are discarded to make space. Large canvases/decoded bitmaps
  are released after each shot. The existing queue also reads pending blobs
  into memory when draining/counting; test long offline runs on older phones.

The dimensions returned by encoding are those of the final, orientation-corrected
JPEG, including any reduction for the byte ceiling. These flow into `QueuedPhoto`,
the queued report item, and the existing `photos.width` / `photos.height` upsert.
Standalone captures still have no Supabase row until added to an item, as before.
The upload filename expression and report-generation code are unchanged.
Word report images retain their existing sizing.

## Verification and device acceptance

Run the focused tests on Node with TypeScript stripping support (Node 22.18+):

```sh
node --experimental-strip-types --test tests/camera-capture.test.mjs
npx tsc --noEmit
npx eslint
npx next build
```

Before rollout, use a real iPhone and Android, including the installed PWA if used:

1. Photograph fine text in daylight and a dim shed, in portrait and landscape.
   Download the OneDrive JPEG and check its orientation, dimensions, file size
   (≤3,000,000 bytes), and legibility at 100%. Compare to the old capture.
2. Capture at minimum and maximum zoom. Confirm the saved photo matches the
   preview's zoom, allowing for differing still/video aspect ratios.
3. Take at least 20 shots in succession. Confirm no extra prompts/confirmation,
   duplicate shots, stuck shutter, or black frames. Measure shutter-to-ready
   latency; a desktop/fake camera cannot establish acceptable on-site speed.
4. After loading the screen, enable airplane mode and capture in normal and
   incoming inspections. Confirm each locally saved shot has a JPEG blob and
   matching width/height in IndexedDB. Save an item, reload the app while still
   offline, reconnect, and confirm every photo uploads once and every item's
   Supabase dimensions match its downloaded JPEG. Check the filename scheme.
5. Test a long offline run (e.g. 100 photos) on the oldest supported phone; watch
   storage/memory and verify all queued photos survive reload and drain. Test
   storage exhaustion without losing already queued photos. Sync before clearing
   site data, which would erase the offline queue.
6. Exercise an older iPhone or disable `ImageCapture` in a test session, then
   force `takePhoto()` rejection/hang. Capture should silently fall back and
   remain usable. Real permission denial or a failed local save still reports
   an error; it must not falsely count an unsaved photo as captured.
7. Verify the generated Word report retains its existing image cell sizing.

Live camera hardware, browser/PWA lifecycle, authenticated OneDrive/Supabase
sync, real mobile bandwidth, and real device storage limits require these manual
checks; desktop automated tests do not certify them.
