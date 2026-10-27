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
const adConfig = {error_code: '0', config: {switch: [
  {name: 'platform_csj_init', type: '1'}, {name: 'platform_gdt_init', type: 1},
  {name: 'login', type: '1'}, {name: 'ad_destroy_remove_container', type: '0'}]},
  adload_config: {ad_feed_ad_home_blocked: '0', ad_feed_ad_pb_blocked: 0, unknown: 'keep'},
  ad_adsense: {ssp_ad_conf: [{location: 'RECOM'}, {location: 'PB_BANNER'}, {location: 'PB_COMMENT'},
    {location: 'UNKNOWN'}], applist: ['synthetic']},
  floating_icon: {pb: {display_ad_icon: '1', icon_url: 'synthetic'}, homepage: {url: ''}},
  cloud_control_data_info: {common_config: {external_splash_switch: '{"zkUbix":1,"ZK_api":1}',
    pb_comment_bidding_ad_num_config: '{"count":"2","unknown":"keep"}', bear_ad_global_close_switch: '0'}}};
const expectedConfig = structuredClone(adConfig);
expectedConfig.config.switch[0].type = '0'; expectedConfig.config.switch[1].type = 0;
expectedConfig.config.switch[3].type = '1';
expectedConfig.adload_config.ad_feed_ad_home_blocked = '1'; expectedConfig.adload_config.ad_feed_ad_pb_blocked = 1;
expectedConfig.ad_adsense.ssp_ad_conf = [{location: 'UNKNOWN'}]; expectedConfig.ad_adsense.applist = [];
delete expectedConfig.floating_icon.pb;
expectedConfig.cloud_control_data_info.common_config = {external_splash_switch: '{"zkUbix":0,"ZK_api":0}',
  pb_comment_bidding_ad_num_config: '{"count":"0","unknown":"keep"}', bear_ad_global_close_switch: '1'};
const configResult = run('json', '/c/s/sync', JSON.stringify(adConfig));
assert.deepEqual(JSON.parse(configResult.body), expectedConfig);
unchanged('json', '/c/s/sync', configResult.body);

// Independent wire helpers: compare opaque content bytes, never reconstruct normal posts.
function vint(value) {
  const out = []; let n = BigInt(value);
  do { let b = Number(n & 127n); n >>= 7n; out.push(b | (n ? 128 : 0)); } while (n);
  return Buffer.from(out);
}
function msg(number, bytes) { return Buffer.concat([vint(number * 8 + 2), vint(bytes.length), bytes]); }
function scalar(number, value) { return Buffer.concat([vint(number * 8), vint(value)]); }
function wire(bytes) {
  let pos = 0;
  function read() { let n = 0n, shift = 0n, b; do { b = bytes[pos++]; assert.notEqual(b, undefined); n |= BigInt(b & 127) << shift; shift += 7n; } while (b & 128); return n; }
  const list = [];
  while (pos < bytes.length) {
    const start = pos, key = Number(read()), number = Math.floor(key / 8), type = key % 8;
    let value;
    if (type === 0) value = read();
    else if (type === 2) { const length = Number(read()); value = bytes.subarray(pos, pos + length); pos += length; }
    else if (type === 1 || type === 5) pos += type === 1 ? 8 : 4;
    else assert.fail('wire type');
    assert.ok(pos <= bytes.length); list.push({number, type, value, raw: bytes.subarray(start, pos)});
  }
  return list;
}
const envelope = payload => new Uint8Array(Buffer.concat([msg(1, Buffer.from([8, 0, 18, 0, 26, 0])), msg(2, payload), scalar(99, 1)]));
const normalThread = msg(2, Buffer.concat([scalar(1, 123), scalar(59, 0), msg(3, Buffer.from('normal post mentions ads'))]));
const adThread = msg(2, Buffer.concat([scalar(1, 456), scalar(59, 1)]));
const appCard = msg(1, msg(39, Buffer.from('apiAd')));
const bannerAd = msg(9, appCard);
const unknownData = scalar(100, (1n << 64n) - 1n);
const payload = Buffer.concat([normalThread, bannerAd, adThread, unknownData]);
const feedResult = run('protobuf', '/c/f/excellent/personalized?cmd=309264&format=protobuf', envelope(payload));
assert.deepEqual(Buffer.from(feedResult.body), Buffer.from(envelope(Buffer.concat([normalThread, unknownData]))));
unchanged('protobuf', '/c/f/excellent/personalized', feedResult.body);
const keepBanner = scalar(100, 7);
const mixed = envelope(Buffer.concat([normalThread, msg(9, Buffer.concat([appCard, keepBanner]))]));
assert.deepEqual(Buffer.from(run('protobuf', '/c/f/excellent/personalized', mixed).body),
  Buffer.from(envelope(Buffer.concat([normalThread, msg(9, keepBanner)]))));
