/*
 * FluxLines —— React Bits 同名组件的原生 JS 移植版
 * 原组件：https://reactbits.dev/components/flux-lines
 * 本站无 React/Node 构建链，故移植为 WebGL2 + 原生 DOM，
 * 着色器（含 hash / smin / sinlerp / vn / dbn 噪声场）与参数语义与原版逐行等价。
 *
 * 用法：
 *   <div class="flux-bg" data-flux-lines data-theme="auto" data-flow-direction="down"></div>
 *   或 new FluxLines(container, { speed: 0.5, ... })
 */
(function (global) {
    'use strict';

    var MAX_COLORS = 8;
    var INTRO_SECONDS = 1.8;
    var FLOW = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] };

    var VERTEX = [
        '#version 300 es',
        'in vec2 aPosition;',
        'void main() {',
        '  gl_Position = vec4(aPosition, 0.0, 1.0);',
        '}'
    ].join('\n');

    var FIELD = [
        'float hash(vec3 p3) {',
        '  p3 = fract(p3 * 0.1031);',
        '  p3 += dot(p3, p3.zyx + 33.33);',
        '  return fract((p3.x + p3.y) * p3.z);',
        '}',
        '',
        'float smin(float a, float b, float k) {',
        '  float r = exp2(-a / k) + exp2(-b / k);',
        '  return -k * log2(r);',
        '}',
        '',
        'float sinlerp(float a, float b, float w) {',
        '  return mix(a, b, (sin(w * 3.14159265 - 3.14159265 / 2.0) + 1.0) / 2.0);',
        '}',
        '',
        'float vn(vec2 p, float s, float seed) {',
        '  vec2 cellp = floor(p / s);',
        '  vec2 relp = mod(p, s);',
        '  float g1 = hash(vec3(cellp, seed));',
        '  float g2 = hash(vec3(cellp.x + 1.0, cellp.y, seed));',
        '  float g3 = hash(vec3(cellp.x + 1.0, cellp.y + 1.0, seed));',
        '  float g4 = hash(vec3(cellp.x, cellp.y + 1.0, seed));',
        '  float bx = sinlerp(g1, g2, relp.x / s);',
        '  float tx = sinlerp(g4, g3, relp.x / s);',
        '  return sinlerp(bx, tx, relp.y / s);',
        '}',
        '',
        'float dbn(vec2 p, float s, float seed) {',
        '  float o = s / 2.0;',
        '  float n0 = vn(p, s, seed);',
        '  float n1 = vn(p + vec2(o, o), s, seed + 0.1);',
        '  float n2 = vn(p + vec2(-o, o), s, seed + 0.2);',
        '  float n3 = vn(p + vec2(o, -o), s, seed + 0.3);',
        '  float n4 = vn(p + vec2(-o, -o), s, seed + 0.4);',
        '  return (2.0 * n0 + 1.5 * n1 + 1.25 * n2 + 1.125 * n3 + n4) / 7.0;',
        '}'
    ].join('\n');

    var FRAGMENT = [
        '#version 300 es',
        'precision highp float;',
        'precision highp int;',
        'uniform vec2 uResolution;',
        'uniform float uTime;',
        'uniform vec2 uFlow;',
        'uniform float uSpeed;',
        'uniform float uScale;',
        'uniform float uTurbulence;',
        'uniform float uFluidity;',
        'uniform float uRimWidth;',
        'uniform float uSharpness;',
        'uniform float uShimmer;',
        'uniform float uGlow;',
        'uniform float uLine;',
        'uniform float uMaxHalf;',
        'uniform vec3 uColors[' + MAX_COLORS + '];',
        'uniform int uColorCount;',
        'uniform vec4 uMagnet;',
        'uniform vec4 uSwirl;',
        'uniform float uReveal;',
        'uniform float uLight;',
        'uniform float uOpaque;',
        'uniform vec3 uBackground;',
        'uniform float uOpacity;',
        'out vec4 outColor;',
        FIELD,
        '',
        'vec3 palette(float h) {',
        '  float x = clamp(h, 0.0, 1.0) * float(uColorCount - 1);',
        '  int i = int(floor(x));',
        '  int j = min(i + 1, uColorCount - 1);',
        '  return mix(uColors[i], uColors[j], smoothstep(0.0, 1.0, x - float(i)));',
        '}',
        '',
        'void main() {',
        '  float ref = 700.0 / max(uScale, 0.05);',
        '  vec2 frag = gl_FragCoord.xy;',
        '  vec2 toMagnet = (frag - uMagnet.xy) / uResolution.y;',
        '  float pull = uMagnet.z * exp(-dot(toMagnet, toMagnet) / (uMagnet.w * uMagnet.w));',
        '  if (pull > 0.001) {',
        '    float angle = pull * 0.55;',
        '    float c = cos(angle);',
        '    float s = sin(angle);',
        '    frag = uMagnet.xy + mat2(c, s, -s, c) * (frag - uMagnet.xy);',
        '  }',
        '  if (uSwirl.w > 0.0) {',
        '    vec2 d = frag - uSwirl.xy;',
        '    float reach = uSwirl.z;',
        '    float angle = uSwirl.w * exp(-dot(d, d) / (reach * reach));',
        '    float c = cos(angle);',
        '    float s = sin(angle);',
        '    frag = uSwirl.xy + mat2(c, s, -s, c) * d;',
        '  }',
        '  vec2 p = frag / uResolution.y * ref;',
        '',
        '  float spd = 200.0 * uSpeed;',
        '  float t = uTime;',
        '  vec2 dir = uFlow;',
        '  vec2 perp = vec2(-dir.y, dir.x);',
        '  float distort1 = vn(p + perp * (t * spd), 60.0, 10.0) * 50.0 * uTurbulence;',
        '  float distort2 = vn(p - perp * (t * spd), 120.0, 15.0) * 100.0 * uTurbulence;',
        '  float peaks = dbn(p + distort1 + dir * (t * spd * 0.5), 40.0, 1.0);',
        '  float peaks2 = dbn(p + distort2 - dir * (t * spd * 0.5), 40.0, 0.0);',
        '  float field = smin(peaks, peaks2, max(uFluidity, 0.001));',
        '',
        '  float slope = length(vec2(dFdx(field), dFdy(field)));',
        '  float gap = abs(field - 0.4);',
        '  float pixels = gap / max(slope, 1e-6);',
        '  float halfBand = max(uRimWidth, 0.001) * 0.5;',
        '  float across = max(gap / halfBand, pixels / uMaxHalf);',
        '  float band = 5.0 * uRimWidth * (1.0 - across);',
        '  float reveal = smoothstep(0.2, 0.85, pull);',
        '  float shimmer = vn(p + dir * (t * spd * 0.5), 60.0, 12.0) * uShimmer * (1.0 - reveal * 0.75);',
        '  float lit = clamp(band - shimmer, 0.0, 1.0);',
        '  float glow = pow(lit, uSharpness) * uGlow * (1.0 + reveal * 0.25);',
        '  float core = uLine > 0.0 ? smoothstep(uLine + 0.75, uLine - 0.75, pixels) * max(smoothstep(0.08, 0.6, glow), reveal) : 0.0;',
        '  float shine = clamp(glow, 0.0, 1.0);',
        '  float energy = max(shine * shine, core * 0.85) * uReveal;',
        '',
        '  float h = clamp(0.5 + (peaks - peaks2) * 0.8, 0.0, 1.0);',
        '  vec3 tint = palette(h);',
        '',
        '  if (uLight > 0.5) {',
        '    float chroma = max(tint.r, max(tint.g, tint.b)) - min(tint.r, min(tint.g, tint.b));',
        '    vec3 ink = mix(vec3(0.07, 0.07, 0.08), tint * 0.55, clamp(chroma * 1.6, 0.0, 1.0));',
        '    float cover = energy * uOpacity;',
        '    outColor = uOpaque > 0.5 ? vec4(mix(uBackground, ink, cover), 1.0) : vec4(ink * cover, cover);',
        '    return;',
        '  }',
        '',
        '  vec3 light = tint * energy * uOpacity;',
        '  outColor = uOpaque > 0.5 ? vec4(uBackground + light, 1.0) : vec4(light, max(light.r, max(light.g, light.b)));',
        '}'
    ].join('\n');

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

    function compile(gl, type, source) {
        var shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
        if (window.console) console.warn('[FluxLines] shader:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    function link(gl) {
        var vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
        var fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
        var program = gl.createProgram();
        if (!vertex || !fragment || !program) return null;
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.bindAttribLocation(program, 0, 'aPosition');
        gl.linkProgram(program);
        gl.deleteShader(vertex);
        gl.deleteShader(fragment);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            if (window.console) console.warn('[FluxLines] link:', gl.getProgramInfoLog(program));
            gl.deleteProgram(program);
            return null;
        }
        var uniforms = {};
        var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < count; i++) {
            var info = gl.getActiveUniform(program, i);
            if (info) uniforms[info.name.replace('[0]', '')] = gl.getUniformLocation(program, info.name);
        }
        return { program: program, uniforms: uniforms };
    }

    function FluxLines(container, options) {
        var opts = options || {};

        var settings = {
            colors: Array.isArray(opts.colors) && opts.colors.length ? opts.colors.slice(0, MAX_COLORS) : ['#ffffff'],
            speed: opts.speed == null ? 0.5 : opts.speed,
            scale: Math.max(0.05, opts.scale == null ? 1.6 : opts.scale),
            turbulence: opts.turbulence == null ? 1 : opts.turbulence,
            fluidity: Math.max(0.001, opts.fluidity == null ? 0.1 : opts.fluidity),
            rimWidth: Math.max(0.001, opts.rimWidth == null ? 0.2 : opts.rimWidth),
            sharpness: Math.max(0.1, opts.sharpness == null ? 2.5 : opts.sharpness),
            shimmer: Math.max(0, opts.shimmer == null ? 1.5 : opts.shimmer),
            glow: Math.max(0, opts.glow == null ? 2 : opts.glow),
            lineWidth: Math.max(0, opts.lineWidth == null ? 1 : opts.lineWidth),
            flow: FLOW[opts.flowDirection] || FLOW.down,
            opacity: clamp(opts.opacity == null ? 1 : opts.opacity, 0, 1),
            mouseInteraction: opts.mouseInteraction !== false,
            mouseStrength: Math.max(0, opts.mouseStrength == null ? 1 : opts.mouseStrength),
            mouseRadius: Math.max(0.01, opts.mouseRadius == null ? 0.35 : opts.mouseRadius),
            mouseDampening: Math.max(0, opts.mouseDampening == null ? 0.15 : opts.mouseDampening),
            clickSwirl: opts.clickSwirl !== false,
            intro: opts.intro !== false,
            theme: opts.theme === 'light' ? 'light' : opts.theme === 'dark' ? 'dark' : 'auto',
            transparent: opts.transparent !== false,
            backgroundColor: opts.backgroundColor || null,
            paused: !!opts.paused,
            dpr: opts.dpr,
            minWidth: opts.minWidth == null ? 768 : opts.minWidth,
            // 跨页面衔接：站内跳转是整页刷新，画布必然重建。
            // 把已流逝的时间存进 sessionStorage，回来时从同一相位继续，
            // 视觉上就像背景一直在流动，只是换了内容。
            continuity: opts.continuity !== false
        };

        var canvas = document.createElement('canvas');
        canvas.className = 'flux-lines-canvas';
        canvas.setAttribute('aria-hidden', 'true');

        function resolvedLight() {
            if (settings.theme === 'light') return true;
            if (settings.theme === 'dark') return false;
            return !document.documentElement.classList.contains('dark');
        }

        // 仅在桌面端初始化：窄屏直接跳过，连 canvas 和 WebGL 上下文都不创建，零开销
        if (settings.minWidth > 0 && window.innerWidth < settings.minWidth) {
            container.classList.add('flux-lines-container');
            container.setAttribute('data-flux-disabled', 'narrow');
            return { destroy: function () {}, wake: function () {} };
        }

        container.classList.add('flux-lines-container');
        container.appendChild(canvas);

        var gl = canvas.getContext('webgl2', {
            alpha: true,
            premultipliedAlpha: true,
            antialias: false,
            depth: false,
            stencil: false
        });
        if (!gl) {
            container.setAttribute('data-webgl', 'unsupported');
            if (window.console) console.warn('[FluxLines] WebGL2 不可用，已跳过背景渲染');
            return { destroy: function () {}, wake: function () {} };
        }

        var program = link(gl);
        if (!program) return { destroy: function () {}, wake: function () {} };
        var u = program.uniforms;

        var buffer = gl.createBuffer();
        var vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

        var probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        var cache = new Map();
        function parseColor(value, fallback) {
            if (!value) return fallback;
            var key = String(value);
            if (cache.has(key)) return cache.get(key);
            var rgb = fallback;
            if (probe) {
                probe.clearRect(0, 0, 1, 1);
                probe.fillStyle = '#000000';
                probe.fillStyle = key;
                probe.fillRect(0, 0, 1, 1);
                var d = probe.getImageData(0, 0, 1, 1).data;
                rgb = [d[0] / 255, d[1] / 255, d[2] / 255];
            }
            cache.set(key, rgb);
            return rgb;
        }

        var palette = new Float32Array(MAX_COLORS * 3);
        var paletteKey = '';
        function syncPalette() {
            var key = settings.colors.join('|');
            if (key === paletteKey) return;
            paletteKey = key;
            settings.colors.forEach(function (value, index) {
                palette.set(parseColor(value, [1, 1, 1]), index * 3);
            });
        }

        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var pointer = { x: 0, y: 0, inside: false };
        var magnet = { x: 0, y: 0, active: 0 };
        var swirl = { x: 0, y: 0, age: 10 };
        var time = 0;

        // 从上次页面继承相位，保证站内跳转时背景是"连续流动"而不是每次从头开始
        var STORE_KEY = '__flux_phase';
        function readPhase() {
            if (!settings.continuity) return 0;
            try {
                var raw = window.sessionStorage.getItem(STORE_KEY);
                if (!raw) return 0;
                var saved = JSON.parse(raw);
                if (!saved || typeof saved.t !== 'number') return 0;
                // 距上次离开的时间也补上，避免停顿感
                var elapsed = (Date.now() - (saved.at || Date.now())) / 1000;
                return saved.t + Math.max(0, Math.min(elapsed, 30));
            } catch (e) { return 0; }
        }
        function savePhase() {
            if (!settings.continuity) return;
            try {
                window.sessionStorage.setItem(STORE_KEY, JSON.stringify({ t: time, at: Date.now() }));
            } catch (e) { /* 隐私模式下 sessionStorage 可能不可用，忽略 */ }
        }

        time = readPhase();
        var reveal = settings.intro && !reduce && time === 0 ? 0 : 1;
        var raf = 0;
        var last = 0;
        var visible = true;
        var alive = true;
        var themeObserver = null;

        function render() {
            syncPalette();
            var ratio = canvas.width / Math.max(1, container.clientWidth);
            var intro = Math.min(1, reveal);
            var light = resolvedLight();
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.useProgram(program.program);
            gl.bindVertexArray(vao);
            gl.uniform2f(u.uResolution, canvas.width, canvas.height);
            gl.uniform1f(u.uTime, time);
            gl.uniform2f(u.uFlow, settings.flow[0], settings.flow[1]);
            gl.uniform1f(u.uSpeed, settings.speed);
            gl.uniform1f(u.uScale, settings.scale);
            gl.uniform1f(u.uTurbulence, settings.turbulence);
            gl.uniform1f(u.uFluidity, settings.fluidity);
            gl.uniform1f(u.uRimWidth, settings.rimWidth);
            gl.uniform1f(u.uSharpness, settings.sharpness);
            gl.uniform1f(u.uShimmer, settings.shimmer);
            gl.uniform1f(u.uGlow, settings.glow);
            gl.uniform1f(u.uLine, settings.lineWidth * ratio * 0.5);
            gl.uniform1f(u.uMaxHalf, 28 * ratio);
            gl.uniform3fv(u.uColors, palette);
            gl.uniform1i(u.uColorCount, settings.colors.length);
            gl.uniform4f(u.uMagnet, magnet.x, magnet.y, magnet.active * settings.mouseStrength, settings.mouseRadius);
            var age = swirl.age;
            var twist = 1.9 * Math.min(1, age / 0.23) * Math.exp(-Math.max(0, age - 0.23) * 1.1);
            gl.uniform4f(u.uSwirl, swirl.x, swirl.y, canvas.height * 0.22 * (1 + age * 0.5), age < 6 ? twist : 0);
            gl.uniform1f(u.uReveal, intro * intro * (3 - 2 * intro));
            gl.uniform1f(u.uLight, light ? 1 : 0);
            gl.uniform1f(u.uOpaque, settings.transparent ? 0 : 1);
            var bg = settings.backgroundColor
                ? parseColor(settings.backgroundColor, [0, 0, 0])
                : (light ? [1, 1, 1] : [0.0706, 0.0588, 0.0902]);
            gl.uniform3fv(u.uBackground, new Float32Array(bg));
            gl.uniform1f(u.uOpacity, settings.opacity);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        function frame(now) {
            raf = 0;
            if (!alive) return;
            if (!visible || document.hidden) return;
            var dt = last ? clamp((now - last) / 1000, 0.0005, 0.05) : 1 / 60;
            last = now;
            var motion = settings.paused || reduce ? 0 : 1;
            time += dt * motion;
            swirl.age += dt;
            if (settings.intro && !reduce && reveal < 1) reveal = Math.min(1, reveal + dt / INTRO_SECONDS);
            else if (!settings.intro || reduce) reveal = 1;

            var engaged = settings.mouseInteraction && pointer.inside;
            var follow = settings.mouseDampening > 0 ? 1 - Math.exp(-dt / settings.mouseDampening) : 1;
            if (engaged) {
                magnet.x += (pointer.x - magnet.x) * follow;
                magnet.y += (pointer.y - magnet.y) * follow;
            }
            var target = engaged ? 1 : 0;
            magnet.active += (target - magnet.active) * (1 - Math.exp(-dt / 0.3));
            if (Math.abs(target - magnet.active) < 0.001) magnet.active = target;

            render();
            var busy = motion > 0 || magnet.active !== target || reveal < 1 || swirl.age < 6;
            if (busy) raf = window.requestAnimationFrame(frame);
            else last = 0;
        }

        function wake() {
            if (!raf && alive && visible && !document.hidden) raf = window.requestAnimationFrame(frame);
        }

        function resize() {
            var width = Math.max(1, container.clientWidth);
            var height = Math.max(1, container.clientHeight);
            /*
             * 移动端 GPU 较弱且屏幕像素密度高，dpr 上限压到 1.25，
             * 避免在高分屏上渲染 3 倍像素导致掉帧。
             */
            var isNarrow = window.innerWidth < 768;
            var cap = isNarrow ? 1.25 : 2;
            var ratio = Math.min(settings.dpr || window.devicePixelRatio || 1, cap);
            canvas.width = Math.max(1, Math.round(width * ratio));
            canvas.height = Math.max(1, Math.round(height * ratio));
            render();
            wake();
        }

        function locate(event) {
            var rect = container.getBoundingClientRect();
            var x = event.clientX - rect.left;
            var y = event.clientY - rect.top;
            var ratio = canvas.width / Math.max(1, rect.width);
            pointer.inside = x >= 0 && y >= 0 && x <= rect.width && y <= rect.height;
            pointer.x = x * ratio;
            pointer.y = (rect.height - y) * ratio;
        }

        function onPointerMove(event) {
            var wasInside = pointer.inside;
            locate(event);
            if (pointer.inside && !wasInside && magnet.active < 0.05) {
                magnet.x = pointer.x;
                magnet.y = pointer.y;
            }
            wake();
        }

        function onPointerDown(event) {
            if (!settings.clickSwirl || reduce) return;
            // 背景层不拦截事件，但点击仍然触发漩涡：先按事件位置更新磁铁
            locate(event);
            if (!pointer.inside) return;
            swirl.x = pointer.x;
            swirl.y = pointer.y;
            swirl.age = 0;
            wake();
        }

        function onPointerUp(event) {
            if (event.pointerType !== 'mouse') pointer.inside = false;
        }

        function onPointerLeave() {
            pointer.inside = false;
        }

        function onVisibility() {
            last = 0;
            if (document.hidden) savePhase();
            wake();
        }

        // 站内跳转前保存相位（pagehide 比 unload 更可靠，且兼容 BFCache）
        function onPageHide() { savePhase(); }

        var resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(container);
        var intersection = null;
        if (window.IntersectionObserver) {
            intersection = new IntersectionObserver(function (entries) {
                visible = entries.some(function (entry) { return entry.isIntersecting; });
                if (visible) {
                    last = 0;
                    wake();
                }
            });
            intersection.observe(container);
        }
        if (window.MutationObserver) {
            themeObserver = new MutationObserver(function () { wake(); });
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
        window.addEventListener('pointermove', onPointerMove, { passive: true });
        window.addEventListener('pointerdown', onPointerDown, { passive: true });
        window.addEventListener('pointerup', onPointerUp, { passive: true });
        window.addEventListener('pointercancel', onPointerUp, { passive: true });
        document.documentElement.addEventListener('pointerleave', onPointerLeave);
        document.addEventListener('visibilitychange', onVisibility);
        window.addEventListener('pagehide', onPageHide);
        resize();

        return {
            wake: wake,
            destroy: function () {
                alive = false;
                window.cancelAnimationFrame(raf);
                resizeObserver.disconnect();
                if (intersection) intersection.disconnect();
                if (themeObserver) themeObserver.disconnect();
                window.removeEventListener('pointermove', onPointerMove);
                window.removeEventListener('pointerdown', onPointerDown);
                window.removeEventListener('pointerup', onPointerUp);
                window.removeEventListener('pointercancel', onPointerUp);
                document.documentElement.removeEventListener('pointerleave', onPointerLeave);
                document.removeEventListener('visibilitychange', onVisibility);
                window.removeEventListener('pagehide', onPageHide);
                savePhase();
                gl.deleteProgram(program.program);
                gl.deleteBuffer(buffer);
                gl.deleteVertexArray(vao);
                var lose = gl.getExtension('WEBGL_lose_context');
                if (lose) lose.loseContext();
            }
        };
    }

    FluxLines.autoInit = function () {
        var nodes = document.querySelectorAll('[data-flux-lines]');
        Array.prototype.forEach.call(nodes, function (node) {
            if (node.__fluxLines) return;
            var d = node.dataset || {};
            var num = function (key) { return d[key] === undefined ? undefined : Number(d[key]); };
            node.__fluxLines = new FluxLines(node, {
                colors: d.colors ? d.colors.split(',').map(function (s) { return s.trim(); }) : undefined,
                speed: num('speed'),
                scale: num('scale'),
                turbulence: num('turbulence'),
                fluidity: num('fluidity'),
                rimWidth: num('rimWidth'),
                sharpness: num('sharpness'),
                shimmer: num('shimmer'),
                glow: num('glow'),
                lineWidth: num('lineWidth'),
                flowDirection: d.flowDirection || 'down',
                opacity: num('opacity'),
                mouseInteraction: d.mouseInteraction !== 'false',
                mouseStrength: num('mouseStrength'),
                mouseRadius: num('mouseRadius'),
                mouseDampening: num('mouseDampening'),
                clickSwirl: d.clickSwirl !== 'false',
                intro: d.intro !== 'false',
                theme: d.theme || 'auto',
                dpr: num('dpr'),
                minWidth: d.minWidth === undefined ? 768 : Number(d.minWidth)
            });
        });
    };

    global.FluxLines = FluxLines;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', FluxLines.autoInit);
    } else {
        FluxLines.autoInit();
    }
})(window);