/* Experimental non-destructive WebM trimmer. Uses the shared FFmpeg.wasm instance. */
(function () {
    'use strict';

    let sourceBlob = null;
    let sourceName = '';
    let duration = 0;
    let start = 0;
    let end = 0;
    let previewing = false;
    let busy = false;
    let initialized = false;
    let player, panel, toggle, startInput, endInput, lengthOutput, positionOutput, status, applyButton, playButton;
    const epsilon = 0.002;

    function label(en, it) {
        return window.BTI18n ? BTI18n.message(en, it) : en;
    }

    function stamp(seconds) {
        seconds = Math.max(0, Number(seconds) || 0);
        const minutes = Math.floor(seconds / 60);
        const sec = (seconds % 60).toFixed(1).padStart(4, '0');
        return String(minutes).padStart(2, '0') + ':' + sec;
    }

    function precise(seconds) {
        return (Math.round(seconds * 1000) / 1000).toFixed(3);
    }

    function setStatus(message, error) {
        status.textContent = message || '';
        status.classList.toggle('text-danger', !!error);
    }

    function sync() {
        startInput.value = precise(start);
        endInput.value = precise(end);
        lengthOutput.textContent = stamp(end - start);
        applyButton.disabled = busy || !sourceBlob || end <= start + epsilon ||
            (start <= epsilon && end >= duration - epsilon);
    }

    function updateFromField(which) {
        const field = which === 'start' ? startInput : endInput;
        const value = Number(field.value);
        if (!Number.isFinite(value)) { sync(); return; }
        if (which === 'start') start = Math.max(0, Math.min(value, end - 0.1));
        else end = Math.max(start + 0.1, Math.min(duration, value));
        sync();
    }

    function seekTo(time) {
        if (!player || !Number.isFinite(player.duration)) return;
        player.pause();
        previewing = false;
        player.currentTime = Math.max(0, Math.min(duration, time));
    }

    async function seekAndPlay(time) {
        if (!player || !Number.isFinite(player.duration)) return;
        player.pause();
        player.currentTime = Math.max(0, Math.min(duration, time));
        previewing = true;
        try { await player.play(); } catch (err) {
            previewing = false;
            setStatus(String(err.message || err), true);
        }
    }

    function onTimeUpdate() {
        positionOutput.textContent = stamp(player.currentTime);
        if (previewing && player.currentTime >= end - 0.035) {
            player.pause();
            player.currentTime = end;
            previewing = false;
        }
    }

    function addButton(parent, icon, title, callback, className, text) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = className || 'btn btn-sm btn-outline-secondary bt-trim-btn';
        button.title = title;
        button.setAttribute('aria-label', title);
        button.innerHTML = icon ? '<i class="bi bi-' + icon + '" aria-hidden="true"></i>' : '';
        if (text) button.appendChild(document.createTextNode(text));
        button.addEventListener('click', callback);
        parent.appendChild(button);
        return button;
    }

    function makeField(parent, kind) {
        const isStart = kind === 'start';
        const group = document.createElement('div');
        group.className = 'bt-trim-group';
        const fieldLabel = document.createElement('label');
        fieldLabel.className = 'bt-trim-label';
        fieldLabel.textContent = isStart ? label('Start', 'Inizio') : label('End', 'Fine');
        group.appendChild(fieldLabel);

        const row = document.createElement('div');
        row.className = 'bt-trim-group-row';
        if (isStart) {
            addButton(row, 'skip-start',
                label('Go to selection start', 'Vai all’inizio della selezione'),
                () => seekTo(start));
        }
        addButton(row, 'dash', label('Back 0.1 s', 'Indietro di 0,1 s'), () => {
            input.value = precise(Number(input.value) - 0.1);
            updateFromField(kind);
        });
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '0.1';
        input.className = 'form-control form-control-sm bt-trim-time';
        input.setAttribute('aria-label', fieldLabel.textContent);
        input.addEventListener('change', () => updateFromField(kind));
        row.appendChild(input);
        addButton(row, 'plus', label('Forward 0.1 s', 'Avanti di 0,1 s'), () => {
            input.value = precise(Number(input.value) + 0.1);
            updateFromField(kind);
        });
        if (!isStart) {
            addButton(row, 'skip-end',
                label('Go to selection end', 'Vai alla fine della selezione'),
                () => seekTo(end));
        }
        addButton(row, 'geo-alt-fill',
            label('Set to current position', 'Imposta alla posizione corrente'),
            () => {
                const current = Number(player.currentTime);
                if (!Number.isFinite(current)) return;
                if (isStart) start = Math.max(0, Math.min(current, end - 0.1));
                else end = Math.min(duration, Math.max(current, start + 0.1));
                sync();
            }, 'btn btn-sm btn-primary bt-trim-btn bt-trim-pin');

        group.appendChild(row);
        parent.appendChild(group);
        return input;
    }

    function updatePlayButton() {
        if (!playButton) return;
        const playing = !player.paused && previewing;
        const title = playing ? label('Stop preview', 'Ferma anteprima')
            : label('Play selection', 'Riproduci selezione');
        playButton.title = title;
        playButton.setAttribute('aria-label', title);
        playButton.innerHTML = '<i class="bi bi-' + (playing ? 'stop-fill' : 'play-fill') + '" aria-hidden="true"></i>';
    }

    function injectStyle() {
        const style = document.createElement('style');
        style.id = 'bt-video-trim-style';
        style.textContent = `
            .bt-trim-container { width: 100%; margin-top: 4px; text-align: left; }
            .bt-trim-container:has(#bt-trim-panel[hidden]) { display: none; }
            #bt-trim-panel[hidden], #bt-trim-toggle[hidden] { display: none !important; }
            #bt-trim-toggle { width: 34px; min-width: 34px; padding: 5px 7px; }
            #bt-trim-panel {
                padding: 8px 10px; border: 1px solid var(--ui-stroke);
                border-radius: 7px; background: var(--ui-card); color: var(--ui-text);
            }
            .bt-trim-top { display: flex; justify-content: center; align-items: end; flex-wrap: wrap; gap: 7px; }
            .bt-trim-group { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
            .bt-trim-label { font-size: 11px; color: var(--ui-muted); line-height: 1.1; }
            .bt-trim-group-row { display: flex; align-items: center; gap: 3px; }
            #bt-trim-panel .bt-trim-btn {
                flex: 0 0 auto; min-width: 25px; width: 25px; height: 27px;
                padding: 2px 3px; font-size: 13px; line-height: 1;
                border-radius: 5px; margin: 0; display: inline-flex;
                align-items: center; justify-content: center;
            }
            #bt-trim-panel .bt-trim-pin { min-width: 28px; width: 28px; font-size: 15px; }
            #bt-trim-panel .bt-trim-play {
                min-width: 32px; width: 32px; height: 32px;
                align-self: end; margin-bottom: 0; font-size: 17px;
            }
            #bt-trim-panel .bt-trim-time {
                width: 81px; min-width: 0; height: 27px; padding: 2px 4px;
                font-size: 12px; text-align: center; font-variant-numeric: tabular-nums;
                border-radius: 5px; appearance: textfield; -moz-appearance: textfield;
            }
            #bt-trim-panel .bt-trim-time::-webkit-inner-spin-button,
            #bt-trim-panel .bt-trim-time::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
            .bt-trim-bottom { margin-top: 7px; display: flex; align-items: center;
                justify-content: space-between; flex-wrap: wrap; gap: 6px; }
            .bt-trim-summary { font-size: 11px; color: var(--ui-muted); font-variant-numeric: tabular-nums; }
            .bt-trim-actions { display: flex; gap: 4px; align-items: center; }
            #bt-trim-panel .bt-trim-reset { font-size: 17px; width: 28px; height: 27px; }
            #bt-trim-panel .bt-trim-apply { width: auto; min-width: 85px; height: 27px;
                gap: 5px; padding: 3px 8px; font-size: 11px; font-weight: 600; }
            #bt-trim-status:empty { display: none; }
            #bt-trim-status { font-size: 11px; margin-top: 4px; }
            @media(max-width: 620px) {
                .bt-trim-top { justify-content: center; gap: 6px; }
                .bt-trim-group-row { gap: 2px; }
                #bt-trim-panel .bt-trim-time { width: 70px; }
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
                if (!panel.hidden) sync();
            }, 'btn btn-sm btn-outline-secondary');
        toggle.id = 'bt-trim-toggle';
        toggle.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', 'bt-trim-panel');

        const wrapper = document.createElement('div');
        wrapper.className = 'bt-trim-container';
        panel = document.createElement('div');
        panel.id = 'bt-trim-panel';
        panel.hidden = true;

        const top = document.createElement('div');
        top.className = 'bt-trim-top';
        startInput = makeField(top, 'start');
        playButton = addButton(top, 'play-fill',
            label('Play selection', 'Riproduci selezione'), async () => {
                if (previewing && !player.paused) {
                    player.pause();
                    previewing = false;
                    updatePlayButton();
                } else {
                    await seekAndPlay(start);
                    updatePlayButton();
                }
            }, 'btn btn-sm btn-outline-primary bt-trim-btn bt-trim-play');
        endInput = makeField(top, 'end');
        panel.appendChild(top);

        const bottom = document.createElement('div');
        bottom.className = 'bt-trim-bottom';
        const summary = document.createElement('div');
        summary.className = 'bt-trim-summary';
        summary.appendChild(document.createTextNode(label('Duration: ', 'Durata: ')));
        lengthOutput = document.createElement('strong');
        summary.appendChild(lengthOutput);
        summary.appendChild(document.createTextNode('  ·  ' + label('Position: ', 'Posizione: ')));
        positionOutput = document.createElement('span');
        summary.appendChild(positionOutput);
        bottom.appendChild(summary);

        const actions = document.createElement('div');
        actions.className = 'bt-trim-actions';
        addButton(actions, null, label('Reset selection', 'Ripristina selezione'), () => {
            start = 0;
            end = duration;
            sync();
        }, 'btn btn-sm btn-outline-secondary bt-trim-btn bt-trim-reset', '↺');
        applyButton = addButton(actions, 'scissors',
            label('Apply trim', 'Applica taglio'), apply,
            'btn btn-sm btn-primary bt-trim-btn bt-trim-apply',
            label('Apply', 'Applica'));
        bottom.appendChild(actions);
        panel.appendChild(bottom);

        status = document.createElement('div');
        status.id = 'bt-trim-status';
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
            updatePlayButton();
            tick();
        });
        player.addEventListener('pause', () => {
            previewing = false;
            updatePlayButton();
            if (ticker !== null) cancelAnimationFrame(ticker);
            ticker = null;
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
            setStatus(label('Trim completed.', 'Taglio completato.'));
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
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
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
    else buildUI();
})();
