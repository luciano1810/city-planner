"""Saved, versioned model calibration. Currency is fictional simulation currency."""
POLICY = dict(regionalPassengerHouseholds=12,regionalBoundaryMeters=650,freightHandlingMinutes=12,freightTonnesPerWorker=.8,externalRoadMinutes=45,truckTonnes=12,version='urban-9', autoLanesPerMonth=3, blockTargetArea=22000, laneMaximumLength=210,
              parkPerBuildings=28, plazaPerBuildings=45, householdSpace=75,
              walkingMetersPerMinute=80, trafficIterations=2, priceMonthlyLimit=.07,
              districtCellMeters=400, districtPersistenceMonths=3, districtJoinMeters=220,
              cbdMinimumBuildings=6, cbdMinimumJobs=800, cbdMinimumEmployed=500,
              carCO2KgPerKm=.17, constructionBaseMonths=2, relocationStressMonths=4,
              exitStressMonths=8, housingBurdenThreshold=.5, eventPersistenceMonths=3,
              eventCooldownMonths=12, lowlandProxy='低海拔邻水指数，非洪水概率')


POLICY.update(housingBaseDemand=40,pendingHousingMultiplier=2,commercialBaseDemand=15,commercialPopulationDemand=.15,officeExternalDemand=.5,officePopulationDemand=.18,industrialExternalDemand=.5,industrialPopulationDemand=.12,warehouseBaseDemand=15,warehouseExternalDemand=.2,warehousePopulationDemand=.05,minimumDevelopmentDemand=.08,boardingMinutes=.8,alightingMinutes=.4,lowFrequencyHeadway=20,streetSeedMonths=3,streetGrowthRadius=200,streetGrowthMinimumBuildings=3,walkMaximumMinutes=35,journeyMaximumMinutes=150,parkingMinutes=4,
    transferPenaltyMinutes=4,carCostPerKm=.9,carParkingFee=3,workMaximumMinutes=100,
    workingDaysPerMonth=22,jobOfficeExternal=.4,jobCommercialPopulation=.12,
    jobOfficePopulation=.14,jobIndustrialExternal=.45,jobIndustrialPopulation=.10,
    jobWarehouseExternal=.15,jobWarehousePopulation=.04,developmentPaybackYears=24,
    priceSmoothing=.16,rentSmoothing=.1,unemploymentStressMonths=6,redevelopVacancyMonths=24,
    minimumOfficeShare=.35,cbdAccessJobs=250,dominantUseShare=.45,
    officeClusterRadius=220,officeClusterWorkers=350,siteInfillRadius=140,
    centralitySources=24,centralityMinutes=7)
POLICY.update(smallBlockMaximumArea=22000,blockInfillThreshold=.28,minimumProjectUnits=8,streetFillThreshold=.52,frontageInfillMeters=90,frontageInfillBonus=1.8,
    businessCoreRadius=230,neighbourhoodAffinityRadius=160,
    officeProjectShare=.16,officeFootprintMaximum=520,residentialFootprintMaximum=780,
    cbdMinimumOffices=5,cbdOfficeNeighbourMeters=180,
    schoolResidents=4500,clinicResidents=6500,parkResidents=3800,plazaJobs=2000,
    parkSeparation=240,plazaSeparation=260,schoolSeparation=480,clinicSeparation=650)
UNITS={
 'smallBlockMaximumArea':'m²','blockInfillThreshold':'已开发土地面积比例','minimumProjectUnits':'户或岗位',
 'streetFillThreshold':'已开发土地面积比例','frontageInfillMeters':'m','frontageInfillBonus':'无量纲系数',
 'businessCoreRadius':'m','neighbourhoodAffinityRadius':'m','officeProjectShare':'需求比例',
 'officeFootprintMaximum':'m²','residentialFootprintMaximum':'m²','cbdMinimumOffices':'栋',
 'cbdOfficeNeighbourMeters':'m','schoolResidents':'人/学校','clinicResidents':'人/诊所',
 'parkResidents':'人/公园','plazaJobs':'岗位/广场',
 'parkSeparation':'m','plazaSeparation':'m','schoolSeparation':'m','clinicSeparation':'m',
 'housingBaseDemand':'户','commercialBaseDemand':'岗位','warehouseBaseDemand':'岗位','lowFrequencyHeadway':'min',
 'streetSeedMonths':'月','streetGrowthRadius':'m','streetGrowthMinimumBuildings':'栋','autoLanesPerMonth':'条/月','blockTargetArea':'m²','laneMaximumLength':'m',
 'parkPerBuildings':'栋/公园','plazaPerBuildings':'栋/广场','householdSpace':'m²/户',
 'walkingMetersPerMinute':'m/min','trafficIterations':'轮','priceMonthlyLimit':'月变化比例',
 'districtCellMeters':'m','districtPersistenceMonths':'月','districtJoinMeters':'m',
 'cbdMinimumBuildings':'栋','cbdMinimumJobs':'岗位','cbdMinimumEmployed':'实际就业者',
 'carCO2KgPerKm':'kg/km','constructionBaseMonths':'月','relocationStressMonths':'月',
 'exitStressMonths':'月','housingBurdenThreshold':'收入比例','eventPersistenceMonths':'月',
 'eventCooldownMonths':'月','regionalPassengerHouseholds':'户/代表出行户','regionalBoundaryMeters':'m',
 'freightHandlingMinutes':'min','freightTonnesPerWorker':'吨/就业者/典型日','externalRoadMinutes':'min',
 'truckTonnes':'吨/车','workingDaysPerMonth':'日/月','carCostPerKm':'模拟币/km',
 'carParkingFee':'模拟币/旅程','developmentPaybackYears':'年','officeClusterRadius':'m',
 'officeClusterWorkers':'实际就业者','siteInfillRadius':'m','centralitySources':'网络采样源',
 'centralityMinutes':'min','cbdAccessJobs':'岗位',
}
for key,value in POLICY.items():
    if isinstance(value,(int,float)):
        UNITS.setdefault(key,'min' if key.endswith('Minutes') else '月' if key.endswith('Months') else '无量纲系数')
        if 'Population' in key:UNITS[key]='岗位/人'

