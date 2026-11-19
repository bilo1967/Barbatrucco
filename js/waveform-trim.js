/* Isolated waveform editor and FFmpeg.wasm bridge. */
(() => {
'use strict';
const precise = n => (Math.round(n*1000)/1000).toFixed(3);
const origin=location.origin;
let source=null,sourceName='',trigger=null,overlay=null,frame=null,active=false,busy=false,ready=false;
function message(type,props={}){if(ready)frame.contentWindow?.postMessage({type,...props},origin);}
function report(s,error=false){message('bt-waveform-status',{message:s,error});}
function ensureUI(){
  if(trigger)return;
  const strip=document.querySelector('.recorder-button-strip');
  if(!strip)return;
  trigger=document.createElement('button');
  trigger.type='button';trigger.className='btn btn-sm btn-outline-secondary';
  trigger.title='Taglia la registrazione';trigger.setAttribute('aria-label','Taglia la registrazione');
  trigger.innerHTML='<i class="bi bi-scissors" aria-hidden="true"></i>';trigger.hidden=true;
  trigger.addEventListener('click',open);strip.appendChild(trigger);
  overlay=document.createElement('div');overlay.id='bt-waveform-overlay';overlay.hidden=true;
  overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');
  overlay.setAttribute('aria-label','Editor di ritaglio');
  Object.assign(overlay.style,{position:'fixed',inset:'0',zIndex:'10050',background:'#0c1422'});
  frame=document.createElement('iframe');frame.title='Editor di ritaglio';
  frame.style.cssText='display:block;width:100%;height:100%;border:0;';
  overlay.appendChild(frame);document.body.appendChild(overlay);
}
function open(){
  if(!source||busy)return;
  ensureUI();active=true;ready=false;overlay.hidden=false;
  frame.src='waveform-trim-test.html?embedded=1';
}
function close(){
  if(busy)return;
  active=false;ready=false;overlay.hidden=true;frame.src='about:blank';trigger?.focus();
}
async function detectKeyframe(ffmpeg,from,until){
  let span=8;
  for(let attempt=0;attempt<8;attempt++){
    const name='bt-wave-keyframes-'+attempt+'.json';
    const seconds=Math.min(span,Math.max(.01,until-from));
    try{
      await ffmpeg.ffprobe(['-v','error','-select_streams','v:0','-read_intervals',
        precise(from)+'%+'+precise(seconds),'-show_packets',
        '-show_entries','packet=pts_time,flags','-of','json',
        '-i','bt-wave-input.webm','-o',name]);
      const data=JSON.parse(new TextDecoder().decode(await ffmpeg.readFile(name)));
      const frames=(data.packets||[]).filter(p=>String(p.flags||'').includes('K'))
        .map(p=>Number(p.pts_time)).filter(t=>Number.isFinite(t)&&t>from+.001&&t<until-.001).sort((a,b)=>a-b);
      if(frames.length)return frames[0];
    }finally{await ffmpeg.deleteFile(name).catch(()=>{});}
    if(seconds>=until-from-.001)break;
    span*=2;
  }
  return null;
}
async function apply(a,b){
  if(busy||!source)return;
  if(!window.ffmpeg||!window.fetchFile||!window.btRunConversion||!window.btApplyWaveformTrimResult){
    report('FFmpeg.wasm non è ancora pronto.',true);return;
  }
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a+.1){
    report('Intervallo non valido.',true);return;
  }
  const blob=source,oldName=sourceName,isVideo=blob.type.startsWith('video/');
  const ffmpeg=window.ffmpeg,files=['bt-wave-input.webm','bt-wave-head.webm','bt-wave-tail.webm','bt-wave-list.txt','bt-wave-result.webm'];
  busy=true;report('Elaborazione video…');
  try{
    const result=await window.btRunConversion(async()=>{
      try{
        await ffmpeg.writeFile(files[0],await window.fetchFile(blob));
        if(!isVideo){
          report('Ritaglio audio…');
          const code=await ffmpeg.exec(['-y','-ss',precise(a),'-i',files[0],'-t',precise(b-a),
            '-vn','-c:a','opus','-strict','-2',files[4]]);
          if(code!==0)throw Error('Codifica audio fallita ('+code+')');
          return new Blob([await ffmpeg.readFile(files[4])],{type:'audio/webm'});
        }
        const key=await detectKeyframe(ffmpeg,a,b);
        const headDuration=key===null?b-a:key-a;
        report('Ricodifica del segmento iniziale…');
        const headCode=await ffmpeg.exec(['-y','-ss',precise(a),'-i',files[0],
          '-t',precise(headDuration),'-map','0:v:0','-map','0:a?','-c:v','libvpx',
          '-deadline','realtime','-cpu-used','7','-threads:v','2',
          '-b:v','2500k','-fps_mode','passthrough','-c:a','opus','-strict','-2',files[1]]);
        if(headCode!==0)throw Error('Codifica VP8/Opus fallita ('+headCode+')');
        if(key===null)return new Blob([await ffmpeg.readFile(files[1])],{type:'video/webm'});
        report('Copia del segmento finale…');
        const tail=await ffmpeg.exec(['-y','-ss',precise(key),'-i',files[0],
          '-t',precise(b-key),'-map','0:v:0','-map','0:a?','-c','copy',
          '-avoid_negative_ts','make_zero',files[2]]);
        if(tail!==0)throw Error('Stream copy fallito ('+tail+')');
        await ffmpeg.writeFile(files[3],new TextEncoder().encode(
          "file 'bt-wave-head.webm'\nfile 'bt-wave-tail.webm'\n"));
        report('Unione dei segmenti…');
        const combined=await ffmpeg.exec(['-y','-f','concat','-safe','0','-i',files[3],
          '-c','copy',files[4]]);
        if(combined!==0)throw Error('Unione fallita ('+combined+')');
        return new Blob([await ffmpeg.readFile(files[4])],{type:'video/webm'});
      }finally{await Promise.allSettled(files.map(p=>ffmpeg.deleteFile(p)));}
    });
    const name=(oldName||'recording.webm').replace(/\.webm$/i,'')+'-trimmed.webm';
    window.btApplyWaveformTrimResult(result,name);
    busy=false;close();
  }catch(e){
    busy=false;console.error('Waveform trim:',e);
    report('Taglio non riuscito: '+(e.message||e),true);
  }
}
window.addEventListener('message',e=>{
  if(!active||e.origin!==origin||e.source!==frame?.contentWindow)return;
  switch(e.data?.type){
    case 'bt-waveform-ready':
      ready=true;message('bt-waveform-source',{blob:source,filename:sourceName});break;
    case 'bt-waveform-close':close();break;
    case 'bt-waveform-apply':apply(Number(e.data.start),Number(e.data.end));break;
  }
});
window.BTWaveformTrim={
  onRecording(blob,filename){
    ensureUI();if(!trigger)return;
    source=blob&&(blob.type.startsWith('video/webm')||blob.type.startsWith('audio/webm'))?blob:null;
    sourceName=filename||'recording.webm';
    trigger.hidden=!source;
  }
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',ensureUI);
else ensureUI();
})();
