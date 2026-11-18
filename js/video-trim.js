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
        status.classList.toggle('text-danger', !!error);
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function sync() {
        if (!startInput || !endInput || !startRange || !endRange) return;
        startInput.value = start.toFixed(1);
        endInput.value = end.toFixed(1);
        startInput.max = String(Math.max(0, end - 0.1));
        endInput.min = String(Math.min(duration, start + 0.1));
        endInput.max = String(duration);
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
        button.innerHTML = icon === 'bar-arrow-right-custom'
            ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">' +
              '<path d="M12.5 15a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 1 0v13a.5.5 0 0 1-.5.5"/>' +
              '<path fill-rule="evenodd" transform="translate(12 0) scale(-1 1)" d="M10 8a.5.5 0 0 1-.5.5H3.707l2.147 2.146a.5.5 0 0 1-.708.708l-3-3a.5.5 0 0 1 0-.708l3-3a.5.5 0 1 1 .708.708L3.707 7.5H9.5a.5.5 0 0 1 .5.5"/>' +
              '</svg>'
            : '<i class="bi bi-' + icon + '" aria-hidden="true"></i>';
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
        field.type = 'number';
        field.className = 'form-control form-control-sm bt-trim-time';
        field.min = '0';
        field.step = '0.1';
        field.inputMode = 'decimal';
        field.setAttribute('aria-label', which === 'start' ? label('Start (seconds)', 'Inizio (secondi)') : label('End (seconds)', 'Fine (secondi)'));
        field.title = label('Time in seconds (0.1 s steps)', 'Tempo in secondi (passi di 0,1 s)');
        field.addEventListener('change', () => {
            const n = Number(field.value);
            if (field.value.trim() === '' || !Number.isFinite(n)) { sync(); return; }
            update(which, Math.round(n * 10) / 10, true);
        });
        field.addEventListener('input', () => {
            // Native number spinner also emits input, including while its arrows are held.
            const n = Number(field.value);
            if (field.value.trim() !== '' && Number.isFinite(n))
                update(which, Math.round(n * 10) / 10, false);
        });
        field.addEventListener('blur', () => sync());
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
                display: flex; align-items: center; gap: 14px;
                padding: 3px 7px; border: 1px solid var(--ui-stroke);
                border-radius: 6px; background: var(--ui-card); color: var(--ui-text);
                min-width: 0;
            }
            .bt-trim-controls { display: flex; flex: 1 1 auto; min-width: 0;
                flex-direction: column; gap: 0; text-align: left; }
            .bt-trim-caption { color: var(--ui-muted); font-size: 10px;
                line-height: 12px; height: 12px; }
            .bt-trim-row { display: flex; flex: 1 1 auto; align-items: center;
                gap: 4px; min-height: 28px; }
            .bt-trim-actions { flex: 0 0 auto; display: flex; gap: 5px;
                align-items: center; justify-content: flex-end; }
            #bt-trim-panel .bt-trim-btn { flex: 0 0 auto; width: 27px; min-width: 27px;
                height: 27px; margin: 0; padding: 2px; font-size: 14px;
                line-height: 1; border-radius: 5px; display: inline-flex;
                justify-content: center; align-items: center; }
            #bt-trim-panel .bt-trim-apply { width: 31px; min-width: 31px; }
            .bt-trim-field { flex: 0 0 auto; border: 1px solid var(--ui-stroke);
                border-radius: 5px; padding: 2px; }
            #bt-trim-panel .bt-trim-time { width: 73px; height: 23px; padding: 2px 1px;
                text-align: center; font-size: 10.5px; border: 0; box-shadow: none !important;
                font-variant-numeric: tabular-nums; background: transparent; color: var(--ui-text); }
            .bt-trim-dual { flex: 1 1 auto; min-width: 170px; height: 26px;
                position: relative; margin: 0 2px; }
            .bt-trim-track { position: absolute; top: 11px; left: 0;
                width: 100%; height: 5px; border-radius: 5px; background: var(--ui-stroke); }
            .bt-trim-selected { position: absolute; top: 0; height: 100%;
                border-radius: inherit; background: var(--ui-accent); }
            #bt-trim-panel input.bt-trim-range { -webkit-appearance: none; appearance: none;
                position: absolute; inset: 0; width: 100%; height: 26px;
                margin: 0; background: transparent; pointer-events: none;
                cursor: pointer; touch-action: none; }
            #bt-trim-panel input.bt-trim-range::-webkit-slider-runnable-track {
                height: 5px; background: transparent; border: 0; }
            #bt-trim-panel input.bt-trim-range::-moz-range-track {
                height: 5px; background: transparent; border: 0; }
            #bt-trim-panel input.bt-trim-range::-webkit-slider-thumb {
                -webkit-appearance: none; appearance: none; pointer-events: auto;
                width: 15px; height: 20px; margin-top: -8px; border-radius: 4px;
                border: 2px solid var(--ui-card); background: var(--ui-accent);
                box-shadow: 0 0 0 1px var(--ui-stroke); }
            #bt-trim-panel input.bt-trim-range::-moz-range-thumb {
                pointer-events: auto; width: 13px; height: 18px; border-radius: 4px;
                border: 2px solid var(--ui-card); background: var(--ui-accent);
                box-shadow: 0 0 0 1px var(--ui-stroke); }
            #bt-trim-panel input.bt-trim-range:focus-visible::-webkit-slider-thumb {
                box-shadow: 0 0 0 2px var(--ui-accent); }
            #bt-trim-panel .bt-trim-duration {
                position: absolute; z-index: 5; top: -7px; left: 50%;
                transform: translateX(-50%); white-space: nowrap; pointer-events: none;
                font-size: 10px; line-height: 12px; font-variant-numeric: tabular-nums;
                color: var(--ui-text); background: var(--ui-card); padding: 0 4px;
                border-radius: 3px; }
            #bt-trim-status {
                height: 12px; line-height: 12px; flex: 0 0 12px;
                font-size: 10px; overflow: hidden; white-space: nowrap;
                text-overflow: ellipsis; color: var(--ui-muted); }
            #bt-trim-status:empty::after { content: ' '; }
            @media (max-width: 700px) {
                #bt-trim-panel { overflow-x: auto; }
                .bt-trim-controls { min-width: 370px; }
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

        // Single compact flex panel: edit controls on the left, actions on the right.
        const controls = document.createElement('div');
        controls.className = 'bt-trim-controls';
        const caption = document.createElement('div');
        caption.className = 'bt-trim-caption';
        caption.textContent = label('Select the portion to keep', 'Seleziona la parte da conservare');
        controls.appendChild(caption);

        const row = document.createElement('div');
        row.className = 'bt-trim-row';
        addButton(row, 'arrow-bar-right',
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
        lengthOutput = document.createElement('span');
        lengthOutput.className = 'bt-trim-duration';
        lengthOutput.title = label('Selected duration', 'Durata selezionata');
        dual.appendChild(lengthOutput);
        row.appendChild(dual);

        endInput = makeTimeField(row, 'end');
        addButton(row, 'bar-arrow-right-custom',
            label('Play 2 seconds before end', 'Riproduci i 2 secondi prima della fine'),
            () => playSection(Math.max(start, end - 2), end), 'btn-outline-primary');
        controls.appendChild(row);

        status = document.createElement('div');
        status.id = 'bt-trim-status';
        status.setAttribute('role', 'status');
        controls.appendChild(status);
        panel.appendChild(controls);

        const actions = document.createElement('div');
        actions.className = 'bt-trim-actions';
        applyButton = addButton(actions, 'check-lg',
            label('Apply trim', 'Applica taglio'), apply, 'btn-primary bt-trim-apply');
        panel.appendChild(actions);
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
            panel.hidden = false;
            toggle.setAttribute('aria-expanded', 'true');
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
