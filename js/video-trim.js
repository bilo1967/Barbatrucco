/* Experimental non-destructive WebM trimmer. Uses the shared FFmpeg.wasm instance. */
(function () {
    'use strict';

    let sourceBlob = null;
    let sourceName = '';
    let duration = 0;
    let start = 0;
    let end = 0;
    let previewing = false;
    let previewLimit = null;
    let statusTimeout = null;
    let lastEdited = 'start';
    let busy = false;
    let initialized = false;
    let player, panel, toggle, startInput, endInput, lengthOutput, status, applyButton, playButton, startRange, endRange, selectedTrack;
    const epsilon = 0.002;

    function label(en, it) {
        return window.BTI18n ? BTI18n.message(en, it) : en;
    }

    function stamp(seconds) {
        const total = Math.max(0, Number(seconds) || 0);
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor((total % 3600) / 60);
        const sec = (total % 60).toFixed(1).padStart(4, '0');
        return (hours ? String(hours).padStart(2, '0') + ':' : '') +
            String(minutes).padStart(2, '0') + ':' + sec;
    }

    function parseTime(value) {
        const parts = String(value).trim().replace(',', '.').split(':');
        if (!parts.length || parts.length > 3 || parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return NaN;
        return parts.reduce((sum, part) => sum * 60 + Number(part), 0);
    }

    function precise(seconds) {
        return (Math.round(seconds * 1000) / 1000).toFixed(3);
    }

    function setStatus(message, error) {
        if (!status) return;
        if (statusTimeout) clearTimeout(statusTimeout);
        status.textContent = message || '';
        status.hidden = !message;
        status.classList.toggle('text-danger', !!error);
        if (message && (error || /complet|completed/i.test(message))) {
            statusTimeout = setTimeout(() => { status.hidden = true; }, error ? 6500 : 2400);
        }
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function sync() {
        if (!startInput || !endInput || !startRange || !endRange) return;
        startInput.value = stamp(start);
        endInput.value = stamp(end);
        startRange.max = String(duration);
        endRange.max = String(duration);
        startRange.value = String(start);
        endRange.value = String(end);
        const left = duration > 0 ? start / duration * 100 : 0;
        const right = duration > 0 ? end / duration * 100 : 100;
        selectedTrack.style.left = left + '%';
        selectedTrack.style.width = Math.max(0, right - left) + '%';
        lengthOutput.textContent = stamp(end - start);
        applyButton.disabled = busy || !sourceBlob || end <= start + epsilon ||
            (start <= epsilon && end >= duration - epsilon);
    }

    function update(which, value, shouldSeek) {
        if (!Number.isFinite(value) || duration <= 0) return sync();
        if (which === 'start') start = clamp(value, 0, Math.max(0, end - 0.1));
        else end = clamp(value, Math.min(duration, start + 0.1), duration);
        lastEdited = which;
        sync();
        if (shouldSeek) seekTo(which === 'start' ? start : end);
    }

    function seekTo(time) {
        if (!player || !Number.isFinite(player.duration)) return;
        player.pause();
        previewing = false;
        previewLimit = null;
        player.currentTime = clamp(time, 0, duration);
        updatePlayButton();
    }

    async function playSection(from, to) {
        if (!player || !Number.isFinite(player.duration) || to <= from + epsilon) return;
        player.pause();
        previewing = false;
        previewLimit = to;
        player.currentTime = clamp(from, 0, duration);
        try {
            await player.play();
            previewing = true;
        } catch (err) {
            setStatus(String(err.message || err), true);
            previewLimit = null;
        }
        updatePlayButton();
    }

    function stopPreview() {
        player.pause();
        previewing = false;
        previewLimit = null;
        updatePlayButton();
    }

    function onTimeUpdate() {
        if (previewLimit !== null && player.currentTime >= previewLimit - 0.025) {
            const stop = previewLimit;
            stopPreview();
            player.currentTime = stop;
        }
    }

    function addButton(parent, icon, title, handler, extraClass) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-sm bt-trim-btn ' + (extraClass || 'btn-outline-secondary');
        button.title = title;
        button.setAttribute('aria-label', title);
        button.innerHTML = '<i class="bi bi-' + icon + '" aria-hidden="true"></i>';
        button.addEventListener('click', handler);
        parent.appendChild(button);
        return button;
    }

    function updatePlayButton() {
        if (!playButton || !player) return;
        const playing = previewing && !player.paused;
        playButton.innerHTML = '<i class="bi bi-' + (playing ? 'stop-fill' : 'play-fill') + '"></i>';
        const title = playing ? label('Stop playback', 'Ferma riproduzione')
            : label('Play from current position', 'Riproduci dalla posizione corrente');
        playButton.title = title;
        playButton.setAttribute('aria-label', title);
    }

    function makeTimeField(parent, which) {
        const field = document.createElement('input');
        field.type = 'text';
        field.className = 'form-control form-control-sm bt-trim-time';
        field.inputMode = 'decimal';
        field.spellcheck = false;
        field.setAttribute('aria-label', which === 'start' ? label('Start', 'Inizio') : label('End', 'Fine'));
        field.title = label('Time (mm:ss.s)', 'Tempo (mm:ss.s)');
        const commit = () => {
            const n = parseTime(field.value);
            if (!Number.isFinite(n)) { sync(); return; }
            update(which, Math.round(n * 10) / 10, true);
        };
        field.addEventListener('change', commit);
        field.addEventListener('keydown', e => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                update(which, (which === 'start' ? start : end) + (e.key === 'ArrowUp' ? 0.1 : -0.1), true);
            } else if (e.key === 'Enter') {
                commit();
                field.blur();
            }
        });
        const box = document.createElement('div');
        box.className = 'bt-trim-field';
        box.appendChild(field);
        parent.appendChild(box);
        return field;
    }

    function makeRange(parent, which) {
        const range = document.createElement('input');
        range.type = 'range';
        range.className = 'bt-trim-range bt-trim-range-' + which;
        range.min = '0';
        range.max = '1';
        range.step = 'any';
        range.setAttribute('aria-label', which === 'start' ?
            label('Start marker', 'Indicatore di inizio') : label('End marker', 'Indicatore di fine'));
        range.addEventListener('input', () => {
            update(which, Math.round(Number(range.value) * 10) / 10, false);
        });
        range.addEventListener('change', () => {
            seekTo(which === 'start' ? start : end);
        });
        range.addEventListener('keydown', e => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            update(which, (which === 'start' ? start : end) + (e.key === 'ArrowRight' ? 0.1 : -0.1), true);
        });
        // Keep the selected handle above the other when both markers overlap.
        range.addEventListener('pointerdown', () => {
            if (startRange && endRange) {
                startRange.style.zIndex = which === 'start' ? '4' : '3';
                endRange.style.zIndex = which === 'end' ? '4' : '3';
            }
        });
        parent.appendChild(range);
        return range;
    }

    function injectStyle() {
        const style = document.createElement('style');
        style.id = 'bt-video-trim-style';
        style.textContent = `
            .bt-trim-container { margin-top: 3px; width: 100%; }
            .bt-trim-container:has(#bt-trim-panel[hidden]) { display: none; }
            #bt-trim-panel[hidden], #bt-trim-toggle[hidden] { display: none !important; }
            #bt-trim-toggle { width: 34px; min-width: 34px; padding: 5px 7px; }
            #bt-trim-panel {
                position: relative; padding: 5px 6px; border: 1px solid var(--ui-stroke);
                border-radius: 6px; background: var(--ui-card); color: var(--ui-text);
            }
            .bt-trim-row {
                display: flex; flex-wrap: nowrap; align-items: center;
                justify-content: space-between; gap: 5px; min-height: 30px;
            }
            #bt-trim-panel .bt-trim-btn {
                flex: 0 0 auto; width: 27px; min-width: 27px; height: 27px;
                margin: 0; padding: 2px; font-size: 14px; line-height: 1;
                border-radius: 5px; display: inline-flex; align-items: center;
                justify-content: center;
            }
            #bt-trim-panel .bt-trim-play { width: 29px; min-width: 29px; }
            #bt-trim-panel .bt-trim-apply { width: 31px; min-width: 31px; }
            .bt-trim-field { flex: 0 0 auto; border: 1px solid var(--ui-stroke);
                border-radius: 5px; padding: 2px; }
            #bt-trim-panel .bt-trim-time { width: 69px; height: 24px; padding: 2px 3px;
                text-align: center; font-size: 11px; border: 0; box-shadow: none !important;
                font-variant-numeric: tabular-nums; background: transparent;
                color: var(--ui-text); }
            .bt-trim-dual { flex: 1 1 auto; min-width: 150px; height: 26px;
                position: relative; margin: 0 2px; }
            .bt-trim-track { position: absolute; top: 11px; left: 0; width: 100%;
                height: 5px; border-radius: 5px; background: var(--ui-stroke); }
            .bt-trim-selected { position: absolute; top: 0; height: 100%;
                border-radius: inherit; background: var(--ui-accent); }
            #bt-trim-panel input.bt-trim-range {
                -webkit-appearance: none; appearance: none; position: absolute;
                inset: 0; width: 100%; height: 26px; margin: 0;
                background: transparent; pointer-events: none; cursor: pointer;
                touch-action: none;
            }
            #bt-trim-panel input.bt-trim-range::-webkit-slider-runnable-track {
                height: 5px; background: transparent; border: 0;
            }
            #bt-trim-panel input.bt-trim-range::-moz-range-track {
                height: 5px; background: transparent; border: 0;
            }
            #bt-trim-panel input.bt-trim-range::-webkit-slider-thumb {
                -webkit-appearance: none; appearance: none; pointer-events: auto;
                width: 15px; height: 20px; margin-top: -8px; border-radius: 4px;
                border: 2px solid var(--ui-card); background: var(--ui-accent);
                box-shadow: 0 0 0 1px var(--ui-stroke);
            }
            #bt-trim-panel input.bt-trim-range::-moz-range-thumb {
                pointer-events: auto; width: 13px; height: 18px; border-radius: 4px;
                border: 2px solid var(--ui-card); background: var(--ui-accent);
                box-shadow: 0 0 0 1px var(--ui-stroke);
            }
            #bt-trim-panel input.bt-trim-range:focus-visible::-webkit-slider-thumb {
                box-shadow: 0 0 0 2px var(--ui-accent);
            }
            #bt-trim-panel .bt-trim-duration { flex: 0 0 auto;
                white-space: nowrap; font-size: 11px; font-variant-numeric: tabular-nums;
                color: var(--ui-muted); min-width: 47px; text-align: center; }
            #bt-trim-status {
                position: absolute; right: 7px; bottom: calc(100% + 4px);
                background: var(--ui-card); border: 1px solid var(--ui-stroke);
                padding: 3px 8px; border-radius: 5px; z-index: 20; box-shadow: 0 4px 14px #0006;
                font-size: 11px; white-space: nowrap; pointer-events: none;
            }
            #bt-trim-status[hidden] { display: none !important; }
            @media (max-width: 700px) {
                #bt-trim-panel { overflow-x: auto; }
                .bt-trim-row { min-width: 590px; }
            }
        `;
        document.head.appendChild(style);
    }

    function buildUI() {
        if (initialized) return;
        player = document.getElementById('mangiacassette');
        const controlStrip = document.querySelector('.recorder-button-strip');
        const controlRow = document.querySelector('.recorder-controls-row');
        if (!player || !controlStrip || !controlRow) return;
        initialized = true;
        injectStyle();

        toggle = addButton(controlStrip, 'scissors',
            label('Trim video', 'Taglia video'), () => {
                panel.hidden = !panel.hidden;
                toggle.setAttribute('aria-expanded', String(!panel.hidden));
                if (!panel.hidden) { sync(); setStatus(''); }
                else stopPreview();
            }, 'btn-outline-secondary');
        toggle.id = 'bt-trim-toggle';
        toggle.classList.remove('bt-trim-btn');
        toggle.classList.add('btn');
        toggle.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'bt-trim-panel');

        const wrapper = document.createElement('div');
        wrapper.className = 'bt-trim-container';
        panel = document.createElement('div');
        panel.id = 'bt-trim-panel';
        panel.hidden = true;

        const row = document.createElement('div');
        row.className = 'bt-trim-row';
        addButton(row, 'play-fill',
            label('Play 2 seconds from start', 'Riproduci 2 secondi dall’inizio'),
            () => playSection(start, Math.min(end, start + 2)), 'btn-outline-primary');
        startInput = makeTimeField(row, 'start');

        const dual = document.createElement('div');
        dual.className = 'bt-trim-dual';
        dual.title = label('Drag a marker; release to seek. Arrow keys: 0.1 s.',
            'Trascina un indicatore; rilascia per il seek. Frecce: 0,1 s.');
        const track = document.createElement('div');
        track.className = 'bt-trim-track';
        selectedTrack = document.createElement('div');
        selectedTrack.className = 'bt-trim-selected';
        track.appendChild(selectedTrack);
        dual.appendChild(track);
        startRange = makeRange(dual, 'start');
        endRange = makeRange(dual, 'end');
        row.appendChild(dual);

        endInput = makeTimeField(row, 'end');
        addButton(row, 'play-fill',
            label('Play 2 seconds before end', 'Riproduci i 2 secondi prima della fine'),
            () => playSection(Math.max(start, end - 2), end), 'btn-outline-primary');
        playButton = addButton(row, 'play-circle',
            label('Play from current position', 'Riproduci dalla posizione corrente'),
            () => {
                if (previewing && !player.paused) stopPreview();
                else {
                    const position = Number(player.currentTime);
                    const from = Number.isFinite(position) && position >= start && position < end ?
                        position : start;
                    playSection(from, end);
                }
            }, 'btn-outline-primary bt-trim-play');
        lengthOutput = document.createElement('span');
        lengthOutput.className = 'bt-trim-duration';
        lengthOutput.title = label('Selected duration', 'Durata selezionata');
        row.appendChild(lengthOutput);
        addButton(row, 'arrow-counterclockwise',
            label('Reset selection', 'Ripristina selezione'),
            () => { start = 0; end = duration; sync(); }, 'btn-outline-secondary');
        applyButton = addButton(row, 'scissors',
            label('Apply trim', 'Applica taglio'), apply, 'btn-primary bt-trim-apply');
        panel.appendChild(row);

        status = document.createElement('div');
        status.id = 'bt-trim-status';
        status.hidden = true;
        status.setAttribute('role', 'status');
        panel.appendChild(status);
        wrapper.appendChild(panel);
        controlRow.insertAdjacentElement('afterend', wrapper);

        let ticker = null;
        const tick = () => {
            onTimeUpdate();
            ticker = !player.paused ? requestAnimationFrame(tick) : null;
        };
        player.addEventListener('timeupdate', onTimeUpdate);
        player.addEventListener('play', () => {
            if (ticker !== null) cancelAnimationFrame(ticker);
            tick();
            updatePlayButton();
        });
        player.addEventListener('pause', () => {
            if (ticker !== null) cancelAnimationFrame(ticker);
            ticker = null;
            updatePlayButton();
        });
        player.addEventListener('loadedmetadata', () => {
            if (!sourceBlob) return;
            if (Number.isFinite(player.duration) && player.duration > 0) {
                duration = player.duration;
                start = 0;
                end = duration;
                sync();
            }
        });
    }

    async function detectKeyframe(ffmpeg, from, until) {
        let windowSeconds = 8;
        for (let attempt = 0; attempt < 8; attempt++) {
            const filename = 'bt-trim-keyframes-' + attempt + '.json';
            const maxWindow = Math.min(windowSeconds, Math.max(0.01, until - from));
            try {
                // ffprobe.wasm may report -1 even when the JSON output is valid.
                await ffmpeg.ffprobe([
                    '-v', 'error', '-select_streams', 'v:0',
                    '-read_intervals', precise(from) + '%+' + precise(maxWindow),
                    '-show_packets', '-show_entries', 'packet=pts_time,flags',
                    '-of', 'json', '-i', 'bt-trim-input.webm', '-o', filename
                ]);
                const bytes = await ffmpeg.readFile(filename);
                const json = JSON.parse(new TextDecoder().decode(bytes));
                const keyframes = (json.packets || [])
                    .filter(p => String(p.flags || '').includes('K'))
                    .map(p => Number(p.pts_time))
                    .filter(t => Number.isFinite(t) && t > from + 0.001 && t < until - 0.001)
                    .sort((a, b) => a - b);
                if (keyframes.length) return keyframes[0];
            } catch (err) {
                throw new Error(label('Keyframe detection failed: ', 'Rilevamento keyframe fallito: ') + err.message);
            } finally {
                await ffmpeg.deleteFile(filename).catch(() => {});
            }
            if (maxWindow >= until - from - epsilon) break;
            windowSeconds *= 2;
        }
        return null;
    }

    async function apply() {
        if (busy || !sourceBlob || !window.ffmpeg || !window.fetchFile ||
            !window.btRunConversion || !window.btApplyTrimResult) {
            setStatus(label('FFmpeg is not ready.', 'FFmpeg non è pronto.'), true);
            return;
        }
        const clipStart = start, clipEnd = end, blob = sourceBlob;
        if (clipEnd - clipStart <= 0.1) return;
        busy = true;
        previewing = false;
        player.pause();
        sync();
        setStatus(label('Processing video…', 'Elaborazione video…'));
        const ffmpeg = window.ffmpeg;
        const files = ['bt-trim-input.webm', 'bt-trim-head.webm', 'bt-trim-tail.webm',
            'bt-trim-list.txt', 'bt-trim-result.webm'];
        const fmt = n => precise(n);
        try {
            const result = await window.btRunConversion(async () => {
                try {
                    await ffmpeg.writeFile(files[0], await window.fetchFile(blob));
                    const key = await detectKeyframe(ffmpeg, clipStart, clipEnd);
                    const headDuration = key === null ? clipEnd - clipStart : key - clipStart;
                    setStatus(label('Encoding the start…', 'Ricodifica del segmento iniziale…'));
                    const headArgs = [
                        '-y', '-ss', fmt(clipStart), '-i', files[0], '-t', fmt(headDuration),
                        '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libvpx',
                        '-deadline', 'realtime', '-cpu-used', '7', '-threads:v', '2',
                        '-b:v', '2500k', '-fps_mode', 'passthrough',
                        '-c:a', 'opus', '-strict', '-2', files[1]
                    ];
                    const headCode = await ffmpeg.exec(headArgs);
                    if (headCode !== 0) throw new Error('VP8/Opus encoding failed (' + headCode + ')');
                    if (key === null) return new Blob([await ffmpeg.readFile(files[1])], { type: 'video/webm' });

                    setStatus(label('Copying the remaining video…', 'Copia del resto del video…'));
                    const tailCode = await ffmpeg.exec([
                        '-y', '-ss', fmt(key), '-i', files[0], '-t', fmt(clipEnd - key),
                        '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
                        '-avoid_negative_ts', 'make_zero', files[2]
                    ]);
                    if (tailCode !== 0) throw new Error('Stream copy failed (' + tailCode + ')');
                    await ffmpeg.writeFile(files[3], new TextEncoder().encode(
                        "file 'bt-trim-head.webm'\nfile 'bt-trim-tail.webm'\n"));
                    setStatus(label('Joining segments…', 'Unione dei segmenti…'));
                    const concatCode = await ffmpeg.exec([
                        '-y', '-f', 'concat', '-safe', '0', '-i', files[3],
                        '-c', 'copy', files[4]
                    ]);
                    if (concatCode !== 0) throw new Error('Concatenation failed (' + concatCode + ')');
                    return new Blob([await ffmpeg.readFile(files[4])], { type: 'video/webm' });
                } finally {
                    await Promise.allSettled(files.map(f => ffmpeg.deleteFile(f)));
                }
            });
            window.btApplyTrimResult(result);
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            toggle.title = label('Trim completed', 'Taglio completato');
        } catch (err) {
            console.error('Video trim failed:', err);
            setStatus(label('Trim failed: ', 'Taglio non riuscito: ') + (err.message || err), true);
        } finally {
            busy = false;
            sync();
        }
    }

    window.BTVideoTrim = {
        onRecording(blob, filename) {
            buildUI();
            sourceBlob = blob && blob.type.startsWith('video/') ? blob : null;
            sourceName = filename || '';
            previewing = false;
            duration = 0;
            start = 0;
            end = 0;
            toggle.hidden = !sourceBlob;
            updatePlayButton();
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            if (status) setStatus('');
            previewLimit = null;
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
    else buildUI();
})();
