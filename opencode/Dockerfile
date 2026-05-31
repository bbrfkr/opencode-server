# syntax=docker/dockerfile:1

# opencode serve を動かすための自前イメージ。
# 公式 ghcr イメージは認証が必要なため、ホストと同じ opencode-ai npm パッケージから構成する。
# glibc 前提のバイナリが配布されるため alpine ではなく slim(Debian) を使う。
#
# このイメージは「opencode サーバー」の単一の真実点。PKM vault でも n8n ワークフロー仕様でも、
# project root にマウントするものを compose の PROJECT_PATH で切り替えて使い回す
# （discord bot 等のクライアントは OPENCODE_BASE_URL でこのサーバーに接続する）。
FROM node:24-slim

# opencode は worktree 検出を git CLI（git rev-parse --show-toplevel）に頼るため git は必須。
# 無いと検出に失敗してファイルシステムルート（/）が worktree になる。diff 表示やコミットでも使う。
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl gnupg \
  && rm -rf /var/lib/apt/lists/*

# GitHub CLI（gh）を入れる。gh の API 認証も git と同じ n8n ブローカー経由の短命トークンで行う
# （`gh pr create` 等を AI に任せる）。実体は /usr/bin/gh に入り、下のラッパー /usr/local/bin/gh が
# /tmp/n8n-gh-token を読んで GH_TOKEN として渡す。公式 apt リポジトリから導入する（slim には gh が含まれない）。
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

# gh の API 認証も n8n ブローカー経由の短命トークンで行うための薄いラッパー。
# /usr/local/bin は PATH 上で /usr/bin より優先されるため、`gh` 実行時は本ラッパーが先に呼ばれ、
# /tmp/n8n-gh-token を GH_TOKEN にセットしてから実体 /usr/bin/gh を exec する（n8n は叩かない）。
# 発行/失効は git と同様 opencode プラグイン (plugins/github-token.js) が担当する。
COPY gh /usr/local/bin/gh
RUN chmod +x /usr/local/bin/gh

# マウントした vault/repo の .git はホスト側 uid(1000) 所有だが、コンテナは root(0) で動くため
# git の "dubious ownership" 保護で rev-parse が失敗し、worktree が / に落ちる。
# 全ディレクトリを信頼してこれを回避する（実行 uid に依存せず効くよう --system で /etc/gitconfig に書く）。
RUN git config --system --add safe.directory '*'

# HTTPS の push/pull の認証は n8n ブローカー経由の短命トークンで行う（静的 GH_TOKEN は使わない）。
# - opencode プラグイン (plugins/github-token.js) が git の network 操作の直前に n8n へ
#   POST /github/token して短命トークンを /tmp/n8n-gh-token に発行し、完了後 POST /github/revoke で失効する。
# - 下の credential helper (git-credential-n8n) は、そのファイルを読んで git に渡すだけの薄い受け渡し役。
# 空 helper でリセットしてから自前 helper を追加する（gh が生成する形式に倣う）。
# コミット著者情報（user.name/email）は image に焼かず、compose で GIT_AUTHOR_*/GIT_COMMITTER_* env を注入する。
COPY git-credential-n8n /usr/local/bin/git-credential-n8n
RUN chmod +x /usr/local/bin/git-credential-n8n \
  && git config --system credential.https://github.com.helper "" \
  && git config --system --add credential.https://github.com.helper "/usr/local/bin/git-credential-n8n"

# opencode 本体に加え defuddle CLI も同梱する。PKM の skill が Web ページ取得に
# `defuddle parse <url> --md` を使う。CLI バイナリ名 `defuddle` は defuddle パッケージ（dist/cli.js）が
# 提供する。jsdom ベースでブラウザ不要なので軽量。bot 用のデプロイでは未使用だが、同梱しても実害はなく
# イメージを 1 本に保てる利点が勝る。
RUN npm install -g opencode-ai defuddle && npm cache clean --force

# 発行/失効を担う opencode プラグインを global plugin ディレクトリへ配置（起動時に自動ロード）。
COPY plugins/ /root/.config/opencode/plugins/

# セッション DB 等のデータ保存先。compose で volume をマウントして永続化する。
ENV XDG_DATA_HOME=/data
# プロバイダ設定（API キーは {env:...} 置換で実行時に注入）。
ENV OPENCODE_CONFIG=/config/opencode.json
RUN mkdir -p /data /config

EXPOSE 4096

# 0.0.0.0 で待ち受けて compose ネットワーク内の他サービスやホストから到達可能にする。
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
