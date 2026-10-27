/* Baidu Tieba iOS: only captured, explicitly identified ad fields. */
(function () {
  var result = {};
  try {
    var match = /^https:\/\/tiebac\.baidu\.com(\/c\/[^?#]*)(?:[?#]|$)/.exec($request.url);
    if (!match || Number($response.status) !== 200) return $done({});
    var path = match[1];
    if (path !== '/c/f/ad/getSplashAd' && path !== '/c/s/sync') return $done({});
    var data = JSON.parse($response.body);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Number(data.error_code) !== 0) return $done({});
    var changed = false;
    function zero(object, key) {
      if (object && Object.prototype.hasOwnProperty.call(object, key) &&
          (typeof object[key] === 'string' || typeof object[key] === 'number')) {
        var value = typeof object[key] === 'string' ? '0' : 0;
        if (object[key] !== value) { object[key] = value; changed = true; }
      }
    }
    if (path === '/c/f/ad/getSplashAd') {
      if (Array.isArray(data.data) && data.data.length) { data.data = []; changed = true; }
    } else {
      zero(data, 'ad_origin_config_switch');
      [
        'screen_fill_advertisement_first_switch',
        'screen_fill_advertisement_second_switch',
        'screen_fill_advertisement_bear_switch',
        'screen_fill_advertisement_plj_cpc_switch',
        'screen_fill_advertisement_plj_switch'
      ].forEach(function (key) { zero(data.screen_fill_data_result, key); });
      zero(data.cloud_control_data_info && data.cloud_control_data_info.common_config, 'external_splash_switch');
    }
    if (changed) result = { body: JSON.stringify(data) };
  } catch (_) {
    // Fail open. Do not log response bodies, URLs or account information.
    console.log('[Tieba Ads] JSON structure unsupported; original response retained');
  }
  $done(result);
})();
