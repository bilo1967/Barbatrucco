# Barbatrucco / MiniRecorder

**Barbatrucco** (MiniRecorder) is a browser-based audio and video recorder for capturing media played in another browser tab, application or screen, optionally combining it with microphone audio and a movable webcam overlay.

**All recording, audio mixing, video composition, segmentation inference, and media conversion run locally in your browser. Recorded audio and video are not uploaded to the Barbatrucco web server.** Some application libraries and the optional MediaPipe segmentation model are currently downloaded from third-party hosts; these requests download software assets, not recordings.

You can test it (or use it from) here: [https://minirecorder.ditlab.it/](https://minirecorder.ditlab.it/) or [https://barbatrucco.ditlab.it/](https://barbatrucco.ditlab.it/)

## Features

- Record tab audio, with optional video, using the browser's screen-sharing interface.
- Mix microphone audio with the captured source; optionally download a separate microphone recording.
- Use voice-over controls to temporarily lower source-audio volume while speaking; the original audio level in the recording is configurable (default 5%). The original tab/application audio heard by the user is unchanged.
- Overlay a webcam picture-in-picture on the recording; move and resize it before or during recording, and mirror the webcam horizontally.
- Optionally remove the webcam background with MediaPipe Selfie Segmenter.
- Pause, resume, stop, and preview recordings; use an optional delayed start.
- Download video as WebM or audio as MP3/M4A using FFmpeg.wasm.
- Switch between English and Italian, and between light and dark themes.
- Save interface preferences locally in the browser (`localStorage`).

## Frontend dependencies

- Bootstrap **5.3.9** (CSS and JS bundle with Popper)
- Bootstrap Icons **1.13.2**
- Bootbox **6.0.4** (vendored as `js/bootbox.all.min.js`, including locales)
- jQuery **3.8.0**, retained for Bootbox and existing recorder scripts; the separate jQuery 4 migration is deferred
- FFmpeg.wasm **0.12.15** (existing local ESM build); MediaPipe Tasks Vision **1.2.3** (loaded on demand)

Bootstrap, icons, and jQuery are currently loaded from version-pinned CDNs; recordings remain entirely local.

## Requirements

- A modern **Chromium-based browser** (such as Chrome, Edge, or Brave) is recommended. Tab-audio capture and media codec support vary by browser and operating system.
- An **HTTPS** site (or `localhost` for local development) to access screen capture and camera/microphone APIs.
- A static web server capable of setting the required response headers. No application backend, database, PHP, or Node.js server is needed.
- The FFmpeg.wasm **multithread** assets, including `ffmpeg-core.wasm`, served from the expected local paths.

## Installation

1. Copy the repository contents to the **document root** of your website. For example, place `index.html` at `https://recorder.example.org/index.html` and the JavaScript files under `https://recorder.example.org/js/`.
2. Include the FFmpeg.wasm files under `js/@ffmpeg/`, keeping the directory layout used by `js/loadFFmpeg.js`. In particular, the following must exist:

   ```text
   js/@ffmpeg/core-mt/dist/esm/ffmpeg-core.js
   js/@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm
   js/@ffmpeg/core-mt/dist/esm/ffmpeg-core.worker.js
   js/@ffmpeg/ffmpeg/dist/esm/...
   js/@ffmpeg/util/dist/esm/...
   ```

   These assets come from [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm), tag [`v12.15`](https://github.com/ffmpegwasm/ffmpeg.wasm/releases/tag/v12.15). Keep its applicable licenses and source-code notices when redistributing the binaries.
3. Configure **both** cross-origin isolation response headers, as shown below.
4. Serve the site over HTTPS and open it in a compatible browser.

### Required HTTP headers

FFmpeg.wasm's multithread core requires `SharedArrayBuffer`, which in turn requires cross-origin isolation:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

**Apache** — the repository includes a `.htaccess` file with these settings. Apache must have `mod_headers` enabled and allow the relevant `.htaccess` directives (for example, `AllowOverride FileInfo` in the site's `<Directory>` configuration).

**Nginx** — add these directives to the site's `server` block:

```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

**Caddy 2** — add this `header` block to the site's configuration:

```caddyfile
recorder.example.org {
    root * /var/www/barbatrucco
    header {
        Cross-Origin-Opener-Policy "same-origin"
        Cross-Origin-Embedder-Policy "require-corp"
    }
    file_server
}
```

For Nginx and Caddy, use these directives in the **web-server configuration**, not in `.htaccess`. If Nginx has more specific `location` blocks defining their own `add_header` directives, ensure the two isolation headers are also present on the responses that need them.

**Important:** `require-corp` can block third-party scripts, CSS, images, or WASM assets that do not opt into cross-origin loading through CORS or CORP. Barbatrucco currently references some external libraries and MediaPipe assets. If a dependency fails to load, inspect the browser console and Network tab; self-hosting that dependency is often the most reliable solution.

### Verify the installation

Check the response headers:

```sh
curl -I https://recorder.example.org/
```

Both headers above should appear. In the browser's developer console, check:

```js
window.crossOriginIsolated // should be true
typeof SharedArrayBuffer // should be "function"
```

If audio conversion fails, also verify that `js/@ffmpeg/core-mt/dist/esm/ffmpeg-core.wasm` is served successfully (HTTP 200), preferably with the `application/wasm` content type.

## Recording

1. Open the media to capture in a separate browser tab.
2. In Barbatrucco, choose whether to **Record video**. Optionally enable the microphone, webcam PiP, separate mic track, voice-over, or background removal before recording.
3. Click **Record**, choose an optional delay, then select the tab to share. Enable **Share tab audio** when prompted.
4. Play the source media. Use Barbatrucco's controls to pause, resume, or stop. You can reposition and resize the webcam overlay while recording.
5. Preview and download the recording. Recorded video is saved as WebM; audio can be converted to MP3 or M4A.

Camera, microphone, and screen-sharing access always remain subject to browser permission prompts and browser security restrictions.

## Privacy

The processing pipeline runs on the user's own device. Barbatrucco does **not** send recorded media to its server for processing or storage. Preferences are stored in the browser using `localStorage`, not an application account or database. Optional MediaPipe libraries/models and some UI dependencies are fetched from their respective third-party hosts, so normal network requests to those services may occur. Hosting these assets locally can further reduce external dependencies.

## License and third-party components

Barbatrucco's original application code is distributed under **GNU GPL-3.0-or-later**; see [`LICENSE`](LICENSE). Bundled third-party components retain their own licenses and copyright notices, which are **not replaced** by Barbatrucco's license.

In particular, the FFmpeg.wasm JavaScript wrapper and utilities are MIT-licensed, while the multithread FFmpeg core package declares **GPL-2.0-or-later**. Redistribution of the FFmpeg-derived core may require providing corresponding source code and additional notices for codecs or other compiled libraries. Review the licenses of all redistributed dependencies before publishing a release.
