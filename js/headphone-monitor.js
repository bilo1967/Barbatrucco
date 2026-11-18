/* Optional monitor of captured tab audio.
 *
 * The browser normally plays a shared tab directly. We cannot attenuate that
 * native playback. Instead, when requested before capture, Chromium may
 * suppress it; only then do we play the captured track through this element.
 * No microphone audio is sent to the monitor (avoids feedback).
 */
(function () {
    'use strict';
    let audio = null;
    let track = null;
    let active = false;
    let ducking = false;
    let requested = false;

    const status = (en, it) => window.BTVolumeMixer?.showHeadphoneStatus(en, it);

    const monitor = window.BTHeadphoneMonitor = {
        get active() { return active; },
        get requested() { return requested; },
        needsControl() { return window.BTVolumeMixer?.getPercent('duck-headphones') < 100; },
        captureOptions(base) {
            requested = this.needsControl() &&
                !!navigator.mediaDevices?.getSupportedConstraints?.().suppressLocalAudioPlayback;
            return requested
                ? { ...base, audio: { ...base.audio, suppressLocalAudioPlayback: true } }
                : base;
        },
        async attach(stream) {
            const wasRequested = requested;
            this.stop();
            requested = wasRequested;
            if (!requested) {
                if (this.needsControl()) status(
                    'Headphone attenuation is not supported by this browser.',
                    'Il browser non supporta l’attenuazione in cuffia.'
                );
                return;
            }
            const selected = stream.getVideoTracks()[0]?.getSettings().displaySurface;
            track = stream.getAudioTracks()[0] || null;
            if (!track || selected !== 'browser' ||
                track.getSettings().suppressLocalAudioPlayback !== true) {
                track = null;
                status('Headphone attenuation is available only for supported tab-audio capture.',
                    "L'attenuazione in cuffia è disponibile soltanto per l'audio di schede supportate.");
                return;
            }
            const el = new Audio();
            el.autoplay = false;
            el.srcObject = new MediaStream([track]);
            el.volume = 1;
            audio = el;
            try {
                try {
                    await this.setOutput(window.BTDeviceSettings?.selected('audiooutput') || '');
                } catch (error) {
                    console.warn('Headphone output unavailable, trying default:', error);
                    await this.setOutput('');
                }
                await el.play();
                if (audio !== el) return; // Capture may have stopped while play() was pending.
                active = true;
                this.setDucking(ducking);
                status('Headphone monitoring enabled for this recording.',
                    'Controllo del volume in cuffia attivo per questa registrazione.');
            } catch (error) {
                console.warn('Headphone monitoring failed:', error);
                status('Unable to play captured audio in headphones; check browser permissions.',
                    'Impossibile riprodurre l’audio catturato in cuffia; verifica i permessi del browser.');
            }
        },
        setDucking(value) {
            ducking = !!value;
            if (audio && active) audio.volume = ducking
                ? window.BTVolumeMixer.get('duck-headphones') : 1;
        },
        async setOutput(deviceId) {
            if (audio && typeof audio.setSinkId === 'function') {
                await audio.setSinkId(deviceId || '');
            }
        },
        stop() {
            if (audio) {
                audio.pause();
                audio.srcObject = null;
            }
            audio = null;
            track = null;
            active = false;
            ducking = false;
            requested = false;
        }
    };
}());
