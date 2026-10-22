# 默认参数目录

## 1 参数的定位

参数是玩法校准，不是现实工程、交通或经济规范。当前默认校准标识为 `urban-10`。本页列出源码默认值；具体城市的实际值应读取存档中的 `state.policy`、`state.settings` 和导出的校准目录。

旧存档可能保留既有数值，只补充新增参数。因此修改默认值不等于所有旧城市自动使用新值。参数改变还受类型、范围和整数约束，并非所有条目都有独立界面控件。

## 2 城市情景设置

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| migration | 24 | 迁入意愿基准（户/月）；叠加空缺岗位响应后按发展速度计算，实际入住需匹配住房与岗位 |
| externalJobs | 90 | 地图外部经济岗位需求条件 |
| growth | 1 | 发展速度；为零停止新增开发和迁入等相应行为 |
| fare | 2 | 完整公共交通旅程的基础票价，元 |
| budget | false | 默认沙盒记账，可开启预算约束 |
| taxRate | 0.06 | 家庭收入税率 |
| maxProjects | 12 | 月度新项目上限，实际开工才计名额 |
| autoGrow | true | 自动支路及配套 |
| autoRenew | true | 自动城市更新评估 |
| accessBudget | 30 | 默认可达时间预算，分钟 |

新城初始资金为 100,000,000 元。发展、配套、自动更新和运行暂停是不同控制，不能互相替代。

## 3 模型校准参数

下表按 `parameters.py` 的公开定义列出名称、字段、值和单位。停用的旧建筑数配套参数不再公开为控制项；基础配套改用人口、岗位、覆盖和间距。

