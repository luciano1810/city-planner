/* Shared deterministic material choices. Indices refer to local 4 x 4 atlases. */
(function(root){
  'use strict';
  const range=(a,n)=>Array.from({length:n},(_,i)=>a+i);
  const catalog={
    siteGround:{atlas:'building-stages',cells:[0,1],meters:3,rgb:[167,147,112],grain:14},
    excavation:{atlas:'building-stages',cells:[2,3],meters:2.4,rgb:[124,95,65],grain:18},
    rawConcrete:{atlas:'building-stages',cells:[4],meters:3,rgb:[183,181,169],grain:10},
    reinforcement:{atlas:'building-stages',cells:[5],meters:1.8,rgb:[148,143,126],grain:8},
    safetyNet:{atlas:'building-stages',cells:[6],meters:.75,rgb:[66,127,113],grain:6},
    formwork:{atlas:'building-stages',cells:[7],meters:2.4,rgb:[171,151,114],grain:10},
    asphalt:{atlas:'ground',cells:range(0,4),meters:5,rgb:[91,98,105],grain:11},
    paving:{atlas:'ground',cells:[4,5,6,7,12,13,14,15],meters:4.8,rgb:[241,228,207],grain:9},
    pavingWarm:{atlas:'ground',cells:[12,13,4,7],meters:4.8,rgb:[232,183,150],grain:7},
    roof:{atlas:'roof',cells:range(0,8),meters:6,rgb:[221,224,218],grain:11},
    roofTiles:{atlas:'roof',cells:range(8,4),meters:3,rgb:[137,111,91],grain:12},
    metal:{atlas:'roof',cells:range(12,4),meters:4,rgb:[146,159,161],grain:9},
    facade:{atlas:'facade',cells:range(0,12),meters:2.4,rgb:[202,201,189],grain:10},
    glass:{atlas:'facade',cells:range(12,4),meters:4,rgb:[63,91,107],grain:4},
    grass:{atlas:'landscape',cells:range(8,4),meters:3.5,rgb:[105,139,46],grain:17},
    gravel:{atlas:'landscape',cells:range(4,4),meters:3,rgb:[159,156,143],grain:24},
    water:{atlas:'landscape',cells:range(0,4),meters:12,rgb:[57,130,163],grain:8},
    soil:{atlas:'landscape',cells:range(12,4),meters:3,rgb:[132,110,80],grain:22},
    curb:{atlas:'facade',cells:[0,2,3,8],meters:3,rgb:[245,239,221],grain:8},
    marking:{variants:4,meters:1.8,rgb:[250,249,239],grain:5},
    markingYellow:{variants:4,meters:1.8,rgb:[244,194,62],grain:6},
    carPaint:{variants:12,meters:3,rgb:[210,215,208],grain:7}
  };
  const paintColors=[[227,231,225],[155,43,38],[46,101,146],[210,167,56],[58,67,72],[170,184,191],
    [39,75,68],[114,46,49],[208,195,168],[35,46,64],[192,195,194],[107,103,96]];
  // Crown radii and mature height ranges in metres. Each species has a distinct
  // raster silhouette; rotations add individual variation without changing it.
  const treeSpecies=[
    ['oak','阔冠橡树',3.4,5,9,15],['maple','绿枫',3,4.5,7,12],
    ['plane','悬铃木',3.3,4.8,9,15],['street-smallleaf','小叶行道树',2.6,3.5,6,10],
    ['london-plane','伦敦悬铃木',3.8,5.2,11,18],['english-oak','英国橡树',4,5.5,10,17],
    ['elm','榆树',3.5,4.8,9,15],['linden','椴树',3,4.4,8,14],
    ['ginkgo','银杏',2.8,4.1,9,16],['japanese-maple','红枫',2.4,3.7,4,8],
    ['cherry','樱花树',2.8,4,5,9],['birch','白桦',2.5,3.6,10,17],
    ['scots-pine','欧洲赤松',3.3,4.8,11,19],['blue-spruce','蓝云杉',2.5,3.8,10,18],
    ['fir','冷杉',2.6,3.8,12,20],['cypress','意大利柏',1.6,2.2,10,17],
    ['willow','垂柳',4,5.5,8,14],['palm','棕榈',2.7,4,9,15],
    ['magnolia','广玉兰',2.7,4,6,11],['crape-myrtle','紫薇',2.3,3.5,4,8]
  ].map(([id,name,r0,r1,h0,h1],i)=>({id,name,radius:[r0,r1],height:[h0,h1],atlas:i<4?'classic':'species',cell:i<4?i:i-4,columns:i<4?2:4}));
  const treeMixes={
    street:[0,2,4,6,7,8,11],park:[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,18,19],
    garden:[0,1,3,4,5,6,7,8,9,10,11,18,19],plaza:[0,4,6,7,8,18,19,15,17],industrial:[2,3,6,11,12,14]
  };
  function count(name){const c=catalog[name];return c?.cells?.length||c?.variants||0;}
  function pick(name,variant=0){
    const c=catalog[name]||catalog.roof,index=((Math.trunc(variant)||0)%(c.cells?.length||c.variants)+(c.cells?.length||c.variants))%(c.cells?.length||c.variants);
    return {...c,index,cell:c.cells?.[index],rgb:name==='carPaint'?paintColors[index]:c.rgb};
  }
  function tree(variant=0){return treeSpecies[((Math.trunc(variant)||0)%treeSpecies.length+treeSpecies.length)%treeSpecies.length];}
  const api={catalog,count,pick,paintColors,treeSpecies,treeMixes,tree};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.SceneMaterials=api;
})(typeof window==='undefined'?(typeof self==='undefined'?{}:self):window);
