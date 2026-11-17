/* Browser-local preferences and lightweight Italian/English localization. */
const BT_STORE_PREFIX = 'barbatrucco.';
const BTPreferences = {
  get(key) { try { return localStorage.getItem(BT_STORE_PREFIX + key); } catch (_) { return null; } },
  set(key, value) { try { localStorage.setItem(BT_STORE_PREFIX + key, String(value)); } catch (_) {} }
};
const BTLanguages = {
  "record-video-label": [
    "Record video",
    "Registra video"
  ],
  "activate-mic-label": [
    "Enable microphone",
    "Attiva microfono"
  ],
  "activate-voiceover-label": [
    "Enable voice-over",
    "Attiva voice over"
  ],
  "save-mic-label": [
    "Separate mic track",
    "Separa mic."
  ],
  "activate-webcam-label": [
    "Webcam PiP",
    "Webcam PiP"
  ],
  "webcam-cutout-label": [
    "Remove webcam background",
    "Scontorna webcam"
  ],
  "download-recording": [
    " Download recording",
    " Scarica registrazione"
  ],
  "download-mic": [
    " Download mic",
    " Scarica mic"
  ],
  "help-record": [
    "How to record",
    "Come registrare"
  ],
  "help-devices": [
    "Microphone & Webcam",
    "Microfono e webcam"
  ],
  "help-links": [
    "Useful links",
    "Link utili"
  ],
  "help-about": [
    "About",
    "Informazioni"
  ],
  "duration": [
    "Duration: ",
    "Durata: "
  ],
  "webcam-frame": [
    "Drag to move the webcam",
    "Trascina per spostare la webcam"
  ],
  "webcam-mirror": [
    "Mirror webcam on/off",
    "Attiva/disattiva specchio webcam"
  ],
  "webcam-resize": [
    "Drag to resize",
    "Trascina per ridimensionare"
  ],
  "silenzia-microfono": [
    "Mute/unmute microphone",
    "Disattiva/riattiva microfono"
  ],
  "voiceover": [
    "Hold to lower the source audio while speaking. You can also hold the space bar. Only the recording is affected.",
    "Tieni premuto per abbassare l’audio originale mentre parli. Puoi usare anche la barra spaziatrice. Modifica solo la registrazione."
  ],
  "activate-webcam-tip": [
    "Overlay your webcam on the video. Drag the preview to move or resize it.",
    "Sovrapponi la webcam al video. Trascina l’anteprima per spostarla o ridimensionarla."
  ],
  "webcam-cutout-tip": [
    "Remove the webcam background with MediaPipe (enable Webcam PiP first).",
    "Rimuove lo sfondo della webcam con MediaPipe (prima attiva Webcam PiP)."
  ],
  "activate-mic-tip": [
    "Record your voice",
    "Registra anche la tua voce"
  ],
  "activate-voiceover-tip": [
    "Lower original audio when speaking",
    "Abbassa l’audio originale quando parli"
  ],
  "save-mic-tip": [
    "Save the microphone as a separate file",
    "Salva il microfono in un file separato"
  ]
};
const BTI18n = {
  lang: 'en',
  text(key) { const v = BTLanguages[key]; return v ? v[this.lang === 'it' ? 1 : 0] : key; },
  message(en, it) { return this.lang === 'it' ? it : en; },
  setLanguage(lang) {
    this.lang = lang === 'it' ? 'it' : 'en';
    BTPreferences.set('language', this.lang);
    document.documentElement.lang = this.lang;
    document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = this.text(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = this.text(el.dataset.i18nTitle); });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(el => { el.setAttribute('aria-label', this.text(el.dataset.i18nAriaLabel)); });
    document.querySelectorAll('[data-language]').forEach(el => { el.hidden = el.dataset.language !== this.lang; });
    const duration = document.querySelector('[data-i18n-prefix="duration"]');
    if (duration) { for (const node of duration.childNodes) if (node.nodeType === Node.TEXT_NODE) { node.textContent = this.text('duration'); break; } }
    const selector = document.getElementById('ui-language'); if (selector) selector.value = this.lang;
    if (typeof bootbox !== 'undefined' && bootbox.setLocale) { try { bootbox.setLocale(this.lang); } catch (_) {} }
  },
  init() {
    const saved = BTPreferences.get('language');
    this.setLanguage(saved || (navigator.language && navigator.language.toLowerCase().startsWith('it') ? 'it' : 'en'));
    const selector = document.getElementById('ui-language');
    if (selector) selector.addEventListener('change', e => this.setLanguage(e.target.value));
  }
};
document.addEventListener('DOMContentLoaded', () => BTI18n.init());
