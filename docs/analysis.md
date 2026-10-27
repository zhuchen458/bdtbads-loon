# 脱敏抓包分析

样本：2026-10-27 的 iPhone 百度贴吧 HAR，共 222 条请求。不随仓库提供原始 HAR、请求头、请求参数、响应正文或用户数据。

## 本次规则的直接依据

| 路径 | 次数 | 响应格式 | 观察 |
| --- | ---: | --- | --- |
| `/c/f/ad/getSplashAd` | 1 | JSON | `data` 含 2 个广告对象，含 `ad_id`、`business_type`、`splash_info` |
| `/c/f/ad/getFeedAd` | 3 | Protobuf | 外层 field 1 为成功状态，field 2 为独立广告数据 |
| `/c/b/ad/adBid` | 1 | Protobuf | 同样的外层结构，field 2 包含竞价结果 |
| `/c/s/sync` | 1 | JSON | 开屏广告控制与正常客户端配置混合，只修改明确列出的开关 |
| `/c/f/excellent/personalized` | 1 | Protobuf | `data.field9` 的 `BannerList.app` 含完整广告；与 12 条正常帖子并列 |

样本里的 Protobuf 外层状态 bytes 为 `0a 06 08 00 12 00 1a 00`，其中 field 1 嵌套消息的 field 1 为错误码 0。只在匹配这类成功结构时清空外层 field 2，输出空 message，不改 HTTP 状态。内部广告字段不需要完整反序列化，未知外层字段保持原始字节。

v0.2 的 JSON 配置另外处理：`config.switch` 中明确列举的第三方广告 SDK 初始化开关、`adload_config` 的 home/frs/pb blocked 标记、四种 home/frs/pb banner/pb comment 竞价数量，以及 `ad_adsense.ssp_ad_conf` 的 RECOM/FRS/PB_BANNER/PB_COMMENT 广告位。竞价和 `external_splash_switch` 在样本中是 JSON 编码的字符串，保留该格式及其中未知配置；不将 JSON 对象字符串粗暴替换成数字字符串。只编辑本来存在且类型正确的字段。

`floating_icon.pb.display_ad_icon=1` 标记了截图中的浮动广告入口；仅删除有此标记的入口，保留没有广告标记的首页配置。`ad_destroy_remove_container` 保持为启用状态。开关被修改不等于客户端必然遵循，需要真机验证。

## v0.2 整卡处理依据

推荐响应 `data.field9 -> BannerList.field1` 中的广告含 `apiAd`、`csjAPI` 等广告类型标记。删除整个广告对象，父 `BannerList` 为空时连同父字段一起删除，不留下一个空对象。回放验证剩余 12 条正常帖子及其他字段逐字节不变。明确的 `ThreadInfo.is_ad` (field 59) 过滤有公开 schema 和合成用例依据；本样本没有命中的此类条目。

参考公开字段定义：[app2smile/rules](https://github.com/app2smile/rules/blob/master/js/tieba-proto.js) 的 `PersonalizedDataRes.banner_list=9`、`BannerList.app=1/pb_banner_ad=5`，以及 [aiotieba ThreadInfo.proto](https://github.com/lumina37/aiotieba/blob/master/src/aiotieba/api/_protobuf/ThreadInfo.proto) 的 `is_ad=59`。实现为独立的原始字节过滤器，不引入或执行上游完整脚本。

## 特意保留

`/c/f/pb/page`、`/c/f/pb/firstPage` 的样本是 `cmd=309751` 新结构；field 9 是排序菜单，不能套用旧版广告 schema。本版本保留新版帖子响应，帖子和评论广告主要通过同步配置尝试阻止插入。`cmd=302001` 旧帖子广告字段 12 来自公开 schema，仅用合成数据测试，不能当成当前截图对应结构。保留所有图片和头像 CDN、正常登录、评论、私信及安全校验接口。抓包中的广告日志和通用遥测未加入默认封禁。

## 测试边界

离线测试覆盖精确域名和路径、HTTP 非成功状态、服务端错误码、无效 JSON、截断 Protobuf、幂等性、64 位未知字段原始字节保留、整张广告及空父容器删除、正常帖子保留、JSON 字符串配置格式、未知广告位保留和 `$done` 恰好调用一次。HAR 回放中 8 条响应命中 URL guard：7 条被修改，1 条新版帖子响应主动放行；另 214 条请求不匹配规则。共 215 条响应不变。

这证明脚本能处理该样本，不证明客户端接受空响应后的界面行为，也不能推断其他贴吧版本、后续请求格式或第三方广告回退。Loon 配置依据官方文档编写，未经过设备内解析器验证。
