/*
 * FolderFloat —— React Bits 同名组件的原生 JS 移植版
 * 原组件：https://reactbits.dev/components/folder-float
 *
 * 说明：
 *   · 物理部分依赖 matter-js，这里改为「首次打开文件夹时才按需加载」，
 *     首页首屏不为它付出 81KB（gzip 约 24KB）的代价；
 *     加载失败时退化为纯 CSS 弹入动画，不会白屏或报错。
 *   · 布局排布（layout）、抖动（jitter）、拖拽抛掷、漂移力、
 *     开合时序等逻辑与原版逐项等价。
 *
 * 用法：
 *   <div data-folder-float
 *        data-items='[{"label":"我做过的项目","link":"/zh/projects/"}]'
 *        data-label="继续逛逛"></div>
 */
(function (global) {
    'use strict';

    // matter-js 自托管（static/js/vendor/），不走 CDN：
    // jsdelivr 等公共 CDN 在国内常被重置（实测 ERR_CONNECTION_RESET），
    // 自托管既保证可达，也省掉一次 DNS/TLS 往返。
    // 页面可用 data-matter-url 覆盖路径（模板里用 relURL 生成，兼容子路径部署）。
    var MATTER_URL = '/js/vendor/matter.min.js';
    var PAD = 28;
    var CHAR = 6.8;
    var GAP = 12;
    var ROW = 52;
    var DRAG_MIN = 4;
    var ZONE_PAD = 8;

    var PALETTES = {
        dark: {
            folder: '#3f3f46', front: '#52525b', paper: '#f5f5f5',
            item: '#f5f5f5', itemText: '#18181b', label: '#f5f5f5'
        },
        light: {
            folder: '#e4e4e7', front: '#f4f4f5', paper: '#ffffff',
            item: '#18181b', itemText: '#fafafa', label: '#3f3f46'
        }
    };

    var matterPromise = null;
    function loadMatter(url) {
        if (global.Matter) return Promise.resolve(global.Matter);
        if (matterPromise) return matterPromise;
        matterPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = url || MATTER_URL;
            s.async = true;
            s.onload = function () {
                if (global.Matter) resolve(global.Matter);
                else reject(new Error('[FolderFloat] matter-js 未挂载到全局'));
            };
            s.onerror = function () { reject(new Error('[FolderFloat] matter-js 加载失败')); };
            document.head.appendChild(s);
        });
        return matterPromise;
    }

    function jitter(i) {
        var x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453;
        return x - Math.floor(x);
    }

    // 行内打包：按测量宽度把选项铺成若干行，奇数行整体偏移一点
    function layout(list, spread, lift, tilt, sizes) {
        var rows = [];
        var row = [];
        var width = 0;
        list.forEach(function (item, i) {
            var pw = (sizes[i] && sizes[i].w) || (PAD + item.label.length * CHAR);
            if (row.length && width + GAP + pw > spread * 2) {
                rows.push({ items: row, width: width });
                row = [];
                width = 0;
            }
            row.push({ i: i, pw: pw });
            width += (row.length > 1 ? GAP : 0) + pw;
        });
        if (row.length) rows.push({ items: row, width: width });

        var pos = [];
        rows.forEach(function (r, ri) {
            var x = -r.width / 2;
            var shift = (ri % 2 ? 1 : -1) * Math.min(16, spread * 0.1);
            r.items.forEach(function (entry) {
                var j = jitter(entry.i);
                pos[entry.i] = {
                    x: x + entry.pw / 2 + shift + (j - 0.5) * 6,
                    y: -lift - ri * ROW - j * 6,
                    r: tilt * (j * 2 - 1)
                };
                x += entry.pw + GAP;
            });
        });
        return pos;
    }

    function FolderFloat(root, options) {
        var opts = options || {};

        var items = (opts.items || []).map(function (item) {
            return typeof item === 'string' ? { label: item, value: item, link: null } : {
                label: item.label,
                value: item.value === undefined ? item.label : item.value,
                link: item.link || (typeof item.value === 'string' && /^[#/]|^https?:/.test(item.value) ? item.value : null)
            };
        });
        var n = items.length;
        if (!n) return { destroy: function () {} };

        var label = opts.label == null ? 'Design feedback' : opts.label;
        var sublabel = opts.sublabel || (n + (n === 1 ? ' note' : ' notes'));
        var closeOnSelect = opts.closeOnSelect !== false;
        var physics = opts.physics !== false;
        var drift = opts.drift == null ? 0.5 : opts.drift;
        var spread = opts.spread == null ? 180 : opts.spread;
        var lift = opts.lift == null ? 26 : opts.lift;
        var tilt = opts.tilt == null ? 8 : opts.tilt;
        var openDuration = opts.openDuration == null ? 520 : opts.openDuration;
        var stagger = opts.stagger == null ? 45 : opts.stagger;
        var bounce = opts.bounce == null ? 0.3 : opts.bounce;
        var theme = opts.theme === 'light' ? 'light' : opts.theme === 'dark' ? 'dark' : 'auto';

        function resolvedTheme() {
            if (theme === 'light') return 'light';
            if (theme === 'dark') return 'dark';
            return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
        }

        var palette = PALETTES[resolvedTheme()];
        var colors = {
            folder: opts.folderColor || palette.folder,
            front: opts.frontColor || palette.front,
            paper: opts.paperColor || palette.paper,
            item: opts.itemColor || palette.item,
            itemText: opts.itemTextColor || palette.itemText,
            label: opts.labelColor || palette.label
        };

        // trigger: auto → 精细指针用 hover，触摸设备用 click
        var trigger = opts.trigger;
        if (!trigger || trigger === 'auto') {
            trigger = (global.matchMedia && global.matchMedia('(hover: hover) and (pointer: fine)').matches) ? 'hover' : 'click';
        }

        var reduce = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

        root.classList.add('folder-float');
        root.setAttribute('data-trigger', trigger);
        if (physics) root.setAttribute('data-physics', '');
        root.style.setProperty('--ff-w', (opts.width == null ? 200 : opts.width) + 'px');
        root.style.setProperty('--ff-h', (opts.height == null ? 148 : opts.height) + 'px');
        root.style.setProperty('--ff-r', (opts.radius == null ? 14 : opts.radius) + 'px');
        root.style.setProperty('--ff-back', colors.folder);
        root.style.setProperty('--ff-front', colors.front);
        root.style.setProperty('--ff-paper', colors.paper);
        root.style.setProperty('--ff-item', colors.item);
        root.style.setProperty('--ff-item-ink', colors.itemText);
        root.style.setProperty('--ff-label', colors.label);
        root.style.setProperty('--ff-spread', spread + 'px');
        root.style.setProperty('--ff-lift', lift + 'px');
        root.style.setProperty('--ff-angle', (opts.flapAngle == null ? 34 : opts.flapAngle) + 'deg');
        root.style.setProperty('--ff-rest', (opts.restAngle == null ? 16 : opts.restAngle) + 'deg');
        root.style.setProperty('--ff-open', openDuration + 'ms');
        root.style.setProperty('--ff-close', Math.round(openDuration * 0.6) + 'ms');
        root.style.setProperty('--ff-stagger', stagger + 'ms');
        root.style.setProperty('--ff-n', String(n));
        root.style.setProperty('--ff-spring', 'cubic-bezier(0.34, ' + (1 + bounce * 1.9).toFixed(2) + ', 0.64, 1)');

        // ---- DOM ----
        var itemsEl = document.createElement('div');
        itemsEl.className = 'folder-float__items';
        var pillEls = [];
        items.forEach(function (item, i) {
            var a = document.createElement('a');
            a.className = 'folder-float__item';
            a.href = item.link || '#';
            a.setAttribute('tabindex', '-1');
            a.setAttribute('aria-hidden', 'true');
            a.style.setProperty('--i', String(i));
            var driftEl = document.createElement('span');
            driftEl.className = 'folder-float__drift';
            driftEl.textContent = item.label;
            a.appendChild(driftEl);
            itemsEl.appendChild(a);
            pillEls.push(a);
        });

        var folder = document.createElement('div');
        folder.className = 'folder-float__folder';
        folder.innerHTML =
            '<span class="folder-float__back" aria-hidden="true"></span>' +
            '<span class="folder-float__paper" aria-hidden="true"></span>' +
            '<span class="folder-float__front" aria-hidden="true">' +
            '<span class="folder-float__label"></span>' +
            '<span class="folder-float__sub"></span>' +
            '</span>';
        folder.querySelector('.folder-float__label').textContent = label;
        folder.querySelector('.folder-float__sub').textContent = sublabel;

        var triggerBtn = document.createElement('button');
        triggerBtn.type = 'button';
        triggerBtn.className = 'folder-float__trigger';
        triggerBtn.setAttribute('aria-expanded', 'false');
        triggerBtn.setAttribute('aria-label', label + ', ' + sublabel);
        folder.appendChild(triggerBtn);

        root.appendChild(itemsEl);
        root.appendChild(folder);

        var anchor = itemsEl;
        var sizes = [];
        var pos = layout(items, spread, lift, tilt, sizes);
        var poppedTimer = null;
        var liveTimer = null;
        var open = !!opts.defaultOpen;
        var live = false;

        var world = {
            engine: null, bodies: [], sizes: [], raf: 0, last: 0, t0: 0,
            drag: null, zone: null, live: false, M: null, destroyed: false
        };

        function applyPositions() {
            pos = layout(items, spread, lift, tilt, sizes);
            for (var i = 0; i < n; i++) {
                if (!pos[i]) continue;
                pillEls[i].style.setProperty('--x', pos[i].x.toFixed(1) + 'px');
                pillEls[i].style.setProperty('--y', pos[i].y.toFixed(1) + 'px');
                pillEls[i].style.setProperty('--r', pos[i].r.toFixed(2) + 'deg');
            }
        }

        function measure() {
            var next = [];
            var allReady = true;
            for (var i = 0; i < n; i++) {
                var el = pillEls[i];
                if (!el) { allReady = false; break; }
                next.push({ w: el.offsetWidth, h: el.offsetHeight });
            }
            if (!allReady) return;
            var changed = next.length !== sizes.length;
            if (!changed) {
                for (var k = 0; k < next.length; k++) {
                    if (!sizes[k] || sizes[k].w !== next[k].w || sizes[k].h !== next[k].h) { changed = true; break; }
                }
            }
            if (changed) {
                sizes = next;
                applyPositions();
            }
        }

        applyPositions();
        measure();
        if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);

        // ---- 开合 ----
        function setOpen(next, opts2) {
            if (next === open && !(opts2 && opts2.force)) return;
            open = next;
            if (!open) stopPhysics();
            if (open) root.setAttribute('data-open', '');
            else root.removeAttribute('data-open');
            triggerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
            for (var i = 0; i < n; i++) {
                pillEls[i].setAttribute('tabindex', open ? '0' : '-1');
                if (open) pillEls[i].removeAttribute('aria-hidden');
                else pillEls[i].setAttribute('aria-hidden', 'true');
            }
            if (opts.onOpenChange) opts.onOpenChange(open);
            schedulePhysics();
        }

        // ---- 物理 ----
        function stopPhysics() {
            var w = world;
            global.clearTimeout(liveTimer);
            global.cancelAnimationFrame(w.raf);
            w.raf = 0;
            if (w.engine && w.M) {
                for (var i = 0; i < w.bodies.length; i++) {
                    var el = pillEls[i];
                    var b = w.bodies[i];
                    if (!el || !b) continue;
                    el.style.setProperty('--x', b.position.x.toFixed(1) + 'px');
                    el.style.setProperty('--y', (b.position.y - w.sizes[i].h / 2).toFixed(1) + 'px');
                }
                w.M.Composite.clear(w.engine.world, false, true);
                w.M.Engine.clear(w.engine);
                w.engine = null;
            }
            w.bodies = [];
            w.drag = null;
            w.live = false;
            live = false;
            root.removeAttribute('data-live');
        }

        function schedulePhysics() {
            global.clearTimeout(liveTimer);
            if (!open || !physics || reduce) return;
            liveTimer = global.setTimeout(startPhysics, openDuration + (n - 1) * stagger + 80);
        }

        function startPhysics() {
            if (!open || world.engine || world.destroyed) return;
            loadMatter(opts.matterUrl).then(function (M) {
                if (!open || world.engine || world.destroyed) return;
                world.M = M;
                var Bodies = M.Bodies, Composite = M.Composite, Engine = M.Engine;
                var engine = Engine.create({ gravity: { x: 0, y: 0 } });
                engine.enableSleeping = false;
                world.engine = engine;
                world.sizes = pillEls.map(function (el) { return { w: el.offsetWidth, h: el.offsetHeight }; });

                var ys = pos.map(function (p) { return p.y; });
                var zone = {
                    left: -spread - ZONE_PAD,
                    right: spread + ZONE_PAD,
                    top: Math.min.apply(null, ys) - ZONE_PAD,
                    bottom: -lift + Math.max.apply(null, world.sizes.map(function (s) { return s.h; }))
                };
                world.zone = zone;

                world.bodies = pillEls.map(function (el, i) {
                    var bw = world.sizes[i].w;
                    var bh = world.sizes[i].h;
                    var b = Bodies.rectangle(pos[i].x, pos[i].y + bh / 2, bw, bh, {
                        chamfer: { radius: Math.min(bh / 2 - 1, 16) },
                        restitution: 0.55,
                        friction: 0,
                        frictionAir: 0.08,
                        inertia: Infinity
                    });
                    b.plugin = { phase: jitter(i) * Math.PI * 2 };
                    return b;
                });

                var T = 80;
                var midX = (zone.left + zone.right) / 2;
                var midY = (zone.top + zone.bottom) / 2;
                var walls = [
                    Bodies.rectangle(midX, zone.top - T / 2, zone.right - zone.left + 2 * T, T, { isStatic: true }),
                    Bodies.rectangle(midX, zone.bottom + T / 2, zone.right - zone.left + 2 * T, T, { isStatic: true }),
                    Bodies.rectangle(zone.left - T / 2, midY, T, zone.bottom - zone.top + 2 * T, { isStatic: true }),
                    Bodies.rectangle(zone.right + T / 2, midY, T, zone.bottom - zone.top + 2 * T, { isStatic: true })
                ];
                Composite.add(engine.world, world.bodies.concat(walls));

                world.live = true;
                live = true;
                root.setAttribute('data-live', '');
                world.last = 0;
                world.t0 = performance.now();

                function tick(now) {
                    var w = world;
                    if (!w.engine || w.destroyed) return;
                    var dt = w.last ? Math.min(32, now - w.last) : 16;
                    w.last = now;
                    var t = (now - w.t0) / 1000;
                    var k = drift * 0.00005 * Math.min(1, t / 2);
                    for (var i = 0; i < w.bodies.length; i++) {
                        if (w.drag && w.drag.i === i) continue;
                        var b = w.bodies[i];
                        var ph = b.plugin.phase;
                        M.Body.applyForce(b, b.position, {
                            x: Math.sin(t * 0.9 + ph) * k * b.mass,
                            y: Math.cos(t * 1.3 + ph * 1.7) * k * b.mass
                        });
                    }
                    M.Engine.update(w.engine, dt);
                    for (var j = 0; j < w.bodies.length; j++) {
                        var el = pillEls[j];
                        if (!el) continue;
                        var body = w.bodies[j];
                        el.style.setProperty('--x', body.position.x.toFixed(1) + 'px');
                        el.style.setProperty('--y', (body.position.y - w.sizes[j].h / 2).toFixed(1) + 'px');
                    }
                    w.raf = global.requestAnimationFrame(tick);
                }
                world.raf = global.requestAnimationFrame(tick);
            }).catch(function (err) {
                // 物理不可用时保留 CSS 弹入效果，不影响导航
                if (global.console) console.warn(err.message);
                root.removeAttribute('data-live');
            });
        }

        // ---- 选中 ----
        function pick(item, i) {
            global.clearTimeout(poppedTimer);
            pillEls[i].setAttribute('data-pop', '');
            poppedTimer = global.setTimeout(function () { pillEls[i].removeAttribute('data-pop'); }, 320);
            if (opts.onSelect) opts.onSelect(item.value, i, item);
            else if (item.link) global.location.href = item.link;
            if (closeOnSelect) setOpen(false);
        }

        // ---- 指针：拖拽 / 抛掷 ----
        function pointerAt(event) {
            var r = anchor.getBoundingClientRect();
            return { x: event.clientX - r.left, y: event.clientY - r.top };
        }

        function onDown(event, i) {
            var w = world;
            if (!w.live || event.button !== 0 || !w.M) return;
            var b = w.bodies[i];
            if (!b) return;
            var p = pointerAt(event);
            w.drag = {
                i: i, id: event.pointerId,
                dx: b.position.x - p.x, dy: b.position.y - p.y,
                sx: event.clientX, sy: event.clientY, moved: false
            };
            try { event.currentTarget.setPointerCapture(event.pointerId); } catch (e) {}
        }

        function onMove(event, i) {
            var w = world;
            var d = w.drag;
            if (!d || d.i !== i || d.id !== event.pointerId || !w.M) return;
            if (!d.moved && Math.hypot(event.clientX - d.sx, event.clientY - d.sy) >= DRAG_MIN) {
                d.moved = true;
                event.currentTarget.setAttribute('data-drag', '');
            }
            if (!d.moved) return;
            var b = w.bodies[i];
            var bw = w.sizes[i].w;
            var bh = w.sizes[i].h;
            var z = w.zone;
            var p = pointerAt(event);
            var x = Math.min(z.right - bw / 2, Math.max(z.left + bw / 2, p.x + d.dx));
            var y = Math.min(z.bottom - bh / 2, Math.max(z.top + bh / 2, p.y + d.dy));
            w.M.Body.setVelocity(b, { x: (x - b.position.x) * 0.6, y: (y - b.position.y) * 0.6 });
            w.M.Body.setPosition(b, { x: x, y: y });
        }

        function onUp(event, i, item) {
            var w = world;
            var d = w.drag;
            if (!d || d.i !== i || d.id !== event.pointerId) return;
            w.drag = null;
            event.currentTarget.removeAttribute('data-drag');
            try { event.currentTarget.releasePointerCapture(event.pointerId); } catch (e) {}
            if (!d.moved && event.type === 'pointerup') {
                event.preventDefault();
                pick(item, i);
            }
        }

        pillEls.forEach(function (el, i) {
            var item = items[i];
            el.addEventListener('pointerdown', function (e) { onDown(e, i); });
            el.addEventListener('pointermove', function (e) { onMove(e, i); });
            el.addEventListener('pointerup', function (e) { onUp(e, i, item); });
            el.addEventListener('pointercancel', function (e) { onUp(e, i, item); });
            // 物理开启时，点击已由 pointerup 处理，避免重复跳转；键盘（detail===0）仍走默认
            el.addEventListener('click', function (e) {
                if (world.live && e.detail !== 0) e.preventDefault();
            });
        });

        // ---- 触发器 ----
        triggerBtn.addEventListener('click', function () { setOpen(!open); });
        root.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && open) {
                e.stopPropagation();
                setOpen(false);
            }
        });
        if (trigger === 'hover') {
            root.addEventListener('pointerenter', function () { setOpen(true); });
            root.addEventListener('pointerleave', function () {
                if (!world.drag) setOpen(false);
            });
        }

        // 主题切换时同步配色
        var themeObserver = null;
        if (global.MutationObserver) {
            themeObserver = new MutationObserver(function () {
                if (theme !== 'auto') return;
                var p = PALETTES[resolvedTheme()];
                root.style.setProperty('--ff-back', opts.folderColor || p.folder);
                root.style.setProperty('--ff-front', opts.frontColor || p.front);
                root.style.setProperty('--ff-paper', opts.paperColor || p.paper);
                root.style.setProperty('--ff-item', opts.itemColor || p.item);
                root.style.setProperty('--ff-item-ink', opts.itemTextColor || p.itemText);
                root.style.setProperty('--ff-label', opts.labelColor || p.label);
            });
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }

        if (open) setOpen(true, { force: true });

        return {
            setOpen: setOpen,
            get open() { return open; },
            destroy: function () {
                world.destroyed = true;
                global.clearTimeout(poppedTimer);
                stopPhysics();
                if (themeObserver) themeObserver.disconnect();
            }
        };
    }

    FolderFloat.autoInit = function () {
        var nodes = document.querySelectorAll('[data-folder-float]');
        Array.prototype.forEach.call(nodes, function (node) {
            if (node.__folderFloat) return;
            var d = node.dataset || {};
            var items = [];
            if (d.items) {
                try {
                    var parsed = JSON.parse(d.items);
                    // 字符串数组与 {label, link} 对象数组都支持
                    items = parsed.map(function (it) {
                        if (typeof it === 'string') return { label: it, value: it, link: it };
                        return it;
                    });
                } catch (err) {
                    if (global.console) console.warn('[FolderFloat] data-items 不是合法 JSON', err);
                }
            }
            var num = function (key) { return d[key] === undefined ? undefined : Number(d[key]); };
            node.__folderFloat = new FolderFloat(node, {
                items: items,
                label: d.label,
                sublabel: d.sublabel,
                trigger: d.trigger || 'auto',
                closeOnSelect: d.closeOnSelect !== 'false',
                physics: d.physics !== 'false',
                drift: num('drift'),
                theme: d.theme || 'auto',
                matterUrl: d.matterUrl || null,
                folderColor: d.folderColor || null,
                frontColor: d.frontColor || null,
                paperColor: d.paperColor || null,
                itemColor: d.itemColor || null,
                itemTextColor: d.itemTextColor || null,
                labelColor: d.labelColor || null,
                width: num('width'),
                height: num('height'),
                radius: num('radius'),
                spread: num('spread'),
                lift: num('lift'),
                tilt: num('tilt'),
                flapAngle: num('flapAngle'),
                restAngle: num('restAngle'),
                openDuration: num('openDuration'),
                stagger: num('stagger'),
                bounce: num('bounce')
            });
        });
    };

    global.FolderFloat = FolderFloat;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', FolderFloat.autoInit);
    } else {
        FolderFloat.autoInit();
    }
})(window);