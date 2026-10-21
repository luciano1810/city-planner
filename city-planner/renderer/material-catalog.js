/* Shared deterministic material choices. Indices refer to local 4 x 4 atlases. */
(function(root){
  'use strict';
  const range=(a,n)=>Array.from({length:n},(_,i)=>a+i);
  const catalog={
    asphalt:{atlas:'ground',cells:range(0,4),meters:5,rgb:[79,83,86],grain:16},
    paving:{atlas:'ground',cells:[4,5,6,7,12,13,14,15],meters:4.8,rgb:[185,181,169],grain:12},
    roof:{atlas:'roof',cells:range(0,8),meters:6,rgb:[188,188,180],grain:15},
    roofTiles:{atlas:'roof',cells:range(8,4),meters:3,rgb:[137,111,91],grain:12},
    metal:{atlas:'roof',cells:range(12,4),meters:4,rgb:[146,159,161],grain:9},
    facade:{atlas:'facade',cells:range(0,12),meters:2.4,rgb:[177,173,158],grain:12},
    glass:{atlas:'facade',cells:range(12,4),meters:4,rgb:[63,91,107],grain:4},
    grass:{atlas:'landscape',cells:range(8,4),meters:3.5,rgb:[95,114,65],grain:22},
    gravel:{atlas:'landscape',cells:range(4,4),meters:3,rgb:[159,156,143],grain:24},
    water:{atlas:'landscape',cells:range(0,4),meters:12,rgb:[58,110,134],grain:8},
    soil:{atlas:'landscape',cells:range(12,4),meters:3,rgb:[132,110,80],grain:22},
    curb:{atlas:'facade',cells:[0,2,3,8],meters:3,rgb:[200,198,184],grain:12},
    marking:{variants:4,meters:1.8,rgb:[242,239,220],grain:9},
    markingYellow:{variants:4,meters:1.8,rgb:[222,185,81],grain:10},
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
})(typeof window==='undefined'?{}:window);
