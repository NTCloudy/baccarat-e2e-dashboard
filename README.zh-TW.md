# 百家樂桌台與單一錢包 QA 自動化測試儀表板

[![E2E tests](https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/workflows/e2e.yml/badge.svg)](https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/workflows/e2e.yml)
[![CI](https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/NTCloudy/baccarat-e2e-dashboard/actions/workflows/ci.yml)
[![Live Dashboard](https://img.shields.io/badge/GitHub%20Pages-Live%20Dashboard-0d5c3a?logo=github)](https://ntcloudy.github.io/baccarat-e2e-dashboard/)

[English](./README.md) | **繁體中文**

這是一個聚焦於 **博奕遊戲（iGaming / Live Casino）與單一錢包（Seamless Wallet）** 的端對端 QA 自動化作品集，使用 **Playwright + TypeScript** 建構。專案內建完整的 **經典 8 副牌百家樂（Punto Banco）桌台與單一錢包伺服器**，自動化驗證涵蓋補牌規則表（Tableau）、莊贏 5% 抽水美分精確度、高併發競態條件（Race Condition）防超扣、Idempotency Key 冪等防重送、關盤狀態機防偷跑，以及 **100,000 局蒙地卡羅（Monte Carlo）RTP 與機率分佈驗證**。

- **線上 QA 監控儀表板（皇家賭場 VIP 視覺）**：[https://ntcloudy.github.io/baccarat-e2e-dashboard/](https://ntcloudy.github.io/baccarat-e2e-dashboard/)
- **被測線上百家樂賭桌網站（可直接下注試玩與切換 Bug 模式）**：[https://ntcloudy.github.io/baccarat-e2e-dashboard/table/](https://ntcloudy.github.io/baccarat-e2e-dashboard/table/)
- **博奕缺陷偵測報告（`with-bugs` 模式）**：[https://ntcloudy.github.io/baccarat-e2e-dashboard/#/bugs](https://ntcloudy.github.io/baccarat-e2e-dashboard/#/bugs)
- **互動式測試控制台（直接勾選案例並觸發雲端執行）**：[https://ntcloudy.github.io/baccarat-e2e-dashboard/#/console](https://ntcloudy.github.io/baccarat-e2e-dashboard/#/console)

> **QA 自動化測試雙作品集導覽**：
> - 🎰 **作品集二（本專案 — 博奕百家樂桌台、單一錢包高併發與 10 萬局 RTP 驗證）**：[`NTCloudy/baccarat-e2e-dashboard`](https://github.com/NTCloudy/baccarat-e2e-dashboard) · [皇家賭場 QA 儀表板](https://ntcloudy.github.io/baccarat-e2e-dashboard/)
> - 🛒 **作品集一（電商購物網站端對端 E2E 與 94 項已知問題對照）**：[`NTCloudy/playwright-e2e-dashboard`](https://github.com/NTCloudy/playwright-e2e-dashboard) · [電商測試結果網站](https://ntcloudy.github.io/playwright-e2e-dashboard/)

---

## 為什麼選擇這個主題？（五大博奕 QA 核心驗證支柱）

在線上娛樂城與博奕平台中，只測 UI 表面流程遠遠不夠——只要莊家 5% 抽水算錯 $0.25、補牌規則漏掉一個條件、或是高併發下注沒加互斥鎖導致餘額扣成負數，都會造成嚴重的帳務與合規風險。本測試套件完整覆蓋博奕 QA 最關鍵的五大面向：

1. **Punto Banco 國際標準補牌規則表（`TC01`–`TC06`）**
   透過決定性牌靴注入（Deterministic Shoe Injection）1:1 驗證所有補牌分支：例牌 8 / 9 點即定勝負不補牌（`TC01`）、閒家 `0–5` 補牌與 `6–7` 停牌邊界（`TC02`）、莊家 `0–2` 必補（`TC03`）、**莊家 `3` 點遇閒家第三張 `8` 停牌（最常寫錯的邊界）**（`TC04`）、莊家 `4` / `5` 點條件補牌區間（`TC05`）、以及莊家 `6` 點僅遇 `6–7` 補牌與 `7` 點必停（`TC06`）。
2. **賠率結算與 5% 莊家抽水美分精確度（`TC07`–`TC11`）**
   所有帳務以美分整數（`1 USD = 100 cents`）運算，杜絕 IEEE-754 浮點數誤差：
   - 閒贏 `1:1` 派彩與輸方注金沒收（`TC07`）
   - 莊贏 `1:0.95`（5% 抽水）非整除金額測試（下注 `$35` → 淨贏 `$33.25`、總派彩 `$68.25`，嚴防無條件捨去吃掉玩家 `$0.25`）（`TC08`）
   - 和局 `1:8` 派彩並強制 **退還（Push）莊、閒主注本金**（`TC09`）
   - 閒對／莊對 `1:11` 邊注（涵蓋同點數不同花色如 `♠K` + `♥K`）（`TC10`）
   - 單局多注區複合結算與帳變總和核對（`TC11`）
3. **單一錢包（Seamless Wallet）高併發、冪等性與狀態機防護（`TC12`–`TC16`）**
   - 單一錢包每局 `DEBIT`（扣款）與 `CREDIT`（派彩）帳變流水與前後餘額不變量稽核（`TC12`）
   - 桌台限紅（`$10`–`$5,000`）與餘額不足攔截（`TC13`）
   - **高併發競態條件防護（`TC14`）**：錢包僅剩 `$200` 時，以 `Promise.all` 同時發送 `N` 筆 `$200` 梭哈請求，驗證 Session 互斥鎖（`withLock`）確保僅 1 筆成功、絕不產生負餘額
   - **網路重試冪等防重送（`TC15`）**：攜帶相同 `idempotencyKey` 連續重送 3 次下注請求，驗證錢包只扣款 1 次並回傳冪等快取結果
   - **關盤後防偷下注（`TC16`）**：倒數結束進入 `BETTING_CLOSED` 後直接打 `POST /api/bets`，驗證伺服器拒絕塞單（`409 BETTING_CLOSED`）
4. **賭桌 UI 互動、珠盤路（Bead Road）與 8 副牌靴切牌（`TC17`–`TC19`）**
   - 籌碼選擇（`$10`、`$25`、`$100`、`$500`）、多注區疊加與「清除注單」退回餘額（`TC17`）
   - **珠盤路（Bead Road）** 6 列直排路單推進、例牌金圈（`N`）與莊閒對子紅藍圓點標記（`TC18`）
   - 8 副牌靴（416 張）發牌計數、銷牌（Burn Card）與低於切牌線（Cut Card）自動重新洗牌（`TC19`）
5. **100,000 局蒙地卡羅 RTP 與機率分佈統計驗證（`TC20`）**
   連續模擬 100,000 局完整 8 副牌靴發牌（並將統計表直接內嵌於每次執行的儀表板報告頁），驗證各注區實測命中率與實測玩家回報率（RTP）收斂於理論值 `±0.50%` 內：
   - **莊家（Banker）理論 RTP**：`98.94%`（賭場優勢 `1.06%`）
   - **閒家（Player）理論 RTP**：`98.76%`（賭場優勢 `1.24%`）
   - **和局（Tie）理論 RTP**：`85.64%`（賭場優勢 `14.36%`）
   - **閒對／莊對（Pair）理論 RTP**：`89.64%`（賭場優勢 `10.36%`）

---

## 故障注入模式（`with-bugs`）與 8 個預埋博奕缺陷

內建伺服器支援透過 `TARGET` 切換兩種引擎模式：
- `TARGET=production`：標準合規引擎，**20 / 20** 條測試案例全數通過（`100%`）。
- `TARGET=with-bugs`：植入 **8 個線上博奕最常見的高風險缺陷**。不改任何測試程式碼直接執行，可 **100% 攔截全部 8 個缺陷** 並自動比對 [`config/known-bugs.json`](./config/known-bugs.json)：

| 編號 | 嚴重度 | 偵測案例 | 植入之博奕缺陷說明 | Issue 與證據截圖 |
| :--- | :---: | :---: | :--- | :---: |
| **#1** | 高 | `TC04` | **補牌規則錯誤**：莊家起手 `3` 點且閒家第三張牌為 `8` 時，莊家未停牌而誤補第三張牌 | [Issue #1](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/1) · [截圖](./docs/bugs/bug-1.png) |
| **#2** | 高 | `TC09` | **和局結算錯誤**：開出和局（Tie）時雖派發和局彩金，卻未退還（Push）莊、閒主注本金，直接當輸局沒收 | [Issue #2](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/2) · [截圖](./docs/bugs/bug-2.png) |
| **#3** | 高 | `TC08` | **莊贏 5% 抽水精度截斷**：`1:0.95` 派彩使用 `Math.floor` 無條件捨去小數點，下注 `$35` 莊贏少發 `$0.25`（僅退 `$68.00` 而非 `$68.25`） | [Issue #3](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/3) · [截圖](./docs/bugs/bug-3.png) |
| **#4** | 中 | `TC10` | **對子邊注花色誤判**：首兩張同點數但不同花色（如 `♠K` + `♥K`）時漏判對子未予派彩 | [Issue #4](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/4) · [截圖](./docs/bugs/bug-4.png) |
| **#5** | 高 | `TC14` | **高併發錢包競態漏洞**：同時發送 5 筆 `$200` 梭哈請求時未加互斥鎖，5 筆全部扣款成功導致餘額變成 `-$800.00` | [Issue #5](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/5) · [截圖](./docs/bugs/bug-5.png) |
| **#6** | 高 | `TC15` | **冪等性防重送失效**：網路重試送出相同 `idempotencyKey` 的注單時未去重，導致重複扣款 3 次 | [Issue #6](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/6) · [截圖](./docs/bugs/bug-6.png) |
| **#7** | 高 | `TC16` | **關盤後遲到注單闖關**：桌台已進入 `BETTING_CLOSED`，直接呼叫 `POST /api/bets` 仍可成功塞單 | [Issue #7](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/7) · [截圖](./docs/bugs/bug-7.png) |
| **#8** | 高 | `TC20` | **牌靴發牌權重偏差**：每 8 局強制發給閒家天牌 9，導致 100,000 局實測閒家 RTP 飆破 `110%` | [Issue #8](https://github.com/NTCloudy/baccarat-e2e-dashboard/issues/8) · [截圖](./docs/bugs/bug-8.png) |

---

## 測試案例總覽（`TC01`–`TC20`）

| 編號 | 模組 | 測試案例名稱 | 可調整之測試資料（`config/cases.json`） |
| :---: | :---: | :--- | :--- |
| `TC01` | 補牌規則 | 例牌（Natural 8 / 9）即定勝負不補牌 | — |
| `TC02` | 補牌規則 | 閒家 `0–5` 補牌、`6–7` 停牌與莊家應對規則 | — |
| `TC03` | 補牌規則 | 莊家起手 `0–2` 點無條件補第三張牌 | — |
| `TC04` | 補牌規則 | 莊家 `3` 點對閒家第三張 `8` 停牌、對其他牌補牌 | — |
| `TC05` | 補牌規則 | 莊家 `4` 點（遇 `2–7` 補）與 `5` 點（遇 `4–7` 補）邊界 | — |
| `TC06` | 補牌規則 | 莊家 `6` 點（僅遇 `6–7` 補）與莊家 `7` 點停牌 | — |
| `TC07` | 派彩與抽水 | 閒贏 `1:1` 派彩與莊注扣款結算 | `amount`（預設 `$50`） |
| `TC08` | 派彩與抽水 | 莊贏 `1:0.95`（5% 抽水）美分精確度結算 | `amount`（預設 `$35`） |
| `TC09` | 派彩與抽水 | 和局 `1:8` 派彩且退還（Push）莊、閒主注本金 | `tieBet`（`$20`）、`mainBet`（`$50`） |
| `TC10` | 派彩與抽水 | 閒對／莊對 `1:11` 邊注派彩（含不同花色對子） | `amount`（預設 `$20`） |
| `TC11` | 派彩與抽水 | 多注區複合下注單局結算與總帳變核對 | — |
| `TC12` | 單一錢包與併發 | 單一錢包扣款與派彩帳變明細（`DEBIT` / `CREDIT`） | — |
| `TC13` | 單一錢包與併發 | 桌台最低／最高限紅（`$10`–`$5,000`）與餘額不足攔截 | — |
| `TC14` | 單一錢包與併發 | 高併發同時梭哈防超額扣款（Race Condition 防護） | `concurrency`（預設 `5`） |
| `TC15` | 單一錢包與併發 | 注單 `idempotencyKey` 冪等防重複扣款 | `amount`（預設 `$50`） |
| `TC16` | 單一錢包與併發 | 停止下注（`BETTING_CLOSED`）後 API 拒絕遲到注單 | — |
| `TC17` | 桌台與 10 萬局 RTP | 桌台籌碼切換、多注區點擊疊加與清除注單 | — |
| `TC18` | 桌台與 10 萬局 RTP | 珠盤路（Bead Road）歷史路單、例牌與對子標記 | — |
| `TC19` | 桌台與 10 萬局 RTP | 8 副牌靴剩餘張數遞減與切牌線（Cut Card）自動洗牌 | — |
| `TC20` | 桌台與 10 萬局 RTP | 100,000 局蒙地卡羅模擬驗證各注區機率與 RTP | `rounds`（預設 `100,000`） |

---

## 本機快速執行

```bash
# 1. 安裝相依套件與瀏覽器
npm ci
npx playwright install chromium

# 2. 執行標準引擎 E2E 測試（20 條全數通過）
npm test

# 3. 執行故障注入模式並驗證 8 個博奕缺陷全數被攔截（Verdict: GREEN）
TARGET=with-bugs ROUNDS=1 node scripts/run-rounds.mjs
node scripts/aggregate.mjs
node scripts/verdict.mjs

# 4. 啟動百家樂桌台伺服器（瀏覽器打開 http://127.0.0.1:4100 即可手動試玩）
node app/server.mjs

# 5. 執行型別檢查、ESLint、設定檢查與 48 項儀表板測試
npm run typecheck
npm run lint
npm run check:config
npm run test:dashboard
```
