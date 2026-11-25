"use strict";

// Gem Maze: a fresh random maze every level. Collect every gem to unlock the
// exit, avoid the beetles, and finish fast for stars. From level 6 you can
// only see the area around you.
(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const stage = canvas.parentElement;
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayBody = document.getElementById("overlay-body");
  const startBtn = document.getElementById("start-btn");
  const restartBtn = document.getElementById("restart-btn");
  const pauseBtn = document.getElementById("pause-btn");
  const muteBtn = document.getElementById("mute-btn");
  const levelEl = document.getElementById("level");
  const gemsEl = document.getElementById("gems");
  const clockEl = document.getElementById("clock");

  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (n) => Math.floor(Math.random() * n);
  const shuffle = (list) => {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const store = {
    get(key, fallback) {
      try {
        return localStorage.getItem(key) ?? fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, String(value));
      } catch {
        // storage blocked
      }
    },
  };

  // Each direction: [dx, dy, wall bit].
  const DIRS = {
    up: [0, -1, 1],
    right: [1, 0, 2],
    down: [0, 1, 4],
    left: [-1, 0, 8],
  };
  const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };
  const GEM_COLORS = [
    "#f472b6",
    "#60a5fa",
    "#34d399",
    "#facc15",
    "#f87171",
    "#c084fc",
  ];
  const MOVE_SPEED = 8; // cells per second
  const BEETLE_SPEED = 2.6;

  // ---------- sound ----------
  let audio = null;
  let muted = store.get("gem-maze-muted", "0") === "1";
  function tone(
    freq,
    duration,
    type = "triangle",
    volume = 0.12,
    delay = 0,
    slideTo = 0,
  ) {
    if (muted) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const t = audio.currentTime + delay;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo)
        osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + duration);
    } catch {
      // no audio
    }
  }
  function updateMute() {
    muteBtn.textContent = muted ? "🔇" : "🔊";
    muteBtn.setAttribute("aria-label", muted ? "Unmute sound" : "Mute sound");
  }
  muteBtn.addEventListener("click", () => {
    muted = !muted;
    store.set("gem-maze-muted", muted ? "1" : "0");
    updateMute();
  });

  // ---------- state ----------
  let state = "menu"; // menu | playing | paused | done
  let level = 1;
  let unlocked = Number(store.get("gem-maze-level", "1")) || 1;
  let cols = 0;
  let rows = 0;
  let open = []; // per cell: bitmask of open sides
  let seen = []; // per cell: has the player seen it (fog levels)
  let gems = [];
  let gemTotal = 0;
  let beetles = [];
  let exit = { x: 0, y: 0 };
  let player = null;
  let fog = 0; // view radius in cells, 0 = no fog
  let elapsed = 0;
  let par = 0;
  let cell = 20;
  let ox = 0;
  let oy = 0;
  let sparkles = [];
  let ouch = 0;
  let time = 0;

  const idx = (x, y) => y * cols + x;
  const isOpen = (x, y, dir) => (open[idx(x, y)] & DIRS[dir][2]) !== 0;
  const exits = (x, y) => Object.keys(DIRS).filter((d) => isOpen(x, y, d));

  // ---------- maze generation ----------
  function generate(c, r, loops) {
    cols = c;
    rows = r;
    open = new Array(c * r).fill(0);
    const visited = new Array(c * r).fill(false);
    const stack = [[0, 0]];
    visited[0] = true;
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const options = Object.entries(DIRS).filter(([, [dx, dy]]) => {
        const nx = x + dx;
        const ny = y + dy;
        return nx >= 0 && ny >= 0 && nx < c && ny < r && !visited[idx(nx, ny)];
      });
      if (!options.length) {
        stack.pop();
        continue;
      }
      const [dir, [dx, dy, bit]] = options[randInt(options.length)];
      const nx = x + dx;
      const ny = y + dy;
      open[idx(x, y)] |= bit;
      open[idx(nx, ny)] |= DIRS[OPPOSITE[dir]][2];
      visited[idx(nx, ny)] = true;
      stack.push([nx, ny]);
    }
    // Knock out a few extra walls so there's more than one way around.
    for (let i = 0; i < Math.floor(c * r * loops); i++) {
      const x = randInt(c - 1);
      const y = randInt(r - 1);
      const dir = Math.random() < 0.5 ? "right" : "down";
      const [dx, dy, bit] = DIRS[dir];
      open[idx(x, y)] |= bit;
      open[idx(x + dx, y + dy)] |= DIRS[OPPOSITE[dir]][2];
    }
  }

  // Distance in steps from (sx, sy) to every cell.
  function bfs(sx, sy) {
    const dist = new Array(cols * rows).fill(-1);
    const queue = [[sx, sy]];
    dist[idx(sx, sy)] = 0;
    for (let q = 0; q < queue.length; q++) {
      const [x, y] = queue[q];
      for (const d of exits(x, y)) {
        const nx = x + DIRS[d][0];
        const ny = y + DIRS[d][1];
        if (dist[idx(nx, ny)] < 0) {
          dist[idx(nx, ny)] = dist[idx(x, y)] + 1;
          queue.push([nx, ny]);
        }
      }
    }
    return dist;
  }

  function levelConfig(n) {
    return {
      cols: Math.min(6 + n, 22),
      gems: Math.min(3 + Math.floor(n / 2), 12),
      beetles: n >= 3 ? Math.min(1 + Math.floor((n - 3) / 2), 6) : 0,
      fog: n >= 9 ? 2.6 : n >= 6 ? 3.6 : 0,
      loops: n >= 6 ? 0.08 : 0.04,
    };
  }

  function startLevel(n) {
    level = n;
    const cfg = levelConfig(n);
    const aspect = Math.min(
      1.7,
      Math.max(0.6, stage.clientHeight / Math.max(1, stage.clientWidth)),
    );
    const c = cfg.cols;
    const r = Math.max(6, Math.round(c * aspect));
    generate(c, r, cfg.loops);
    seen = new Array(c * r).fill(false);
    fog = cfg.fog;
    exit = { x: c - 1, y: r - 1 };

    // Gems go in dead ends first (they're the sneakiest spots), then anywhere.
    const fromStart = bfs(0, 0);
    const cells = [];
    for (let y = 0; y < r; y++) {
      for (let x = 0; x < c; x++) {
        if ((x === 0 && y === 0) || (x === exit.x && y === exit.y)) continue;
        if (fromStart[idx(x, y)] < 3) continue;
        cells.push({ x, y, dead: exits(x, y).length === 1 });
      }
    }
    const ordered = [
      ...shuffle(cells.filter((p) => p.dead)),
      ...shuffle(cells.filter((p) => !p.dead)),
    ];
    gems = ordered.slice(0, cfg.gems).map((p, i) => ({
      x: p.x,
      y: p.y,
      color: GEM_COLORS[i % GEM_COLORS.length],
    }));
    gemTotal = gems.length;

    const far = shuffle(
      cells.filter((p) => fromStart[idx(p.x, p.y)] > (c + r) / 2),
    );
    beetles = far.slice(0, cfg.beetles).map((p) => ({
      x: p.x,
      y: p.y,
      fx: p.x,
      fy: p.y,
      dir: exits(p.x, p.y)[0],
      t: 1,
    }));

    player = {
      x: 0,
      y: 0,
      fx: 0,
      fy: 0,
      from: null,
      t: 1,
      slide: null,
      inv: 0,
      face: "right",
    };
    par = computePar();
    elapsed = 0;
    sparkles = [];
    ouch = 0;
    reveal();
    resize();
    updateHud();
  }

  // Rough "good time": a greedy nearest-gem route, at a relaxed pace.
  function computePar() {
    let at = { x: 0, y: 0 };
    let steps = 0;
    const left = [...gems];
    while (left.length) {
      const dist = bfs(at.x, at.y);
      left.sort((a, b) => dist[idx(a.x, a.y)] - dist[idx(b.x, b.y)]);
      const g = left.shift();
      steps += dist[idx(g.x, g.y)];
      at = g;
    }
    steps += bfs(at.x, at.y)[idx(exit.x, exit.y)];
    return Math.ceil(steps / 4.5 + 3);
  }

  function reveal() {
    if (!fog) return;
    const R = Math.ceil(fog);
    for (let y = player.y - R; y <= player.y + R; y++) {
      for (let x = player.x - R; x <= player.x + R; x++) {
        if (
          x >= 0 &&
          y >= 0 &&
          x < cols &&
          y < rows &&
          Math.hypot(x - player.x, y - player.y) <= fog
        ) {
          seen[idx(x, y)] = true;
        }
      }
    }
  }

  // ---------- input ----------
  const held = new Set(); // directions held by keyboard or pad
  const KEYMAP = {
    arrowup: "up",
    w: "up",
    arrowdown: "down",
    s: "down",
    arrowleft: "left",
    a: "left",
    arrowright: "right",
    d: "right",
  };

  window.addEventListener("keydown", (ev) => {
    const k = ev.key.toLowerCase();
    const dir = KEYMAP[k];
    if (dir) {
      if (state === "playing") ev.preventDefault();
      held.add(dir);
      if (player) player.slide = null;
    } else if ((k === "p" || k === "escape") && !ev.repeat) {
      togglePause();
    } else if (
      k === "enter" &&
      !ev.repeat &&
      state !== "playing" &&
      !overlay.hidden
    ) {
      ev.preventDefault();
      startBtn.click();
    }
  });
  window.addEventListener("keyup", (ev) => {
    const dir = KEYMAP[ev.key.toLowerCase()];
    if (dir) held.delete(dir);
  });
  window.addEventListener("blur", () => {
    held.clear();
    if (state === "playing") togglePause();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && state === "playing") togglePause();
  });

  for (const b of document.querySelectorAll(".pad button")) {
    const dir = b.dataset.dir;
    const release = () => {
      held.delete(dir);
      b.classList.remove("held");
    };
    b.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      b.setPointerCapture(ev.pointerId);
      held.add(dir);
      b.classList.add("held");
      if (player) player.slide = null;
    });
    b.addEventListener("pointerup", release);
    b.addEventListener("pointercancel", release);
    b.addEventListener("lostpointercapture", release);
  }

  // Swipe on the maze: slide along the hallway until the next turn-off.
  let swipe = null;
  canvas.addEventListener("pointerdown", (ev) => {
    if (state !== "playing") return;
    ev.preventDefault();
    swipe = { x: ev.clientX, y: ev.clientY, id: ev.pointerId };
    canvas.setPointerCapture(ev.pointerId);
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!swipe || ev.pointerId !== swipe.id) return;
    const dx = ev.clientX - swipe.x;
    const dy = ev.clientY - swipe.y;
    if (Math.hypot(dx, dy) < 24) return;
    const dir =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "down"
          : "up";
    if (player) player.slide = dir;
    // Allow chaining swipes without lifting the finger.
    swipe.x = ev.clientX;
    swipe.y = ev.clientY;
  });
  const endSwipe = (ev) => {
    if (swipe && ev.pointerId === swipe.id) swipe = null;
  };
  canvas.addEventListener("pointerup", endSwipe);
  canvas.addEventListener("pointercancel", endSwipe);
  canvas.addEventListener("contextmenu", (ev) => ev.preventDefault());

  // ---------- screens ----------
  function showOverlay(title, html, button, showRestart = false) {
    overlayTitle.textContent = title;
    if (html !== null) overlayBody.innerHTML = html;
    startBtn.textContent = button;
    restartBtn.hidden = !showRestart;
    overlay.hidden = false;
    startBtn.focus({ preventScroll: true });
  }

  startBtn.addEventListener("click", () => {
    if (state === "paused") {
      togglePause();
      return;
    }
    const next =
      state === "done" ? level + 1 : state === "menu" ? unlocked : level;
    overlay.hidden = true;
    state = "playing";
    guardHistory();
    startLevel(next);
    tone(523, 0.12);
    tone(784, 0.2, "triangle", 0.12, 0.1);
  });
  restartBtn.addEventListener("click", () => {
    unlocked = 1;
    store.set("gem-maze-level", 1);
    state = "menu";
    startBtn.click();
  });
  pauseBtn.addEventListener("click", togglePause);

  function togglePause() {
    if (state === "playing") {
      state = "paused";
      held.clear();
      pauseBtn.textContent = "▶";
      pauseBtn.setAttribute("aria-label", "Resume");
      showOverlay("Paused", "<p>The beetles are waiting…</p>", "Resume");
    } else if (state === "paused") {
      state = "playing";
      overlay.hidden = true;
      pauseBtn.textContent = "⏸";
      pauseBtn.setAttribute("aria-label", "Pause");
    }
  }

  function finishLevel() {
    state = "done";
    const t = elapsed;
    const stars = t <= par ? 3 : t <= par * 1.5 ? 2 : 1;
    const bestKey = `gem-maze-best-${level}`;
    const prevBest = Number(store.get(bestKey, "0")) || 0;
    const newBest = !prevBest || t < prevBest;
    if (newBest) store.set(bestKey, t.toFixed(1));
    unlocked = Math.max(unlocked, level + 1);
    store.set("gem-maze-level", unlocked);
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      tone(f, 0.25, "triangle", 0.12, i * 0.09),
    );
    const nextCfg = levelConfig(level + 1);
    const thisCfg = levelConfig(level);
    let preview = "";
    if (nextCfg.beetles > thisCfg.beetles)
      preview = "🪲 Watch out: more beetles next level!";
    if (nextCfg.fog && !thisCfg.fog)
      preview = "🔦 Next level the lights go out!";
    if (nextCfg.fog < thisCfg.fog)
      preview = "🔦 Next level it gets even darker!";
    showOverlay(
      `Level ${level} cleared!`,
      `<p class="stars">${"⭐".repeat(stars)}${"☆".repeat(3 - stars)}</p>
       <p class="big">${t.toFixed(1)} s</p>
       <p>${stars < 3 ? `Beat ${par} s for 3 stars.` : "Speedy!"}${newBest && prevBest ? " 🏆 New best time!" : ""}</p>
       ${preview ? `<p>${preview}</p>` : ""}`,
      `Level ${level + 1} →`,
    );
  }

  // ---------- update ----------
  function tryMove(p, dir) {
    if (!isOpen(p.x, p.y, dir)) return false;
    p.from = { x: p.x, y: p.y };
    p.x += DIRS[dir][0];
    p.y += DIRS[dir][1];
    p.t = 0;
    p.dir = dir;
    if (dir === "left" || dir === "right") p.face = dir;
    return true;
  }

  function arrive() {
    reveal();
    const g = gems.findIndex((gm) => gm.x === player.x && gm.y === player.y);
    if (g >= 0) {
      const gem = gems.splice(g, 1)[0];
      const n = gemTotal - gems.length;
      tone(880 + n * 60, 0.15, "sine", 0.15);
      tone(1320 + n * 60, 0.2, "sine", 0.1, 0.07);
      for (let i = 0; i < 14; i++) {
        const a = rand(0, TAU);
        sparkles.push({
          x: gem.x + 0.5,
          y: gem.y + 0.5,
          vx: Math.cos(a) * 3,
          vy: Math.sin(a) * 3,
          life: 0.6,
          color: gem.color,
        });
      }
      if (!gems.length) tone(392, 0.5, "triangle", 0.12, 0.15, 784); // exit opens
      player.slide = null;
      updateHud();
    }
    if (!gems.length && player.x === exit.x && player.y === exit.y) {
      finishLevel();
      return;
    }
    // Sliding follows the hallway around bends and stops where it branches.
    if (player.slide) {
      const ways = exits(player.x, player.y).filter(
        (d) => d !== OPPOSITE[player.dir],
      );
      if (ways.length === 1) player.slide = ways[0];
      else player.slide = null;
    }
  }

  function updateHud() {
    levelEl.textContent = `Level ${level}`;
    gemsEl.textContent = `💎 ${gemTotal - gems.length}/${gemTotal}`;
    clockEl.textContent = `⏱ ${elapsed.toFixed(1)}`;
  }

  function update(dt) {
    time += dt;
    for (const s of sparkles) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.life -= dt;
    }
    sparkles = sparkles.filter((s) => s.life > 0);
    ouch = Math.max(0, ouch - dt);
    if (state !== "playing") return;

    elapsed += dt;
    clockEl.textContent = `⏱ ${elapsed.toFixed(1)}`;
    player.inv = Math.max(0, player.inv - dt);

    // player
    if (player.t < 1) {
      player.t = Math.min(1, player.t + dt * MOVE_SPEED);
      if (player.t >= 1) arrive();
    }
    if (state !== "playing") return;
    if (player.t >= 1) {
      let moved = false;
      // Newest held key wins, so pressing a second arrow turns right away.
      for (const dir of [...held].reverse()) {
        if (tryMove(player, dir)) {
          moved = true;
          break;
        }
      }
      if (!moved && player.slide && !tryMove(player, player.slide))
        player.slide = null;
    }
    const ease = player.t;
    player.fx = player.from
      ? player.from.x + (player.x - player.from.x) * ease
      : player.x;
    player.fy = player.from
      ? player.from.y + (player.y - player.from.y) * ease
      : player.y;

    // beetles wander, preferring not to turn back
    for (const b of beetles) {
      b.t = Math.min(1, b.t + dt * BEETLE_SPEED);
      if (b.t >= 1) {
        let ways = exits(b.x, b.y);
        if (ways.length > 1) ways = ways.filter((d) => d !== OPPOSITE[b.dir]);
        const dir = ways[randInt(ways.length)];
        b.from = { x: b.x, y: b.y };
        b.x += DIRS[dir][0];
        b.y += DIRS[dir][1];
        b.dir = dir;
        b.t = 0;
      }
      b.fx = b.from ? b.from.x + (b.x - b.from.x) * b.t : b.x;
      b.fy = b.from ? b.from.y + (b.y - b.from.y) * b.t : b.y;
      if (
        player.inv <= 0 &&
        Math.hypot(b.fx - player.fx, b.fy - player.fy) < 0.6
      ) {
        elapsed += 5;
        player.inv = 1.5;
        ouch = 1;
        tone(200, 0.3, "sawtooth", 0.1, 0, 80);
      }
    }
  }

  // ---------- drawing ----------
  function resize() {
    if (!cols) return;
    const availW = stage.clientWidth - 12;
    const availH = stage.clientHeight - 12;
    cell = Math.max(8, Math.floor(Math.min(availW / cols, availH / rows)));
    const w = cell * cols;
    const h = cell * rows;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ox = 0;
    oy = 0;
  }
  window.addEventListener("resize", resize);

  function drawGem(x, y, color, s) {
    const cx = ox + (x + 0.5) * cell;
    const cy = oy + (y + 0.5) * cell + Math.sin(time * 3 + x + y) * cell * 0.05;
    const r = cell * 0.3 * s;
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = cell * 0.4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.8, cy - r * 0.2);
    ctx.lineTo(cx, cy + r);
    ctx.lineTo(cx - r * 0.8, cy - r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.35, cy - r * 0.2);
    ctx.lineTo(cx - r * 0.35, cy - r * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer() {
    if (player.inv > 0 && Math.floor(time * 12) % 2 === 0) return;
    const cx = ox + (player.fx + 0.5) * cell;
    const cy = oy + (player.fy + 0.5) * cell;
    const r = cell * 0.34;
    ctx.save();
    ctx.shadowColor = "#fde68a";
    ctx.shadowBlur = cell * 0.5;
    ctx.fillStyle = "#fde68a";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    ctx.restore();
    const look = player.face === "left" ? -1 : 1;
    ctx.fillStyle = "#1a1033";
    ctx.beginPath();
    ctx.arc(cx + look * r * 0.15 - r * 0.28, cy - r * 0.15, r * 0.13, 0, TAU);
    ctx.arc(cx + look * r * 0.15 + r * 0.28, cy - r * 0.15, r * 0.13, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "#1a1033";
    ctx.lineWidth = Math.max(1.5, cell * 0.05);
    ctx.beginPath();
    if (ouch > 0)
      ctx.arc(
        cx + look * r * 0.15,
        cy + r * 0.45,
        r * 0.2,
        Math.PI * 1.15,
        Math.PI * 1.85,
      );
    else
      ctx.arc(
        cx + look * r * 0.15,
        cy + r * 0.1,
        r * 0.3,
        0.2 * Math.PI,
        0.8 * Math.PI,
      );
    ctx.stroke();
  }

  function drawBeetle(b) {
    const cx = ox + (b.fx + 0.5) * cell;
    const cy = oy + (b.fy + 0.5) * cell;
    const angle =
      { up: 0, right: Math.PI / 2, down: Math.PI, left: -Math.PI / 2 }[b.dir] ??
      0;
    const r = cell * 0.3;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    // legs
    ctx.strokeStyle = "#7f1d1d";
    ctx.lineWidth = Math.max(1, cell * 0.04);
    const wiggle = Math.sin(time * 20) * r * 0.2;
    for (const s of [-1, 1]) {
      for (const k of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(0, k * r);
        ctx.lineTo(s * r * 1.2, k * r + (s * k > 0 ? wiggle : -wiggle));
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#ef4444";
    ctx.beginPath();
    ctx.ellipse(0, r * 0.1, r * 0.8, r, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#1f1f1f";
    ctx.beginPath();
    ctx.arc(0, -r * 0.85, r * 0.45, 0, TAU);
    ctx.fill();
    ctx.fillRect(-r * 0.04, -r * 0.5, r * 0.08, r * 1.5);
    for (const [dx, dy] of [
      [-0.35, 0.1],
      [0.35, 0.1],
      [-0.3, 0.55],
      [0.3, 0.55],
    ]) {
      ctx.beginPath();
      ctx.arc(dx * r, dy * r, r * 0.13, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function draw() {
    const w = cell * cols;
    const h = cell * rows;
    ctx.fillStyle = "#24164a";
    ctx.fillRect(0, 0, w || canvas.width, h || canvas.height);
    if (!player) return;

    // exit
    const exitOpen = gems.length === 0;
    const ex = ox + exit.x * cell;
    const ey = oy + exit.y * cell;
    ctx.save();
    if (exitOpen) {
      ctx.shadowColor = "#4ade80";
      ctx.shadowBlur = cell * (0.6 + Math.sin(time * 5) * 0.3);
    }
    ctx.fillStyle = exitOpen ? "#4ade80" : "#57534e";
    ctx.fillRect(ex + cell * 0.15, ey + cell * 0.15, cell * 0.7, cell * 0.7);
    ctx.restore();
    ctx.font = `${Math.floor(cell * 0.5)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(exitOpen ? "🚪" : "🔒", ex + cell / 2, ey + cell / 2);

    for (const g of gems) drawGem(g.x, g.y, g.color, 1);
    for (const b of beetles) drawBeetle(b);

    // walls
    ctx.strokeStyle = "#a78bfa";
    ctx.lineWidth = Math.max(2, cell * 0.12);
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = ox + x * cell;
        const py = oy + y * cell;
        const o = open[idx(x, y)];
        if (!(o & 1)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px + cell, py);
        }
        if (!(o & 8)) {
          ctx.moveTo(px, py);
          ctx.lineTo(px, py + cell);
        }
        if (x === cols - 1 && !(o & 2)) {
          ctx.moveTo(px + cell, py);
          ctx.lineTo(px + cell, py + cell);
        }
        if (y === rows - 1 && !(o & 4)) {
          ctx.moveTo(px, py + cell);
          ctx.lineTo(px + cell, py + cell);
        }
      }
    }
    ctx.stroke();

    for (const s of sparkles) {
      ctx.globalAlpha = s.life / 0.6;
      ctx.fillStyle = s.color;
      ctx.fillRect(ox + s.x * cell - 2, oy + s.y * cell - 2, 4, 4);
    }
    ctx.globalAlpha = 1;

    // fog: dark everywhere you can't see, dim where you've been
    if (fog) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const d = Math.hypot(x - player.fx, y - player.fy);
          if (d <= fog - 0.5) continue;
          const edge = Math.min(1, (d - (fog - 0.5)) / 1);
          const base = seen[idx(x, y)] ? 0.7 : 1;
          ctx.fillStyle = `rgba(10,6,24,${base * Math.max(edge, base === 1 ? 1 : edge)})`;
          ctx.fillRect(
            ox + x * cell - 0.5,
            oy + y * cell - 0.5,
            cell + 1,
            cell + 1,
          );
        }
      }
      // The exit is always marked, so you know where you're heading.
      ctx.globalAlpha = 0.8;
      ctx.fillText(exitOpen ? "🚪" : "🔒", ex + cell / 2, ey + cell / 2);
      ctx.globalAlpha = 1;
    }

    drawPlayer();

    if (ouch > 0) {
      ctx.save();
      ctx.globalAlpha = ouch;
      ctx.font = `bold ${Math.max(14, Math.floor(cell * 0.7))}px 'Roboto Mono', monospace`;
      ctx.fillStyle = "#f87171";
      ctx.fillText(
        "+5s",
        ox + (player.fx + 0.5) * cell,
        oy + (player.fy - 0.4 - (1 - ouch)) * cell,
      );
      ctx.restore();
    }
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  // ---------- boot ----------
  updateMute();
  if (unlocked > 1) {
    startBtn.textContent = `Continue: level ${unlocked}`;
    restartBtn.hidden = false;
  }
  // A small maze behind the menu so the screen isn't empty.
  startLevel(1);
  state = "menu";
  startBtn.focus({ preventScroll: true });
  requestAnimationFrame(frame);

  // ---------- touch-screen kid-proofing ----------
  // Little hands tap fast and start swipes at the very edge of the screen. On
  // an iPhone that zooms the page, or swipes back through history mid-game.
  // style.css also sets `touch-action: manipulation` to stop double-tap zoom.
  let lastTouchEnd = 0;
  document.addEventListener(
    "touchend",
    (ev) => {
      // A second tap within 350 ms is a double tap: don't let it zoom. Links
      // and buttons are left alone so they still click.
      const onControl = ev.target.closest?.("a, button");
      if (ev.timeStamp - lastTouchEnd < 350 && !onControl) ev.preventDefault();
      lastTouchEnd = ev.timeStamp;
    },
    { passive: false },
  );
  // Safari's pinch zoom.
  document.addEventListener("gesturestart", (ev) => ev.preventDefault());
  document.addEventListener(
    "touchstart",
    (ev) => {
      // Safari's back/forward swipe starts with a touch at the very edge.
      const x = ev.touches[0]?.clientX ?? window.innerWidth / 2;
      const atEdge = x < 24 || x > window.innerWidth - 24;
      if (atEdge && !ev.target.closest?.("a, button")) ev.preventDefault();
    },
    { passive: false },
  );

  // Once a game starts, a back swipe that still gets through lands back on the
  // game instead of leaving it. The ← link still leaves.
  let guardingHistory = false;
  function guardHistory() {
    if (guardingHistory) return;
    guardingHistory = true;
    try {
      history.pushState({ inGame: true }, "");
      window.addEventListener("popstate", () =>
        history.pushState({ inGame: true }, ""),
      );
    } catch {
      // history unavailable
    }
  }

  // iPhones only let sound start from a finished tap (touchend or click), not
  // from pointerdown, so wake the audio on every finished tap and key press.
  function wakeAudio() {
    if (muted) return;
    try {
      audio ??= new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state !== "running") audio.resume();
    } catch {
      // no audio
    }
  }
  for (const type of ["touchend", "click", "keydown"]) {
    document.addEventListener(type, wakeAudio, true);
  }
})();
