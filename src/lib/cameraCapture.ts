/** Browser-only capture helpers; imported by the shared inspection screen. */
export const PHOTO_LONG_EDGE = 3840;
// Decimal MB. Leave ample room for multipart overhead under the 8 MiB action
// limit, and keep offline storage and whole-file retries manageable.
export const PHOTO_MAX_BYTES = 3_000_000;

export type CapturedPhoto = { blob: Blob; width: number; height: number };

// ImageCapture is not included in this project's TypeScript DOM library.
type StillCamera = {
  takePhoto(settings?: { imageWidth: number }): Promise<Blob>;
  getPhotoCapabilities?: () => Promise<{ imageWidth?: { max: number } }>;
};

async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Camera timed out.")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function openCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: PHOTO_LONG_EDGE },
        height: { ideal: 2880 },
      },
      audio: false,
    });
  } catch (error) {
    // Do not repeat a denied permission prompt. Other failures may be a
    // driver rejecting the larger stream; retry the original constraints.
    if (error instanceof DOMException &&
        (error.name === "NotAllowedError" || error.name === "SecurityError")) {
      throw error;
    }
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } },
      audio: false,
    });
  }
}

/** Snapshot once, then encode/rescale that same exposure until it fits. */
export async function encodePhoto(
  source: CanvasImageSource,
  width: number,
  height: number,
  longEdge = PHOTO_LONG_EDGE,
  initialQuality = 0.9,
): Promise<CapturedPhoto> {
  if (!width || !height) throw new Error("Camera not ready.");
  const scale = Math.min(1, longEdge / Math.max(width, height));
  let canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn’t process photo.");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    let quality = initialQuality;
    for (;;) {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", quality),
      );
      if (!blob?.size || blob.type !== "image/jpeg") {
        throw new Error("Couldn’t encode photo.");
      }
      if (blob.size <= PHOTO_MAX_BYTES) {
        return { blob, width: canvas.width, height: canvas.height };
      }
      if (quality > 0.8) {
        quality = Math.max(0.8, Math.round((quality - 0.05) * 100) / 100);
        continue;
      }
      // Preserve useful JPEG quality; exceptionally detailed/noisy scenes
      // trade some pixels for the hard byte ceiling instead.
      if (canvas.width === 1 && canvas.height === 1) {
        throw new Error("Couldn’t fit photo within the upload limit.");
      }
      const smaller = document.createElement("canvas");
      const ratio = Math.min(0.85, Math.sqrt(PHOTO_MAX_BYTES / blob.size) * 0.95);
      smaller.width = Math.max(1, Math.floor(canvas.width * ratio));
      smaller.height = Math.max(1, Math.floor(canvas.height * ratio));
      const smallerCtx = smaller.getContext("2d");
      if (!smallerCtx) {
        smaller.width = smaller.height = 0;
        throw new Error("Couldn’t resize photo.");
      }
      smallerCtx.drawImage(canvas, 0, 0, smaller.width, smaller.height);
      canvas.width = canvas.height = 0;
      canvas = smaller;
    }
  } finally {
    // Release large backing stores promptly during repeated mobile captures.
    canvas.width = canvas.height = 0;
  }
}

async function encodeStill(blob: Blob): Promise<CapturedPhoto> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" })
      .catch(() => null);
    if (bitmap) {
      try {
        return await encodePhoto(bitmap, bitmap.width, bitmap.height);
      } finally {
        bitmap.close();
      }
    }
  }
  // Older engines may decode camera blobs through <img> only. Its natural
  // dimensions include EXIF orientation in supported modern browsers.
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Couldn’t decode photo."));
      image.src = url;
    });
    return await encodePhoto(image, image.naturalWidth, image.naturalHeight);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** One instance per live track. Zoom constraints continue to affect this track. */
export function createPhotoCapture(track: MediaStreamTrack) {
  let stillCamera: StillCamera | null = null;
  try {
    const Constructor = (window as unknown as {
      ImageCapture?: new (track: MediaStreamTrack) => StillCamera;
    }).ImageCapture;
    if (Constructor && typeof Constructor.prototype.takePhoto === "function") {
      stillCamera = new Constructor(track);
    }
  } catch {
    // Some browsers expose ImageCapture but cannot construct it for this track.
  }
  const camera = stillCamera;
  // Ask for the largest exposed still width, independently of preview size.
  // Only set width so the browser can choose a matching height/aspect ratio.
  const settings = Promise.resolve().then(async () => {
    if (!camera?.getPhotoCapabilities) return undefined;
    const caps = await withTimeout(camera.getPhotoCapabilities(), 1000);
    const max = caps.imageWidth?.max;
    return max && Number.isFinite(max) && max > 0 ? { imageWidth: max } : undefined;
  }).catch(() => undefined);

  return async (video: HTMLVideoElement): Promise<CapturedPhoto> => {
    if (stillCamera) {
      try {
        const activeCamera = stillCamera;
        const requested = await settings;
        let attemptFinished = false;
        const capture = async () => {
          try {
            return await activeCamera.takePhoto(requested);
          } catch (error) {
            // Some drivers advertise sizes they cannot actually select.
            // A late rejection after timeout must not start another exposure
            // while the inspector is already using the video fallback.
            if (!requested || attemptFinished) throw error;
            return activeCamera.takePhoto();
          }
        };
        const blob = await withTimeout(capture(), 4000).finally(() => {
          attemptFinished = true;
        });
        return await encodeStill(blob);
      } catch {
        // Includes rejected/unsupported capture, timeout and decoding errors.
        // Avoid repeatedly delaying the shutter on a broken implementation.
        stillCamera = null;
      }
    }
    try {
      return await encodePhoto(video, video.videoWidth, video.videoHeight);
    } catch {
      // Last resort for devices that cannot allocate a larger canvas: the
      // original 1920px/0.85 path, still subject to the byte ceiling.
      return encodePhoto(video, video.videoWidth, video.videoHeight, 1920, 0.85);
    }
  };
}
