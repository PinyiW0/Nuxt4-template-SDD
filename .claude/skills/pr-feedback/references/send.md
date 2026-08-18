# `--send` 模式

只有使用者手動跑 `/pr-feedback --send` 時載入。**round 模式永遠不需要讀這一份。**

唯一會阻塞、唯一對外發言的路徑。

**照「鎖協定」取鎖**，`meta.json` 的 `stage` 寫 `send-waiting`。取不到鎖 → 印一行請使用者稍後再試，**不釋鎖**（那是 round 的鎖）。**不論成功、失敗、使用者中途放棄，結束前都必須釋鎖**。

告知使用者時要講**準確的話**：「已取得 pr-feedback 鎖，round 會暫停最多 45 分鐘（鎖的 TTL）。超過的話 round 會接管，屆時請重跑 `--send`。」

> 不要說成「round 會暫停」就好——`--send` 是三個模式裡唯一會停下等人、也唯一可能超過 45 分鐘的那個。使用者去開個會回來，round 早就接管、改了 code、push 了。
>
> **每次 POST 之前重新確認鎖還是自己的**（`.claude/tmp/pr-feedback.lock/meta.json` 的 `stage` 仍是 `send-waiting` 且 `startedAt` 是本次寫的）。不是 → 立刻停止送出，告訴使用者鎖已被接管、請重跑，**不要**繼續寫 ledger 或 pending（那會與接管那一輪的寫入互相覆蓋）。

1. 讀 pending 檔，依「pending 檔格式」的解析規則取出各則（fence 外的錨點才算數，且 `id` 要回查得到 ledger）
2. **逐則**列出：原留言摘要／我的處置（已修 or 婉拒）／草案全文／目標 API
3. **停下來等使用者**：全送／挑選／改文字後送／刪掉不送
4. 送出前再驗一次：PR 仍 OPEN、thread 仍存在且未被別人 resolve
5. 把**該則**草案單獨寫進 `.claude/tmp/pr-feedback/send-<key>.md`，body 只指向這個單則檔——**絕不指向 pending 全檔**（那會把所有草案當成一則回覆送出去）
6. 依來源選送法：

| 來源 | 送法 |
|------|------|
| inline thread | `gh api --method POST repos/<o>/<r>/pulls/<N>/comments/<anchorCommentDbId>/replies -F 'body=@.claude/tmp/pr-feedback/send-<key>.md'` |
| review 總結／頂層留言 | `gh pr comment <N> --body-file .claude/tmp/pr-feedback/send-<key>.md`，內文開頭引用原留言連結 |

**`gh pr comment` 只能發頂層留言，回不了 inline thread**——inline 的一定要走 `/replies` 端點。body 一律走 `-F 'body=@檔案'` 或 `--body-file`，不要用 `--body "字串"`（跳脫地獄，repo 既有慣例同此）。

7. 成功 → ledger 標 `sent` + `sentAt` + `replyUrl`，從 pending 檔移除該則，刪掉 `send-<key>.md`。
   **並立刻重抓該單元、重算 `fingerprint` 寫回 ledger**——你剛送出的回覆本身就是該 thread 的一則新 comment，不把它納入基準的話，下一輪 fingerprint 會變 → 單元重入 → 又寫一則草案 → 送出 → 再變……**草案無限回聲**。
8. 失敗（thread 消失／權限不足）→ 留在 pending 並標原因，**不重試轟炸**
9. **是否 resolve thread 另外問一次，預設「不 resolve」**——那會改變其他 reviewer 的視野

