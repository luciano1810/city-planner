/* Main menu and local display preferences; city sessions stay in CityApp. */
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  const defaults = {resolution:1024, view:'auto', contours:false, grid:false};
  let preferences = {...defaults};
  try {
    const saved = JSON.parse(localStorage.getItem('shanhai-preferences-v1'));
    if (saved) {
      if ([768,1024,1536,2048,4096].includes(saved.resolution)) preferences.resolution=saved.resolution;
      if (['auto','high','map'].includes(saved.view)) preferences.view=saved.view;
      for (const key of ['contours','grid']) if (typeof saved[key]==='boolean') preferences[key]=saved[key];
    }
  } catch { /* Use defaults if optional preferences are unavailable. */ }

  function show(screen) {
    document.body.dataset.screen=screen;
    document.body.classList.toggle('menu-mode',screen==='home');
    el('home-screen').hidden=screen!=='home';
    el('back-home').hidden=screen==='home';
    document.querySelector('.app-name').textContent={home:'城市生长工作台',terrain:'01 / 地形准备',city:'02 / 城市规划'}[screen];
    if(screen==='home')el('menu-new').focus();
    else window.MapWorkspace.fit();
  }

  document.body.insertAdjacentHTML('beforeend', `
    <dialog class="city-dialog" id="app-settings" aria-labelledby="settings-title">
      <form id="preferences-form">
        <h2 id="settings-title">设置</h2><p>用于新建地图。偏好保存在本机，已有存档的地形精度保持不变。</p>
        <div class="city-fields">
          <label>默认地图精度<select class="city-field" id="setting-resolution">
            <option value="768">标准 · 768 px</option><option value="1024">精细 · 1024 px</option>
            <option value="1536">高清 · 1536 px</option><option value="2048">超清 · 2048 px</option><option value="4096">4K · 4096 px</option>
          </select></label>
          <label>默认地图样式<select class="city-field" id="setting-view"><option value="auto">自动切换</option><option value="high">精细视图</option><option value="map">地图视图</option></select></label>
        </div>
        <label class="preference-check"><input type="checkbox" id="setting-contours">显示等高线</label>
        <label class="preference-check"><input type="checkbox" id="setting-grid">显示坐标网格</label>
        <div class="city-dialog-actions"><button class="city-btn" type="button" id="settings-cancel">取消</button><button class="city-btn primary" type="submit">保存设置</button></div>
      </form>
    </dialog>`);

  el('menu-new').onclick=()=>{
    if(window.CityApp.working)return;
    show('terrain'); window.MapWorkspace.newTerrain(preferences);
  };
  el('menu-load').onclick=()=>window.CityApp.openSaves();
  el('back-home').onclick=()=>{
    if(window.CityApp.working)return;
    if(window.CityApp.active)window.CityApp.returnHome();
    else { window.MapWorkspace.cancelGeneration(); show('home'); }
  };
  el('menu-settings').onclick=()=>{
    if(window.CityApp.working)return;
    el('setting-resolution').value=preferences.resolution;
    el('setting-view').value=preferences.view;
    el('setting-contours').checked=preferences.contours;
    el('setting-grid').checked=preferences.grid;
    el('app-settings').showModal();
  };
  el('settings-cancel').onclick=()=>el('app-settings').close();
  el('preferences-form').onsubmit=event=>{
    event.preventDefault();
    const next={resolution:Number(el('setting-resolution').value),view:el('setting-view').value,
      contours:el('setting-contours').checked,grid:el('setting-grid').checked};
    try { localStorage.setItem('shanhai-preferences-v1',JSON.stringify(next)); }
    catch { window.MapWorkspace.toast('设置无法保存，请检查本地存储权限'); return; }
    preferences=next; el('app-settings').close(); window.MapWorkspace.toast('设置已保存');
  };
  window.AppNavigation={show};
  show('home');
})();
