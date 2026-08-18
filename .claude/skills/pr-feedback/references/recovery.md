# 失敗處理 playbook

出事時才載入。共通原則三條：

1. **只還原出事那個單元動過的檔**——依據是 ledger `units[key].touchedFiles`（**不是**鎖 `meta.json` 的那份，那是整輪累積的，用它會把同一輪其他單元已成功的修改一起抹掉）。`git checkout -- .` 更不行，會連帶抹掉並行 session 的東西
2. **失敗要落進 ledger 與草案，不要靜默吞掉**——使用者回來時要看得出哪一則卡住、卡在哪
3. **每一條路徑最後都要釋鎖**（`rm -rf .claude/tmp/pr-feedback.lock`）。**唯一例外：本輪沒有成功 `mkdir` 取得鎖時，絕對不可釋鎖**——那把鎖是別人的

## eslint／typelint 紅燈

**先確認紅燈是自己造成的——但 eslint 與 typelint 標準不同：**

- **eslint** 紅燈檔案不在該單元的 `touchedFiles` 內 → 既存 lint 債，**不修也不還原**，印一行告知使用者後當通過繼續
- **typelint 紅一律當自己造成**（型別錯誤跨檔傳染，紅的那個檔未必是你改的那個），照下方還原流程走

紅燈確實在 `touchedFiles` 內 → **只修該單元動過的檔**：

```sh
npx eslint --fix <該單元的 touchedFiles 逐一列出>
npm run eslint && npm run typelint
```

> **絕不 `eslint . --fix`。** `.` 是全 repo，而工作區在開工時是乾淨的（preflight #3 保證）——那一跑產生的所有改動都會被算成本輪新增、一起 commit + push，且直接打破「≤3 檔、≤30 行」預算。無人看管下沒人會發現。

**紅燈來源是 `scripts/visual-hierarchy-check.mjs` 時直接跳過自修**（`npm run eslint` = `eslint . && node scripts/visual-hierarchy-check.mjs`，`--fix` 修不了後半），直接降 B。

最多自修 1 輪。仍紅 →

```sh
# 只還原 touchedFiles，逐一列出，不要用 . 或萬用字元
git restore --source=HEAD --worktree -- <該單元的 touchedFiles>
```

- `attempts += 1`
- **status 依 `attempts` 分兩種，不要混用**：
  - `attempts < 2` → 標 **`fix-failed`**。這一輪**不寫 pending 草案**（還要再試一次，先寫草案會讓使用者看到一則其實還沒定案的婉拒）。下一輪重入再試
  - `attempts >= 2` → 標 **`fix-failed-final`**，**這時才**寫 B 類草案，**老實寫**：「試著照建議修了兩次，但 `npm run typelint` 報 `<錯誤原文>`，已還原改動。」之後永不重入
- **不要標成 `declined-pending-reply`**——那會命中 SKILL.md 的「只降不升」，讓這個單元永遠回不到 A
- 本輪不 commit

## 凍結區 hook 擋下（`.claude/hooks/frozen-paths-guard.mjs`）

Edit/Write 被 `exit 2` 擋 → 立即改判 B，草案引 `.claude/rules/frozen-paths.md` 說明這要走 spec 變更迭代流。

> **絕不寫 `.claude/tmp/frozen-allow.json` 繞過。** 那個豁免通道是給人類在知情下用的，不是給自動迴圈用的。`.claude/ops/judgment-rubrics.md` §3 明文禁止。

## server 安全 hook 報警（`.claude/hooks/server-security-guard.mjs`）

PostToolUse 是**事後**攔截，改動已經寫進檔案了，所以要先還原：

```sh
git restore --source=HEAD --worktree -- <該檔>
```

然後改判 B，草案內附 hook 的原始警告。安全類承襲 `/sdd-review` 的「只報不改」政策。

## pre-push gate 紅燈

`.husky/pre-push` 跑 Docker production build + Playwright（fallback 本機 dev server）。紅燈時：

- commit **留在本地、不 push**
- **絕不 `--no-verify`**（CLAUDE.md 政策禁止）
- ledger 頂層 `gateRedRounds += 1`；該單元標 `push-blocked`
- 終端印一行

**`gateRedRounds` 的退出條件（沒有它，loop 會永久空轉）**：

| 值 | 行為 |
|----|------|
| 1 | 下一輪 preflight #5 偵測到未 push commit → 只補 push，重試一次 |
| **>= 2** | **不再重試 push**。把該 commit 的單元一併改判 B（草案老實寫「已修但 gate 紅，commit 留在本地 `<sha>`，需人工判斷」），終端印醒目警告。之後每輪 preflight #5 只印一行「有未 push commit 待人工處理」就結束，**不再跑 gate** |

> 沒有這個上限的話：R1 修完 → gate 紅 → R2 只補 push → gate 依然紅（code 一個字沒變）→ R3、R4… 每 15 分鐘白燒一次 20 分鐘的 Docker build，而且再也不會處理任何新留言。

`gateRedRounds` 由**人工**歸零（使用者修好 gate 後刪掉該欄位或設 0）；skill 自己不歸零——它沒有辦法判斷紅燈是不是真的解決了。

判斷紅燈屬於哪一類（沿用 `.husky/pre-push` 註解的分工）：`specs/` 紅 = 破壞 Business Invariant（**優先懷疑是自動修改錯了**）；`vibe/` 紅 = vibe 層行為變了。兩者都是停下來等人，不要自行改 spec。

## push 被拒（non-fast-forward）

```sh
git pull --ff-only
```

成功 → 重試 push 一次。失敗 → 跳過本輪、印一行請使用者處理。

> **絕不 `--force`／`--force-with-lease`／`rebase`。** 遠端分支可能有並行 session 或協作者的 commit，這是不可逆的對外動作，`.claude/ops/judgment-rubrics.md` §3 必停。

