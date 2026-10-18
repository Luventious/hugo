/*
 * SpotlightCard —— React Bits 同名组件的原生 JS 移植版
 * 原组件：https://reactbits.dev/components/spotlight-card
 * 本站无 React/Node 构建链，故移植为原生 DOM + requestAnimationFrame，
 * 光照渐变生成、缓动曲线、邻近判定、环境光漂移、按压 flare 与原版逐项等价。
 *
 * 用法：
 *   <div class="spotlight-card" data-spotlight data-theme="auto">
 *     <span class="spotlight-card__light"></span>
 *     ...
 *   </div>
 *   或 new SpotlightCard(el, { intensity, spotlightSize, ... })
 */
(function (global) {
    'use strict';

    var THEMES = {
        dark: { surface: '#1a1a1a', border: 'rgba(255,255,255,0.08)', shadow: '0 24px 48px -24px rgba(0,0,0,0.6)', light: '#ffffff', fill: 1, edge: 1 },
        light: { surface: '#ffffff', border: 'rgba(24,24,27,0.1)', shadow: '0 1px 2px rgba(24,24,27,0.04), 0 18px 40px -20px rgba(24,24,27,0.16)', light: '#18181b', fill: 0.28, edge: 0.7 }
    };

    var NOISE = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

    function falloff(color, softness) {
        var soft = clamp(softness, 0, 1);
        var core = Math.pow(1 - soft, 1.5) * 0.85;
        function stop(alpha, at) {
            return 'color-mix(in srgb, ' + color + ' ' + (alpha * 100).toFixed(2) + '%, transparent) ' + (at * 100).toFixed(2) + '%';
        }
        var list = [stop(1, 0)];
        for (var i = 0; i <= 14; i++) {
            var t = core + ((1 - core) * i) / 14;
            var g = (t - core) / (1 - core);
            var smooth = 1 - g * g * (3 - 2 * g);
            var glow = Math.exp(-4.6 * g * g) * (1 - Math.pow(g, 6));
            list.push(stop(smooth + (glow - smooth) * soft, t));
        }
        return list.join(', ');
    }

    function SpotlightCard(root, options) {
        var opts = options || {};

        // 构建内部结构（若模板里没写，这里补齐）
        var light = root.querySelector('.spotlight-card__light');
        if (!light) {
            light = document.createElement('span');
            light.className = 'spotlight-card__light';
            light.setAttribute('aria-hidden', 'true');
            root.insertBefore(light, root.firstChild);
        }
        var noise = root.querySelector('.spotlight-card__grain');
        if (!noise) {
            noise = document.createElement('span');
            noise.className = 'spotlight-card__grain';
            noise.setAttribute('aria-hidden', 'true');
            light.parentNode.insertBefore(noise, light.nextSibling);
        }
        noise.style.backgroundImage = NOISE;
        var border = root.querySelector('.spotlight-card__border');
        if (!border) {
            border = document.createElement('span');
            border.className = 'spotlight-card__border';
            border.setAttribute('aria-hidden', 'true');
            root.appendChild(border);
        }
        var edge = root.querySelector('.spotlight-card__edge');
        if (!edge) {
            edge = document.createElement('span');
            edge.className = 'spotlight-card__edge';
            edge.setAttribute('aria-hidden', 'true');
            root.appendChild(edge);
        }

        root.classList.add('spotlight-card');

        var settings = {
            intensity: clamp(opts.intensity == null ? 0.15 : opts.intensity, 0, 1),
            spotlightSize: Math.max(20, opts.spotlightSize == null ? 240 : opts.spotlightSize),
            softness: clamp(opts.softness == null ? 0.7 : opts.softness, 0, 1),
            shape: opts.shape === 'beam' ? 'beam' : 'circle',
            borderGlow: clamp(opts.borderGlow == null ? 0.6 : opts.borderGlow, 0, 1),
            proximity: Math.max(0, opts.proximity == null ? 80 : opts.proximity),
            smoothing: clamp(opts.smoothing == null ? 0.3 : opts.smoothing, 0, 1),
            ambient: !!opts.ambient,
            flare: opts.flare !== false,
            grain: clamp(opts.grain == null ? 0 : opts.grain, 0, 1),
            theme: opts.theme === 'light' ? 'light' : opts.theme === 'auto' ? 'auto' : 'dark',
            spotlightColor: opts.spotlightColor || null
        };

        function resolvedTheme() {
            if (settings.theme === 'auto') {
                return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
            }
            return settings.theme;
        }

        function palette() { return THEMES[resolvedTheme()]; }
        function glowColor() { return settings.spotlightColor || palette().light; }

        function compile() {
            var p = palette();
            var color = glowColor();
            root.setAttribute('data-theme', resolvedTheme());
            root.style.setProperty('--spotlight-card-surface', p.surface);
            root.style.setProperty('--spotlight-card-border', p.border);
            root.style.setProperty('--spotlight-card-shadow', p.shadow);
            return {
                fill: falloff(color, settings.softness),
                edge: falloff(color, 1),
                intensity: settings.intensity * p.fill,
                borderGlow: settings.borderGlow * p.edge
            };
        }

        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var state = { x: 0, y: 0, presence: 0, flare: 0, time: Math.random() * 60, pressed: false, visible: true };
        var pointer = { x: 0, y: 0, active: false };
        var drawn = { light: '', edge: '', noise: '' };
        var focus = null;
        var raf = 0;
        var last = 0;
        var alive = true;

        function gradient(s, size, x, y, stops) {
            if (s.shape === 'beam') {
                var reach = Math.max(size * 0.6, y + size * 0.55);
                return 'radial-gradient(' + (size * 0.55).toFixed(1) + 'px ' + reach.toFixed(1) + 'px at ' + x.toFixed(1) + 'px 0px, ' + stops + ')';
            }
            return 'radial-gradient(circle ' + size.toFixed(1) + 'px at ' + x.toFixed(1) + 'px ' + y.toFixed(1) + 'px, ' + stops + ')';
        }

        function paint(s) {
            var size = s.size * (1 + 0.2 * state.flare);
            var boost = 1 + 0.7 * state.flare;
            var fill = gradient(s, size, state.x, state.y, s.fill);
            var rim = gradient(s, size * 0.6, state.x, s.shape === 'beam' ? 0 : state.y, s.edge);
            if (fill !== drawn.light) {
                drawn.light = fill;
                light.style.background = fill;
            }
            if (rim !== drawn.edge) {
                drawn.edge = rim;
                edge.style.background = rim;
            }
            light.style.opacity = String(Math.min(1, state.presence * s.intensity * boost));
            edge.style.opacity = String(Math.min(1, state.presence * s.borderGlow * boost));
            var grainy = s.grain > 0 ? gradient(s, size, state.x, state.y, '#000 0%, transparent 100%') : 'none';
            if (grainy !== drawn.noise) {
                drawn.noise = grainy;
                noise.style.webkitMaskImage = grainy;
                noise.style.maskImage = grainy;
            }
            noise.style.opacity = String(state.presence * s.grain);
        }

        function tick(now) {
            raf = 0;
            if (!alive) return;
            var compiled = compile();
            var s = {
                shape: settings.shape,
                fill: compiled.fill,
                edge: compiled.edge,
                size: settings.spotlightSize,
                intensity: compiled.intensity,
                borderGlow: compiled.borderGlow,
                proximity: settings.proximity,
                grain: settings.grain
            };
            var dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
            last = now;
            var rect = root.getBoundingClientRect();
            var tx = state.x;
            var ty = state.y;
            var target = 0;
            if (focus && root.contains(focus)) {
                var box = focus.getBoundingClientRect();
                tx = box.left + box.width / 2 - rect.left;
                ty = box.top + box.height / 2 - rect.top;
                target = 1;
            } else if (pointer.active) {
                tx = pointer.x - rect.left;
                ty = pointer.y - rect.top;
                var gap = Math.hypot(Math.max(0, -tx, tx - rect.width), Math.max(0, -ty, ty - rect.height));
                if (gap === 0) target = 1;
                else if (s.proximity > 0) target = Math.pow(Math.max(0, 1 - gap / s.proximity), 2);
            }
            if (target < 0.6 && settings.ambient && state.visible) {
                if (!reduce) state.time += dt;
                var drift = 0.6 - target;
                tx += (rect.width * (0.5 + 0.34 * Math.sin(state.time * 0.43)) - tx) * (drift / 0.6);
                ty += (rect.height * (0.5 + 0.3 * Math.sin(state.time * 0.61 + 1.3)) - ty) * (drift / 0.6);
                target = 0.6;
            }
            if (state.presence < 0.02 && target > 0 && !settings.ambient) {
                state.x = tx;
                state.y = ty;
            }
            var follow = reduce || settings.smoothing === 0 ? 1 : 1 - Math.exp(-dt / (0.015 + settings.smoothing * 0.22));
            state.x += (tx - state.x) * follow;
            state.y += (ty - state.y) * follow;
            var fade = reduce ? 1 : 1 - Math.exp(-dt / (target > state.presence ? 0.1 : 0.32));
            state.presence += (target - state.presence) * fade;
            if (Math.abs(target - state.presence) < 0.002) state.presence = target;
            var press = state.pressed && settings.flare && !reduce ? 1 : 0;
            state.flare += (press - state.flare) * (1 - Math.exp(-dt / (press ? 0.05 : 0.28)));
            if (Math.abs(press - state.flare) < 0.002) state.flare = press;
            paint(s);
            var moving = Math.abs(tx - state.x) > 0.1 || Math.abs(ty - state.y) > 0.1;
            var settled = !moving && state.presence === target && state.flare === press;
            if (!settled || (settings.ambient && state.visible && !reduce)) raf = window.requestAnimationFrame(tick);
        }

        function wake() {
            if (raf || !alive) return;
            last = performance.now();
            raf = window.requestAnimationFrame(tick);
        }

        function onMove(event) {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            pointer.active = true;
            if (state.presence > 0 || settings.proximity > 0 || root.contains(event.target)) wake();
        }
        function onOut(event) {
            if (event.relatedTarget) return;
            pointer.active = false;
            wake();
        }
        function onDown(event) {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            pointer.active = true;
            state.pressed = true;
            wake();
        }
        function onUp(event) {
            if (event.pointerType !== 'mouse') pointer.active = false;
            if (!state.pressed && event.pointerType === 'mouse') return;
            state.pressed = false;
            wake();
        }
        function onFocusIn(event) {
            if (!(event.target instanceof Element) || !event.target.matches(':focus-visible')) return;
            focus = event.target;
            wake();
        }
        function onFocusOut(event) {
            if (root.contains(event.relatedTarget)) return;
            focus = null;
            wake();
        }
        function onScroll() {
            if (pointer.active || state.presence > 0) wake();
        }

        var observer = null;
        if (window.IntersectionObserver) {
            observer = new IntersectionObserver(function (entries) {
                state.visible = entries.some(function (e) { return e.isIntersecting; });
                if (state.visible) wake();
            });
            observer.observe(root);
        }
        var themeObserver = null;
        if (window.MutationObserver) {
            themeObserver = new MutationObserver(function () { wake(); });
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
        window.addEventListener('scroll', onScroll, { capture: true, passive: true });
        document.addEventListener('pointerout', onOut);
        root.addEventListener('pointerdown', onDown);
        root.addEventListener('focusin', onFocusIn);
        root.addEventListener('focusout', onFocusOut);
        wake();

        return {
            wake: wake,
            destroy: function () {
                alive = false;
                window.cancelAnimationFrame(raf);
                if (observer) observer.disconnect();
                if (themeObserver) themeObserver.disconnect();
                window.removeEventListener('pointermove', onMove);
                window.removeEventListener('pointerup', onUp);
                window.removeEventListener('pointercancel', onUp);
                window.removeEventListener('scroll', onScroll, { capture: true });
                document.removeEventListener('pointerout', onOut);
                root.removeEventListener('pointerdown', onDown);
                root.removeEventListener('focusin', onFocusIn);
                root.removeEventListener('focusout', onFocusOut);
            }
        };
    }

    SpotlightCard.autoInit = function () {
        var nodes = document.querySelectorAll('[data-spotlight]');
        Array.prototype.forEach.call(nodes, function (node) {
            if (node.__spotlightCard) return;
            var d = node.dataset || {};
            node.__spotlightCard = new SpotlightCard(node, {
                intensity: d.intensity ? Number(d.intensity) : undefined,
                spotlightSize: d.spotlightSize ? Number(d.spotlightSize) : undefined,
                softness: d.softness ? Number(d.softness) : undefined,
                shape: d.shape || 'circle',
                borderGlow: d.borderGlow ? Number(d.borderGlow) : undefined,
                proximity: d.proximity ? Number(d.proximity) : undefined,
                smoothing: d.smoothing ? Number(d.smoothing) : undefined,
                ambient: d.ambient === 'true',
                flare: d.flare !== 'false',
                grain: d.grain ? Number(d.grain) : 0,
                theme: d.theme || 'auto',
                spotlightColor: d.spotlightColor || null
            });
        });
    };

    global.SpotlightCard = SpotlightCard;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', SpotlightCard.autoInit);
    } else {
        SpotlightCard.autoInit();
    }
})(window);
