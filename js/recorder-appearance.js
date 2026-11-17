/* Presentation only: retain the recording pipeline untouched. */
(function() {
    const KEY = 'barbatrucco.theme';
    let theme = 'light';
    try { if (localStorage.getItem(KEY) === 'dark') theme = 'dark'; } catch (_) {}
    document.documentElement.setAttribute('data-rec-theme', theme);
    function init() {
        const toggle = document.getElementById('ui-theme-toggle');
        const stage = document.getElementById('rec-preview-stage');
        const player = document.getElementById('mangiacassette');
        function updateButton() {
            if (!toggle) return;
            const light = document.documentElement.getAttribute('data-rec-theme') === 'light';
            toggle.innerHTML = light ? '<i class="fas fa-moon" aria-hidden="true"></i>' : '<i class="fas fa-sun" aria-hidden="true"></i>';
            toggle.setAttribute('aria-label', light ? 'Switch to dark theme / Passa al tema scuro' : 'Switch to light theme / Passa al tema chiaro');
            toggle.title = toggle.getAttribute('aria-label');
            toggle.setAttribute('aria-pressed', String(light));
        }
        toggle?.addEventListener('click', () => {
            const next = document.documentElement.getAttribute('data-rec-theme') === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-rec-theme', next);
            try { localStorage.setItem(KEY, next); } catch (_) {}
            updateButton();
        });
        updateButton();
        if (!player || !stage) return;
        function updatePlaceholder() {
            const hasSource = Boolean(player.srcObject || player.getAttribute('src') || player.currentSrc);
            stage.classList.toggle('has-media', hasSource);
            // Il file registrato incorpora gia' il PiP: non sovrapporre il feed live.
            // Durante l'acquisizione (srcObject) il riquadro resta invece disponibile.
            const playbackFile = !player.srcObject && Boolean(player.getAttribute('src') || player.currentSrc);
            stage.classList.toggle('playback-media', playbackFile);
        }
        // The overlay shows recording time during capture and position / total
        // duration when playing a saved file. Keep the player controls intact.
        const clock = document.getElementById('timer');
        function clockTime(seconds) {
            if (!Number.isFinite(seconds) || seconds < 0) return '00:00:00';
            const total = Math.floor(seconds);
            const hours = Math.floor(total / 3600);
            const minutes = Math.floor(total % 3600 / 60);
            const secs = total % 60;
            return [hours, minutes, secs].map(n => String(n).padStart(2, '0')).join(':');
        }
        function updatePlaybackTime() {
            if (!clock || player.srcObject || !(player.getAttribute('src') || player.currentSrc)) return;
            const current = clockTime(player.currentTime);
            const duration = clockTime(player.duration);
            clock.textContent = current + ' / ' + duration;
        }
        function updatePreview() {
            updatePlaceholder();
            updatePlaybackTime();
        }
        ['loadedmetadata', 'loadeddata', 'emptied', 'abort', 'error', 'playing',
            'durationchange', 'timeupdate', 'seeking', 'seeked'].forEach(
            e => player.addEventListener(e, updatePreview)
        );
        new MutationObserver(updatePreview).observe(player, {attributes:true, attributeFilter:['src']});
        updatePreview();
        window.btUpdateIdlePreview = updatePlaceholder;
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);
    else init();
})();
