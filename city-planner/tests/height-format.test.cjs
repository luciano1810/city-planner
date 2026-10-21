const {test} = require('node:test');
const assert = require('node:assert/strict');
const {decode} = require('../renderer/height-format.js');
const fixture = require('./fixtures/metric-heights.json');

test('renderer reads signed metre heights and high peaks without normalising them', () => {
  const result = decode(fixture.data);
  assert.deepEqual([...result.elevation],fixture.elevation);
  assert.deepEqual([...result.water],fixture.water.map(v => v === null ? -Infinity : v));
  assert.equal(result.sea,-10);
  assert.equal(result.elevation[5]-result.sea,15010.75);
  assert.equal(result.water[1],0); // A real zero-metre water surface, not dry land.
});

test('unsupported formats and malformed height buffers fail explicitly', () => {
  assert.throws(() => decode({...fixture.data,heightEncoding:undefined}),/重新生成/);
  assert.throws(() => decode({...fixture.data,elevation:'AAAA'}),/尺寸/);
  for (const value of [NaN,Infinity,-Infinity]) {
    const bytes = Buffer.from(fixture.data.elevation,'base64');
    bytes.writeFloatLE(value,0);
    assert.throws(() => decode({...fixture.data,elevation:bytes.toString('base64')}),/无效/);
  }
});
