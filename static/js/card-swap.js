/*
 * CardSwap —— React Bits 同名组件的原生移植版
 * 原组件：https://reactbits.dev/components/card-swap
 *
 * 说明：
 *   · 原版的双弹簧积分（integrate / scalar）、堆叠几何（stackBounds）、
 *     拖拽抛掷判定、视差、错峰换位等模型逐项等价移植。
 *   · 原版用 @hugeicons 图标，这里省略（卡片改用标题+图片+描述），
 *     避免为几个图标引入额外依赖。
 *   · 用 requestAnimationFrame + 原生 DOM 重写，无 React 依赖。
 *
 * 用法：
 *   <div class="card-swap-host">
 *     <div data-card-swap
 *          data-items='[{"title":"...","image":"...","description":"...","link":"..."}]'></div>
 *   </div>
 */
(function (global) {
    'use strict';

    var PERSPECTIVE = 900;
    var TAU = Math.PI * 2;
    var STEP = 1 / 240;
    var PAD = 32;
    var AXES = ['x', 'y', 'z', 'r', 'p'];
    var DOWN = { x: 0, y: 1 };

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

    function stackBounds(cfg) {
        var width = cfg.width, height = cfg.height;
        var cardDistance = cfg.cardDistance, verticalDistance = cfg.verticalDistance;
        var depth = cfg.depth, skewAmount = cfg.skewAmount;
        var visible = cfg.visible, hoverSpread = cfg.hoverSpread;
        var slope = Math.tan((skewAmount * Math.PI) / 180);
        var spread = 1 + Math.max(0, hoverSpread);
        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (var i = 0; i < visible; i++) {
            var scale = PERSPECTIVE / (PERSPECTIVE + i * depth);
            var us = [-width / 2, width / 2];
            var vs = [-height / 2, height / 2];
            for (var a = 0; a < 2; a++) {
                for (var b = 0; b < 2; b++) {
                    var u = us[a], v = vs[b];
                    var x = (i * cardDistance * spread + u) * scale;
                    var y = (-i * verticalDistance * spread + v + u * slope) * scale;
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        return {
            width: Math.ceil(maxX - minX + PAD * 2),
            height: Math.ceil(maxY - minY + PAD * 2),
            originX: PAD - minX,
            originY: PAD - minY
        };
    }

    var THEMES = {
        dark: {
            '--swap-tile': 'linear-gradient(180deg, #3a3644 0%, #27242f 100%)',
            '--swap-tile-edge': 'rgba(255, 255, 255, 0.07)',
            '--swap-tile-highlight': 'rgba(255, 255, 255, 0.12)',
            '--swap-shadow': '0 30px 60px -24px rgba(0, 0, 0, 0.8), 0 10px 24px -12px rgba(0, 0, 0, 0.55)',
            '--swap-media-edge': 'rgba(255, 255, 255, 0.06)',
            '--swap-ink': '#f4f4f5',
            '--swap-badge': 'rgba(255, 255, 255, 0.08)',
            '--swap-shade': '#100e15'
        },
        light: {
            '--swap-tile': 'linear-gradient(180deg, #ffffff 0%, #f6f6f8 100%)',
            '--swap-tile-edge': 'rgba(24, 24, 27, 0.08)',
            '--swap-tile-highlight': 'rgba(255, 255, 255, 1)',
            '--swap-shadow': '0 30px 60px -28px rgba(24, 24, 27, 0.35), 0 10px 24px -14px rgba(24, 24, 27, 0.2)',
            '--swap-media-edge': 'rgba(24, 24, 27, 0.06)',
            '--swap-ink': '#27272a',
            '--swap-badge': 'rgba(24, 24, 27, 0.05)',
            '--swap-shade': '#ffffff'
        }
    };

    function CardSwap(root, options) {
        var opts = options || {};
        var items = opts.items || [];
        if (!items.length) return { next: function () {}, prev: function () {}, destroy: function () {} };

        var settings = {
            width: Math.max(40, Number(opts.width) || 460),
            height: Math.max(40, Number(opts.height) || 340),
            dx: opts.cardDistance == null ? 60 : opts.cardDistance,
            dy: opts.verticalDistance == null ? 70 : opts.verticalDistance,
            dz: Math.max(0, opts.depth == null ? 90 : opts.depth),
            skew: opts.skewAmount == null ? 6 : opts.skewAmount,
            delay: opts.delay == null ? 4000 : opts.delay,
            autoplay: opts.autoplay !== false,
            pauseOnHover: opts.pauseOnHover !== false,
            draggable: opts.draggable !== false,
            speed: clamp(opts.speed == null ? 1 : opts.speed, 0.1, 4),
            bounce: clamp(opts.bounce == null ? 0.35 : opts.bounce, 0, 1),
            parallax: clamp(opts.parallax == null ? 0.5 : opts.parallax, 0, 1),
            hoverSpread: Math.max(0, opts.hoverSpread == null ? 0.12 : opts.hoverSpread),
            /* 退场方向：默认向下（原版行为），可切成向右侧滑出 */
            exitDirection: opts.exitDirection === 'right' ? { x: 1, y: 0 } : DOWN,
            dim: clamp(opts.dim == null ? 0.5 : opts.dim, 0, 1),
            radius: opts.cardRadius == null ? 18 : opts.cardRadius,
            intro: opts.intro !== false,
            theme: opts.theme === 'light' ? 'light' : opts.theme === 'dark' ? 'dark' : 'auto',
            onChange: opts.onChange || null,
            onCardClick: opts.onCardClick || null
        };

        var count = items.length;
        var visible = clamp(Math.round(opts.visibleCards == null ? 4 : opts.visibleCards), 1, Math.max(1, count));

        function resolvedTheme() {
            if (settings.theme === 'light') return 'light';
            if (settings.theme === 'dark') return 'dark';
            return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        }

        function applyTheme() {
            var palette = THEMES[resolvedTheme()];
            for (var key in palette) {
                if (Object.prototype.hasOwnProperty.call(palette, key)) root.style.setProperty(key, palette[key]);
            }
        }

        var bounds = stackBounds({
            width: settings.width, height: settings.height,
            cardDistance: settings.dx, verticalDistance: settings.dy,
            depth: settings.dz, skewAmount: settings.skew,
            visible: visible, hoverSpread: settings.hoverSpread
        });

        root.classList.add('card-swap');
        root.setAttribute('tabindex', '0');
        root.setAttribute('role', 'region');
        root.setAttribute('aria-roledescription', 'carousel');
        root.setAttribute('aria-label', opts.ariaLabel || '项目卡片');
        root.style.setProperty('--swap-w', settings.width + 'px');
        root.style.setProperty('--swap-h', settings.height + 'px');
        root.style.setProperty('--swap-ox', bounds.originX + 'px');
        root.style.setProperty('--swap-oy', bounds.originY + 'px');
        root.style.setProperty('--swap-stage-w', bounds.width + 'px');
        root.style.setProperty('--swap-stage-h', bounds.height + 'px');
        root.style.setProperty('--swap-ratio', bounds.width + ' / ' + bounds.height);
        root.style.setProperty('--swap-radius', Math.max(0, settings.radius) + 'px');
        applyTheme();

        // ---- DOM ----
        var sizer = document.createElement('div');
        sizer.className = 'card-swap-sizer';
        sizer.setAttribute('aria-hidden', 'true');
        sizer.innerHTML = '<span></span>';

        var stage = document.createElement('div');
        stage.className = 'card-swap-stage';

        var slots = [];
        var shades = [];
        items.forEach(function (item, index) {
            var slot = document.createElement('div');
            slot.className = 'card-swap-slot';
            slot.setAttribute('data-swap-index', String(index));

            var card = document.createElement('div');
            card.className = 'card-swap-card';

            var body = document.createElement('div');
            body.className = 'card-swap-item';

            if (item.title) {
                var head = document.createElement('div');
                head.className = 'card-swap-head';
                var title = document.createElement('span');
                title.className = 'card-swap-title';
                title.textContent = item.title;
                head.appendChild(title);
                body.appendChild(head);
            }
            if (item.image) {
                var media = document.createElement('div');
                media.className = 'card-swap-media';
                var img = document.createElement('img');
                img.src = item.image;
                img.alt = item.alt || item.title || '';
                img.draggable = false;
                media.appendChild(img);
                body.appendChild(media);
            }
            if (item.description) {
                var desc = document.createElement('div');
                desc.className = 'card-swap-note';
                desc.textContent = item.description;
                body.appendChild(desc);
            }
            if (item.link) {
                var go = document.createElement('a');
                go.className = 'card-swap-cta';
                go.href = item.link;
                go.textContent = item.cta || '了解更多';
                body.appendChild(go);
            }

            card.appendChild(body);
            var rim = document.createElement('span');
            rim.className = 'card-swap-card-rim';
            rim.setAttribute('aria-hidden', 'true');
            card.appendChild(rim);
            slot.appendChild(card);

            var shade = document.createElement('span');
            shade.className = 'card-swap-shade';
            shade.setAttribute('aria-hidden', 'true');
            slot.appendChild(shade);

            stage.appendChild(slot);
            slots.push(slot);
            shades.push(shade);
        });

        root.appendChild(sizer);
        root.appendChild(stage);

        var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var now = performance.now();
        var s0 = settings;

        var deck = [];
        for (var k = 0; k < count; k++) {
            deck.push({
                el: slots[k], shade: shades[k], index: k,
                pos: k, from: k, hold: 0, nudge: 0,
                phase: 'rest', dir: { x: 0, y: 1 }, tilt: 0, top: 0, under: false,
                x: 0, y: 0, z: 0, r: 0, p: 0,
                v: { x: 0, y: 0, z: 0, r: 0, p: 0 }
            });
        }

        var state = {
            order: deck.map(function (c) { return c.index; }),
            raf: 0, last: 0, timer: 0, queue: [],
            layers: 0, scale: 1,
            hovered: false, overCard: false, inView: true,
            drag: null, spread: 0, spreadV: 0,
            px: 0, py: 0, pvx: 0, pvy: 0, tx: 0, ty: 0,
            dragged: false, alive: true
        };

        function slotOf(position) {
            var q = Math.min(position, visible);
            var spread = 1 + state.spread;
            return { x: q * settings.dx * spread, y: -q * settings.dy * spread, z: -q * settings.dz, r: 0, p: q };
        }

        function clearance(dir) {
            return Math.abs(dir.x) * settings.width + Math.abs(dir.y) * settings.height + 12;
        }

        function targetOf(card, time) {
            if (card.phase === 'exit') {
                var base = slotOf(0);
                var reach = clearance(card.dir) * 1.3;
                return { x: base.x + card.dir.x * reach, y: base.y + card.dir.y * reach, z: base.z, r: card.tilt, p: 0 };
            }
            if (card.phase === 'enter') {
                var b2 = slotOf(0);
                var ex = settings.exitDirection;
                var exReach = clearance(ex) * 1.3;
                return { x: b2.x + ex.x * exReach, y: b2.y + ex.y * exReach, z: b2.z, r: 0, p: card.p };
            }
            var position = (time < card.hold ? card.from : card.pos) + card.nudge;
            return slotOf(Math.max(0, position));
        }

        function layerOf(card) {
            if (card.top) return 1000 + card.top;
            if (card.under) return 1;
            return 10 + (count - card.pos) * 2;
        }

        function write(card) {
            var el = card.el;
            if (!el) return;
            el.style.transform = 'translate3d(' + card.x.toFixed(2) + 'px, ' + card.y.toFixed(2) + 'px, ' +
                card.z.toFixed(2) + 'px) rotate(' + card.r.toFixed(3) + 'deg) skewY(' + settings.skew + 'deg)';
            el.style.zIndex = String(layerOf(card));
            var fade = clamp(visible - card.p, 0, 1);
            el.style.opacity = fade < 1 ? fade.toFixed(3) : '';
            el.style.visibility = fade <= 0.001 ? 'hidden' : '';
            if (card.shade) {
                var depthT = clamp(card.p / Math.max(1, visible - 1), 0, 1);
                card.shade.style.opacity = (settings.dim * 0.62 * depthT).toFixed(3);
            }
            el.style.cursor = card.phase === 'drag' ? 'grabbing' : card.pos > 0 ? 'pointer' : settings.draggable ? 'grab' : '';
            if (card.pos === 0) el.setAttribute('data-front', '');
            else el.removeAttribute('data-front');
        }

        function writeStage() {
            stage.style.perspectiveOrigin = (bounds.originX + state.px).toFixed(2) + 'px ' +
                (bounds.originY + state.py).toFixed(2) + 'px';
        }

        function integrate(card, target, omega, zeta, dt) {
            var kk = omega * omega;
            var dd = 2 * zeta * omega;
            var steps = Math.max(1, Math.ceil(dt / STEP));
            var h = dt / steps;
            for (var st = 0; st < steps; st++) {
                for (var ai = 0; ai < AXES.length; ai++) {
                    var axis = AXES[ai];
                    var velocity = card.v[axis] + (kk * (target[axis] - card[axis]) - dd * card.v[axis]) * h;
                    card.v[axis] = velocity;
                    card[axis] += velocity * h;
                }
            }
        }

        function scalar(value, velocity, target, omega, zeta, dt) {
            var kk = omega * omega;
            var dd = 2 * zeta * omega;
            var steps = Math.max(1, Math.ceil(dt / STEP));
            var h = dt / steps;
            var x = value;
            var v = velocity;
            for (var st = 0; st < steps; st++) {
                v += (kk * (target - x) - dd * v) * h;
                x += v * h;
            }
            return [x, v];
        }

        function frame(time) {
            state.raf = 0;
            if (!state.alive) return;
            var dt = state.last ? Math.min(0.05, (time - state.last) / 1000) : 1 / 60;
            state.last = time;
            var speed = settings.speed;
            var restOmega = TAU * 1.7 * speed;
            var restZeta = reduce ? 1 : 1 - 0.72 * settings.bounce;
            var exitOmega = TAU * 1.9 * speed;
            var busy = false;

            var spreadTarget = state.hovered && !reduce ? settings.hoverSpread : 0;
            var r1 = scalar(state.spread, state.spreadV, spreadTarget, TAU * 1.4, 0.9, dt);
            state.spread = r1[0]; state.spreadV = r1[1];
            var r2 = scalar(state.px, state.pvx, reduce ? 0 : state.tx, TAU * 1.1, 1, dt);
            state.px = r2[0]; state.pvx = r2[1];
            var r3 = scalar(state.py, state.pvy, reduce ? 0 : state.ty, TAU * 1.1, 1, dt);
            state.py = r3[0]; state.pvy = r3[1];

            if (Math.abs(state.spread - spreadTarget) > 0.0005 ||
                Math.abs(state.spreadV) > 0.0005 ||
                Math.abs(state.px - state.tx) > 0.05 ||
                Math.abs(state.py - state.ty) > 0.05 ||
                Math.abs(state.pvx) + Math.abs(state.pvy) > 0.05) {
                busy = true;
            }
            writeStage();

            for (var i = 0; i < deck.length; i++) {
                var card = deck[i];
                if (card.phase === 'drag') { busy = true; write(card); continue; }
                var target = targetOf(card, time);
                var moving = card.phase === 'exit' || card.phase === 'enter';
                integrate(card, target, moving ? exitOmega : restOmega, moving ? 1 : restZeta, dt);

                if (card.phase === 'exit') {
                    var base = slotOf(0);
                    var travelled = (card.x - base.x) * card.dir.x + (card.y - base.y) * card.dir.y;
                    if (travelled >= clearance(card.dir)) {
                        card.phase = 'rest'; card.top = 0; card.hold = 0;
                    }
                } else if (card.phase === 'enter') {
                    var b2 = slotOf(0);
                    if (card.y - b2.y >= clearance(DOWN)) {
                        card.phase = 'rest'; card.under = false; card.hold = 0;
                    }
                }
                if (card.hold > time || card.phase !== 'rest') busy = true;
                for (var ai = 0; ai < AXES.length; ai++) {
                    var axis = AXES[ai];
                    var limit = axis === 'p' ? 0.001 : 0.02;
                    if (Math.abs(target[axis] - card[axis]) > limit || Math.abs(card.v[axis]) > limit) busy = true;
                }
                write(card);
            }

            if (busy) {
                state.raf = global.requestAnimationFrame(frame);
            } else {
                state.last = 0;
                for (var j = 0; j < deck.length; j++) {
                    if (deck[j].top && deck[j].phase === 'rest') deck[j].top = 0;
                }
            }
        }

        function wake() {
            if (!state.raf && state.alive) state.raf = global.requestAnimationFrame(frame);
        }

        function paused() {
            return !settings.autoplay || count < 2 ||
                (settings.pauseOnHover && state.overCard) ||
                state.drag || !state.inView ||
                document.visibilityState === 'hidden';
        }

        function schedule() {
            global.clearTimeout(state.timer);
            state.timer = 0;
            if (paused()) return;
            state.timer = global.setTimeout(function () {
                state.timer = 0;
                shift(1);
            }, Math.max(400, settings.delay));
        }

        function settleOrder(time, stagger) {
            state.order.forEach(function (index, position) {
                var card = deck[index];
                if (card.pos === position) return;
                card.from = card.pos;
                card.pos = position;
                card.hold = time + Math.max(0, position) * stagger;
            });
        }

        function shift(direction, options2) {
            if (count < 2) return;
            var o = options2 || {};
            var time = performance.now();
            var stagger = 0.05 / settings.speed;
            if (direction > 0) {
                var front = deck[state.order[0]];
                state.order = state.order.slice(1).concat([front.index]);
                settleOrder(time, stagger * 1000);
                front.phase = 'exit';
                front.dir = o.dir || settings.exitDirection;
                front.tilt = o.tilt || 0;
                front.top = ++state.layers;
                front.under = false;
                front.nudge = 0;
                front.hold = 0;
                if (o.velocity) { front.v.x = o.velocity.x; front.v.y = o.velocity.y; }
            } else {
                var back = deck[state.order[count - 1]];
                state.order = [back.index].concat(state.order.slice(0, count - 1));
                settleOrder(time, stagger * 1000);
                back.phase = 'enter';
                back.top = 0;
                back.under = true;
                back.nudge = 0;
                back.hold = 0;
            }
            deck.forEach(function (card) { if (card.phase === 'rest') card.nudge = 0; });
            if (settings.onChange) settings.onChange(state.order[0]);
            wake();
            schedule();
        }

        function goTo(position) {
            state.queue.forEach(global.clearTimeout);
            state.queue = [];
            var gap = 110 / settings.speed;
            for (var i = 0; i < position; i++) {
                state.queue.push(global.setTimeout(function () { shift(1); }, i * gap));
            }
        }

        function fit() {
            var w = root.clientWidth;
            var h = root.clientHeight;
            var scale = Math.min(1, w / bounds.width, h > 0 ? h / bounds.height : 1);
            state.scale = scale > 0 ? scale : 1;
            stage.style.transform = 'translate(-50%, -50%) scale(' + state.scale.toFixed(4) + ')';
        }

        function local(event) {
            var box = root.getBoundingClientRect();
            return { x: event.clientX - box.left, y: event.clientY - box.top, w: box.width, h: box.height };
        }

        function onMove(event) {
            if (event.pointerType !== 'touch') {
                var point = local(event);
                var nx = clamp((point.x / Math.max(1, point.w)) * 2 - 1, -1, 1);
                var ny = clamp((point.y / Math.max(1, point.h)) * 2 - 1, -1, 1);
                state.tx = nx * settings.parallax * 0.35 * bounds.width;
                state.ty = ny * settings.parallax * 0.35 * bounds.height;
                state.hovered = true;
                var overCard = Boolean(event.target.closest && event.target.closest('[data-swap-index]'));
                if (overCard !== state.overCard) {
                    state.overCard = overCard;
                    schedule();
                }
                wake();
            }
            var drag = state.drag;
            if (!drag || drag.id !== event.pointerId) return;
            var dx = (event.clientX - drag.startX) / state.scale;
            var dy = (event.clientY - drag.startY) / state.scale;
            if (!drag.active) {
                if (Math.hypot(dx, dy) < 5) return;
                drag.active = true;
                state.dragged = true;
                var c = deck[drag.index];
                c.phase = 'drag';
                c.v = { x: 0, y: 0, z: 0, r: 0, p: 0 };
                if (root.setPointerCapture) root.setPointerCapture(event.pointerId);
                root.style.cursor = 'grabbing';
            }
            var card = deck[drag.index];
            var base = slotOf(0);
            card.x = base.x + dx;
            card.y = base.y + dy;
            card.z = base.z;
            card.r = clamp(dx * 0.035, -9, 9);
            card.p = 0;
            var time = performance.now();
            drag.samples.push({ x: card.x, y: card.y, t: time });
            while (drag.samples.length > 2 && time - drag.samples[0].t > 90) drag.samples.shift();
            var progress = clamp(Math.hypot(dx, dy) / (Math.min(settings.width, settings.height) * 0.3), 0, 1);
            var next = deck[state.order[1]];
            if (next && next.phase === 'rest') next.nudge = -0.22 * progress;
            wake();
        }

        function onLeave(event) {
            if (event.pointerType === 'touch') return;
            if (state.drag && state.drag.active) return;
            state.hovered = false;
            state.overCard = false;
            state.tx = 0;
            state.ty = 0;
            schedule();
            wake();
        }

        function onDown(event) {
            state.dragged = false;
            if (!settings.draggable || event.button > 0 || count < 2) return;
            var target = event.target.closest && event.target.closest('[data-swap-index]');
            if (!target || !root.contains(target)) return;
            var index = Number(target.getAttribute('data-swap-index'));
            if (index !== state.order[0] || deck[index].phase !== 'rest') return;
            state.drag = {
                id: event.pointerId, index: index,
                startX: event.clientX, startY: event.clientY,
                active: false, samples: []
            };
            schedule();
        }

        function onUp(event) {
            var drag = state.drag;
            if (!drag || drag.id !== event.pointerId) return;
            state.drag = null;
            root.style.cursor = '';
            if (!drag.active) { schedule(); return; }
            if (root.releasePointerCapture) root.releasePointerCapture(event.pointerId);
            var card = deck[drag.index];
            var base = slotOf(0);
            var first = drag.samples[0];
            var lastSample = drag.samples[drag.samples.length - 1];
            var span = first && lastSample ? Math.max(0.016, (lastSample.t - first.t) / 1000) : 1;
            var velocity = first && lastSample && lastSample !== first
                ? { x: (lastSample.x - first.x) / span, y: (lastSample.y - first.y) / span }
                : { x: 0, y: 0 };
            var offset = { x: card.x - base.x, y: card.y - base.y };
            var distance = Math.hypot(offset.x, offset.y);
            var fling = Math.hypot(velocity.x, velocity.y);
            var next = deck[state.order[1]];
            if (next) next.nudge = 0;
            if (event.type !== 'pointercancel' &&
                (distance > Math.min(settings.width, settings.height) * 0.3 || fling > 700)) {
                var aim = { x: offset.x + velocity.x * 0.12, y: offset.y + velocity.y * 0.12 };
                var length = Math.hypot(aim.x, aim.y) || 1;
                card.phase = 'rest';
                shift(1, { dir: { x: aim.x / length, y: aim.y / length }, tilt: card.r, velocity: velocity });
            } else {
                card.phase = 'rest';
                card.v.x = velocity.x;
                card.v.y = velocity.y;
                wake();
                schedule();
            }
        }

        function onClick(event) {
            if (state.dragged) { state.dragged = false; return; }
            var target = event.target.closest && event.target.closest('[data-swap-index]');
            if (!target || !root.contains(target)) return;
            // 卡片内的「了解更多」是真实链接，直接跳转，不当作换位点击
            if (event.target.closest('.card-swap-cta')) return;
            var index = Number(target.getAttribute('data-swap-index'));
            if (settings.onCardClick) settings.onCardClick(index);
            var position = state.order.indexOf(index);
            if (position > 0) goTo(position);
        }

        function onKeyDown(event) {
            if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                event.preventDefault();
                shift(1);
            } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                event.preventDefault();
                shift(-1);
            }
        }

        function onVisibility() { schedule(); }

        // ---- 初始化 ----
        if (settings.intro && !reduce) {
            deck.forEach(function (card) {
                card.from = 0;
                card.hold = now + (card.pos * 70) / s0.speed;
            });
            if (stage.animate) stage.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: 'ease-out' });
        } else {
            deck.forEach(function (card) {
                var s = slotOf(card.pos);
                card.x = s.x; card.y = s.y; card.z = s.z; card.r = s.r; card.p = s.p;
            });
        }
        fit();
        writeStage();
        deck.forEach(function (card) { write(card); });
        wake();

        var resizeObserver = new ResizeObserver(function () { fit(); wake(); });
        resizeObserver.observe(root);
        var intersectionObserver = null;
        if (global.IntersectionObserver) {
            intersectionObserver = new IntersectionObserver(function (entries) {
                state.inView = entries[entries.length - 1] ? entries[entries.length - 1].isIntersecting : true;
                schedule();
            });
            intersectionObserver.observe(root);
        }
        var themeObserver = null;
        if (global.MutationObserver) {
            themeObserver = new MutationObserver(function () { applyTheme(); wake(); });
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }

        root.addEventListener('pointermove', onMove);
        root.addEventListener('pointerleave', onLeave);
        root.addEventListener('pointerdown', onDown);
        root.addEventListener('pointerup', onUp);
        root.addEventListener('pointercancel', onUp);
        root.addEventListener('click', onClick);
        root.addEventListener('keydown', onKeyDown);
        document.addEventListener('visibilitychange', onVisibility);
        schedule();

        return {
            next: function () { shift(1); },
            prev: function () { shift(-1); },
            destroy: function () {
                state.alive = false;
                global.cancelAnimationFrame(state.raf);
                global.clearTimeout(state.timer);
                state.queue.forEach(global.clearTimeout);
                resizeObserver.disconnect();
                if (intersectionObserver) intersectionObserver.disconnect();
                if (themeObserver) themeObserver.disconnect();
                root.removeEventListener('pointermove', onMove);
                root.removeEventListener('pointerleave', onLeave);
                root.removeEventListener('pointerdown', onDown);
                root.removeEventListener('pointerup', onUp);
                root.removeEventListener('pointercancel', onUp);
                root.removeEventListener('click', onClick);
                root.removeEventListener('keydown', onKeyDown);
                document.removeEventListener('visibilitychange', onVisibility);
            }
        };
    }

    CardSwap.autoInit = function () {
        var nodes = document.querySelectorAll('[data-card-swap]');
        Array.prototype.forEach.call(nodes, function (node) {
            if (node.__cardSwap) return;
            var d = node.dataset || {};
            var items = [];
            if (d.items) {
                try { items = JSON.parse(d.items); }
                catch (e) { if (global.console) console.warn('[CardSwap] data-items 不是合法 JSON', e); }
            }
            var num = function (key) { return d[key] === undefined ? undefined : Number(d[key]); };
            node.__cardSwap = new CardSwap(node, {
                items: items,
                theme: d.theme || 'auto',
                width: num('width'),
                height: num('height'),
                cardDistance: num('cardDistance'),
                verticalDistance: num('verticalDistance'),
                depth: num('depth'),
                skewAmount: num('skewAmount'),
                visibleCards: num('visibleCards'),
                delay: num('delay'),
                autoplay: d.autoplay !== 'false',
                pauseOnHover: d.pauseOnHover !== 'false',
                draggable: d.draggable !== 'false',
                speed: num('speed'),
                bounce: num('bounce'),
                parallax: num('parallax'),
                hoverSpread: num('hoverSpread'),
                exitDirection: d.exitDirection,
                dim: num('dim'),
                cardRadius: num('cardRadius'),
                intro: d.intro !== 'false',
                ariaLabel: d.ariaLabel
            });
        });
    };

    global.CardSwap = CardSwap;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', CardSwap.autoInit);
    } else {
        CardSwap.autoInit();
    }
})(window);