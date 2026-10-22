/* Typical-workday assignment metrics, separate from animated vehicle samples. */
(() => {
  'use strict';
  const periods={peak:'高峰最大值',am:'早高峰（2 小时）',off:'平峰（活动抽样）',pm:'晚高峰（2 小时）'};
  const views={
    congestion:{label:'道路饱和度',note:'流量 / 有效容量',scope:'road',unit:'%',period:true,legend:'绿 ≤60% · 橙 60%–100% · 红 >100%。'},
    speed:{label:'预计通行速度',note:'含拥堵与信号等待',scope:'road',unit:'km/h',period:true,legend:'红 <15 · 橙 15–30 · 绿 ≥30 km/h；按交通模型估算，含信号等待。'},
    delay:{label:'道路延误',note:'相对自由流额外耗时',scope:'road',unit:'秒',period:true,legend:'绿 ≤15 · 橙 15–60 · 红 >60 秒；每段相对自由流的额外耗时，含信号等待。'},
    roadCapacity:{label:'有效道路容量',note:'地形与信号修正后',scope:'road',unit:'辆/h',legend:'浅蓝 → 深蓝：有效容量增加，包含地形与信号修正。'},
    transitLoad:{label:'公交线路负荷',note:'线路峰值载客率',scope:'line',unit:'%',legend:'绿 ≤60% · 橙 60%–100% · 红 >100%；各运营线路的峰值载客率。'},
    stationActivity:{label:'站点客流',note:'上车与下车人次',scope:'stop',unit:'人次',legend:'圆点越大、颜色越深，典型日上下车人次越多；包含换乘，非独立乘客数。'},
    commute:{label:'住宅通勤时间',note:'按已完成通勤家庭平均',scope:'parcel',unit:'分钟',legend:'绿 ≤30 · 橙 30–60 · 红 >60 分钟；按住宅内有通勤记录的家庭平均，灰色无记录。'},
    publicAccess:{label:'公交岗位可达',note:'30 分钟步行与公交',scope:'parcel',unit:'岗位',legend:'浅蓝 → 深蓝：30 分钟内步行与公交可达岗位增加，包含步行接驳。'},
    connectivity:{label:'路网接入',note:'发现失去连接的地块',scope:'parcel',unit:'',legend:'绿：已接入道路 · 红：未接入 · 灰：接入状态未知。'}
  };
  const roadLayers=['traffic',...Object.keys(views).filter(key=>views[key].scope==='road')];
  const physicalLayers=['use','districts','transit','flows',...roadLayers,'transitLoad','stationActivity'];
  function metric(edge,period='peak'){
    if(period==='peak')return {hourly:edge.traffic??null,ratio:edge.ratio??null,vehicles:null};
    return edge.trafficPeriods?.[period]||{hourly:null,ratio:null,vehicles:null};
  }
  function status(ratio){
    return ratio==null?'无饱和度数据':ratio>1?'超载':ratio>.6?'接近容量':'畅通';
  }
  function color(info,period='peak',maximum=0){
    if(period==='off')return info.vehicles==null?'#a2aaa9':`hsl(201 48% ${85-45*(maximum?Math.min(1,info.vehicles/maximum):0)}%)`;
    return info.ratio==null?'#a2aaa9':info.ratio>1?'#b75b47':info.ratio>.6?'#c8934d':'#6e956c';
  }
  function summarize(edges,period){
    const values=edges.map(e=>metric(e,period));
    const maximum=key=>values.some(v=>v[key]!=null)?Math.max(...values.filter(v=>v[key]!=null).map(v=>v[key])):null;
    return {vehicles:maximum('vehicles'),hourly:maximum('hourly'),ratio:maximum('ratio')};
  }
  const finite=value=>typeof value==='number'&&Number.isFinite(value);
  function capacity(edge,cfg){
    return cfg?.capacity>0?Math.max(1,cfg.capacity*(edge.terrainCapacity??1)*(edge.signalCapacityFactor??1)):null;
  }
  function performance(edge,cfg,period='peak'){
    const effective=capacity(edge,cfg),info=metric(edge,period);
    const free=edge.freeTime??(cfg?.speed>0?edge.length/1000/cfg.speed*60:null);
    const signal=Math.max(edge.signalDelayForward||0,edge.oneway?0:edge.signalDelayReverse||0);
    let running=period==='peak'?edge.time:null;
    if(period!=='peak'&&finite(info.ratio)&&finite(free))running=free*(1+.6*Math.min(5,info.ratio)**2);
    const minutes=finite(running)?running+signal:null;
    return {capacity:effective,minutes,speed:minutes>0&&finite(edge.length)?edge.length/1000/minutes*60:null,
      delay:finite(minutes)&&finite(free)?Math.max(0,minutes-free)*60:null};
  }
  function roadValue(edge,cfg,layer,period='peak'){
    if(layer==='traffic'){const info=metric(edge,period);return period==='off'?info.vehicles:info.hourly;}
    if(layer==='congestion'){const ratio=metric(edge,period).ratio;return finite(ratio)?ratio*100:null;}
    const values=performance(edge,cfg,period);
    return layer==='roadCapacity'?values.capacity:values[layer]??null;
  }
  function shade(value,maximum){return finite(value)?`hsl(201 48% ${85-45*(maximum>0?Math.min(1,Math.max(0,value/maximum)):0)}%)`:'#a2aaa9';}
  function viewColor(layer,value,maximum){
    if(!finite(value))return '#a2aaa9';
    if(layer==='speed')return value<15?'#b75b47':value<30?'#c8934d':'#6e956c';
    if(layer==='delay')return value>60?'#b75b47':value>15?'#c8934d':'#6e956c';
    if(layer==='congestion'||layer==='transitLoad')return color({ratio:value/100});
    if(layer==='commute')return value>60?'#b75b47':value>30?'#c8934d':'#6e956c';
    if(layer==='connectivity')return value?'#6e956c':'#b75b47';
    return shade(value,maximum);
  }
  const commuteCache=new WeakMap();
  function commutes(state){
    if(commuteCache.has(state))return commuteCache.get(state);
    const result=new Map();
    for(const p of state.parcels||[])if(p.commuteStats)result.set(p.id,p.commuteStats);
    commuteCache.set(state,result);return result;
  }
  function parcelValue(parcel,state,layer){
    if(layer==='commute')return commutes(state).get(parcel.id)?.mean??null;
    if(layer==='publicAccess')return finite(parcel.publicJobs)?parcel.publicJobs:null;
    if(layer==='connectivity')return typeof parcel.connected==='boolean'?Number(parcel.connected):null;
    return null;
  }
  function stopActivity(stop){return finite(stop.boardings)&&finite(stop.alightings)?stop.boardings+stop.alightings:null;}
  function availability(state,layer){
    if(layer==='transitLoad')return (state.lines||[]).some(l=>l.valid)?'仅展示运营有效的线路。':'尚无运营有效的公交线路。';
    if(layer==='stationActivity')return state.stops?.length?'客流为典型日累计。':'尚无站点，可先建设站点及开通线路。';
    if(layer==='commute')return [...commutes(state).values()].some(r=>r.count)?'不包含未完成的通勤旅程。':'尚无已完成通勤记录；有居民就业并完成交通分配后更新。';
    return '';
  }
  const api={periods,views,roadLayers,physicalLayers,metric,status,color,summarize,capacity,performance,roadValue,viewColor,commutes,parcelValue,stopActivity,availability};
  if(typeof module!=='undefined')module.exports=api;
  else window.CityTrafficMetrics=api;
})();
