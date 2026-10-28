"""客户雷达爬虫：取 BOS 的「关键词 × 城市」计划，读 google-maps-scraper 的结果，用 Crawl4AI 抓官网，推回 BOS。

只持有 RADAR_INGEST_SECRET：不连数据库、不调 AI。去重、跳过已有客户、评分都由 BOS 完成
（docs/CUSTOMER_RADAR_COLD_EMAIL.md §7.4）。

  python crawl.py plan  --out /data/run            # 写出各国家的 queries-<国家>.txt 和 plan.json
  python crawl.py push  --run /data/run            # 读 results-<国家>.json，抓官网，分批推给 BOS，最后上报
  python crawl.py report --status CAPTCHA --error "…" --run /data/run
"""
from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import html
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

BATCH = 50
PAGE_TIMEOUT_MS = 30_000
SITE_CONCURRENCY = 3
TEXT_LIMIT = 4000
CONTACT_WORDS = re.compile(r"contact|nous-contacter|contactez|about|a-propos|apropos|qui-sommes|notre-histoire|who-we-are|our-story|impressum", re.I)
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
MAILTO_RE = re.compile(r"mailto:([^\"'?>\s]+)", re.I)
# Sites write addresses as "achat [at] shop [dot] fr" to keep robots out; read them back.
OBFUSCATED_RE = re.compile(r"([A-Za-z0-9._%+-]+)\s*[\[(]\s*(?:at|arobase)\s*[\])]\s*([A-Za-z0-9-]+(?:\s*[\[(]\s*(?:dot|point)\s*[\])]\s*[A-Za-z0-9-]+)+)", re.I)
WA_RE = re.compile(r"https?://(?:api\.)?(?:wa\.me/|whatsapp\.com/send\?phone=)(\+?\d{6,15})", re.I)
SOCIAL_HOSTS = {"facebook": "facebook.com", "instagram": "instagram.com", "linkedin": "linkedin.com", "tiktok": "tiktok.com", "youtube": "youtube.com"}


def env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"缺少环境变量 {name}")
    return value


