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
# jq は JSON 整形・抽出に AI が頻繁に使う汎用 CLI なので併せて入れる（Debian apt 版でよい）。
# poppler-utils はバックエンド LLM が直接読めない PDF を解析するために入れる（`pdf` skill が使用）。
# LLM のモダリティは text+image のみで PDF を食えないため、pdftotext でテキスト層を、pdftoppm で
# 図表/スキャンページを PNG 化して image 入力（vision）で読む。pdfinfo / pdfimages も同梱される。
# ffmpeg は音声入力対応モデル向けに音声ファイルを扱うために入れる。slim には含まれず、無いと
# 音声のデコード/フォーマット変換（例: 各種コーデック→wav/mp3 への変換やリサンプリング）ができない。
# ffprobe も同梱され、音声/動画のメタデータ・コーデック判定に使える。
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates curl gnupg jq poppler-utils ffmpeg \
  && rm -rf /var/lib/apt/lists/*

# yq（YAML/JSON/XML プロセッサ）を入れる。jq の YAML 版として AI が頻繁に使う。
# Debian apt の `yq` は別実装（python-yq）なので、デファクトの mikefarah/yq を
# GitHub リリースの単一 Go バイナリで導入する（arch は gh と同様 dpkg で解決し、
# yq の命名 yq_linux_{amd64,arm64} に一致する）。
ARG YQ_VERSION=v4.44.3
RUN curl -fsSL "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/yq_linux_$(dpkg --print-architecture)" \
    -o /usr/local/bin/yq \
  && chmod +x /usr/local/bin/yq \
  && yq --version

# mise が扱う各言語（Ruby / Python / Go / Rust / Node.js）の開発・ビルドに必要な依存パッケージ群を導入する。
# ランタイム本体は mise が precompiled バイナリで取得する（Ruby はソースビルド）ため本体ビルド用というより、
# 各エコシステムのネイティブ拡張（gem / pip の C 拡張 / node-gyp / cgo / cargo の *-sys クレート）を
# コンパイルするための C/C++ ツールチェーンと代表的な -dev ヘッダを揃える狙い。
# 完璧な網羅は目指さず、よく要求されるものを広めに入れて 5 言語の一般的な開発用途をカバーする。
#
# - build-essential / autoconf / bison / patch / pkg-config: 全言語共通の C/C++ ツールチェーンとビルド補助。
# - python3: Node の node-gyp がネイティブモジュールのビルドに system python3 を要求する（slim には無い）。
# - Ruby(ruby-build)向け: libssl-dev libyaml-dev libreadline-dev zlib1g-dev libncurses-dev libffi-dev
#     libgdbm-dev libdb-dev uuid-dev。
# - Rust(cargo): pkg-config + libssl-dev（openssl-sys 等のリンクに必要）。Go(cgo): build-essential で足りる。
# - Python/各言語の C 拡張で頻出: libsqlite3-dev libbz2-dev liblzma-dev libxml2-dev libxslt1-dev
#     libpq-dev libjpeg-dev libcurl4-openssl-dev。
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    autoconf \
    bison \
    patch \
    pkg-config \
    python3 \
    libssl-dev \
    libyaml-dev \
    libreadline-dev \
    zlib1g-dev \
    libncurses-dev \
    libffi-dev \
    libgdbm-dev \
    libdb-dev \
    uuid-dev \
    libsqlite3-dev \
    libbz2-dev \
    liblzma-dev \
    libxml2-dev \
    libxslt1-dev \
    libpq-dev \
    libjpeg-dev \
    libcurl4-openssl-dev \
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

# mise（多言語ツールチェーンマネージャ）を導入する。discord 経由のコーディング用途で、AI が
# project root に clone した各 repo の .mise.toml / .tool-versions に従い、任意の言語ランタイムを
# 汎用的に導入できるようにする（特定言語をイメージに焼き込まない）。実体は /usr/local/bin/mise。
RUN curl -fsSL https://mise.run | MISE_INSTALL_PATH=/usr/local/bin/mise sh

# mise の挙動と保存先を環境変数で固定する。
# - data/cache/state/config を /mise 配下に集約し、compose の named volume で永続化する
#   （インストール済みツールと DL キャッシュが再生成後も残る＝実質バイナリキャッシュ）。
# - opencode は各コマンドを非対話シェルで個別に起動するため `mise activate` の shell hook は
#   効きにくい。代わりに shims ディレクトリ($MISE_DATA_DIR/shims)を PATH 先頭に置いて解決する。
# - MISE_*_COMPILE=0: Python 等をソースビルドせず precompiled バイナリを取得する（高速・堅牢）。
# - MISE_YES=1: 非対話実行のため確認プロンプトを自動承認する。
# - MISE_TRUSTED_CONFIG_PATHS=/root/project: clone した repo の mise 設定を自動信頼する。
ENV MISE_DATA_DIR=/mise/data \
    MISE_CACHE_DIR=/mise/cache \
    MISE_STATE_DIR=/mise/state \
    MISE_CONFIG_DIR=/mise/config \
    MISE_PYTHON_COMPILE=0 \
    MISE_NODE_COMPILE=0 \
    MISE_YES=1 \
    MISE_TRUSTED_CONFIG_PATHS=/root/project
ENV PATH="/mise/data/shims:${PATH}"
# 非対話シェルは上の ENV PATH をそのまま継承するが、login シェル(`bash -l`)は /etc/profile で
# PATH を組み直すため shims が先頭から外れ、base イメージの node 等に影を踏まれうる。
# login シェルでも shims を先頭に保つよう profile.d でも前置しておく（どちらの起動経路でも mise が勝つ）。
RUN printf 'export PATH="/mise/data/shims:$PATH"\n' > /etc/profile.d/mise-shims.sh
RUN mkdir -p /mise/data /mise/cache /mise/state /mise/config

# 発行/失効を担う opencode プラグイン（github-token.js）はイメージに焼き込まず、
# dot-opencode リポジトリ（= .opencode ディレクトリ）の plugins/ に同梱する。
# compose が dot-opencode を /root/.config/opencode へまるごとマウントするため、
# ~/.config/opencode/plugins/github-token.js として起動時に自動ロードされる
# （gh / git-credential-n8n ラッパーが参照する絶対パスも従来どおり変わらない）。

# セッション DB 等のデータ保存先。compose で volume をマウントして永続化する。
ENV XDG_DATA_HOME=/data
# プロバイダ設定（API キーは {env:...} 置換で実行時に注入）。
ENV OPENCODE_CONFIG=/config/opencode.json
RUN mkdir -p /data /config

EXPOSE 4096

# 0.0.0.0 で待ち受けて compose ネットワーク内の他サービスやホストから到達可能にする。
CMD ["opencode", "serve", "--hostname", "0.0.0.0", "--port", "4096"]
