/* Compact audio mixer. Volume controls apply to the combined recording. */
(function () {
    'use strict';
    const defaults = { source: 95, mic: 95 };
    const setting = kind => 'gain-' + kind;
    const values = {};
    for (const kind of ['source', 'mic']) {
        const saved = Number(BTPreferences.get(setting(kind)));
        values[kind] = BTPreferences.get(setting(kind)) !== null && Number.isFinite(saved)
            ? Math.min(100, Math.max(0, saved)) : defaults[kind];
    }
    const controls = window.BTVolumeMixer = {
        onChange: null,
        get(kind) { return values[kind] / 100; },
        getPercent(kind) { return values[kind]; },
        init() {
            const button = document.getElementById('bt-mixer-toggle');
            const panel = document.getElementById('bt-mixer-panel');
            for (const kind of ['source', 'mic']) {
                const input = document.getElementById('bt-gain-' + kind);
                const output = document.getElementById('bt-gain-' + kind + '-value');
                input.value = String(values[kind]);
                output.textContent = values[kind] + '%';
                input.addEventListener('input', () => {
                    values[kind] = Number(input.value);
                    output.textContent = values[kind] + '%';
                    BTPreferences.set(setting(kind), values[kind]);
                    controls.onChange?.();
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
                for (const kind of ['source', 'mic']) {
                    values[kind] = defaults[kind];
                    BTPreferences.set(setting(kind), values[kind]);
                    document.getElementById('bt-gain-' + kind).value = String(values[kind]);
                    document.getElementById('bt-gain-' + kind + '-value').textContent = values[kind] + '%';
                }
                controls.onChange?.();
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
