# syntax=docker/dockerfile:1

# opencode serve を動かすための自前イメージ。
# 公式 ghcr イメージは認証が必要なため、ホストと同じ opencode-ai npm パッケージから構成する。
# glibc 前提のバイナリが配布されるため alpine ではなく slim(Debian) を使う。
FROM node:24-slim

RUN npm install -g opencode-ai && npm cache clean --force

# セッション DB 等のデータ保存先。compose で volume をマウントして永続化する。
ENV XDG_DATA_HOME=/data
# プロバイダ設定（API キーは {env:...} 置換で実行時に注入）。
ENV OPENCODE_CONFIG=/config/opencode.json
RUN mkdir -p /data /config

EXPOSE 4096

# 0.0.0.0 で待ち受けて compose ネットワーク内の他サービスから到達可能にする。
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
