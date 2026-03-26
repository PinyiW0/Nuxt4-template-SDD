---
name: feature-to-api
description: 從 .feature 檔建立 API 合約型別、Mock 資料和 API 端點。Use when 需要從 .dsl.feature 規格檔建立型別定義、Mock API 或更新 API 合約。
argument-hint: "[phase]"
context: fork
agent: general-purpose
---

# Feature to API 工作流程

從 `.feature` 規格檔建立 API 合約基礎設施：型別定義、Mock 資料、API 端點。

## 定位

API 合約是整個 TDD 流程的**基礎建設**，spec 生成和 UI 實作都依賴它：

```
.feature + .flow.md（雙輸入）
    ↓
/feature-to-api → types + mock data（資料值對齊 flow）+ API endpoints
    ↓                     ↓
/test e2e spec       /feature-to-ui
（生成測試合約）      （實作 UI）
```

> **前置條件**：`.flow.md` 必須已放入 `spec/e2e-flows/`（外部產出）。

## 使用方式

```bash
/feature-to-api              # 從 Phase 0 開始（全量或 Sync）
/feature-to-api 0            # Phase 0: 準備工作（分析 feature、產出型別 + route-map）
/feature-to-api 1            # Phase 1: Mock API（mock data + API 端點）
```

## 全量模式 vs Sync 模式

自動偵測當前狀態，決定執行模式：

| 條件 | 模式 | 說明 |
|------|------|------|
| `spec/report/route-map.yaml` **不存在** | **全量模式** | 從零建立（首次使用） |
| `spec/report/route-map.yaml` **存在** | **Sync 模式** | 增量偵測 feature 變更，只更新受影響的部分 |

### Sync 模式運作方式

1. **Phase 0** 比對新舊 `.dsl.feature` 的 `content_hash`，產出 `spec/report/sync-report.md`（變更報告）
2. **Phase 1** 讀取此報告，只新增/修改受影響的型別和端點

---

## 現有 Feature 檔案

!`ls -1 spec/gherkin-feature/*.dsl.feature 2>/dev/null || echo "(無)"`

---

## Phase 概覽

| Phase | 名稱 | 輸出 | 必讀規範 |
|-------|------|------|----------|
| 0 | 準備工作 | 功能清單、路由規劃、**route-map.yaml**、**app/types/api/** | [phase-0-prep.md](scripts/phase-0-prep.md) |
| 1 | Mock API | server/mock/, server/api/ | [phase-1-mock-api.md](scripts/phase-1-mock-api.md) + [rules.md](references/rules.md) |

---

## 必讀文件

### 核心規範

- **[rules.md](references/rules.md)** - Server API 類型規範、Mock API 回傳慣例
- **[scripts/](scripts/)** - 各 Phase 的執行步驟與模板

### 專案設定

- `spec/ui-config/ui-config-pm.yaml`（PM 設定，Phase 0 同步用）

---

## 自動執行規則

- 執行 `/feature-to-api`（無參數或參數為 `0`）時，**直接開始 Phase 0，不要詢問使用者任何問題**
- **前置檢查**：確認 `spec/e2e-flows/*.flow.md` 存在，若不存在則提示「請先將 `.flow.md` 放入 `spec/e2e-flows/`」
- Phase 0 開始前，先讀取 `ui-config-pm.yaml`，按照 `phase-0-prep.md` 的「PM 設定同步邏輯」將資訊同步填入 `ui-config.yaml`
- 同步完成後直接執行 Phase 0 的步驟，不需額外確認

---

## 注意事項

- **每個 Phase 完成後，告知用戶下一步應執行的指令**
- **Phase 0 完成後提示：「下一步：`/feature-to-api 1`」**
- **Phase 1 完成後提示：「下一步：`/test e2e`（偵測 E2E 狀態並產出執行計畫）」**
- Phase 0 建立 `app/types/api/` 合約型別，Phase 1 驗證並建立 mock data + API
- 禁止自行決定設定，所有設定從 `ui-config.yaml` 讀取
