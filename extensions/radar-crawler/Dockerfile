# 官网抓取与推送（crawl.py）。地图部分直接用 google-maps-scraper 的官方镜像，见 run.sh。
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir crawl4ai==0.6.3 \
 && python -m playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/*
COPY crawl.py .
