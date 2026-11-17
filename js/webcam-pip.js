/* Webcam picture-in-picture compositor for MiniRecorder. No external dependencies. */
class WebcamPiP {
    constructor(stage, player, frame) {
        this.stage = stage;
        this.player = player;
        this.frame = frame;
        this.camera = document.createElement('video');
        this.camera.autoplay = true;
        this.camera.muted = true;
        this.camera.playsInline = true;
        this.source = document.createElement('video');
        this.source.autoplay = true;
        this.source.muted = true;
        this.source.playsInline = true;
        this.canvas = document.createElement('canvas');
        this.ctx = this.canvas.getContext('2d', { alpha: false });
        this.stream = null;
        this.output = null;
        this.raf = null;
        this.active = false;
        this.rect = { x: 0.73, y: 0.68, w: 0.24, h: 0.24 };
        try {
            const stored = JSON.parse(localStorage.getItem('barbatrucco-webcam-rect'));
            if (stored && ['x','y','w','h'].every(k => Number.isFinite(stored[k])) && stored.w >= .10 && stored.w <= .55 && stored.h >= .08 && stored.h <= .55) {
                this.rect = stored;
            }
        } catch (_) { /* use default */ }
        this.mirrored = false;
        try { this.mirrored = localStorage.getItem('barbatrucco-webcam-mirror') === '1'; } catch (_) {}
        this.mirrorButton = this.frame.querySelector('#webcam-mirror');
        if (this.mirrorButton) {
            // Clicking the button must not start a PiP drag.
            this.mirrorButton.addEventListener('pointerdown', e => e.stopPropagation());
            this.mirrorButton.addEventListener('click', e => {
                e.stopPropagation();
                this.setMirror(!this.mirrored);
            });
        }
        this.setMirror(this.mirrored);
        this.drag = null;
        this.cutoutMode = false;
        this.cutout = null;
        this.previewRaf = null;
        this.frame.addEventListener('pointerdown', e => this.pointerDown(e));
        this.stage.addEventListener('pointermove', e => this.pointerMove(e));
        this.stage.addEventListener('pointerup', e => this.pointerUp(e));
        this.stage.addEventListener('pointercancel', e => this.pointerUp(e));
        window.addEventListener('resize', () => this.updateFrame());
        this.player.addEventListener('loadedmetadata', () => this.updateFrame());
        this.hideFrame();
    }
    setMirror(enabled) {
        this.mirrored = !!enabled;
        this.frame.classList.toggle('mirrored', this.mirrored);
        if (this.mirrorButton) this.mirrorButton.setAttribute('aria-pressed', String(this.mirrored));
        try { localStorage.setItem('barbatrucco-webcam-mirror', this.mirrored ? '1' : '0'); } catch (_) {}
    }
    isReady() { return !!this.stream?.getVideoTracks().some(t => t.readyState === 'live'); }
    async enable(deviceId = '', force = false) {
        // Acquire the replacement before stopping the old camera so a failed
        // device switch does not discard the working preview.
        const currentId = this.stream?.getVideoTracks()[0]?.getSettings().deviceId || '';
        if (this.isReady() && !force && (!deviceId || currentId === deviceId)) return;
        const video = { width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 30 } };
        if (deviceId) video.deviceId = { exact: deviceId };
        const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
        const previous = this.stream;
        this.stream = stream;
        this.camera.srcObject = stream;
        try {
            await this.camera.play();
        } catch (error) {
            stream.getTracks().forEach(t => t.stop());
            this.stream = previous;
            this.camera.srcObject = previous;
            throw error;
        }
        if (previous) previous.getTracks().forEach(t => t.stop());
        this.showFrame();
        if (this.previewRaf === null) this.startPreview();
    }
    disable() {
        this.stopComposition();
        if (this.stream) this.stream.getTracks().forEach(t => t.stop());
        this.stream = null;
        this.camera.srcObject = null;
        this.hideFrame();
        if (this.previewRaf !== null) cancelAnimationFrame(this.previewRaf);
        this.previewRaf = null;
        this.setCutoutMode(false);
    }
    showFrame() {
        this.frame.hidden = false;
        this.updateFrame();
    }
    hideFrame() { this.frame.hidden = true; }
    // Video content bounds, excluding object-fit:contain letterboxing.
    bounds() {
        const cw = this.player.clientWidth, ch = this.player.clientHeight;
        const vw = this.player.videoWidth || 16, vh = this.player.videoHeight || 9;
        const scale = Math.min(cw / vw, ch / vh);
        const w = vw * scale, h = vh * scale;
        return { left: this.player.offsetLeft + (cw - w) / 2, top: this.player.offsetTop + (ch - h) / 2, w, h };
    }
    updateFrame() {
        if (this.frame.hidden) return;
        const b = this.bounds(), r = this.rect;
        Object.assign(this.frame.style, { left: `${b.left + r.x * b.w}px`, top: `${b.top + r.y * b.h}px`, width: `${r.w * b.w}px`, height: `${r.h * b.h}px` });
        // Preview camera only before the canvas composition begins.
        this.frame.querySelector('video').style.visibility = (this.active || this.cutoutMode) ? 'hidden' : 'visible';
        const preview = this.frame.querySelector('canvas');
        if (preview) preview.style.display = (!this.active && this.cutoutMode) ? 'block' : 'none';
    }
    pointerDown(e) {
        if (this.frame.hidden || e.button !== 0 || e.target.closest('#webcam-mirror')) return;
        e.preventDefault();
        const b = this.bounds();
        this.drag = { id: e.pointerId, mode: e.target.closest('.pip-resize') ? 'resize' : 'move', x: e.clientX, y: e.clientY, rect: { ...this.rect }, b };
        this.frame.setPointerCapture(e.pointerId);
    }
    pointerMove(e) {
        const d = this.drag;
        if (!d || d.id !== e.pointerId) return;
        const dx = (e.clientX - d.x) / d.b.w, dy = (e.clientY - d.y) / d.b.h;
        if (d.mode === 'move') {
            this.rect.x = Math.max(0, Math.min(1 - d.rect.w, d.rect.x + dx));
            this.rect.y = Math.max(0, Math.min(1 - d.rect.h, d.rect.y + dy));
        } else {
            const aspect = this.camera.videoWidth && this.camera.videoHeight ? this.camera.videoWidth / this.camera.videoHeight : 16 / 9;
            const ratio = (d.b.w / d.b.h) || 1;
            // Constrain width once, using BOTH axes; never stretch the aspect ratio.
            const maxW = Math.max(.01, Math.min(.50, 1 - d.rect.x, (1 - d.rect.y) * aspect / ratio));
            const minW = Math.min(.10, maxW);
            const newW = Math.max(minW, Math.min(maxW, d.rect.w + dx));
            this.rect.w = newW;
            this.rect.h = newW * ratio / aspect;
        }
        this.updateFrame();
    }
    pointerUp(e) {
        if (!this.drag || this.drag.id !== e.pointerId) return;
        this.drag = null;
        try { localStorage.setItem('barbatrucco-webcam-rect', JSON.stringify(this.rect)); } catch (_) {}
    }
    async setCutoutMode(enabled) {
        if (enabled) {
            if (!this.cutout) this.cutout = new SelfieCutout();
            await this.cutout.load();
            this.cutout.reset();
        }
        this.cutoutMode = !!enabled;
        this.updateFrame();
        if (this.isReady()) this.startPreview();
    }
    startPreview() {
        if (this.previewRaf !== null) return;
        const preview = this.frame.querySelector('canvas');
        const ctx = preview?.getContext('2d');
        const loop = timestamp => {
            this.previewRaf = null;
            if (!this.isReady()) return;
            if (this.cutoutMode && this.cutout && this.camera.readyState >= 2) {
                try {
                    const cut = this.cutout.process(this.camera, timestamp);
                    if (cut && preview && ctx) {
                        if (preview.width !== cut.width || preview.height !== cut.height) {
                            preview.width = cut.width;
                            preview.height = cut.height;
                        }
                        ctx.clearRect(0, 0, preview.width, preview.height);
                        ctx.drawImage(cut, 0, 0);
                    }
                } catch (err) {
                    console.error('MediaPipe selfie segmentation:', err);
                    this.cutoutMode = false;
                    document.getElementById('webcam-cutout').checked = false;
                    this.updateFrame();
                }
            }
            this.previewRaf = requestAnimationFrame(loop);
        };
        this.previewRaf = requestAnimationFrame(loop);
    }
    async startComposition(displayStream) {
        if (!this.isReady()) throw new Error('Webcam non disponibile');
        this.stopComposition();
        this.source.srcObject = displayStream;
        await this.source.play();
        if (!this.source.videoWidth) {
            await new Promise((resolve, reject) => {
                const t = setTimeout(() => reject(new Error('Timeout video schermo')), 5000);
                this.source.addEventListener('loadedmetadata', () => { clearTimeout(t); resolve(); }, { once: true });
            });
        }
        this.canvas.width = this.source.videoWidth || displayStream.getVideoTracks()[0].getSettings().width || 1280;
        this.canvas.height = this.source.videoHeight || displayStream.getVideoTracks()[0].getSettings().height || 720;
        this.output = this.canvas.captureStream(30);
        this.active = true;
        this.showFrame();
        let lastDraw = -Infinity;
        const draw = timestamp => {
            if (!this.active) return;
            if (timestamp - lastDraw >= 1000 / 30) {
                lastDraw = timestamp;
                const ctx = this.ctx, w = this.canvas.width, h = this.canvas.height;
                if (this.source.readyState >= 2) ctx.drawImage(this.source, 0, 0, w, h);
                if (this.camera.readyState >= 2) {
                    const r = this.rect;
                    const overlay = this.cutoutMode && this.cutout?.maskReady ? this.cutout.resultCanvas : this.camera;
                    if (this.mirrored) {
                        ctx.save();
                        // Flip only the webcam, never the shared screen.
                        ctx.translate((2 * r.x + r.w) * w, 0);
                        ctx.scale(-1, 1);
                        ctx.drawImage(overlay, r.x * w, r.y * h, r.w * w, r.h * h);
                        ctx.restore();
                    } else {
                        ctx.drawImage(overlay, r.x * w, r.y * h, r.w * w, r.h * h);
                    }
                }
            }
            this.raf = requestAnimationFrame(draw);
        };
        draw(performance.now());
        return this.output.getVideoTracks();
    }
    stopComposition() {
        this.active = false;
        if (this.raf !== null) cancelAnimationFrame(this.raf);
        this.raf = null;
        if (this.output) this.output.getTracks().forEach(t => t.stop());
        this.output = null;
        this.source.pause();
        this.source.srcObject = null;
        this.updateFrame();
    }
}
