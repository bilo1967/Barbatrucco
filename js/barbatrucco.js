// Recording options, media constraints, and application state.
const defaultGain = 0.95; // Guadagno di default

const blobDuration = 250; // gli stream vengono acquisiti a blocchi di 250ms

const AudioMimeType = { mimeType: 'audio/webm', type: 'audio/webm', };
const MicMimeType = { mimeType: 'audio/webm', type: 'audio/webm', audioChannels: 1, };
const VideoMimeType = { mimeType: 'video/webm; codecs=vp8,opus', type: 'video/webm', };


const outRecVirtualFile = 'input.webm';
const outMicVirtualFile = 'mic-input.webm';
const outMicFilename = 'pippo-mic';
const outRecFilename = 'pippo';


const ScreenShareConstraints = {
    video: {
        cursor: 'never',
    },
    //audio: true,
    audio: {
        sampleSize: 16,
        sampleRate: 44100,
        channelCount: 2
    }
};


const MicConstraints = {
    video: false,
    audio: {
        sampleSize: 16,
        sampleRate: 44100,
        channelCount: 1,
        noiseSuppression: true,
        echoCancellation: false,
        voiceIsolation: false,
    }
};


var myMimeType = AudioMimeType;


var soloAudio = true;
var microfono = null;
var registratoreTraccia = null;
var registratoreMicrofono = null;
var mangiacassette = null;
var grafico = null;
var timer = null;
var streamCondivisione = null;
var streamMicrofono = null;
var webcamPiP = null;
var cameraRequest = null;
var micRequest = null;
var streamFinale = null;

var audioFormat = 'mp3';
var voiceoverActive = false;


var originalMediaBlob = null;
var originalMicBlob = null;
var recordingAudioOnly = true;
var visualizerContext = null;
var visualizerFrame = null;
var mixingContext = null;
var countdown = null;
var resolveCountdown = null;
var acquisitionCancelled = false;
var startingRecording = false;
var conversionQueue = Promise.resolve();
const downloadURLs = { '#rec-download': null, '#mic-download': null };

// Manage download URLs and recorder controls, releasing previous resources.
function setDownload(selector, blob, filename) {
    if (downloadURLs[selector]) URL.revokeObjectURL(downloadURLs[selector]);
    const url = URL.createObjectURL(blob);
    downloadURLs[selector] = url;
    $(selector).attr('href', url).attr('download', filename).removeClass('disabled');
    if (selector === '#rec-download') window.BTWaveformTrim?.onRecording(blob, filename);
    if (selector === '#rec-download') {
        // Il player deve abbandonare la precedente sorgente prima di revocarne l'URL.
        mangiacassette.pause();
        mangiacassette.srcObject = null;
        mangiacassette.src = url;
        mangiacassette.controls = true;
        mangiacassette.muted = false;
    }
}

function setRecordingControls(active) {
    window.BTDeviceSettings?.setRecording(active);
    $('#rec-start, #rec-timer').toggleClass('disabled', active).prop('disabled', active);
    $('#rec-stop').toggleClass('disabled', !active).prop('disabled', !active);
    $('#rec-pause').toggleClass('disabled', !active).prop('disabled', !active);
    $('#rec-resume').addClass('disabled').prop('disabled', true);
}

function closeAudioContext(context) {
    if (context && context.state !== 'closed') context.close().catch(console.warn);
}

function stopVisualization() {
    if (visualizerFrame !== null) cancelAnimationFrame(visualizerFrame);
    visualizerFrame = null;
    closeAudioContext(visualizerContext);
    visualizerContext = null;
    for (const kind of ['source', 'mic']) {
        const fill = document.getElementById('bt-meter-' + kind);
        const peak = document.getElementById('bt-peak-' + kind);
        const value = document.getElementById('bt-db-' + kind);
        if (fill) fill.style.width = '0%';
        if (peak) peak.style.left = '0%';
        if (value) value.textContent = '–';
    }
}

// Serializza tutte le operazioni sul filesystem virtuale di FFmpeg.
function runConversion(work) {
    const next = conversionQueue.catch(() => {}).then(work);
    conversionQueue = next.catch(() => {});
    return next;
}
window.btRunConversion = runConversion;
window.btApplyWaveformTrimResult = (blob, filename) => setDownload('#rec-download', blob, filename);

async function convertMediaBlob(original, input, format) {
    if (!ffmpegLoaded || !window.ffmpeg || !window.fetchFile) {
        return { blob: original, ext: 'webm' };
    }
    return runConversion(async () => {
        const output = format === 'webm' ? 'output.webm' : `output.${format}`;
        $('#loading-overlay-text').text(BTI18n.message(`Converting to ${format.toUpperCase()}...`, `Conversione in ${format.toUpperCase()} in corso...`));
        $('#loading-overlay').show();
        try {
            await ffmpeg.writeFile(input, await fetchFile(original));
            const result = format === 'mp3' ? await convertToMP3(input)
                : format === 'm4a' ? await convertToM4A(input)
                : await makeWebMSeekable(input);
            const data = await ffmpeg.readFile(result);
            const mime = format === 'mp3' ? 'audio/mpeg'
                : format === 'm4a' ? 'audio/mp4' : 'video/webm';
            return { blob: new Blob([data], { type: mime }), ext: format };
        } catch (err) {
            console.warn('Conversion failed, using original WebM:', err);
            return { blob: original, ext: 'webm' };
        } finally {
            await Promise.allSettled([ffmpeg.deleteFile(input), ffmpeg.deleteFile(output)]);
            $('#loading-overlay').hide();
            $('#loading-overlay-text').text('');
        }
    });
}


