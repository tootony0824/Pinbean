const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const test = require('node:test');

const mapping = require('../colorSystemMapping.json');

const brands = ['MARD', 'COCO', '漫漫', '盼盼', '咪小窝'];

test('shared palette preserves the frozen 291-color mapping', () => {
  assert.equal(Object.keys(mapping).length, 291);
  assert.equal(
    createHash('sha256').update(JSON.stringify(mapping)).digest('hex'),
    'f8d829e48150c3adc5820a37253114989de4e3f1eb07c4e1811ac520abee106f',
  );
});

test('every shared palette entry has a valid uppercase Hex and all brand codes', () => {
  for (const [hex, codes] of Object.entries(mapping)) {
    assert.match(hex, /^#[0-9A-F]{6}$/);
    for (const brand of brands) {
      assert.equal(typeof codes[brand], 'string', `${hex} missing ${brand}`);
      assert.notEqual(codes[brand], '', `${hex} has empty ${brand} code`);
    }
  }
});

test('MARD identity stays one-to-one while other brand display codes may alias', () => {
  const mardCodes = Object.values(mapping).map(codes => codes.MARD);
  assert.equal(new Set(mardCodes).size, mardCodes.length);
  assert.equal(new Set(Object.values(mapping).map(codes => codes['漫漫'])).size, 290);
});

