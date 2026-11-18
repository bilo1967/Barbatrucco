/* Device preferences and hot-plug detection. The UI is a Bootbox modal. */
(function () {
    'use strict';

    const types = ['audioinput', 'videoinput', 'audiooutput'];
    const keys = {
        audioinput: 'device.audioinput',
        videoinput: 'device.videoinput',
        audiooutput: 'device.audiooutput'
    };
    const ids = {
        audioinput: 'ui-device-mic',
        videoinput: 'ui-device-camera',
        audiooutput: 'ui-device-output'
    };
    const get = kind => BTPreferences.get(keys[kind]) || '';
    const set = (kind, id) => BTPreferences.set(keys[kind], id);
    const ui = kind => document.getElementById(ids[kind]);
    const msg = (en, it) => BTI18n.message(en, it);
    const trigger = document.getElementById('ui-devices-toggle');
    const player = document.getElementById('mangiacassette');
    let dialog = null;
    let locked = false;
    let refreshing = false;
    let rerun = false;
    let outputSelection = '';
    let lastDevices = [];

    function announce(en, it) {
        const status = document.getElementById('ui-device-status');
        if (status) status.textContent = msg(en, it);
    }

    function renderSelect(kind, devices) {
        const select = ui(kind);
        if (!select) return;
        const wanted = get(kind);
        const matching = devices.filter(d => d.kind === kind && d.deviceId &&
            d.deviceId !== 'default' && d.deviceId !== 'communications');
        const known = matching.some(d => d.deviceId === wanted);
        const labeled = devices.some(d => d.kind === kind && d.label);
        select.replaceChildren();

        select.add(new Option(msg('System default', 'Predefinito di sistema'), ''));
        matching.forEach((d, i) => {
            const name = d.label || msg(
                kind === 'videoinput' ? 'Camera ' + (i + 1) : 'Device ' + (i + 1),
                kind === 'videoinput' ? 'Webcam ' + (i + 1) : 'Dispositivo ' + (i + 1)
            );
            select.add(new Option(name, d.deviceId));
        });
        if (wanted && !known && !labeled) {
            select.add(new Option(
                msg('Saved device (awaiting permission)', 'Dispositivo salvato (in attesa di autorizzazione)'),
                wanted
            ));
        }
        select.value = known || (wanted && !labeled) ? wanted : '';
    }

    async function refresh() {
        if (refreshing) { rerun = true; return; }
        refreshing = true;
        try {
            if (!navigator.mediaDevices?.enumerateDevices) {
                announce('Device enumeration is not supported.', 'Elenco dispositivi non supportato.');
                return;
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            lastDevices = devices;
            for (const kind of types) {
                const wanted = get(kind);
                const available = devices.some(d => d.kind === kind && d.deviceId === wanted);
                const identified = devices.some(d => d.kind === kind && d.label);
                if (wanted && !available && identified) {
                    // Keep the active recorder stream untouched; recover only when idle.
                    set(kind, '');
                    announce('A selected device was disconnected; using the system default.',
                        'Un dispositivo selezionato è stato scollegato: uso quello predefinito.');
                    if (!locked && kind !== 'audiooutput' && typeof manager.onDeviceLost === 'function') {
                        Promise.resolve(manager.onDeviceLost(kind)).catch(console.warn);
                    }
                    if (kind === 'audiooutput') void applyOutput();
                }
                renderSelect(kind, devices);
            }
            manager.setRecording(locked);
        } catch (error) {
            console.warn('Unable to enumerate media devices:', error);
            announce('Unable to list devices.', 'Impossibile elencare i dispositivi.');
        } finally {
            refreshing = false;
            if (rerun) { rerun = false; void refresh(); }
        }
    }

    async function applyOutput() {
        if (typeof player.setSinkId !== 'function') return;
        const desired = get('audiooutput');
        try {
            await player.setSinkId(desired);
            await window.BTHeadphoneMonitor?.setOutput(desired);
            outputSelection = desired;
        } catch (error) {
            console.warn('Unable to select playback output:', error);
            set('audiooutput', outputSelection);
            const select = ui('audiooutput');
            if (select) select.value = outputSelection;
            announce('Unable to select this playback device.', 'Impossibile selezionare questa uscita audio.');
        }
    }

    function modalContent() {
        const labels = [
            ['audioinput', BTI18n.text('device-microphone')],
            ['videoinput', BTI18n.text('device-webcam')],
            ['audiooutput', BTI18n.text('device-output')]
        ];
        const fields = labels.map(([kind, label]) =>
            '<label for="' + ids[kind] + '">' + label + '</label>' +
            '<select class="form-select form-select-sm" id="' + ids[kind] + '"></select>'
        ).join('');
        return '<div class="bt-device-heading">' +
            '<button type="button" class="bt-device-refresh" id="ui-devices-refresh" ' +
            'aria-label="' + BTI18n.text('device-refresh') + '" title="' +
            BTI18n.text('device-refresh') + '"><i class="bi bi-arrow-clockwise" aria-hidden="true"></i></button>' +
            '</div><div class="bt-device-fields">' + fields + '</div>' +
            '<p class="bt-device-note mb-0">' + BTI18n.text('device-note') + '</p>' +
            '<div id="ui-device-status" class="bt-device-status" role="status" aria-live="polite"></div>';
    }

    async function changed(kind, select) {
        if (locked && kind !== 'audiooutput') return;
        const oldId = get(kind);
        set(kind, select.value);
        announce('', '');
        if (kind === 'audiooutput') {
            await applyOutput();
        } else if (typeof manager.onInputChanged === 'function') {
            try {
                await manager.onInputChanged(kind);
            } catch (error) {
                console.warn('Unable to activate selected device:', error);
                set(kind, oldId);
                select.value = oldId;
                announce('Unable to activate the selected device.', 'Impossibile attivare il dispositivo selezionato.');
            }
        }
        void refresh();
    }

    function openDialog() {
        if (dialog) return;
        dialog = bootbox.dialog({
            title: BTI18n.text('device-settings-title'),
            message: modalContent(),
            className: 'bt-device-dialog',
            centerVertical: true,
            buttons: {
                close: { label: msg('Close', 'Chiudi'), className: 'btn-primary' }
            }
        });
        trigger.setAttribute('aria-expanded', 'true');
        for (const kind of types) {
            const select = ui(kind);
            select.addEventListener('change', () => void changed(kind, select));
        }
        document.getElementById('ui-devices-refresh')
            .addEventListener('click', () => void refresh());
        dialog.on('hidden.bs.modal', () => {
            dialog = null;
            trigger.setAttribute('aria-expanded', 'false');
        });
        void refresh();
    }

    const manager = window.BTDeviceSettings = {
        onInputChanged: null,
        onDeviceLost: null,
        selected: get,
        micConstraints(base) {
            const id = get('audioinput');
            return id ? { ...base, audio: { ...base.audio, deviceId: { exact: id } } } : base;
        },
        setRecording(value) {
            locked = !!value;
            for (const kind of ['audioinput', 'videoinput']) {
                const select = ui(kind);
                if (select) select.disabled = locked;
            }
            const output = ui('audiooutput');
            if (output) output.disabled = typeof player.setSinkId !== 'function';
        },
        refresh
    };

    trigger.addEventListener('click', openDialog);
    if (navigator.mediaDevices?.addEventListener) {
        navigator.mediaDevices.addEventListener('devicechange', () => void refresh());
    }
    window.addEventListener('focus', () => { if (dialog) void refresh(); });
    player.addEventListener('loadedmetadata', () => {
        if (get('audiooutput') !== outputSelection) void applyOutput();
    });
    void refresh();
    void applyOutput();
}());