LABELS=dict(housingBaseDemand='基础住房需求',pendingHousingMultiplier='待安置住房需求倍率',commercialBaseDemand='基础商业岗位需求',commercialPopulationDemand='人均商业空间需求',officeExternalDemand='外部办公空间需求比例',officePopulationDemand='人均办公空间需求',industrialExternalDemand='外部工业空间需求比例',industrialPopulationDemand='人均工业空间需求',warehouseBaseDemand='基础仓储岗位需求',warehouseExternalDemand='外部仓储需求比例',warehousePopulationDemand='人均仓储空间需求',minimumDevelopmentDemand='最低开工需求比例',boardingMinutes='上车时间',alightingMinutes='下车时间',lowFrequencyHeadway='低频时刻表阈值',streetSeedMonths='初始配路期限',streetGrowthRadius='支路周边开发半径',streetGrowthMinimumBuildings='支路周边最低建筑数',walkMaximumMinutes='最长步行旅程',journeyMaximumMinutes='最长完整旅程',parkingMinutes='停车接驳时间',transferPenaltyMinutes='换乘额外阻抗',carCostPerKm='汽车公里费用',carParkingFee='停车费用',workMaximumMinutes='最长可接受通勤',workingDaysPerMonth='每月代表工作日',jobOfficeExternal='外部办公岗位比例',jobCommercialPopulation='人均商业岗位',jobOfficePopulation='人均办公岗位',jobIndustrialExternal='外部工业岗位比例',jobIndustrialPopulation='人均工业岗位',jobWarehouseExternal='外部仓储岗位比例',jobWarehousePopulation='人均仓储岗位',developmentPaybackYears='开发收益评估期限',priceSmoothing='地价平滑速度',rentSmoothing='租金平滑速度',unemploymentStressMonths='失业压力累计期限',redevelopVacancyMonths='空置重建等待期',minimumOfficeShare='中心最低办公面积比例',cbdAccessJobs='中心最低可达岗位',dominantUseShare='城区主导用途比例',officeClusterRadius='办公集聚衰减距离',officeClusterWorkers='办公集聚饱和就业数',siteInfillRadius='填补街区的偏好距离',centralitySources='中心性采样节点数',centralityMinutes='网络中心性衰减时间',autoLanesPerMonth='每月自动支路上限',blockTargetArea='目标街区面积',laneMaximumLength='开放支路最大长度',parkPerBuildings='公园配置建筑数',plazaPerBuildings='广场配置建筑数',householdSpace='每户使用住宅面积',walkingMetersPerMinute='步行速度',trafficIterations='交通分配轮次',priceMonthlyLimit='地价月度涨跌上限',districtCellMeters='城区识别网格',districtPersistenceMonths='城区标签稳定期',districtJoinMeters='相邻城区合并距离',cbdMinimumBuildings='中心最低建筑数',cbdMinimumJobs='中心最低岗位数',cbdMinimumEmployed='中心最低实际就业',carCO2KgPerKm='汽车单位里程排放',constructionBaseMonths='基础施工期限',relocationStressMonths='压力搬迁阈值',exitStressMonths='压力迁出阈值',housingBurdenThreshold='住房支出负担阈值',eventPersistenceMonths='事件持续期',eventCooldownMonths='同类事件冷却期',regionalPassengerHouseholds='区域出行家庭抽样周期',regionalBoundaryMeters='区域铁路门户边界距离',freightHandlingMinutes='铁路货物装卸时间',freightTonnesPerWorker='工业就业货运强度',externalRoadMinutes='区域道路外部运距时间',truckTonnes='货车载重')