var volumi = {};


/**
 * Formatta un tempo in secondi come stringa "HH:MM:SS".
 * @param {number} seconds - Tempo in secondi (può essere NaN o negativo).
 * @returns {string} Tempo formattato ("00:00:00" se input non valido).
 */
// Time formatting, source tracking, and live audio visualization.
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "00:00:00";
    const h = Math.floor(seconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
}


function handleScreenShareStream(stream) {

    mangiacassette.pause();
    mangiacassette.removeAttribute('src');
    mangiacassette.srcObject = stream;
    window.btUpdateIdlePreview?.();
    mangiacassette.muted = true;
    mangiacassette.controls = false;
    mangiacassette.play();
}


function visualizzaStream(stream) {
    stopVisualization();
    // During capture monitor source and microphone independently; during playback,
    // monitor the recorded output. Analyzers do not feed audible audio to speakers.
    const sources = {
        source: streamCondivisione?.active ? streamCondivisione : stream,
        mic: streamMicrofono?.active ? streamMicrofono : null
    };
    if (!sources.source?.getAudioTracks().length && !sources.mic?.getAudioTracks().length) return;
    const ctx = new AudioContext();
    visualizerContext = ctx;
    const analyzers = {};
    const silent = ctx.createGain();
    silent.gain.value = 0;
    silent.connect(ctx.destination);
    for (const kind of ['source', 'mic']) {
        const input = sources[kind];
        if (!input?.getAudioTracks().length) continue;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        const node = ctx.createMediaStreamSource(input);
        node.connect(analyser);
        analyser.connect(silent);
        analyzers[kind] = { analyser, data: new Float32Array(analyser.fftSize), peak: -60, hold: 0 };
    }
    const update = () => {
        if (visualizerContext !== ctx) return;
        const now = performance.now();
        for (const kind of ['source', 'mic']) {
            const meter = analyzers[kind];
            const fill = document.getElementById('bt-meter-' + kind);
            const peak = document.getElementById('bt-peak-' + kind);
            const text = document.getElementById('bt-db-' + kind);
            if (!meter) {
                fill.style.width = '0%';
                peak.style.left = '0%';
                text.textContent = '–';
                continue;
            }
            meter.analyser.getFloatTimeDomainData(meter.data);
            let power = 0, amplitude = 0;
            for (const sample of meter.data) {
                power += sample * sample;
                amplitude = Math.max(amplitude, Math.abs(sample));
            }
            const gain = window.BTVolumeMixer?.get(kind) ?? defaultGain;
            const rms = Math.sqrt(power / meter.data.length) * gain;
            const level = Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(rms, 0.000001))));
            const peakDb = Math.max(-60, Math.min(0, 20 * Math.log10(Math.max(amplitude * gain, 0.000001))));
            if (peakDb >= meter.peak || now > meter.hold) {
                meter.peak = peakDb;
                meter.hold = now + 650;
            }
            fill.style.width = Math.max(0, (level + 60) / 60 * 100) + '%';
            fill.dataset.level = level > -6 ? 'high' : (level > -18 ? 'medium' : 'low');
            peak.style.left = Math.min(99.5, (meter.peak + 60) / 60 * 100) + '%';
            text.textContent = level <= -59.5 ? '–' : Math.round(level) + ' dB';
        }
        visualizerFrame = requestAnimationFrame(update);
    };
    ctx.resume().catch(() => {});
    update();
}

// Lazy initialization of FFmpeg.wasm; conversions run in the browser.
// Caricamento di FFMPEG.wasm
let ffmpegLoaded = false;

async function loadFFmpeg() {

    $('#loading-overlay-text').html('Loading <span style="color:yellow">FFmpeg.wasm</span> into your browser.<br/>This might take a while.<br/>Please wait&hellip;');
    $('#loading-overlay').show();
    try {
        const FFMPEG = await window.createFFmpegInstance();
        window.ffmpeg = FFMPEG.ffmpeg;
        window.fetchFile = FFMPEG.fetchFile;
        ffmpegLoaded = true;
/*
        // Progress bar
        window.ffmpeg.on('progress', ({ progress, time }) => {

        });
*/
    } catch (err) {
        console.error("FFmpeg load error:", err);
        bootbox.alert(BTI18n.message('Failed to load FFmpeg. Using the original WebM format.', 'Impossibile caricare FFmpeg. Verrà usato il formato WebM originale.'));
    } finally {
        $('#loading-overlay').hide();
    }
}


function showAudioFormat() {
    const activateMic = $('#activate-mic').prop('checked');
    const saveMic = $('#save-mic').prop('checked');

    if (soloAudio || saveMic && activateMic) {
        $('#audio-format-selector')
            .removeClass('d-none')
            .addClass('d-flex');
    } else {
        $('#audio-format-selector')
            .removeClass('d-flex')
            .addClass('d-none');
    }
}

function showMicDownload() {

    const activateMic = $('#activate-mic').prop('checked');
    const saveMic = $('#save-mic').prop('checked');

    if (activateMic && saveMic) {
        $('#mic-download').show();
    } else {
        $('#mic-download').hide();
    }

}


