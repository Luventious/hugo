/*
 * ScrambledText —— React Bits 同名组件的原生 JS 实现
 * 原组件：https://reactbits.dev/text-animations/scrambled-text
 * 灵感来源：Tom Miller（GSAP 社区）
 *
 * 与 React 版的差异：原版依赖 gsap + SplitText + ScrambleTextPlugin。
 * 本站没有构建链，也不愿为一段文字动效引入约 70KB 的 gsap，
 * 因此用 requestAnimationFrame 复刻同样的行为；参数语义保持一致。
 *
 * 【关键机制：隐形占位】
 *   原版对每个字符做 char.replaceChildren(sizer, glyph)：
 *     · sizer  —— 保留原始字符，visibility:hidden，撑住字宽
 *     · glyph  —— 绝对定位覆盖层，实际显示被打散的字符
 *   如果直接替换字符内容，`.:·-` 这类窄字符会让字宽骤变、整段文字反复重排，
 *   视觉上就是文字抖动 / 跳动。这里的实现严格照搬这个结构。
 *
 * 【触发范围】
 *   监听挂载在元素本身（不是 window），所以光标必须进入文字块才会触发，
 *   与 React 版一致。再叠加「到字符中心的距离 < radius」做衰减。
 */
(function (global) {
    'use strict';

    var DEFAULT_CHARS = '.:';

    function ScrambledText(el, options) {
        var opts = options || {};
        var radius = Math.max(1, opts.radius == null ? 100 : opts.radius);
        var duration = Math.max(0.05, opts.duration == null ? 1.2 : opts.duration);
        var speed = Math.max(0.02, opts.speed == null ? 0.5 : opts.speed);
        var glyphsSrc = String(opts.scrambleChars || DEFAULT_CHARS).split('').filter(function (c) {
            return c.trim().length > 0;
        });
        if (!glyphsSrc.length) glyphsSrc = ['.', ':'];
        var intro = opts.intro !== false;
        var stagger = Math.max(0, opts.stagger == null ? 0.02 : opts.stagger);

        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        /* ---------- 拆分：保留 <br>，每个字符包一层 sizer + glyph ---------- */
        var chars = [];
        var source = Array.prototype.slice.call(el.childNodes);
        el.textContent = '';
        el.classList.add('scrambled-text');

        source.forEach(function (node) {
            if (node.nodeType === 3) {
                var text = node.nodeValue || '';
                for (var i = 0; i < text.length; i++) {
                    var ch = text[i];
                    if (ch === '\n' || ch === '\r' || ch === '\t') continue;

                    var wrap = document.createElement('span');
                    wrap.className = 'scrambled-text__char';

                    var sizer = document.createElement('span');
                    sizer.className = 'scrambled-text__sizer';
                    sizer.textContent = ch;

                    var glyph = document.createElement('span');
                    glyph.className = 'scrambled-text__glyph';
                    glyph.setAttribute('aria-hidden', 'true');
                    glyph.textContent = ch;

                    wrap.appendChild(sizer);
                    wrap.appendChild(glyph);
                    el.appendChild(wrap);

                    chars.push({
                        wrap: wrap,
                        glyph: glyph,
                        real: ch,
                        space: /\s/.test(ch),
                        left: 0,        // 距离本次打散结束还剩多少秒
                        nextChange: 0,  // 下次换字倒计时
                        scrambling: false
                    });
                }
            } else if (node.nodeType === 1) {
                if (node.tagName === 'BR') {
                    el.appendChild(document.createElement('br'));
                } else {
                    el.appendChild(node.cloneNode(true));
                }
            }
        });

        var raf = 0;
        var last = 0;
        var alive = true;
        var pointer = { x: 0, y: 0, inside: false };
        var centers = [];   // 每个字符中心的视口坐标
        var measured = false;

        function measure() {
            var er = el.getBoundingClientRect();
            for (var k = 0; k < chars.length; k++) {
                var r = chars[k].wrap.getBoundingClientRect();
                centers[k] = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
            }
            measured = true;
            return er;
        }

        function randGlyph(item) {
            var g = glyphsSrc[(Math.random() * glyphsSrc.length) | 0];
            if (g === item.real && glyphsSrc.length > 1) {
                g = glyphsSrc[(glyphsSrc.indexOf(g) + 1) % glyphsSrc.length];
            }
            return g;
        }

        function restore(item) {
            item.scrambling = false;
            item.left = 0;
            if (item.glyph.textContent !== item.real) item.glyph.textContent = item.real;
        }

        function frame(now) {
            raf = 0;
            if (!alive) return;
            var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
            last = now;
            var busy = false;
            var interval = 0.05 / speed;

            for (var k = 0; k < chars.length; k++) {
                var it = chars[k];
                if (!it.scrambling) continue;
                busy = true;
                it.nextChange -= dt;
                if (it.nextChange <= 0 && !it.space) {
                    it.glyph.textContent = randGlyph(it);
                    it.nextChange = interval;
                }
                it.left -= dt;
                if (it.left <= 0) restore(it);
            }

            if (busy) raf = global.requestAnimationFrame(frame);
            else last = 0;
        }

        function wake() {
            if (!raf && alive) raf = global.requestAnimationFrame(frame);
        }

        // 光标附近开始打散：越近持续越久（与原版 duration * (1 - dist/radius) 一致）
        function scrambleAt(px, py) {
            if (!measured) measure();
            for (var k = 0; k < chars.length; k++) {
                var it = chars[k];
                if (it.space) continue;
                var c = centers[k];
                var dist = Math.hypot(px - c.x, py - c.y);
                if (dist >= radius) continue;
                // 重入时取较大值，避免已有动画被截短
                var len = duration * (1 - dist / radius);
                if (len <= 0.02) continue;
                if (len > it.left) it.left = len;
                if (!it.scrambling) {
                    it.scrambling = true;
                    it.nextChange = 0;
                }
            }
            last = 0;
            wake();
        }

        function onPointerMove(event) {
            pointer.x = event.clientX;
            pointer.y = event.clientY;
            pointer.inside = true;
            scrambleAt(pointer.x, pointer.y);
        }
        function onPointerLeave() {
            pointer.inside = false;
        }
        function onResize() { measured = false; }
        function onScroll() { measured = false; }

        measure();
        el.addEventListener('pointermove', onPointerMove, { passive: true });
        el.addEventListener('pointerleave', onPointerLeave);
        window.addEventListener('resize', onResize);
        window.addEventListener('scroll', onScroll, { passive: true });

        /* ---------- 入场：整段从乱码解码 ---------- */
        function introRun() {
            var total = Math.min(chars.length, 160);
            for (var k = 0; k < chars.length; k++) {
                var it = chars[k];
                if (it.space) continue;
                // 左侧先解出，右侧滞后，形成从左到右的解码感
                it.left = 0.18 + duration * (0.55 * (k / Math.max(1, total)) + 0.25 * Math.random());
                it.scrambling = true;
                it.nextChange = 0;
            }
            last = 0;
            wake();
        }

        if (intro && !reduce) {
            if (window.IntersectionObserver) {
                var io = new IntersectionObserver(function (entries) {
                    if (entries.some(function (e) { return e.isIntersecting; })) {
                        io.disconnect();
                        measure();
                        introRun();
                    }
                }, { rootMargin: '0px 0px -10% 0px' });
                io.observe(el);
            } else {
                introRun();
            }
        }

        return {
            scrambleAt: scrambleAt,
            reseed: function () { measured = false; },
            destroy: function () {
                alive = false;
                global.cancelAnimationFrame(raf);
                el.removeEventListener('pointermove', onPointerMove);
                el.removeEventListener('pointerleave', onPointerLeave);
                window.removeEventListener('resize', onResize);
                window.removeEventListener('scroll', onScroll);
            }
        };
    }

    ScrambledText.autoInit = function () {
        var nodes = document.querySelectorAll('[data-scrambled-text]');
        Array.prototype.forEach.call(nodes, function (node) {
            if (node.__scrambledText) return;
            var d = node.dataset || {};
            node.__scrambledText = new ScrambledText(node, {
                radius: d.radius === undefined ? undefined : Number(d.radius),
                duration: d.duration === undefined ? undefined : Number(d.duration),
                speed: d.speed === undefined ? undefined : Number(d.speed),
                scrambleChars: d.scrambleChars || undefined,
                intro: d.intro !== 'false',
                stagger: d.stagger === undefined ? undefined : Number(d.stagger)
            });
        });
    };

    global.ScrambledText = ScrambledText;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ScrambledText.autoInit);
    } else {
        ScrambledText.autoInit();
    }
})(window);