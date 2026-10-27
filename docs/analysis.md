# 脱敏抓包分析

样本：2026-10-27 的 iPhone 百度贴吧 HAR，共 222 条请求。不随仓库提供原始 HAR、请求头、请求参数、响应正文或用户数据。

## 本次规则的直接依据

| 路径 | 次数 | 响应格式 | 观察 |
| --- | ---: | --- | --- |
| `/c/f/ad/getSplashAd` | 1 | JSON | `data` 含 2 个广告对象，含 `ad_id`、`business_type`、`splash_info` |
| `/c/f/ad/getFeedAd` | 3 | Protobuf | 外层 field 1 为成功状态，field 2 为独立广告数据 |
| `/c/b/ad/adBid` | 1 | Protobuf | 同样的外层结构，field 2 包含竞价结果 |
| `/c/s/sync` | 1 | JSON | 开屏广告控制与正常客户端配置混合，只修改明确列出的开关 |

样本里的 Protobuf 外层状态 bytes 为 `0a 06 08 00 12 00 1a 00`，其中 field 1 嵌套消息的 field 1 为错误码 0。只在匹配这类成功结构时清空外层 field 2，输出空 message，不改 HTTP 状态。内部广告字段不需要完整反序列化，未知外层字段保持原始字节。

JSON 配置处理限于 `ad_origin_config_switch`、`screen_fill_data_result` 内明确列举的 5 个开屏开关，以及 `cloud_control_data_info.common_config.external_splash_switch`。只编辑本来存在且类型正确的字段。

## 特意保留

`/c/f/pb/page`、`/c/f/pb/firstPage`、`/c/f/excellent/personalized` 也是 Protobuf，但包含正常帖子或推荐内容。没有可靠 schema 证明某字段只含广告，因此本版本不修改它们。保留所有图片和头像 CDN、正常登录、评论、私信及安全校验接口。抓包中的广告日志和通用遥测也未加入默认封禁。

## 测试边界

离线测试覆盖精确域名和路径、HTTP 非成功状态、服务端错误码、无效 JSON、截断 Protobuf、幂等性、未知外层字段保留和 `$done` 恰好调用一次。HAR 回放验证 6 条目标响应可处理，其余 216 条不匹配规则。

这证明脚本能处理该样本，不证明客户端接受空响应后的界面行为，也不能推断其他贴吧版本、后续请求格式或第三方广告回退。Loon 配置依据官方文档编写，未经过设备内解析器验证。