// Wire UI events, device permissions, recording, playback, and preferences.
$(document).ready(async function() {

    // Carica FFmpeg in background
    loadFFmpeg();

    // Il formato di ogni link corrisponde sempre ai byte effettivamente scaricati.
    $("input[name='audio-format']").on('change', async function() {
        audioFormat = $(this).val();
        BTPreferences.set('audio-format', audioFormat);
        const requestedFormat = audioFormat;
        if (recordingAudioOnly && originalMediaBlob) {
            const result = await convertMediaBlob(originalMediaBlob, outRecVirtualFile, requestedFormat);
            if (audioFormat === requestedFormat) setDownload('#rec-download', result.blob, `${outRecFilename}.${result.ext}`);
        }
        if (originalMicBlob) {
            const result = await convertMediaBlob(originalMicBlob, outMicVirtualFile, requestedFormat);
            if (audioFormat === requestedFormat) setDownload('#mic-download', result.blob, `${outMicFilename}.${result.ext}`);
        }
    });

    // Gestione spunta registrazione video
    $('#webcam-cutout').on('change', async function() {
        const checkbox = this;
        if (!checkbox.checked) {
            await webcamPiP.setCutoutMode(false);
            return;
        }
        if (!$('#activate-webcam').prop('checked')) {
            checkbox.checked = false;
            return;
        }
        checkbox.disabled = true;
        try {
            await webcamPiP.setCutoutMode(true);
        } catch (err) {
            checkbox.checked = false;
            await webcamPiP.setCutoutMode(false);
            bootbox.alert(BTI18n.message(`Failed to initialize MediaPipe: ${err.message || err}`, `Impossibile inizializzare MediaPipe: ${err.message || err}`));
        } finally { checkbox.disabled = false; }
    });
    $('#record-video').on('change', function() {
        soloAudio = !$('#record-video').prop('checked');
        showAudioFormat();
    });

    // Gestione spunta salvataggio traccia microfono
    $('#save-mic').on('change', function() {
        showMicDownload();
        showAudioFormat();
    });


    // Propagazione check inclusione microfono
    $("#activate-mic").on('change', function() {
        if ($(this).prop('checked')) {
            $('#activate-voiceover').removeClass('disabled');
            $('#activate-voiceover').prop('disabled', false);
            $('#activate-voiceover-label').prop('disabled', false);

            $('#save-mic').removeClass('disabled');
            $('#save-mic').prop('disabled', false);
            $('#save-mic-label').prop('disabled', false);

        } else {
            $('#activate-voiceover').addClass('disabled');
            $('#activate-voiceover').prop('disabled', 'disabled');
            $('#activate-voiceover-label').prop('disabled', 'disabled');

            $('#save-mic').addClass('disabled');
            $('#save-mic').prop('disabled', 'disabled');
            $('#save-mic-label').prop('disabled', 'disabled');

        }
        showMicDownload();
        showAudioFormat();
    });

    // Consenso anticipato: la richiesta viene fatta alla selezione, non dopo
    // che l'utente ha già scelto la sorgente da registrare.
    $('#activate-mic').on('change', async function(e) {
        if (!this.checked) {
            if (streamMicrofono && !registratoreTraccia?.state?.includes('recording')) {
                streamMicrofono.getTracks().forEach(t => t.stop());
                streamMicrofono = null;
            }
            return;
        }
        if (!e.originalEvent || streamMicrofono?.active) return;
        try {
            micRequest = navigator.mediaDevices.getUserMedia(window.BTDeviceSettings?.micConstraints(MicConstraints) || MicConstraints);
            const stream = await micRequest;
            if (!this.checked) stream.getTracks().forEach(t => t.stop());
            else streamMicrofono = stream;
        } catch (err) {
            this.checked = false;
            $(this).trigger('change');
            bootbox.alert(BTI18n.message(`Microphone unavailable: ${err.message || err}`, `Microfono non disponibile: ${err.message || err}`));
        } finally { micRequest = null; }
    });

    webcamPiP = new WebcamPiP(document.getElementById('rec-preview-stage'),
        document.getElementById('mangiacassette'), document.getElementById('webcam-frame'));
    const webcamInline = document.getElementById('webcam-inline');

    // Device changes are applied before recording; active recordings keep their tracks.
    if (window.BTDeviceSettings) {
        BTDeviceSettings.onDeviceLost = async (kind) => {
            if (registratoreTraccia?.state === 'recording' || startingRecording) return;
            try {
                await BTDeviceSettings.onInputChanged?.(kind);
            } catch (error) {
                console.warn('Unable to recover disconnected device:', error);
                const selector = kind === 'videoinput' ? '#activate-webcam' : '#activate-mic';
                if ($(selector).prop('checked')) $(selector).prop('checked', false).trigger('change');
            }
        };
        BTDeviceSettings.onInputChanged = async (kind) => {
            if (kind === 'audioinput' && $('#activate-mic').prop('checked') && streamMicrofono) {
                const replacement = await navigator.mediaDevices.getUserMedia(BTDeviceSettings.micConstraints(MicConstraints));
                const previous = streamMicrofono;
                streamMicrofono = replacement;
                previous.getTracks().forEach(track => track.stop());
            }
            if (kind === 'videoinput' && $('#activate-webcam').prop('checked') && webcamPiP?.stream) {
                await webcamPiP.enable(BTDeviceSettings.selected('videoinput'), true);
                webcamInline.srcObject = webcamPiP.stream;
                webcamInline.play().catch(() => {});
            }
        };
    }
    $('#activate-webcam').on('change', async function() {
        if (!this.checked) {
            webcamPiP.disable();
            $('#webcam-cutout').prop('checked', false).prop('disabled', true);
            webcamInline.srcObject = null;
            return;
        }
        // Picture-in-picture is a video-only feature.
        $('#record-video').prop('checked', true).trigger('change');
        try {
            cameraRequest = webcamPiP.enable(window.BTDeviceSettings?.selected('videoinput'));
            await cameraRequest;
            if (!this.checked) { webcamPiP.disable(); return; }
            webcamInline.srcObject = webcamPiP.stream;
            webcamInline.play().catch(() => {});
            webcamPiP.showFrame();
            $('#webcam-cutout').prop('disabled', false);
        } catch (err) {
            this.checked = false;
            webcamPiP.disable();
            $('#webcam-cutout').prop('checked', false).prop('disabled', true);
            bootbox.alert(BTI18n.message(`Webcam unavailable: ${err.message || err}`, `Webcam non disponibile: ${err.message || err}`));
        } finally { cameraRequest = null; }
    });
    $('#webcam-cutout').on('change', async function() {
        const checkbox = this;
        if (!checkbox.checked) {
            await webcamPiP.setCutoutMode(false);
            return;
        }
        if (!$('#activate-webcam').prop('checked')) {
            checkbox.checked = false;
            return;
        }
        checkbox.disabled = true;
        try {
            await webcamPiP.setCutoutMode(true);
        } catch (err) {
            checkbox.checked = false;
            await webcamPiP.setCutoutMode(false);
            bootbox.alert(BTI18n.message(`Failed to initialize MediaPipe: ${err.message || err}`, `Impossibile inizializzare MediaPipe: ${err.message || err}`));
        } finally { checkbox.disabled = false; }
    });
    $('#record-video').on('change', function() {
        if (!this.checked && $('#activate-webcam').prop('checked')) {
            $('#activate-webcam').prop('checked', false).trigger('change');
        }
    });

    microfono = $('#activate-mic').get(0); // Seleziono il primo check di condivisione microfono visto che sono sincronizzati


    mangiacassette = $('#mangiacassette').get(0); // un elemento di tipo video o audio

    // The waveform canvas has been replaced by compact level meters.

    mangiacassette.onkeypress = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    mangiacassette.onkeydown = mangiacassette.onkeypress;

    mangiacassette.onplaying = () => {
        const stream = mangiacassette.srcObject ||
            (typeof mangiacassette.captureStream === 'function' ? mangiacassette.captureStream() : null);
        visualizzaStream(stream);
    };


    BTVolumeMixer.init();
    BTVolumeMixer.onChange = () => {
        if (volumi.A?.gain) volumi.A.gain.value =
            voiceoverActive ? Math.min(BTVolumeMixer.get('duck-record'), BTVolumeMixer.get('source')) : BTVolumeMixer.get('source');
        if (volumi.B?.gain) volumi.B.gain.value = BTVolumeMixer.get('mic');
    };

    timer = new MyChrono(100, function(t) {
        $('#timer').html( ((t/10) + "").toHHMMSS());
    });


    $('#rec-start').on('click', function() {

        bootbox.prompt({
            centerVertical: true,
            title: BTI18n.message('<div>Delayed recording start</div>', '<div>Avvio temporizzato della registrazione</div>'),
            message: BTI18n.message('<p>Optionally delay the start (in seconds). A ticking sound plays during the delay, followed by a bell. Enter 0 to start immediately after selecting the tab to share.</p>', '<p>Puoi ritardare l’avvio della registrazione (in secondi). Durante l’attesa sentirai un ticchettio, seguito da una campanella. Inserisci 0 per partire subito dopo aver selezionato la scheda da condividere.</p>'),
            inputType: 'number',
            min: 0,
            value: "0",
            callback: (delay) => {

                bootbox.hideAll();

                if (delay === null) return;

                delay = parseInt(delay);

                avviaRegistrazione( delay ); // Ritardo specificato + durata suono campanella + piccolo extra
            },
        });
    });


    //$('#rec-start').on('click', async function() {
    // Acquire selected media, handle the countdown, and build the recording stream.
    async function avviaRegistrazione(ritardo = 0) {
        if (startingRecording || (registratoreTraccia && registratoreTraccia.state !== 'inactive')) return;
        startingRecording = true;
        window.BTDeviceSettings?.setRecording(true);
        acquisitionCancelled = false;
        console.log("avvia/interrompi condivisione");
        console.log("Stato condivisione: " + (streamCondivisione ? "attivo" : "non attivo"));

        myMimeType = (soloAudio ? AudioMimeType : VideoMimeType);

        console.log('solo audio: ' + soloAudio);

        let mic = microfono?.checked || false;

        try {

            if (streamCondivisione?.active) {
                console.log("INTERROMPI CONDIVISIONE");
                interrompiCondivisione();
                return;
            }

            $('#record-video, #activate-webcam').prop('disabled', true);

            streamCondivisione = await navigator.mediaDevices.getDisplayMedia(ScreenShareConstraints);
//          streamMicrofono = (mic === true) ? await navigator.mediaDevices.getUserMedia({ video: false, audio: true }) : null;

            if (mic) {
                if (micRequest) await micRequest;
                if (!microfono.checked) throw new Error(BTI18n.message('Microphone access denied', 'Accesso al microfono non autorizzato'));
                if (!streamMicrofono?.active) streamMicrofono = await navigator.mediaDevices.getUserMedia(window.BTDeviceSettings?.micConstraints(MicConstraints) || MicConstraints);
            }
            if ($('#activate-webcam').prop('checked')) {
                if (cameraRequest) await cameraRequest;
                if (!webcamPiP.isReady()) await webcamPiP.enable(window.BTDeviceSettings?.selected('videoinput'));
            }
            if (!streamCondivisione.getAudioTracks().length) {
                throw new Error('MediaStream has no audio track');
            }
            streamCondivisione.getTracks().forEach(track => {
                track.addEventListener('ended', () => {
                    // Interruzione mediante i controlli nativi di condivisione del browser.
                    if (track.kind === 'video' || streamCondivisione?.getTracks().every(t => t.readyState === 'ended')) {
                        stopRecording();
                    }
                }, { once: true });
            });

            // Conto alla rovescia prima dell'avvio della registrazione
            await new Promise(res => {
                resolveCountdown = res;

                if (ritardo == 0) {

                    res();

                } else {

                    // Ticchettio...
                    var remaining = ritardo + 2; // 2 secondi extra per la campanella

                    countdown = window.setInterval(() => {
                        remaining--;
                        if (remaining > 2) {
                            loadAndPlay("sounds/tick.wav");
                        } else if (remaining == 2) {
                            loadAndPlay("sounds/timeout.wav"); // 2 secondi
                        } else if (remaining <= 0) {

                            window.clearInterval(countdown);
                            countdown = null;
                            res(true);
                        }
                    }, 1000);
                }
            });

            resolveCountdown = null;
            if (acquisitionCancelled || !streamCondivisione?.active) {
                throw new Error('Registrazione annullata');
            }
            volumi = {};


            var mergedTracks = null;
            // La composizione mantiene la sorgente schermo originale e sostituisce
            // soltanto la traccia video del file finale.
            const videoTracks = soloAudio ? [] : ($('#activate-webcam').prop('checked')
                ? await webcamPiP.startComposition(streamCondivisione)
                : streamCondivisione.getVideoTracks());
            if (acquisitionCancelled || !streamCondivisione?.active) throw new Error('Registrazione annullata');

            if ($('#activate-mic').prop('checked') && $('#save-mic').prop('checked')) {
                // Audio microfono separato: merge con un MediaStream vuoto
                mergedTracks = [
                    ...videoTracks,
                    //...streamCondivisione.getAudioTracks(),
                    ...mergeAudioStreams(streamCondivisione, new MediaStream(), volumi),
                ];
            } else {
                // Audio microfono separato: merge con streamMicrofono
                mergedTracks = [
                    ...videoTracks,
                    ...mergeAudioStreams(streamCondivisione, streamMicrofono, volumi),
                ];
            }

            streamFinale = new MediaStream(mergedTracks);


            handleScreenShareStream(streamFinale);


            $('#rec-download').addClass('disabled');
            $('#mic-download').addClass('disabled');

            registra(); // Attiva registratori
            startingRecording = false;


            if (mic) {
                if ($('#activate-voiceover').prop('checked')) {
                    $('#voiceover').removeClass('disabled');
                    $('#voiceover').prop('disabled', false);
                } else {
                    $('#silenzia-microfono').removeClass('disabled');
                    $('#silenzia-microfono').prop('disabled', false);
                    $('#silenzia-microfono > i').removeClass('bi-mic-mute-fill').addClass('bi-mic-fill');
                }
            }
            // Disabilita la selezione del microfono
            $('#activate-mic').addClass('disabled');
            $('#activate-mic').prop('disabled', 'disabled');
            $('#activate-mic-label').prop('disabled', 'disabled');
            $('#activate-voiceover').addClass('disabled');
            $('#activate-voiceover').prop('disabled', 'disabled');
            $('#activate-voiceover-label').prop('disabled', 'disabled');
            $('#save-mic').addClass('disabled');
            $('#save-mic').prop('disabled', 'disabled');
            $('#save-mic-label').prop('disabled', 'disabled');

            // Il ripristino è centralizzato in interrompiCondivisione().

        } catch (err) {

            console.log("Error", err);

            let messaggio = "";

            if (countdown) window.clearInterval(countdown);
            countdown = null;
            resolveCountdown = null;
            startingRecording = false;
            if (acquisitionCancelled || err.name === 'NotAllowedError') {
                interrompiCondivisione();
                if (!acquisitionCancelled) bootbox.alert(BTI18n.message('Screen sharing was not authorized.', 'Condivisione non autorizzata.'));
                return;
            }

            if ((err.message || '').includes('MediaStream has no audio track') || (err.message || '').includes('No audio tracks in MediaStream')) {
                messaggio = BTI18n.message('You did not select Share tab audio. If that option is missing, your browser or the selected source may not support audio capture.', 'Non hai selezionato Condividi audio. Se l’opzione non compare, il browser o la sorgente scelta potrebbero non supportare la cattura audio.');

            } else if (err.message == "Permission denied") {

                messaggio = "Non hai abilitato la condivisione dello schermo";

            }

            interrompiCondivisione();
            bootbox.alert(messaggio || BTI18n.message(`Unable to start recording: ${err.message || err}`, `Impossibile avviare la registrazione: ${err.message || err}`));

        }
    }
    //});


    $('#rec-timer-').on('click', function() {


        if (!streamCondivisione /*mangiacassette.srcObject == null*/) {
            bootbox.alert(BTI18n.message('No shared screen or tab is active.', 'Non hai ancora attivato una condivisione.'));
            return false;
        }

        bootbox.prompt({
            centerVertical: true,
            title: BTI18n.message('<div>Delayed recording start</div>', '<div>Avvio temporizzato della registrazione</div>'),
            message: BTI18n.message('<p>Recording starts after the specified number of seconds. Switch to the tab to capture, wait for the bell, and start playback. To end recording, return here and press Stop.</p>', '<p>La registrazione partirà dopo il numero di secondi indicato. Passa alla scheda da acquisire, attendi la campanella e avvia la riproduzione. Per terminare, torna qui e premi Stop.</p>'),
            inputType: 'number',
            min: 1,
            value: 10,
            callback: (v) => {

                if (v == null) return;

                var timeout = null;

                bootbox.alert({
                    centerVertical: true,
                    title: BTI18n.message('Recording is about to start', 'La registrazione sta per partire'),
                    message: BTI18n.message('<p>Switch to the tab you want to record, wait for the bell, and start playback.</p>', '<p>Passa alla scheda da registrare, attendi la campanella e avvia la riproduzione.</p>') + '<div class="w-100 text-center display-4" id="rec-countdown">' + v + '</div>',
                    buttons: {
                        ok: { label: BTI18n.message('Cancel', 'Annulla'), className: 'btn-warning' },
                    },
                    callback: () => {
                        if (timeout) window.clearInterval(timeout);
                    }
                });


                (() => {
                    var remaining = v; // Number of seconds
                    timeout = window.setInterval(function(){
                        remaining--;
                        if (remaining > 0) {
                            loadAndPlay("sounds/tick.wav");
                        } else {
                            // Time is up, stop the timer and hide the bootbox
                            window.clearInterval(timeout);
                            bootbox.hideAll();
                            loadAndPlay("sounds/timeout.wav"); // 2 secondi
                            setTimeout(() => { $("#rec-start").trigger('click'); }, 2333 );
                            return;
                        }
                        $("#rec-countdown").html(remaining); // Update the value displayed
                    }, 1000); // Decrease counter every second
                })()

            },
        });
    });


    // Create the MediaRecorder instances and collect recorded chunks.
    async function registra() {

        let frammenti1 = [];
        let frammenti2 = [];

        recordingAudioOnly = soloAudio;
        const selectedFormat = audioFormat;
        registratoreTraccia = new MediaRecorder(streamFinale, myMimeType);
        registratoreTraccia.ondataavailable = e => { if (e.data.size) frammenti1.push(e.data); };
        originalMediaBlob = null;
        originalMicBlob = null;

        registratoreTraccia.onstop = async () => {
            originalMediaBlob = new Blob(frammenti1, { type: recordingAudioOnly ? 'audio/webm' : 'video/webm' });
            const format = recordingAudioOnly ? selectedFormat : 'webm';
            const result = await convertMediaBlob(originalMediaBlob, outRecVirtualFile, format);
            setDownload('#rec-download', result.blob, `${outRecFilename}.${result.ext}`);
        };
        registratoreTraccia.start(blobDuration);

        if ($('#activate-mic').prop('checked') && $('#save-mic').prop('checked')) {
            registratoreMicrofono = new MediaRecorder(streamMicrofono, MicMimeType);
            registratoreMicrofono.ondataavailable = e => { if (e.data.size) frammenti2.push(e.data); };
            registratoreMicrofono.onstop = async () => {
                originalMicBlob = new Blob(frammenti2, { type: 'audio/webm' });
                const result = await convertMediaBlob(originalMicBlob, outMicVirtualFile, selectedFormat);
                setDownload('#mic-download', result.blob, `${outMicFilename}.${result.ext}`);
            };
            registratoreMicrofono.start(blobDuration);
        } else {
            registratoreMicrofono = null;
        }

        timer.clear();
        timer.start();

        $('#rec-download').removeAttr('href');
        $('#rec-download').removeAttr('download');
        setRecordingControls(true);
    }


    $('#rec-start-').on('click', function() {

        if (!streamCondivisione /*mangiacassette.srcObject == null*/) {
            bootbox.alert(BTI18n.message('No shared screen or tab is active.', 'Non hai ancora attivato una condivisione.'));
            return false;
        }

        registra();

    });

    $('#rec-resume').on('click', function() {
        if (registratoreTraccia?.state !== 'paused') return;
        registratoreTraccia.resume();
        if (registratoreMicrofono?.state === 'paused') registratoreMicrofono.resume();
        timer.resume();
        $('#rec-pause').removeClass('disabled').prop('disabled', false);
        $('#rec-resume').addClass('disabled').prop('disabled', true);
    });

    $('#rec-pause').on('click', function() {
        if (registratoreTraccia?.state !== 'recording') return;
        registratoreTraccia.pause();
        if (registratoreMicrofono?.state === 'recording') registratoreMicrofono.pause();
        timer.pause();
        $('#rec-pause').addClass('disabled').prop('disabled', true);
        $('#rec-resume').removeClass('disabled').prop('disabled', false);
    });


    var spaceBarPressed = false;

    // Duck
    $(document).on('keydown', function(event) {
        if (event.which == 32 && !spaceBarPressed) {
            spaceBarPressed = true;
            event.preventDefault();
            event.stopPropagation();
            if (!streamMicrofono || !$('#activate-voiceover').prop('checked')) return;
            console.log('begin voiceover');
            $('#voiceover').trigger('mousedown');
        }
    });

    // Unduck
    $(document).on('keyup', function(event) {
        if (event.which == 32 && spaceBarPressed) {
            spaceBarPressed = false;
            event.preventDefault();
            event.stopPropagation();
            if (!streamMicrofono || !$('#activate-voiceover').prop('checked')) return;
            $('#voiceover').trigger('mouseup');
            console.log('end voiceover');
        }
    });


    const ripristinaVolume = () => {
        voiceoverActive = false;
        if (!!volumi && volumi?.A instanceof GainNode && volumi?.B instanceof GainNode) {
            console.log('volume a: '+ volumi.A.gain.value);
            console.log('volume b: '+ volumi.B.gain.value);
            volumi.A.gain.value = BTVolumeMixer.get('source');
            volumi.B.gain.value = BTVolumeMixer.get('mic');
        }

    };


    // Duck
    $('#voiceover').on('mousedown', function() {
        voiceoverActive = true;
        $(this).removeClass('btn-warning').addClass('btn-danger');
        if (!!volumi && volumi?.A instanceof GainNode && volumi?.B instanceof GainNode) {
            console.log('volume a: '+ volumi.A.gain.value);
            console.log('volume b: '+ volumi.B.gain.value);
            volumi.A.gain.value = Math.min(BTVolumeMixer.get('duck-record'), BTVolumeMixer.get('source'));
            volumi.B.gain.value = BTVolumeMixer.get('mic');
        }
    });


    // UnDuck
    $('#voiceover').on('mouseup', function() {
        $(this).removeClass('btn-danger').addClass('btn-warning');
        ripristinaVolume();
    });
    $('#voiceover').on('mouseleave', function() {
        $(this).removeClass('btn-danger').addClass('btn-warning');
        ripristinaVolume();
    });


    $('#rec-stop').on('click', stopRecording);

    function stopRecording() {
        if (startingRecording) acquisitionCancelled = true;
        if (countdown !== null) {
            clearInterval(countdown);
            countdown = null;
        }
        if (resolveCountdown) {
            const resolve = resolveCountdown;
            resolveCountdown = null;
            resolve();
        }
        if (registratoreTraccia?.state !== 'inactive' && registratoreTraccia) {
            timer.stop();
            $('#timer').html('00:00:00');
            registratoreTraccia.stop(); // Funziona anche da paused.
        }
        if (registratoreMicrofono && registratoreMicrofono.state !== 'inactive') {
            registratoreMicrofono.stop();
        }
        interrompiCondivisione();
    }

    // Stop capture and release audio resources while preserving webcam preferences.
    function interrompiCondivisione() {
        // Preserve the selected webcam and its preview between recordings.
        // It is released only if the user explicitly unchecks Webcam PiP.
        if (webcamPiP) webcamPiP.stopComposition();
        [streamCondivisione, streamMicrofono, streamFinale].forEach(stream => {
            if (stream) stream.getTracks().forEach(track => {
                if (track.readyState !== 'ended') track.stop();
            });
        });
        streamCondivisione = null;
        streamMicrofono = null;
        streamFinale = null;
        startingRecording = false;
        window.BTDeviceSettings?.setRecording(false);
        mangiacassette.srcObject = null;
        window.btUpdateIdlePreview?.();
        stopVisualization();
        closeAudioContext(mixingContext);
        mixingContext = null;
        volumi = {};
        voiceoverActive = false;
        setRecordingControls(false);
        $('#record-video, #activate-mic, #activate-webcam').prop('disabled', false).removeClass('disabled');
        $('#activate-mic-label').prop('disabled', false);
        const useMic = $('#activate-mic').prop('checked');
        $('#activate-voiceover, #save-mic').prop('disabled', !useMic).toggleClass('disabled', !useMic);
        $('#activate-voiceover-label, #save-mic-label').prop('disabled', !useMic);
        $('#voiceover, #silenzia-microfono').prop('disabled', true).addClass('disabled');
        $('#voiceover').removeClass('btn-danger').addClass('btn-warning');
    }

    $('#forza-mono').on('click', function(e){
        e.preventDefault();

        if (streamCondivisione) {
            streamCondivisione.getVideoTracks()[0].applyConstraints(
                {video: { frameRate: 30 }}
            ).then(() => {
                console.log('qualcosa ho fatto');
                mangiacassette.srcObject = streamFinale;
                mangiacassette.muted = true;
                mangiacassette.play();
            }).catch( () => {
                console.log('qualcosa ho sbagliato...');
            });

        }
    });

    $('#istruzioni-list a').on('click', function (e) {
        e.preventDefault();
        bootstrap.Tab.getOrCreateInstance(this).show();
    })

    $('#silenzia-microfono').on('click', function() {

        if (!streamMicrofono) return;

        if (streamMicrofono.getAudioTracks()[0].enabled) {
            // Mute
            streamMicrofono.getAudioTracks()[0].enabled = false;
            $('#silenzia-microfono > i').removeClass('bi-mic-fill').addClass('bi-mic-mute-fill');
            $('#voiceover').addClass('disabled');
            $('#voiceover').prop('disabled', 'disabled');
        } else {
            // Unmute
            streamMicrofono.getAudioTracks()[0].enabled = true;

            if ($('#activate-voiceover').prop('checked')) {
                $('#voiceover').removeClass('disabled');
                $('#voiceover').prop('disabled', false);
            } else {
                $('#silenzia-microfono > i').removeClass('bi-mic-mute-fill').addClass('bi-mic-fill');
            }

        }

    });

    // Il microfono viene richiesto solo all'avvio effettivo della registrazione.

    $("#show-help-button").on('click', function() {
        $("#help-box").show();
        $("#show-help-button").hide();

        BTPreferences.set('hide-help', 0);

    });

    $("#hide-help-button").on('click', function() {

        $("#help-box").hide();
        $("#show-help-button").show();

        BTPreferences.set('hide-help', 1);
    });


    if (BTPreferences.get('record-video') == 1) $('#record-video').prop('checked', true).trigger('change');
    if (BTPreferences.get('hide-help') == 1) $('#hide-help-button').trigger('click');

    if (BTPreferences.get('record-mic') == 1) $('#activate-mic').prop('checked', true).trigger('change');
    if (BTPreferences.get('activate-voiceover') == 1) $('#activate-voiceover').prop('checked', true).trigger('change');
    if (BTPreferences.get('save-mic') == 1) $('#save-mic').prop('checked', true).trigger('change');

    if (BTPreferences.get('audio-format')) {
        audioFormat = BTPreferences.get('audio-format');
        $("input[name='audio-format']").val( [  audioFormat  ] );
    }


    // Persist webcam preferences without touching the camera from the preference writer.
    $('#activate-webcam').on('change', function() {
        BTPreferences.set('activate-webcam', this.checked ? 1 : 0);
    });
    $('#webcam-cutout').on('change', function() {
        BTPreferences.set('webcam-cutout', this.checked ? 1 : 0);
    });
    // Restore camera selection once handlers are ready. This may request permission.
    if (BTPreferences.get('activate-webcam') === '1') {
        $('#activate-webcam').prop('checked', true).trigger('change');
    }
    // Enable cutout only after the camera stream becomes ready.
    // This also avoids importing MediaPipe while the webcam is unavailable.
    if (BTPreferences.get('activate-webcam') === '1' && BTPreferences.get('webcam-cutout') === '1') {
        (async () => {
            try {
                if (cameraRequest) await cameraRequest;
                if ($('#activate-webcam').prop('checked') && webcamPiP.isReady()) {
                    $('#webcam-cutout').prop('checked', true).trigger('change');
                }
            } catch (_) {}
        })();
    }

    $('#record-video').on('click', function() {
        BTPreferences.set('record-video', $(this).get(0).checked ? 1 : 0);
    });

    $('#activate-mic').on('click', function() {
        BTPreferences.set('record-mic', $(this).get(0).checked ? 1 : 0);
    });
    $('#activate-voiceover').on('click', function() {
        BTPreferences.set('activate-voiceover', $(this).get(0).checked ? 1 : 0);
    });
    $('#save-mic').on('click', function() {
        BTPreferences.set('save-mic', $(this).get(0).checked ? 1 : 0);
    });


});


