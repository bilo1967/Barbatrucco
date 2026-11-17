# Web server configuration examples

The two headers below are required for the multithread FFmpeg.wasm core:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Apache

Place the included `.htaccess` in the site's document root. Enable `mod_headers` and allow its directives through the site's `AllowOverride` setting.

## Nginx

Inside the existing HTTPS `server { ... }` block:

```nginx
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Cross-Origin-Embedder-Policy "require-corp" always;
```

If other `add_header` directives are defined in nested `location` blocks, account for Nginx header inheritance.

## Caddy 2

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

After deploying, test with `curl -I https://recorder.example.org/` and `window.crossOriginIsolated` in your browser's developer console.
