# language: zh-TW
# 外部工具產出 — do not edit by hand
# 獨立格式範例，勿交叉衍生；OpenAPI 模式以 api-spec 為真相、feature 模式以 .feature 為真相
# 本檔為模板 dogfood 範例，非本專案業務規格——衍生新專案時應置換為真規格或移除

Feature: 帳號列表
  顯示所有觀測員帳號清單（權限管理頁），排除已刪除帳號

  @happy-path @happy-path
  Rule: 顯示帳號列表
    存在帳號時正確顯示列表

    Scenario: 顯示帳號列表
      兩個帳號存在，顯示兩筆紀錄
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": "北站",
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      And the AccountCreated event has occurred on stream "acc-002":
        """
        {
          "name": "李文彥",
          "remark": null,
          "username": "observer_li",
          "hashedPassword": "<<hashed>>"
        }
        """
      When the AccountList view is queried
      Then the view returns:
        """
        [
          {
            "name": "王思婷",
            "remark": "北站",
            "username": "observer_wang",
            "accountId": "acc-001"
          },
          {
            "name": "李文彥",
            "remark": null,
            "username": "observer_li",
            "accountId": "acc-002"
          }
        ]
        """

  @derivation @exclude-deleted-accounts
  Rule: 排除已刪除帳號
    已刪除帳號不顯示在列表中

    Scenario: 排除已刪除帳號
      帳號已刪除，列表中不顯示
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": null,
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      And the AccountCreated event has occurred on stream "acc-002":
        """
        {
          "name": "李文彥",
          "remark": null,
          "username": "observer_li",
          "hashedPassword": "<<hashed>>"
        }
        """
      And the AccountDeleted event has occurred on stream "acc-002":
        """
        {}
        """
      When the AccountList view is queried
      Then the view returns:
        """
        [
          {
            "name": "王思婷",
            "remark": null,
            "username": "observer_wang",
            "accountId": "acc-001"
          }
        ]
        """

    Scenario: 空列表
      尚無任何帳號時回傳空列表
      Given no prior events
      When the AccountList view is queried
      Then the view returns an empty list

Feature: 觀測站列表
  顯示觀測站清單，支援觀測點篩選與姓名搜尋，排除已刪除觀測站

  @happy-path @happy-path
  Rule: 顯示觀測站列表
    存在觀測站時正確顯示列表

    Scenario: 顯示觀測站列表
      兩座觀測站存在，顯示兩筆紀錄
      Given the StationCreated event has occurred on stream "station-001":
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      And the StationCreated event has occurred on stream "station-002":
        """
        {
          "latitude": 24.98,
          "siteId": "site-001",
          "longitude": 121.54,
          "stationName": "陽明山南站",
          "mountType": "經緯儀",
          "opticsType": "魚眼"
        }
        """
      When the StationList view is queried
      Then the view returns:
        """
        [
          {
            "latitude": 24.14,
            "siteId": "site-001",
            "longitude": 121.27,
            "stationId": "station-001",
            "stationName": "合歡山北站",
            "mountType": "赤道儀",
            "opticsType": "廣角"
          },
          {
            "latitude": 24.98,
            "siteId": "site-001",
            "longitude": 121.54,
            "stationId": "station-002",
            "stationName": "陽明山南站",
            "mountType": "經緯儀",
            "opticsType": "魚眼"
          }
        ]
        """

  @derivation @exclude-deleted-stations
  Rule: 排除已刪除觀測站
    已刪除觀測站不顯示在列表中

    Scenario: 排除已刪除觀測站
      觀測站已刪除，列表中不顯示
      Given the StationCreated event has occurred on stream "station-001":
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      And the StationCreated event has occurred on stream "station-002":
        """
        {
          "latitude": 24.98,
          "siteId": "site-001",
          "longitude": 121.54,
          "stationName": "陽明山南站",
          "mountType": "經緯儀",
          "opticsType": "魚眼"
        }
        """
      And the StationDeleted event has occurred on stream "station-002":
        """
        {}
        """
      When the StationList view is queried
      Then the view returns:
        """
        [
          {
            "latitude": 24.14,
            "siteId": "site-001",
            "longitude": 121.27,
            "stationId": "station-001",
            "stationName": "合歡山北站",
            "mountType": "赤道儀",
            "opticsType": "廣角"
          }
        ]
        """

    Scenario: 空列表
      尚無任何觀測站時回傳空列表
      Given no prior events
      When the StationList view is queried
      Then the view returns an empty list

