import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const sources = Object.fromEntries(['json', 'protobuf'].map(type => [type,
  fs.readFileSync(`${root}scripts/tieba-${type}.js`, 'utf8')]));
function run(type, path, body, status = 200) {
  let result, calls = 0;
  vm.runInNewContext(sources[type], {
    $request: {url: path.startsWith('https://') ? path : `https://tiebac.baidu.com${path}`},
    $response: {body, status}, Uint8Array, console: {log() {}},
    $done(value) { result = value; calls++; }
  }, {timeout: 1000});
  assert.equal(calls, 1, 'exactly one $done');
  return result;
}
function unchanged(type, path, body, status) {
  assert.equal(Object.keys(run(type, path, body, status)).length, 0);
}
const splash = '/c/f/ad/getSplashAd';
const feed = '/c/f/ad/getFeedAd';
const bid = '/c/b/ad/adBid';
const success = new Uint8Array([10, 6, 8, 0, 18, 0, 26, 0, 18, 2, 8, 1, 24, 9]);
const empty = new Uint8Array([10, 6, 8, 0, 18, 0, 26, 0, 18, 0, 24, 9]);
for (const path of [feed, bid]) {
  assert.deepEqual(run('protobuf', path, success).body, empty);
  unchanged('protobuf', path, empty);
  const error = success.slice(); error[3] = 1;
  unchanged('protobuf', path, error);
  unchanged('protobuf', path, success, 500);
  for (let size = 0; size < success.length; size++) {
    const bytes = success.slice(0, size);
    const result = run('protobuf', path, bytes);
    // Prefix ending at byte 12 is itself a valid complete protobuf message.
    if (size !== 12) assert.equal(Object.keys(result).length, 0);
  }
  unchanged('protobuf', path, '{"data":[]}');
  unchanged('protobuf', path, new Uint8Array([10, 6, 8, 0, 18, 0, 26, 0, 18, 1, 255]));
}
const json = {error_code: 0, data: [{ad_id: 'synthetic'}], time: 123, unknown: {keep: true}};
const clean = JSON.parse(run('json', splash, JSON.stringify(json)).body);
assert.deepEqual(clean, {...json, data: []});
unchanged('json', splash, JSON.stringify(clean));
unchanged('json', splash, '{');
unchanged('json', splash, JSON.stringify({...json, error_code: 1}));
unchanged('json', splash, JSON.stringify(json), 403);
const config = {error_code: '0', client: {keep: true},
  screen_fill_data_result: {screen_fill_advertisement_first_switch: '1000',
    screen_fill_ad_bear_hot_exposure_interval: '300'},
  cloud_control_data_info: {common_config: {external_splash_switch: 1, login: 1}}};
const configured = JSON.parse(run('json', '/c/s/sync', JSON.stringify(config)).body);
assert.equal(configured.screen_fill_data_result.screen_fill_advertisement_first_switch, '0');
assert.equal(configured.screen_fill_data_result.screen_fill_ad_bear_hot_exposure_interval, '300');
assert.equal(configured.cloud_control_data_info.common_config.external_splash_switch, 0);
assert.deepEqual(configured.client, config.client);
assert.equal(configured.cloud_control_data_info.common_config.login, 1);
for (const path of ['/c/f/pb/page', '/c/f/pb/firstPage', '/c/f/excellent/personalized',
  '/c/s/login', '/c/u/user/profile', '/c/f/ad/getFeedAdExtra', '/c/f/ad/getFeedAd/child',
  'https://example.com/c/f/ad/getFeedAd', 'https://tiebac.baidu.com.evil.test/c/f/ad/getFeedAd']) {
  unchanged('protobuf', path, success);
  unchanged('json', path, JSON.stringify(json));
}
// Exercise the exact URL guards copied from the shipped plugin.
const plugin = fs.readFileSync(`${root}TiebaAds.plugin`, 'utf8');
const rules = plugin.split('\n').filter(line => line.startsWith('response if')).map(line => {
  const pattern = line.match(/~= (\/.*\/) then/)[1];
  return {regex: vm.runInNewContext(pattern), type: line.includes('tieba-json.js') ? 'json' : 'protobuf'};
});
assert.equal(rules.length, 2);
for (const [path, expected] of [[splash, 'json'], [feed, 'protobuf'], [bid, 'protobuf'], ['/c/s/sync', 'json']]) {
  for (const suffix of ['', '?x=1', '#fragment']) {
    assert.equal(rules.find(rule => rule.regex.test(`https://tiebac.baidu.com${path}${suffix}`))?.type, expected);
  }
}
console.log('PASS: synthetic tests, binary preservation, malformed input, URL scope and idempotency');
if (process.argv[2]) {
  const entries = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')).log.entries;
  const counts = {}; let matched = 0;
  for (const entry of entries) {
    const url = entry.request.url;
    const rule = rules.find(rule => rule.regex.test(url));
    if (!rule) continue;
    matched++;
    const content = entry.response.content;
    const bytes = content.encoding === 'base64' ? Buffer.from(content.text, 'base64') : Buffer.from(content.text);
    const body = rule.type === 'protobuf' ? new Uint8Array(bytes) : bytes.toString('utf8');
    const result = run(rule.type, url, body, entry.response.status);
    assert.ok(result.body, 'captured target must change');
    unchanged(rule.type, url, result.body, entry.response.status);
    const path = new URL(url).pathname;
    counts[path] = (counts[path] || 0) + 1;
    if (path === splash) {
      const before = JSON.parse(body), after = JSON.parse(result.body);
      assert.ok(before.data.length > 0); assert.deepEqual(after, {...before, data: []});
    } else if (rule.type === 'protobuf') {
      assert.equal(result.body.length, 10);
      assert.deepEqual(Array.from(result.body), [10, 6, 8, 0, 18, 0, 26, 0, 18, 0]);
    }
  }
  assert.equal(matched, 6, 'expected target count in supplied HAR');
  console.log(`PASS: HAR ${entries.length} requests, ${matched} targeted responses; ${JSON.stringify(counts)}`);
  console.log('Other 216 captured requests do not match plugin script guards. No HAR data written.');
}
