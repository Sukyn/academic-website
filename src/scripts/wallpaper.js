(() => {
  const WALLPAPER_SELECTOR = "#zx-wallpaper";
  const TAU = Math.PI * 2;
  // This motion takes minutes to cycle. More frequent paints add raster work
  // without visible smoothness; slow devices also get a gap of four paint times.
  const MIN_PAINT_INTERVAL = 125;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /**
   * @typedef {{
   *   x: number;
   *   line: number;
   *   shape: "dot" | "square";
   *   tone: "light" | "dark";
   *   size: number;
   * }} MarkerFeature
   */

  /**
   * @typedef {{
   *   y: number;
   *   lineCount: number;
   *   gap: number;
   *   slope: number;
   *   archA: number;
   *   archB: number;
   *   phase: number;
   *   speed: number;
   *   drift: number;
   *   features: MarkerFeature[];
   * }} System
   */

  function bindChalkWallpaper() {
    const el = document.querySelector(WALLPAPER_SELECTOR);
    if (!(el instanceof HTMLCanvasElement)) return;

    const existingState = window.__chalkWallpaperState;
    if (existingState?.canvas === el) {
      existingState.resume();
      return;
    }

    existingState?.destroy?.();

    const canvas = el;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    /** @type {System[]} */
    const systems = [];

    let cssW = 0;
    let cssH = 0;
    let raf = 0;
    let timer = 0;
    let idle = 0;
    let paintInterval = MIN_PAINT_INTERVAL;
    let painted = false;
    const lineGradients = new Map();
    let centerVeil = null;

    const rand = (min, max) => min + Math.random() * (max - min);
    const randInt = (min, max) => Math.floor(rand(min, max + 1));
    const pick = (items) => items[Math.floor(Math.random() * items.length)];

    function resize() {
      // Soft, translucent decoration needs one pixel per CSS pixel. Extra DPR
      // multiplies fullscreen raster work without sharpening the page content.
      const dpr = Math.min(window.devicePixelRatio || 1, 1);
      cssW = window.innerWidth;
      cssH = window.innerHeight;

      canvas.width = Math.floor(cssW * dpr);
      canvas.height = Math.floor(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      lineGradients.clear();
      centerVeil = null;
    }

    function lineOffset(system, line) {
      return (line - (system.lineCount - 1) / 2) * system.gap;
    }

    function lineYAt(system, line, x, time) {
      const nx = x / Math.max(cssW, 1);
      const offset = lineOffset(system, line);
      const animated = Math.sin(time * system.speed + system.phase + nx * 1.45) * system.drift;
      const slope = system.slope * (x - cssW * 0.5);
      const waveA = Math.sin(nx * TAU * 0.48 + system.phase) * system.archA;
      const waveB = Math.sin(nx * TAU * 1.05 + system.phase * 1.22) * system.archB;
      const waveC = Math.sin(nx * TAU * 2.2 + system.phase * 0.45 + time * system.speed * 0.35) *
        system.drift * 1.6;

      return system.y + offset + slope + waveA + waveB + waveC + animated;
    }

    function marginBandX(side) {
      const leftMax = Math.max(180, cssW * 0.22);
      const rightMin = Math.min(cssW * 0.78, cssW - 180);
      if (side === "left") return rand(34, leftMax);
      return rand(rightMin, cssW - 34);
    }

    function createFeature(system, side) {
      return /** @type {MarkerFeature} */ ({
        x: marginBandX(side),
        line: randInt(0, system.lineCount - 1),
        shape: pick(["dot", "square"]),
        tone: pick(["light", "dark"]),
        size: rand(6.5, 11),
      });
    }

    function makeSystem(y) {
      /** @type {System} */
      const system = {
        y,
        lineCount: Math.random() > 0.42 ? 1 : 2,
        gap: rand(15, 22),
        slope: rand(-0.0015, 0.0015),
        archA: rand(14, 28) * (Math.random() > 0.5 ? 1 : -1),
        archB: rand(6, 14) * (Math.random() > 0.5 ? 1 : -1),
        phase: rand(0, TAU),
        speed: rand(0.00003, 0.00006),
        drift: rand(1.8, 3.6),
        features: [],
      };

      const featureCount = randInt(3, 5);
      for (let index = 0; index < featureCount; index += 1) {
        const side = index % 2 === 0 ? "left" : "right";
        system.features.push(createFeature(system, side));
      }

      return system;
    }

    function init() {
      systems.length = 0;

      let y = 98;
      while (y < cssH + 110) {
        systems.push(makeSystem(y));
        y += rand(118, 175);
      }
    }

    function makeGradient(alpha) {
      if (lineGradients.has(alpha)) return lineGradients.get(alpha);
      const gradient = ctx.createLinearGradient(0, 0, cssW, 0);
      gradient.addColorStop(0, `rgba(245, 241, 231, ${alpha})`);
      gradient.addColorStop(0.18, `rgba(245, 241, 231, ${alpha * 0.8})`);
      gradient.addColorStop(0.38, `rgba(245, 241, 231, ${alpha * 0.16})`);
      gradient.addColorStop(0.5, `rgba(245, 241, 231, ${alpha * 0.08})`);
      gradient.addColorStop(0.62, `rgba(245, 241, 231, ${alpha * 0.16})`);
      gradient.addColorStop(0.82, `rgba(245, 241, 231, ${alpha * 0.8})`);
      gradient.addColorStop(1, `rgba(245, 241, 231, ${alpha})`);
      lineGradients.set(alpha, gradient);
      return gradient;
    }

    function strokeChalk(path, alpha, width) {
      const layers = [
        { dx: 0, dy: 0, alpha, width },
        { dx: 0.42, dy: -0.22, alpha: alpha * 0.46, width: width + 0.45 },
        { dx: -0.28, dy: 0.3, alpha: alpha * 0.22, width: width + 0.9 },
      ];

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      for (const layer of layers) {
        ctx.save();
        ctx.translate(layer.dx, layer.dy);
        ctx.strokeStyle = makeGradient(layer.alpha);
        ctx.lineWidth = layer.width;
        ctx.stroke(path);
        ctx.restore();
      }
    }

    function drawLine(system, line, time, opacity) {
      const startX = -48;
      const endX = cssW + 48;
      const step = 24;

      const path = new Path2D();
      path.moveTo(startX, lineYAt(system, line, startX, time));
      for (let x = startX + step; x <= endX; x += step) {
        path.lineTo(x, lineYAt(system, line, x, time));
      }
      strokeChalk(path, opacity, 1.04);
    }

    function markerFill(tone, alpha) {
      return tone === "dark"
        ? `rgba(0, 0, 0, ${alpha})`
        : `rgba(255, 255, 255, ${alpha})`;
    }

    function eraseMarkerCircle(x, y, radius) {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, TAU);
      ctx.fillStyle = "rgba(0, 0, 0, 1)";
      ctx.fill();
      ctx.restore();
    }

    function eraseMarkerSquare(x, y, size) {
      const half = size / 2;
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0, 0, 0, 1)";
      ctx.fillRect(x - half, y - half, size, size);
      ctx.restore();
    }

    function eraseMarkerUnderlay(x, y, shape, size) {
      const padding = 1.6;

      if (shape === "square") {
        eraseMarkerSquare(x, y, size + padding * 2);
        return;
      }

      eraseMarkerCircle(x, y, size / 2 + padding);
    }

    function fillMarkerCircle(x, y, radius, tone, alpha) {
      const layers = [
        { dx: 0, dy: 0, alpha, radius },
        { dx: 0.24, dy: -0.16, alpha: alpha * 0.22, radius: radius + 0.28 },
      ];

      for (const layer of layers) {
        ctx.beginPath();
        ctx.arc(x + layer.dx, y + layer.dy, layer.radius, 0, TAU);
        ctx.fillStyle = markerFill(tone, layer.alpha);
        ctx.fill();
      }
    }

    function fillMarkerSquare(x, y, size, tone, alpha) {
      const layers = [
        { dx: 0, dy: 0, alpha, size },
        { dx: 0.22, dy: -0.16, alpha: alpha * 0.2, size: size + 0.32 },
      ];

      for (const layer of layers) {
        const half = layer.size / 2;
        ctx.fillStyle = markerFill(tone, layer.alpha);
        ctx.fillRect(x - half + layer.dx, y - half + layer.dy, layer.size, layer.size);
      }
    }

    function drawMarker(x, y, shape, tone, size, alpha) {
      if (shape === "square") {
        fillMarkerSquare(x, y, size, tone, alpha);
        return;
      }

      fillMarkerCircle(x, y, size / 2, tone, alpha);
    }

    function drawMarkerFeature(system, feature, time) {
      const y = lineYAt(system, feature.line, feature.x, time);
      eraseMarkerUnderlay(feature.x, y, feature.shape, feature.size);
      const markerOpacity = feature.tone === "dark" ? 0.98 : 0.96;
      drawMarker(feature.x, y, feature.shape, feature.tone, feature.size, markerOpacity);
    }

    function drawDust(time) {
      const count = Math.max(16, Math.round((cssW * cssH) / 90000));
      const drift = Math.sin(time * 0.00002) * 8;

      for (let index = 0; index < count; index += 1) {
        const onLeft = index % 2 === 0;
        const x = onLeft ? rand(10, cssW * 0.2) : rand(cssW * 0.8, cssW - 10);
        const y = rand(12, cssH - 12);
        const shape = Math.random() > 0.5 ? "dot" : "square";
        const tone = Math.random() > 0.5 ? "light" : "dark";
        const size = rand(1.8, 3.4);

        drawMarker(x + drift * 0.15, y, shape, tone, size, rand(0.028, 0.07));
      }
    }

    function drawCenterVeil() {
      const veilWidth = Math.min(cssW - 24, Math.max(560, cssW * 0.54));
      const x0 = (cssW - veilWidth) / 2;
      if (!centerVeil) {
        centerVeil = ctx.createLinearGradient(x0, 0, x0 + veilWidth, 0);
        centerVeil.addColorStop(0, "rgba(24, 35, 30, 0)");
        centerVeil.addColorStop(0.08, "rgba(24, 35, 30, 0.72)");
        centerVeil.addColorStop(0.18, "rgba(24, 35, 30, 0.94)");
        centerVeil.addColorStop(0.3, "rgba(24, 35, 30, 0.985)");
        centerVeil.addColorStop(0.7, "rgba(24, 35, 30, 0.985)");
        centerVeil.addColorStop(0.82, "rgba(24, 35, 30, 0.94)");
        centerVeil.addColorStop(0.92, "rgba(24, 35, 30, 0.72)");
        centerVeil.addColorStop(1, "rgba(24, 35, 30, 0)");
      }

      ctx.fillStyle = centerVeil;
      ctx.fillRect(x0, 0, veilWidth, cssH);
    }

    function drawSystem(system, time) {
      const opacity = 0.11;

      for (let line = 0; line < system.lineCount; line += 1) {
        drawLine(system, line, time, opacity);
      }

      for (const feature of system.features) {
        drawMarkerFeature(system, feature, time);
      }
    }

    function draw(time = 0) {
      ctx.clearRect(0, 0, cssW, cssH);

      drawDust(time);
      for (const system of systems) {
        drawSystem(system, time);
      }
      drawCenterVeil();
    }

    function shouldRun() {
      return !reduceMotion.matches && !document.hidden;
    }

    function loop(now) {
      raf = 0;
      if (!shouldRun()) return;
      const started = performance.now();
      draw(now);
      paintInterval = Math.max(MIN_PAINT_INTERVAL, (performance.now() - started) * 4);
      startLoop();
    }

    function startLoop() {
      if (raf || timer || idle || !painted || !shouldRun()) return;
      timer = window.setTimeout(() => {
        timer = 0;
        if (shouldRun()) raf = requestAnimationFrame(loop);
      }, paintInterval);
    }

    function stopLoop() {
      if (raf) cancelAnimationFrame(raf);
      if (timer) window.clearTimeout(timer);
      if (idle) {
        if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
        else window.clearTimeout(idle);
      }
      raf = 0;
      timer = 0;
      idle = 0;
    }

    function queuePaint() {
      stopLoop();
      if (document.hidden) return;
      const paint = () => {
        idle = 0;
        if (document.hidden) return;
        const started = performance.now();
        draw(started);
        painted = true;
        paintInterval = Math.max(MIN_PAINT_INTERVAL, (performance.now() - started) * 4);
        startLoop();
      };
      // Render content first; a decorative canvas does not need to block it.
      idle = window.requestIdleCallback
        ? window.requestIdleCallback(paint, { timeout: 1000 })
        : window.setTimeout(paint, 25);
    }

    function updateRunning() {
      queuePaint();
    }

    function handleResize() {
      resize();
      init();
      queuePaint();
    }

    resize();
    init();
    queuePaint();

    window.addEventListener("resize", handleResize);
    window.addEventListener("pagehide", stopLoop);
    reduceMotion.addEventListener("change", updateRunning);
    document.addEventListener("visibilitychange", updateRunning);

    window.__chalkWallpaperState = {
      canvas,
      resume() {
        if (cssW !== window.innerWidth || cssH !== window.innerHeight) handleResize();
        else if (painted) startLoop();
        else if (!idle) queuePaint();
      },
      destroy() {
        stopLoop();
        window.removeEventListener("resize", handleResize);
        window.removeEventListener("pagehide", stopLoop);
        reduceMotion.removeEventListener("change", updateRunning);
        document.removeEventListener("visibilitychange", updateRunning);
      },
    };
  }

  bindChalkWallpaper();

  if (!window.__chalkWallpaperListenerBound) {
    window.__chalkWallpaperListenerBound = true;
    document.addEventListener("astro:page-load", bindChalkWallpaper);
    window.addEventListener("pageshow", bindChalkWallpaper);
  }
})();