Feature: 觀測時段歷史總覽
  歷史總覽：依日期與觀測站分組顯示觀測時段 sessions，含目擊事件數統計

  @happy-path @happy-path
  Rule: 顯示觀測時段歷史
    存在觀測時段時正確顯示歷史總覽

    Scenario: 顯示觀測時段歷史
      一次觀測時段含兩球，正確顯示目擊事件數統計
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 125,
          "showerCode": "ORI",
          "azimuthDegrees": -4.8,
          "entryDegrees": -10.2,
          "zenithDegrees": 25,
          "trueLightMag": 2300,
          "secondaryVideoUrl": "https://example.com/side2.mp4",
          "totalLightMag": 2400,
          "primaryVideoUrl": "https://example.com/front2.mp4",
          "decelVerticalKms": 42,
          "radiantRaDegrees": 180,
          "lightEfficiency": 0.92,
          "decelHorizontalKms": -10,
          "verticalDriftKm": 42,
          "horizontalDriftKm": -10,
          "terminalLocationXKm": -5,
          "terminalLocationZKm": 65
        }
        """
      And the WatchEnded event has occurred on stream "watch-001":
        """
        {}
        """
      When the WatchHistory view is queried
      Then the view returns:
        """
        [
          {
            "status": "ended",
            "stationIds": [
              "station-001"
            ],
            "sightingCount": 2,
            "watchId": "watch-001",
            "watchItem": "英仙座觀測"
          }
        ]
        """

  @derivation @derivation
  Rule: 投影邏輯
    觀測時段歷史投影邏輯，含進行中狀態與空列表

    Scenario: 觀測時段進行中
      觀測時段尚未結束時 status 為 in-progress
      Given the WatchStarted event has occurred on stream "watch-002":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-002":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      When the WatchHistory view is queried
      Then the view returns:
        """
        [
          {
            "status": "in-progress",
            "stationIds": [
              "station-001"
            ],
            "sightingCount": 1,
            "watchId": "watch-002",
            "watchItem": "英仙座觀測"
          }
        ]
        """

    Scenario: 空列表
      尚無觀測時段時回傳空列表
      Given no prior events
      When the WatchHistory view is queried
      Then the view returns an empty list

Feature: 觀測時段目擊事件清單
  顯示單次觀測時段中所有目擊事件紀錄的詳細數據，含收藏與刪除狀態

  @happy-path @happy-path
  Rule: 顯示目擊事件清單
    存在目擊事件紀錄時正確顯示清單

    Scenario: 顯示目擊事件清單
      一球已收藏、一球未收藏，正確顯示收藏狀態
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 125,
          "showerCode": "ORI",
          "azimuthDegrees": -4.8,
          "entryDegrees": -10.2,
          "zenithDegrees": 25,
          "trueLightMag": 2300,
          "secondaryVideoUrl": "https://example.com/side2.mp4",
          "totalLightMag": 2400,
          "primaryVideoUrl": "https://example.com/front2.mp4",
          "decelVerticalKms": 42,
          "radiantRaDegrees": 180,
          "lightEfficiency": 0.92,
          "decelHorizontalKms": -10,
          "verticalDriftKm": 42,
          "horizontalDriftKm": -10,
          "terminalLocationXKm": -5,
          "terminalLocationZKm": 65
        }
        """
      And the SightingFavorited event has occurred on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      When the WatchSightinges view is queried
      Then the view returns:
        """
        [
          {
            "decel": 1.8,
            "speed": 130,
            "sightingId": "sighting-001",
            "stationId": "station-001",
            "radiantAxis": 210,
            "lightPeak": 2200,
            "isDeleted": false,
            "locationX": 0.1,
            "locationY": 0.5,
            "showerCode": "PER",
            "watchId": "watch-001",
            "isFavorited": true,
            "secondaryVideoUrl": "https://example.com/side.mp4",
            "inclinationAngle": -5.2,
            "primaryVideoUrl": "https://example.com/front.mp4",
            "verticalDrift": 38,
            "lightEfficiency": 95,
            "horizontalDrift": -15,
            "effectiveLightMag": 2100
          },
          {
            "decel": 1.9,
            "speed": 125,
            "sightingId": "sighting-002",
            "stationId": "station-001",
            "radiantAxis": 180,
            "lightPeak": 2400,
            "isDeleted": false,
            "locationX": -0.1,
            "locationY": 0.3,
            "showerCode": "GEM",
            "watchId": "watch-001",
            "isFavorited": false,
            "secondaryVideoUrl": "https://example.com/side2.mp4",
            "inclinationAngle": -4.8,
            "primaryVideoUrl": "https://example.com/front2.mp4",
            "verticalDrift": 42,
            "lightEfficiency": 92,
            "horizontalDrift": -10,
            "effectiveLightMag": 2300
          }
        ]
        """

  @derivation @derivation
  Rule: 投影邏輯
    目擊事件清單投影邏輯，含刪除標記與空列表

    Scenario: 已刪除目擊事件標記 isDeleted
      目擊事件被刪除後 isDeleted 為 true
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      And the SightingDeleted event has occurred on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      When the WatchSightinges view is queried
      Then the view returns:
        """
        [
          {
            "decel": 1.8,
            "speed": 130,
            "sightingId": "sighting-001",
            "stationId": "station-001",
            "radiantAxis": 210,
            "lightPeak": 2200,
            "isDeleted": true,
            "locationX": 0.1,
            "locationY": 0.5,
            "showerCode": "PER",
            "watchId": "watch-001",
            "isFavorited": false,
            "secondaryVideoUrl": "https://example.com/side.mp4",
            "inclinationAngle": -5.2,
            "primaryVideoUrl": "https://example.com/front.mp4",
            "verticalDrift": 38,
            "lightEfficiency": 95,
            "horizontalDrift": -15,
            "effectiveLightMag": 2100
          }
        ]
        """

    Scenario: 空列表
      尚無目擊事件紀錄時回傳空列表
      Given no prior events
      When the WatchSightinges view is queried
      Then the view returns an empty list

Feature: 相機狀態列表
  顯示所有相機裝置的 ID、位置與連線狀態

  @happy-path @happy-path
  Rule: 顯示相機狀態
    存在相機裝置時正確顯示狀態列表

    Scenario: 顯示相機狀態
      兩台相機，一台連線、一台斷線
      Given the CameraRegistered event has occurred on stream "camera-001":
        """
        {
          "deviceId": "CAM-A1",
          "position": "天頂方向"
        }
        """
      And the CameraRegistered event has occurred on stream "camera-002":
        """
        {
          "deviceId": "CAM-B1",
          "position": "東側"
        }
        """
      And the CameraStatusUpdated event has occurred on stream "camera-002":
        """
        {
          "connectionStatus": "disconnected"
        }
        """
      When the CameraStatusList view is queried
      Then the view returns:
        """
        [
          {
            "cameraId": "camera-001",
            "deviceId": "CAM-A1",
            "position": "天頂方向",
            "connectionStatus": "connected"
          },
          {
            "cameraId": "camera-002",
            "deviceId": "CAM-B1",
            "position": "東側",
            "connectionStatus": "disconnected"
          }
        ]
        """

  @derivation @derivation
  Rule: 投影邏輯
    相機狀態列表投影邏輯，含空列表與預設連線狀態

    Scenario: 新註冊預設為 connected
      相機註冊後未收到狀態更新，預設連線狀態為 connected
      Given the CameraRegistered event has occurred on stream "camera-001":
        """
        {
          "deviceId": "CAM-A1",
          "position": "天頂方向"
        }
        """
      When the CameraStatusList view is queried
      Then the view returns:
        """
        [
          {
            "cameraId": "camera-001",
            "deviceId": "CAM-A1",
            "position": "天頂方向",
            "connectionStatus": "connected"
          }
        ]
        """

    Scenario: 空列表
      尚無相機裝置時回傳空列表
      Given no prior events
      When the CameraStatusList view is queried
      Then the view returns an empty list

