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
    function setFlag(object, key, flag) {
      if (object && Object.prototype.hasOwnProperty.call(object, key) &&
          (typeof object[key] === 'string' || typeof object[key] === 'number')) {
        var value = typeof object[key] === 'string' ? String(flag) : flag;
        if (object[key] !== value) { object[key] = value; changed = true; }
      }
    }
    function zero(object, key) { setFlag(object, key, 0); }
    function emptyArray(object, key) {
      if (object && Array.isArray(object[key]) && object[key].length) {
        object[key] = []; changed = true;
      }
    }
    // Some config values are JSON encoded inside a JSON string. Preserve that format.
    function jsonFlags(object, key, names) {
      if (!object || typeof object[key] !== 'string') return;
      var nested;
      try { nested = JSON.parse(object[key]); } catch (_) { return; }
      if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return;
      var before = JSON.stringify(nested);
      (names || Object.keys(nested)).forEach(function (name) { zero(nested, name); });
      if (JSON.stringify(nested) !== before) object[key] = JSON.stringify(nested);
    }
    if (path === '/c/f/ad/getSplashAd') {
      if (Array.isArray(data.data) && data.data.length) { data.data = []; changed = true; }
    } else {
      zero(data, 'ad_origin_config_switch');
      zero(data, 'ad_num_competition_frs');
      zero(data, 'ad_num_competition_personalize');
      [
        'screen_fill_advertisement_first_switch',
        'screen_fill_advertisement_second_switch',
        'screen_fill_advertisement_bear_switch',
        'screen_fill_advertisement_plj_cpc_switch',
        'screen_fill_advertisement_plj_switch'
      ].forEach(function (key) { zero(data.screen_fill_data_result, key); });
      var common = data.cloud_control_data_info && data.cloud_control_data_info.common_config;
      // A scalar was used by older versions; newer versions use a JSON string map.
      if (common && /^\s*\{/.test(common.external_splash_switch || '')) jsonFlags(common, 'external_splash_switch');
      else zero(common, 'external_splash_switch');
      setFlag(common, 'bear_ad_global_close_switch', 1);
      ['home_bidding_ad_num_config', 'frs_bidding_ad_num_config',
        'pb_banner_bidding_ad_num_config', 'pb_comment_bidding_ad_num_config'].forEach(function (key) {
        jsonFlags(common, key, ['count']);
      });
      ['ad_feed_ad_home_blocked', 'ad_feed_ad_frs_blocked', 'ad_feed_ad_pb_blocked'].forEach(function (key) {
        setFlag(data.adload_config, key, 1);
      });
      var switches = data.config && data.config.switch;
      if (Array.isArray(switches)) switches.forEach(function (item) {
        if (!item || typeof item !== 'object') return;
        if (['platform_csj_init', 'platform_ks_init', 'platform_gdt_init', 'platform_baidu_bqt_init',
          'platform_jy_init', 'platform_ubix_init', 'platform_hw_init', 'ad_baichuan_open'].indexOf(item.name) !== -1) zero(item, 'type');
        // Keep the client's existing cleanup behavior enabled after an ad is destroyed.
        if (item.name === 'ad_destroy_remove_container') setFlag(item, 'type', 1);
      });
      var adsense = data.ad_adsense;
      if (adsense && Array.isArray(adsense.ssp_ad_conf)) {
        var filtered = adsense.ssp_ad_conf.filter(function (slot) {
          return !slot || ['RECOM', 'FRS', 'PB_BANNER', 'PB_COMMENT'].indexOf(slot.location) === -1;
        });
        if (filtered.length !== adsense.ssp_ad_conf.length) { adsense.ssp_ad_conf = filtered; changed = true; }
      }
      emptyArray(adsense, 'applist');
      // Remove only floating entries explicitly marked as advertisements.
      var floating = data.floating_icon;
      if (floating && typeof floating === 'object' && !Array.isArray(floating)) {
        Object.keys(floating).forEach(function (scene) {
          var icon = floating[scene];
          if (icon && String(icon.display_ad_icon) === '1') { delete floating[scene]; changed = true; }
        });
      }
    }
    if (changed) result = { body: JSON.stringify(data) };
  } catch (_) {
    // Fail open. Do not log response bodies, URLs or account information.
    console.log('[Tieba Ads] JSON structure unsupported; original response retained');
  }
  $done(result);
})();
