# 在 VS Code 開啟專利研判室

1. 在 VS Code 開啟整個 `patent-review` 資料夾，不要只開 `public`。
2. 按 F5；若顯示選單，選「啟動專利研判室」。
3. 網站啟動後會開啟瀏覽器，網址為 http://127.0.0.1:8787/ 。

這台電腦已設定使用 Codex 附帶的 Node.js，不必輸入完整指令。

按 Shift+F5 停止由 F5 啟動的網站。修改後端後，停止再按 F5 重新啟動；修改前端後儲存並重新整理瀏覽器即可。

如果提示連接埠 8787 已被使用，代表已有程式占用該連接埠。若是原本在終端機執行的專利網站，先回到該終端機按 Ctrl+C，再按 F5。不要同時啟動兩份。

分析僅使用本機 Qwen。請先開啟 Ollama，確認已安裝 qwen3:4b-instruct；不需要 API 金鑰。

此啟動設定使用這台電腦的 Codex Node.js 路徑。搬到另一台電腦且已安裝 Node.js 時，可將 `.vscode/launch.json` 的 `runtimeExecutable` 改成 `node`。

