import { FFmpeg  } from './@ffmpeg/ffmpeg/dist/esm/index.js';
import { fetchFile, toBlobURL } from './@ffmpeg/util/dist/esm/index.js';

const Version = '0.12.15';
const FFmpegVersion = '5.1.4';
//const BaseURL = `/js/@ffmpeg/core/dist/esm`; // single thread
const BaseURL = `/js/@ffmpeg/core-mt/dist/esm`; // multi thread
const DefaultLogLevel = 'info';

async function initFFmpeg() {

    const ffmpeg = new FFmpeg();

    ffmpeg.wasmVersion = Version;
    ffmpeg.ffmpegVersion = FFmpegVersion;

    await ffmpeg.load({
        coreURL: await toBlobURL(`${BaseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${BaseURL}/ffmpeg-core.wasm`, 'application/wasm'),
        workerURL: await toBlobURL(`${BaseURL}/ffmpeg-core.worker.js`, 'text/javascript')
    });

    //
    // pseudo setLogLevel
    //
    // Any time we set a log level either with ffmpeg.exec or with ffmpeg.ffprobe
    // it is persistently and globally set.
    // To correct this behaviour, the ffmpeg.exec method is modified to implicitly
    // add "-v info" to the options list, to reset the log level to default (unless
    // -v or -loglevel parameters are explicitly set)
    //
    ffmpeg._logLevel = DefaultLogLevel;
    ffmpeg.getLogLevel = function() { return ffmpeg._logLevel; }
    ffmpeg.setLogLevel = function(level = DefaultLogLevel) { ffmpeg._logLevel = level + ''; }

    //
    // exec is reimplemented to (re)set the default log level at each call, unless
    // a different log level is specified in options (-v or -loglevel).
    //
    ffmpeg.EXEC = ffmpeg.exec;
    ffmpeg.exec = async function (oo, ...rest) {
        const o = (oo.includes('-v') || oo.includes('-loglevel')) ? oo : [ '-v', ffmpeg._logLevel, ...oo ];
        return ffmpeg.EXEC(o, ...rest);
    }

    //
    // Get media info facility
    //
    ffmpeg.getMediaInfo = async function(fileName) {

        const infoFile = fileName + '.json';
        var info = null;

        try {
            await ffmpeg.ffprobe([
                '-v', 'quiet',
                '-hide_banner',
                '-show_entries', 'format',
                '-show_entries', 'stream',
                '-of', 'json',
                fileName,
                '-o', infoFile
            ]);
            const infoBuffer = await ffmpeg.readFile(infoFile);
            const decoder = new TextDecoder('utf-8');

            info = JSON.parse(decoder.decode(infoBuffer.buffer));

            if (Object.keys(info).length === 0) {
                // Il the format is not recognized, the previous ffprobe call returns {}
                info = {
                    hasVideo: false,
                    hasAudio: false,
                    isSeekable: false,
                    formatName: 'unknown',
                }
            } else {
                // Adds some useful keys to info extracted by ffmpeg
                info.hasVideo = info.streams.some(e => e.codec_type == 'video');
                info.hasAudio = info.streams.some(e => e.codec_type == 'audio');
                info.isSeekable = ('duration' in info.format);
                info.formatName = info.format.format_name;
                info.duration = info.format.duration;
            }
        } catch (err) {
            throw new Error(`Fetch media info failed: ${err.message}`);
        } finally {
            await ffmpeg.deleteFile(infoFile);
        }

        return info;
    }

    return { ffmpeg, fetchFile };
}


// Esposizione globale controllata
window.createFFmpegInstance = initFFmpeg;