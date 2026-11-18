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
    let player, panel, toggle, startInput, endInput, lengthOutput, positionOutput, status, applyButton;
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

    function addButton(parent, text, title, callback, className) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = className || 'btn btn-sm btn-outline-secondary';
        b.textContent = text;
        b.title = title;
        b.addEventListener('click', callback);
        parent.appendChild(b);
        return b;
    }

    function makeField(parent, kind) {
        const group = document.createElement('div');
        group.className = 'col-12 col-md-6';
        const row = document.createElement('div');
        row.className = 'd-flex align-items-center gap-1 flex-wrap';
        const fieldLabel = document.createElement('label');
        fieldLabel.className = 'form-label small mb-1 d-block';
        fieldLabel.textContent = kind === 'start' ? label('Start', 'Inizio') : label('End', 'Fine');
        const input = document.createElement('input');
        input.type = 'number';
        input.min = '0';
        input.step = '0.1';
        input.className = 'form-control form-control-sm bt-trim-time';
        input.setAttribute('aria-label', fieldLabel.textContent);
        input.addEventListener('change', () => updateFromField(kind));
        addButton(row, '-', label('Back 0.1 s', 'Indietro di 0,1 s'), () => {
            input.value = precise(Number(input.value) - 0.1);
            updateFromField(kind);
        });
        row.appendChild(input);
        addButton(row, '+', label('Forward 0.1 s', 'Avanti di 0,1 s'), () => {
            input.value = precise(Number(input.value) + 0.1);
            updateFromField(kind);
        });
        addButton(row, kind === 'start' ? '|◀' : '▶|',
            label('Seek to this position', 'Vai a questa posizione'), () => {
                seekTo(kind === 'start' ? start : end);
            });
        addButton(row, '●', label('Set to current playback position', 'Imposta alla posizione corrente'), () => {
            const current = Number(player.currentTime);
            if (kind === 'start') start = Math.max(0, Math.min(current, end - 0.1));
            else end = Math.min(duration, Math.max(current, start + 0.1));
            sync();
        });
        group.appendChild(fieldLabel);
        group.appendChild(row);
        parent.appendChild(group);
        return input;
    }

    function buildUI() {
        if (initialized) return;
        initialized = true;
        player = document.getElementById('mangiacassette');
        const stage = document.getElementById('rec-preview-stage');
        if (!player || !stage) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'bt-trim-container text-start mt-2';
        toggle = addButton(wrapper, '✂ ' + label('Trim video', 'Taglia video'),
            label('Trim recording', 'Taglia la registrazione'), () => {
                panel.hidden = !panel.hidden;
                toggle.setAttribute('aria-expanded', String(!panel.hidden));
                if (!panel.hidden) sync();
            }, 'btn btn-sm btn-outline-secondary');
        toggle.id = 'bt-trim-toggle';
        toggle.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');

        panel = document.createElement('div');
        panel.id = 'bt-trim-panel';
        panel.className = 'border rounded p-2 mt-2';
        panel.hidden = true;
        const heading = document.createElement('div');
        heading.className = 'small mb-2';
        heading.textContent = label('Select the portion to keep', 'Seleziona la porzione da conservare');
        panel.appendChild(heading);

        const fields = document.createElement('div');
        fields.className = 'row g-2';
        startInput = makeField(fields, 'start');
        endInput = makeField(fields, 'end');
        panel.appendChild(fields);

        const summary = document.createElement('div');
        summary.className = 'small mt-2';
        summary.appendChild(document.createTextNode(label('Result duration: ', 'Durata risultante: ')));
        lengthOutput = document.createElement('strong');
        summary.appendChild(lengthOutput);
        summary.appendChild(document.createTextNode(' · ' + label('Position: ', 'Posizione: ')));
        positionOutput = document.createElement('span');
        summary.appendChild(positionOutput);
        panel.appendChild(summary);

        const buttons = document.createElement('div');
        buttons.className = 'd-flex flex-wrap gap-1 mt-2';
        addButton(buttons, '|◀', label('Go to start', 'Vai all’inizio'), () => seekTo(start));
        addButton(buttons, '▶', label('Play selection', 'Riproduci selezione'), () => seekAndPlay(start),
            'btn btn-sm btn-outline-primary');
        addButton(buttons, '▶|', label('Go to end', 'Vai alla fine'), () => seekTo(end));
        addButton(buttons, label('Reset', 'Ripristina'), label('Select full video', 'Seleziona tutto'), () => {
            start = 0; end = duration; sync();
        });
        applyButton = addButton(buttons, '✂ ' + label('Apply trim', 'Applica taglio'),
            label('Encode and replace download', 'Elabora e sostituisci il download'), apply,
            'btn btn-sm btn-primary ms-auto');
        panel.appendChild(buttons);

        status = document.createElement('div');
        status.className = 'small mt-2';
        status.setAttribute('role', 'status');
        panel.appendChild(status);
        wrapper.appendChild(panel);
        stage.insertAdjacentElement('afterend', wrapper);

        player.addEventListener('timeupdate', onTimeUpdate);
        player.addEventListener('pause', () => { previewing = false; });
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
            panel.hidden = true;
            toggle.setAttribute('aria-expanded', 'false');
            if (status) setStatus('');
        }
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
    else buildUI();
})();
