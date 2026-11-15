# Kimono Music's fetcher: yt-dlp (with Deno for YouTube's JS challenges and
# bgutil's plugin for PO tokens) behind a small HTTP front. Build from the
# repository root:
#   docker build -f infra/compose/server/music-fetcher/Dockerfile .
# Rebuilt on every release with the newest yt-dlp, which is how a YouTube
# change gets mended.
FROM denoland/deno:bin AS deno

FROM python:3.13-slim
LABEL org.opencontainers.image.source=https://github.com/kimonoapps/kimono
COPY --from=deno /deno /usr/local/bin/deno
RUN pip install --no-cache-dir -U "yt-dlp[default]" bgutil-ytdlp-pot-provider \
 && useradd --system --uid 10101 --home-dir /var/cache/kimono-fetcher fetcher \
 && mkdir -p /var/cache/kimono-fetcher && chown fetcher /var/cache/kimono-fetcher
COPY infra/compose/server/music-fetcher/fetcher.py /usr/local/lib/kimono/fetcher.py
USER fetcher
ENV KIMONO_FETCHER_WORK=/var/cache/kimono-fetcher PYTHONUNBUFFERED=1
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/healthz',timeout=4)" || exit 1
ENTRYPOINT ["python", "-I", "/usr/local/lib/kimono/fetcher.py"]