| 名称 | 字段 | 默认值 | 单位 |
| --- | --- | ---: | --- |
| 区域出行家庭抽样周期 | `regionalPassengerHouseholds` | 12 | 户/代表出行户 |
| 区域铁路门户边界距离 | `regionalBoundaryMeters` | 650 | m |
| 铁路货物装卸时间 | `freightHandlingMinutes` | 12 | min |
| 工业就业货运强度 | `freightTonnesPerWorker` | 0.8 | 吨/就业者/典型日 |
| 区域道路外部运距时间 | `externalRoadMinutes` | 45 | min |
| 货车载重 | `truckTonnes` | 12 | 吨/车 |
| 每月自动支路上限 | `autoLanesPerMonth` | 3 | 条/月 |
| 目标街区面积 | `blockTargetArea` | 22000 | m² |
| 开放支路最大长度 | `laneMaximumLength` | 210 | m |
| 每户使用住宅面积 | `householdSpace` | 75 | m²/户 |
| 步行速度 | `walkingMetersPerMinute` | 80 | m/min |
| 交通分配轮次 | `trafficIterations` | 2 | 轮 |
| 地价月度涨跌上限 | `priceMonthlyLimit` | 0.07 | 月变化比例 |
| 城区识别网格 | `districtCellMeters` | 400 | m |
| 城区标签稳定期 | `districtPersistenceMonths` | 3 | 月 |
| 相邻城区合并距离 | `districtJoinMeters` | 220 | m |
| 中心最低建筑数 | `cbdMinimumBuildings` | 6 | 栋 |
| 中心最低岗位数 | `cbdMinimumJobs` | 800 | 岗位 |
| 中心最低实际就业 | `cbdMinimumEmployed` | 500 | 实际就业者 |
| 汽车单位里程排放 | `carCO2KgPerKm` | 0.17 | kg/km |
| 基础施工期限（普通新建项目的总施工天数另减半） | `constructionBaseMonths` | 2 | 月 |
| 压力搬迁阈值 | `relocationStressMonths` | 4 | 月 |
| 压力迁出阈值 | `exitStressMonths` | 8 | 月 |
| 住房支出负担阈值 | `housingBurdenThreshold` | 0.5 | 收入比例 |
| 事件持续期 | `eventPersistenceMonths` | 3 | 月 |
| 同类事件冷却期 | `eventCooldownMonths` | 12 | 月 |
| 迁入空缺岗位响应 | `migrationVacancyResponse` | 0.25 | 户/空缺岗位/月 |
| 每月新增意愿上限 | `migrationMonthlyMaximum` | 500 | 户/月 |
| 住房匹配通勤范围 | `housingCommuteMinutes` | 30 | 分钟 |
| 住房就业展望期限 | `housingLookaheadMonths` | 2 | 月 |
| 基础商业岗位需求 | `commercialBaseDemand` | 15 | 岗位 |
| 人均商业空间需求 | `commercialPopulationDemand` | 0.15 | 岗位/人 |
| 外部办公空间需求比例 | `officeExternalDemand` | 0.5 | 无量纲系数 |
| 人均办公空间需求 | `officePopulationDemand` | 0.18 | 岗位/人 |
| 外部工业空间需求比例 | `industrialExternalDemand` | 0.5 | 无量纲系数 |
| 人均工业空间需求 | `industrialPopulationDemand` | 0.12 | 岗位/人 |
| 基础仓储岗位需求 | `warehouseBaseDemand` | 15 | 岗位 |
| 外部仓储需求比例 | `warehouseExternalDemand` | 0.2 | 无量纲系数 |
| 人均仓储空间需求 | `warehousePopulationDemand` | 0.05 | 岗位/人 |
| 最低开工需求比例 | `minimumDevelopmentDemand` | 0.08 | 无量纲系数 |
| 开局路口发展衰减距离 | `junctionSeedRadius` | 250 | m |
| 开局路口选址加分 | `junctionSeedBonus` | 6 | 无量纲系数 |
| 路口开局加分退出建筑数 | `junctionSeedBuildings` | 20 | 栋 |
| 邻里填空步行范围 | `neighbourhoodInfillRadius` | 300 | m |
| 邻里填空选址加分 | `neighbourhoodInfillBonus` | 2 | 无量纲系数 |
| 商务核心最大衰减半径 | `businessCoreMaximumRadius` | 650 | m |
| 建成土地对核心范围影响系数 | `businessCoreGrowthFactor` | 4 | 无量纲系数 |
| 中心活力连续响应尺度 | `growthCenterActivityScale` | 80 | 活力单位，非成立门槛 |
| 本地经济需求出行衰减时间 | `economicCatchmentMinutes` | 15 | min，连续衰减尺度 |
| 手动道路拆迁费用比例 | `roadDemolitionCostShare` | 0.1 | 原建设费用比例 |
| 上车时间 | `boardingMinutes` | 0.8 | min |
| 下车时间 | `alightingMinutes` | 0.4 | min |
| 低频时刻表阈值 | `lowFrequencyHeadway` | 20 | min |
| 初始配路期限 | `streetSeedMonths` | 3 | 月 |
| 支路周边开发半径 | `streetGrowthRadius` | 200 | m |
| 支路周边最低建筑数 | `streetGrowthMinimumBuildings` | 3 | 栋 |
| 最长步行旅程 | `walkMaximumMinutes` | 35 | min |
| 最长完整旅程 | `journeyMaximumMinutes` | 150 | min |
| 停车接驳时间 | `parkingMinutes` | 4 | min |
| 换乘额外阻抗 | `transferPenaltyMinutes` | 4 | min |
| 汽车公里费用 | `carCostPerKm` | 0.9 | 元/km |
| 停车费用 | `carParkingFee` | 3 | 元/旅程 |
| 最长可接受通勤 | `workMaximumMinutes` | 100 | min |
| 每月代表工作日 | `workingDaysPerMonth` | 22 | 日/月 |
| 外部办公岗位比例 | `jobOfficeExternal` | 0.4 | 无量纲系数 |
| 人均商业岗位 | `jobCommercialPopulation` | 0.12 | 岗位/人 |
| 人均办公岗位 | `jobOfficePopulation` | 0.14 | 岗位/人 |
| 外部工业岗位比例 | `jobIndustrialExternal` | 0.45 | 无量纲系数 |
| 人均工业岗位 | `jobIndustrialPopulation` | 0.1 | 岗位/人 |
| 外部仓储岗位比例 | `jobWarehouseExternal` | 0.15 | 无量纲系数 |
| 人均仓储岗位 | `jobWarehousePopulation` | 0.04 | 岗位/人 |
| 开发收益评估期限 | `developmentPaybackYears` | 24 | 年 |
| 地价平滑速度 | `priceSmoothing` | 0.16 | 无量纲系数 |
| 租金平滑速度 | `rentSmoothing` | 0.1 | 无量纲系数 |
| 失业压力累计期限 | `unemploymentStressMonths` | 6 | 月 |
| 空置重建等待期 | `redevelopVacancyMonths` | 24 | 月 |
| 中心最低办公面积比例 | `minimumOfficeShare` | 0.35 | 无量纲系数 |
| 中心最低可达岗位 | `cbdAccessJobs` | 250 | 岗位 |
| 城区主导用途比例 | `dominantUseShare` | 0.45 | 无量纲系数 |
| 办公集聚衰减距离 | `officeClusterRadius` | 220 | m |
| 办公集聚饱和就业数 | `officeClusterWorkers` | 350 | 实际就业者 |
| 填补街区的偏好距离 | `siteInfillRadius` | 140 | m |
| 中心性采样节点数 | `centralitySources` | 24 | 网络采样源 |
| 网络中心性衰减时间 | `centralityMinutes` | 7 | min |
| 整体规划的小街区最大面积 | `smallBlockMaximumArea` | 22000 | m² |
| 街区内部补路开发比例 | `blockInfillThreshold` | 0.28 | 已开发土地面积比例 |
| 追加开发最低实际缺口 | `minimumProjectUnits` | 8 | 户或岗位 |
| 自动补路前沿街土地开发比例 | `streetFillThreshold` | 0.52 | 已开发土地面积比例 |
| 沿街补空档距离 | `frontageInfillMeters` | 90 | m |
| 沿街补空档偏好 | `frontageInfillBonus` | 1.8 | 无量纲系数 |
| 商务核心衰减半径 | `businessCoreRadius` | 230 | m |
| 同类邻里集聚半径 | `neighbourhoodAffinityRadius` | 160 | m |
| 单个办公项目需求份额上限 | `officeProjectShare` | 0.16 | 需求比例 |
| 办公标准层最大占地 | `officeFootprintMaximum` | 520 | m² |
| 住宅单栋最大占地 | `residentialFootprintMaximum` | 780 | m² |
| 中心最低办公楼数量 | `cbdMinimumOffices` | 5 | 栋 |
| 中心办公楼最近邻上限 | `cbdOfficeNeighbourMeters` | 180 | m |
| 学校人口配置 | `schoolResidents` | 4500 | 人/学校 |
| 诊所人口配置 | `clinicResidents` | 6500 | 人/诊所 |
| 社区公园人口配置 | `parkResidents` | 3800 | 人/公园 |
| 广场岗位配置 | `plazaJobs` | 2000 | 岗位/广场 |
| 公园最小间距 | `parkSeparation` | 240 | m |
| 广场最小间距 | `plazaSeparation` | 260 | m |
| 学校最小间距 | `schoolSeparation` | 480 | m |
| 诊所最小间距 | `clinicSeparation` | 650 | m |
| 自动更新评估间隔 | `renewalReviewMonths` | 6 | 月 |
| 同址更新冷却期 | `renewalCooldownMonths` | 120 | 月 |
| 自动更新最低楼龄 | `renewalMinimumAge` | 120 | 月 |
| 自动翻新状况阈值 | `renewalConditionThreshold` | 70 | 状况指数 |
| 更新收益评估年限 | `renewalReturnYears` | 20 | 年 |
| 单项目自动投资资金上限 | `renewalBudgetShare` | 0.2 | 资金比例 |
| 同时进行的更新项目上限 | `renewalActiveLimit` | 2 | 项 |
| 片区更新持续空置门槛 | `renewalBlockVacancyShare` | 0.6 | 空置面积比例 |
| 路口保护绿灯时长 | `signalGreenSeconds` | 12 | 秒 |
| 路口黄灯时长 | `signalYellowSeconds` | 3 | 秒 |
| 路口全红清空时长 | `signalClearanceSeconds` | 3 | 秒 |

