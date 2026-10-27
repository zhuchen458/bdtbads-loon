/* Preserve unknown protobuf bytes. Remove complete known ad containers, not media. */
(function () {
  var result = {};
  try {
    var match = /^https:\/\/tiebac\.baidu\.com(\/c\/(?:f\/ad\/getFeedAd|b\/ad\/adBid|f\/excellent\/personalized|f\/pb\/page))(?:[?#]|$)/.exec($request.url);
    if (!match || Number($response.status) !== 200) return $done({});
    var path = match[1];
    // 309751 is a different hybrid schema: field 9 is the comment sort menu, NOT ads.
    if (path === '/c/f/pb/page' && !/[?&]cmd=302001(?:&|#|$)/.test($request.url)) return $done({});
    var body = $response.body;
    if (!(body instanceof Uint8Array) || !body.length) return $done({});
    function varint(bytes, cursor) {
      var value = 0, factor = 1;
      for (var i = 0; i < 10; i++) {
        if (cursor.pos >= bytes.length) throw new Error('truncated');
        var byte = bytes[cursor.pos++];
        value += (byte & 127) * factor;
        if (byte < 128) {
          if (i === 9 && byte > 1) throw new Error('invalid uint64');
          return Number.isSafeInteger(value) ? value : null;
        }
        factor *= 128;
      }
      throw new Error('invalid varint');
    }
    function fields(bytes) {
      var cursor = {pos: 0}, list = [];
      while (cursor.pos < bytes.length) {
        var start = cursor.pos, key = varint(bytes, cursor);
        if (key === null) throw new Error('invalid key');
        var number = Math.floor(key / 8), wire = key % 8, value;
        if (number < 1 || number > 536870911) throw new Error('invalid field');
        if (wire === 0) value = varint(bytes, cursor);
        else if (wire === 2) {
          var length = varint(bytes, cursor), offset = cursor.pos;
          if (length === null) throw new Error('invalid length');
          cursor.pos += length;
          if (cursor.pos > bytes.length) throw new Error('invalid length');
          value = bytes.subarray(offset, cursor.pos);
        } else if (wire === 1 || wire === 5) cursor.pos += wire === 1 ? 8 : 4;
        else throw new Error('unsupported wire type');
        if (cursor.pos > bytes.length) throw new Error('truncated fixed field');
        list.push({number: number, wire: wire, value: value, raw: bytes.subarray(start, cursor.pos)});
      }
      return list;
    }
    var root = fields(body);
    var headers = root.filter(function (f) { return f.number === 1; });
    var payloads = root.filter(function (f) { return f.number === 2; });
    if (headers.length !== 1 || headers[0].wire !== 2 || payloads.length !== 1 || payloads[0].wire !== 2) return $done({});
    var codes = fields(headers[0].value).filter(function (f) { return f.number === 1; });
    if (codes.length !== 1 || codes[0].wire !== 0 || codes[0].value !== 0 || !payloads[0].value.length) return $done({});
    function concat(chunks) {
      var size = chunks.reduce(function (sum, bytes) { return sum + bytes.length; }, 0);
      var output = new Uint8Array(size), offset = 0;
      chunks.forEach(function (bytes) { output.set(bytes, offset); offset += bytes.length; });
      return output;
    }
    function encodeVarint(value) {
      var output = [];
      do { var byte = value % 128; value = Math.floor(value / 128); output.push(byte | (value ? 128 : 0)); } while (value);
      return new Uint8Array(output);
    }
    function message(number, bytes) {
      return concat([encodeVarint(number * 8 + 2), encodeVarint(bytes.length), bytes]);
    }
    var payload = fields(payloads[0].value), changed = false, output;
    if (path === '/c/f/ad/getFeedAd' || path === '/c/b/ad/adBid') {
      output = new Uint8Array(0); changed = true;
    } else {
      var bannerNumber = path === '/c/f/excellent/personalized' ? 9 : 12;
      var chunks = [];
      payload.forEach(function (field) {
        if (field.number === bannerNumber && field.wire === 2) {
          // BannerList.app (1) and pb_banner_ad (5) are complete advertising cards.
          var banner = fields(field.value), keep = banner.filter(function (item) {
            return !((item.number === 1 || item.number === 5) && item.wire === 2);
          });
          if (keep.length !== banner.length) {
            changed = true;
            // Omit the parent too when empty, so no blank container remains in the data.
            if (keep.length) chunks.push(message(field.number, concat(keep.map(function (f) { return f.raw; }))));
            return;
          }
        }
        if (path === '/c/f/excellent/personalized' && field.number === 2 && field.wire === 2) {
          var thread = fields(field.value);
          if (thread.some(function (item) { return item.number === 59 && item.wire === 0 && item.value === 1; })) {
            changed = true; return;
          }
        }
        chunks.push(field.raw);
      });
      output = concat(chunks);
    }
    if (changed) {
      result = {body: concat(root.map(function (f) { return f.number === 2 ? message(2, output) : f.raw; }))};
      console.log('[Tieba Ads v0.2] removed ad data: ' + path);
    }
  } catch (_) {
    console.log('[Tieba Ads] Protobuf structure unsupported; original response retained');
  }
  $done(result);
})();
