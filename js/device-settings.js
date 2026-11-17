/* Device selection and hot-plug handling. No permissions are requested on load. */
(function () {
    'use strict';
    const key = { audioinput: 'device.audioinput', videoinput: 'device.videoinput', audiooutput: 'device.audiooutput' };
    const ids = { audioinput: 'ui-device-mic', videoinput: 'ui-device-camera', audiooutput: 'ui-device-output' };
    const get = kind => BTPreferences.get(key[kind]) || '';
    const set = (kind, id) => BTPreferences.set(key[kind], id);
    const ui = kind => document.getElementById(ids[kind]);
    const msg = (en, it) => BTI18n.message(en, it);
    const status = document.getElementById('ui-device-status');
    const button = document.getElementById('ui-devices-toggle');
    const panel = document.getElementById('ui-devices-panel');
    let locked = false;
    let refreshing = false;
    let rerun = false;
    let outputSelection = '';

    function announce(en, it) {
        status.textContent = msg(en, it);
    }
    function selectOptions(kind, devices) {
        const select = ui(kind);
        const previous = get(kind);
        const matching = devices.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications');
        const available = previous && matching.some(d => d.deviceId === previous);
        // Device identities may be hidden until camera/microphone permission.
        const identified = devices.some(d => d.kind === kind && d.label);
        select.replaceChildren();
        const option = document.createElement('option');
        option.value = '';
        option.textContent = msg('System default', 'Predefinito di sistema');
        select.append(option);
        matching.forEach((d, i) => {
            const opt = document.createElement('option');
            opt.value = d.deviceId;
            opt.textContent = d.label || msg(kind === 'videoinput' ? `Camera ${i + 1}` : `Device ${i + 1}`,
                kind === 'videoinput' ? `Webcam ${i + 1}` : `Dispositivo ${i + 1}`);
            select.append(opt);
        });
        if (previous && !available && !identified) {
            const pending = document.createElement('option');
            pending.value = previous;
            pending.textContent = msg('Previously selected device (pending permission)', 'Dispositivo salvato (in attesa di autorizzazione)');
            select.append(pending);
        }
        select.value = available || (previous && !identified) ? previous : '';
        if (previous && !available && identified) {
            set(kind, '');
            announce('A previously selected device is unavailable; using the system default.',
                'Un dispositivo selezionato non è disponibile; uso quello predefinito.');
            // Do not silently interrupt an ongoing recording.
            if (!locked && kind !== 'audiooutput' && typeof manager.onDeviceLost === 'function')
                Promise.resolve(manager.onDeviceLost(kind)).catch(console.warn);
        }
    }

    async function refresh() {
        if (refreshing) { rerun = true; return; }
        refreshing = true;
        try {
            if (!navigator.mediaDevices?.enumerateDevices) {
                announce('Device enumeration is not supported by this browser.', 'Il browser non supporta l’elenco dei dispositivi.');
                return;
            }
            const devices = await navigator.mediaDevices.enumerateDevices();
            Object.keys(ids).forEach(kind => selectOptions(kind, devices));
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
        const player = document.getElementById('mangiacassette');
        if (typeof player.setSinkId !== 'function') return;
        const requested = get('audiooutput');
        try {
            await player.setSinkId(requested);
            outputSelection = requested;
        } catch (error) {
            console.warn('Unable to select playback output:', error);
            set('audiooutput', outputSelection);
            ui('audiooutput').value = outputSelection;
            announce('Unable to select this playback device.', 'Impossibile selezionare questa uscita audio.');
        }
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
            ui('audioinput').disabled = locked;
            ui('videoinput').disabled = locked;
            ui('audiooutput').disabled = typeof document.getElementById('mangiacassette').setSinkId !== 'function';
        },
        refresh
    };

    for (const kind of Object.keys(ids)) {
        ui(kind).addEventListener('change', async function () {
            if (locked && kind !== 'audiooutput') return;
            const previous = get(kind);
            const requested = this.value;
            set(kind, requested);
            status.textContent = '';
            if (kind === 'audiooutput') {
                await applyOutput();
            } else if (typeof manager.onInputChanged === 'function') {
                try {
                    await manager.onInputChanged(kind);
                } catch (error) {
                    set(kind, previous);
                    this.value = previous;
                    console.warn('Device switch failed:', error);
                    announce('Unable to activate the selected device.', 'Impossibile attivare il dispositivo selezionato.');
                }
            }
            void refresh();
        });
    }
    button.addEventListener('click', () => {
        const open = panel.hidden;
        panel.hidden = !open;
        button.setAttribute('aria-expanded', String(open));
        if (open) void refresh();
    });
    document.getElementById('ui-devices-refresh').addEventListener('click', () => void refresh());
    if (navigator.mediaDevices?.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => void refresh());
    window.addEventListener('focus', () => { if (!panel.hidden) void refresh(); });
    document.getElementById('mangiacassette').addEventListener('loadedmetadata', () => {
        if (get('audiooutput') !== outputSelection) void applyOutput();
    });
    document.addEventListener('click', e => {
        if (e.target.closest('#ui-devices-panel, #ui-devices-toggle')) return;
        if (!panel.hidden) {
            panel.hidden = true;
            button.setAttribute('aria-expanded', 'false');
        }
    });
    manager.setRecording(false);
    void refresh();
    void applyOutput();
}());