## 4 道路与轨道

费用为基础线性建设单价，实际另受地形及结构影响。`maxGrade` 是高差/水平距离，不能当作角度；容量字段适用于机动车道路，不代表未运营轨道的客运能力。

| 类型 | 字段 | 宽度 m | 速度 km/h | 容量 辆/h | 建设 元/m | 最大坡度比 | 步行 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| 小路 | `lane` | 7 | 18 | 180 | 350 | 0.57735 | 允许 |
| 普通路 | `street` | 14 | 35 | 600 | 900 | 0.57735 | 允许 |
| 主干道 | `avenue` | 24 | 50 | 1600 | 1800 | 0.57735 | 允许 |
| 快速路 | `highway` | 30 | 90 | 3200 | 3200 | 0.57735 | 禁止 |
| 高速公路 | `motorway` | 36 | 110 | 4200 | 4800 | 0.57735 | 禁止 |
| 步道 | `path` | 4 | 5 | 0 | 150 | 0.57735 | 允许 |
| 地铁 | `metro` | 10 | 75 | 0 | 18000 | 0.42 | 禁止 |
| 铁路 | `train` | 12 | 110 | 0 | 10000 | 0.16 | 禁止 |
| 有轨电车 | `tram` | 8 | 35 | 0 | 6000 | 0.42 | 禁止 |

