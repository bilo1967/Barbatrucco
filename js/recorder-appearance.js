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
        ['loadedmetadata', 'loadeddata', 'emptied', 'abort', 'error', 'playing'].forEach(e => player.addEventListener(e, updatePlaceholder));
        new MutationObserver(updatePlaceholder).observe(player, {attributes:true, attributeFilter:['src']});
        updatePlaceholder();
        window.btUpdateIdlePreview = updatePlaceholder;
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);
    else init();
})();
