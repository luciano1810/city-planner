/* Buffered, authoritative vehicle trajectories. Animation follows all supplied
 * substeps; it never extrapolates through a stop line or cuts across a turn. */
(function(root){
  'use strict';
  const mix=(a,b,t)=>a+(b-a)*t;
  const angle=(a,b,t)=>a+Math.atan2(Math.sin(b-a),Math.cos(b-a))*t;
  class Playback{
    constructor({now=()=>performance.now(),delay=220}={}){this.now=now;this.baseDelay=delay;this.reset(null);}
    reset(traffic,now=this.now()){
      this.latest=traffic;this.received=now;this.end=now;this.cursor=now-this.baseDelay;
      this.delay=this.baseDelay;this.cars=new Map();this.signals=[];this.people=[];this.paused=false;
      for(const car of traffic?.vehicles||[])this.cars.set(car.id,{car,frames:[{time:now,...car}],birth:-Infinity,death:Infinity});
      if(traffic){this.signals.push({time:now,signals:traffic.signals});this.people.push({time:now,people:traffic.pedestrians||[]});}
    }
    push(traffic,animation,{reset=false,now=this.now(),time=now}={}){
      if(!traffic){this.reset(null,now);return;}
      if(reset||!this.latest||traffic.mode!==this.latest.mode||traffic.motionTime<this.latest.motionTime){this.reset(traffic,now);return;}
      if(!animation||animation.end<=animation.start){this.latest=traffic;return;}
      const elapsed=Math.max(1,time-this.end),start=this.end;
      // A short history absorbs request jitter. Reduce latency gradually, so
      // correcting the buffer cannot send a vehicle backwards.
      this.delay=Math.min(5000,Math.max(this.baseDelay,now-time+elapsed*1.15,this.delay*.99));
      const stamp=t=>mix(start,time,Math.max(0,Math.min(1,(t-animation.start)/(animation.end-animation.start))));
      const current=new Set(traffic.vehicles.map(v=>v.id));
      for(const car of [...traffic.vehicles,...animation.departed||[]]){
        let entry=this.cars.get(car.id);
        const trace=animation.tracks?.[car.id]||[];
        if(!entry){entry={car,frames:[],birth:trace.length?stamp(trace[0][0]):now,death:Infinity};this.cars.set(car.id,entry);}
        entry.car=car;
        for(const p of trace){
          const frame={time:stamp(p[0]),point:[p[1],p[2]],heading:p[3],speed:p[4],road:p[5],level:p[6],state:p[7],progress:p[8]};
          const last=entry.frames.at(-1);
          if(last&&Math.abs(last.time-frame.time)<.001)entry.frames[entry.frames.length-1]=frame;
          else entry.frames.push(frame);
        }
        if(!trace.length)entry.frames.push({time,...car});
        if(!current.has(car.id))entry.death=entry.frames.at(-1).time;
      }
      for(const [id,entry] of this.cars)if(!current.has(id)&&entry.death===Infinity)entry.death=now;
      for(const [time,signals] of animation.signals||[])this.signals.push({time:stamp(time),signals});
      if(!animation.signals?.length)this.signals.push({time,signals:traffic.signals});
      this.people.push({time,people:traffic.pedestrians||[]});
      this.latest=traffic;this.received=now;this.end=time;
    }
    setPaused(paused){
      if(paused===this.paused)return;
      if(paused)this.pauseTime=this.now();
      else{
        const shift=Math.max(0,this.now()-this.pauseTime);
        this.cursor+=shift;this.end+=shift;this.received+=shift;
        for(const entry of this.cars.values()){
          entry.birth+=shift;entry.death+=shift;for(const frame of entry.frames)frame.time+=shift;
        }
        for(const frame of [...this.signals,...this.people])frame.time+=shift;
      }
      this.paused=paused;
    }
    frame(now=this.now()){
      if(!this.latest)return null;
      if(!this.paused)this.cursor=Math.max(this.cursor,Math.min(this.end,now-this.delay));
      const time=this.cursor,vehicles=[];
      const trim=frames=>{while(frames.length>2&&frames[1].time<=time)frames.shift();};
      for(const [id,entry] of this.cars){
        if(time>=entry.death){this.cars.delete(id);continue;}
        if(time<entry.birth||!entry.frames.length)continue;
        trim(entry.frames);
        const a=entry.frames[0],b=entry.frames[1]||a;
        const t=Math.max(0,Math.min(1,(time-a.time)/Math.max(.001,b.time-a.time)));
        vehicles.push({...entry.car,...(t<1?a:b),point:a.point.map((v,k)=>mix(v,b.point[k],t)),
          heading:angle(a.heading,b.heading,t),speed:mix(a.speed,b.speed,t),progress:mix(a.progress||0,b.progress||0,t)});
      }
      while(this.signals.length>1&&this.signals[1].time<=time)this.signals.shift();
      trim(this.people);
      const from=this.people[0],to=this.people[1]||from;
      const blend=from&&to?Math.max(0,Math.min(1,(time-from.time)/Math.max(.001,to.time-from.time))):0;
      const targets=new Map((to?.people||[]).map(p=>[p.id,p]));
      const pedestrians=(from?.people||[]).map(p=>{
        const q=targets.get(p.id);
        // Only blend continuous sidewalk poses. Crossing boundaries keep the
        // authoritative pose rather than drawing a diagonal through a building.
        if(!q||p.kind!==q.kind||Math.hypot(q.point[0]-p.point[0],q.point[1]-p.point[1])>8)return p;
        return {...p,point:p.point.map((v,k)=>mix(v,q.point[k],blend)),heading:angle(p.heading||0,q.heading||0,blend)};
      });
      return {...this.latest,vehicles,pedestrians,signals:this.signals[0]?.signals||this.latest.signals};
    }
    get pending(){return this.cursor<this.end;}
  }
  const api={Playback,angle};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CityTrafficPlayback=api;
})(typeof window==='undefined'?{}:window);