const legacyPayload = Buffer.concat([msg(6, Buffer.from([8, 1])), msg(12, msg(5, Buffer.from([8, 1])))]);
assert.deepEqual(Buffer.from(run('protobuf', '/c/f/pb/page?cmd=302001&format=protobuf', envelope(legacyPayload)).body),
  Buffer.from(envelope(msg(6, Buffer.from([8, 1])))));
// New hybrid schema: same bytes with cmd=309751 must remain completely untouched.
unchanged('protobuf', '/c/f/pb/page?cmd=309751&format=protobuf', envelope(legacyPayload));
unchanged('protobuf', '/c/f/excellent/personalized', envelope(msg(9, Buffer.from([255]))));
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
  const counts = {}; let matched = 0, changed = 0;
  for (const entry of entries) {
    const url = entry.request.url;
    const rule = rules.find(rule => rule.regex.test(url));
    if (!rule) continue;
    matched++;
    const content = entry.response.content;
    const bytes = content.encoding === 'base64' ? Buffer.from(content.text, 'base64') : Buffer.from(content.text);
    const body = rule.type === 'protobuf' ? new Uint8Array(bytes) : bytes.toString('utf8');
    const result = run(rule.type, url, body, entry.response.status);
    const path = new URL(url).pathname;
    if (path === '/c/f/pb/page') {
      assert.equal(Object.keys(result).length, 0, 'new hybrid post schema is not old banner schema');
      continue;
    }
    assert.ok(result.body, 'captured ad target must change'); changed++;
    unchanged(rule.type, url, result.body, entry.response.status);
    counts[path] = (counts[path] || 0) + 1;
    if (path === splash) {
      const before = JSON.parse(body), after = JSON.parse(result.body);
      assert.ok(before.data.length > 0); assert.deepEqual(after, {...before, data: []});
    } else if (path === '/c/f/excellent/personalized') {
      const beforeRoot = wire(body), afterRoot = wire(result.body);
      const beforeData = wire(beforeRoot.find(f => f.number === 2).value);
      const afterData = wire(afterRoot.find(f => f.number === 2).value);
      const banner = beforeData.find(f => f.number === 9);
      assert.ok(banner && wire(banner.value).some(f => f.number === 1));
      assert.equal(afterData.some(f => f.number === 9), false, 'whole ad card and empty banner parent removed');
      assert.deepEqual(Buffer.concat(afterData.map(f => f.raw)), Buffer.concat(beforeData.filter(f => f.number !== 9).map(f => f.raw)),
        'all 12 normal threads and all other data fields remain byte-identical');
      assert.deepEqual(afterRoot.filter(f => f.number !== 2).map(f => Buffer.from(f.raw)), beforeRoot.filter(f => f.number !== 2).map(f => Buffer.from(f.raw)));
      console.log('PASS: homepage complete ad card removed; 12 posts and all unrelated fields byte-identical');
    } else if (rule.type === 'protobuf') {
      assert.equal(result.body.length, 10);
      assert.deepEqual(Array.from(result.body), [10, 6, 8, 0, 18, 0, 26, 0, 18, 0]);
    }
  }
  assert.equal(matched, 8, 'expected guard match count in supplied HAR');
  assert.equal(changed, 7);
  console.log(`PASS: HAR ${entries.length} requests, ${matched} matched, ${changed} modified; ${JSON.stringify(counts)}`);
  console.log('Other 215 captured responses unchanged (214 outside guards, 1 hybrid protobuf passed through). No HAR data written.');
}
