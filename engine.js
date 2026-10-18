(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RoadsterEngine=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const WORLD={width:1200,height:560,ground:421,playerX:480,playerWidth:126,playerHeight:43,maxAltitude:300,airDrain:25.5,airRegen:6,startSpeed:280,maxSpeed:450,acceleration:1.95,rivalSpeed:584};
  const VEHICLES={sedan:{w:114,h:58},suv:{w:126,h:82},van:{w:142,h:104},truck:{w:210,h:140},semi:{w:278,h:154}};
  const RIVAL_TIMING={baseMinDelay:6,baseMaxDelay:10,initialDelay:6,rampSeconds:80,minDelay:4};
  // Sprite crops also define the exact displayed aspect ratio used by physics.
  const SPRITES={roadster:{src:'assets/roadster-side-public.png',crop:[724,800,2406,681]},rival:{src:'assets/v800-side-cutout.png',crop:[64,239,1548,558]}};
  const wheelShape=(x,y,r)=>Array.from({length:12},(_,i)=>{const a=i*Math.PI/6;return[x+Math.cos(a)*r,y+Math.sin(a)*r];});
  const PROFILES={
    roadster:{base:[1,1],parts:[[[.045,.52],[.15,.38],[.71,.38],[.92,.55],[.98,.72],[.97,.84],[.86,.88],[.12,.88],[.045,.76]],[[.075,.36],[.16,.20],[.35,.06],[.45,.035],[.55,.08],[.65,.20],[.78,.37]],wheelShape(.14,.73,.07).map(([x,y])=>[x,.73+(y-.73)*3.53]),wheelShape(.845,.73,.07).map(([x,y])=>[x,.73+(y-.73)*3.53])]},
    rival:{base:[1,1],parts:[[[.025,.43],[.79,.43],[.96,.55],[.99,.69],[.985,.84],[.94,.88],[.065,.85],[.03,.74]],[[.045,.43],[.07,.14],[.23,.035],[.54,.035],[.64,.12],[.805,.46]],wheelShape(.15,.78,.06).map(([x,y])=>[x,.78+(y-.78)*2.77]),wheelShape(.741,.78,.06).map(([x,y])=>[x,.78+(y-.78)*2.77])]},
    sedan:{base:[160,60],parts:[[[6,30],[149,30],[155,36],[153,46],[7,46]],[[32,26],[54,11],[99,12],[123,27]],wheelShape(34,48,10.5),wheelShape(128,48,10.5)]},
    suv:{base:[160,60],parts:[[[6,30],[149,30],[155,36],[153,46],[7,46]],[[18,25],[18,21],[39,8],[96,8],[123,25]],wheelShape(34,48,10.5),wheelShape(128,48,10.5)]},
    van:{base:[160,60],parts:[[[6,30],[149,30],[155,36],[153,46],[7,46]],[[14,25],[14,10],[21,7],[108,7],[122,24]],wheelShape(34,48,10.5),wheelShape(128,48,10.5)]},
  };
  for(const type of ['truck','semi']){const cab=type==='semi'?169:155;PROFILES[type]={base:[240,150],parts:[[[7,6],[type==='semi'?163:150,6],[type==='semi'?163:150,120],[7,120]],[[cab+1,50],[cab+38,50],[cab+51,80],[cab+1,80]],[[cab+1,80],[cab+51,80],[230,91],[235,125],[cab+1,125]],[[6,124],[233,124],[233,132],[6,132]],...(type==='semi'?[wheelShape(32,135,13),wheelShape(62,135,13),wheelShape(158,135,13)]:[wheelShape(39,135,13)]),wheelShape(207,135,13)]};}
  function playerTilt(p){return p.h>0?(p.thrust?-.045:Math.max(-.03,Math.min(.06,-p.vy*.0002))):0;}
  function collisionParts(vehicle,bottom=vehicle.bottom??WORLD.ground){
    const {type,w,h}=vehicle,profile=PROFILES[type],sprite=SPRITES[type];
    const dh=sprite?Math.min(h,w*sprite.crop[3]/sprite.crop[2]):h,dw=sprite?dh*sprite.crop[2]/sprite.crop[3]:w;
    const center=vehicle.x+w/2,cy=bottom-dh/2,angle=vehicle.tilt||0,c=Math.cos(angle),s=Math.sin(angle);
    return profile.parts.map(poly=>poly.map(([x,y])=>{const px=(x/profile.base[0]-.5)*dw,py=(y/profile.base[1]-.5)*dh;return[center+px*c-py*s,cy+px*s+py*c];}));
  }
  function bounds(parts){const points=parts.flat();return{left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))};}
  function polygonsOverlap(a,b){
    // A small contact tolerance keeps grazing an antialiased edge forgiving.
    for(const poly of [a,b])for(let i=0;i<poly.length;i++){
      const p=poly[i],q=poly[(i+1)%poly.length],dx=q[0]-p[0],dy=q[1]-p[1],length=Math.hypot(dx,dy);if(!length)continue;
      const nx=-dy/length,ny=dx/length;let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
      for(const v of a){const d=v[0]*nx+v[1]*ny;amin=Math.min(amin,d);amax=Math.max(amax,d);}
      for(const v of b){const d=v[0]*nx+v[1]*ny;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}
      if(Math.min(amax,bmax)-Math.max(amin,bmin)<=1.25)return false;
    }
    return true;
  }
  function partsOverlap(a,b){return a.some(p=>b.some(q=>polygonsOverlap(p,q)));}
  function intersectsParts(parts,box,vehicle){
    const bottom=vehicle.bottom??WORLD.ground;
    if(box.right<=vehicle.x||box.left>=vehicle.x+vehicle.w||box.bottom<=bottom-vehicle.h||box.top>=bottom)return false;
    return partsOverlap(parts,collisionParts(vehicle,bottom));
  }
  function vehiclesOverlap(a,b){const parts=collisionParts(a);return intersectsParts(parts,bounds(parts),b);}
  class Game {
    constructor(random=Math.random){this.random=random;this.reset();}
    reset(){this.mode='ready';this.distance=0;this.time=0;this.scroll=0;this.speed=WORLD.startSpeed;this.air=100;this.player={h:0,vy:0,thrust:false};this.obstacles=[];this.obstacleBag=[];this.lastObstacleType=null;this.rival=null;this.warning=0;this.nextRival=RIVAL_TIMING.initialDelay;this.nextObstacle=2.1;this.passed=0;this.flightTime=0;this.events=[];this.deathReason='';this.idCounter=0;this.airLock=false;this.lastThrust=false;this.milestone=0;return this;}
    start(){this.reset();this.mode='running';return this;}
    emit(type,data={}){this.events.push({type,...data});}
    nextVehicleType(){
      if(!this.obstacleBag.length){this.obstacleBag=Object.keys(VEHICLES);for(let i=this.obstacleBag.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));[this.obstacleBag[i],this.obstacleBag[j]]=[this.obstacleBag[j],this.obstacleBag[i]];}
        if(this.obstacleBag[this.obstacleBag.length-1]===this.lastObstacleType)[this.obstacleBag[0],this.obstacleBag[this.obstacleBag.length-1]]=[this.obstacleBag[this.obstacleBag.length-1],this.obstacleBag[0]];
      }
      this.lastObstacleType=this.obstacleBag.pop();return this.lastObstacleType;
    }
    spawnObstacle(x=WORLD.width+120,variant=null){const type=variant||this.nextVehicleType();const size=VEHICLES[type];const w=Math.round(size.w*(.94+this.random()*.12)),h=Math.round(size.h*(.94+this.random()*.12));const colors=['#7e9bac','#b8ab8e','#65798f','#987c8d','#c0c9cb','#b88759','#6b8f86'];const o={id:++this.idCounter,x,w,h,type,color:colors[Math.floor(this.random()*colors.length)],passed:false,burning:false};this.obstacles.push(o);return o;}
    nextObstacleGap(){return Math.max(900,1120-this.time*1.8)+this.random()*100;}
    scheduleObstacle(gap){
      const tail=this.obstacles.reduce((m,o)=>Math.max(m,o.x+o.w),0);
      this.nextObstacle=Math.max(0,(tail-(WORLD.width+130)+gap)/this.speed);
    }
    spawnWave(){
      const gap=this.nextObstacleGap();
      const last=this.obstacles.reduce((m,o)=>Math.max(m,o.x+o.w),0);
      const first=this.spawnObstacle(Math.max(WORLD.width+130,last+gap));
      // Occasional short convoys need one longer flight; trucks remain solo.
      if(first.h<115&&this.random()<.3){const next=this.spawnObstacle(first.x+first.w,this.random()<.5?'sedan':'suv');next.x=first.x+first.w*157/160-next.w*3/160+2;}
      // Schedule from the whole convoy's tail, so higher speed means more waves.
      this.scheduleObstacle(gap);
    }
    beginWarning(){
      this.warning=2;
      let target=this.obstacles.filter(o=>o.x>WORLD.playerX+620).sort((a,b)=>a.x-b.x)[0];
      if(!target){target=this.spawnObstacle(WORLD.width+410,'suv');this.scheduleObstacle(this.nextObstacleGap());}
      target.eventTarget=true;this.emit('warning');
    }
    nextRivalDelay(){return Math.max(RIVAL_TIMING.minDelay,(RIVAL_TIMING.baseMinDelay+this.random()*(RIVAL_TIMING.baseMaxDelay-RIVAL_TIMING.baseMinDelay))/(1+this.time/RIVAL_TIMING.rampSeconds));}
    end(reason){if(this.mode!=='running')return;this.mode='ended';this.deathReason=reason;this.player.thrust=false;this.emit('death',{reason});}
    update(dt,held=false){
      this.events=[];if(this.mode!=='running')return this.events;
      // Fixed, small substeps prevent fast cars tunnelling through a hitbox.
      let remaining=Math.max(0,Math.min(dt,.1));
      while(remaining>1e-8&&this.mode==='running'){const step=Math.min(remaining,1/120);this.step(step,held);remaining-=step;}
      return this.events;
    }
    step(dt,held){
      const p=this.player;this.time+=dt;this.speed=Math.min(WORLD.maxSpeed,WORLD.startSpeed+this.time*WORLD.acceleration);this.scroll+=this.speed*dt;this.distance+=this.speed*dt*.08;
      if(!held)this.airLock=false;
      p.thrust=held&&this.air>0&&!this.airLock;
      if(p.thrust&&p.h===0)p.vy=190;
      if(p.thrust&&!this.lastThrust)this.emit('thrust');
      this.lastThrust=p.thrust;
      if(p.h>0||p.thrust){p.vy+=(p.thrust?1000:-1050)*dt;p.vy=Math.min(340,p.vy);p.h+=p.vy*dt;
        if(p.h>WORLD.maxAltitude){p.h=WORLD.maxAltitude;p.vy=Math.min(0,p.vy);}
        if(p.thrust)this.air=Math.max(0,this.air-WORLD.airDrain*dt);this.flightTime+=dt;
        if(this.air===0&&!this.airLock){this.airLock=true;p.thrust=false;this.emit('empty');}
        if(p.h<=0){p.h=0;p.vy=0;p.thrust=false;this.emit('land');}
      }else{this.air=Math.min(100,this.air+WORLD.airRegen*dt);}
      for(const o of this.obstacles)o.x-=this.speed*dt;
      this.nextObstacle-=dt;
      if(this.nextObstacle<=0)this.spawnWave();
      if(this.warning>0){this.warning-=dt;if(this.warning<=0){this.warning=0;this.rival={x:-205,w:166,h:66,speed:WORLD.rivalSpeed,burning:false};this.emit('rival');}}
      else if(!this.rival){this.nextRival-=dt;if(this.nextRival<=0){
        // Warn only in a clear stretch, so the ambush is always readable.
        const busy=this.obstacles.some(o=>o.x+o.w>WORLD.playerX-230&&o.x<WORLD.playerX+620);
        if(!busy)this.beginWarning();
      }}
      if(this.rival){const r=this.rival;
        r.x+=(r.burning?-this.speed:r.speed)*dt;
        if(!r.burning){
          const rivalVehicle={...r,type:'rival'},rivalParts=collisionParts(rivalVehicle),rivalBounds=bounds(rivalParts);
          const target=this.obstacles.filter(o=>intersectsParts(rivalParts,rivalBounds,o)).sort((a,b)=>a.x-b.x)[0];
          if(target){r.burning=true;target.burning=true;this.emit('impact',{x:target.x,y:WORLD.ground-32});}
        }
        if(r.x+r.w<-50){this.rival=null;this.nextRival=this.nextRivalDelay();}
      }
      const playerVehicle={type:'roadster',x:WORLD.playerX-WORLD.playerWidth/2,w:WORLD.playerWidth,h:WORLD.playerHeight,bottom:WORLD.ground-p.h,tilt:playerTilt(p)};
      const playerParts=collisionParts(playerVehicle),playerBounds=bounds(playerParts);
      for(const o of this.obstacles){
        if(intersectsParts(playerParts,playerBounds,o)){this.end(o.burning?'与起火残骸发生碰撞':'与停放车辆发生碰撞');break;}
        if(!o.passed&&o.x+o.w<playerBounds.left){o.passed=true;this.passed++;this.emit('pass');}
      }
      if(this.rival&&this.mode==='running'&&intersectsParts(playerParts,playerBounds,{...this.rival,type:'rival'}))this.end(this.rival.burning?'与起火残骸发生碰撞':'被左侧高速来车撞击');
      this.obstacles=this.obstacles.filter(o=>o.x+o.w>-60);
      if(Math.floor(this.distance/500)>this.milestone){this.milestone=Math.floor(this.distance/500);this.emit('milestone',{distance:this.milestone*500});}
    }
    pause(){if(this.mode==='running'){this.mode='paused';this.player.thrust=false;this.lastThrust=false;}}
    resume(){if(this.mode==='paused')this.mode='running';}
  }
  return {Game,WORLD,VEHICLES,SPRITES,playerTilt,collisionParts,vehiclesOverlap,polygonsOverlap};
});
