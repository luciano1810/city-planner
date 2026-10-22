/* Observation cards retain the original engine-owned controls and actions. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const layers=[
    ['use','城市地图','建筑用途','city'],['population','居住人口','人口分布','city'],['jobs','岗位密度','就业空间','city'],['districts','功能城区','城区与街区','city'],['height','建筑高度','建筑楼层','city'],['development','开发状态','施工与使用','city'],
    ['land','土地单价','土地估值','economy'],['rent','空间租金','空间使用成本','economy'],['vacancy','建筑空置','空置比例','economy'],['change','土地涨跌','周度价格变化','economy'],['comparison','方案差异','比较存档后查看','economy'],
    ['access','岗位可达','30 分钟可达岗位','traffic'],['traffic','道路流量','分时车流与拥挤度','traffic'],['transit','公交服务','线路与站点','traffic'],['flows','人员流向','出行方向','traffic'],
    ...Object.entries(window.CityTrafficMetrics.views).map(([key,view])=>[key,view.label,view.note,'traffic']),
    ['pollution','环境压力','环境压力指数','nature'],['slope','地块坡度','地形坡度','nature'],['cost','工程成本','地形建设成本','nature'],['landscape','景观品质','景观资源','nature'],['risk','低地邻水','低地邻水指数','nature']
  ];
  const queries=[['route','出行旅程','选择起点和终点'],['area','范围统计','框选两个对角点'],['isochrone','等时范围','选择建筑或站点']];
  const reports=[['city-history','历史明细','城市历史与年鉴','history'],['city-csv','统计 CSV','导出历月统计','export'],['city-summary','情景摘要','导出城市摘要','summary'],['city-compare','方案比较','与另一存档比较','compare'],['city-baseline','记录基线','保留当前统计对照','baseline'],['city-branch','独立方案','保存原方案并创建分支','branch']];
  // Each miniature describes the actual information/tool, not just its category.
  // Keep geometry bold enough to read at the 115 px mobile card width.
  function thumbnail(kind){
    const ink='#36566a',green='#387f67',blue='#468fa9',gold='#c79847',red='#b96550';
    const rect=(x,y,w,h,fill,rx=2)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}"/>`;
    const line=(d,stroke=ink,width=2)=>`<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const circle=(x,y,r,fill)=>`<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
    const label=(x,y,text,fill=ink,size=12)=>`<text x="${x}" y="${y}" fill="${fill}" font-family="system-ui,sans-serif" font-weight="700" font-size="${size}" text-anchor="middle">${text}</text>`;
    const person=(x,y,color)=>circle(x,y,3.5,color)+`<path d="M${x-5} ${y+13}v-5a5 5 0 0 1 10 0v5z" fill="${color}"/>`;
    const tower=(x,bottom,w,h,color)=>rect(x,bottom-h,w,h,color)+`<path d="m${x} ${bottom-h} 7-6h${w}l-7 6z" fill="#dce7e8"/><path d="m${x+w} ${bottom-h} 7-6v${h}l-7 6z" fill="${ink}" opacity=".7"/>`+Array.from({length:Math.max(1,Math.floor((h-10)/11))},(_,i)=>line(`M${x+5} ${bottom-h+8+i*11}h${w-10}`,'#eaf4ef',2)).join('');
    const coin=(x,y)=>circle(x,y,13,'#f4d795')+circle(x,y,10,gold)+label(x,y+5,'¥','#fff8df',15);
    const clock=(x,y,r=14,minutes=null)=>circle(x,y,r,'#fff')+`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${ink}" stroke-width="2.5"/>`+(minutes?label(x,y+4,minutes,ink,12):line(`M${x} ${y-r+5}v${r-5}l6 3`,ink,2.5));
    const base=rect(0,0,160,96,'#eaf0e8');
    const street=line('M0 48h160M52 0v96M112 0v96','#fffdf6',8);
    const parcels=(colors)=>[[8,9,34,29],[62,9,40,29],[122,9,30,29],[8,59,34,27],[62,59,40,27],[122,59,30,27]].map(([x,y,w,h],i)=>rect(x,y,w,h,colors[i])).join('');
    const neutral=parcels(['#d4dfd0','#cad8d2','#d8dfd0','#d0ddd4','#d7ded1','#cfdbd1'])+street;
    const paper=rect(32,8,94,80,'#fffdf7',5)+line('M46 23h40',ink,4);
    const art={
      use:()=>street+parcels(['#b3c69c','#c9b08a','#87a7b2','#a5bda0','#aea0b5','#c3bca5'])
        +rect(14,15,21,16,'#7c976c')+rect(69,16,25,15,'#ac864d')+rect(129,15,15,17,'#557e90')
        +rect(15,64,19,16,'#7c976c')+rect(68,66,27,12,'#8a799d')+rect(127,65,20,14,'#a49b80'),
      population:()=>parcels(['#dce7cc','#8cb99a','#398669','#bed3b0','#559b7a','#34795e'])+street
        +person(24,18,green)+person(73,17,'#fff')+person(91,17,'#fff')+[130,144].map(x=>person(x,17,'#fff')).join('')
        +person(24,66,green)+[72,91,130,144].map(x=>person(x,66,'#fff')).join(''),
      jobs:()=>line('M10 81h140','#aabdaf',3)+tower(20,79,25,37,'#79a798')+tower(60,79,29,59,'#437c78')+tower(107,79,21,46,'#5a9384')
        +rect(95,54,42,30,gold,4)+line('M107 54v-7h18v7M95 65h42M116 62v8','#fff7df',3),
      districts:()=>`<path d="M7 9h68l-7 41H7z" fill="#b6cfb4"/><path d="M85 9h68v70l-61 8-14-32z" fill="#d9c498"/><path d="m7 60 61 0 14 27H7z" fill="#b1cad8"/>`
        +line('M4 54h69L81 3M74 55l15 38','#fff',7)+line('M10 13h60l-7 32H10z',green,2)
        +line('M90 14h57v59l-50 7-13-28z','#a17f42',2)+rect(22,22,15,11,'#7ba283')+rect(43,22,15,11,'#7ba283')
        +rect(103,27,30,18,'#b69b60')+rect(22,67,37,11,'#779eb6'),
      height:()=>line('M11 82h137','#b6c6b6',3)+tower(22,78,23,21,'#a7c29f')+tower(61,78,24,40,'#689d81')+tower(103,78,24,62,'#357660')
        +line('M145 77V18m-5 5 5-5 5 5M141 77h8',ink,2.5),
      development:()=>rect(10,56,36,24,'#e5e1cf')+`<path d="M10 56h36v24H10z" stroke="${gold}" stroke-width="2" stroke-dasharray="4 3"/>`
        +rect(60,42,34,38,'#d4b777')+line('M60 54h34M60 67h34M70 42v38M84 42v38','#fff3d5',2)
        +line('M74 12v30M54 17h51l-30-9v9M101 17v17',gold,3)+tower(113,80,25,52,green)
        +line('m118 66 6 6 12-14','#fff',3),
      land:()=>parcels(['#d9e1bd','#9cbb8b','#679e7a','#a6c08c','#4e9370','#31765c'])+street
        +`<path d="m57 10 42 0 0 28-42 0z" fill="none" stroke="${ink}" stroke-width="2" stroke-dasharray="4 3"/>`+coin(82,65)+coin(103,72),
      rent:()=>tower(26,81,49,62,'#63928f')+line('M35 80V65h13v15','#eaf2e7',3)+circle(113,36,15,gold)+circle(113,36,7,'#f7efd6')
        +line('M103 47 81 69v12h13v-9h8v-9',gold,7)+coin(127,74),
      vacancy:()=>rect(27,14,86,68,'#aebdb9')+rect(33,8,74,7,ink)
        +[[38,24],[62,24],[86,24],[38,45],[62,45],[86,45],[38,66],[62,66],[86,66]].map(([x,y],i)=>rect(x,y,14,12,i===0||i===4?'#edc76b':'#f6f8ed')).join('')
        +line('M122 29h22v40h-22',ink,2)+line('M128 39h10m-10 10h10m-10 10h10','#aabbb4',3),
      change:()=>parcels(['#dac49c','#83b1c2','#bd9d61','#6c9db1','#ddcaaa','#8fb9c8'])+street
        +line('M25 34V15m-7 7 7-7 7 7',gold,4)+line('M82 12v21m-7-7 7 7 7-7',blue,4)
        +line('M82 81V61m-7 7 7-7 7 7',gold,4)+line('M137 59v22m-7-7 7 7 7-7',blue,4),
      comparison:()=>rect(8,13,63,71,'#e3e8dd',4)+rect(89,13,63,71,'#f4eee1',4)
        +[[17,23],[44,23],[17,56],[44,56]].map(([x,y])=>rect(x,y,18,18,'#abbeb2')).join('')
        +rect(99,23,18,18,'#c69e63')+rect(126,23,18,18,'#719daf')+rect(99,56,18,18,'#719daf')+rect(126,56,18,18,'#c69e63')
        +line('M80 9v78',ink,2)+label(80,53,'Δ',ink,20),
      access:()=>neutral+`<path d="M12 44 34 18h67l34 29-20 36H30z" fill="#78ac9555"/>`
        +line('M29 68h49V30h43',green,4)+tower(66,47,20,26,green)+person(25,62,ink)+clock(126,67,17,'30'),
      traffic:()=>neutral+line('M0 48h160',green,9)+line('M52 0v48h60v48',gold,9)+line('M52 48h60',red,9)
        +[60,75,90].map(x=>rect(x,43,9,4,'#fff',1)).join('')+rect(28,44,12,4,'#fff',1)+rect(108,66,4,12,'#fff',1),
      congestion:()=>neutral+line('M0 48h160',red,12)+[27,43,59,75,91,107,123].map(x=>rect(x,45,11,5,'#fff',1)).join('')+label(83,28,'110%',red,20),
      speed:()=>neutral+`<path d="M30 72a50 50 0 0 1 100 0" fill="#fff" stroke="${green}" stroke-width="8"/>`+line('M80 70 112 35',red,5)+circle(80,70,7,ink)+label(80,91,'km/h',ink,13),
      delay:()=>neutral+clock(80,49,32)+line('M37 80h-17M32 66H8',red,4)+label(137,30,'+s',red,18),
      roadCapacity:()=>neutral+line('M8 36h144M8 61h144',blue,14)+[29,69,109].map(x=>rect(x,33,17,6,'#fff',1)+rect(x+16,58,17,6,'#fff',1)).join('')+label(80,87,'辆 / h',ink,13),
      transitLoad:()=>rect(17,16,126,64,blue,10)+rect(27,27,42,25,'#eaf3f5')+rect(90,27,42,25,'#eaf3f5')+[39,56,103,120].map(x=>person(x,31,gold)).join('')+circle(42,80,8,ink)+circle(117,80,8,ink)+label(80,71,'85%','#fff',17),
      stationActivity:()=>neutral+line('M10 46h140',blue,5)+circle(80,46,25,'#b2d5df')+circle(80,46,14,blue)+person(27,67,ink)+person(134,14,ink)+line('m42 64 18-9m-7-3 7 3-3 6',green,3)+line('m109 38 17-9m-7-3 7 3-3 6',green,3),
      commute:()=>neutral+rect(14,59,27,25,green)+line('m8 60 20-18 20 18',green,5)+tower(119,82,20,53,blue)+line('M49 72h49V47',gold,4)+clock(79,28,22,'30'),
      publicAccess:()=>neutral+line('M23 73h30V24h71',blue,5)+circle(53,49,6,'#fff')+tower(112,83,21,32,green)+tower(126,39,18,27,green)+clock(23,26,16,'30'),
      connectivity:()=>neutral+line('M9 48h69',green,7)+line('M88 48h63',red,7)+rect(20,17,25,22,green)+line('M33 39v9',green,4)+rect(116,64,25,20,red)+line('m121 20 16 16m0-16-16 16',red,4),
      transit:()=>neutral+line('M13 77h40V23h85',blue,5)+line('M17 26h92v51h31',gold,5)
        +[[30,77],[53,53],[53,23],[86,23],[109,50],[140,77]].map(([x,y])=>circle(x,y,5,'#fff')+circle(x,y,2.5,ink)).join('')
        +rect(110,9,32,21,blue,5)+rect(115,13,22,8,'#e8f4f6')+circle(117,27,2.5,ink)+circle(135,27,2.5,ink),
      flows:()=>neutral+line('M22 77Q42 18 126 25',gold,7)+line('m113 16 15 9-14 9',gold,5)
        +line('M23 80q74 8 113-24',blue,5)+line('m123 51 16 4-6 13',blue,4)
        +circle(22,78,9,ink)+circle(134,25,7,gold)+circle(143,51,7,blue),
      pollution:()=>`<ellipse cx="106" cy="26" rx="43" ry="20" fill="#91af9360"/><ellipse cx="88" cy="35" rx="32" ry="18" fill="#578e7770"/>`
        +rect(27,58,76,25,'#7f9191')+rect(41,31,11,40,ink)+rect(65,43,10,29,ink)
        +`<path d="m27 58 25-14v14l25-14v14z" fill="#9fb4a7"/>`+circle(52,22,9,'#739b80')+circle(68,17,12,'#91b194')
        +line('M104 43q15-8 31 0m-30 13q15-8 31 0',green,3)+rect(39,68,10,8,'#c9ddd1')+rect(59,68,10,8,'#c9ddd1'),
      slope:()=>`<path d="M0 85 81 9l79 76z" fill="#b3c5a0"/><path d="m81 9 79 76H94z" fill="#7eaa87"/>`
        +line('M17 72q46-8 67-40m-49 23q32-9 40-26M9 84q70-7 91-29','#e5edd1',3)
        +line('m47 79 48-44m-13 1 13-1-1 13',ink,3)+line('M105 77h35V45',ink,2),
      cost:()=>`<path d="M0 80h30V65h32V50h36V35h62v61H0z" fill="#c2b18b"/><path d="M0 87h42V73h35V59h40V45h43" fill="none" stroke="#e9dbc0" stroke-width="3"/>`
        +line('M29 61V46h40V29h43',ink,4)+rect(55,33,18,14,gold)+line('m71 35 13-18 23 9-4 11',gold,5)
        +circle(57,50,5,ink)+circle(72,50,5,ink)+coin(133,71),
      landscape:()=>`<path d="M0 49 34 17 61 45 88 15l37 33 35-15v63H0z" fill="#afc7a2"/><path d="M0 74q52-36 101-17t59-11v50H0z" fill="#77a684"/><path d="M89 0q-33 35 0 54t-8 42h25q42-26 4-47T110 0z" fill="#7bb8c9"/>`
        +line('M38 96q-15-23 17-36','#ecdfbd',5)+[ [19,58],[39,45],[132,65] ].map(([x,y])=>line(`M${x} ${y}v16`,'#627b57',3)+circle(x,y,9,'#3c7d61')).join(''),
      risk:()=>`<path d="M0 34q38 0 63 24t97-14v52H0z" fill="#b5c9a7"/><path d="M0 76q43-30 82-17t78-16v53H0z" fill="#84b8c5"/>`
        +rect(23,33,24,24,'#f1eddc')+`<path d="m18 34 17-14 17 14z" fill="#66846c"/>`+rect(93,54,25,24,'#d9e4db')
        +`<path d="m89 54 16-13 17 13z" fill="#748e95"/>`+line('M66 75q12-8 24 0t24 0 24 0','#e8f5f4',3)
        +line('M138 21v39m-6-8 6 8 6-8',blue,3)+line('M74 52h78',blue,2),
      route:()=>neutral+line('M25 74h28V24h76',blue,5)+line('m88 18 8 6-8 6',blue,3)
        +circle(25,74,12,green)+label(25,79,'A','#fff',13)+circle(130,24,12,gold)+label(130,29,'B','#fff',13),
      area:()=>neutral+rect(31,20,96,61,'#5f9e8850')+`<path d="M31 20h96v61H31z" fill="none" stroke="${green}" stroke-width="2.5" stroke-dasharray="5 3"/>`
        +[[27,16],[123,16],[27,77],[123,77]].map(([x,y])=>rect(x,y,8,8,green)).join('')
        +rect(61,27,15,14,'#4a8d71')+rect(85,27,15,14,'#4a8d71')+rect(61,59,39,14,'#4a8d71'),
      isochrone:()=>neutral+`<path d="M14 44 31 16h66l40 30-15 38H33z" fill="#bdd6bb" stroke="#7ca68b" stroke-width="2"/><path d="m36 42 13-12h44l23 21-13 20H48z" fill="#88b79d"/><path d="m54 44 20-6 21 13-10 11H61z" fill="#468e71"/>`
        +line('M33 48h60M71 30v37','#eff8ed',3)+circle(71,48,5,ink)+clock(130,71,16),
      history:()=>rect(17,13,128,70,'#fffdf7',5)+rect(17,13,128,16,'#96afa6',5)+line('M38 8v15M123 8v15',ink,4)
        +line('M31 69h99M31 40h99M31 55h99','#e0e7dd',1.5)+line('m31 65 18-7 19 4 22-21 19 5 20-13',green,3)
        +[ [31,65],[68,62],[109,46],[129,33] ].map(([x,y])=>circle(x,y,3,green)).join(''),
      export:()=>rect(23,10,89,76,'#fffdf7',5)+rect(23,10,89,17,green,5)+label(67,23,'CSV','#fff',12)
        +line('M34 38h67M34 51h67M34 64h52M34 76h52M52 32v45M77 32v45','#a0b8a8',2)
        +line('M125 43v30m-10-10 10 10 10-10M110 79v6h30v-6',blue,4),
      summary:()=>paper+rect(45,33,23,15,'#d8e6d8')+rect(74,33,37,15,'#eaddbd')
        +circle(57,65,12,blue)+`<path d="M57 65V53a12 12 0 0 1 12 12z" fill="${gold}"/>`+line('M78 57h30m-30 9h30m-30 9h20','#8da69d',3),
      compare:()=>rect(9,16,60,65,'#fffdf7',4)+rect(91,16,60,65,'#fffdf7',4)
        +label(39,32,'A',blue)+label(121,32,'B',gold)+rect(20,56,12,15,'#8bb8c6')+rect(39,44,12,27,blue)
        +rect(102,45,12,26,'#dec695')+rect(121,37,12,34,gold)+line('M65 48h30m-7-6 7 6-7 6M95 61H65m7-6-7 6 7 6',ink,2.5),
      baseline:()=>paper+line('M46 59h67',gold,3)+line('m47 70 15-6 16 3 16-20 18-8',green,3)
        +line('M63 31v44','#8ca39b',2)+circle(63,59,5,gold)+`<path d="M63 31h25l-7 7 7 7H63z" fill="${gold}"/>`,
      branch:()=>line('M36 49h35V25h39M71 49v24h39',green,4)
        +rect(12,32,30,34,'#d7dfd0',4)+rect(18,39,8,19,'#759a85')+rect(29,45,7,13,'#a1b8a3')
        +rect(111,8,35,32,'#d4e3df',4)+rect(117,15,9,19,blue)+rect(130,23,10,11,'#8fb7bd')
        +rect(111,57,35,32,'#e8dfc7',4)+rect(117,72,10,11,'#c8b27b')+rect(131,64,9,19,gold)+circle(71,49,5,green)
    };
    return `<svg viewBox="0 0 160 96" aria-hidden="true" focusable="false">${base}${art[kind]()}</svg>`;
  }
  function create({button,dock,onOpen}){
    const menu=document.createElement('section');menu.id='workspace-observe-menu';menu.className='build-menu observe-menu';menu.hidden=true;menu.setAttribute('aria-label','观察菜单');
    menu.innerHTML=`<header class="build-menu-header"><div class="build-tabs" role="tablist" aria-label="观察类型">${[['layers','图层'],['queries','查询'],['reports','数据']].map(([key,label],i)=>`<button id="observe-tab-${key}" role="tab" aria-selected="${i===0}" aria-controls="observe-${key}" tabindex="${i===0?0:-1}">${label}</button>`).join('')}</div><span class="build-menu-caption" id="observe-caption">选择专题图层</span><button id="observe-advanced-toggle" class="city-btn observe-advanced-toggle" aria-haspopup="dialog" aria-controls="observe-advanced-panel" aria-expanded="false">高级 <span aria-hidden="true">⌄</span></button><div class="build-card-paging"><button aria-label="向前浏览观察卡片">‹</button><button aria-label="向后浏览观察卡片">›</button></div><button class="build-menu-close icon-btn" aria-label="收起观察菜单"><svg><use href="#ui-close"/></svg></button></header><section id="observe-layers" role="tabpanel" aria-labelledby="observe-tab-layers"><div class="observe-filters" role="group" aria-label="图层分类">${[['city','城市'],['economy','经济'],['traffic','交通'],['nature','环境']].map(([key,label])=>`<button data-observe-group="${key}" aria-pressed="${key==='city'}">${label}</button>`).join('')}</div><div class="build-cards"></div><div class="observe-display-settings"></div></section><section id="observe-queries" role="tabpanel" aria-labelledby="observe-tab-queries" hidden><div class="build-cards"></div><div class="observe-query-settings"></div><div class="observe-query-actions"></div></section><section id="observe-reports" role="tabpanel" aria-labelledby="observe-tab-reports" hidden><div class="build-cards"></div></section>`;
    const advanced=document.createElement('section');advanced.id='observe-advanced-panel';advanced.className='build-menu build-advanced observe-advanced';advanced.hidden=true;advanced.setAttribute('role','dialog');advanced.setAttribute('aria-label','观察高级设置');
    advanced.innerHTML='<header class="build-advanced-header"><strong>观察设置</strong><button class="icon-btn" aria-label="收起观察高级菜单"><svg><use href="#ui-close"/></svg></button></header><div class="build-tabs" role="tablist" aria-label="高级设置分类"><button id="observe-advanced-scenario" role="tab" aria-selected="true" aria-controls="observe-scenario">情景</button><button id="observe-advanced-calibration" role="tab" aria-selected="false" aria-controls="observe-calibration" tabindex="-1">校准</button></div><section id="observe-scenario" role="tabpanel" aria-labelledby="observe-advanced-scenario"></section><section id="observe-calibration" role="tabpanel" aria-labelledby="observe-advanced-calibration" hidden></section>';
    document.querySelector('.app-layout').append(menu,advanced);button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','false');
    const source=$('city-data-panel'),layerControl=$('city-layer'),cards=new Map(),queryCards=new Map();
    let opened=false,tab='layers',group='city',lastLayer=layerControl.value,lastQuery='area',previousRail=null;
    layerControl.closest('label').hidden=true;$('observe-layers').append(layerControl.closest('label'));
    function decorate(node,kind,label,note){node.classList.remove('city-btn','primary');node.classList.add('build-card');node.innerHTML=`<span class="build-thumbnail">${thumbnail(kind)}</span><span class="build-card-label">${label}</span><span class="build-card-note">${note}</span>`;return node;}
    for(const [kind,label,note] of layers){
      const node=decorate(document.createElement('button'),kind,label,note);node.dataset.observeLayer=kind;
      node.onclick=()=>{layerControl.value=kind;layerControl.dispatchEvent(new Event('change'));};
      $('observe-layers').querySelector('.build-cards').append(node);cards.set(kind,node);
    }
    const display=menu.querySelector('.observe-display-settings');
    display.append($('city-traffic-controls'));
    display.append($('city-render-quality').closest('label'));
    const clock=document.createElement('div');clock.className='observe-lighting';clock.append(source.querySelector('label[for="city-time-of-day"]'),$('city-time-of-day'));display.append(clock);
    display.append($('city-render-labels').closest('label'));
    for(const [kind,label,note] of queries){
      const node=document.querySelector(`[data-tool="${kind}"]`),choose=node.onclick;
      decorate(node,kind,label,note);node.dataset.observeQuery=kind;node.onclick=()=>{if(CityApp.working)return;lastQuery=kind;choose();sync();};
      $('observe-queries').querySelector('.build-cards').append(node);queryCards.set(kind,node);
    }
    const querySettings=menu.querySelector('.observe-query-settings');querySettings.append($('city-access-budget').closest('label'),$('city-access-mode').closest('label'));
    menu.querySelector('.observe-query-actions').append($('city-query-clear'));
    for(const [id,label,note,kind] of reports){const node=decorate($(id),kind,label,note);node.dataset.observeReport=kind;$('observe-reports').querySelector('.build-cards').append(node);}
    $('observe-scenario').append($('city-migration').closest('.city-fields'),$('city-settings'));
    const calibration=$('city-calibration').closest('details');
    for(const node of [...calibration.children])if(node.tagName!=='SUMMARY')$('observe-calibration').append(node);
    source.replaceChildren();
    const paging=menu.querySelector('.build-card-paging'),pageButtons=[...paging.children];
    const currentRow=()=>$('observe-'+tab).querySelector('.build-cards');
    function syncPaging(){const row=currentRow();paging.hidden=row.scrollWidth<=row.clientWidth+1;pageButtons[0].disabled=row.scrollLeft<1;pageButtons[1].disabled=row.scrollLeft+row.clientWidth>=row.scrollWidth-1;}
    pageButtons.forEach((node,i)=>node.onclick=()=>currentRow().scrollBy({left:(i?1:-1)*currentRow().clientWidth*.7,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}));
    menu.querySelectorAll('.build-cards').forEach(row=>row.addEventListener('scroll',syncPaging,{passive:true}));
    function filter(next){group=next;for(const [kind,,,category] of layers)cards.get(kind).hidden=category!==group;menu.querySelectorAll('[data-observe-group]').forEach(node=>{const active=node.dataset.observeGroup===group;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));});syncPaging();}
    menu.querySelectorAll('[data-observe-group]').forEach(node=>node.onclick=()=>{filter(node.dataset.observeGroup);currentRow().scrollLeft=0;});
    function sync(){
      const selected=layerControl.value;
      if(lastLayer!==selected){lastLayer=selected;filter(layers.find(item=>item[0]===selected)?.[3]||'city');}
      for(const [kind,node] of cards){const active=kind===selected;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));}
      for(const [kind,node] of queryCards){const active=CityApp.tool===kind;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));}
      querySettings.hidden=CityApp.tool!=='isochrone';
      $('observe-caption').textContent=tab==='layers'?'选择专题图层':tab==='queries'?'选择工具，在地图上查询':'城市历史、导出与方案对照';
      button.classList.toggle('active',opened);
      if(opened)document.querySelectorAll('.workspace-rail [data-category]').forEach(node=>{const active=node.dataset.category==='data';node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));});
      position();
    }
    function showTab(next){
      tab=next;toggleAdvanced(false);
      for(const key of ['layers','queries','reports']){const active=tab===key,node=$('observe-tab-'+key);node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;$('observe-'+key).hidden=!active;}
      if(tab==='queries'){if(!queryCards.has(CityApp.tool))queryCards.get(lastQuery).click();}
      else if(!['select','pan'].includes(CityApp.tool))document.querySelector('.workspace-dock [data-tool="select"]').onclick();
      sync();
    }
    function position(){
      if(!opened)return;
      const rect=dock.getBoundingClientRect(),margin=12,width=Math.min(950,innerWidth-margin*2);
      menu.style.width=width+'px';menu.style.left=Math.max(margin,Math.min(innerWidth-width-margin,rect.x+rect.width/2-width/2))+'px';menu.style.bottom=(innerHeight-rect.top+16)+'px';
      menu.style.maxHeight=Math.max(150,rect.top-document.querySelector('.city-kpis').getBoundingClientRect().bottom-28)+'px';
      const card=tab==='layers'?cards.get(layerControl.value):null;
      if(card&&!card.hidden){
        const row=currentRow(),bounds=row.getBoundingClientRect(),item=card.getBoundingClientRect();
        if(item.left<bounds.left)row.scrollLeft-=bounds.left-item.left;
        else if(item.right>bounds.right)row.scrollLeft+=item.right-bounds.right;
      }
      syncPaging();positionAdvanced();
    }
    function positionAdvanced(){
      if(advanced.hidden)return;
      const anchor=$('observe-advanced-toggle').getBoundingClientRect(),margin=12,gap=8,width=Math.min(360,innerWidth-margin*2);
      advanced.style.width=width+'px';advanced.style.maxHeight=(innerHeight-margin*2)+'px';
      const height=advanced.offsetHeight,above=anchor.top-gap-margin,below=innerHeight-anchor.bottom-gap-margin,downward=below>=height||below>=above;
      advanced.style.maxHeight=Math.max(60,downward?below:above)+'px';advanced.style.left=Math.max(margin,Math.min(innerWidth-width-margin,anchor.right-width))+'px';advanced.style.top=(downward?anchor.bottom+gap:Math.max(margin,anchor.top-gap-advanced.offsetHeight))+'px';
    }
    function toggleAdvanced(expanded,{focus=false}={}){advanced.hidden=!expanded;$('observe-advanced-toggle').setAttribute('aria-expanded',String(expanded));if(expanded){positionAdvanced();advanced.querySelector('[aria-selected="true"]').focus({preventScroll:true});}else if(focus)$('observe-advanced-toggle').focus({preventScroll:true});}
    function open(){
      if(!CityApp.active)return;
      if(!opened)previousRail=document.querySelector('.workspace-rail [data-category].active')?.dataset.category;
      onOpen();
      // Enter observation without firing the dock dismissal handlers.
      if(tab!=='queries'&&!['select','pan'].includes(CityApp.tool))document.querySelector('.workspace-dock [data-tool="select"]').onclick();
      opened=true;menu.hidden=false;document.body.classList.add('observe-menu-open');document.body.classList.remove('show-inspector');button.setAttribute('aria-expanded','true');
      filter(layers.find(item=>item[0]===layerControl.value)?.[3]||'city');showTab(tab);
    }
    function close({focus=false}={}){toggleAdvanced(false);opened=false;menu.hidden=true;document.body.classList.remove('observe-menu-open');button.classList.remove('active');button.setAttribute('aria-expanded','false');if(previousRail)document.querySelectorAll('.workspace-rail [data-category]').forEach(node=>{const active=node.dataset.category===previousRail;node.classList.toggle('active',active);node.setAttribute('aria-pressed',String(active));});previousRail=null;if(focus)button.focus();}
    function wireTabs(keys,prefix,choose){for(const key of keys){const node=$(prefix+key);node.onclick=()=>choose(key);node.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?keys[0]:event.key==='End'?keys.at(-1):keys[(keys.indexOf(key)+(event.key==='ArrowRight'?1:keys.length-1))%keys.length];choose(next);$(prefix+next).focus();}});}}
    wireTabs(['layers','queries','reports'],'observe-tab-',showTab);
    wireTabs(['scenario','calibration'],'observe-advanced-',key=>{for(const name of ['scenario','calibration']){const node=$('observe-advanced-'+name),active=name===key;node.setAttribute('aria-selected',String(active));node.tabIndex=active?0:-1;$('observe-'+name).hidden=!active;}positionAdvanced();});
    $('observe-advanced-toggle').onclick=()=>toggleAdvanced(advanced.hidden);advanced.querySelector('.icon-btn').onclick=()=>toggleAdvanced(false,{focus:true});menu.querySelector('.build-menu-close').onclick=()=>close({focus:true});
    dock.addEventListener('click',event=>{const target=event.target.closest('button');if(target&&target!==button)close();});
    document.addEventListener('pointerdown',event=>{if(!advanced.hidden&&!advanced.contains(event.target)&&!$('observe-advanced-toggle').contains(event.target))toggleAdvanced(false);},true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!advanced.hidden){event.preventDefault();event.stopImmediatePropagation();toggleAdvanced(false,{focus:true});}},true);
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&opened&&!document.querySelector('dialog[open]'))close({focus:true});});
    [menu,advanced].forEach(node=>node.addEventListener('pointerdown',event=>event.stopPropagation()));menu.addEventListener('scroll',positionAdvanced,{passive:true});
    layerControl.addEventListener('change',sync);window.addEventListener('city-tool-change',sync);window.addEventListener('city-renewal-change',sync);window.addEventListener('resize',position);new ResizeObserver(position).observe(dock);
    filter(group);sync();return {open,close,toggle:()=>opened?close():open()};
  }
  window.CityObserveMenu={create};
})();
