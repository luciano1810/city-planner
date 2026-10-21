/* One serialized driver. Pausing stops future ticks but still accepts a tick
 * already committed by the backend; changing cities invalidates that response. */
(function(root){
  'use strict';
  const speeds=[1,5,15,60,300,3600,21600,86400,604800,2592000];
  const labels=['1× · 实时','5×','15×','60× · 1 分钟/秒','5 分钟/秒','1 小时/秒','6 小时/秒','1 天/秒','7 天/秒','30 天/秒'];
  class Driver{
    constructor({request,apply,onState=()=>{},onError=()=>{},now=()=>performance.now(),schedule=(...args)=>setTimeout(...args),cancel=id=>clearTimeout(id)}){
      Object.assign(this,{request,apply,onState,onError,now,schedule,cancel});
      this.running=false;this.speed=1;this.timer=null;this.last=0;this.carry=0;this.epoch=0;this.ticking=false;this.queue=Promise.resolve();
    }
    accrue(){if(this.running){const current=this.now();this.carry+=Math.max(0,current-this.last)/1000*this.speed;this.last=current;}}
    start(){if(this.running)return;this.running=true;this.last=this.now();this.onState();if(!this.ticking)this.plan(0);}
    pause(){this.running=false;this.cancel(this.timer);this.timer=null;this.carry=0;this.onState();return this.queue;}
    invalidate(){this.epoch++;return this.pause();}
    plan(delay=100){this.cancel(this.timer);if(this.running)this.timer=this.schedule(()=>this.tick(),delay);}
    send(seconds,extra={}){
      const epoch=this.epoch,rate=this.speed;
      const task=this.queue.then(async()=>{
        if(epoch!==this.epoch)return;
        const result=await this.request({seconds,speed:rate,...extra});
        if(epoch===this.epoch)this.apply(result);
        return result;
      });
      this.queue=task.catch(error=>{if(epoch===this.epoch){this.pause();this.onError(error);}});
      return task;
    }
    async tick(){
      if(!this.running||this.ticking)return;
      this.ticking=true;this.accrue();const seconds=Math.min(31*86400,this.carry);this.carry-=seconds;
      try{await this.send(seconds);}catch{}finally{this.ticking=false;this.plan();}
    }
    setSpeed(speed,{persist=true}={}){
      if(!speeds.includes(speed))throw new Error('未知模拟速度');
      this.accrue();this.speed=speed;this.onState();
      return persist?this.send(0):Promise.resolve();
    }
    async reset(){const resume=this.running;await this.pause();await this.send(0,{reset:true});if(resume)this.start();}
    async settle(){await this.pause();}
  }
  const api={Driver,speeds,labels};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CitySimulation=api;
})(typeof window==='undefined'?{}:window);
