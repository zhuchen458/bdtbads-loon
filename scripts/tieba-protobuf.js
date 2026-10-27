/* No schema guesses inside posts. Only clear data in dedicated ad endpoints. */
(function () {
  var result = {};
  try {
    if (!/^https:\/\/tiebac\.baidu\.com\/c\/(?:f\/ad\/getFeedAd|b\/ad\/adBid)(?:[?#]|$)/.test($request.url) ||
        Number($response.status) !== 200) return $done({});
    var body = $response.body;
    if (!(body instanceof Uint8Array) || !body.length) return $done({});
    function varint(bytes, cursor) {
      var value = 0, factor = 1;
      for (var i = 0; i < 10; i++) {
        if (cursor.pos >= bytes.length) throw new Error('truncated');
        var byte = bytes[cursor.pos++];
        value += (byte & 127) * factor;
        if (byte < 128) {
          if (!Number.isSafeInteger(value)) throw new Error('unsafe varint');
          return value;
        }
        factor *= 128;
      }
      throw new Error('invalid varint');
    }
    function fields(bytes) {
      var cursor = {pos: 0}, list = [];
      while (cursor.pos < bytes.length) {
        var start = cursor.pos, key = varint(bytes, cursor);
        var number = Math.floor(key / 8), wire = key % 8, value;
        if (number < 1 || number > 536870911) throw new Error('invalid field');
        if (wire === 0) value = varint(bytes, cursor);
        else if (wire === 2) {
          var length = varint(bytes, cursor), offset = cursor.pos;
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
    // Validate the captured protobuf payload before editing the envelope.
    fields(payloads[0].value);
    var chunks = root.map(function (f) {
      return f.number === 2 ? new Uint8Array([0x12, 0x00]) : f.raw;
    });
    var size = chunks.reduce(function (sum, bytes) { return sum + bytes.length; }, 0);
    var output = new Uint8Array(size), offset = 0;
    chunks.forEach(function (bytes) { output.set(bytes, offset); offset += bytes.length; });
    result = {body: output};
  } catch (_) {
    console.log('[Tieba Ads] Protobuf structure unsupported; original response retained');
  }
  $done(result);
})();
