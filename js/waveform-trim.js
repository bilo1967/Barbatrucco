/* Barbatrucco's embedded waveform editor and FFmpeg.wasm trimming bridge. */
(() => {
  'use strict';

  // Format FFmpeg timestamps without accumulating fractional errors.
  const precise = n => (Math.round(n * 1000) / 1000).toFixed(3);

  // Restrict iframe messages to our own origin.
  const origin = location.origin;

  // Track current media, dialog elements and the conversion lifecycle.
  let source = null;
  let sourceName = '';
  let trigger = null;
  let overlay = null;
  let frame = null;
  let active = false;
  let busy = false;
  let ready = false;

  // Send a typed message to the loaded editor only after its handshake.
  function message(type, props = {}) {
    if (ready) frame.contentWindow?.postMessage({ type, ...props }, origin);
  }

  // Report FFmpeg progress or errors in the editor's status area.
  function report(s, error = false) {
    message('bt-waveform-status', { message: s, error });
  }

  // Toggle the editor's spinner and disable controls while FFmpeg is working.
  function processingState(value) {
    message('bt-waveform-status', {
      processing: value,
      message: value ? 'Elaborazione in corso…' : ''
    });
  }

  // Translate the scissors button to match the application's selected language.
  function updateLabel() {
    if (!trigger) return;
    // Read the shared i18n service after its initialization.
    const it = window.BTI18n?.lang === 'it';
    trigger.innerHTML =
      '<i class="bi bi-scissors" aria-hidden="true"></i> ' + (it ? 'Ritaglia' : 'Cut');
    trigger.title = it ? 'Ritaglia registrazione' : 'Trim recording';
    trigger.setAttribute('aria-label', trigger.title);
  }

  // Create the scissors button and fullscreen embedded editor on demand.
  function ensureUI() {
    if (trigger) return;
    // Mount beside the existing recorder controls.
    const strip = document.querySelector('.recorder-button-strip');
    if (!strip) return;

    trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'btn btn-sm btn-outline-secondary';
    trigger.hidden = true;
    trigger.addEventListener('click', open);
    strip.appendChild(trigger);
    updateLabel();

    overlay = document.createElement('div');
    overlay.id = 'bt-waveform-overlay';
    overlay.hidden = true;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Editor di ritaglio');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '10050',
      background: '#0c1422'
    });

    frame = document.createElement('iframe');
    frame.title = 'Editor di ritaglio';
    frame.style.cssText = 'display:block;width:100%;height:100%;border:0;';
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
  }

  // Open the isolated editor, stopping playback in the main recorder first.
  async function open() {
    if (!source || busy || active) return;
    ensureUI();
    active = true;
    ready = false;
    overlay.hidden = false;
    document.getElementById('mangiacassette')?.pause();
    frame.dataset.waveformEmbedded = '1';

    try {
      // srcdoc bypasses server framing restrictions without weakening headers.
      const response = await fetch('editor.html', { cache: 'no-cache' });
      if (!response.ok) throw Error('HTTP ' + response.status);
      // Load the editor document without navigating the iframe URL.
      const html = await response.text();
      if (!active) return;
      frame.srcdoc = html;
    } catch (err) {
      console.error('Unable to open waveform editor:', err);
      if (active) {
        overlay.hidden = true;
        active = false;
        alert('Impossibile aprire l’editor: ' + (err.message || err));
      }
    }
  }

  // Return to Barbatrucco, releasing the iframe and restoring button focus.
  function close() {
    if (busy) return;
    active = false;
    ready = false;
    overlay.hidden = true;
    frame.removeAttribute('srcdoc');
    frame.src = 'about:blank';
    trigger?.focus();
  }

  // Locate the first usable keyframe after the selected start time.
  async function detectKeyframe(ffmpeg, from, until) {
    let span = 8;
    for (let attempt = 0; attempt < 8; attempt++) {
      // Use a unique temporary ffprobe JSON output for each attempt.
      const name = 'bt-wave-keyframes-' + attempt + '.json';
      // Limit the probe window to the selected clip.
      const seconds = Math.min(span, Math.max(.01, until - from));
      try {
        await ffmpeg.ffprobe([
          '-v', 'error', '-select_streams', 'v:0',
          '-read_intervals', precise(from) + '%+' + precise(seconds),
          '-show_packets', '-show_entries', 'packet=pts_time,flags',
          '-of', 'json', '-i', 'bt-wave-input.webm', '-o', name
        ]);
        // Parse packet metadata to find keyframes safely inside the selection.
        const data = JSON.parse(new TextDecoder().decode(await ffmpeg.readFile(name)));
        // Keep valid keyframe timestamps in ascending order.
        const frames = (data.packets || [])
          .filter(p => String(p.flags || '').includes('K'))
          .map(p => Number(p.pts_time))
          .filter(t => Number.isFinite(t) && t > from + .001 && t < until - .001)
          .sort((a, b) => a - b);
        if (frames.length) return frames[0];
      } finally {
        await ffmpeg.deleteFile(name).catch(() => {});
      }
      if (seconds >= until - from - .001) break;
      span *= 2;
    }
    return null;
  }

  // Trim media in FFmpeg.wasm and update the downloadable recorder output.
  async function apply(a, b) {
    if (busy || !source) return;
    if (!window.ffmpeg || !window.fetchFile ||
        !window.btRunConversion || !window.btApplyWaveformTrimResult) {
      report('FFmpeg.wasm non è ancora pronto.', true);
      return;
    }
    if (!Number.isFinite(a) || !Number.isFinite(b) || a < 0 || b <= a + .1) {
      report('Intervallo non valido.', true);
      return;
    }

    // Snapshot the selected media; it may be replaced after the conversion.
    const blob = source;
    const oldName = sourceName;
    const isVideo = blob.type.startsWith('video/');
    // Reserve unique FFmpeg virtual filesystem names for this operation.
    const ffmpeg = window.ffmpeg;
    const files = [
      'bt-wave-input.webm', 'bt-wave-head.webm', 'bt-wave-tail.webm',
      'bt-wave-list.txt', 'bt-wave-result.webm'
    ];
    busy = true;
    processingState(true);
    report('Elaborazione video…');

    try {
      // Serialize FFmpeg use with the recorder's other conversions.
      const result = await window.btRunConversion(async () => {
        try {
          await ffmpeg.writeFile(files[0], await window.fetchFile(blob));
          if (!isVideo) {
            report('Ritaglio audio…');
            // Audio-only files can be encoded directly to Opus.
            const code = await ffmpeg.exec([
              '-y', '-ss', precise(a), '-i', files[0], '-t', precise(b - a),
              '-vn', '-c:a', 'opus', '-strict', '-2', files[4]
            ]);
            if (code !== 0) throw Error('Codifica audio fallita (' + code + ')');
            return new Blob([await ffmpeg.readFile(files[4])], { type: 'audio/webm' });
          }

          // Re-encode the first segment up to the next keyframe.
          const key = await detectKeyframe(ffmpeg, a, b);
          const headDuration = key === null ? b - a : key - a;
          report('Ricodifica del segmento iniziale…');
          const headCode = await ffmpeg.exec([
            '-y', '-ss', precise(a), '-i', files[0], '-t', precise(headDuration),
            '-map', '0:v:0', '-map', '0:a?', '-c:v', 'libvpx',
            '-deadline', 'realtime', '-cpu-used', '7', '-threads:v', '2',
            '-b:v', '2500k', '-fps_mode', 'passthrough',
            '-c:a', 'opus', '-strict', '-2', files[1]
          ]);
          if (headCode !== 0) throw Error('Codifica VP8/Opus fallita (' + headCode + ')');
          if (key === null) {
            return new Blob([await ffmpeg.readFile(files[1])], { type: 'video/webm' });
          }

          // Copy the remaining video stream without further encoding.
          report('Copia del segmento finale…');
          const tail = await ffmpeg.exec([
            '-y', '-ss', precise(key), '-i', files[0], '-t', precise(b - key),
            '-map', '0:v:0', '-map', '0:a?', '-c', 'copy',
            '-avoid_negative_ts', 'make_zero', files[2]
          ]);
          if (tail !== 0) throw Error('Stream copy fallito (' + tail + ')');

          // Concatenate the new head and original tail in the WebM container.
          await ffmpeg.writeFile(files[3], new TextEncoder().encode(
            "file 'bt-wave-head.webm'\nfile 'bt-wave-tail.webm'\n"
          ));
          report('Unione dei segmenti…');
          const combined = await ffmpeg.exec([
            '-y', '-f', 'concat', '-safe', '0', '-i', files[3], '-c', 'copy', files[4]
          ]);
          if (combined !== 0) throw Error('Unione fallita (' + combined + ')');
          return new Blob([await ffmpeg.readFile(files[4])], { type: 'video/webm' });
        } finally {
          // Release temporary in-memory files even if conversion fails.
          await Promise.allSettled(files.map(p => ffmpeg.deleteFile(p)));
        }
      });

      // Replace the recording and make the trimmed version downloadable.
      const name = (oldName || 'recording.webm').replace(/\.webm$/i, '') + '-trimmed.webm';
      window.btApplyWaveformTrimResult(result, name);
      busy = false;
      close();
    } catch (e) {
      busy = false;
      console.error('Waveform trim:', e);
      processingState(false);
      report('Taglio non riuscito: ' + (e.message || e), true);
    }
  }

  // Handle the editor handshake and requests from the same-origin iframe.
  window.addEventListener('message', e => {
    if (!active || e.origin !== origin || e.source !== frame?.contentWindow) return;
    switch (e.data?.type) {
      case 'bt-waveform-ready':
        ready = true;
        frame.focus();
        message('bt-waveform-source', {
          blob: source,
          filename: sourceName,
          lang: window.BTI18n?.lang || 'en',
          theme: document.documentElement.getAttribute('data-rec-theme') || 'light'
        });
        break;
      case 'bt-waveform-close':
        close();
        break;
      case 'bt-waveform-apply':
        apply(Number(e.data.start), Number(e.data.end));
        break;
    }
  });

  // Public bridge used when Barbatrucco changes language or recording.
  window.BTWaveformTrim = {
    // Refresh the scissors label and the active editor language.
    setLanguage(lang) {
      updateLabel();
      if (active && ready) message('bt-waveform-settings', { lang });
    },

    // Refresh the available source media and show or hide the trim action.
    onRecording(blob, filename) {
      ensureUI();
      if (!trigger) return;
      source = blob && (blob.type.startsWith('video/webm') ||
                        blob.type.startsWith('audio/webm')) ? blob : null;
      sourceName = filename || 'recording.webm';
      trigger.hidden = !source;
    }
  };

  // Create the button after the recorder's controls are available.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureUI);
  } else {
    ensureUI();
  }
})();