## gh 429／網路失敗／分頁未取完

**整輪跳過，`units` 一個字都不要寫。** （`loop-state.json` 的 `consecutiveSkips`／`lastSkipReason` 仍要更新——那是 skip 計數，不是留言處理記錄。）

把空結果或部分結果當成「沒有新留言」，會讓 ledger 把未讀留言誤記成已處理——那些留言之後永遠不會被重新掃到（要 fingerprint 對不上才會重入，而根本沒抓到就沒有 fingerprint）。

四路抓取只要有**任何一路**失敗，或任一集合 `hasNextPage` 為 true 而未取完，就整輪放棄，不要只用抓到的那幾路做部分處理。

## ledger JSON 損壞

不猜、不重建：

```sh
mv .claude/tmp/pr-feedback/state-<PR>.json \
   .claude/tmp/pr-feedback/corrupt-$(date +%s).json
```

本輪跳過並印警告。下一輪 ledger 不存在 → 觸發 SKILL.md 步驟 4 的「>5 則自動降級 dry-run」保護（**該輪要寫 ledger 骨架**，否則會永久降級空轉）。

**不要試圖從 pending 檔反推 ledger**：pending 只含 B 類，A 類的已修記錄不在裡面，反推出來的 ledger 會讓所有 A 類重修一遍。

## 鎖殘留（>45 分鐘）

先讀 `.claude/tmp/pr-feedback.lock/meta.json` 的 `startedAt` 確認真的超過 45 分鐘，再走**接管競賽**：

```sh
# 1) 接管權本身用 mkdir 搶（POSIX 原子），只有一個 tick 進得了臨界區
mkdir .claude/tmp/pr-feedback.takeover 2>/dev/null || { echo "已被別人接管"; exit 0; }
date -u +%Y-%m-%dT%H:%M:%SZ > .claude/tmp/pr-feedback.takeover/startedAt

# 2) 進到這裡代表接管權是我的。保留舊鎖證據（帶時間戳，不覆蓋前一次）
mv .claude/tmp/pr-feedback.lock ".claude/tmp/pr-feedback.stale-$(date +%s)"

# 3) 建立自己的鎖（一樣要 guard——mv 到 mkdir 之間有窗口，別人可能剛好在那時取到鎖）
mkdir .claude/tmp/pr-feedback.lock || { rm -rf .claude/tmp/pr-feedback.takeover; echo "鎖已被他人取得"; exit 0; }

# 4) 最後才放掉接管權
rm -rf .claude/tmp/pr-feedback.takeover
```

> **不能靠裸 `mv` 的回傳值判斷輸贏。** POSIX `mv dirA dirB` 在 `dirB` 是既存目錄時是把 dirA **搬進去**（變成 `dirB/dirA`）並回 **exit 0**——它不會失敗，`|| exit 0` 那道 guard 是死碼。**兩個 tick 會雙雙認為自己拿到鎖。**
>
> 也**不要**直接 `rm -rf` 舊鎖再 `mkdir`：兩個 tick 同時判定 stale 時會同時刪、同時建，一樣雙雙成功。
>
> 更**不要**只寫「依 stage 接管」而不換鎖——`mkdir` 對已存在的目錄必定失敗，鎖會永遠移除不掉，loop 死到天荒地老。
>
> 舊鎖搬成**帶時間戳**的名字（不是固定的 `.stale`），否則連續兩次接管會把上一次的 `touchedFiles` 證據覆蓋掉，而那正是下面要使用者去讀的東西。
>
> `takeover` 目錄殘留（接管過程中被中斷）時：接管競賽的 `mkdir` 會一直失敗，**若不處理就永久封死所有後續接管**。處置照它自己的 `startedAt`（步驟 1 取得後立刻寫一個 `meta.json` 進去）：
>
> - **未超過 5 分鐘** → 印一行「接管進行中」後跳過本輪（正常情況：另一個 tick 正在接管，那段流程只有幾個檔案操作，不該超過幾秒）
> - **已超過 5 分鐘** → 印一行警告後 `rm -rf .claude/tmp/pr-feedback.takeover`，本輪跳過；下一輪重新競賽
>
> 5 分鐘足夠涵蓋正常接管（純檔案操作），又不會像鎖的 45 分鐘那樣把 loop 停很久。

接管後依舊鎖的 `stage` 決定後續（舊鎖內容在 `.claude/tmp/pr-feedback.stale-<ts>/` 可讀）：

| stage | 接管動作 |
|-------|---------|
| `preflight` | 正常跑 |
| `fixing`／`verifying` | 工作區可能有半套改動 → preflight #3（工作區髒）會擋下 → 跳過並提示使用者檢查 `.claude/tmp/pr-feedback.stale-<ts>/meta.json` 的 `touchedFiles` |
| `pushing` | 先跑 preflight #5（有未 push 的 commit → 只補 push） |
| `writing-state` | ledger 可能寫到一半 → 若 JSON 解析失敗，走「ledger 損壞」流程 |
| `send-waiting` | 上一次 `--send` 沒收尾（使用者中途離開）→ 正常跑 round；pending 檔仍在，草案不會遺失 |

接管前印一行警告，讓使用者知道有一輪異常結束。

## 找不到 PR（preflight #7 不過）

不是錯誤，是正常狀態（分支還沒開 PR、PR 已 merge／closed）。印一行跳過即可，不要嘗試開 PR——那是 `/pr` 的職責。

此時**沒有 PR 編號可用**，skip 計數要寫 `.claude/tmp/pr-feedback/loop-state.json`，不是 `state-<PR>.json`。

PR 已 merged → 建議使用者停掉 loop（`CronDelete`），並提示 `state-<PR>.json` 可以刪了。
