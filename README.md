# 高度応用情報科学科 オープンキャンパス特設ページ

千葉工業大学 高度応用情報科学科のオープンキャンパス向け特設サイトです。ベイズ統計の学び体験を振り返るコンテンツと、ブラウザで試せるデモを提供します。

## 主なコンテンツ

- トップページ: 当日のスライドと4つの問題の振り返り
- [ベイズ宝探し](dowsing/): センサー観測を重ねて宝箱の位置を推定するゲーム
- [モンティ・ホール問題](monty/): 選び直す場合とそのままの場合の勝率を比較するデモ
- [研究分野マップ](research-map/): 教員紹介文をもとに、学科・教員・研究室の研究内容の近さを可視化するページ

## ローカルでの確認

ビルドは不要です。リポジトリのルートで静的ファイルサーバーを起動し、表示されたURLをブラウザで開いてください。

```sh
python3 -m http.server 8000
```

<http://localhost:8000> を開くとトップページを確認できます。

## 研究分野マップのデータ更新

研究分野マップは `data/teachers.json` の教員紹介データを入力として、TF-IDF、コサイン類似度、PCAによる2次元座標を計算します。

| 用途 | ファイル |
| --- | --- |
| 入力データ | `data/teachers.json` |
| 生成済み分析データ | `data/research-map-analysis.json` |
| 生成スクリプト | `tools/build-research-map-data.js` |
| 日本語形態素解析器 | `vendor/kuromoji.js` |

Node.js を用意したうえで、次のコマンドを実行します。

```sh
node tools/build-research-map-data.js
```

実行時には、形態素解析用の辞書を jsDelivr から取得するため、ネットワーク接続が必要です。

## 自動更新

`main` ブランチへのプッシュ時、GitHub Actions が研究分野マップの分析データを再生成します。`data/research-map-analysis.json` に差分がある場合は、`github-actions[bot]` が更新コミットを作成します。

ワークフロー定義は `.github/workflows/build-research-map-analysis.yml` にあります。

## 構成

```text
.
├── index.html                 # トップページ
├── dowsing/                   # ベイズ宝探し
├── monty/                     # モンティ・ホール問題デモ
├── research-map/              # 研究分野マップ
├── data/                      # 教員データと分析結果
├── slides/                    # 当日のスライド
├── tools/                     # 分析データ生成スクリプト
└── vendor/                    # 外部ライブラリ
```
