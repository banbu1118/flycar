(() => {
  'use strict';
  const {Game,WORLD,SPRITES,playerTilt}=RoadsterEngine;
  const $=id=>document.getElementById(id);
  const canvas=$('game-canvas'),ctx=canvas.getContext('2d',{alpha:false});
  const game=new Game();
  let best=0,muted=false;
  try{best=Number(localStorage.getItem('roadster-best-v1'))||0;muted=localStorage.getItem('roadster-muted')==='true';}catch{}
  let viewH=560,scale=1,ground=WORLD.ground,lastTime=0,ambientTime=0,introScroll=0,shake=0,toastTimer=0,renderState='',hudTime=0,newBest=false;
  let keys=new Set(),pointerHeld=false,touchHeld=false,activePointerId=null,activeTouchId=null,particles=[],sparks=[],wasBoost=false,crashTimer=0,modalWasRunning=false;
  const reduceMotion=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const touchDevice=matchMedia('(pointer: coarse)').matches||/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  let lightGraphics=false,cityLayer=null,scenePaint=null,renderPending=true,renderTime=0;
  const hudValues=new Map();
  function hudText(id,value){value=String(value);if(hudValues.get(id)!==value){$(id).textContent=value;hudValues.set(id,value);}}
  const held=()=>pointerHeld||touchHeld||keys.size>0;
  const fmt=n=>Math.floor(n).toLocaleString('en-US');
  $('best-distance').textContent=fmt(best);
  const vehicleSprites={};
  const vehicleImages=SPRITES;
  const startLabel=$('start-button').innerHTML;
  $('start-button').disabled=true;$('start-button').textContent='车辆准备中…';
  window.roadsterAssetsReady=Promise.all(Object.entries(vehicleImages).map(([type,spec])=>new Promise(resolve=>{
    const img=new Image();img.decoding='async';img.onload=()=>{
      // Upload a small cropped texture once instead of scaling a full-size photo each frame.
      const [sx,sy,sw,sh]=spec.crop,texture=document.createElement('canvas');texture.width=512;texture.height=Math.round(512*sh/sw);
      const paint=texture.getContext('2d');paint.drawImage(img,sx,sy,sw,sh,0,0,texture.width,texture.height);
      const burned=document.createElement('canvas');burned.width=texture.width;burned.height=texture.height;
      const dark=burned.getContext('2d');dark.drawImage(texture,0,0);dark.globalCompositeOperation='source-atop';dark.fillStyle='rgba(12,17,24,.65)';dark.fillRect(0,0,burned.width,burned.height);
      vehicleSprites[type]={img:texture,burned,crop:[0,0,texture.width,texture.height],aspect:sw/sh};resolve(true);
    };img.onerror=()=>resolve(false);img.src=spec.src;
  }))).then(loaded=>{$('start-button').disabled=false;$('start-button').innerHTML=startLabel;if(loaded.some(ok=>!ok))showToast('车辆图片未能加载，请刷新重试');});

  const VOICE_CLIPS=[
    {id:'yaoyao',text:'遥遥领先',src:'assets/yaoyao.wav',source:'https://suocheyinxiao.cn/9ab170d7b2e0e24fdfad1a49150ab153.html'},
    {id:'four-words',text:'绝对对得起那四个字',src:'assets/duideqi.wav',source:'https://m.jiemian.com/video/AGUCMAhuB2cBOFVh.html'},
    {id:'copying',text:'靠抄袭是没有未来的',src:'assets/chaoxi.wav',source:'https://www.bilibili.com/video/BV1ADzuYMEpp/'},
    {id:'best-suv',text:'一千万以内最好的SUV',src:'assets/suv-best.wav',source:'https://www.bilibili.com/video/BV13w411G7L2/'},
    {id:'unreachable',text:'让他们永远追不上',src:'assets/zhuibushang.wav',source:'https://www.bilibili.com/video/BV1exo4BzEPK/'},
  ];
  class AudioSystem {
    constructor(){this.context=null;this.master=null;this.jet=null;this.jetGain=null;this.voiceBuffers=[];this.voiceLoading=null;this.lastVoiceId=null;this.activeVoice=null;}
    unlock(){
      try{if(!this.context){const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)return;this.context=new AudioCtx();this.master=this.context.createGain();this.master.gain.value=muted?0:.38;this.master.connect(this.context.destination);this.makeJet();}
        this.context.resume().catch(()=>{});this.loadVoice();
      }catch{}
    }
    makeJet(){const c=this.context;const b=c.createBuffer(1,c.sampleRate*2,c.sampleRate);const a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=Math.random()*2-1;const noise=c.createBufferSource();noise.buffer=b;noise.loop=true;const filter=c.createBiquadFilter();filter.type='bandpass';filter.frequency.value=1600;filter.Q.value=.45;this.jetGain=c.createGain();this.jetGain.gain.value=0;noise.connect(filter);filter.connect(this.jetGain);this.jetGain.connect(this.master);noise.start();this.jet=noise;}
    loadVoice(){
      if(this.voiceLoading)return this.voiceLoading;
      this.voiceLoading=Promise.all(VOICE_CLIPS.map(async clip=>{
        try{const response=await fetch(clip.src);if(!response.ok)throw Error('no clip');const buffer=await this.context.decodeAudioData(await response.arrayBuffer());return {...clip,buffer};}catch{return null;}
      })).then(clips=>{this.voiceBuffers=clips.filter(Boolean);});
      return this.voiceLoading;
    }
    setThrust(on){if(this.context&&this.jetGain)this.jetGain.gain.setTargetAtTime(on?.18:0,this.context.currentTime,.04);}
    setMute(){muted=!muted;try{localStorage.setItem('roadster-muted',String(muted));}catch{}if(this.master)this.master.gain.setTargetAtTime(muted?0:.38,this.context.currentTime,.04);if(muted)this.stopVoice();syncSound();}
    tone(freq=500,duration=.1,type='sine',volume=.15,end=freq){if(!this.context||muted)return;const c=this.context,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,c.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),c.currentTime+duration);g.gain.setValueAtTime(volume,c.currentTime);g.gain.exponentialRampToValueAtTime(.001,c.currentTime+duration);o.connect(g);g.connect(this.master);o.start();o.stop(c.currentTime+duration);}
    stopVoice(){if(this.activeVoice){try{this.activeVoice.stop();}catch{}this.activeVoice=null;}}
    warning(){if(muted)return;this.tone(660,.14,'triangle',.22,520);setTimeout(()=>{if(game.mode==='running'&&game.warning>0)this.tone(660,.14,'triangle',.2,520);},240);
      this.stopVoice();
      if(this.voiceBuffers.length&&this.context){
        const choices=this.voiceBuffers.length>1?this.voiceBuffers.filter(clip=>clip.id!==this.lastVoiceId):this.voiceBuffers;
        const clip=choices[Math.floor(Math.random()*choices.length)],s=this.context.createBufferSource();
        s.buffer=clip.buffer;s.connect(this.master);s.onended=()=>{if(this.activeVoice===s)this.activeVoice=null;};
        s.start();this.activeVoice=s;this.lastVoiceId=clip.id;
      }
    }
    crash(){if(!this.context||muted)return;const c=this.context,b=c.createBuffer(1,c.sampleRate*.65,c.sampleRate),a=b.getChannelData(0);for(let i=0;i<a.length;i++)a[i]=(Math.random()*2-1)*Math.pow(1-i/a.length,2);const s=c.createBufferSource();s.buffer=b;const f=c.createBiquadFilter();f.type='lowpass';f.frequency.value=700;const g=c.createGain();g.gain.value=.7;s.connect(f);f.connect(g);g.connect(this.master);s.start();this.tone(95,.5,'sawtooth',.3,25);}
  }
  const audio=new AudioSystem();
  function syncSound(){$('sound-button').innerHTML=`<svg><use href="#i-${muted?'muted':'sound'}"/></svg>`;$('sound-button').setAttribute('aria-label',muted?'开启声音':'关闭声音');$('sound-button').title=muted?'开启声音':'关闭声音';$('sound-button').setAttribute('aria-pressed',String(muted));}
  syncSound();

  function resize(){
    const rect=canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;
    lightGraphics=touchDevice||rect.width<=680;document.documentElement.classList.toggle('light-graphics',lightGraphics);
    const dpr=Math.min(window.devicePixelRatio||1,lightGraphics?1.25:2),width=Math.round(rect.width*dpr),height=Math.round(rect.height*dpr);
    if(canvas.width===width&&canvas.height===height&&scenePaint)return;
    canvas.width=width;canvas.height=height;scale=width/WORLD.width;viewH=height/scale;ground=viewH-139;
    scenePaint=null;renderPending=true;
  }
  new ResizeObserver(resize).observe(canvas);
  function clearInput(){keys.clear();pointerHeld=false;touchHeld=false;activePointerId=null;activeTouchId=null;$('boost-button').classList.remove('active');audio.setThrust(false);}
  function showToast(message){$('toast').textContent=message;$('toast').classList.add('visible');toastTimer=2.4;}
  function syncMode(){
    if(renderState===game.mode)return;renderState=game.mode;renderPending=true;
    const mode=game.mode;$('game-overlay').hidden=mode==='running';$('intro-panel').hidden=mode!=='ready';$('result-panel').hidden=mode!=='ended';$('pause-panel').hidden=mode!=='paused';
    $('game-frame').classList.toggle('is-paused',mode==='paused');$('game-frame').classList.toggle('is-ended',mode==='ended');
    $('pause-button').disabled=mode==='ready'||mode==='ended';$('pause-button').setAttribute('aria-label',mode==='paused'?'继续游戏':'暂停游戏');$('pause-button').innerHTML=`<svg><use href="#i-${mode==='paused'?'play':'pause'}"/></svg>`;
    $('boost-button').disabled=mode!=='running';$('warning').hidden=mode!=='running'||game.warning<=0;
    if(mode!=='running'){clearInput();audio.stopVoice();}
  }
  function start(){if($('start-button').disabled)return;closeDialogs();clearInput();audio.unlock();game.start();particles=[];sparks=[];newBest=false;crashTimer=0;shake=0;$('toast').classList.remove('visible');toastTimer=0;syncMode();updateHUD();}
  function pause(){if(game.mode==='running'){game.pause();syncMode();}}
  function resume(){if(game.mode==='paused'){clearInput();audio.unlock();game.resume();syncMode();}}
  function togglePause(){if(document.querySelector('dialog[open]'))return;if(game.mode==='running')pause();else if(game.mode==='paused')resume();}
  function end(){
    clearInput();audio.crash();shake=reduceMotion?0:13;crashTimer=.6;
    burst(WORLD.playerX,ground-game.player.h-21,55,'crash');
    const score=Math.floor(game.distance);newBest=score>best;
    if(newBest){best=score;try{localStorage.setItem('roadster-best-v1',String(best));}catch{}}
    $('best-distance').textContent=fmt(best);$('result-distance').textContent=fmt(score);$('result-passed').textContent=game.passed;$('result-flight').textContent=game.flightTime.toFixed(1)+' s';$('result-reason').textContent=game.deathReason;
    $('result-tag').textContent=newBest?'NEW PERSONAL BEST':'RUN COMPLETE';$('result-title').textContent=newBest?'新纪录，起飞了。':'下一程，再远一点。';
    syncMode();
  }
  function updateHUD(){
    const air=Math.ceil(game.air);hudText('air-value',air);$('air-fill').style.width=air+'%';$('air-meter').setAttribute('aria-valuenow',air);const panel=document.querySelector('.air-hud');panel.classList.toggle('low',air<25);panel.classList.toggle('empty',air===0);
    let airStatus='推进系统就绪',state='ROADSTER · READY',tip='保持轻盈，保持前进。';
    if(game.mode==='running'||game.mode==='paused'){
      if(air===0){airStatus='空气耗尽 · 等待落地';state='ROADSTER · EMPTY';tip='松开喷气，落地补充空气。';}
      else if(game.player.h>0){airStatus=game.player.thrust?`喷气推进 · −${WORLD.airDrain}% / s`:'空中滑行 · 不耗气';state=game.player.thrust?'ROADSTER · THRUST':'ROADSTER · AIRBORNE';tip='松开喷气，在空中滑行省气。';}
      else{airStatus=air===100?'满压就绪 · 随时起飞':`贴地回气 · +${WORLD.airRegen}% / s`;state='ROADSTER · RECHARGING';tip='贴地回气，等待下一个时机。';}
    }
    if(game.mode==='ended'){airStatus='行程结束';state='ROADSTER · STOPPED';tip='每一次出发，都是新的可能。';}
    if(game.mode==='paused'){state='ROADSTER · PAUSED';tip='暂停中 · 按 P 继续行驶';}
    if(hudValues.get('air-status')!==airStatus){$('air-status').innerHTML='<span class="status-dot"></span>'+airStatus;hudValues.set('air-status',airStatus);}hudText('drive-state',state);hudText('scene-tip',tip);
    hudText('distance-value',String(Math.floor(game.distance)).padStart(4,'0'));hudText('speed-value',game.mode==='ready'?0:Math.round(game.speed*.288));
    $('warning').hidden=game.mode!=='running'||game.warning<=0;
    hudText('control-title',air<25&&game.mode==='running'?'空气告急，寻找落地时机。':'每一口空气，都算数。');
    hudText('control-description',game.mode==='running'&&game.player.thrust?`喷气中 · 每秒消耗 ${WORLD.airDrain}% 空气`:game.mode==='running'&&game.player.h>0?'空中滑行 · 不耗气、不回气':'按住喷气耗气 · 落地缓慢回气');
  }

  $('start-button').addEventListener('click',start);$('restart-button').addEventListener('click',start);$('pause-restart-button').addEventListener('click',start);$('resume-button').addEventListener('click',resume);$('pause-button').addEventListener('click',togglePause);
  $('sound-button').addEventListener('click',()=>{audio.unlock();audio.setMute();});
  $('fullscreen-button').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('game-section').requestFullscreen();}catch{showToast('当前浏览器不支持全屏，请横屏游玩');}});
  document.addEventListener('fullscreenchange',()=>{$('fullscreen-button').setAttribute('aria-label',document.fullscreenElement?'退出全屏':'进入全屏');resize();});
  const boostButton=$('boost-button');
  const preventGesture=e=>{if(e.cancelable)e.preventDefault();};
  const releaseBoost=()=>{pointerHeld=false;touchHeld=false;activePointerId=null;activeTouchId=null;};
  boostButton.addEventListener('pointerdown',e=>{
    if(game.mode!=='running'||e.isPrimary===false||(typeof e.button==='number'&&e.button!==0))return;
    preventGesture(e);activePointerId=e.pointerId;pointerHeld=true;
    try{boostButton.setPointerCapture(e.pointerId);}catch{}
    audio.unlock();
  });
  const releasePointer=e=>{if(activePointerId!==null&&e.pointerId===activePointerId){if(e.type==='lostpointercapture'){pointerHeld=false;activePointerId=null;}else releaseBoost();}};
  boostButton.addEventListener('pointerup',releasePointer);boostButton.addEventListener('pointercancel',releasePointer);boostButton.addEventListener('lostpointercapture',releasePointer);
  window.addEventListener('pointerup',releasePointer);window.addEventListener('pointercancel',releasePointer);
  // Some Android WeChat WebViews cancel pointer capture during a long touch.
  // Native touch cancellation is blocked on the control; touchend also guarantees release.
  boostButton.addEventListener('touchstart',e=>{
    if(game.mode!=='running')return;preventGesture(e);
    if(activeTouchId!==null||!e.changedTouches?.length)return;
    activeTouchId=e.changedTouches[0].identifier;touchHeld=true;if(!pointerHeld)audio.unlock();
  },{passive:false});
  boostButton.addEventListener('touchmove',e=>{if(touchHeld||pointerHeld)preventGesture(e);},{passive:false});
  const releaseTouch=e=>{if(activeTouchId!==null&&Array.from(e.changedTouches||[]).some(t=>t.identifier===activeTouchId))releaseBoost();};
  boostButton.addEventListener('touchend',releaseTouch);boostButton.addEventListener('touchcancel',releaseTouch);
  for(const type of ['contextmenu','selectstart','dragstart'])$('game-section').addEventListener(type,preventGesture,{capture:true});
  const flightKeys=['Space','ArrowUp','KeyW'];
  window.addEventListener('keydown',e=>{
    if(document.querySelector('dialog[open]'))return;
    if(flightKeys.includes(e.code)){e.preventDefault();if(game.mode==='running'){keys.add(e.code);audio.unlock();}return;}
    if(e.repeat)return;
    if(e.code==='Enter'&&(game.mode==='ready'||game.mode==='ended')){e.preventDefault();start();}
    else if(e.code==='KeyR'&&game.mode==='ended'){e.preventDefault();start();}
    else if(e.code==='KeyP'||e.code==='Escape'){e.preventDefault();togglePause();}
  });
  window.addEventListener('keyup',e=>{if(flightKeys.includes(e.code)){e.preventDefault();keys.delete(e.code);}});
  window.addEventListener('blur',()=>{clearInput();pause();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){clearInput();pause();}});
  function openDialog(id){modalWasRunning=game.mode==='running';if(modalWasRunning)pause();$(id).showModal();}
  function closeDialogs(){document.querySelectorAll('dialog[open]').forEach(d=>d.close());modalWasRunning=false;}
  $('help-button').addEventListener('click',()=>openDialog('help-dialog'));
  $('credits-button').addEventListener('click',()=>openDialog('credits-dialog'));
  document.querySelectorAll('dialog').forEach(d=>{d.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>d.close()));d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});d.addEventListener('close',()=>{if(modalWasRunning){modalWasRunning=false;resume();}});});
  $('audio-credit').innerHTML='<p>尊界预警随机播放五句语录原声：'+VOICE_CLIPS.map(clip=>`<a href="${clip.source}" target="_blank" rel="noopener noreferrer">“${clip.text}” ↗</a>`).join(' · ')+'。声音可通过右上角按钮开关。</p>';

  // Vehicle photos load once; the game loop uses only decoded local assets.
  let seed=48271;const rand=()=>{seed=(seed*16807)%2147483647;return(seed-1)/2147483646;};
  const stars=Array.from({length:48},()=>({x:rand()*1500,y:rand()*285,r:.5+rand()*.9,a:.15+rand()*.45}));
  const buildings=Array.from({length:28},(_,i)=>({x:i*58+rand()*25,w:32+rand()*44,h:24+rand()*90,top:rand()>.6,windows:Array.from({length:25},()=>rand()>.52)}));
  const mountain=Array.from({length:23},(_,i)=>({x:i*95,y:rand()*80}));
  const rr=(x,y,w,h,r=5)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);};
  function polygon(points,fill){ctx.beginPath();points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=fill;ctx.fill();}
  function line(x1,y1,x2,y2,color,width=1){ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke();}
  function cacheScene(){
    if(!scenePaint){
      const gradient=(a,b,c,d,stops)=>{const g=ctx.createLinearGradient(a,b,c,d);for(const [offset,color] of stops)g.addColorStop(offset,color);return g;};
      scenePaint={sky:gradient(0,0,0,ground,[[0,'#101c32'],[.42,'#283047'],[.77,'#5a4050'],[1,'#8a5a5b']]),road:gradient(0,ground,0,viewH,[[0,'#15202c'],[.2,'#172633'],[1,'#0b1723']]),haze:gradient(0,ground-90,0,ground,[[0,'#db8e7d00'],[1,'#c6807430']]),vignette:gradient(0,viewH-70,0,viewH,[[0,'#0b142000'],[1,'#091320bd']])};
    }
    if(!cityLayer){
      cityLayer=document.createElement('canvas');cityLayer.width=1700;cityLayer.height=170;const c=cityLayer.getContext('2d');
      for(const b of buildings){const x=b.x,y=170-b.h-21;c.fillStyle='#1b283b';c.fillRect(x,y,b.w,b.h+20);
        if(b.top){c.fillRect(x+b.w*.3,y-7,b.w*.4,7);c.beginPath();c.moveTo(x+b.w*.5,y-7);c.lineTo(x+b.w*.5,y-17);c.strokeStyle='#263448';c.stroke();}
        for(let row=0;row<5;row++)for(let col=0;col<5;col++){if(!b.windows[row*5+col])continue;c.fillStyle=(row+col)%3===0?'#d3ad7b45':'#86b6c52b';c.fillRect(x+6+col*(b.w-12)/5,y+10+row*13,2.5,4);}
      }
    }
  }
  function background(scroll){
    cacheScene();ctx.fillStyle=scenePaint.sky;ctx.fillRect(0,0,1200,viewH);
    for(let i=0;i<stars.length;i+=lightGraphics?2:1){const s=stars[i];let x=((s.x-scroll*.018)%1500+1500)%1500;ctx.fillStyle=`rgba(202,220,242,${s.a*(.9+Math.sin(ambientTime*.6+s.x)*.1)})`;ctx.beginPath();ctx.arc(x,s.y+Math.max(0,viewH-560)*.35,s.r,0,Math.PI*2);ctx.fill();}
    const sunX=940-scroll*.012%1500;const sunY=ground-190;
    if(!lightGraphics){const glow=ctx.createRadialGradient(sunX,sunY,5,sunX,sunY,200);glow.addColorStop(0,'#ed9d8050');glow.addColorStop(1,'#d7776b00');ctx.fillStyle=glow;ctx.fillRect(sunX-200,sunY-200,400,400);}
    ctx.fillStyle='#dda58b';ctx.beginPath();ctx.arc(sunX,sunY,45,0,Math.PI*2);ctx.fill();
    for(let i=0;i<8;i++){ctx.fillStyle=`rgba(55,47,66,${.1+i*.04})`;ctx.fillRect(sunX-47,sunY+8+i*5,95,1.2+i*.5);}
    for(let layer=0;layer<3;layer++){
      ctx.beginPath();ctx.moveTo(-150,ground);const offset=(scroll*(.035+layer*.035))%190;
      for(const p of mountain)ctx.lineTo(p.x-offset,ground-(130-layer*30)-p.y*(1-layer*.13));
      ctx.lineTo(1800,ground);ctx.closePath();ctx.fillStyle=['#33344b','#2c3348','#252e40'][layer];ctx.fill();
    }
    const cityOffset=(scroll*.17)%1700;
    for(let loop=0;loop<2;loop++)ctx.drawImage(cityLayer,-cityOffset+loop*1700,ground-170);
    ctx.fillStyle=scenePaint.haze;ctx.fillRect(0,ground-90,1200,90);
    // Elevated expressway, roadside lamps, and a layered safety barrier.
    const lampOffset=(scroll*.75)%420;
    for(let x=-lampOffset+80;x<1350;x+=420){line(x,ground-11,x,ground-157,'#182435',3);ctx.beginPath();ctx.moveTo(x,ground-157);ctx.quadraticCurveTo(x+5,ground-169,x+28,ground-169);ctx.lineTo(x+45,ground-169);ctx.strokeStyle='#182435';ctx.lineWidth=3;ctx.stroke();line(x+31,ground-168,x+48,ground-168,'#f9ddb6',2);if(!lightGraphics){const lampGlow=ctx.createRadialGradient(x+41,ground-165,1,x+41,ground-165,46);lampGlow.addColorStop(0,'#f6bf7032');lampGlow.addColorStop(1,'#f6bf7000');ctx.fillStyle=lampGlow;ctx.fillRect(x-5,ground-210,92,92);}}
    ctx.fillStyle='#182838';ctx.fillRect(0,ground-24,1200,24);line(0,ground-23,1200,ground-23,'#7f8f9b63',2);line(0,ground-17,1200,ground-17,'#162331',2);line(0,ground-11,1200,ground-11,'#5c75894d',2);
    for(let x=-(scroll%86);x<1250;x+=86){ctx.fillStyle='#111e2a';ctx.fillRect(x,ground-22,4,22);ctx.fillStyle='#b7a98a95';ctx.fillRect(x+2,ground-20,6,2);}
    ctx.fillStyle=scenePaint.road;ctx.fillRect(0,ground,1200,viewH-ground);
    line(0,ground+1,1200,ground+1,'#c3c4ac80',2);line(0,ground+8,1200,ground+8,'#e3d1ac10');
    for(let x=-(scroll%160);x<1350;x+=160){polygon([[x,ground+65],[x+83,ground+65],[x+74,ground+68],[x-10,ground+68]],'#889bad3c');}
    for(let x=-(scroll*1.15%240);x<1400;x+=240){line(x,ground+100,x+90,ground+100,'#40597113',1);line(x+90,ground+35,x+142,ground+35,'#7f9eb80d',1);}
    ctx.fillStyle=scenePaint.vignette;ctx.fillRect(0,viewH-70,1200,70);
  }
  function wheel(x,y,r,rotation){ctx.fillStyle='#090e16';ctx.beginPath();ctx.arc(x,y,r+2,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#4b5764';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#8797a7';ctx.beginPath();ctx.arc(x,y,r-2,0,Math.PI*2);ctx.fill();ctx.fillStyle='#1e2a39';ctx.beginPath();ctx.arc(x,y,r-4,0,Math.PI*2);ctx.fill();for(let i=0;i<5;i++){const a=i*Math.PI*2/5+rotation;line(x+Math.cos(a)*2,y+Math.sin(a)*2,x+Math.cos(a)*(r-3),y+Math.sin(a)*(r-3),'#9cabb7',1.7);}ctx.fillStyle='#c4ced5';ctx.beginPath();ctx.arc(x,y,2.2,0,Math.PI*2);ctx.fill();}
  function drawTruck(center,bottom,w,h,type,color,burning){
    ctx.save();ctx.translate(center-w/2,bottom-h);ctx.scale(w/240,h/150);
    const dark=burning?'#373a3b':'#253343',paint=burning?'#494947':color;
    ctx.fillStyle='#141d29';rr(5,122,229,12,3);ctx.fill();
    const cargo=ctx.createLinearGradient(0,4,0,121);cargo.addColorStop(0,burning?'#514c45':paint);cargo.addColorStop(1,burning?'#2b2b2d':'#364958');
    ctx.fillStyle=cargo;rr(6,5,type==='semi'?158:145,116,3);ctx.fill();ctx.strokeStyle=burning?'#635346':'#c9d1cf70';ctx.lineWidth=1.2;ctx.stroke();
    for(let x=16;x<(type==='semi'?158:145);x+=12)line(x,12,x,116,'#14222e30',2);
    line(10,112,type==='semi'?160:148,112,'#d6c7a860',3);
    const cabX=type==='semi'?169:155;
    polygon([[cabX,126],[cabX,49],[cabX+39,49],[cabX+53,76],[231,90],[236,126]],paint);
    polygon([[cabX+7,58],[cabX+33,58],[cabX+44,79],[cabX+7,79]],burning?'#172230':'#9ebdca');
    line(cabX+29,57,cabX+29,80,'#2c3e4e',2);line(cabX+4,87,cabX+43,87,'#d4e0db66');line(cabX+6,85,cabX+6,121,'#24374466');
    ctx.fillStyle=dark;rr(222,99,13,22,2);ctx.fill();line(225,102,233,102,'#b4c1c2',1);line(225,108,233,108,'#b4c1c2',1);line(225,114,233,114,'#b4c1c2',1);
    line(226,94,236,94,burning?'#887451':'#fff0bd',4);line(9,120,15,120,'#ff6f65',3);
    if(type==='semi'){wheel(32,135,12,0);wheel(62,135,12,0);wheel(158,135,12,0);}else wheel(39,135,12,0);
    wheel(207,135,12,0);
    ctx.font='bold 9px sans-serif';ctx.fillStyle=burning?'#91877a':'#dce6e7b3';ctx.fillText(type==='semi'?'LONG HAUL':'CARGO',22,62);ctx.restore();
  }
  function drawCar(center,bottom,w,h,type,color,rotation=0,tilt=0,burning=false){
    if(type==='truck'||type==='semi'){drawTruck(center,bottom,w,h,type,color,burning);return;}
    const sprite=vehicleSprites[type];
    if(sprite){const img=burning?sprite.burned:sprite.img;const [sx,sy,sw,sh]=sprite.crop;const dh=Math.min(h,w/sprite.aspect),dw=dh*sprite.aspect;ctx.save();ctx.translate(center,bottom-dh/2);ctx.rotate(tilt);ctx.drawImage(img,sx,sy,sw,sh,-dw/2,-dh/2,dw,dh);ctx.restore();return;}
    ctx.save();ctx.translate(center,bottom-h/2);ctx.rotate(tilt);ctx.translate(-w/2,-h/2);ctx.scale(w/160,h/60);
    const isPlayer=type==='roadster',isVan=type==='van',isSUV=type==='suv',isRival=type==='rival';
    let gradient=ctx.createLinearGradient(0,12,0,49);gradient.addColorStop(0,burning?'#504a44':isPlayer?'#ff6060':isRival?'#b8ad91':color);gradient.addColorStop(.47,burning?'#302e2b':isPlayer?'#db2639':isRival?'#767467':color);gradient.addColorStop(1,burning?'#191b20':isPlayer?'#6c152b':'#273341');
    ctx.fillStyle='#090e17';rr(3,29,154,22,6);ctx.fill();
    ctx.beginPath();ctx.moveTo(3,38);ctx.lineTo(6,29);
    if(isPlayer){ctx.bezierCurveTo(17,27,27,27,39,25);ctx.lineTo(61,9);ctx.quadraticCurveTo(77,5,99,10);ctx.lineTo(121,27);ctx.bezierCurveTo(140,29,150,29,157,34);}
    else if(isVan){ctx.lineTo(12,10);ctx.quadraticCurveTo(14,5,23,5);ctx.lineTo(111,5);ctx.quadraticCurveTo(119,7,125,22);ctx.lineTo(151,28);ctx.lineTo(157,35);}
    else if(isSUV||isRival){ctx.lineTo(17,20);ctx.lineTo(37,7);ctx.quadraticCurveTo(44,4,98,7);ctx.lineTo(125,24);ctx.lineTo(151,29);ctx.lineTo(157,35);}
    else{ctx.lineTo(31,25);ctx.lineTo(52,9);ctx.quadraticCurveTo(69,5,102,11);ctx.lineTo(126,27);ctx.lineTo(152,30);ctx.lineTo(157,36);}
    ctx.lineTo(155,47);ctx.lineTo(5,47);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();ctx.strokeStyle=burning?'#4b4339':isPlayer?'#ff8a7c':'#c3cdd15c';ctx.lineWidth=.65;ctx.stroke();
    const glass=ctx.createLinearGradient(0,5,0,28);glass.addColorStop(0,burning?'#26313c':'#89b2c5');glass.addColorStop(1,'#172637');
    if(isPlayer){polygon([[45,26],[64,12],[77,11],[76,26]],glass);polygon([[80,11],[97,13],[115,27],[80,26]],glass);line(48,24,69,13,'#e1f4ff3b',1);}
    else{const rear=isVan?18:isSUV||isRival?36:51;polygon([[rear,24],[rear+6,10],[72,10],[72,24]],glass);polygon([[77,10],[99,12],[117,25],[77,24]],glass);if(isVan)polygon([[19,12],[33,12],[30,24],[18,24]],glass);line(76,28,77,44,burning?'#151c23':'#1d293a66',.7);}
    line(17,34,140,34,isPlayer?'#ff9c8f66':'#c6d3d744',.8);polygon([[21,39],[126,37],[138,42],[18,44]],isPlayer?'#601324':'#1c293980');
    if(isRival&&!burning){line(16,28,147,29,'#ddd1ae',1);ctx.font='7px sans-serif';ctx.fillStyle='#dfd5b8';ctx.fillText('V800',83,36);line(151,31,151,43,'#d9d8c2',2);}
    line(6,30,15,31,'#ff4d62',2.7);line(147,32,157,33,burning?'#645644':'#e7f9fa',2.2);
    line(127,28,149,30,isPlayer?'#ff8e7b99':'#cadde366');
    if(!burning){ctx.fillStyle=isPlayer?'#ffb8aa':'#b0bac2';rr(86,29,7,1.5,1);ctx.fill();}
    wheel(34,48,10,rotation);wheel(128,48,10,rotation);
    if(isPlayer){ctx.font='5.8px sans-serif';ctx.fillStyle='#ffd6ce';ctx.fillText('ROADSTER',62,40);line(21,49,23,51,'#9cc8d8',3);line(137,49,139,51,'#9cc8d8',3);}
    ctx.restore();
  }
  function shadow(x,w,altitude=0){const opacity=Math.max(.08,.35-altitude*.001);ctx.save();ctx.translate(x,ground+3);ctx.scale(1,.16);ctx.beginPath();ctx.ellipse(0,0,w*.5+altitude*.07,10,0,0,Math.PI*2);ctx.fillStyle=`rgba(1,6,13,${opacity})`;ctx.fill();ctx.restore();}
  function jets(x,y){
    if(lightGraphics){for(const dx of [-43,41]){const n=30+Math.sin(ambientTime*65+dx)*7;polygon([[x+dx-4,y-3],[x+dx+4,y-3],[x+dx+7,y+n],[x+dx-7,y+n]],'#a4f5ff85');line(x+dx,y,x+dx,y+n*.75,'#efffff',2);}return;}
    for(const dx of [-43,41]){const n=20+Math.sin(ambientTime*65+dx)*7;const g=ctx.createLinearGradient(0,y,0,y+n+25);g.addColorStop(0,'#efffffef');g.addColorStop(.25,'#a4f5ff9f');g.addColorStop(1,'#6bd8ff00');polygon([[x+dx-5,y-3],[x+dx+5,y-3],[x+dx+11,y+n+18],[x+dx-12,y+n+18]],g);line(x+dx,y,x+dx+1,y+n,'#ebffff',2);}
    const glow=ctx.createRadialGradient(x,y,1,x,y,90);glow.addColorStop(0,'#64cfff1e');glow.addColorStop(1,'#64cfff00');ctx.fillStyle=glow;ctx.fillRect(x-90,y-90,180,180);
  }
  function burst(x,y,count,type){count=lightGraphics?Math.ceil(count*.45):count;for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,s=40+Math.random()*260;particles.push({x,y,vx:Math.cos(a)*s,vy:Math.sin(a)*s-60,life:.3+Math.random()*.7,max:1,r:1+Math.random()*4,type});}}
  function fire(x,w){
    if(lightGraphics){for(let i=0;i<3;i++){const fx=x+(i+.5)*w/3,fy=ground-30,flame=35+Math.sin(ambientTime*14+i*1.7)*12;ctx.beginPath();ctx.moveTo(fx-14,fy);ctx.quadraticCurveTo(fx-17,fy-20,fx+Math.sin(ambientTime*9+i)*7,fy-flame);ctx.quadraticCurveTo(fx+4,fy-24,fx+14,fy);ctx.fillStyle='#ff792bcb';ctx.fill();polygon([[fx-7,fy],[fx+1,fy-flame*.6],[fx+8,fy]],'#ffe69ce6');}return;}
    for(let i=0;i<7;i++){const fx=x+(i/6)*w,fy=ground-30,flame=25+Math.sin(ambientTime*14+i*1.7)*15;const g=ctx.createLinearGradient(0,fy-flame-30,0,fy);g.addColorStop(0,'#ff4c2500');g.addColorStop(.25,'#ff562b80');g.addColorStop(.72,'#ffad39dd');g.addColorStop(1,'#ffe69cf0');ctx.beginPath();ctx.moveTo(fx-14,fy);ctx.quadraticCurveTo(fx-18,fy-20,fx+Math.sin(ambientTime*9+i)*10,fy-flame-25);ctx.quadraticCurveTo(fx+3,fy-27,fx+14,fy);ctx.fillStyle=g;ctx.fill();}
    const glow=ctx.createRadialGradient(x+w/2,ground-30,4,x+w/2,ground-30,w*.9);glow.addColorStop(0,'#ff6d2918');glow.addColorStop(1,'#ff6d2900');ctx.fillStyle=glow;ctx.fillRect(x-w*.4,ground-w,2*w,2*w);
  }
  function updateParticles(dt){
    for(const p of particles){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;if(p.type==='smoke'){p.r+=dt*15;p.vx*=.99;}else if(p.type==='jet')p.vy+=60*dt;else p.vy+=300*dt;}
    let alive=0;for(const p of particles)if(p.life>0)particles[alive++]=p;particles.length=alive;
    const particleLimit=lightGraphics?100:450;if(particles.length>particleLimit)particles.splice(0,particles.length-particleLimit);
    if(game.mode==='running'&&game.player.thrust&&Math.random()<1-Math.exp(-(lightGraphics?35:96)*dt)){for(const dx of [-43,41])particles.push({x:WORLD.playerX+dx+(Math.random()-.5)*8,y:ground-game.player.h-1,vx:-game.speed*.2,vy:80+Math.random()*140,r:1+Math.random()*2,life:.25+Math.random()*.25,max:.5,type:'jet'});}
    if(game.mode==='running'){for(const o of game.obstacles){if(o.burning&&o.x<1220&&o.x+o.w>-20&&Math.random()<1-Math.exp(-(lightGraphics?5:15)*dt))particles.push({x:o.x+Math.random()*o.w,y:ground-o.h-12,vx:-20-Math.random()*25,vy:-22-Math.random()*30,r:8+Math.random()*10,life:1.5,max:1.5,type:'smoke'});}}
  }
  function drawParticles(){for(const p of particles){ctx.globalAlpha=Math.max(0,Math.min(1,p.life/p.max));ctx.fillStyle=p.type==='jet'?'#c3f7ff':p.type==='smoke'?'#3c3d4b':p.life>.35?'#ffd494':'#ed6b43';ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();}ctx.globalAlpha=1;}
  function render(){
    ctx.setTransform(scale,0,0,scale,0,0);cacheScene();ctx.clearRect(0,0,1200,viewH);ctx.save();if(shake>0&&!reduceMotion)ctx.translate((Math.random()-.5)*shake,(Math.random()-.5)*shake*.6);
    const scroll=game.mode==='ready'?introScroll:game.scroll;background(scroll);
    for(const o of game.obstacles){if(o.x+o.w<-20||o.x>1220)continue;shadow(o.x+o.w/2,o.w);drawCar(o.x+o.w/2,ground,o.w,o.h,o.type,o.color,0,0,o.burning);if(o.burning)fire(o.x+5,o.w-10);}
    if(game.rival&&game.rival.x+game.rival.w>-20&&game.rival.x<1220){const r=game.rival;shadow(r.x+r.w/2,r.w);if(!r.burning){for(let i=0;i<5;i++)line(r.x-20-i*12,ground-20+i*4,r.x-95-i*24,ground-20+i*4,'#d6bc9f'+['55','33','22','15','10'][i],1.5);const beam=ctx.createLinearGradient(r.x+r.w,0,r.x+r.w+150,0);beam.addColorStop(0,'#fff2c630');beam.addColorStop(1,'#fff2c600');polygon([[r.x+r.w,ground-30],[r.x+r.w+150,ground-52],[r.x+r.w+150,ground-4],[r.x+r.w,ground-24]],beam);}
      drawCar(r.x+r.w/2,ground,r.w,r.h,'rival','#b4ab91',scroll/16,0,r.burning);if(r.burning)fire(r.x+12,r.w-24);
    }
    const p=game.player;const bob=game.mode==='ready'?Math.sin(ambientTime*3)*.6:game.mode==='running'&&p.h===0?Math.sin(ambientTime*28)*.35:0;
    shadow(WORLD.playerX,WORLD.playerWidth,p.h);
    if(p.thrust&&game.mode==='running')jets(WORLD.playerX,ground-p.h);
    if(p.h===0&&game.mode==='running'){const reflection=ctx.createLinearGradient(0,ground+4,0,ground+22);reflection.addColorStop(0,'#ed384d17');reflection.addColorStop(1,'#ed384d00');ctx.fillStyle=reflection;ctx.fillRect(WORLD.playerX-65,ground+4,130,18);}
    drawCar(WORLD.playerX,ground-p.h+bob,WORLD.playerWidth,WORLD.playerHeight,'roadster','#ec3447',scroll/13,playerTilt(p),game.mode==='ended');
    if(p.h>5&&game.mode==='running'){ctx.strokeStyle='#8fe5d437';ctx.setLineDash([3,5]);line(WORLD.playerX-82,ground-p.h,WORLD.playerX-82,ground,'#8fe5d437');ctx.setLineDash([]);ctx.fillStyle='#9bc8d17a';ctx.font='9px monospace';ctx.textAlign='right';ctx.fillText((p.h*.025).toFixed(1)+' m',WORLD.playerX-89,ground-p.h*.5);ctx.textAlign='left';}
    drawParticles();ctx.restore();
  }
  function frame(now){
    const dt=lastTime?Math.min((now-lastTime)/1000,.1):1/60;lastTime=now;ambientTime+=dt;
    if(game.mode==='ready')introScroll+=dt*32;
    if(game.mode==='running'){
      const events=game.update(dt,held());
      for(const e of events){if(e.type==='death')end();else if(e.type==='warning')audio.warning();else if(e.type==='impact'){shake=reduceMotion?0:9;burst(e.x,ground-32,36,'crash');audio.crash();showToast('前方事故 · 保持腾空');}else if(e.type==='land'){burst(WORLD.playerX,ground,8,'jet');audio.tone(70,.09,'sine',.07,40);}else if(e.type==='empty'){audio.tone(180,.18,'triangle',.17,100);showToast('空气耗尽 · 松开喷气，落地回充');}else if(e.type==='milestone'){showToast(e.distance+' m · 继续向前');audio.tone(540,.15,'sine',.1,720);}}
    }
    if(game.mode!=='paused')updateParticles(dt);
    const boost=game.mode==='running'&&game.player.thrust;if(wasBoost!==boost){wasBoost=boost;audio.setThrust(boost);boostButton.classList.toggle('active',boost);}
    if(shake>0)shake=Math.max(0,shake-dt*30);
    if(toastTimer>0){toastTimer-=dt;if(toastTimer<=0)$('toast').classList.remove('visible');}
    hudTime+=dt;if(hudTime>(lightGraphics?.1:.06)){hudTime=0;updateHUD();}
    renderTime+=dt;
    const moving=game.mode==='running'||game.mode==='ready'||(game.mode!=='paused'&&(particles.length>0||shake>0));
    if(renderPending||(moving&&renderTime>=1/60-.0002)){render();renderPending=false;renderTime=Math.max(0,renderTime-1/60);if(renderTime>1/60)renderTime%=1/60;}
    requestAnimationFrame(frame);
  }
  resize();syncMode();updateHUD();requestAnimationFrame(frame);
  // Read-only snapshot supports automated gameplay checks without changing a run.
  window.getRoadsterSnapshot=()=>({mode:game.mode,distance:game.distance,speed:game.speed,air:game.air,altitude:game.player.h,thrust:game.player.thrust,warning:game.warning,rival:game.rival?{x:game.rival.x,speed:game.rival.speed,burning:game.rival.burning}:null,obstacles:game.obstacles.map(o=>({x:o.x,w:o.w,h:o.h,type:o.type,burning:o.burning})),assetsLoaded:Object.keys(vehicleSprites),passed:game.passed,best,graphics:{light:lightGraphics,width:canvas.width,height:canvas.height,particles:particles.length,spriteWidths:Object.values(vehicleSprites).map(s=>s.img.width)}});
})();