// Modificato per garantire un sistema di nodi di gain anche se non c'è la traccia
// Mix system audio and microphone audio through Web Audio API.
function mergeAudioStreams(streamA, streamB, gainNodes = null, gain = defaultGain)  {

    closeAudioContext(mixingContext);
    const context = new AudioContext();
    mixingContext = context;
    const destination = context.createMediaStreamDestination();

    let hasStreamA = false;
    let hasStreamB = false;

    if (streamA && streamA.getAudioTracks().length > 0) {
        const sourceA = context.createMediaStreamSource(streamA);
        const gainNodeA = context.createGain();
        gainNodeA.gain.value = BTVolumeMixer.get('source');
        sourceA.connect(gainNodeA).connect(destination);
        hasStreamA = true;
        if (!!gainNodes) gainNodes.A = gainNodeA;
    } else {
        const gainNodeA = context.createGain();
        gainNodeA.gain.value = BTVolumeMixer.get('source');
        gainNodeA.connect(destination);
        hasStreamA = true;
        if (!!gainNodes) gainNodes.A = gainNodeA;
    }

    if (streamB && streamB.getAudioTracks().length > 0) {
        const sourceB = context.createMediaStreamSource(streamB);
        const gainNodeB = context.createGain();
        gainNodeB.gain.value = BTVolumeMixer.get('mic');
        sourceB.connect(gainNodeB).connect(destination);
        hasStreamB = true;
        if (!!gainNodes) gainNodes.B = gainNodeB;
    } else {
        const gainNodeB = context.createGain();
        gainNodeB.gain.value = BTVolumeMixer.get('mic');
        gainNodeB.connect(destination);
        hasStreamB = true;
        if (!!gainNodes) gainNodes.B = gainNodeB;
    }

    return (hasStreamA || hasStreamB) ? destination.stream.getAudioTracks() : [];
};


// Versione ottimizzata per M4A
// Output conversions use the in-browser FFmpeg virtual filesystem.
async function convertToM4A(inputFile) {
    const exitCode = await ffmpeg.exec([
        '-i', inputFile,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-vn',
        '-y',
        'output.m4a'
    ]);
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
    return 'output.m4a';
}

async function convertToMP3(inputFile) {
    const exitCode = await ffmpeg.exec([
        '-i', inputFile,
        '-ar', '44100',   // sample rate
        '-b:a', '160k',   // bitrate
        '-y',             // overwrite
        'output.mp3'
    ]);
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
    return 'output.mp3';
}

// Versione per WebM seekable
async function makeWebMSeekable(inputFile) {
    const exitCode = await ffmpeg.exec([
        '-i', inputFile,
        '-c', 'copy',
        '-f', 'webm',
        '-y',
        'output.webm'
    ]);
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
    return 'output.webm';
}


