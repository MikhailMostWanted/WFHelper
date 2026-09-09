// Reuse one display stream so the Wayland portal prompts only once. Main drives
// capture through the exported window functions.

(function () {
  "use strict";

  const video = document.getElementById("v");
  const canvas = document.createElement("canvas");
  let state = "idle";
  let stream = null;
  let lastError = "";

  function markDead(reason) {
    state = "dead";
    stream = null;
    lastError = reason || "";
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        audio: false,
        // Low frame rate keeps compositor/CPU cost negligible; grabs always
        // read the most recent frame.
        video: { frameRate: { ideal: 10, max: 15 } },
      });
      const track = stream.getVideoTracks()[0];
      if (!track) {
        markDead("no video track");
        return;
      }
      // User ended the share (compositor indicator) or the source went away.
      track.addEventListener("ended", () => markDead("track ended"));
      video.srcObject = stream;
      await video.play();
      state = "live";
    } catch (err) {
      // Portal declined / cancelled / unsupported; main logs the DOMException name.
      markDead(err && err.name ? err.name + ": " + err.message : String(err));
    }
  }

  window.__startCapture = function () {
    if (state !== "idle" && state !== "dead") return;
    state = "starting";
    void start();
  };

  window.__captureState = function () {
    return state;
  };

  window.__captureError = function () {
    return lastError;
  };

  // Raw pixels rather than a PNG data URL, and each step is timed: a slow grab
  // is the main unknown on Linux, and main logs this split when one shows up.
  window.__grabFrame = function () {
    if (state !== "live" || !video.videoWidth || !video.videoHeight) return null;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;

    const started = performance.now();
    ctx.drawImage(video, 0, 0);
    const drawn = performance.now();
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const read = performance.now();

    // NativeImage bitmaps are BGRA and canvas hands back RGBA; swap in place.
    const words = new Uint32Array(frame.data.buffer);
    for (let i = 0; i < words.length; i++) {
      const px = words[i];
      words[i] = (px & 0xff00ff00) | ((px & 0xff) << 16) | ((px >>> 16) & 0xff);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: frame.data,
      drawMs: Math.round(drawn - started),
      readMs: Math.round(read - drawn),
      swapMs: Math.round(performance.now() - read),
    };
  };
})();
