(() => {
  const SCRATCH_SELECTOR = "[data-scratch-profile]";

  function bindScratchProfile(root) {
    if (!(root instanceof HTMLElement)) return;

    const image = root.querySelector("img");
    const canvas = root.querySelector("[data-scratch-canvas]");

    if (!(image instanceof HTMLImageElement) || !(canvas instanceof HTMLCanvasElement)) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    let sources = [image.getAttribute("src") || image.src].filter(Boolean);
    try {
      const parsed = JSON.parse(root.dataset.scratchSources || "[]");
      if (Array.isArray(parsed)) {
        const validSources = parsed.filter((value) => typeof value === "string" && value.length > 0);
        if (validSources.length) sources = validSources;
      }
    } catch {}

    const assetCache = new Map();
    let ready = false;
    let scratching = false;
    let revealed = false;
    let currentIndex = 0;
    let transitioning = false;
    let coverSource = "";
    let coverAsset = null;
    let coverSnapshot = null;

    const getCurrentSource = () => image.getAttribute("src") || image.currentSrc || image.src || "";

    const updatePointerState = () => {
      const isFinalReveal = revealed && currentIndex >= sources.length - 1;
      canvas.style.pointerEvents = ready && !transitioning && !isFinalReveal ? "auto" : "none";
    };

    const setRevealed = (value) => {
      revealed = value;
      if (value) root.dataset.revealed = "true";
      else delete root.dataset.revealed;
      updatePointerState();
    };

    const resizeCanvas = () => {
      const rect = image.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      return rect;
    };

    const drawDrawable = (drawable, rect) => {
      const sourceWidth = drawable.naturalWidth;
      const sourceHeight = drawable.naturalHeight;
      if (!sourceWidth || !sourceHeight) return;

      const scale = Math.max(rect.width / sourceWidth, rect.height / sourceHeight);
      const drawWidth = sourceWidth * scale;
      const drawHeight = sourceHeight * scale;
      const offsetX = (rect.width - drawWidth) * 0.5;
      const offsetY = (rect.height - drawHeight) * 0.18;

      context.drawImage(drawable, offsetX, offsetY, drawWidth, drawHeight);
    };

    const saveCoverSnapshot = () => {
      const snapshot = document.createElement("canvas");
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;

      const snapshotContext = snapshot.getContext("2d");
      if (!snapshotContext) return;

      snapshotContext.drawImage(canvas, 0, 0);
      coverSnapshot = snapshot;
    };

    const drawCover = () => {
      const rect = resizeCanvas();
      if (!rect) return;

      context.clearRect(0, 0, rect.width, rect.height);

      if (coverAsset) {
        drawDrawable(coverAsset, rect);
        return;
      }

      if (coverSnapshot) {
        context.drawImage(coverSnapshot, 0, 0, rect.width, rect.height);
        return;
      }

      context.fillStyle = "#a7adb7";
      context.fillRect(0, 0, rect.width, rect.height);
    };

    const loadAsset = (src) => {
      if (!src) return Promise.resolve(null);
      if (assetCache.has(src)) return assetCache.get(src);

      const assetPromise = new Promise((resolve, reject) => {
        const asset = new Image();
        asset.decoding = "async";
        asset.addEventListener("load", () => resolve(asset), { once: true });
        asset.addEventListener("error", () => reject(new Error(`Failed to load ${src}`)), { once: true });
        asset.src = src;
      }).catch((error) => {
        assetCache.delete(src);
        throw error;
      });

      assetCache.set(src, assetPromise);
      return assetPromise;
    };

    const showImageCover = () => {
      coverSource = getCurrentSource();
      coverAsset = null;

      const rect = resizeCanvas();
      if (!rect) return;

      context.clearRect(0, 0, rect.width, rect.height);
      drawDrawable(image, rect);
      saveCoverSnapshot();

      const source = coverSource;
      void loadAsset(source)
        .then((asset) => {
          if (coverSource !== source) return;
          coverAsset = asset;
          if (!revealed) drawCover();
        })
        .catch(() => {});
    };

    const waitForImage = async (nextSource) => {
      // Load first so a failed request leaves the last successful portrait visible.
      await loadAsset(nextSource);
      return new Promise((resolve, reject) => {
        const previousSource = getCurrentSource();
        if (previousSource === nextSource && image.complete && image.naturalWidth) {
          resolve();
          return;
        }

        const onComplete = (event) => {
          image.removeEventListener("load", onComplete);
          image.removeEventListener("error", onComplete);
          if (event.type === "load") resolve();
          else {
            image.src = previousSource;
            reject(new Error("Portrait could not be displayed."));
          }
        };

        image.addEventListener("load", onComplete);
        image.addEventListener("error", onComplete);
        image.src = nextSource;
      });
    };

    const stopOnImageFailure = () => {
      ready = false;
      transitioning = false;
      setRevealed(true);
      delete root.dataset.ready;
    };

    const finishTransition = () => {
      // Earlier portraits are never revisited; the active cover keeps its own reference.
      assetCache.delete(coverSource);
      ready = true;
      transitioning = false;
      root.dataset.ready = "true";
      updatePointerState();
    };

    const advanceRound = () => {
      if (currentIndex >= sources.length - 1) {
        ready = false;
        transitioning = false;
        updatePointerState();
        return;
      }

      const nextIndex = currentIndex + 1;
      transitioning = true;
      ready = false;
      updatePointerState();

      showImageCover();
      setRevealed(false);

      void waitForImage(sources[nextIndex]).then(() => {
        currentIndex = nextIndex;
        finishTransition();
      }).catch(stopOnImageFailure);
    };

    const clearedRatio = () => {
      let pixels;
      try {
        pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch {
        // Custom image sources can taint a canvas; keep the portrait visible.
        stopOnImageFailure();
        return 0;
      }
      let transparent = 0;
      let samples = 0;

      for (let i = 3; i < pixels.length; i += 32) {
        samples += 1;
        if (pixels[i] < 48) transparent += 1;
      }

      return samples === 0 ? 0 : transparent / samples;
    };

    const scratchAt = (clientX, clientY) => {
      if (!ready || revealed || transitioning) return;

      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const radius = Math.max(16, rect.width * 0.12);

      context.save();
      context.globalCompositeOperation = "destination-out";

      const brush = context.createRadialGradient(x, y, radius * 0.2, x, y, radius);
      brush.addColorStop(0, "rgba(0, 0, 0, 1)");
      brush.addColorStop(1, "rgba(0, 0, 0, 0.2)");

      context.fillStyle = brush;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
      context.restore();
    };

    const finishScratch = () => {
      if (!scratching) return;
      scratching = false;
      if (revealed || clearedRatio() <= 0.22) return;

      setRevealed(true);

      if (currentIndex >= sources.length - 1) {
        ready = false;
        updatePointerState();
        return;
      }

      transitioning = true;
      updatePointerState();
      window.setTimeout(advanceRound, 240);
    };

    const onPointerDown = (event) => {
      if (!ready || event.button !== 0 || event.isPrimary === false || revealed || transitioning) return;
      scratching = true;
      try { canvas.setPointerCapture?.(event.pointerId); } catch {}
      scratchAt(event.clientX, event.clientY);
    };

    const onPointerMove = (event) => {
      if (!scratching || revealed) return;
      scratchAt(event.clientX, event.clientY);
    };

    const prepare = () => {
      if (sources.length <= 1) {
        ready = false;
        transitioning = false;
        delete root.dataset.ready;
        setRevealed(true);
        return;
      }

      ready = false;
      transitioning = true;
      currentIndex = 1;

      showImageCover();
      setRevealed(false);
      root.dataset.ready = "true";
      updatePointerState();

      void waitForImage(sources[currentIndex]).then(finishTransition).catch(stopOnImageFailure);
    };

    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", finishScratch);
    canvas.addEventListener("pointercancel", finishScratch);
    canvas.addEventListener("pointerleave", finishScratch);

    if (image.complete) {
      if (image.naturalWidth) prepare();
      else stopOnImageFailure();
    } else {
      image.addEventListener("load", prepare, { once: true });
      image.addEventListener("error", stopOnImageFailure, { once: true });
    }

    if ("ResizeObserver" in window) {
      const resizeObserver = new ResizeObserver(() => {
        if (!revealed) drawCover();
      });
      resizeObserver.observe(image);
    }
  }

  document.querySelectorAll(SCRATCH_SELECTOR).forEach(bindScratchProfile);
})();