LABELS.update(streetFillThreshold='自动补路前沿街土地开发比例',frontageInfillMeters='沿街补空档距离',frontageInfillBonus='沿街补空档偏好',
    smallBlockMaximumArea='整体规划的小街区最大面积',blockInfillThreshold='街区内部补路开发比例',minimumProjectUnits='追加开发最低实际缺口',
    businessCoreRadius='商务核心衰减半径',neighbourhoodAffinityRadius='同类邻里集聚半径',
    officeProjectShare='单个办公项目需求份额上限',officeFootprintMaximum='办公标准层最大占地',
    residentialFootprintMaximum='住宅单栋最大占地',cbdMinimumOffices='中心最低办公楼数量',
    cbdOfficeNeighbourMeters='中心办公楼最近邻上限',schoolResidents='学校人口配置',clinicResidents='诊所人口配置',
    parkResidents='社区公园人口配置',plazaJobs='广场岗位配置',parkSeparation='公园最小间距',
    plazaSeparation='广场最小间距',schoolSeparation='学校最小间距',clinicSeparation='诊所最小间距')

POLICY.update(renewalReviewMonths=6,renewalCooldownMonths=120,renewalMinimumAge=120,
    renewalConditionThreshold=70,renewalReturnYears=20,renewalBudgetShare=.2,
    renewalActiveLimit=2,renewalBlockVacancyShare=.6)
UNITS.update(renewalReviewMonths='月',renewalCooldownMonths='月',renewalMinimumAge='月',
    renewalConditionThreshold='状况指数',renewalReturnYears='年',renewalBudgetShare='资金比例',
    renewalActiveLimit='项',renewalBlockVacancyShare='空置面积比例')
LABELS.update(renewalReviewMonths='自动更新评估间隔',renewalCooldownMonths='同址更新冷却期',renewalMinimumAge='自动更新最低楼龄',
    renewalConditionThreshold='自动翻新状况阈值',renewalReturnYears='更新收益评估年限',renewalBudgetShare='单项目自动投资资金上限',
    renewalActiveLimit='同时进行的更新项目上限',renewalBlockVacancyShare='片区更新持续空置门槛')

def definitions(policy):
    # Retain legacy values in snapshots, but do not offer controls that no
    # longer influence the population/catchment-based facility model.
    retired={'parkPerBuildings','plazaPerBuildings'}
    return {key:dict(label=LABELS.get(key,key),value=value,unit=UNITS[key],version=policy['version']) for key,value in policy.items() if key in UNITS and key not in retired}

ROAD_TYPES = {
    'lane': dict(name='小路', width=7, speed=18, capacity=180, cost=350, walk=True),
    'street': dict(name='普通路', width=14, speed=35, capacity=600, cost=900, walk=True),
    'avenue': dict(name='主干道', width=24, speed=50, capacity=1600, cost=1800, walk=True),
    'highway': dict(name='快速路', width=30, speed=90, capacity=3200, cost=3200, walk=False),
    'motorway': dict(name='高速公路', width=36, speed=110, capacity=4200, cost=4800, walk=False),
    'path': dict(name='步道', width=4, speed=5, capacity=0, cost=150, walk=True),
    'metro': dict(name='地铁', width=10, speed=75, capacity=0, cost=18000, walk=False),
    'train': dict(name='铁路', width=12, speed=110, capacity=0, cost=10000, walk=False),
    'tram': dict(name='有轨电车', width=8, speed=35, capacity=0, cost=6000, walk=False),
}

ROAD_KINDS = frozenset(('lane','street','avenue','highway','motorway','path'))
DRIVABLE_ROADS = ROAD_KINDS - {'path'}
FRONTAGE_ROADS = frozenset(('lane','street','avenue'))



TRANSIT_TYPES = {
    'bus': dict(name='巴士', speed=35, capacity=70, vehicleCost=2000, kmCost=8),
    'tram': dict(name='有轨电车', speed=35, capacity=220, vehicleCost=6500, kmCost=16),
    'metro': dict(name='地铁', speed=75, capacity=900, vehicleCost=18000, kmCost=38),
    'train': dict(name='火车', speed=110, capacity=650, vehicleCost=20000, kmCost=45),
}



USES = {
    'residential': dict(name='住宅', rent=10, cost=1800, space=75, color='#96ae7b'),
    'commercial': dict(name='商业', rent=26, cost=2000, space=35, color='#d4ac67'),
    'office': dict(name='办公', rent=22, cost=2400, space=25, color='#7d9ea8'),
    'industrial': dict(name='工业', rent=12, cost=1000, space=70, color='#af9fba'),
    'warehouse': dict(name='仓储', rent=8, cost=700, space=120, color='#ada18e'),
}


TABLE_UNITS=dict(road=dict(width='m',speed='km/h',capacity='车辆/h',cost='模拟币/m'),
    transit=dict(speed='km/h',capacity='人/辆',vehicleCost='模拟币/辆/月',kmCost='模拟币/车·km'),
    use=dict(rent='模拟币/m²/月',cost='模拟币/m²',space='m²/户或岗位'))

def catalog(policy):
    import copy
    return copy.deepcopy(dict(version=policy['version'],parameters=definitions(policy),roads=ROAD_TYPES,transit=TRANSIT_TYPES,uses=USES,units=TABLE_UNITS))
