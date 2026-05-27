# syntax=docker/dockerfile:1

# opencode serve を動かすための自前イメージ。
# 公式 ghcr イメージは認証が必要なため、ホストと同じ opencode-ai npm パッケージから構成する。
# glibc 前提のバイナリが配布されるため alpine ではなく slim(Debian) を使う。
FROM node:24-slim

# opencode は worktree 検出を git CLI（git rev-parse --show-toplevel）に頼るため git は必須。
# 無いと検出に失敗してファイルシステムルート（/）が worktree になる。diff 表示やコミットでも使う。
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl gnupg \
  && rm -rf /var/lib/apt/lists/*

# AI に git の pull/commit/push を任せるため GitHub CLI を入れる。
# 公式 apt リポジトリから導入する（slim には gh が含まれないため）。
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# マウントした vault の .git はホスト側 uid(1000) 所有だが、コンテナは root(0) で動くため
# git の "dubious ownership" 保護で rev-parse が失敗し、worktree が / に落ちる。
# 全ディレクトリを信頼してこれを回避する（実行 uid に依存せず効くよう --system で /etc/gitconfig に書く）。
RUN git config --system --add safe.directory '*'

# HTTPS の push/pull で gh を credential helper に使う（`gh auth setup-git` 相当）。
# token はビルド時には不要で、実行時に GH_TOKEN 環境変数から gh が読み取る。
# 空 helper でリセットしてから gh を追加するのが gh の生成する形式。
# コミット著者情報（user.name/email）は image に焼かず、compose で GIT_AUTHOR_*/GIT_COMMITTER_* env を注入する。
RUN git config --system credential.https://github.com.helper "" \
  && git config --system --add credential.https://github.com.helper "!/usr/bin/gh auth git-credential"

# defuddle CLI も同梱する。PKM の skill が Web ページ取得に `defuddle parse <url> --md` を使う。
# CLI バイナリ名 `defuddle` は defuddle パッケージ（dist/cli.js）が提供する。jsdom ベースでブラウザ不要。
RUN npm install -g opencode-ai defuddle && npm cache clean --force

# セッション DB 等のデータ保存先。compose で volume をマウントして永続化する。
ENV XDG_DATA_HOME=/data
# プロバイダ設定（API キーは {env:...} 置換で実行時に注入）。
ENV OPENCODE_CONFIG=/config/opencode.json
RUN mkdir -p /data /config

EXPOSE 4096

# 0.0.0.0 で待ち受けて compose ネットワーク内の他サービスから到達可能にする。
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
