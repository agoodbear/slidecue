/**
 * 建置設定。
 *
 * ⚠️ **不要把任何主機位址編進 bundle。**
 *
 * 先前的版本會把「執行 build 那台 Mac」的 mDNS 名稱與 Tailscale 位址寫死進來。
 * 對開發者自己有效，但商店發布的是同一份檔案——每個下載者拿到的 app 都寫著
 * 開發者的電腦名稱與 tailnet 位址。那既連不上（別人的網路解析不到），
 * 又把開發者的網路資訊發給所有人。
 *
 * 位址一律在執行時決定：使用者在電腦上看到三位數連線碼，在手機上輸入，
 * app 把它套進常見網段一起競速（見 src/host.ts）。
 */

import { defineConfig } from 'vite'
import { readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

// 版本從 app.json 讀，不要另外維護一份——兩邊會漂掉，
// 而診斷時「使用者跑的是哪一版」是第一個要確認的事實。
const appVersion = JSON.parse(readFileSync(new URL('./app.json', import.meta.url), 'utf8')).version

/**
 * public/ 裡只給開發探針用的檔案（audio-probe 的測試錄音 865 KB），
 * vite 會原封複製進 dist，接著就被 evenhub pack 打進上架包。建置完刪掉。
 */
const DEV_ONLY = ['demo.json', 'demo.m4a']

export default defineConfig({
  plugins: [(() => {
    let outDir = ''
    return {
      name: 'strip-dev-only',
      apply: 'build' as const,
      configResolved(c: { root: string; build: { outDir: string } }) {
        outDir = resolve(c.root, c.build.outDir)
      },
      closeBundle() {
        for (const f of DEV_ONLY) rmSync(resolve(outDir, f), { force: true })
      },
    }
  })()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
})
