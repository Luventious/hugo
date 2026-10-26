/*
 * InfiniteMenu —— React Bits 同名组件的原生 JS 移植版
 * 原组件：https://reactbits.dev/components/infinite-menu
 * 本站无 React/Node 构建链，故移植为 WebGL2 + 原生 DOM，
 * 着色器、球面点分布、拖拽/惯性/自动播放的数学模型与原版逐行等价。
 *
 * 用法：
 *   <div class="lens-stage" data-infinite-menu data-items='[...]'></div>
 *   或 new InfiniteMenu(el, { items, count, ... })
 */
(function (global) {
    'use strict';

    var VERTEX = [
        '#version 300 es',
        'in vec2 aCorner;',
        'in vec4 aTile;',
        'uniform vec4 uOrientation;',
        'uniform mat4 uProjection;',
        'uniform float uCamera;',
        'uniform float uRadius;',
        'uniform float uTileRadius;',
        'uniform vec4 uSpin;',
        'uniform float uStretch;',
        'uniform float uShift;',
        'out vec2 vUv;',
        'out float vFront;',
        'out float vItem;',
        'vec3 rotate(vec4 q, vec3 v) {',
        '  vec3 t = 2.0 * cross(q.xyz, v);',
        '  return v + q.w * t + cross(q.xyz, t);',
        '}',
        'void main() {',
        '  vec3 center = normalize(rotate(uOrientation, aTile.xyz));',
        '  vec3 reference = abs(center.y) > 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(0.0, 1.0, 0.0);',
        '  vec3 tangent = normalize(cross(reference, center));',
        '  vec3 bitangent = cross(center, tangent);',
        '  float front = max(center.z, 0.0);',
        '  vec3 offset = (tangent * aCorner.x + bitangent * aCorner.y) * uTileRadius * mix(0.5, 1.0, front);',
        '  vec3 motion = cross(uSpin.xyz, center);',
        '  float sweep = length(motion);',
        '  if (sweep > 0.0001) {',
        '    vec3 direction = motion / sweep;',
        '    float amount = min(0.9, uSpin.w * uStretch * 0.12) * sweep;',
        '    offset += direction * dot(offset, direction) * amount;',
        '  }',
        '  vec3 world = normalize(center * uRadius + offset) * uRadius * (1.0 + 0.003 * center.z);',
        '  gl_Position = uProjection * vec4(world.xy, world.z - uCamera, 1.0);',
        '  gl_Position.y += uShift * gl_Position.w;',
        '  vUv = aCorner;',
        '  vFront = center.z;',
        '  vItem = aTile.w;',
        '}'
    ].join('\n');

    var FRAGMENT = [
        '#version 300 es',
        'precision highp float;',
        'uniform sampler2D uAtlas;',
        'uniform float uCells;',
        'uniform float uInset;',
        'uniform float uRoundness;',
        'uniform float uGrayscale;',
        'uniform float uDim;',
        'uniform float uReveal;',
        'uniform vec3 uPlaceholder;',
        'uniform vec3 uTone;',
        'in vec2 vUv;',
        'in float vFront;',
        'in float vItem;',
        'out vec4 outColor;',
        'void main() {',
        '  float corner = clamp(uRoundness, 0.0, 1.0);',
        '  vec2 q = abs(vUv) - (1.0 - corner);',
        '  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - corner;',
        '  float aa = max(fwidth(d), 0.0001);',
        '  float mask = 1.0 - smoothstep(-aa, aa, d);',
        '  float alpha = mask * smoothstep(0.02, 0.4, vFront) * uReveal;',
        '  if (alpha < 0.002) discard;',
        '  vec2 cell = vec2(mod(vItem, uCells), floor(vItem / uCells));',
        '  vec2 local = vec2(vUv.x, -vUv.y) * 0.5 + 0.5;',
        '  vec4 sampled = texture(uAtlas, (cell + uInset + local * (1.0 - 2.0 * uInset)) / uCells);',
        '  vec3 color = mix(uPlaceholder, sampled.rgb, sampled.a);',
        '  float focus = smoothstep(0.93, 0.997, vFront);',
        '  float gray = dot(color, vec3(0.2126, 0.7152, 0.0722));',
        '  color = mix(color, vec3(gray), uGrayscale * (1.0 - focus));',
        '  color = mix(color, uTone, uDim * (1.0 - focus));',
        '  outColor = vec4(color * alpha, alpha);',
        '}'
    ].join('\n');

    var GRID = 12;
    var RADIUS = 2;
    var FOV = (30 * Math.PI) / 180;
    var FRONT = [0, 0, 1];

    function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
    function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    function cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    }
    function normalize(v) {
        var length = Math.hypot(v[0], v[1], v[2]) || 1;
        return [v[0] / length, v[1] / length, v[2] / length];
    }
    function quatMultiply(a, b) {
        return [
            a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
            a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
            a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
            a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
        ];
    }
    function quatAxisAngle(axis, angle) {
        var s = Math.sin(angle / 2);
        return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
    }
    function quatNormalize(q) {
        var length = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
        return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
    }
    function rotate(q, v) {
        var t = cross(q, v);
        t = [t[0] * 2, t[1] * 2, t[2] * 2];
        var u = cross(q, t);
        return [
            v[0] + q[3] * t[0] + u[0],
            v[1] + q[3] * t[1] + u[1],
            v[2] + q[3] * t[2] + u[2]
        ];
    }

    function sphere(count) {
        var golden = Math.PI * (3 - Math.sqrt(5));
        var out = [];
        for (var i = 0; i < count; i++) {
            var y = 1 - (2 * (i + 0.5)) / count;
            var ring = Math.sqrt(1 - y * y);
            out.push([Math.cos(golden * i) * ring, y, Math.sin(golden * i) * ring]);
        }
        return out;
    }

    function luminance(hex) {
        var value = String(hex).replace('#', '');
        var full = value.length === 3 ? value.replace(/./g, function (c) { return c + c; }) : value.slice(0, 6);
        var n = parseInt(full, 16);
        if (isNaN(n)) return 0;
        return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255;
    }

    function compile(gl, type, source) {
        var shader = gl.createShader(type);
        if (!shader) return null;
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
        if (window.console) console.warn('[InfiniteMenu] shader:', gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
        return null;
    }

    function InfiniteMenu(root, options) {
        var opts = options || {};
        var settings = {
            count: clamp(Math.round(opts.count == null ? 160 : opts.count), 6, 400),
            tileSize: clamp(opts.tileSize == null ? 0.63 : opts.tileSize, 0.2, 1.2),
            roundness: clamp(opts.roundness == null ? 0.2 : opts.roundness, 0, 1),
            zoom: clamp(opts.zoom == null ? 1.65 : opts.zoom, 0.2, 4),
            pullBack: clamp(opts.pullBack == null ? 1 : opts.pullBack, 0, 3),
            stretch: clamp(opts.stretch == null ? 0.6 : opts.stretch, 0, 3),
            inertia: clamp(opts.inertia == null ? 0.6 : opts.inertia, 0, 1),
            autoplay: Math.max(0, opts.autoplay == null ? 3 : opts.autoplay),
            grayscale: opts.grayscale !== false,
            dim: clamp(opts.dim == null ? 0.5 : opts.dim, 0, 1),
            intro: opts.intro !== false,
            theme: opts.theme === 'light' ? 'light' : opts.theme === 'auto' ? 'auto' : 'dark'
        };
        var items = Array.isArray(opts.items) ? opts.items : [];
        var onActiveChange = opts.onActiveChange || null;
        var onItemClick = opts.onItemClick || null;

        var canvas = document.createElement('canvas');
        canvas.className = 'infinite-menu__canvas';
        root.classList.add('infinite-menu');
        root.setAttribute('tabindex', '0');
        root.setAttribute('role', 'group');
        root.setAttribute('aria-roledescription', 'carousel');
        root.appendChild(canvas);

        var infoEl = document.createElement('div');
        infoEl.className = 'infinite-menu__info';
        root.appendChild(infoEl);

        var titleEl = document.createElement('h2');
        titleEl.className = 'infinite-menu__title';
        var descEl = document.createElement('p');
        descEl.className = 'infinite-menu__description';
        var actionEl = document.createElement('a');
        actionEl.className = 'infinite-menu__action';
        actionEl.innerHTML =
            '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
            '<path d="M7 17L17 7M17 7H9M17 7V15" stroke="currentColor" stroke-width="2" ' +
            'stroke-linecap="round" stroke-linejoin="round"/></svg>';
        /*
         * 下方按钮是打开图片的唯一入口。
         * 用内置查看器打开并阻止默认跳转：既不离开球体页面，
         * 也避免与「拖动旋转」的手势产生歧义。
         */
        actionEl.setAttribute('role', 'button');
        actionEl.setAttribute('tabindex', '0');
        actionEl.addEventListener('click', function (event) {
            event.preventDefault();
            var idx = state.shown >= 0 ? state.shown : (state.assign[state.front] || 0);
            var item = items[idx % Math.max(1, items.length)];
            if (!item) return;
            if (onItemClick) {
                onItemClick(item, idx);
                return;
            }
            if (item.link && /\.(jpe?g|png|webp|avif|gif)$/i.test(item.link)) {
                openViewer(item.link);
            } else if (item.link) {
                window.open(item.link, item.link.indexOf('http') === 0 ? '_blank' : '_self', 'noopener');
            }
        });
        actionEl.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                actionEl.click();
            }
        });
        infoEl.appendChild(titleEl);
        infoEl.appendChild(descEl);
        infoEl.appendChild(actionEl);

        var ink;
        var accent = opts.accentColor || '';
        var onAccent;

        // theme 支持 'dark' | 'light' | 'auto'：auto 跟随站点的 html.dark 开关。
        // 深色主题=浅色文字，浅色主题=深色文字，否则白底白字会看不见。
        function resolvedTheme() {
            if (settings.theme === 'auto') {
                return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
            }
            return settings.theme;
        }

        function applyTheme() {
            var theme = resolvedTheme();
            ink = theme === 'light' ? '#120f17' : '#ffffff';
            if (!accent) accent = ink;
            onAccent = luminance(accent) > 0.5 ? '#120f17' : '#ffffff';
            root.style.setProperty('--infinite-menu-text', ink);
            root.style.setProperty('--infinite-menu-accent', accent);
            root.style.setProperty('--infinite-menu-on-accent', onAccent);
            root.style.setProperty(
                '--infinite-menu-shadow',
                theme === 'light' ? '0 2px 18px rgba(255,255,255,0.7)' : '0 2px 18px rgba(0,0,0,0.45)'
            );
            state.theme = theme;
        }
        if (opts.backgroundColor) root.style.backgroundColor = opts.backgroundColor;
        if (opts.style && typeof opts.style === 'object') {
            for (var key in opts.style) {
                if (Object.prototype.hasOwnProperty.call(opts.style, key)) root.style[key] = opts.style[key];
            }
        }

        var gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true });
        if (!gl) {
            // 无 WebGL2 时的降级：不留白屏，也不抛错，仅隐藏画布
            canvas.style.display = 'none';
            root.setAttribute('data-webgl', 'unsupported');
            if (window.console) console.warn('[InfiniteMenu] WebGL2 不可用，已跳过 3D 渲染');
            return { destroy: function () {}, loadItems: function () {}, wake: function () {} };
        }

        var vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
        var fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
        var program = gl.createProgram();
        if (!vertex || !fragment || !program) return { destroy: function () {}, loadItems: function () {}, wake: function () {} };
        gl.attachShader(program, vertex);
        gl.attachShader(program, fragment);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            if (window.console) console.warn('[InfiniteMenu] link:', gl.getProgramInfoLog(program));
            return { destroy: function () {}, loadItems: function () {}, wake: function () {} };
        }
        gl.useProgram(program);

        var uniforms = {};
        [
            'uOrientation', 'uProjection', 'uCamera', 'uRadius', 'uTileRadius', 'uSpin', 'uStretch',
            'uShift', 'uAtlas', 'uCells', 'uInset', 'uRoundness', 'uGrayscale', 'uDim', 'uReveal',
            'uPlaceholder', 'uTone'
        ].forEach(function (name) {
            uniforms[name] = gl.getUniformLocation(program, name);
        });

        var corners = [];
        var indices = [];
        var x;
        var y;
        for (y = 0; y <= GRID; y++) {
            for (x = 0; x <= GRID; x++) corners.push((x / GRID) * 2 - 1, (y / GRID) * 2 - 1);
        }
        for (y = 0; y < GRID; y++) {
            for (x = 0; x < GRID; x++) {
                var start = y * (GRID + 1) + x;
                indices.push(start, start + 1, start + GRID + 1, start + 1, start + GRID + 2, start + GRID + 1);
            }
        }

        var vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        var cornerBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, cornerBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(corners), gl.STATIC_DRAW);
        var cornerLocation = gl.getAttribLocation(program, 'aCorner');
        gl.enableVertexAttribArray(cornerLocation);
        gl.vertexAttribPointer(cornerLocation, 2, gl.FLOAT, false, 0, 0);
        var indexBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(indices), gl.STATIC_DRAW);
        var tileBuffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, tileBuffer);
        var tileLocation = gl.getAttribLocation(program, 'aTile');
        gl.enableVertexAttribArray(tileLocation);
        gl.vertexAttribPointer(tileLocation, 4, gl.FLOAT, false, 0, 0);
        gl.vertexAttribDivisor(tileLocation, 1);
        gl.bindVertexArray(null);

        var atlasTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
        gl.uniform1i(uniforms.uAtlas, 0);

        var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var atlas = { canvas: document.createElement('canvas'), cells: 1, cell: 512, request: 0, dirty: false };
        var drag = { active: false, id: -1, x: 0, y: 0, dx: 0, dy: 0, moved: 0, start: 0 };
        var state = {
            width: 1,
            height: 1,
            tiles: [],
            assign: [],
            count: 0,
            orientation: quatNormalize([0.08, -0.3, 0, 1]),
            axis: [0, 1, 0],
            speed: settings.intro && !reduce ? 3.2 : 0,
            camera: 0,
            target: -1,
            front: 0,
            shown: -1,
            moving: true,
            reveal: 0,
            hovered: false,
            focused: false,
            idle: 0,
            settle: 0,
            tilePx: 0,
            layout: 'side',
            shift: 0,
            started: false,
            theme: 'light'
        };
        var raf = 0;
        var timer = 0;
        var last = 0;
        var visible = true;
        var alive = true;

        function layout() {
            if (settings.count === state.count) return;
            state.count = settings.count;
            state.tiles = sphere(settings.count);
            var total = Math.max(1, items.length);
            var usage = new Array(total).fill(0);
            state.assign = state.tiles.map(function () { return -1; });
            state.tiles.forEach(function (tile, i) {
                var near = state.tiles
                    .map(function (other, j) { return [j === i ? -2 : dot(tile, other), j]; })
                    .sort(function (a, b) { return b[0] - a[0]; })
                    .slice(0, 6)
                    .map(function (pair) { return state.assign[pair[1]]; });
                var pickIndex = -1;
                for (var k = 0; k < total; k++) {
                    var candidate = (i + k) % total;
                    if (near.indexOf(candidate) !== -1) continue;
                    if (pickIndex < 0 || usage[candidate] < usage[pickIndex]) pickIndex = candidate;
                }
                if (pickIndex < 0) pickIndex = i % total;
                state.assign[i] = pickIndex;
                usage[pickIndex] += 1;
            });
            var data = new Float32Array(settings.count * 4);
            state.tiles.forEach(function (tile, i) {
                data[i * 4] = tile[0];
                data[i * 4 + 1] = tile[1];
                data[i * 4 + 2] = tile[2];
                data[i * 4 + 3] = state.assign[i];
            });
            gl.bindBuffer(gl.ARRAY_BUFFER, tileBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            var first = -1;
            var firstZ = -2;
            state.tiles.forEach(function (tile, i) {
                var z = rotate(state.orientation, tile)[2];
                if (state.assign[i] === 0 && z > firstZ) {
                    firstZ = z;
                    first = i;
                }
            });
            state.target = first;
        }

        function uploadAtlas() {
            atlas.dirty = false;
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas.canvas);
            gl.generateMipmap(gl.TEXTURE_2D);
        }

        function loadItems(list) {
            items = Array.isArray(list) ? list : [];
            var request = ++atlas.request;
            var total = Math.max(1, items.length);
            atlas.cells = Math.ceil(Math.sqrt(total));
            atlas.cell = clamp(Math.floor(4096 / atlas.cells), 64, 512);
            atlas.canvas.width = atlas.cells * atlas.cell;
            atlas.canvas.height = atlas.cells * atlas.cell;
            var ctx = atlas.canvas.getContext('2d');
            if (ctx) ctx.clearRect(0, 0, atlas.canvas.width, atlas.canvas.height);
            uploadAtlas();
            state.count = 0;
            layout();
            var pending = items.length;
            if (!pending) state.started = true;
            items.forEach(function (item, index) {
                var image = new Image();
                image.crossOrigin = 'anonymous';
                image.decoding = 'async';
                var done = function () {
                    pending -= 1;
                    if (pending <= 0) state.started = true;
                    wake();
                };
                image.onload = function () {
                    if (!alive || request !== atlas.request || !ctx) return;
                    var size = atlas.cell;
                    var scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
                    var width = image.naturalWidth * scale;
                    var height = image.naturalHeight * scale;
                    var cx = (index % atlas.cells) * size;
                    var cy = Math.floor(index / atlas.cells) * size;
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(cx, cy, size, size);
                    ctx.clip();
                    ctx.drawImage(image, cx + (size - width) / 2, cy + (size - height) / 2, width, height);
                    ctx.restore();
                    atlas.dirty = true;
                    done();
                };
                image.onerror = function () {
                    if (!alive || request !== atlas.request) return;
                    done();
                };
                image.src = (item && item.image) || '';
            });
        }

        function tileRadius() {
            return 0.5 * RADIUS * Math.sqrt((4 * Math.PI) / Math.max(1, state.count)) * settings.tileSize;
        }

        function restDistance() {
            var aspect = state.width / state.height;
            var span = Math.tan(FOV / 2) * Math.min(1, aspect);
            return RADIUS + tileRadius() / (0.46 * settings.zoom * span);
        }

        function measure() {
            var rest = restDistance();
            var radius = (tileRadius() / ((rest - RADIUS) * Math.tan(FOV / 2))) * (state.height / 2);
            var rounded = Math.round(radius);
            if (rounded !== state.tilePx) {
                state.tilePx = rounded;
                root.style.setProperty('--infinite-menu-tile', rounded + 'px');
            }
            var mode = state.width / 2 - radius < 120 ? 'stacked' : 'side';
            if (mode !== state.layout) {
                state.layout = mode;
                infoEl.setAttribute('data-layout', mode);
            }
        }

        function nearest() {
            var best = 0;
            var bestZ = -2;
            for (var i = 0; i < state.tiles.length; i++) {
                var z = rotate(state.orientation, state.tiles[i])[2];
                if (z > bestZ) {
                    bestZ = z;
                    best = i;
                }
            }
            return best;
        }

        function neighbor(from, direction) {
            var origin = rotate(state.orientation, state.tiles[from]);
            var best = -1;
            var bestScore = Infinity;
            for (var i = 0; i < state.tiles.length; i++) {
                if (i === from) continue;
                var c = rotate(state.orientation, state.tiles[i]);
                if (c[2] < 0) continue;
                var dx = c[0] - origin[0];
                var dy = c[1] - origin[1];
                var length = Math.hypot(dx, dy);
                if (length < 0.0001) continue;
                var align = (dx * direction[0] + dy * direction[1]) / length;
                if (align < 0.55) continue;
                var score = length * (2.2 - align);
                if (score < bestScore) {
                    bestScore = score;
                    best = i;
                }
            }
            return best;
        }

        function goTo(index) {
            if (index < 0) return;
            state.target = index;
            state.speed = 0;
            state.idle = 0;
            wake();
        }

        function pick(clientX, clientY) {
            var rect = canvas.getBoundingClientRect();
            var aspect = rect.width / rect.height;
            var span = Math.tan(FOV / 2);
            var px = (((clientX - rect.left) / rect.width) * 2 - 1) * aspect;
            var py = 1 - ((clientY - rect.top) / rect.height) * 2 - state.shift;
            var radius = tileRadius();
            var best = -1;
            var bestDistance = Infinity;
            for (var i = 0; i < state.tiles.length; i++) {
                var c = rotate(state.orientation, state.tiles[i]);
                if (c[2] < 0.2) continue;
                var depth = state.camera - c[2] * RADIUS;
                var sx = (c[0] * RADIUS) / (depth * span);
                var sy = (c[1] * RADIUS) / (depth * span);
                var reach = (radius * (0.5 + 0.5 * c[2])) / (depth * span);
                var distance = Math.hypot(sx - px, sy - py);
                if (distance < reach && distance < bestDistance) {
                    bestDistance = distance;
                    best = i;
                }
            }
            return best;
        }

        function activate(index) {
            if (!items.length) return;
            var itemIndex = (state.assign[index] || 0) % items.length;
            var item = items[itemIndex];
            if (onItemClick) {
                onItemClick(item, itemIndex);
                return;
            }
            if (item && item.link) {
                // 图片链接：用内置查看器打开，避免跳走丢失球体状态
                if (/\.(jpe?g|png|webp|avif|gif)$/i.test(item.link)) {
                    openViewer(item.link);
                    return;
                }
                window.open(item.link, item.link.indexOf('http') === 0 ? '_blank' : '_self', 'noopener');
            }
        }

        // ---- 图片查看器 ----
        var viewer = null;

        function buildViewer() {
            var wrap = document.createElement('div');
            wrap.className = 'infinite-menu__viewer';
            wrap.setAttribute('role', 'dialog');
            wrap.setAttribute('aria-modal', 'true');
            wrap.setAttribute('aria-label', '图片预览');

            var img = document.createElement('img');
            img.className = 'infinite-menu__viewer-img';
            img.alt = '';

            var close = document.createElement('button');
            close.type = 'button';
            close.className = 'infinite-menu__viewer-close';
            close.setAttribute('aria-label', '关闭预览');
            close.innerHTML = '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">' +
                '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" ' +
                'stroke-linecap="round"/></svg>';

            wrap.appendChild(img);
            wrap.appendChild(close);
            root.appendChild(wrap);

            // 点击背景也能关闭（点图片本身不关）
            wrap.addEventListener('click', function (e) {
                if (e.target === wrap) closeViewer();
            });
            close.addEventListener('click', function (e) {
                e.stopPropagation();
                closeViewer();
            });
            return wrap;
        }

        function openViewer(src) {
            if (!viewer) viewer = buildViewer();
            var img = viewer.querySelector('.infinite-menu__viewer-img');
            img.src = src;
            viewer.classList.add('is-open');
            root.setAttribute('data-viewer', '');
            root.focus && root.focus({ preventScroll: true });
            wake();
        }

        function closeViewer() {
            if (!viewer) return;
            viewer.classList.remove('is-open');
            root.removeAttribute('data-viewer');
            // 清空 src 释放解码内存，稍后重置避免看到上一张
            var img = viewer.querySelector('.infinite-menu__viewer-img');
            if (img) {
                window.setTimeout(function () {
                    if (!viewer.classList.contains('is-open')) img.removeAttribute('src');
                }, 300);
            }
            wake();
        }

        function renderInfo(item) {
            var hasAction = Boolean(item && (item.link || onItemClick));
            titleEl.textContent = (item && item.title) || '';
            titleEl.style.display = item && item.title ? '' : 'none';
            descEl.textContent = (item && item.description) || '';
            descEl.style.display = item && item.description ? '' : 'none';
            actionEl.style.display = hasAction ? '' : 'none';
            if (item && item.link) {
                actionEl.setAttribute('href', item.link);
                if (item.link.indexOf('http') === 0) {
                    actionEl.setAttribute('target', '_blank');
                    actionEl.setAttribute('rel', 'noreferrer');
                } else {
                    actionEl.removeAttribute('target');
                    actionEl.removeAttribute('rel');
                }
            } else {
                actionEl.setAttribute('href', '#');
            }
            root.setAttribute('aria-label', (item && item.title) || 'Infinite menu');
        }

        function report() {
            var index = items.length ? (state.assign[state.front] || 0) % items.length : 0;
            if (!state.moving && index !== state.shown) {
                state.shown = index;
                renderInfo(items[index]);
                if (onActiveChange) onActiveChange(items[index], index);
            }
        }

        function frame(now) {
            raf = 0;
            if (!alive || !visible) return;
            var dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
            last = now;
            layout();
            if (atlas.dirty) uploadAtlas();
            if (state.started) state.reveal = Math.min(1, state.reveal + dt / (reduce ? 0.01 : 0.7));
            var minSide = Math.min(state.width, state.height);

            if (drag.active) {
                if (drag.dx || drag.dy) {
                    var length = Math.hypot(drag.dx, drag.dy);
                    var angle = (length / minSide) * 2.6;
                    var axis = normalize([drag.dy, drag.dx, 0]);
                    state.orientation = quatNormalize(quatMultiply(quatAxisAngle(axis, angle), state.orientation));
                    var blend = 1 - Math.exp(-dt * 30);
                    state.axis = normalize([
                        state.axis[0] + (axis[0] - state.axis[0]) * blend,
                        state.axis[1] + (axis[1] - state.axis[1]) * blend,
                        state.axis[2] + (axis[2] - state.axis[2]) * blend
                    ]);
                    state.speed += (angle / dt - state.speed) * blend;
                    drag.dx = 0;
                    drag.dy = 0;
                } else {
                    state.speed *= Math.exp(-dt * 14);
                }
            } else {
                if (state.speed > 0.0005) {
                    state.orientation = quatNormalize(
                        quatMultiply(quatAxisAngle(state.axis, state.speed * dt), state.orientation)
                    );
                    state.speed *= Math.exp(-dt * (6 - 5 * settings.inertia));
                } else {
                    state.speed = 0;
                }
                var goal = state.target >= 0 ? state.target : nearest();
                var current = rotate(state.orientation, state.tiles[goal]);
                var remaining = Math.acos(clamp(dot(current, FRONT), -1, 1));
                var pull = clamp(1 - state.speed / 1.4, 0, 1);
                if (remaining > 0.0002 && pull > 0) {
                    var turnAxis = cross(current, FRONT);
                    var step = remaining * (1 - Math.exp(-dt * (state.target >= 0 ? 6 : 8))) * pull;
                    if (Math.hypot(turnAxis[0], turnAxis[1], turnAxis[2]) > 1e-6) {
                        state.orientation = quatNormalize(
                            quatMultiply(quatAxisAngle(normalize(turnAxis), step), state.orientation)
                        );
                    }
                } else if (state.target >= 0 && state.speed === 0) {
                    state.target = -1;
                }
                state.front = goal;
            }

            var settledAngle = Math.acos(clamp(rotate(state.orientation, state.tiles[state.front])[2], -1, 1));
            var moving = drag.active || state.speed > 0.08 || settledAngle > 0.01;
            if (moving !== state.moving) {
                state.moving = moving;
                infoEl.setAttribute('data-moving', moving ? 'true' : 'false');
            }
            state.settle += ((moving ? 0 : 1) - state.settle) * (1 - Math.exp(-dt * (moving ? 10 : 3)));
            if (!moving) report();

            var rest = restDistance();
            var pullAmount = clamp(drag.active ? 1 : state.speed / 2.2, 0, 1);
            var cameraTarget = rest + settings.pullBack * pullAmount * RADIUS * 1.25 + (1 - state.reveal) * RADIUS * 1.5;
            if (!state.camera) state.camera = cameraTarget + RADIUS;
            state.camera += (cameraTarget - state.camera) * (1 - Math.exp(-dt * 4.5));

            if (settings.autoplay > 0 && !moving && !state.hovered && !state.focused && !reduce) {
                state.idle += dt;
                if (state.idle >= settings.autoplay) {
                    state.idle = 0;
                    goTo(neighbor(state.front, [1, 0]));
                }
            } else {
                state.idle = 0;
            }

            measure();
            var shiftTarget = state.layout === 'stacked' ? Math.min(0.3, 72 / state.height) : 0;
            state.shift += (shiftTarget - state.shift) * (1 - Math.exp(-dt * 6));
            render();

            var busy =
                moving ||
                Math.abs(cameraTarget - state.camera) > 0.001 ||
                Math.abs(shiftTarget - state.shift) > 0.0005 ||
                Math.abs((moving ? 0 : 1) - state.settle) > 0.002 ||
                state.reveal < 1 ||
                atlas.dirty ||
                !state.started;
            if (busy) {
                raf = window.requestAnimationFrame(frame);
            } else {
                last = 0;
                if (settings.autoplay > 0 && !state.hovered && !state.focused && !reduce) {
                    window.clearTimeout(timer);
                    timer = window.setTimeout(wake, Math.max(16, (settings.autoplay - state.idle) * 1000));
                }
            }
        }

        function render() {
            var aspect = state.width / state.height;
            var f = 1 / Math.tan(FOV / 2);
            var near = 0.05;
            var far = 50;
            var projection = new Float32Array([
                f / aspect, 0, 0, 0,
                0, f, 0, 0,
                0, 0, (far + near) / (near - far), -1,
                0, 0, (2 * far * near) / (near - far), 0
            ]);
            gl.viewport(0, 0, canvas.width, canvas.height);
            gl.clearColor(0, 0, 0, 0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
            gl.enable(gl.DEPTH_TEST);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
            gl.useProgram(program);
            gl.uniform4f(uniforms.uOrientation, state.orientation[0], state.orientation[1], state.orientation[2], state.orientation[3]);
            gl.uniformMatrix4fv(uniforms.uProjection, false, projection);
            gl.uniform1f(uniforms.uCamera, state.camera);
            gl.uniform1f(uniforms.uRadius, RADIUS);
            gl.uniform1f(uniforms.uTileRadius, tileRadius());
            gl.uniform4f(uniforms.uSpin, state.axis[0], state.axis[1], state.axis[2], reduce ? 0 : state.speed);
            gl.uniform1f(uniforms.uStretch, settings.stretch);
            gl.uniform1f(uniforms.uShift, state.shift);
            gl.uniform1f(uniforms.uCells, atlas.cells);
            gl.uniform1f(uniforms.uInset, 2 / atlas.cell);
            gl.uniform1f(uniforms.uRoundness, settings.roundness);
            gl.uniform1f(uniforms.uGrayscale, settings.grayscale ? 1 : 0);
            gl.uniform1f(uniforms.uDim, settings.dim * (0.45 + 0.55 * state.settle));
            gl.uniform1f(uniforms.uReveal, state.reveal);
            if (state.theme === 'light') {
                gl.uniform3f(uniforms.uPlaceholder, 0.9, 0.9, 0.91);
                gl.uniform3f(uniforms.uTone, 1, 1, 1);
            } else {
                gl.uniform3f(uniforms.uPlaceholder, 0.13, 0.12, 0.15);
                gl.uniform3f(uniforms.uTone, 0.04, 0.035, 0.05);
            }
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, atlasTexture);
            gl.bindVertexArray(vao);
            gl.drawElementsInstanced(gl.TRIANGLES, indices.length, gl.UNSIGNED_SHORT, 0, state.tiles.length);
            gl.bindVertexArray(null);
        }

        function wake() {
            window.clearTimeout(timer);
            if (raf || !alive || !visible) return;
            raf = window.requestAnimationFrame(frame);
        }

        function onPointerDown(event) {
            if (root.hasAttribute('data-viewer')) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
            drag.active = true;
            drag.id = event.pointerId;
            drag.x = event.clientX;
            drag.y = event.clientY;
            drag.dx = 0;
            drag.dy = 0;
            drag.moved = 0;
            drag.start = performance.now();
            state.target = -1;
            wake();
        }

        function onPointerMove(event) {
            if (!drag.active || event.pointerId !== drag.id) return;
            var dx = event.clientX - drag.x;
            var dy = event.clientY - drag.y;
            drag.x = event.clientX;
            drag.y = event.clientY;
            drag.dx += dx;
            drag.dy += dy;
            drag.moved += Math.hypot(dx, dy);
            wake();
        }

        function onPointerUp(event) {
            if (!drag.active || event.pointerId !== drag.id) return;
            drag.active = false;
            if (canvas.releasePointerCapture) canvas.releasePointerCapture(event.pointerId);
            /*
             * 点击画布不再打开图片：只有下方操作按钮能打开。
             * 因为「点击瓦片」与「拖动旋转」在机制上无法可靠区分——
             * 用户想转球体时手一抖就会被判定为点击并弹出大图。
             * 这里只保留「点未居中的瓦片让它转到正面」这一导航行为。
             */
            if (drag.moved < 6 && performance.now() - drag.start < 450) {
                var index = pick(event.clientX, event.clientY);
                if (index >= 0 && index !== state.front) goTo(index);
            }
            wake();
        }

        function onKeyDown(event) {
            var directions = {
                ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]
            };
            // 查看器打开时：Esc 关闭，不再响应方向键
            if (root.hasAttribute('data-viewer')) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    closeViewer();
                }
                return;
            }
            if (directions[event.key]) {
                event.preventDefault();
                goTo(neighbor(state.target >= 0 ? state.target : state.front, directions[event.key]));
            } else if (event.key === 'Enter' && event.target === root) {
                event.preventDefault();
                activate(state.front);
            }
        }

        function onEnter() { state.hovered = true; }
        function onLeave() { state.hovered = false; wake(); }
        function onFocusIn() { state.focused = true; }
        function onFocusOut(event) {
            if (root.contains(event.relatedTarget)) return;
            state.focused = false;
            wake();
        }

        function resize() {
            var dpr = Math.min(window.devicePixelRatio || 1, 2);
            state.width = Math.max(1, root.clientWidth);
            state.height = Math.max(1, root.clientHeight);
            canvas.width = Math.round(state.width * dpr);
            canvas.height = Math.round(state.height * dpr);
            if (!raf) render();
            wake();
        }

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        root.addEventListener('keydown', onKeyDown);
        root.addEventListener('pointerenter', onEnter);
        root.addEventListener('pointerleave', onLeave);
        root.addEventListener('focusin', onFocusIn);
        root.addEventListener('focusout', onFocusOut);
        var resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(root);
        var visibility;
        if (window.IntersectionObserver) {
            visibility = new IntersectionObserver(function (entries) {
                visible = entries.some(function (entry) { return entry.isIntersecting; });
                if (visible) {
                    last = 0;
                    wake();
                }
            });
            visibility.observe(root);
        }
        infoEl.setAttribute('data-moving', 'true');
        infoEl.setAttribute('data-layout', 'side');
        applyTheme();
        // 跟随站点主题开关：切换 html.dark 时重算文字与占位色
        if (window.MutationObserver) {
            var themeObserver = new MutationObserver(function () {
                applyTheme();
                wake();
            });
            themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
        }
        layout();
        resize();
        loadItems(items);

        return {
            loadItems: loadItems,
            wake: wake,
            destroy: function () {
                alive = false;
                window.cancelAnimationFrame(raf);
                window.clearTimeout(timer);
                canvas.removeEventListener('pointerdown', onPointerDown);
                canvas.removeEventListener('pointermove', onPointerMove);
                canvas.removeEventListener('pointerup', onPointerUp);
                canvas.removeEventListener('pointercancel', onPointerUp);
                root.removeEventListener('keydown', onKeyDown);
                root.removeEventListener('pointerenter', onEnter);
                root.removeEventListener('pointerleave', onLeave);
                root.removeEventListener('focusin', onFocusIn);
                root.removeEventListener('focusout', onFocusOut);
                resizeObserver.disconnect();
                if (visibility) visibility.disconnect();
                gl.deleteTexture(atlasTexture);
                gl.deleteBuffer(cornerBuffer);
                gl.deleteBuffer(indexBuffer);
                gl.deleteBuffer(tileBuffer);
                gl.deleteVertexArray(vao);
                gl.deleteProgram(program);
                gl.deleteShader(vertex);
                gl.deleteShader(fragment);
            }
        };
    }

    InfiniteMenu.autoInit = function () {
        var nodes = document.querySelectorAll('[data-infinite-menu]');
        Array.prototype.forEach.call(nodes, function (node) {
            if (node.__infiniteMenu) return;
            var raw = node.getAttribute('data-items');
            var items = [];
            if (raw) {
                try {
                    items = JSON.parse(raw);
                } catch (error) {
                    if (window.console) console.warn('[InfiniteMenu] data-items 不是合法 JSON', error);
                }
            }
            var dataset = node.dataset || {};
            node.__infiniteMenu = new InfiniteMenu(node, {
                items: items,
                count: dataset.count ? Number(dataset.count) : undefined,
                tileSize: dataset.tileSize ? Number(dataset.tileSize) : undefined,
                roundness: dataset.roundness ? Number(dataset.roundness) : undefined,
                zoom: dataset.zoom ? Number(dataset.zoom) : undefined,
                autoplay: dataset.autoplay ? Number(dataset.autoplay) : undefined,
                grayscale: dataset.grayscale !== 'false',
                dim: dataset.dim ? Number(dataset.dim) : undefined,
                theme: dataset.theme || 'auto'
            });
        });
    };

    global.InfiniteMenu = InfiniteMenu;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', InfiniteMenu.autoInit);
    } else {
        InfiniteMenu.autoInit();
    }
})(window);