def bos(method: str, path: str, body: dict | None = None) -> dict:
    """Calls BOS with the radar key; retries network errors a few times, never a refusal."""
    url = env("BOS_URL").rstrip("/") + path
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={"x-radar-secret": env("RADAR_INGEST_SECRET"), "Content-Type": "application/json"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return json.loads(response.read())["data"]
        except urllib.error.HTTPError as error:
            detail = error.read().decode(errors="replace")[:300]
            if error.code >= 500 and attempt < 3:
                continue
            sys.exit(f"BOS 拒绝了请求 {path}：HTTP {error.code} {detail}")
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == 3:
                sys.exit(f"连不上 BOS {path}：{error}")
    raise RuntimeError("unreachable")


# ─── Pure extraction (tested in test_crawl.py) ───────────

def extract_emails(page_html: str, page_text: str = "") -> list[str]:
    """Every address on a page: plain text, mailto links, and "[at]" / "[dot]" spellings."""
    found: list[str] = []
    source = html.unescape(page_html) + "\n" + page_text
    for match in MAILTO_RE.findall(source):
        found.append(urllib.parse.unquote(match))
    found += EMAIL_RE.findall(source)
    for local, rest in OBFUSCATED_RE.findall(source):
        found.append(local + "@" + re.sub(r"\s*[\[(]\s*(?:dot|point)\s*[\])]\s*", ".", rest, flags=re.I))
    seen: dict[str, None] = {}
    for address in found:
        address = address.strip().strip(".,;:").lower()
        if address and address not in seen:
            seen[address] = None
    return list(seen)


def whatsapp_links(page_html: str) -> list[str]:
    return list(dict.fromkeys(f"https://wa.me/{number.lstrip('+')}" for number in WA_RE.findall(page_html)))


def social_links(urls: list[str]) -> dict[str, str]:
    socials: dict[str, str] = {}
    for url in urls:
        host = urllib.parse.urlparse(url).hostname or ""
        for key, base in SOCIAL_HOSTS.items():
            if key not in socials and (host == base or host.endswith("." + base)) and urllib.parse.urlparse(url).path.strip("/"):
                socials[key] = url
    return socials


def contact_pages(home: str, internal: list[str], limit: int = 2) -> list[str]:
    """Contact and about pages on the same site, the shortest addresses first (the section page, not an article)."""
    base = urllib.parse.urlparse(home).hostname or ""
    pages = []
    for url in internal:
        parsed = urllib.parse.urlparse(url)
        if parsed.hostname and parsed.hostname.removeprefix("www.") != base.removeprefix("www."):
            continue
        if CONTACT_WORDS.search(parsed.path) and url.rstrip("/") != home.rstrip("/"):
            pages.append(url.split("#")[0])
    return sorted(dict.fromkeys(pages), key=len)[:limit]


def place_from_entry(entry: dict) -> dict | None:
    """One google-maps-scraper JSON entry as a BOS place. Field names differ between versions, so several are tried."""
    key = entry.get("place_id") or entry.get("data_id") or entry.get("cid") or entry.get("link")
    name = (entry.get("title") or entry.get("name") or "").strip()
    if not key or not name:
        return None
    address = entry.get("complete_address") or {}
    city = (address.get("city") if isinstance(address, dict) else "") or ""
    emails = entry.get("emails") or []
    return {
        "placeKey": str(key)[:191],
        "name": name,
        "city": city,
        "address": entry.get("address") or "",
        "website": entry.get("web_site") or entry.get("website") or "",
        "phone": entry.get("phone") or "",
        "category": entry.get("category") or ", ".join(entry.get("categories") or []),
        "rating": entry.get("review_rating"),
        "reviewCount": entry.get("review_count"),
        "emails": [{"address": e, "foundOn": "google-maps-scraper"} for e in emails if isinstance(e, str)],
        "whatsapp": "",
        "socials": {},
        "siteText": "",
        "_inputId": entry.get("input_id") or "",
    }


def read_results(path: Path) -> list[dict]:
    """The scraper writes a JSON array or one JSON object per line, depending on the version."""
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return []
    try:
        data = json.loads(raw)
        return data if isinstance(data, list) else [data]
    except json.JSONDecodeError:
        return [json.loads(line) for line in raw.splitlines() if line.strip()]


# ─── Site reading (Crawl4AI) ─────────────────────────────

async def read_sites(places: list[dict]) -> None:
    from crawl4ai import AsyncWebCrawler, CrawlerRunConfig  # imported here so the pure functions test without it

    run_config = CrawlerRunConfig(page_timeout=PAGE_TIMEOUT_MS)
    gate = asyncio.Semaphore(SITE_CONCURRENCY)
    async with AsyncWebCrawler() as crawler:
        async def visit(place: dict) -> None:
            home = place["website"]
            if not home:
                return
            if not home.startswith("http"):
                home = "https://" + home
            async with gate:
                texts: list[str] = []
                try:
                    first = await crawler.arun(url=home, config=run_config)
                    if not first.success:
                        return
                    pages = [(home, first)]
                    internal = [link.get("href", "") for link in (first.links or {}).get("internal", [])]
                    for url in contact_pages(home, internal):
                        result = await crawler.arun(url=url, config=run_config)
                        if result.success:
                            pages.append((url, result))
                    for url, result in pages:
                        page_text = str(result.markdown or "")
                        texts.append(page_text)
                        for address in extract_emails(result.html or "", page_text):
                            place["emails"].append({"address": address, "foundOn": url})
                        place["whatsapp"] = place["whatsapp"] or next(iter(whatsapp_links(result.html or "")), "")
                        external = [link.get("href", "") for link in (result.links or {}).get("external", [])]
                        place["socials"] = {**social_links(external), **place["socials"]}
                except Exception as error:  # one broken site must not stop the run
                    print(f"  {home}: {error}", file=sys.stderr)
                place["siteText"] = re.sub(r"\s+", " ", " ".join(texts))[:TEXT_LIMIT]

        await asyncio.gather(*(visit(place) for place in places))


# ─── Commands ────────────────────────────────────────────

def cmd_plan(args: argparse.Namespace) -> None:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    plan = bos("GET", "/api/radar/crawl/plan")
    searches = plan["searches"]
    (out / "plan.json").write_text(json.dumps({"startedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "searches": searches}, ensure_ascii=False), encoding="utf-8")
    by_country: dict[str, list[dict]] = {}
    for search in searches:
        by_country.setdefault(search["country"], []).append(search)
    for country, rows in by_country.items():
        # "query #!# id" lets the scraper echo the row id back as input_id.
        (out / f"queries-{country}.txt").write_text("".join(f"{s['query']} #!# {s['id']}\n" for s in rows), encoding="utf-8")
        (out / f"lang-{country}.txt").write_text(rows[0]["language"], encoding="utf-8")
    print(f"今天 {len(searches)} 组关键词 × 城市：" + "，".join(f"{c} {len(r)}" for c, r in by_country.items()))


def cmd_push(args: argparse.Namespace) -> None:
    run = Path(args.run)
    plan = json.loads((run / "plan.json").read_text(encoding="utf-8"))
    ids = {s["id"] for s in plan["searches"]}
    found: dict[str, int] = {s["id"]: 0 for s in plan["searches"]}
    for results in sorted(run.glob("results-*.json")):
        country = results.stem.split("-", 1)[1]
        places = [p for p in (place_from_entry(e) for e in read_results(results)) if p]
        print(f"{country}：地图结果 {len(places)} 家，开始抓官网")
        asyncio.run(read_sites(places))
        groups: dict[str, list[dict]] = {}
        for place in places:
            search_id = place.pop("_inputId")
            search_id = search_id if search_id in ids else ""
            if search_id:
                found[search_id] += 1
            groups.setdefault(search_id, []).append(place)
        for search_id, rows in groups.items():
            for start in range(0, len(rows), BATCH):
                body = {"places": rows[start:start + BATCH], **({"searchId": search_id} if search_id else {"country": country})}
                result = bos("POST", "/api/radar/crawl/ingest", body)
                print(f"  推送 {len(body['places'])} 家：新入库 {result['created']}，重复 {result['duplicates']}，已是客户 {result['inBos']}")
    report = bos("POST", "/api/radar/crawl/report", {"status": "DONE", "startedAt": plan["startedAt"], "searches": [{"id": k, "found": v} for k, v in found.items()]})
    print(f"完成：新入库 {report['created']} 家")


def cmd_report(args: argparse.Namespace) -> None:
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    plan_file = Path(args.run) / "plan.json" if args.run else None
    if plan_file and plan_file.exists():
        started = json.loads(plan_file.read_text(encoding="utf-8"))["startedAt"]
    bos("POST", "/api/radar/crawl/report", {"status": args.status, "startedAt": started, "error": args.error[:1000]})


def main() -> None:
    parser = argparse.ArgumentParser(description="客户雷达爬虫")
    sub = parser.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan")
    plan.add_argument("--out", required=True)
    plan.set_defaults(handler=cmd_plan)
    push = sub.add_parser("push")
    push.add_argument("--run", required=True)
    push.set_defaults(handler=cmd_push)
    report = sub.add_parser("report")
    report.add_argument("--status", choices=["DONE", "CAPTCHA", "ERROR"], required=True)
    report.add_argument("--error", default="")
    report.add_argument("--run", default="")
    report.set_defaults(handler=cmd_report)
    args = parser.parse_args()
    args.handler(args)


if __name__ == "__main__":
    main()
