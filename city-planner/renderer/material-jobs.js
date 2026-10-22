/* One material job at a time; pixel synthesis never runs in an input frame. */
(function(root){
  'use strict';
  function create({workerFactory,prepareJob=null,onReady=()=>{},onError=()=>{},limit=96}={}){
    let worker=null,active=null,version=0,serial=0,disabled=false,completed=0,errors=0;
    const queue=new Map(),failed=new Set();
    function failAll(error){
      errors++;disabled=true;active=null;queue.clear();worker?.terminate();worker=null;onError(error);
    }
    function start(){
      if(disabled||active||!queue.size)return;
      if(!worker){
        try{worker=workerFactory();}catch(error){failAll(String(error));return;}
        worker.onerror=event=>{event.preventDefault?.();failAll(event.message||'Material worker failed');};
        worker.onmessage=({data})=>{
          if(!active||data.id!==active.id){data.bitmap?.close();return;}
          const job=active;active=null;
          if(data.version!==version){data.bitmap?.close();}
          else if(data.error||!data.bitmap){errors++;failed.add(job.key);onError(data.error||'Missing material bitmap');}
          else{completed++;onReady(job.key,data.bitmap);}
          start();
        };
      }
      const [key,payload]=queue.entries().next().value;queue.delete(key);
      const job=active={...payload,key,id:++serial,version};
      const send=prepared=>{
        if(disabled||active!==job){for(const item of prepared?.transfer||[])item.close?.();return;}
        try{worker.postMessage({...job,...prepared?.data},prepared?.transfer||[]);}
        catch(error){for(const item of prepared?.transfer||[])item.close?.();failAll(String(error));}
      };
      if(prepareJob)Promise.resolve().then(()=>prepareJob(job)).then(send,error=>{
        if(active!==job)return;active=null;errors++;failed.add(key);onError(String(error));start();
      });
      else send();
    }
    return {
      request(key,payload){
        if(disabled||failed.has(key))return false;
        if(active?.key===key&&active.version===version||queue.has(key))return true;
        if(queue.size>=limit)return true; // A later paint retries after the current work drains.
        queue.set(key,payload);start();return !disabled;
      },
      reset(){version++;queue.clear();failed.clear();},
      dispose(){version++;queue.clear();active=null;worker?.terminate();worker=null;disabled=true;},
      get stats(){return {pending:queue.size+(active?1:0),active:Boolean(active),completed,errors,disabled};}
    };
  }
  const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SceneMaterialJobs=api;
})(typeof window==='undefined'?{}:window);
