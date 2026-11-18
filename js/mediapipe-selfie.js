/* Optional MediaPipe Selfie Segmenter. Loaded only when the user selects cutout.
   Runtime and model are downloaded on first use, not bundled in the ZIP. */
class SelfieCutout {
    constructor() {
        this.segmenter = null;
        this.maskCanvas = document.createElement('canvas');
        this.maskContext = this.maskCanvas.getContext('2d', { willReadFrequently: true });
        this.resultCanvas = document.createElement('canvas');
        this.resultContext = this.resultCanvas.getContext('2d');
        this.lastInference = -Infinity;
        this.lastVideoTime = -1;
        this.lastTimestamp = 0;
        this.maskReady = false;
    }
    async load() {
        if (this.segmenter) return;
        const { FilesetResolver, ImageSegmenter } = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3');
        const vision = await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm');
        // The model identifies background (0) and person (1).
        this.segmenter = await ImageSegmenter.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite',
                delegate: 'CPU'
            },
            runningMode: 'VIDEO',
            outputCategoryMask: false,
            outputConfidenceMasks: true
        });
    }
    process(video, timestamp) {
        if (!this.segmenter || video.readyState < 2) return null;
        // Segment at up to 10 fps, but apply the most recent mask to every video frame.
        if (timestamp - this.lastInference >= 100 && video.currentTime !== this.lastVideoTime) {
            this.lastInference = timestamp;
            this.lastVideoTime = video.currentTime;
            this.lastTimestamp = Math.max(this.lastTimestamp + 1, Math.floor(timestamp));
            this.segmenter.segmentForVideo(video, this.lastTimestamp, result => {
                try {
                    const person = result.confidenceMasks?.[0];
                    if (!person) throw new Error('Maschera persona non disponibile');
                    const w = person.width, h = person.height;
                    if (this.maskCanvas.width !== w || this.maskCanvas.height !== h) {
                        this.maskCanvas.width = w;
                        this.maskCanvas.height = h;
                    }
                    const confidences = person.getAsFloat32Array();
                    const pixels = this.maskContext.createImageData(w, h);
                    for (let i = 0, j = 0; i < confidences.length; i++, j += 4) {
                        // A soft transition avoids hard halos around the foreground.
                        const v = Math.max(0, Math.min(1, (confidences[i] - 0.12) / 0.76));
                        pixels.data[j] = pixels.data[j + 1] = pixels.data[j + 2] = 255;
                        pixels.data[j + 3] = Math.round(v * 255);
                    }
                    this.maskContext.putImageData(pixels, 0, 0);
                    this.maskReady = true;
                } finally {
                    result.confidenceMasks?.forEach(mask => mask.close());
                    result.categoryMask?.close();
                }
            });
        }
        if (!this.maskReady) return null;
        const w = video.videoWidth || 640, h = video.videoHeight || 360;
        if (this.resultCanvas.width !== w || this.resultCanvas.height !== h) {
            this.resultCanvas.width = w;
            this.resultCanvas.height = h;
        }
        const ctx = this.resultContext;
        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        ctx.drawImage(video, 0, 0, w, h);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.imageSmoothingEnabled = true;
        ctx.drawImage(this.maskCanvas, 0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
        return this.resultCanvas;
    }
    reset() {
        this.lastInference = -Infinity;
        this.lastVideoTime = -1;
        this.maskReady = false;
    }
}
