/* Bounded LRU storage for prepainted scene objects. No viewport-sized history. */
(function(root){
  'use strict';
  function create({budget=48*1024*1024,limit=256,dispose=()=>{}}={}){
    const entries=new Map();let bytes=0,hits=0,misses=0;
    function remove(key){const item=entries.get(key);if(!item)return;entries.delete(key);bytes-=item.bytes;dispose(item.value);}
    return {
      get(key){const item=entries.get(key);if(!item){misses++;return null;}hits++;entries.delete(key);entries.set(key,item);return item.value;},
      set(key,value,size){remove(key);if(size>budget||size<0)return value;while(entries.size&&(bytes+size>budget||entries.size>=limit))remove(entries.keys().next().value);entries.set(key,{value,bytes:size});bytes+=size;return value;},
      clear(){for(const key of entries.keys())remove(key);},
      get stats(){return {entries:entries.size,bytes,budget,hits,misses};}
    };
  }
  const api={create};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SceneRasterCache=api;
})(typeof window==='undefined'?{}:window);
