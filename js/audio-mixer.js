/* Compact recording-volume and voice-over floor controls. */
(function () {
    'use strict';
    const defaults = { source: 95, mic: 95, 'duck-record': 5, 'duck-headphones': 100 };
    const values = {};
    for (const kind of Object.keys(defaults)) {
        const stored = BTPreferences.get('gain-' + kind);
        const parsed = Number(stored);
        values[kind] = stored !== null && Number.isFinite(parsed)
            ? Math.min(100, Math.max(0, parsed)) : defaults[kind];
    }

    const controls = window.BTVolumeMixer = {
        onChange: null,
        get(kind) { return values[kind] / 100; },
        getPercent(kind) { return values[kind]; },
        showHeadphoneStatus(en, it) {
            const el = document.getElementById('bt-headphones-status');
            if (el) el.textContent = BTI18n.message(en, it);
        },
        init() {
            const button = document.getElementById('bt-mixer-toggle');
            const panel = document.getElementById('bt-mixer-panel');
            for (const kind of Object.keys(defaults)) {
                const input = document.getElementById('bt-gain-' + kind);
                const output = document.getElementById('bt-gain-' + kind + '-value');
                input.value = String(values[kind]);
                output.textContent = values[kind] + '%';
                input.addEventListener('input', () => {
                    values[kind] = Number(input.value);
                    output.textContent = values[kind] + '%';
                    BTPreferences.set('gain-' + kind, values[kind]);
                    controls.onChange?.(kind);
                });
            }
            button.addEventListener('click', () => {
                const open = panel.hidden;
                panel.hidden = !open;
                panel.classList.remove('bt-open-up');
                if (open && panel.getBoundingClientRect().bottom > window.innerHeight - 8) {
                    panel.classList.add('bt-open-up');
                }
                button.setAttribute('aria-expanded', String(open));
            });
            document.getElementById('bt-gain-reset').addEventListener('click', () => {
                for (const kind of Object.keys(defaults)) {
                    values[kind] = defaults[kind];
                    BTPreferences.set('gain-' + kind, values[kind]);
                    document.getElementById('bt-gain-' + kind).value = String(values[kind]);
                    document.getElementById('bt-gain-' + kind + '-value').textContent = values[kind] + '%';
                }
                controls.onChange?.('reset');
            });
            document.addEventListener('pointerdown', event => {
                if (!panel.hidden && !event.target.closest('.bt-mixer-area')) {
                    panel.hidden = true;
                    button.setAttribute('aria-expanded', 'false');
                }
            });
        }
    };
}());
