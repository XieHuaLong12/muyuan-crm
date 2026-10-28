# 客户雷达 · 地图爬虫

每天北京时间 06:00 从 BOS 取「关键词 × 城市」计划，用 [google-maps-scraper](https://github.com/gosom/google-maps-scraper) 在 Google 地图上搜商家，再用 [Crawl4AI](https://github.com/unclecode/crawl4ai) 抓官网的首页、联系页和关于页（邮箱、wa.me 链接、社媒、正文），分批推回 BOS。设计见 [docs/CUSTOMER_RADAR_COLD_EMAIL.md](../../docs/CUSTOMER_RADAR_COLD_EMAIL.md) §7.4。

爬虫只持有 `RADAR_INGEST_SECRET`：不连数据库、不调 AI。去重、跳过客户库里已有的公司、AI 评分、邮箱验证都在 BOS 里完成。

## 需要什么

- 一台能跑 Docker 的 VPS（2 核 4G 够用）。Hostinger 的 Node.js 托管跑不了 Docker 和无头浏览器，所以爬虫不和 BOS 放在一起。
- Google 限制的是这台机器的 IP，与公司账号无关；量大时再配代理。

## 部署

```sh
# 1. 把本目录放到服务器上，例如 /opt/radar-crawler
cd /opt/radar-crawler
cp .env.example .env            # 填 BOS_URL 和 RADAR_INGEST_SECRET（与 BOS 环境变量相同，不要加引号）
docker build -t radar-crawler .
docker pull gosom/google-maps-scraper:latest

# 2. 手动跑一次，确认能推到 BOS
./run.sh
```

BOS 侧需要：

1. Hostinger 环境变量 `RADAR_INGEST_SECRET`（随机长字符串，例如 `openssl rand -hex 32`）。
2. 在「设置 · 客户雷达」里添加关键词和城市。
3. Hostinger Cron 每分钟 `POST /api/cron/radar`（请求头 `x-cron-secret: <META_SYNC_SECRET>`），负责 AI 评分和邮箱验证。

## 定时运行

北京时间 06:00 是 UTC 前一天 22:00。服务器时区是 UTC 时：

```cron
0 22 * * * /opt/radar-crawler/run.sh >> /opt/radar-crawler/data/cron.log 2>&1
```

## 每次运行做什么

1. `crawl.py plan`：取今天要跑的关键词 × 城市（最久没跑过的先跑，条数在 BOS 设置里调），按国家写出 `queries-<国家>.txt`。
2. 每个国家跑一次 google-maps-scraper（语言跟随国家：法国用法语）。出现验证码或一家都没找到时**当天停止**，并上报 BOS，管理员手机会收到提醒。
3. `crawl.py push`：每家有官网的抓首页和最多 2 个联系 / 关于页，提取邮箱（附出处网址，GDPR 要求记录数据来源）、WhatsApp、社媒和正文（截到 4000 字），每 50 家推一批；最后上报各组关键词的结果数。

运行文件在 `data/<日期>/`（已在 `.gitignore` 里）。

## 第一次运行请核对

google-maps-scraper 不同版本输出的字段名不完全一样，`crawl.py` 的 `place_from_entry` 已兼容几种写法（`web_site` / `website`、`place_id` / `data_id` / `cid`）。第一次跑完请打开 `data/<日期>/results-FR.json` 看一眼，确认店名、官网、电话、城市都能读到；确认无误后把 `.env` 里的 `SCRAPER_IMAGE` 固定为当时的版本号。

## 测试

```sh
python3 -m unittest test_crawl     # 只测提取规则，不需要 Crawl4AI 和网络
```