## 5 公共交通

单车容量、运营服务和班距共同形成区段可分配运力。车辆费用按月租赁资源近似，公里费用依运营车公里计算。

| 方式 | 字段 | 速度 km/h | 单车容量 人 | 租赁 元/辆/月 | 运行 元/车·km |
| --- | --- | ---: | ---: | ---: | ---: |
| 巴士 | `bus` | 35 | 70 | 2000 | 8 |
| 有轨电车 | `tram` | 35 | 220 | 6500 | 16 |
| 地铁 | `metro` | 75 | 900 | 18000 | 38 |
| 火车 | `train` | 110 | 650 | 20000 | 45 |

## 6 普通建筑用途

租金为基准参数，实际地块月租金会调整；建造单价乘实际楼面面积并考虑工程条件。住宅空间字段按户，其他用途按岗位。

| 用途 | 字段 | 基准租金 元/m²/月 | 建造 元/m² | 空间 m²/户或岗位 |
| --- | --- | ---: | ---: | ---: |
| 住宅 | `residential` | 10 | 1800 | 75 |
| 商业 | `commercial` | 26 | 2000 | 35 |
| 办公 | `office` | 22 | 2400 | 25 |
| 工业 | `industrial` | 12 | 1000 | 70 |
| 仓储 | `warehouse` | 8 | 700 | 120 |

## 7 其他规则参数

地形输入与范围见 [世界与地形](world-and-terrain.md)，设施人口、概率和间距见 [设施](facilities.md)，统一速度及高速抽样条件见 [时间与交通](simulation-and-traffic.md)。这些规则部分定义在所属模块，并非全部集中于 `POLICY`，不能假定导出校准表覆盖了所有几何常数。

## 8 修改参数时的规则

参数名、单位或默认值改变后同步所属专题与本页；已有存档保留值的迁移策略需明确。一个参数只在真实使用它的机制上产生影响，不应为所有统计机械乘相同倍率。

比较方案时应保持参数一致，或明确把参数变化作为比较条件。改变模型结构后不能仅更新版本字符串就承诺与旧历史直接可比。性能优化不得偷偷改变代表人数、容量和守恒口径。

来源：[parameters.py](../city-planner/backend/city/parameters.py)、[engine.py](../city-planner/backend/city/engine.py)。
