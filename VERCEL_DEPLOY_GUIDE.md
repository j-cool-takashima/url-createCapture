# 🚀 Vercel デプロイガイド - libnss3.so エラー対策

このドキュメントは、`url-createCapture` を Vercel にデプロイする際の **libnss3.so エラー** を解決するための完全ガイドです。

---

## 📋 エラー履歴と原因

### 🔴 エラー: `libnss3.so: cannot open shared object file`
```
Failed to launch the browser process!
/tmp/chromium: error while loading shared libraries: libnss3.so:
cannot open shared object file: No such file or directory
```

**原因:**
- Puppeteer が使用する Chromium は NSS ライブラリ（`libnss3.so`）を必要とします
- Vercel の Lambda 環境（Amazon Linux 2023 ベース）には NSS が標準で含まれていません
- `@sparticuz/chromium` はバイナリを提供しますが、ライブラリパスが正しく設定されていないと失敗します

---

## ✅ 解決済みの対応

このリポジトリには以下の修正が **既に適用済み** です：

### 1. `vercel.json` の設定
```json
{
  "functions": {
    "api/**/*.js": {
      "runtime": "nodejs20.x",
      "maxDuration": 300,
      "memory": 2048
    }
  }
}
```

- ✅ **runtime**: `nodejs20.x` (Node.js 20.x + AL2023 で libnss3.so サポート)
- ✅ **maxDuration**: 300秒 (Chromium起動とキャプチャに十分な時間)
- ✅ **memory**: 2048MB (Chromiumのメモリ要件を満たす)

### 2. `lib/captureService.js` の Puppeteer 設定
```javascript
return await puppeteer.launch({
  args: launchArgs,
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  executablePath,
  headless: 'new',  // ✅ 新しい headless モード
  ignoreHTTPSErrors: true
});
```

### 3. デバッグログの追加
- ✅ Chromium の実行パス、LD_LIBRARY_PATH、エラー詳細を出力
- ✅ API リクエストとレスポンスのログ追加

---

## 🛠️ あなたがやるべきこと（重要）

### ステップ 1: Vercel で環境変数を設定

**これが最も重要な手順です。必ず実行してください。**

1. [Vercel Dashboard](https://vercel.com/dashboard) にログイン
2. プロジェクトを選択
3. **Settings** → **Environment Variables** に移動
4. 以下の環境変数を追加:

| Key | Value |
|-----|-------|
| `LD_LIBRARY_PATH` | `/var/task/lib:/opt/lib` |

5. **Environment** の選択:
   - ☑️ Production
   - ☑️ Preview
   - ☑️ Development

6. **Save** をクリック

---

### ステップ 2: 新しいデプロイをトリガー

環境変数を設定しただけでは反映されません。**新しいコミットをプッシュ**して再デプロイが必要です。

#### 方法 A: 空のコミットでトリガー
```powershell
git commit --allow-empty -m "Trigger Vercel redeploy with LD_LIBRARY_PATH"
git push origin main
```

#### 方法 B: 小さな変更を加える
```powershell
# READMEに日付を追記など
echo "`n# Updated: 2025-11-11" >> README.md
git add README.md
git commit -m "Update README - trigger redeploy"
git push origin main
```

---

### ステップ 3: デプロイログを確認

1. Vercel Dashboard → **Deployments** タブ
2. 最新のデプロイをクリック
3. **Functions** タブを開く
4. 以下のデバッグログを確認:

```
[DEBUG] Launching Chromium from: /tmp/chromium
[DEBUG] LD_LIBRARY_PATH: /var/task/lib:/opt/lib
[DEBUG] Node version: v20.x.x
[DEBUG] Platform: linux x64
```

**成功の兆候:**
- `LD_LIBRARY_PATH: /var/task/lib:/opt/lib` が表示される
- `libnss3.so` エラーが出ない
- `[API] Capture completed successfully` が表示される

---

### ステップ 4: 実際にテスト

1. デプロイされた URL を開く（例: `https://your-project.vercel.app`）
2. URL を入力（例: `https://example.com`）
3. **Start Capture** をクリック
4. ZIP ファイルがダウンロードされることを確認

---

## 🐛 トラブルシューティング

### エラー: `This deployment can not be redeployed`

**原因:** Vercel は古いコミットの再デプロイを許可しません。

**解決策:**
```powershell
git commit --allow-empty -m "Redeploy"
git push origin main
```

---

### エラー: `Function execution timed out`

**原因:** 
- ページの読み込みが遅い
- 複数URLを同時にキャプチャしている
- Cold start でChromiumの起動に時間がかかる

**解決策:**
1. `vercel.json` の `maxDuration` を確認（現在300秒に設定済み）
2. 一度にキャプチャするURLの数を減らす
3. Vercel の Pro プランにアップグレード（最大60秒 → 900秒に延長可能）

---

### エラー: `Memory limit exceeded`

**原因:** Chromium がメモリを大量消費

**解決策:**
1. `vercel.json` の `memory` を `3008` に増やす
2. キャプチャする画像サイズを小さくする（viewportの調整）

---

### デプロイは成功するがUIが表示されない

**確認項目:**
1. `vercel.json` の routes 設定を確認
2. ブラウザの開発者ツールでエラーを確認
3. `public/index.html` が正しくビルドに含まれているか確認

---

## 📊 期待されるログ出力（成功例）

### Build Log
```
✓ Installing dependencies...
✓ Building project...
✓ Deploying...
```

### Function Log（正常時）
```
[API] /api/capture called - Method: POST
[API] Request body parsed - URLs: 1 Format: png
[API] Starting captureAll with destination: /tmp/captures
[DEBUG] Launching Chromium from: /tmp/chromium
[DEBUG] LD_LIBRARY_PATH: /var/task/lib:/opt/lib
[DEBUG] Node version: v20.11.0
[DEBUG] Platform: linux x64
[API] Capture completed successfully - Results: 1
```

---

## 📚 参考リンク

- [Puppeteer Troubleshooting](https://pptr.dev/troubleshooting)
- [@sparticuz/chromium Documentation](https://github.com/Sparticuz/chromium)
- [Vercel Environment Variables](https://vercel.com/docs/projects/environment-variables)
- [Vercel Serverless Functions](https://vercel.com/docs/functions)

---

## 🎯 チェックリスト

デプロイ前に以下を確認してください：

- [ ] `vercel.json` に `runtime: "nodejs20.x"` が設定されている
- [ ] `vercel.json` に `maxDuration: 300` と `memory: 2048` が設定されている
- [ ] Vercel Dashboard で `LD_LIBRARY_PATH=/var/task/lib:/opt/lib` を設定した
- [ ] 環境変数設定後、新しいコミットをプッシュした
- [ ] デプロイログで `[DEBUG] LD_LIBRARY_PATH:` が正しく表示される
- [ ] 実際にURLキャプチャをテストして成功を確認

---

## 📞 サポート

問題が解決しない場合：

1. **Vercel Dashboard のログをコピー**してください
2. 特に `[DEBUG]` と `[ERROR]` で始まる行を確認
3. GitHub Issues に報告する際は、以下を含めてください：
   - エラーメッセージ全文
   - Vercel のランタイムログ
   - テストに使用したURL

---

最終更新: 2025年11月11日

