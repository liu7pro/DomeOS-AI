/* dome-dino.js —— 自包含的 Chrome 恐龙小游戏弹窗
 * 由 settings.html 以 <script type="module" src="./assets/dome-dino.js"> 加载。
 * 不依赖任何外部库，不 import / export，注册事件、创建浮层、跑游戏循环都在本文件内完成。
 * 打开方式：URL 带 ?section=about（设置页切到「关于」）时，在页面上双击（捕获阶段）弹出。
 */
(function () {
  'use strict';

  // 若被重复加载则直接退出，避免重复注册监听或出现两个浮层
  if (window.__domeDinoMounted) return;
  window.__domeDinoMounted = true;

  // ============ 基础常量（画布逻辑尺寸 600×150 CSS 像素） ============
  var CANVAS_W = 600;
  var CANVAS_H = 150;
  var GROUND_Y = 127;        // 地面虚线所在 y
  var GROUND_PERIOD = 14;    // 地面虚线「线段 + 间隔」周期
  var GROUND_DASH = 9;       // 单段虚线长度

  // Chrome 原生配色：浅灰底、深灰精灵与地面线
  var COLOR_BG = '#f7f7f7';
  var COLOR_INK = '#535353';
  var COLOR_CLOUD = '#c8c8c8';

  var DINO_X = 30;           // 恐龙固定左边缘
  var DINO_CELL = 2.05;      // 恐龙位图单元格边长（20 列 × 23 行 ≈ 41×47）
  var DINO_W = 20 * DINO_CELL;
  var DINO_H = 23 * DINO_CELL;
  var DUCK_CELL = 2.5;       // 下蹲位图单元格（20 列 × 12 行 = 50×30）
  var DUCK_W = 20 * DUCK_CELL;
  var DUCK_H = 12 * DUCK_CELL;

  var GRAVITY = 0.62;        // 每个「帧单位」的下落加速度
  var JUMP_V = -9.4;         // 起跳初速度
  var FAST_FALL = 2.6;       // 空中下蹲时下落加速倍数
  var SPEED_MIN = 6;
  var SPEED_MAX = 13;
  var SPEED_RAMP_DIST = 6000; // 达到最高速所需距离

  // ============ 精灵位图：每行用若干 [起列, 止列] 区间描述，避免手写字符串数错列 ============
  // 恐龙身体（19 行），腿部在下方按帧拼接
  var DINO_BODY = [
    [[11, 15]],              // 头顶
    [[10, 16]],
    [[10, 18]],
    [[10, 19]],
    [[10, 14], [16, 19]],    // 眼睛（第 15 列留空）
    [[10, 19]],
    [[10, 17]],              // 嘴部缺口
    [[10, 16]],              // 脖颈
    [[10, 17]],
    [[10, 17]],
    [[9, 16]],
    [[2, 15]],               // 背部 + 尾巴
    [[1, 16]],
    [[1, 17]],
    [[1, 18]],               // 前爪
    [[2, 17]],
    [[3, 15]],
    [[4, 14]],
    [[5, 12]]
  ];
  var DINO_IDLE = DINO_BODY.concat([
    [[5, 6], [10, 11]], [[5, 6], [10, 11]], [[5, 6], [10, 11]], [[5, 6], [10, 11]]
  ]);
  var DINO_RUN_A = DINO_BODY.concat([
    [[5, 6], [10, 11]], [[5, 6]], [[5, 6]], [[5, 6]]   // 后腿落地、前腿抬起
  ]);
  var DINO_RUN_B = DINO_BODY.concat([
    [[5, 6], [10, 11]], [[10, 11]], [[10, 11]], [[10, 11]] // 前腿落地、后腿抬起
  ]);

  // 下蹲：身体压低、头部前伸
  var DUCK_MAP = [
    [[12, 15]],
    [[12, 16]],
    [[12, 18]],
    [[12, 15], [16, 19]],    // 眼睛
    [[12, 17]],
    [[3, 16]],
    [[2, 17]],
    [[2, 17]],
    [[3, 16]],
    [[5, 7], [11, 13]],
    [[5, 7], [11, 13]],
    [[5, 7], [11, 13]]
  ];

  // 仙人掌：中央主干 + 左右各一只手臂
  var CACTUS_MAP = [
    [[2, 4]],
    [[2, 4]],
    [[2, 4]],
    [[2, 4]],
    [[2, 4]],
    [[0, 0], [2, 4]],
    [[0, 0], [2, 4]],
    [[0, 0], [2, 4], [6, 6]],
    [[0, 4], [6, 6]],
    [[2, 4], [6, 6]],
    [[2, 6]],
    [[2, 4]],
    [[2, 4]],
    [[2, 4]],
    [[2, 4]]
  ];

  var CLOUD_MAP = [
    [[3, 5]],
    [[2, 7]],
    [[1, 8]],
    [[0, 8]]
  ];

  // ============ 全局状态 ============
  var st = {
    open: false,        // 浮层是否打开
    rafId: 0,           // requestAnimationFrame 句柄
    lastTime: 0,
    overlay: null,
    canvas: null,
    ctx: null,
    // 游戏运行态
    dino: null,
    obstacles: [],
    clouds: [],
    groundOffset: 0,
    speed: SPEED_MIN,
    distance: 0,
    score: 0,
    best: 0,            // 最高分（HI），仅在本次页面会话内保留
    gameOver: false,
    legFrame: 0,
    legTimer: 0,
    spawnTimer: 0,
    cloudTimer: 0
  };

  // ============ 工具函数 ============

  // 按位图绘制精灵：map 为「每行的 [起列, 止列] 区间数组」，cell 为单元格边长，
  // bottomY 为精灵底边。用相邻行/列的四舍五入边界计算宽高，保证像素块相接不留缝。
  function drawBitmap(ctx, map, left, bottomY, cell, color) {
    ctx.fillStyle = color;
    var rows = map.length;
    var topF = bottomY - rows * cell;
    for (var r = 0; r < rows; r++) {
      var ranges = map[r];
      if (!ranges) continue;
      var ry = Math.round(topF + r * cell);
      var rh = Math.round(topF + (r + 1) * cell) - ry;
      for (var i = 0; i < ranges.length; i++) {
        var x0 = Math.round(left + ranges[i][0] * cell);
        var x1 = Math.round(left + (ranges[i][1] + 1) * cell);
        ctx.fillRect(x0, ry, x1 - x0, rh);
      }
    }
  }

  function pad5(n) {
    var s = String(n | 0);
    while (s.length < 5) s = '0' + s;
    return s;
  }

  // ============ 游戏状态管理 ============

  function resetGame() {
    st.dino = { y: GROUND_Y, vy: 0, jumping: false, ducking: false };
    st.obstacles = [];
    st.clouds = [{ x: 430, y: 44 }];
    st.groundOffset = 0;
    st.speed = SPEED_MIN;
    st.distance = 0;
    st.score = 0;
    st.gameOver = false;
    st.legFrame = 0;
    st.legTimer = 0;
    st.spawnTimer = 260;
    st.cloudTimer = 520;
  }

  function tryJump() {
    var d = st.dino;
    if (!st.open || !d || st.gameOver || d.jumping) return;
    d.jumping = true;
    d.ducking = false;
    d.vy = JUMP_V;
  }

  function restart() {
    if (!st.open) return;
    resetGame();
  }

  function spawnObstacle() {
    var large = Math.random() < 0.38;
    var cell = large ? 3.2 : 2.2;
    var maxCount = large ? 2 : 3;
    var count = 1 + Math.floor(Math.random() * maxCount);
    var unitW = Math.round(7 * cell);
    var w = unitW * count;
    var h = Math.round(15 * cell);
    st.obstacles.push({ x: CANVAS_W + 8, cell: cell, count: count, unitW: unitW, w: w, h: h });
    // 以下一次生成所需「像素距离」控制节奏：速度越快间隔越大，使时间上保持均匀
    st.spawnTimer = w + st.speed * (28 + Math.random() * 42);
  }

  function spawnCloud() {
    st.clouds.push({ x: CANVAS_W + 10, y: 24 + Math.random() * 46 });
    st.cloudTimer = 260 + Math.random() * 620;
  }

  // 恐龙包围盒与仙人掌包围盒的相交检测（命中盒比精灵略收窄，更贴近 Chrome 手感）
  function collide() {
    var d = st.dino;
    var ducking = d.ducking && !d.jumping;
    var dh = ducking ? DUCK_H : DINO_H;
    var dw = ducking ? DUCK_W : DINO_W;
    var dl = DINO_X + 6;
    var dr = DINO_X + dw - 8;
    var dTop = d.y - dh + 8;
    var dBot = d.y - 3;
    for (var i = 0; i < st.obstacles.length; i++) {
      var o = st.obstacles[i];
      var ol = o.x + 3;
      var or = o.x + o.w - 3;
      var ot = GROUND_Y - o.h + 4;
      if (dl < or && dr > ol && dTop < GROUND_Y && dBot > ot) return true;
    }
    return false;
  }

  // ============ 每帧逻辑更新 ============

  function update(dt) {
    if (st.gameOver) return;
    var f = dt / 16.667;
    var d = st.dino;

    // 速度随距离线性提升
    st.speed = SPEED_MIN + (SPEED_MAX - SPEED_MIN) * Math.min(1, st.distance / SPEED_RAMP_DIST);
    st.distance += st.speed * f;
    st.score = Math.floor(st.distance / 8);
    st.groundOffset = (st.groundOffset + st.speed * f) % GROUND_PERIOD;

    // 跳跃物理（空中按下蹲会加速下落）
    if (d.jumping) {
      d.vy += GRAVITY * (d.ducking ? FAST_FALL : 1) * f;
      d.y += d.vy * f;
      if (d.y >= GROUND_Y) { d.y = GROUND_Y; d.vy = 0; d.jumping = false; }
    }

    // 跑动腿部两帧交替（仅在地面且未下蹲时）
    if (!d.jumping && !d.ducking) {
      st.legTimer += dt;
      if (st.legTimer >= 100) { st.legTimer = 0; st.legFrame ^= 1; }
    }

    // 障碍移动与回收
    for (var i = 0; i < st.obstacles.length; i++) st.obstacles[i].x -= st.speed * f;
    while (st.obstacles.length && st.obstacles[0].x + st.obstacles[0].w < -24) st.obstacles.shift();
    st.spawnTimer -= st.speed * f;
    if (st.spawnTimer <= 0) spawnObstacle();

    // 云朵（移动更慢）
    for (var j = 0; j < st.clouds.length; j++) st.clouds[j].x -= st.speed * 0.35 * f;
    while (st.clouds.length && st.clouds[0].x < -60) st.clouds.shift();
    st.cloudTimer -= st.speed * f;
    if (st.cloudTimer <= 0) spawnCloud();

    // 碰撞 → 游戏结束
    if (collide()) {
      st.gameOver = true;
      d.jumping = false;
      d.vy = 0;
      d.y = GROUND_Y;
      if (st.score > st.best) st.best = st.score;
    }
  }

  // ============ 渲染 ============

  function drawDino(ctx) {
    var d = st.dino;
    if (!d) return;
    if (d.ducking && !d.jumping) {
      drawBitmap(ctx, DUCK_MAP, DINO_X, d.y, DUCK_CELL, COLOR_INK);
      return;
    }
    var map = DINO_IDLE;
    if (!st.gameOver && !d.jumping) map = st.legFrame ? DINO_RUN_A : DINO_RUN_B;
    drawBitmap(ctx, map, DINO_X, d.y, DINO_CELL, COLOR_INK);
  }

  function drawScore(ctx) {
    ctx.fillStyle = COLOR_INK;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '11px "Courier New", Consolas, monospace';
    var cur = pad5(st.score);
    if (st.best > 0) {
      ctx.fillText('HI ' + pad5(st.best) + '  ' + cur, CANVAS_W - 12, 22);
    } else {
      ctx.fillText(cur, CANVAS_W - 12, 22);
    }
  }

  function drawGameOver(ctx) {
    ctx.fillStyle = COLOR_INK;
    ctx.textAlign = 'center';
    ctx.font = 'bold 18px "Courier New", Consolas, monospace';
    ctx.fillText('GAME OVER', CANVAS_W / 2, 62);
    ctx.font = '12px "Courier New", Consolas, monospace';
    ctx.fillText('按 空格 / 点击 重新开始', CANVAS_W / 2, 86);
  }

  function render() {
    var ctx = st.ctx;
    if (!ctx) return;
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // 云朵
    for (var i = 0; i < st.clouds.length; i++) {
      drawBitmap(ctx, CLOUD_MAP, st.clouds[i].x, st.clouds[i].y + 16, 4, COLOR_CLOUD);
    }

    // 地面虚线（随前进方向向左滚动）
    ctx.fillStyle = COLOR_INK;
    var gx = -st.groundOffset;
    while (gx < CANVAS_W) {
      if (gx + GROUND_DASH > 0) ctx.fillRect(Math.round(gx), GROUND_Y, GROUND_DASH, 2);
      gx += GROUND_PERIOD;
    }

    // 仙人掌障碍
    for (var k = 0; k < st.obstacles.length; k++) {
      var o = st.obstacles[k];
      for (var c = 0; c < o.count; c++) {
        drawBitmap(ctx, CACTUS_MAP, o.x + c * o.unitW, GROUND_Y, o.cell, COLOR_INK);
      }
    }

    drawDino(ctx);
    drawScore(ctx);
    if (st.gameOver) drawGameOver(ctx);
  }

  // ============ 游戏循环（close 时彻底停止，不留常驻开销） ============

  function loop(now) {
    if (!st.open) return;
    var dt = now - st.lastTime;
    if (!(dt > 0)) dt = 16.667;   // 首帧保护
    if (dt > 50) dt = 50;         // 长时间挂起后回到前台时限制步长
    st.lastTime = now;
    update(dt);
    render();
    st.rafId = window.requestAnimationFrame(loop);
  }

  function startLoop() {
    st.lastTime = performance.now();
    if (!st.rafId) st.rafId = window.requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (st.rafId) {
      window.cancelAnimationFrame(st.rafId);
      st.rafId = 0;
    }
  }

  // ============ 键盘输入 ============

  function onKeyDown(e) {
    if (!st.open) return;
    var k = e.key;
    if (k === 'Escape') {
      e.preventDefault();
      closePopup();
      return;
    }
    if (k === ' ' || k === 'ArrowUp') {         // 空格 / ↑：跳跃；结束后重开
      e.preventDefault();
      if (st.gameOver) restart();
      else tryJump();
      return;
    }
    if (k === 'ArrowDown') {                    // ↓：下蹲
      e.preventDefault();
      if (!st.gameOver && st.dino) st.dino.ducking = true;
    }
  }

  function onKeyUp(e) {
    if (!st.open) return;
    if (e.key === 'ArrowDown' && st.dino) st.dino.ducking = false;
  }

  // ============ 浮层 DOM 构建 ============

  function buildPopup() {
    var dpr = window.devicePixelRatio || 1;

    var overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Chrome 恐龙小游戏');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483000',
      'display:flex', 'align-items:center', 'justify-content:center',
      'padding:24px', 'box-sizing:border-box',
      'background:rgba(6,10,18,0.45)'    // 半透明遮罩
    ].join(';');

    var card = document.createElement('div');
    card.style.cssText = [
      'background:var(--dome-panel, rgba(255,255,255,0.75))',   // 跟随应用主题
      'color:var(--dome-text, #0f172a)',
      'border:1px solid var(--dome-line, rgba(15,23,42,0.1))',
      'border-radius:14px',
      'box-shadow:var(--dome-shadow, 0 10px 30px rgba(0,0,0,0.28))',
      'padding:12px 16px 16px', 'box-sizing:border-box'
    ].join(';');

    var head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin:0 0 8px';

    var titleWrap = document.createElement('div');
    titleWrap.style.cssText = 'display:flex;align-items:baseline';

    var title = document.createElement('div');
    title.textContent = 'Dino';
    title.style.cssText = 'font-size:13px;font-weight:600;letter-spacing:.4px;color:var(--dome-text, #0f172a)';

    var hint = document.createElement('div');
    hint.textContent = '空格 / ↑ 跳跃 · ↓ 下蹲';
    hint.style.cssText = 'margin-left:12px;font-size:11px;color:var(--dome-text3, #94a3b8)';
    titleWrap.appendChild(title);
    titleWrap.appendChild(hint);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.textContent = '×';
    closeBtn.style.cssText = [
      'width:26px', 'height:26px', 'padding:0', 'cursor:pointer',
      'display:flex', 'align-items:center', 'justify-content:center',
      'border:1px solid var(--dome-line, rgba(15,23,42,0.15))',
      'border-radius:8px', 'background:transparent',
      'color:var(--dome-text, #0f172a)', 'font-size:16px', 'line-height:1'
    ].join(';');

    var canvas = document.createElement('canvas');
    canvas.style.cssText = [
      'display:block',
      'width:' + CANVAS_W + 'px', 'height:' + CANVAS_H + 'px',
      'background:' + COLOR_BG,
      'image-rendering:pixelated',
      'border-radius:8px', 'cursor:pointer',
      'user-select:none', '-webkit-user-select:none',
      'touch-action:manipulation'
    ].join(';');
    canvas.width = Math.round(CANVAS_W * dpr);   // 用 devicePixelRatio 做清晰渲染
    canvas.height = Math.round(CANVAS_H * dpr);

    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);      // 之后按 600×150 逻辑坐标绘制
    ctx.imageSmoothingEnabled = false;

    // 事件绑定：这些元素随浮层一起移除，无需手动解绑
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closePopup();
    });
    // 点击遮罩空白处关闭（卡片内点击 target 不是 overlay，不会误关）
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closePopup();
    });
    // 画布点击：结束后重开，否则跳跃
    canvas.addEventListener('click', function (e) {
      e.stopPropagation();
      if (st.gameOver) restart();
      else tryJump();
    });

    head.appendChild(titleWrap);
    head.appendChild(closeBtn);
    card.appendChild(head);
    card.appendChild(canvas);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    st.overlay = overlay;
    st.canvas = canvas;
    st.ctx = ctx;
  }

  // ============ 打开 / 关闭 ============

  function openPopup() {
    if (st.open) return;
    st.open = true;
    buildPopup();
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    resetGame();
    startLoop();
  }

  function closePopup() {
    if (!st.open) return;
    st.open = false;
    stopLoop();                                        // 停止 rAF 循环
    window.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('keyup', onKeyUp, true);
    if (st.overlay && st.overlay.parentNode) st.overlay.parentNode.removeChild(st.overlay);
    st.overlay = null;
    st.canvas = null;
    st.ctx = null;
    st.dino = null;
  }

  // ============ 唯一常驻监听：捕获阶段的双击，用于打开浮层 ============
  document.addEventListener('dblclick', function (e) {
    if (st.open) return;                                        // 已打开时忽略
    if (st.overlay && st.overlay.contains(e.target)) return;    // 双击落在浮层内部时忽略
    var section = null;
    try {
      section = new URLSearchParams(window.location.search).get('section');
    } catch (err) {
      section = null;
    }
    if (section !== 'about') return;                            // 仅在「关于」分区响应
    openPopup();
  }, true);
})();
