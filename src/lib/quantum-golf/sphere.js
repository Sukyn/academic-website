import { START_STATE, gateTrajectory, normalize, targetCap } from './quantum.js';

const TAU = Math.PI * 2;
const colors = { sphere: '154,217,209', state: '168,241,213', H: '238,159,134', T: '181,162,234', target: '231,199,119' };
const color = (name, opacity) => `rgba(${colors[name]},${opacity})`;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const visible = (point, front) => front === (point.depth >= 0);
const horizon = (a, b) => {
  const t = a.depth / (a.depth - b.depth);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, depth: 0 };
};
const sampleCircle = (point) => Array.from({ length: 97 }, (_, i) => point(i * TAU / 96));
const grid = [
  ...Array.from({ length: 5 }, (_, i) => {
    const latitude = (i - 2) * Math.PI / 6, r = Math.cos(latitude);
    return sampleCircle((t) => [r * Math.cos(t), r * Math.sin(t), Math.sin(latitude)]);
  }),
  ...Array.from({ length: 4 }, (_, i) => {
    const longitude = i * Math.PI / 4;
    return sampleCircle((t) => [Math.sin(t) * Math.cos(longitude), Math.sin(t) * Math.sin(longitude), Math.cos(t)]);
  }),
];

/** Orthographic sphere: states and targets are unit vectors [x, y, z]. */
export class BlochSphere {
  constructor(canvas, { onPick } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onPick = onPick;
    this.model = {};
    this.history = [];
    this.view = { yaw: 0.72, pitch: 0.28, zoom: 1 };
    this.setState({ state: START_STATE, target: null, epsilon: 0.12, pickMode: false, sequence: '', showTrace: true, animation: null });
    this.pointers = new Map();
    canvas.addEventListener('pointerdown', (event) => this.pointerDown(event));
    canvas.addEventListener('pointermove', (event) => this.pointerMove(event));
    canvas.addEventListener('pointerup', (event) => this.pointerUp(event));
    canvas.addEventListener('pointercancel', (event) => this.pointerUp(event, true));
    canvas.addEventListener('wheel', (event) => {
      event.preventDefault();
      this.zoomBy(Math.exp(-event.deltaY * 0.001));
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setState(next) {
    if (Object.entries(next).every(([key, value]) => this.model[key] === value)) return;
    const { state, target, epsilon, sequence, showTrace } = this.model;
    Object.assign(this.model, next);
    // Geometry changes with the circuit or hole, never with the camera.
    if (state !== this.model.state) {
      this.state = normalize(this.model.state);
      this.traces = ['H', 'T'].map(gate => ({ gate, points: gateTrajectory(this.state, gate, 96) }));
    }
    if (target !== this.model.target || epsilon !== this.model.epsilon) {
      this.boundary = this.model.target ? targetCap(this.model.target, this.model.epsilon, 96) : null;
    }
    if (sequence !== this.model.sequence || showTrace !== this.model.showTrace) {
      const circuit = this.model.showTrace ? this.model.sequence : '';
      let shared = 0;
      while (shared < this.history.length && this.history[shared].gate === circuit[shared]) shared++;
      this.history.length = shared;
      let point = this.history.at(-1)?.points.at(-1) ?? START_STATE;
      for (const gate of circuit.slice(shared)) {
        const points = gateTrajectory(point, gate, 32);
        this.history.push({ gate, points });
        point = points.at(-1);
      }
    }
    this.canvas.style.cursor = this.model.pickMode ? 'crosshair' : 'grab';
    this.render();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect(), ratio = Math.min(2, window.devicePixelRatio || 1);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * ratio);
    this.canvas.height = Math.round(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.render();
  }

  // Reuse the gate's animation clock; manual rotation takes over by replacing view.
  cameraTo(point) {
    const [x, y, z] = normalize(point), view = this.view;
    const horizontal = Math.hypot(x, y);
    const yaw = horizontal < 1e-12 ? view.yaw : Math.atan2(x, y);
    const startYaw = view.yaw, startPitch = view.pitch;
    const deltaYaw = Math.atan2(Math.sin(yaw - startYaw), Math.cos(yaw - startYaw));
    const deltaPitch = Math.atan2(z, horizontal) - startPitch;
    return progress => {
      if (this.view !== view) return;
      const eased = progress * progress * (3 - 2 * progress);
      view.yaw = startYaw + deltaYaw * eased;
      view.pitch = startPitch + deltaPitch * eased;
    };
  }

  rotateBy(dx, dy) {
    this.view = { ...this.view, yaw: this.view.yaw + dx * 0.007,
      pitch: clamp(this.view.pitch + dy * 0.007, -Math.PI / 2, Math.PI / 2) };
    this.render();
  }

  zoomBy(factor) {
    this.view.zoom = clamp(this.view.zoom * factor, 0.65, 1.5);
    this.render();
  }

  localPosition(event) {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  pinchMetrics() {
    const [a, b] = this.pointers.values();
    return { distance: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  pointerDown(event) {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const point = this.localPosition(event);
    this.pointers.set(event.pointerId, point);
    this.canvas.setPointerCapture(event.pointerId);
    if (this.pointers.size === 1) this.drag = { start: point, moved: false };
    else this.drag.moved = true;
    this.canvas.style.cursor = 'grabbing';
  }

  pointerMove(event) {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const pinch = this.pointers.size > 1 ? this.pinchMetrics() : null;
    const point = this.localPosition(event);
    this.pointers.set(event.pointerId, point);
    if (pinch) {
      const next = this.pinchMetrics();
      this.view.zoom = clamp(this.view.zoom * next.distance / Math.max(1, pinch.distance), 0.65, 1.5);
      this.rotateBy(next.x - pinch.x, next.y - pinch.y);
    } else {
      if (Math.hypot(point.x - this.drag.start.x, point.y - this.drag.start.y) > 4) this.drag.moved = true;
      if (this.drag.moved) this.rotateBy(point.x - previous.x, point.y - previous.y);
    }
  }

  pointerUp(event, cancelled = false) {
    if (!this.pointers.has(event.pointerId)) return;
    if (!cancelled && this.pointers.size === 1 && !this.drag.moved && this.model.pickMode) {
      const point = this.localPosition(event);
      const x = (point.x - this.cx) / this.radius, y = -(point.y - this.cy) / this.radius;
      if (x * x + y * y <= 1) {
        const depth = Math.sqrt(Math.max(0, 1 - x * x - y * y));
        this.onPick?.(normalize(this.right.map((value, i) => value * x + this.up[i] * y + this.front[i] * depth)));
      }
    }
    this.pointers.delete(event.pointerId);
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    const remaining = this.pointers.values().next().value;
    this.drag = remaining ? { start: remaining, moved: true } : null;
    this.canvas.style.cursor = remaining ? 'grabbing' : this.model.pickMode ? 'crosshair' : 'grab';
  }

  project(point) {
    return { x: this.cx + dot(point, this.right) * this.radius,
      y: this.cy - dot(point, this.up) * this.radius, depth: dot(point, this.front) };
  }

  /** Split strokes at the horizon to distinguish the hidden hemisphere. */
  path(points, front, stroke, width = 1, dash = []) {
    const ctx = this.ctx;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.setLineDash(dash);
    ctx.beginPath();
    let a = points[0], drawing = false;
    for (let i = 1; i < points.length; i++) {
      const b = points[i], va = visible(a, front), vb = visible(b, front);
      if (va || vb) {
        const start = va ? a : horizon(a, b), end = vb ? b : horizon(a, b);
        if (!drawing || !va) ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
      }
      drawing = vb;
      a = b;
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }

  cap(center, edge, front) {
    if (!center) return;
    const ctx = this.ctx;
    ctx.fillStyle = color('target', front ? 0.12 : 0.035);
    ctx.beginPath();
    for (let i = 1; i < edge.length; i++) {
      const triangle = [center, edge[i - 1], edge[i]], polygon = [];
      triangle.forEach((a, j) => {
        const b = triangle[(j + 1) % 3];
        if (visible(a, front)) polygon.push(a);
        if (visible(a, front) !== visible(b, front)) polygon.push(horizon(a, b));
      });
      polygon.forEach((point, j) => {
        if (j === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
      });
      ctx.closePath();
    }
    ctx.fill();
    this.path(edge, front, color('target', front ? 0.85 : 0.3), 1.4, front ? [] : [3, 5]);
  }

  circle(p, radius, name, fill = false) {
    const ctx = this.ctx;
    ctx.fillStyle = ctx.strokeStyle = color(name, p.depth >= 0 ? 0.95 : 0.4);
    ctx.lineWidth = 1.3;
    ctx.setLineDash(p.depth >= 0 ? [] : [2, 3]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, TAU);
    if (fill) ctx.fill(); else ctx.stroke();
    ctx.setLineDash([]);
  }

  label(text, p, name, dx = 0, dy = 0) {
    this.ctx.fillStyle = color(name, p.depth >= 0 ? 0.85 : 0.45);
    this.ctx.fillText(text, p.x + dx, p.y + dy);
  }

  preview(points, gate) {
    const a = points[points.length - 4], b = points[points.length - 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y), ctx = this.ctx;
    if (length >= 0.5) {
      const ux = (b.x - a.x) / length, uy = (b.y - a.y) / length;
      ctx.fillStyle = color(gate, b.depth >= 0 ? 0.65 : 0.25);
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - ux * 9 + uy * 4, b.y - uy * 9 - ux * 4);
      ctx.lineTo(b.x - ux * 9 - uy * 4, b.y - uy * 9 + ux * 4);
      ctx.closePath();
      ctx.fill();
    }
    this.circle(b, 6, gate);
    this.label(gate, b, gate, b.x >= this.cx ? 16 : -16, -3);
  }

  render() {
    if (!this.ctx || !this.width || !this.height) return;
    const { yaw, pitch, zoom } = this.view, sy = Math.sin(yaw), cy = Math.cos(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
    this.right = [cy, -sy, 0];
    this.up = [-sy * sp, -cy * sp, cp];
    this.front = [sy * cp, cy * cp, sp];
    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.radius = Math.min(this.width, this.height) * 0.38 * zoom;
    const projectPath = points => points.map(point => this.project(point));
    const ctx = this.ctx, state = this.project(this.state), target = this.model.target && this.project(this.model.target);
    const lines = grid.map(projectPath), boundary = this.boundary && projectPath(this.boundary);
    const traces = this.traces.map(({ gate, points }) => ({ gate, points: projectPath(points) }));
    const history = this.history.map(({ gate, points }) => ({ gate, points: projectPath(points) }));
    const animation = this.model.showTrace && this.model.animation;
    if (animation && animation.progress > 0) {
      history.push({ gate: animation.gate,
        points: projectPath(Array.from({ length: 33 }, (_, i) => animation.rotate(animation.progress * i / 32))) });
    }
    const axis = [this.project([0, 0, 0]), state];
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const front of [false, true]) {
      for (const points of lines) this.path(points, front, color('sphere', front ? 0.2 : 0.065), 0.8, front ? [] : [2, 5]);
      this.cap(target, boundary, front);
      for (const { gate, points } of history) this.path(points, front, color(gate, front ? 0.6 : 0.18), 2);
      for (const { gate, points } of traces) this.path(points, front, color(gate, front ? 0.48 : 0.2), 1.6, front ? [5, 5] : [2, 5]);
      this.path(axis, front, color('state', front ? 0.75 : 0.3), 1, front ? [] : [4, 5]);
    }
    ctx.strokeStyle = color('sphere', 0.32);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radius, 0, TAU);
    ctx.stroke();
    for (const { gate, points } of traces) this.preview(points, gate);
    if (target) this.circle(target, 3, 'target', true);
    this.circle(state, 5, 'state', true);
    for (const [label, point] of [['|0⟩', [0, 0, 1.16]], ['|1⟩', [0, 0, -1.16]], ['|+⟩', [1.16, 0, 0]], ['y', [0, 1.16, 0]]]) {
      const p = this.project(point);
      const offset = Math.hypot(p.x - this.cx, p.y - this.cy) < 18 ? (p.depth >= 0 ? -18 : 18) : 0;
      this.label(label, p, 'sphere', 0, offset);
    }
  }
}