Feature: 建立帳號
  觀測員建立新帳號（姓名、帳號、密碼、備註）

  @happy-path @happy-path
  Rule: 成功建立帳號
    提供有效資料時成功建立新帳號

    Scenario: 成功建立帳號
      新帳號名稱不重複，建立成功並產生 AccountCreated 事件
      Given no prior events
      When Observer sends CreateAccount on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": "北站觀測員",
          "password": "pass1234",
          "username": "observer_wang"
        }
        """
      Then the AccountCreated event is emitted with:
        """
        {
          "name": "王思婷",
          "remark": "北站觀測員",
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """

  @integrity-constraint @username-already-exists
  Rule: 帳號名稱已存在
    同名帳號已存在時拒絕建立

    Scenario: 帳號名稱重複
      帳號 observer_wang 已被使用，拒絕建立
      Given the AccountList view returns:
        """
        {
          "items": [
            {
              "name": "舊觀測員",
              "username": "observer_wang",
              "accountId": "acc-existing"
            }
          ]
        }
        """
      When Observer sends CreateAccount on stream "acc-002":
        """
        {
          "name": "新觀測員",
          "remark": null,
          "password": "pass5678",
          "username": "observer_wang"
        }
        """
      Then the operation fails with: 帳號名稱已存在

Feature: 登入
  觀測員以帳號密碼登入系統

  @happy-path @happy-path
  Rule: 成功登入
    帳號存在且密碼正確時成功登入

    Scenario: 成功登入
      帳號存在且密碼正確，產生 ObserverLoggedIn
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": null,
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      When Anonymous sends Login on stream "acc-001":
        """
        {
          "password": "pass1234",
          "username": "observer_wang"
        }
        """
      Then the ObserverLoggedIn event is emitted with:
        """
        {}
        """

  @not-found @account-not-found
  Rule: 帳號不存在
    帳號不存在時拒絕登入

    Scenario: 帳號不存在
      帳號 stream 無事件，拒絕登入
      Given no prior events
      When Anonymous sends Login on stream "acc-unknown":
        """
        {
          "password": "pass1234",
          "username": "nobody"
        }
        """
      Then the operation fails with: 帳號不存在

  @condition @account-deleted
  Rule: 帳號已刪除
    帳號已被刪除時拒絕登入

    Scenario: 帳號已刪除
      帳號已刪除，拒絕登入
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": null,
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      And the AccountDeleted event has occurred on stream "acc-001":
        """
        {}
        """
      When Anonymous sends Login on stream "acc-001":
        """
        {
          "password": "pass1234",
          "username": "observer_wang"
        }
        """
      Then the operation fails with: 帳號已刪除

Feature: 修改密碼
  觀測員修改帳號密碼

  @happy-path @happy-path
  Rule: 成功修改密碼
    帳號存在且未刪除時成功修改密碼

    Scenario: 成功修改密碼
      帳號存在，產生 AccountPasswordChanged
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": null,
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      When Observer sends ChangePassword on stream "acc-001":
        """
        {
          "newPassword": "newpass5678"
        }
        """
      Then the AccountPasswordChanged event is emitted with:
        """
        {
          "hashedPassword": "<<new-hashed>>"
        }
        """

  @not-found @account-not-found
  Rule: 帳號不存在
    帳號不存在時拒絕修改

    Scenario: 帳號不存在
      帳號 stream 無事件，拒絕修改
      Given no prior events
      When Observer sends ChangePassword on stream "acc-unknown":
        """
        {
          "newPassword": "newpass5678"
        }
        """
      Then the operation fails with: 帳號不存在

  @condition @account-deleted
  Rule: 帳號已刪除
    帳號已被刪除時拒絕修改密碼

    Scenario: 帳號已刪除
      帳號已刪除，拒絕修改密碼
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": null,
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      And the AccountDeleted event has occurred on stream "acc-001":
        """
        {}
        """
      When Observer sends ChangePassword on stream "acc-001":
        """
        {
          "newPassword": "newpass5678"
        }
        """
      Then the operation fails with: 帳號已刪除

Feature: 修改備註
  觀測員修改帳號備註

  @happy-path @happy-path
  Rule: 成功修改備註
    帳號存在且未刪除時成功修改備註

    Scenario: 成功修改備註
      帳號存在，產生 AccountRemarkUpdated
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": null,
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      When Observer sends UpdateRemark on stream "acc-001":
        """
        {
          "remark": "南站觀測員"
        }
        """
      Then the AccountRemarkUpdated event is emitted with:
        """
        {
          "remark": "南站觀測員"
        }
        """

  @not-found @account-not-found
  Rule: 帳號不存在
    帳號不存在時拒絕修改

    Scenario: 帳號不存在
      帳號 stream 無事件，拒絕修改備註
      Given no prior events
      When Observer sends UpdateRemark on stream "acc-unknown":
        """
        {
          "remark": "測試"
        }
        """
      Then the operation fails with: 帳號不存在

  @condition @account-deleted
  Rule: 帳號已刪除
    帳號已被刪除時拒絕修改備註

    Scenario: 帳號已刪除
      帳號已刪除，拒絕修改備註
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": null,
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      And the AccountDeleted event has occurred on stream "acc-001":
        """
        {}
        """
      When Observer sends UpdateRemark on stream "acc-001":
        """
        {
          "remark": "南站觀測員"
        }
        """
      Then the operation fails with: 帳號已刪除

Feature: 刪除帳號
  觀測員刪除帳號

  @happy-path @happy-path
  Rule: 成功刪除帳號
    帳號存在且未刪除時成功刪除

    Scenario: 成功刪除帳號
      帳號存在且未刪除，產生 AccountDeleted
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": null,
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      When Observer sends DeleteAccount on stream "acc-001":
        """
        {}
        """
      Then the AccountDeleted event is emitted with:
        """
        {}
        """

  @not-found @account-not-found
  Rule: 帳號不存在
    帳號不存在時拒絕刪除

    Scenario: 帳號不存在
      帳號 stream 無事件，拒絕刪除
      Given no prior events
      When Observer sends DeleteAccount on stream "acc-unknown":
        """
        {}
        """
      Then the operation fails with: 帳號不存在

  @condition @account-already-deleted
  Rule: 帳號已刪除
    帳號已被刪除時拒絕重複刪除

    Scenario: 帳號已刪除
      帳號已刪除，拒絕重複刪除
      Given the AccountCreated event has occurred on stream "acc-001":
        """
        {
          "name": "王思婷",
          "remark": null,
          "username": "observer_wang",
          "hashedPassword": "<<hashed>>"
        }
        """
      And the AccountDeleted event has occurred on stream "acc-001":
        """
        {}
        """
      When Observer sends DeleteAccount on stream "acc-001":
        """
        {}
        """
      Then the operation fails with: 帳號已刪除

Feature: 建立觀測點
  觀測員建立新觀測點

  @happy-path @happy-path
  Rule: 成功建立觀測點
    提供觀測點名稱時成功建立

    Scenario: 成功建立觀測點
      建立新觀測點，產生 SiteCreated
      Given no prior events
      When Observer sends CreateSite on stream "site-001":
        """
        {
          "siteName": "陽明山觀測點"
        }
        """
      Then the SiteCreated event is emitted with:
        """
        {
          "siteName": "陽明山觀測點"
        }
        """

Feature: 刪除觀測點
  觀測員刪除觀測點

  @happy-path @happy-path
  Rule: 成功刪除觀測點
    觀測點存在且未刪除時成功刪除

    Scenario: 成功刪除觀測點
      觀測點存在，產生 SiteDeleted
      Given the SiteCreated event has occurred on stream "site-001":
        """
        {
          "siteName": "陽明山觀測點"
        }
        """
      When Observer sends DeleteSite on stream "site-001":
        """
        {}
        """
      Then the SiteDeleted event is emitted with:
        """
        {}
        """

  @not-found @site-not-found
  Rule: 觀測點不存在
    觀測點不存在時拒絕刪除

    Scenario: 觀測點不存在
      觀測點 stream 無事件，拒絕刪除
      Given no prior events
      When Observer sends DeleteSite on stream "site-unknown":
        """
        {}
        """
      Then the operation fails with: 觀測點不存在

  @condition @site-already-deleted
  Rule: 觀測點已刪除
    觀測點已被刪除時拒絕重複刪除

    Scenario: 觀測點已刪除
      觀測點已刪除，拒絕重複刪除
      Given the SiteCreated event has occurred on stream "site-001":
        """
        {
          "siteName": "陽明山觀測點"
        }
        """
      And the SiteDeleted event has occurred on stream "site-001":
        """
        {}
        """
      When Observer sends DeleteSite on stream "site-001":
        """
        {}
        """
      Then the operation fails with: 觀測點已刪除

Feature: 建立觀測站
  觀測員建立觀測站（姓名、觀測點、投打習慣、緯度、經度）

  @happy-path @happy-path
  Rule: 成功建立觀測站
    提供有效資料時成功建立觀測站

    Scenario: 成功建立觀測站
      建立新觀測站，產生 StationCreated
      Given no prior events
      When Observer sends CreateStation on stream "station-001":
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      Then the StationCreated event is emitted with:
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """

Feature: 編輯觀測站
  觀測員編輯觀測站資料

  @happy-path @happy-path
  Rule: 成功編輯觀測站
    觀測站存在且未刪除時成功編輯

    Scenario: 成功編輯觀測站
      觀測站存在，產生 StationUpdated
      Given the StationCreated event has occurred on stream "station-001":
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      When Observer sends UpdateStation on stream "station-001":
        """
        {
          "latitude": 24.98,
          "siteId": "site-001",
          "longitude": 121.54,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      Then the StationUpdated event is emitted with:
        """
        {
          "latitude": 24.98,
          "siteId": "site-001",
          "longitude": 121.54,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """

  @not-found @station-not-found
  Rule: 觀測站不存在
    觀測站不存在時拒絕編輯

    Scenario: 觀測站不存在
      觀測站 stream 無事件，拒絕編輯
      Given no prior events
      When Observer sends UpdateStation on stream "station-unknown":
        """
        {
          "latitude": 24.98,
          "siteId": "site-001",
          "longitude": 121.54,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      Then the operation fails with: 觀測站不存在

  @condition @station-deleted
  Rule: 觀測站已刪除
    觀測站已刪除時拒絕編輯

    Scenario: 觀測站已刪除
      觀測站已刪除，拒絕編輯
      Given the StationCreated event has occurred on stream "station-001":
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      And the StationDeleted event has occurred on stream "station-001":
        """
        {}
        """
      When Observer sends UpdateStation on stream "station-001":
        """
        {
          "latitude": 24.98,
          "siteId": "site-001",
          "longitude": 121.54,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      Then the operation fails with: 觀測站已刪除

Feature: 刪除觀測站
  觀測員刪除觀測站

  @happy-path @happy-path
  Rule: 成功刪除觀測站
    觀測站存在且未刪除時成功刪除

    Scenario: 成功刪除觀測站
      觀測站存在，產生 StationDeleted
      Given the StationCreated event has occurred on stream "station-001":
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      When Observer sends DeleteStation on stream "station-001":
        """
        {}
        """
      Then the StationDeleted event is emitted with:
        """
        {}
        """

  @not-found @station-not-found
  Rule: 觀測站不存在
    觀測站不存在時拒絕刪除

    Scenario: 觀測站不存在
      觀測站 stream 無事件，拒絕刪除
      Given no prior events
      When Observer sends DeleteStation on stream "station-unknown":
        """
        {}
        """
      Then the operation fails with: 觀測站不存在

  @condition @station-already-deleted
  Rule: 觀測站已刪除
    觀測站已刪除時拒絕重複刪除

    Scenario: 觀測站已刪除
      觀測站已刪除，拒絕重複刪除
      Given the StationCreated event has occurred on stream "station-001":
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      And the StationDeleted event has occurred on stream "station-001":
        """
        {}
        """
      When Observer sends DeleteStation on stream "station-001":
        """
        {}
        """
      Then the operation fails with: 觀測站已刪除

Feature: 開啟觀測時段
  觀測員選擇觀測站與觀測時段項目，開啟目擊事件觀測時段

  @happy-path @happy-path
  Rule: 成功開啟觀測時段
    選擇觀測站與項目後成功開啟觀測時段

    Scenario: 成功開啟觀測時段
      新觀測時段建立，產生 WatchStarted
      Given no prior events
      When Observer sends StartWatch on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      Then the WatchStarted event is emitted with:
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """

Feature: 結束觀測時段
  結束觀測時段，不可重新開啟

  @happy-path @happy-path
  Rule: 成功結束觀測時段
    觀測時段進行中時成功結束

    Scenario: 成功結束觀測時段
      觀測時段進行中，結束觀測時段，產生 WatchEnded
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      When Observer sends EndWatch on stream "watch-001":
        """
        {}
        """
      Then the WatchEnded event is emitted with:
        """
        {}
        """

  @condition @watch-already-ended
  Rule: 觀測時段已結束
    觀測時段已結束時拒絕重複結束

    Scenario: 觀測時段已結束
      觀測時段已結束，拒絕重複結束
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the WatchEnded event has occurred on stream "watch-001":
        """
        {}
        """
      When Observer sends EndWatch on stream "watch-001":
        """
        {}
        """
      Then the operation fails with: 觀測時段已結束

Feature: 記錄目擊事件
  系統自動擷取單筆目擊事件指標與影片（由 SightingDataTranslator 觸發）

  @happy-path @happy-path
  Rule: 成功記錄目擊事件
    觀測時段進行中時成功記錄目擊事件數據

    Scenario: 成功記錄目擊事件
      觀測時段進行中，系統記錄一球數據，產生 SightingRecorded
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the PendingSightingPair view returns:
        """
        {
          "photoEventId": "evt-photo-001",
          "watchId": "watch-001",
          "receivedAt": "2026-05-19T10:00:00Z",
          "trajEventId": "evt-traj-001"
        }
        """
      When System sends RecordSighting on stream "watch-001":
        """
        {
          "decel": 1.8,
          "speed": 130,
          "stationId": "station-001",
          "radiantAxis": 210,
          "lightPeak": 2200,
          "locationX": 0.1,
          "locationY": 0.5,
          "showerCode": "PER",
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "inclinationAngle": -5.2,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "verticalDrift": 38,
          "lightEfficiency": 95,
          "horizontalDrift": -15,
          "effectiveLightMag": 2100
        }
        """
      Then the SightingRecorded event is emitted with:
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """

  @condition @watch-ended
  Rule: 觀測時段已結束
    觀測時段已結束時拒絕記錄目擊事件

    Scenario: 觀測時段已結束
      觀測時段已結束，拒絕記錄目擊事件
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the WatchEnded event has occurred on stream "watch-001":
        """
        {}
        """
      And the PendingSightingPair view returns:
        """
        {
          "photoEventId": "evt-photo-001",
          "watchId": "watch-001",
          "receivedAt": "2026-05-19T10:00:00Z",
          "trajEventId": "evt-traj-001"
        }
        """
      When System sends RecordSighting on stream "watch-001":
        """
        {
          "decel": 1.8,
          "speed": 130,
          "stationId": "station-001",
          "radiantAxis": 210,
          "lightPeak": 2200,
          "locationX": 0.1,
          "locationY": 0.5,
          "showerCode": "PER",
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "inclinationAngle": -5.2,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "verticalDrift": 38,
          "lightEfficiency": 95,
          "horizontalDrift": -15,
          "effectiveLightMag": 2100
        }
        """
      Then the operation fails with: 觀測時段已結束

Feature: 收藏單筆
  觀測員收藏單筆紀錄

  @happy-path @happy-path
  Rule: 成功收藏
    目擊事件存在且未收藏時成功收藏

    Scenario: 成功收藏
      目擊事件紀錄存在且未收藏，產生 SightingFavorited
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      When Observer sends FavoriteSighting on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      Then the SightingFavorited event is emitted with:
        """
        {
          "sightingId": "sighting-001"
        }
        """

  @condition @sighting-already-favorited
  Rule: 目擊事件已收藏
    目擊事件已被收藏時拒絕重複收藏

    Scenario: 目擊事件已收藏
      目擊事件已收藏，拒絕重複收藏
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      And the SightingFavorited event has occurred on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      When Observer sends FavoriteSighting on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      Then the operation fails with: 目擊事件已收藏

  @condition @sighting-deleted
  Rule: 目擊事件已刪除
    目擊事件已被刪除時拒絕收藏

    Scenario: 目擊事件已刪除
      目擊事件已刪除，拒絕收藏
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      And the SightingDeleted event has occurred on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      When Observer sends FavoriteSighting on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      Then the operation fails with: 目擊事件已刪除

Feature: 取消收藏
  觀測員取消收藏單筆紀錄

  @happy-path @happy-path
  Rule: 成功取消收藏
    目擊事件已收藏時成功取消

    Scenario: 成功取消收藏
      目擊事件已收藏，取消後產生 SightingUnfavorited
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      And the SightingFavorited event has occurred on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      When Observer sends UnfavoriteSighting on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      Then the SightingUnfavorited event is emitted with:
        """
        {
          "sightingId": "sighting-001"
        }
        """

  @condition @sighting-not-favorited
  Rule: 目擊事件未收藏
    目擊事件未被收藏時拒絕取消

    Scenario: 目擊事件未收藏
      目擊事件未收藏，拒絕取消收藏
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      When Observer sends UnfavoriteSighting on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      Then the operation fails with: 目擊事件未收藏

Feature: 刪除單筆
  觀測員刪除單筆紀錄

  @happy-path @happy-path
  Rule: 成功刪除單筆
    目擊事件存在且未刪除時成功刪除

    Scenario: 成功刪除單筆
      目擊事件紀錄存在，產生 SightingDeleted
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      When Observer sends DeleteSighting on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      Then the SightingDeleted event is emitted with:
        """
        {
          "sightingId": "sighting-001"
        }
        """

  @condition @sighting-already-deleted
  Rule: 目擊事件已刪除
    目擊事件已被刪除時拒絕重複刪除

    Scenario: 目擊事件已刪除
      目擊事件已刪除，拒絕重複刪除
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the SightingRecorded event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """
      And the SightingDeleted event has occurred on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      When Observer sends DeleteSighting on stream "watch-001":
        """
        {
          "sightingId": "sighting-001"
        }
        """
      Then the operation fails with: 目擊事件已刪除

Feature: 註冊相機
  相機裝置上線時自動註冊（由 CameraRegistrationTranslator 觸發）

  @happy-path @happy-path
  Rule: 成功註冊相機
    新裝置上線時成功註冊

    Scenario: 成功註冊相機
      新裝置上線，產生 CameraRegistered
      Given the external event arrives via CameraRegistrationTranslator on stream "camera-001":
        """
        {
          "deviceId": "CAM-A1",
          "position": "天頂方向"
        }
        """
      When System sends RegisterCamera on stream "camera-001":
        """
        {
          "deviceId": "CAM-A1",
          "position": "天頂方向"
        }
        """
      Then the CameraRegistered event is emitted with:
        """
        {
          "deviceId": "CAM-A1",
          "position": "天頂方向"
        }
        """

  @integrity-constraint @camera-already-registered
  Rule: 裝置已註冊
    裝置已註冊時拒絕重複註冊

    Scenario: 裝置已註冊
      裝置已存在，拒絕重複註冊
      Given the CameraRegistered event has occurred on stream "camera-001":
        """
        {
          "deviceId": "CAM-A1",
          "position": "天頂方向"
        }
        """
      When System sends RegisterCamera on stream "camera-001":
        """
        {
          "deviceId": "CAM-A1",
          "position": "天頂方向"
        }
        """
      Then the operation fails with: 裝置已註冊

Feature: 更新相機狀態
  相機連線狀態變更（由 CameraStatusTranslator 觸發）

  @happy-path @happy-path
  Rule: 成功更新狀態
    相機已註冊時成功更新連線狀態

    Scenario: 成功更新狀態
      相機已註冊，更新為 disconnected，產生 CameraStatusUpdated
      Given the CameraRegistered event has occurred on stream "camera-001":
        """
        {
          "deviceId": "CAM-A1",
          "position": "天頂方向"
        }
        """
      And the external event arrives via CameraStatusTranslator on stream "camera-001":
        """
        {
          "deviceId": "CAM-A1",
          "connectionStatus": "disconnected"
        }
        """
      When System sends UpdateCameraStatus on stream "camera-001":
        """
        {
          "connectionStatus": "disconnected"
        }
        """
      Then the CameraStatusUpdated event is emitted with:
        """
        {
          "connectionStatus": "disconnected"
        }
        """

  @not-found @camera-not-registered
  Rule: 相機未註冊
    相機未註冊時拒絕更新狀態

    Scenario: 相機未註冊
      相機 stream 無事件，拒絕更新
      Given no prior events
      When System sends UpdateCameraStatus on stream "camera-unknown":
        """
        {
          "connectionStatus": "disconnected"
        }
        """
      Then the operation fails with: 相機未註冊

Feature: 請求匯出
  觀測員請求匯出單次觀測時段或全部歷史為 CSV

  @happy-path @happy-path-single
  Rule: 匯出單次觀測時段
    匯出單次觀測時段為 CSV

    Scenario: 匯出單次觀測時段
      指定 watchId 匯出單次觀測時段，產生 ExportRequested
      Given no prior events
      When Observer sends RequestExport on stream "export-001":
        """
        {
          "exportType": "single-watch",
          "watchId": "watch-001"
        }
        """
      Then the ExportRequested event is emitted with:
        """
        {
          "exportType": "single-watch",
          "watchId": "watch-001"
        }
        """

  @happy-path @happy-path-all
  Rule: 匯出全部歷史
    匯出全部歷史為 CSV

    Scenario: 匯出全部歷史
      匯出全部歷史，watchId 為 null，產生 ExportRequested
      Given no prior events
      When Observer sends RequestExport on stream "export-002":
        """
        {
          "exportType": "all-history",
          "watchId": null
        }
        """
      Then the ExportRequested event is emitted with:
        """
        {
          "exportType": "all-history",
          "watchId": null
        }
        """

  @field-validation @missing-watch-id-for-single
  Rule: 缺少觀測時段 ID
    匯出單次觀測時段時未提供 watchId

    Scenario: 缺少觀測時段 ID
      exportType 為 single-watch 但 watchId 為 null，拒絕匯出
      Given no prior events
      When Observer sends RequestExport on stream "export-003":
        """
        {
          "exportType": "single-watch",
          "watchId": null
        }
        """
      Then the operation fails with: 匯出單次觀測時段時必須提供 watchId

Feature: 觀測點列表
  顯示所有觀測點與其觀測站數，排除已刪除觀測點，觀測站數會隨已刪除觀測站遞減

  @happy-path @happy-path
  Rule: 顯示觀測點列表
    存在觀測點時正確顯示列表，並計算各隊觀測站數

    Scenario: 顯示觀測點列表
      兩隊各有不同觀測站數,正確顯示 stationCount
      Given the SiteCreated event has occurred on stream "site-001":
        """
        {
          "siteName": "陽明山觀測點"
        }
        """
      And the SiteCreated event has occurred on stream "site-002":
        """
        {
          "siteName": "合歡山觀測點"
        }
        """
      And the StationCreated event has occurred on stream "station-001":
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      And the StationCreated event has occurred on stream "station-002":
        """
        {
          "latitude": 24.98,
          "siteId": "site-001",
          "longitude": 121.54,
          "stationName": "陽明山南站",
          "mountType": "經緯儀",
          "opticsType": "魚眼"
        }
        """
      And the StationCreated event has occurred on stream "station-003":
        """
        {
          "latitude": 23.47,
          "siteId": "site-002",
          "longitude": 120.95,
          "stationName": "鹿林山西站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      When the SiteList view is queried
      Then the view returns:
        """
        [
          {
            "siteId": "site-001",
            "siteName": "陽明山觀測點",
            "stationCount": 2
          },
          {
            "siteId": "site-002",
            "siteName": "合歡山觀測點",
            "stationCount": 1
          }
        ]
        """

  @derivation @exclude-deleted-and-decrement-count
  Rule: 排除已刪除觀測點並遞減觀測站數
    已刪除觀測點不顯示；已刪除觀測站不計入 stationCount

    Scenario: 排除已刪除觀測點與觀測站
      site-002 已刪除整筆消失;site-001 內 station-002 已刪除 stationCount 由 2 變 1
      Given the SiteCreated event has occurred on stream "site-001":
        """
        {
          "siteName": "陽明山觀測點"
        }
        """
      And the SiteCreated event has occurred on stream "site-002":
        """
        {
          "siteName": "合歡山觀測點"
        }
        """
      And the StationCreated event has occurred on stream "station-001":
        """
        {
          "latitude": 24.14,
          "siteId": "site-001",
          "longitude": 121.27,
          "stationName": "合歡山北站",
          "mountType": "赤道儀",
          "opticsType": "廣角"
        }
        """
      And the StationCreated event has occurred on stream "station-002":
        """
        {
          "latitude": 24.98,
          "siteId": "site-001",
          "longitude": 121.54,
          "stationName": "陽明山南站",
          "mountType": "經緯儀",
          "opticsType": "魚眼"
        }
        """
      And the StationDeleted event has occurred on stream "station-002":
        """
        {}
        """
      And the SiteDeleted event has occurred on stream "site-002":
        """
        {}
        """
      When the SiteList view is queried
      Then the view returns:
        """
        [
          {
            "siteId": "site-001",
            "siteName": "陽明山觀測點",
            "stationCount": 1
          }
        ]
        """

    Scenario: 空列表
      尚無任何觀測點時回傳空列表
      Given no prior events
      When the SiteList view is queried
      Then the view returns an empty list

Feature: 接收 traj 軌跡資料
  traj-module 擷取的目擊事件 3D 軌跡原始資料轉譯為內部事件（由 TrajTranslator 觸發）

  @happy-path @happy-path
  Rule: 成功接收 traj 資料
    觀測時段進行中時成功接收 traj 軌跡原始資料

    Scenario: 成功接收
      觀測時段進行中，接收 traj 3D 軌跡資料，產生 TrajDataReceived
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the external event arrives via TrajTranslator on stream "watch-001":
        """
        {
          "rawTraj": "..raw-3d-traj..",
          "trajEndTs": 1.2,
          "trajStartTs": 0.8,
          "pathTrajXc0": 0.1,
          "pathTrajXc1": -25.5,
          "pathTrajXc2": 0.3,
          "pathTrajYc0": 0.05,
          "pathTrajYc1": 0.2,
          "pathTrajYc2": -9.8,
          "pathTrajZc0": 1.8,
          "pathTrajZc1": -0.5,
          "pathTrajZc2": -4.9,
          "rawTraj2dCam0": "..cam0-2d..",
          "rawTraj2dCam1": "..cam1-2d.."
        }
        """
      When System sends ReceiveTrajData on stream "watch-001":
        """
        {
          "rawTraj": "..raw-3d-traj..",
          "trajEndTs": 1.2,
          "trajStartTs": 0.8,
          "pathTrajXc0": 0.1,
          "pathTrajXc1": -25.5,
          "pathTrajXc2": 0.3,
          "pathTrajYc0": 0.05,
          "pathTrajYc1": 0.2,
          "pathTrajYc2": -9.8,
          "pathTrajZc0": 1.8,
          "pathTrajZc1": -0.5,
          "pathTrajZc2": -4.9,
          "rawTraj2dCam0": "..cam0-2d..",
          "rawTraj2dCam1": "..cam1-2d.."
        }
        """
      Then the TrajDataReceived event is emitted with:
        """
        {
          "rawTraj": "..raw-3d-traj..",
          "trajEndTs": 1.2,
          "trajStartTs": 0.8,
          "pathTrajXc0": 0.1,
          "pathTrajXc1": -25.5,
          "pathTrajXc2": 0.3,
          "pathTrajYc0": 0.05,
          "pathTrajYc1": 0.2,
          "pathTrajYc2": -9.8,
          "pathTrajZc0": 1.8,
          "pathTrajZc1": -0.5,
          "pathTrajZc2": -4.9,
          "rawTraj2dCam0": "..cam0-2d..",
          "rawTraj2dCam1": "..cam1-2d.."
        }
        """

  @condition @watch-ended
  Rule: 觀測時段已結束
    觀測時段已結束時拒絕接收 traj 資料

    Scenario: 觀測時段已結束
      觀測時段已結束，拒絕接收 traj 資料
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the WatchEnded event has occurred on stream "watch-001":
        """
        {}
        """
      And the external event arrives via TrajTranslator on stream "watch-001":
        """
        {
          "rawTraj": "..raw-3d-traj..",
          "trajEndTs": 1.2,
          "trajStartTs": 0.8,
          "pathTrajXc0": 0.1,
          "pathTrajXc1": -25.5,
          "pathTrajXc2": 0.3,
          "pathTrajYc0": 0.05,
          "pathTrajYc1": 0.2,
          "pathTrajYc2": -9.8,
          "pathTrajZc0": 1.8,
          "pathTrajZc1": -0.5,
          "pathTrajZc2": -4.9,
          "rawTraj2dCam0": "..cam0-2d..",
          "rawTraj2dCam1": "..cam1-2d.."
        }
        """
      When System sends ReceiveTrajData on stream "watch-001":
        """
        {
          "rawTraj": "..raw-3d-traj..",
          "trajEndTs": 1.2,
          "trajStartTs": 0.8,
          "pathTrajXc0": 0.1,
          "pathTrajXc1": -25.5,
          "pathTrajXc2": 0.3,
          "pathTrajYc0": 0.05,
          "pathTrajYc1": 0.2,
          "pathTrajYc2": -9.8,
          "pathTrajZc0": 1.8,
          "pathTrajZc1": -0.5,
          "pathTrajZc2": -4.9,
          "rawTraj2dCam0": "..cam0-2d..",
          "rawTraj2dCam1": "..cam1-2d.."
        }
        """
      Then the operation fails with: 觀測時段已結束

Feature: 接收 photo 光度資料
  photo-module 擷取的輻射點原始資料轉譯為內部事件（由 PhotoTranslator 觸發）

  @happy-path @happy-path
  Rule: 成功接收 photo 資料
    觀測時段進行中時成功接收 photo 輻射點原始資料

    Scenario: 成功接收
      觀測時段進行中，接收 photo 光度資料，產生 PhotoDataReceived
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the external event arrives via PhotoTranslator on stream "watch-001":
        """
        {
          "peakMag": 2200,
          "radiantX": 0.15,
          "radiantY": 0.85,
          "radiantZ": -0.5,
          "radiantRaHhmm": "11:30",
          "culminationHhmm": "2:15",
          "radiantRaDegrees": 210,
          "culminationDegrees": 45
        }
        """
      When System sends ReceivePhotoData on stream "watch-001":
        """
        {
          "peakMag": 2200,
          "radiantX": 0.15,
          "radiantY": 0.85,
          "radiantZ": -0.5,
          "radiantRaHhmm": "11:30",
          "culminationHhmm": "2:15",
          "radiantRaDegrees": 210,
          "culminationDegrees": 45
        }
        """
      Then the PhotoDataReceived event is emitted with:
        """
        {
          "peakMag": 2200,
          "radiantX": 0.15,
          "radiantY": 0.85,
          "radiantZ": -0.5,
          "radiantRaHhmm": "11:30",
          "culminationHhmm": "2:15",
          "radiantRaDegrees": 210,
          "culminationDegrees": 45
        }
        """

  @condition @watch-ended
  Rule: 觀測時段已結束
    觀測時段已結束時拒絕接收 photo 資料

    Scenario: 觀測時段已結束
      觀測時段已結束，拒絕接收 photo 資料
      Given the WatchStarted event has occurred on stream "watch-001":
        """
        {
          "stationId": "station-001",
          "watchItem": "英仙座觀測"
        }
        """
      And the WatchEnded event has occurred on stream "watch-001":
        """
        {}
        """
      And the external event arrives via PhotoTranslator on stream "watch-001":
        """
        {
          "peakMag": 2200,
          "radiantX": 0.15,
          "radiantY": 0.85,
          "radiantZ": -0.5,
          "radiantRaHhmm": "11:30",
          "culminationHhmm": "2:15",
          "radiantRaDegrees": 210,
          "culminationDegrees": 45
        }
        """
      When System sends ReceivePhotoData on stream "watch-001":
        """
        {
          "peakMag": 2200,
          "radiantX": 0.15,
          "radiantY": 0.85,
          "radiantZ": -0.5,
          "radiantRaHhmm": "11:30",
          "culminationHhmm": "2:15",
          "radiantRaDegrees": 210,
          "culminationDegrees": 45
        }
        """
      Then the operation fails with: 觀測時段已結束

Feature: 目擊事件融合處理
  監看 PendingSightingPair 視圖，當 traj + photo 原始資料配對完成後融合計算目擊事件指標（由 SightingFusionProcessor 觸發）

  @happy-path @happy-path
  Rule: 成功融合目擊事件資料
    traj + photo 配對完成後融合計算並記錄目擊事件

    Scenario: 成功融合
      PendingSightingPair 配對完成，融合產生 SightingRecorded
      Given the PendingSightingPair view returns:
        """
        {
          "photoEventId": "evt-photo-001",
          "watchId": "watch-001",
          "receivedAt": "2026-05-19T10:00:00Z",
          "trajEventId": "evt-traj-001"
        }
        """
      When System sends RecordSighting on stream "watch-001":
        """
        {
          "decel": 1.8,
          "speed": 130,
          "stationId": "station-001",
          "radiantAxis": 210,
          "lightPeak": 2200,
          "locationX": 0.1,
          "locationY": 0.5,
          "showerCode": "PER",
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "inclinationAngle": -5.2,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "verticalDrift": 38,
          "lightEfficiency": 95,
          "horizontalDrift": -15,
          "effectiveLightMag": 2100
        }
        """
      Then the SightingRecorded event is emitted with:
        """
        {
          "stationId": "station-001",
          "speedKms": 130,
          "showerCode": "PER",
          "azimuthDegrees": -5.2,
          "entryDegrees": -8.5,
          "zenithDegrees": 15,
          "trueLightMag": 2100,
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "totalLightMag": 2200,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "decelVerticalKms": 38,
          "radiantRaDegrees": 210,
          "lightEfficiency": 0.95,
          "decelHorizontalKms": -15,
          "verticalDriftKm": 38,
          "horizontalDriftKm": -15,
          "terminalLocationXKm": 5,
          "terminalLocationZKm": 75
        }
        """

  @condition @condition
  Rule: 觀測時段已結束
    觀測時段已結束時拒絕融合

    Scenario: 觀測時段已結束
      觀測時段已結束，拒絕融合目擊事件資料
      Given the PendingSightingPair view returns:
        """
        {
          "photoEventId": "evt-photo-001",
          "watchId": "watch-001",
          "receivedAt": "2026-05-19T10:00:00Z",
          "trajEventId": "evt-traj-001"
        }
        """
      When System sends RecordSighting on stream "watch-001":
        """
        {
          "decel": 1.8,
          "speed": 130,
          "stationId": "station-001",
          "radiantAxis": 210,
          "lightPeak": 2200,
          "locationX": 0.1,
          "locationY": 0.5,
          "showerCode": "PER",
          "secondaryVideoUrl": "https://example.com/side.mp4",
          "inclinationAngle": -5.2,
          "primaryVideoUrl": "https://example.com/front.mp4",
          "verticalDrift": 38,
          "lightEfficiency": 95,
          "horizontalDrift": -15,
          "effectiveLightMag": 2100
        }
        """
      Then the operation fails with: 觀測時段已結束
