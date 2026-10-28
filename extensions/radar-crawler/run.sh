#!/usr/bin/env bash
# 客户雷达每日爬取：取计划 → Google 地图 → 抓官网 → 推回 BOS。服务器 cron 每天北京时间 06:00 调用一次。
# 地图结果异常或出现验证码时当天停止，并上报 BOS（管理员手机会收到提醒）。
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "缺少 .env，请先按 README 配置"; exit 1; }
set -a; . ./.env; set +a

RUN="$PWD/data/$(date -u +%Y-%m-%d)"
SCRAPER="${SCRAPER_IMAGE:-gosom/google-maps-scraper:latest}"
mkdir -p "$RUN"
crawler() { docker run --rm --env-file .env -v "$RUN:/data/run" radar-crawler python crawl.py "$@"; }
stop() { crawler report --status "$1" --run /data/run --error "$2"; exit 1; }

crawler plan --out /data/run
shopt -s nullglob
queries=("$RUN"/queries-*.txt)
[ ${#queries[@]} -gt 0 ] || { echo "今天没有要跑的关键词 × 城市"; exit 0; }

for file in "${queries[@]}"; do
  country=$(basename "$file" .txt); country=${country#queries-}
  log="$RUN/scraper-$country.log"
  if ! docker run --rm -v "$RUN:/data/run" "$SCRAPER" \
      -input "/data/run/queries-$country.txt" -results "/data/run/results-$country.json" -json \
      -lang "$(cat "$RUN/lang-$country.txt")" -depth "${SCRAPER_DEPTH:-1}" -c "${SCRAPER_CONCURRENCY:-2}" \
      -exit-on-inactivity 3m > "$log" 2>&1; then
    grep -qiE 'captcha|unusual traffic|sorry/index' "$log" && stop CAPTCHA "$country：$(tail -c 600 "$log")"
    stop ERROR "$country：$(tail -c 600 "$log")"
  fi
  grep -qiE 'captcha|unusual traffic|sorry/index' "$log" && stop CAPTCHA "$country：地图出现验证码"
  # 有关键词却一家都没找到，多半是被限制了：当天停止，不要接着撞。
  [ -s "$RUN/results-$country.json" ] || stop ERROR "$country：地图没有返回任何结果"
done

crawler push --run /data/run
