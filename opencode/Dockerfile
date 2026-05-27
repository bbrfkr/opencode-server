# syntax=docker/dockerfile:1

# opencode serve を動かすための自前イメージ。
# 公式 ghcr イメージは認証が必要なため、ホストと同じ opencode-ai npm パッケージから構成する。
# glibc 前提のバイナリが配布されるため alpine ではなく slim(Debian) を使う。
FROM node:24-slim

# opencode は worktree 検出を git CLI（git rev-parse --show-toplevel）に頼るため git は必須。
# 無いと検出に失敗してファイルシステムルート（/）が worktree になる。diff 表示やコミットでも使う。
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*

# マウントした vault の .git はホスト側 uid(1000) 所有だが、コンテナは root(0) で動くため
# git の "dubious ownership" 保護で rev-parse が失敗し、worktree が / に落ちる。
# 全ディレクトリを信頼してこれを回避する（実行 uid に依存せず効くよう --system で /etc/gitconfig に書く）。
RUN git config --system --add safe.directory '*'

RUN npm install -g opencode-ai && npm cache clean --force

# セッション DB 等のデータ保存先。compose で volume をマウントして永続化する。
ENV XDG_DATA_HOME=/data
# プロバイダ設定（API キーは {env:...} 置換で実行時に注入）。
ENV OPENCODE_CONFIG=/config/opencode.json
RUN mkdir -p /data /config

EXPOSE 4096

# 0.0.0.0 で待ち受けて compose ネットワーク内の他サービスから到達可能にする。
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
