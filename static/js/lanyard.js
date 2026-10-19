/*
 * Lanyard —— React Bits 同名组件的原生 JS 移植版
 * 原组件：https://reactbits.dev/components/lanyard
 *
 * 依赖 three.js（自托管于 static/js/vendor/three.min.js，654 KB）。
 *
 * 与 React 版的差异：
 *   · 原版用 three.module + 自定义 onBeforeCompile 全息箔着色器。
 *     UMD 构建（r160）不支持部分新常量（NeutralToneMapping），
 *     这里统一用 ACESFilmicToneMapping，观感接近且稳定。
 *   · 全息箔（holographic）的实现保留，但降级为基于环境反射的近似，
 *     避免整段 shader 注入在小屏幕上反而更慢。
 *   · 卡面与挂绳用 Canvas 直接绘制（本组件不接收外部图片时用色块+文字）。
 *
 * 物理、挂绳链条、拖拽甩动、翻转、微风等核心逻辑与原版等价。
 *
 * 用法：
 *   <div class="lanyard-host">
 *     <div data-lanyard data-front-text="邓尚青" data-front-sub="体验设计师"></div>
 *   </div>
 */
(function (global) {
    'use strict';

    var THREE_URL = '/js/vendor/three.min.js';

    var CARD_SIZES = { portrait: [1.6, 2.25], landscape: [2.25, 1.6] };
    var ANCHORS = { left: 0.27, center: 0.5, right: 0.73 };
    var THICKNESS = 0.018;
    var BEVEL = 0.007;
    var JOINTS = 4;
    var NODE_WEIGHT = 1 / 0.05;
    var MAX_STEP = 1 / 960;
    var ITERATIONS = 2;
    var SAMPLES = 72;
    var FOV = 24;
    var STRAP_WIDTH = 0.36;
    var RING_RADIUS = 0.095;
    var RING_TUBE = 0.0135;
    var EYELET_RADIUS = 0.036;
    var CLAMP_BODY = 0.15;
    var FACE_WIDTH = 1024;
    var FLIP_SPIN = 9;

    var BAND_COLUMNS = [0, 0.07, 0.93, 1];
    var BAND_BEND = [-0.95, -0.28, 0.28, 0.95];

    var FINISHES = {
        glossy: { roughness: 0.42, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 },
        matte: { roughness: 0.85, metalness: 0, clearcoat: 0, clearcoatRoughness: 0.6 },
        holographic: { roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05 },
        metallic: { roughness: 0.36, metalness: 0.75, clearcoat: 0.5, clearcoatRoughness: 0.18 }
    };

    var METALS = {
        silver: { color: '#d9dce2', roughness: 0.16 },
        gold: { color: '#e4b965', roughness: 0.2 },
        graphite: { color: '#4d4f55', roughness: 0.28 }
    };

    function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
    function mix(a, b, t) { return a + (b - a) * t; }

    var threePromise = null;
    function loadThree(url) {
        if (global.THREE) return Promise.resolve(global.THREE);
        if (threePromise) return threePromise;
        threePromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = url || THREE_URL;
            s.async = true;
            s.onload = function () {
                if (global.THREE) resolve(global.THREE);
                else reject(new Error('[Lanyard] three.js 未挂载'));
            };
            s.onerror = function () { reject(new Error('[Lanyard] three.js 加载失败')); };
            document.head.appendChild(s);
        });
        return threePromise;
    }

    function seeded(start) {
        var state = start >>> 0;
        return function () {
            state = (state + 0x6d2b79f5) >>> 0;
            var t = state;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function traceRoundedRect(path, x, y, width, height, radius) {
        var r = Math.max(0, Math.min(radius, width / 2, height / 2));
        var k = r * 0.4477;
        path.moveTo(x + r, y);
        path.lineTo(x + width - r, y);
        path.bezierCurveTo(x + width - k, y, x + width, y + k, x + width, y + r);
        path.lineTo(x + width, y + height - r);
        path.bezierCurveTo(x + width, y + height - k, x + width - k, y + height, x + width - r, y + height);
        path.lineTo(x + r, y + height);
        path.bezierCurveTo(x + k, y + height, x, y + height - k, x, y + height - r);
        path.lineTo(x, y + r);
        path.bezierCurveTo(x, y + k, x + k, y, x + r, y);
    }

    function cardLayout(orientation, cornerRadius) {
        var size = CARD_SIZES[orientation] || CARD_SIZES.portrait;
        var width = size[0], height = size[1];
        var radius = mix(0.03, Math.min(width, height) * 0.2, clamp(cornerRadius, 0, 1));
        var slot = { width: 0.34, height: 0.07, y: height / 2 - 0.13 };
        var ringY = height / 2 - 0.055;
        return { width: width, height: height, radius: radius, slot: slot, ringY: ringY, hangY: ringY + RING_RADIUS };
    }

    function Lanyard(root, options) {
        var opts = options || {};
        var settings = {
            frontImage: opts.frontImage || null,
            backImage: opts.backImage || null,
            strapLogo: opts.strapLogo || null,
            imageFit: opts.imageFit === 'contain' ? 'contain' : 'cover',
            cardColor: opts.cardColor || '#ffffff',
            orientation: opts.orientation === 'landscape' ? 'landscape' : 'portrait',
            finish: opts.finish || 'glossy',
            cornerRadius: opts.cornerRadius == null ? 0.3 : opts.cornerRadius,
            size: opts.size == null ? 0.6 : opts.size,
            anchor: opts.anchor || 'center',
            strapLength: opts.strapLength == null ? 0.5 : opts.strapLength,
            strapColor: opts.strapColor || '#111111',
            strapWidth: opts.strapWidth == null ? 0.65 : opts.strapWidth,
            metal: opts.metal || 'silver',
            gravity: opts.gravity == null ? 1 : opts.gravity,
            damping: opts.damping == null ? 0.5 : opts.damping,
            elasticity: opts.elasticity == null ? 0.5 : opts.elasticity,
            breeze: opts.breeze == null ? 0.5 : opts.breeze,
            interactive: opts.interactive !== false,
            intro: opts.intro !== false,
            theme: opts.theme || 'auto',
            matterUrl: opts.threeUrl || null,
            // 卡面文字（未提供图片时直接用文字绘制工卡）
            frontText: opts.frontText || '',
            frontSub: opts.frontSub || '',
            backText: opts.backText || '',
            backSub: opts.backSub || ''
        };

        var alive = true;
        var raf = 0;
        var api = { destroy: function () {} };

        loadThree(settings.matterUrl).then(function (THREE) {
            if (!alive) return;
            init(THREE);
        }).catch(function (err) {
            if (global.console) console.warn(err.message);
            root.setAttribute('data-three', 'unsupported');
        });

        function resolveThemeColors() {
            var dark = document.documentElement.classList.contains('dark');
            if (settings.theme === 'light') dark = false;
            if (settings.theme === 'dark') dark = true;
            return dark
                ? { card: '#1c1c20', ink: '#f4f4f5', sub: '#a1a1aa', strap: settings.strapColor }
                : { card: '#ffffff', ink: '#18181b', sub: '#71717a', strap: settings.strapColor };
        }

        function init(THREE) {
            var renderer;
            try {
                renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
            } catch (e) {
                root.setAttribute('data-three', 'unsupported');
                return;
            }
            renderer.setClearColor(0x000000, 0);
            renderer.outputColorSpace = THREE.SRGBColorSpace;
            // r160 UMD 没有 NeutralToneMapping，用 ACES 近似
            renderer.toneMapping = THREE.ACESFilmicToneMapping;
            renderer.toneMappingExposure = 1.1;

            var canvas = renderer.domElement;
            canvas.className = 'lanyard-canvas';
            canvas.setAttribute('aria-hidden', 'true');
            root.classList.add('lanyard');
            root.appendChild(canvas);

            var anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            var scene = new THREE.Scene();
            var camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);
            var keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
            keyLight.position.set(-2.5, 4, 6);
            var fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
            fillLight.position.set(3, -1, 4);
            var ambient = new THREE.AmbientLight(0xffffff, 0.65);
            scene.add(keyLight, fillLight, ambient);

            /* ---- 卡面绘制 ---- */
            var frontCanvas = document.createElement('canvas');
            var backCanvas = document.createElement('canvas');
            var strapCanvas = document.createElement('canvas');
            var frontTexture = new THREE.CanvasTexture(frontCanvas);
            frontTexture.colorSpace = THREE.SRGBColorSpace;
            frontTexture.anisotropy = anisotropy;
            var backTexture = new THREE.CanvasTexture(backCanvas);
            backTexture.colorSpace = THREE.SRGBColorSpace;
            backTexture.anisotropy = anisotropy;
            var strapTexture = new THREE.CanvasTexture(strapCanvas);
            strapTexture.colorSpace = THREE.SRGBColorSpace;
            strapTexture.anisotropy = anisotropy;
            strapTexture.wrapS = THREE.ClampToEdgeWrapping;
            strapTexture.wrapT = THREE.RepeatWrapping;

            var layout = cardLayout(settings.orientation, settings.cornerRadius);
            var colors = resolveThemeColors();

            function paintCard(canvas, title, sub, bg, ink, subInk, top) {
                var w = FACE_WIDTH;
                var h = Math.round((FACE_WIDTH * layout.height) / layout.width);
                canvas.width = w;
                canvas.height = h;
                var ctx = canvas.getContext('2d');
                if (!ctx) return;
                ctx.fillStyle = bg;
                ctx.fillRect(0, 0, w, h);
                // 顶部一条品牌色带
                if (top) {
                    ctx.fillStyle = top;
                    ctx.fillRect(0, 0, w, Math.round(h * 0.055));
                }
                // 头像圆位
                ctx.beginPath();
                ctx.arc(w * 0.5, h * 0.38, w * 0.13, 0, Math.PI * 2);
                ctx.fillStyle = ink + '22';
                ctx.fill();
                ctx.lineWidth = 3;
                ctx.strokeStyle = ink + '55';
                ctx.stroke();
                // 文字
                ctx.textAlign = 'center';
                ctx.fillStyle = ink;
                ctx.font = '600 ' + Math.round(w * 0.085) + 'px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
                ctx.fillText(title || '', w * 0.5, h * 0.63);
                if (sub) {
                    ctx.fillStyle = subInk;
                    ctx.font = '400 ' + Math.round(w * 0.045) + 'px system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';
                    ctx.fillText(sub, w * 0.5, h * 0.72);
                }
                // 底部细线
                ctx.strokeStyle = ink + '22';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(w * 0.2, h * 0.82);
                ctx.lineTo(w * 0.8, h * 0.82);
                ctx.stroke();
            }

            // 正面照片 / 挂绳 logo 异步加载，加载完成后重绘对应纹理
            var frontImg = new Image();
            var strapImg = new Image();

            function coverDraw(ctx, img, w, h) {
                var scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
                var dw = img.naturalWidth * scale, dh = img.naturalHeight * scale;
                ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
            }

            function paintFront() {
                var w = FACE_WIDTH;
                var h = Math.round((FACE_WIDTH * layout.height) / layout.width);
                var ctx = frontCanvas.getContext('2d');
                if (!ctx) return;
                if (frontImg.complete && frontImg.naturalWidth) {
                    frontCanvas.width = w;
                    frontCanvas.height = h;
                    ctx.fillStyle = colors.card;
                    ctx.fillRect(0, 0, w, h);
                    coverDraw(ctx, frontImg, w, h);
                } else {
                    paintCard(frontCanvas, settings.frontText, settings.frontSub, colors.card, colors.ink, colors.sub, '#3f3f46');
                }
                frontTexture.needsUpdate = true;
            }

            function paintStrap() {
                var sw = 192, sh = 384;
                strapCanvas.width = sw;
                strapCanvas.height = sh;
                var sctx = strapCanvas.getContext('2d');
                if (!sctx) return;
                sctx.fillStyle = settings.strapColor;
                sctx.fillRect(0, 0, sw, sh);
                if (strapImg.complete && strapImg.naturalWidth) {
                    var iw = sw * 0.52;
                    var ih = iw * strapImg.naturalHeight / strapImg.naturalWidth;
                    var gap = Math.round(ih * 2.4);
                    for (var y = 0; y < sh; y += gap) {
                        sctx.globalAlpha = 0.92;
                        sctx.drawImage(strapImg, (sw - iw) / 2, y, iw, ih);
                    }
                    sctx.globalAlpha = 1;
                } else {
                    sctx.fillStyle = 'rgba(255,255,255,0.05)';
                    for (var y = 0; y < sh; y += 4) sctx.fillRect(0, y, sw, 1);
                    sctx.fillStyle = 'rgba(255,255,255,0.18)';
                    for (var y2 = 0; y2 < sh; y2 += 14) {
                        sctx.fillRect(sw * 0.07, y2, 2, 8);
                        sctx.fillRect(sw * 0.93 - 2, y2, 2, 8);
                    }
                }
                strapTexture.needsUpdate = true;
            }

            function paintAll() {
                colors = resolveThemeColors();
                paintFront();
                paintCard(backCanvas, settings.backText || settings.frontText, settings.backSub, colors.card, colors.ink, colors.sub, '#3f3f46');
                backTexture.needsUpdate = true;
                paintStrap();
            }
            paintAll();

            if (settings.frontImage) {
                frontImg.onload = paintFront;
                frontImg.src = settings.frontImage;
            }
            if (settings.strapLogo) {
                strapImg.onload = paintStrap;
                strapImg.src = settings.strapLogo;
            }

            /* ---- 材质 ---- */
            var finish = FINISHES[settings.finish] || FINISHES.glossy;
            var frontMaterial = new THREE.MeshPhysicalMaterial({
                map: frontTexture, roughness: finish.roughness, metalness: finish.metalness,
                clearcoat: finish.clearcoat, clearcoatRoughness: finish.clearcoatRoughness
            });
            var backMaterial = new THREE.MeshPhysicalMaterial({
                map: backTexture, roughness: finish.roughness, metalness: finish.metalness,
                clearcoat: finish.clearcoat, clearcoatRoughness: finish.clearcoatRoughness
            });
            var edgeMaterial = new THREE.MeshPhysicalMaterial({
                color: new THREE.Color(colors.card), roughness: Math.min(finish.roughness, 0.35),
                metalness: finish.metalness, clearcoat: 1, clearcoatRoughness: 0.08
            });
            var metalLook = METALS[settings.metal] || METALS.silver;
            var metalMaterial = new THREE.MeshStandardMaterial({
                color: new THREE.Color(metalLook.color), metalness: 1, roughness: metalLook.roughness
            });
            var bandMaterial = new THREE.MeshPhysicalMaterial({
                map: strapTexture, roughness: 0.68, sheen: 1, sheenRoughness: 0.42,
                sheenColor: new THREE.Color(0.32, 0.32, 0.34), side: THREE.DoubleSide
            });

            /* ---- 几何 ---- */
            function buildCardGeometry() {
                var outline = new THREE.Shape();
                traceRoundedRect(outline, -layout.width / 2 + BEVEL, -layout.height / 2 + BEVEL,
                    layout.width - BEVEL * 2, layout.height - BEVEL * 2, Math.max(layout.radius - BEVEL, 0.005));
                var hole = new THREE.Path();
                var slot = layout.slot;
                traceRoundedRect(hole, -slot.width / 2 - BEVEL, slot.y - slot.height / 2 - BEVEL,
                    slot.width + BEVEL * 2, slot.height + BEVEL * 2, slot.height / 2 + BEVEL);
                outline.holes.push(hole);
                var body = new THREE.ExtrudeGeometry(outline, {
                    depth: THICKNESS, bevelEnabled: true, bevelThickness: BEVEL, bevelSize: BEVEL,
                    bevelSegments: 5, curveSegments: 24
                });
                body.translate(0, 0, -THICKNESS / 2);
                var face = new THREE.ShapeGeometry(outline, 24);
                var position = face.getAttribute('position');
                var uv = face.getAttribute('uv');
                for (var i = 0; i < position.count; i++) {
                    uv.setXY(i, (position.getX(i) + layout.width / 2) / layout.width,
                        (position.getY(i) + layout.height / 2) / layout.height);
                }
                uv.needsUpdate = true;
                return { body: body, face: face };
            }

            function buildClampGeometry(width) {
                var shape = new THREE.Shape();
                var w = width * 1.16;
                traceRoundedRect(shape, -w / 2 + 0.014, -CLAMP_BODY / 2 + 0.014, w - 0.028, CLAMP_BODY - 0.028, 0.024);
                var g = new THREE.ExtrudeGeometry(shape, {
                    depth: 0.02, bevelEnabled: true, bevelThickness: 0.014, bevelSize: 0.014,
                    bevelSegments: 6, curveSegments: 10
                });
                g.translate(0, 0, -0.01);
                return g;
            }

            function buildBandGeometry(count) {
                var columns = BAND_COLUMNS.length;
                var g = new THREE.BufferGeometry();
                g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * columns * 3), 3));
                g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(count * columns * 3), 3));
                g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * columns * 2), 2));
                var index = [];
                for (var i = 0; i < count - 1; i++) {
                    for (var c = 0; c < columns - 1; c++) {
                        var a = i * columns + c;
                        index.push(a, a + columns, a + 1, a + 1, a + columns, a + columns + 1);
                    }
                }
                g.setIndex(index);
                return g;
            }

            var geo = buildCardGeometry();
            var cardGroup = new THREE.Group();
            var bodyMesh = new THREE.Mesh(geo.body, edgeMaterial);
            var frontMesh = new THREE.Mesh(geo.face, frontMaterial);
            var backMesh = new THREE.Mesh(geo.face.clone(), backMaterial);
            frontMesh.position.z = THICKNESS / 2 + BEVEL + 0.0006;
            backMesh.rotation.y = Math.PI;
            backMesh.position.z = -(THICKNESS / 2 + BEVEL + 0.0006);
            var ring = new THREE.Mesh(new THREE.TorusGeometry(RING_RADIUS, RING_TUBE, 18, 72), metalMaterial);
            ring.position.set(0, layout.ringY, 0);
            ring.rotation.y = Math.PI / 2 - 0.7;
            cardGroup.add(bodyMesh, frontMesh, backMesh, ring);
            scene.add(cardGroup);

            var bandGeometry = buildBandGeometry(SAMPLES);
            var band = new THREE.Mesh(bandGeometry, bandMaterial);
            band.frustumCulled = false;
            scene.add(band);

            var clampGroup = new THREE.Group();
            var strapScale = STRAP_WIDTH * clamp(settings.strapWidth, 0.4, 2);
            var clampMesh = new THREE.Mesh(buildClampGeometry(strapScale), metalMaterial);
            clampMesh.position.y = EYELET_RADIUS + CLAMP_BODY / 2 - 0.004;
            var eyelet = new THREE.Mesh(new THREE.TorusGeometry(EYELET_RADIUS, 0.0105, 14, 40), metalMaterial);
            clampGroup.add(clampMesh, eyelet);
            scene.add(clampGroup);

            /* ---- 物理 ---- */
            var sim = {
                nodes: [], previous: [], velocities: [],
                lengths: new Float64Array(JOINTS),
                impulses: new Float64Array(JOINTS),
                rest: 1,
                anchor: new THREE.Vector3(),
                body: {
                    position: new THREE.Vector3(), previous: new THREE.Vector3(),
                    velocity: new THREE.Vector3(),
                    quaternion: new THREE.Quaternion(), previousQuaternion: new THREE.Quaternion(),
                    angular: new THREE.Vector3(),
                    mass: 1,
                    inverseInertia: new THREE.Vector3(1, 1, 1),
                    hang: new THREE.Vector3()
                },
                grab: null, turn: 0, twist: 0, twistRaw: 0, calm: 0
            };
            for (var ni = 0; ni <= JOINTS; ni++) {
                sim.nodes.push(new THREE.Vector3());
                sim.previous.push(new THREE.Vector3());
                sim.velocities.push(new THREE.Vector3());
            }

            var scratch = {
                a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(),
                d: new THREE.Vector3(), e: new THREE.Vector3(), f: new THREE.Vector3(),
                g: new THREE.Vector3(), pin: new THREE.Vector3(),
                q: new THREE.Quaternion(), r: new THREE.Quaternion()
            };

            function applyInverseInertia(body, vector, out) {
                scratch.r.copy(body.quaternion).invert();
                out.copy(vector).applyQuaternion(scratch.r);
                out.set(out.x * body.inverseInertia.x, out.y * body.inverseInertia.y, out.z * body.inverseInertia.z);
                return out.applyQuaternion(body.quaternion);
            }

            function rotateBody(q, w) {
                var qx = q.x, qy = q.y, qz = q.z, qw = q.w;
                q.x += 0.5 * (w.x * qw + w.y * qz - w.z * qy);
                q.y += 0.5 * (w.y * qw + w.z * qx - w.x * qz);
                q.z += 0.5 * (w.z * qw + w.x * qy - w.y * qx);
                q.w += 0.5 * (-w.x * qx - w.y * qy - w.z * qz);
                q.normalize();
            }

            function bodyWeight(body, r, normal) {
                var rn = scratch.c.crossVectors(r, normal);
                return 1 / body.mass + rn.dot(applyInverseInertia(body, rn, scratch.d));
            }

            function pushBody(body, r, impulse) {
                body.position.addScaledVector(impulse, 1 / body.mass);
                rotateBody(body.quaternion, applyInverseInertia(body, scratch.e.crossVectors(r, impulse), scratch.f));
            }

            function solveSegment(i, h, physics) {
                var nodes = sim.nodes, body = sim.body;
                var a = nodes[i];
                var wa = i === 0 ? 0 : NODE_WEIGHT;
                var last = i === JOINTS - 1;
                var r = scratch.g;
                var b = nodes[i + 1];
                if (last) {
                    r.copy(body.hang).applyQuaternion(body.quaternion);
                    b = scratch.b.copy(body.position).add(r);
                }
                var delta = scratch.a.subVectors(b, a);
                var length = delta.length();
                var stretch = length - sim.rest;
                if (stretch <= 0 || length < 1e-9) return;
                var normal = delta.divideScalar(length);
                var wb = last ? bodyWeight(body, r, normal) : NODE_WEIGHT;
                var rate = (length - sim.lengths[i]) / h;
                var tension = physics.hold * Math.tanh((physics.stiffness * stretch) / physics.hold) +
                    physics.spring * stretch + physics.bandDamping * Math.max(0, rate);
                var room = tension * h * h - sim.impulses[i];
                if (room <= 0) return;
                var lambda = Math.min(stretch / (wa + wb), room);
                sim.impulses[i] += lambda;
                if (wa) a.addScaledVector(normal, lambda * wa);
                if (last) pushBody(body, r, normal.multiplyScalar(-lambda));
                else b.addScaledVector(normal, -lambda * wb);
            }

            function solvePin(body, grab, target) {
                var r = scratch.g.copy(grab.local).applyQuaternion(body.quaternion);
                var delta = scratch.a.copy(target).sub(body.position).sub(r);
                var distance = delta.length();
                if (distance < 1e-9) return;
                var normal = delta.divideScalar(distance);
                var lambda = distance / bodyWeight(body, r, normal);
                pushBody(body, r, normal.multiplyScalar(lambda));
            }

            function placeHanging(intro) {
                var nodes = sim.nodes, previous = sim.previous, velocities = sim.velocities;
                var body = sim.body;
                nodes[0].copy(sim.anchor);
                for (var i = 1; i <= JOINTS; i++) {
                    nodes[i].copy(nodes[i - 1]);
                    if (intro) nodes[i].x += sim.rest;
                    else nodes[i].y -= sim.rest;
                }
                body.quaternion.identity();
                if (intro) body.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
                body.hang.set(0, layout.hangY, 0);
                var offset = scratch.a.copy(body.hang).applyQuaternion(body.quaternion);
                body.position.copy(nodes[JOINTS]).sub(offset);
                body.previous.copy(body.position);
                body.previousQuaternion.copy(body.quaternion);
                body.velocity.set(0, 0, 0);
                body.angular.set(0, 0, 0);
                for (var j = 0; j <= JOINTS; j++) {
                    previous[j].copy(nodes[j]);
                    velocities[j].set(0, 0, 0);
                }
                sim.lengths.fill(sim.rest);
                sim.turn = 0; sim.twist = 0; sim.twistRaw = 0; sim.calm = 0;
            }

            function configureSimulation(length) {
                sim.rest = length / JOINTS;
                var body = sim.body;
                var t = THICKNESS + BEVEL * 2;
                body.mass = 1;
                body.inverseInertia.set(
                    12 / (layout.height * layout.height + t * t),
                    12 / (layout.width * layout.width + t * t),
                    12 / (layout.width * layout.width + layout.height * layout.height)
                );
                body.hang.set(0, layout.hangY, 0);
            }

            function physics() {
                var gravity = 40 * clamp(settings.gravity, 0, 3);
                var weight = Math.max(gravity, 20);
                var springy = clamp(settings.elasticity, 0, 1);
                var settle = clamp(settings.damping, 0, 1);
                return {
                    gravity: gravity,
                    hold: weight * mix(2.2, 5.5, springy),
                    stiffness: weight * 10 * JOINTS,
                    spring: weight * mix(0.1, 0.4, springy) * JOINTS,
                    bandDamping: weight * mix(0.3, 0.08, springy) * JOINTS,
                    linearDrag: 0.25 * Math.pow(16, settle),
                    angularDrag: 0.5 * Math.pow(12, settle),
                    air: 0.15, broadside: 0.5, spinAir: 0.03,
                    nodeDrag: 2, nodeAir: 0.2,
                    twist: 30, twistDamping: 3, grip: 40, gripDamping: 6,
                    breeze: reducedMotion ? 0 : clamp(settings.breeze, 0, 1)
                };
            }

            var reducedMotion = global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches;

            function stepSimulation(dt, ph, time) {
                var steps = Math.max(1, Math.ceil(dt / MAX_STEP - 1e-6));
                var h = dt / steps;
                var nodes = sim.nodes, previous = sim.previous, velocities = sim.velocities, body = sim.body;
                var windX = ph.breeze * (Math.sin(time * 0.53) * 0.7 + Math.sin(time * 1.31 + 1.7) * 0.3) * 3;
                var windZ = ph.breeze * Math.sin(time * 0.37 + 0.6) * 2;
                var grab = sim.grab;
                var pin = scratch.pin;
                var nodeDrag = Math.exp(-ph.nodeDrag * h);
                var linearDrag = Math.exp(-ph.linearDrag * h);
                var angularDrag = Math.exp(-ph.angularDrag * h);

                for (var s = 0; s < steps; s++) {
                    for (var i = 1; i < JOINTS; i++) {
                        var v = velocities[i];
                        v.y -= ph.gravity * h;
                        v.x += windX * h;
                        v.z += windZ * h;
                        previous[i].copy(nodes[i]);
                        nodes[i].addScaledVector(v, h);
                    }
                    body.previous.copy(body.position);
                    body.previousQuaternion.copy(body.quaternion);
                    if (grab) {
                        var turnQ = scratch.q.copy(grab.rotation).multiply(scratch.r.copy(body.quaternion).invert());
                        if (turnQ.w < 0) turnQ.set(-turnQ.x, -turnQ.y, -turnQ.z, -turnQ.w);
                        var torque = scratch.a.set(turnQ.x, turnQ.y, turnQ.z).multiplyScalar(2 * ph.grip);
                        torque.addScaledVector(body.angular, -ph.gripDamping);
                        body.angular.addScaledVector(applyInverseInertia(body, torque, scratch.b), h);
                    }
                    var up = scratch.a.set(0, 1, 0).applyQuaternion(body.quaternion);
                    var front = scratch.b.set(-up.x * up.z, -up.y * up.z, 1 - up.z * up.z);
                    if (front.lengthSq() > 1e-3) {
                        var facing = scratch.d.set(0, 0, 1).applyQuaternion(body.quaternion);
                        var raw = Math.atan2(scratch.e.crossVectors(front, facing).dot(up), front.dot(facing));
                        var turned = raw - sim.twistRaw;
                        if (turned > Math.PI) turned -= Math.PI * 2;
                        else if (turned < -Math.PI) turned += Math.PI * 2;
                        sim.twist += turned;
                        sim.twistRaw = raw;
                    }
                    if (!grab) {
                        var spin = body.angular.dot(up);
                        body.angular.addScaledVector(up, (ph.twist * (sim.turn - sim.twist) - ph.twistDamping * spin) * h);
                    }
                    body.velocity.y -= ph.gravity * h;
                    body.velocity.x += windX * 0.35 * h;
                    body.velocity.z += windZ * 0.35 * h;
                    body.position.addScaledVector(body.velocity, h);
                    rotateBody(body.quaternion, scratch.f.copy(body.angular).multiplyScalar(h));

                    sim.impulses.fill(0);
                    if (grab) pin.lerpVectors(grab.from, grab.target, (s + 1) / steps);
                    for (var iteration = 0; iteration < ITERATIONS; iteration++) {
                        for (var k = 0; k < JOINTS; k++) solveSegment(k, h, ph);
                        if (grab) solvePin(body, grab, pin);
                    }

                    for (var m = 1; m < JOINTS; m++) {
                        var vv = velocities[m].subVectors(nodes[m], previous[m]).divideScalar(h).multiplyScalar(nodeDrag);
                        vv.multiplyScalar(1 / (1 + ph.nodeAir * vv.length() * h));
                    }
                    body.velocity.subVectors(body.position, body.previous).divideScalar(h);
                    var dq = scratch.q.copy(body.previousQuaternion).invert().premultiply(body.quaternion);
                    body.angular.set(dq.x, dq.y, dq.z).multiplyScalar((2 / h) * (dq.w < 0 ? -1 : 1));

                    var normal = scratch.a.set(0, 0, 1).applyQuaternion(body.quaternion);
                    var across = body.velocity.dot(normal);
                    var along = scratch.b.copy(body.velocity).addScaledVector(normal, -across);
                    along.multiplyScalar(1 / (1 + ph.air * along.length() * h));
                    body.velocity.copy(along)
                        .addScaledVector(normal, across / (1 + ph.broadside * Math.abs(across) * h))
                        .multiplyScalar(linearDrag);
                    body.angular.multiplyScalar(angularDrag / (1 + ph.spinAir * body.angular.length() * h));
                    if (body.velocity.lengthSq() > 3600) body.velocity.setLength(60);
                    if (body.angular.lengthSq() > 1600) body.angular.setLength(40);

                    nodes[JOINTS].copy(body.hang).applyQuaternion(body.quaternion).add(body.position);
                    for (var n = 0; n < JOINTS; n++) sim.lengths[n] = nodes[n].distanceTo(nodes[n + 1]);
                }
                if (grab) grab.from.copy(grab.target);

                var energy = body.velocity.lengthSq() + body.angular.lengthSq() * 0.3;
                for (var e2 = 1; e2 < JOINTS; e2++) energy += velocities[e2].lengthSq() * 0.05;
                sim.calm = energy < 2e-4 ? sim.calm + dt : 0;
            }

            /* ---- 挂绳条带 ---- */
            var controls = [];
            var mouth = new THREE.Vector3();
            var tuck = new THREE.Vector3();
            var curve = new THREE.CatmullRomCurve3(controls, false, 'centripetal');
            var points = [];
            var sides = [];
            for (var pi = 0; pi < SAMPLES; pi++) {
                points.push(new THREE.Vector3());
                sides.push(new THREE.Vector3());
            }
            var bends = BAND_BEND.map(function (angle) { return [Math.cos(angle), Math.sin(angle)]; });
            var work = {
                tangent: new THREE.Vector3(), toCamera: new THREE.Vector3(),
                basis: new THREE.Matrix4(), up: new THREE.Vector3(),
                across: new THREE.Vector3(), facing: new THREE.Vector3(), end: new THREE.Vector3()
            };

            function updateBand() {
                var hang = sim.nodes[JOINTS];
                var reach = EYELET_RADIUS + CLAMP_BODY + 0.05;
                var guide = JOINTS - 1;
                while (guide > 0 && sim.nodes[guide].distanceTo(hang) < reach * 1.1) guide--;
                var axis = work.up.subVectors(sim.nodes[guide], hang);
                if (axis.lengthSq() < 1e-8) axis.set(0, 1, 0).applyQuaternion(sim.body.quaternion);
                axis.normalize();
                mouth.copy(hang).addScaledVector(axis, reach);
                tuck.copy(hang).addScaledVector(axis, EYELET_RADIUS + CLAMP_BODY * 0.35);
                controls.length = 0;
                for (var i = 0; i <= guide; i++) controls.push(sim.nodes[i]);
                controls.push(mouth, tuck);
                curve.updateArcLengths();
                for (var s = 0; s < SAMPLES; s++) curve.getPointAt(s / (SAMPLES - 1), points[s]);
                var length = curve.getLength();
                var held = 1 - mouth.distanceTo(tuck) / Math.max(length, 0.001);
                var position = bandGeometry.getAttribute('position');
                var normal = bandGeometry.getAttribute('normal');
                var uv = bandGeometry.getAttribute('uv');
                var columns = BAND_COLUMNS.length;
                var restLength = sim.rest * JOINTS;
                var repeats = restLength / (strapScale * 2);
                var width = strapScale / Math.pow(Math.max(1, length / Math.max(restLength, 0.001)), 0.35);
                var tangent = work.tangent, toCamera = work.toCamera, across = work.across, facing = work.facing;
                for (var i2 = 0; i2 < SAMPLES; i2++) {
                    tangent.subVectors(points[Math.min(SAMPLES - 1, i2 + 1)], points[Math.max(0, i2 - 1)]);
                    if (tangent.lengthSq() < 1e-12) tangent.set(0, -1, 0);
                    tangent.normalize();
                    toCamera.subVectors(camera.position, points[i2]).normalize();
                    var side = sides[i2].crossVectors(toCamera, tangent);
                    if (side.lengthSq() < 1e-10) side.copy(i2 > 0 ? sides[i2 - 1] : scratch.a.set(1, 0, 0));
                    side.normalize();
                    if (i2 > 0 && side.dot(sides[i2 - 1]) < 0) side.negate();
                    var angle = -sim.twist * Math.pow(Math.min(1, i2 / (SAMPLES - 1) / held), 1.3);
                    facing.crossVectors(tangent, side);
                    across.copy(side).multiplyScalar(Math.cos(angle)).addScaledVector(facing, Math.sin(angle));
                    facing.crossVectors(tangent, across);
                    var p = points[i2];
                    var v = (1 - i2 / (SAMPLES - 1)) * repeats;
                    for (var c = 0; c < columns; c++) {
                        var idx2 = i2 * columns + c;
                        var offset = (BAND_COLUMNS[c] - 0.5) * width;
                        var bend = bends[c];
                        position.setXYZ(idx2, p.x + across.x * offset, p.y + across.y * offset, p.z + across.z * offset);
                        normal.setXYZ(idx2,
                            facing.x * bend[0] + across.x * bend[1],
                            facing.y * bend[0] + across.y * bend[1],
                            facing.z * bend[0] + across.z * bend[1]);
                        uv.setXY(idx2, BAND_COLUMNS[c], v);
                    }
                }
                work.end.copy(across);
                position.needsUpdate = true;
                normal.needsUpdate = true;
                uv.needsUpdate = true;

                across.copy(work.end).addScaledVector(axis, -work.end.dot(axis)).normalize();
                facing.crossVectors(across, axis).normalize();
                work.basis.makeBasis(across, axis, facing);
                clampGroup.quaternion.setFromRotationMatrix(work.basis);
                clampGroup.position.copy(hang);
            }

            /* ---- 视图与循环 ---- */
            var view = { width: 1, height: 1 };
            var placed = false;
            var time = 0;
            var last = performance.now();
            var visible = true;

            function frameView() {
                var aspect = view.width / view.height;
                var viewHeight = layout.height / clamp(settings.size, 0.15, 0.9);
                var minimumWidth = layout.width / 0.72;
                if (viewHeight * aspect < minimumWidth) viewHeight = minimumWidth / aspect;
                var viewWidth = viewHeight * aspect;
                camera.aspect = aspect;
                camera.position.set(0, 0, viewHeight / 2 / Math.tan((FOV * Math.PI) / 360));
                camera.lookAt(0, 0, 0);
                camera.updateProjectionMatrix();
                camera.updateMatrixWorld();
                var anchorX = ((ANCHORS[settings.anchor] || 0.5) - 0.5) * viewWidth;
                var anchorY = viewHeight / 2 + 0.2;
                var cardTop = viewHeight / 2 - viewHeight * mix(0.12, 0.42, clamp(settings.strapLength, 0, 1));
                var hangTop = cardTop + (layout.hangY - layout.height / 2);
                sim.anchor.set(anchorX, anchorY, 0);
                configureSimulation(anchorY - hangTop);
                sim.nodes[0].copy(sim.anchor);
                sim.previous[0].copy(sim.anchor);
            }

            function render() {
                cardGroup.position.copy(sim.body.position);
                cardGroup.quaternion.copy(sim.body.quaternion);
                updateBand();
                renderer.render(scene, camera);
                /*
                 * 首帧画完才显示宿主。
                 * CSS 里 .lanyard-host:not([data-ready]) 是 hidden，
                 * 防止 three.js 初始化期间出现空白画布或尺寸跳变的闪屏。
                 */
                if (!root.hasAttribute('data-ready')) root.setAttribute('data-ready', '');
            }

            function tick(now) {
                raf = 0;
                if (!alive) return;
                var dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
                last = now;
                time += dt;
                var ph = physics();
                stepSimulation(dt, ph, time);
                if (!isFinite(sim.body.position.x + sim.body.position.y + sim.body.position.z + sim.body.quaternion.w)) {
                    sim.grab = null;
                    placeHanging(false);
                }
                render();
                var resting = sim.calm > 1.2 && !sim.grab && ph.breeze === 0;
                if (visible && !resting) raf = global.requestAnimationFrame(tick);
            }

            function start() {
                if (raf || !visible || !alive) return;
                sim.calm = 0;
                last = performance.now();
                raf = global.requestAnimationFrame(tick);
            }

            /* ---- 交互 ---- */
            var raycaster = new THREE.Raycaster();
            var pointerVec = new THREE.Vector2();
            var press = null;
            var hovering = false;

            function toPointer(event) {
                var rect = canvas.getBoundingClientRect();
                pointerVec.set(
                    ((event.clientX - rect.left) / rect.width) * 2 - 1,
                    -((event.clientY - rect.top) / rect.height) * 2 + 1
                );
                raycaster.setFromCamera(pointerVec, camera);
            }

            function pickCard() {
                cardGroup.updateMatrixWorld();
                var hits = raycaster.intersectObjects([bodyMesh, frontMesh, backMesh], false);
                return hits[0] || null;
            }

            function flip(point) {
                var body = sim.body;
                var up = scratch.a.set(0, 1, 0).applyQuaternion(body.quaternion);
                var direction = sim.turn > 0 ? -1 : 1;
                if (sim.turn === 0) {
                    var away = scratch.c.subVectors(point, camera.position).normalize();
                    direction = scratch.b.subVectors(point, body.position).cross(away).dot(up) < 0 ? -1 : 1;
                }
                sim.turn = sim.turn === 0 ? Math.PI * direction : 0;
                body.angular.addScaledVector(up, FLIP_SPIN * direction);
            }

            function onPointerDown(event) {
                if (!settings.interactive || event.button > 0) return;
                toPointer(event);
                var hit = pickCard();
                if (!hit) return;
                sim.grab = {
                    local: hit.point.clone().sub(sim.body.position).applyQuaternion(sim.body.quaternion.clone().invert()),
                    rotation: sim.body.quaternion.clone(),
                    reach: hit.distance,
                    from: hit.point.clone(),
                    target: hit.point.clone()
                };
                press = { x: event.clientX, y: event.clientY, time: performance.now(), point: hit.point.clone() };
                if (canvas.setPointerCapture) canvas.setPointerCapture(event.pointerId);
                canvas.style.cursor = 'grabbing';
                event.preventDefault();
                start();
            }

            function onPointerMove(event) {
                if (!settings.interactive) return;
                toPointer(event);
                if (sim.grab) {
                    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) press = null;
                    raycaster.ray.at(sim.grab.reach, sim.grab.target);
                    start();
                    return;
                }
                if (event.pointerType === 'touch') return;
                hovering = !!pickCard();
                canvas.style.cursor = hovering ? 'grab' : '';
            }

            function onPointerUp(event) {
                if (!sim.grab) return;
                sim.grab = null;
                if (press && event.type === 'pointerup' && performance.now() - press.time < 450) flip(press.point);
                press = null;
                if (canvas.releasePointerCapture) canvas.releasePointerCapture(event.pointerId);
                canvas.style.cursor = hovering && event.pointerType !== 'touch' ? 'grab' : '';
                start();
            }

            canvas.addEventListener('pointerdown', onPointerDown);
            canvas.addEventListener('pointermove', onPointerMove);
            canvas.addEventListener('pointerup', onPointerUp);
            canvas.addEventListener('pointercancel', onPointerUp);

            /* ---- 尺寸 ---- */
            function resize() {
                view.width = Math.max(1, root.clientWidth);
                view.height = Math.max(1, root.clientHeight);
                renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 2));
                renderer.setSize(view.width, view.height, false);
                frameView();
                if (!placed) {
                    placeHanging(settings.intro && !reducedMotion);
                    placed = true;
                }
                render();
                start();
            }

            var resizeObserver = new ResizeObserver(resize);
            resizeObserver.observe(root);
            var intersectionObserver = null;
            if (global.IntersectionObserver) {
                intersectionObserver = new IntersectionObserver(function (entries) {
                    visible = entries[entries.length - 1].isIntersecting;
                    if (visible) start();
                });
                intersectionObserver.observe(root);
            }
            var themeObserver = null;
            if (global.MutationObserver) {
                themeObserver = new MutationObserver(function () {
                    paintAll();
                    edgeMaterial.color.set(resolveThemeColors().card);
                    start();
                });
                themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            }
            var onVisibility = function () { if (!document.hidden) start(); };
            document.addEventListener('visibilitychange', onVisibility);

            resize();

            api = {
                start: start,
                destroy: function () {
                    alive = false;
                    global.cancelAnimationFrame(raf);
                    resizeObserver.disconnect();
                    if (intersectionObserver) intersectionObserver.disconnect();
                    if (themeObserver) themeObserver.disconnect();
                    document.removeEventListener('visibilitychange', onVisibility);
                    canvas.removeEventListener('pointerdown', onPointerDown);
                    canvas.removeEventListener('pointermove', onPointerMove);
                    canvas.removeEventListener('pointerup', onPointerUp);
                    canvas.removeEventListener('pointercancel', onPointerUp);
                    [bodyMesh, frontMesh, backMesh, ring, clampMesh, eyelet, band].forEach(function (mesh) {
                        if (mesh.geometry) mesh.geometry.dispose();
                    });
                    [frontMaterial, backMaterial, edgeMaterial, metalMaterial, bandMaterial].forEach(function (m) { m.dispose(); });
                    [frontTexture, backTexture, strapTexture].forEach(function (t) { t.dispose(); });
                    renderer.dispose();
                    if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
                }
            };
        }

        return {
            destroy: function () { alive = false; api.destroy(); }
        };
    }

    Lanyard.autoInit = function () {
        var nodes = document.querySelectorAll('[data-lanyard]');
        Array.prototype.forEach.call(nodes, function (node) {
            if (node.__lanyard) return;
            var d = node.dataset || {};
            var num = function (key) { return d[key] === undefined ? undefined : Number(d[key]); };
            node.__lanyard = new Lanyard(node, {
                frontImage: d.frontImage || null,
                backImage: d.backImage || null,
                strapLogo: d.strapLogo || null,
                imageFit: d.imageFit || 'cover',
                cardColor: d.cardColor || null,
                orientation: d.orientation || 'portrait',
                finish: d.finish || 'glossy',
                cornerRadius: num('cornerRadius'),
                size: num('size'),
                anchor: d.anchor || 'right',
                strapLength: num('strapLength'),
                strapColor: d.strapColor || null,
                strapWidth: num('strapWidth'),
                metal: d.metal || 'silver',
                gravity: num('gravity'),
                damping: num('damping'),
                elasticity: num('elasticity'),
                breeze: num('breeze'),
                interactive: d.interactive !== 'false',
                intro: d.intro !== 'false',
                theme: d.theme || 'auto',
                threeUrl: d.threeUrl || null,
                frontText: d.frontText || '',
                frontSub: d.frontSub || '',
                backText: d.backText || '',
                backSub: d.backSub || ''
            });
        });
    };

    global.Lanyard = Lanyard;
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', Lanyard.autoInit);
    } else {
        Lanyard.autoInit();
    }
})(window);