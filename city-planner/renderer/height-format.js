/* Decode storage at the boundary; renderer heights and water surfaces are metres. */
(function (root) {
  'use strict';
  function decode(data) {
    if (data.heightEncoding !== 'float32-le-meters') throw new Error('不支持的高度格式，请重新生成米制地图');
    const count = data.width * data.height;
    const sea = data.grid.seaLevelMeters;
    if (!Number.isFinite(sea)) throw new Error('无效的海平面高度');
    function read(encoded, water) {
      const binary = atob(encoded);
      if (binary.length !== count * 4) throw new Error('高度数据尺寸不匹配');
      const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      const field = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        const value = view.getFloat32(i*4,true);
        if (!Number.isFinite(value) && !(water && value === -Infinity)) throw new Error('无效的地形高度');
        field[i] = value;
      }
      return field;
    }
    return { elevation:read(data.elevation,false), water:read(data.water,true), sea, tolerance:.001 };
  }
  const api = { decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TerrainHeights = api;
})(typeof window === 'undefined' ? {} : window);
