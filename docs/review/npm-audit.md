# npm audit（2026-11-04）

## agent/

`npm audit`：**0 vulnerabilities**（修正前後都是 0）。

## glasses/

### 修正前（4 high，全部是 devDependencies）

`npm audit --omit=dev`：0。也就是說，**打包進 app 的程式碼不受影響**，風險只存在開發機上（vite dev server、evenhub-cli）。

| 套件 | 受影響版本 | 嚴重度 | 公告 |
|---|---|---|---|
| js-yaml | 4.0.0 - 4.3.1 | high | [GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh) js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources |
| source-map-js | 1.0.0 - 1.2.1 | high | [GHSA-68fv-2mgg-jv7q](https://github.com/advisories/GHSA-68fv-2mgg-jv7q) source-map-js allows event-loop denial of service through indexed source-map section offsets |
| vite | 8.2.0 - 8.2.2 | moderate | [GHSA-698v-4r3x-3vcv](https://github.com/advisories/GHSA-698v-4r3x-3vcv) launch-editor: escapeCmdArgs() omits % escaping on Windows |
| vite | 8.2.0 - 8.2.2 | moderate | [GHSA-r825-w8mm-5pxw](https://github.com/advisories/GHSA-r825-w8mm-5pxw) launch-editor: Editor CLI flag misinterpretation causing arbitrary command execution for some editors |
| vite | 8.2.0 - 8.2.2 | high | [GHSA-587h-7wmj-h5pm](https://github.com/advisories/GHSA-587h-7wmj-h5pm) launch-editor: `fs.existsSync()` existence check can be bypassed on Windows |
| vite | 8.2.0 - 8.2.2 | low | [GHSA-9jrq-w75r-8gcw](https://github.com/advisories/GHSA-9jrq-w75r-8gcw) Vite: Cross origin script execution through Vite custom middleware |
| vite | 8.2.0 - 8.2.2 | moderate | [GHSA-rq7h-c2jc-7f22](https://github.com/advisories/GHSA-rq7h-c2jc-7f22) Vite: Files outside `server.fs.allow` could be served when project paths match system paths on non-Windows machine |
| vite | 8.2.0 - 8.2.2 | moderate | [GHSA-vfpm-58rq-9qcg](https://github.com/advisories/GHSA-vfpm-58rq-9qcg) Vite: First 4 bytes of files outside of `server.fs` setting is exposed by `?vite-wasm-instance` |
| zod | <4.6.6 | high | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) Zod can exhaust memory while validating oversized constrained collections |

依賴路徑：`vite`（直接依賴）→ `postcss` → `source-map-js`；`@evenrealities/evenhub-cli` → `js-yaml`、`zod`。

### 處理

執行 `npm audit fix`，只改了 `package-lock.json`，`package.json` 的版本範圍沒有動，也沒有用 `--force`。

| 套件 | 修正前 | 修正後 |
|---|---|---|
| vite | 8.2.2 | 8.3.5 |
| js-yaml | 4.3.1 | 4.3.2 |
| zod | 4.4.3 | 4.6.7 |
| source-map-js | 1.2.1 | 1.2.2 |

### 修正後

`npm audit`：**0 vulnerabilities**。`npm run build` 與 10 個測試檔全部通過。

vite 從 8.2 升到 8.3 是 minor 版本更新，build 輸出大小幾乎沒變（241.49 → 241.52 kB）。`npm run dev` 搭配模擬器還沒在真機上跑過。
