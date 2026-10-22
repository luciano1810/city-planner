"""Exported metric definitions: units, sample denominators and temporal scope."""
UNITS={}
def define(unit,keys):
    for key in keys.split(): UNITS[key]=unit

define('月序号','month')
define('人','population employed movedIn movedOut relocated laborForce overburdenedPeople lowlandExposure')
define('户','households housing pendingHousing housingInConstruction')
define('岗位','jobs facilityJobs vacantJobs accessJobs publicJobs')
define('%','unemployment vacancy modeShare mainModeShare burden combinedBurden meanSlope')
define('栋','buildings plannedBuildings construction floorDistribution')
define('km','roadKm railKm autoRoadKm pathKm')
define('模拟币/m²土地','landValue landP10 landP90')
define('模拟币/m²建筑/月','rent rentByUse')
define('人次/典型工作日','trips completedTrips failedTrips boardings transfers publicJourneys tripsByPurpose taxiTrips taxiRescuedTrips taxiUnserved')
define('分钟/单程','commute commuteP90 commuteMedian meanWait taxiMeanWait')
define('无量纲','congestion floorRatio landscape pollutionExposure')
define('模拟币','treasury propertyValue constructionCost terrainEngineeringCost')
define('模拟币/月','firmProfit fareRevenue operationCost')
define('模拟币/日','maintenance revenue')
define('m²','developedArea floorArea uses buildableArea publicSpaceArea')
define('kg CO₂/典型工作日','estimatedCO2')
define('人次/典型工作日','regionalPassengers')
define('吨/典型工作日','railFreightTonnes unservedFreightTonnes')
define('车次/典型工作日','freightTrips')
define('车·km/典型工作日','freightKm vehicleKm taxiEmptyKm taxiOccupiedKm')
define('人·km/典型工作日','personKm')
define('人/km²','density builtDensity')
define('岗位/km²','jobDensity')
define('月','meanBuildingAge')
define('行业群组','firms firmOpened firmClosed firmRelocations')
define('等价岗位需求','externalDemand localDemand')
define('m/单程','commuteDistance')
define('座','parks plazas')
define('项','renewalProjects renewalCompleted')
define('模拟币','renewalSpending')
define('人','renewalRelocated renewalMovedOut')
LABELS=dict(renewalProjects='进行中的更新项目',renewalCompleted='累计交付更新项目',renewalSpending='累计更新支出',renewalRelocated='更新累计城内安置人数',renewalMovedOut='更新累计迁出人数',population='常住人口',jobs='设立岗位',employed='就业人数',commute='平均通勤',landValue='土地估值中位数',rent='住宅租金中位数',housing='可用住房',vacancy='住房空置率',constructionCost='累计建设支出',terrainEngineeringCost='现存道路地形工程增量',vehicleKm='汽车车辆里程',personKm='完整旅程人员里程',estimatedCO2='汽车排放估算',firms='经营行业群组',firmRelocations='累计群组迁址',transfers='换乘次数',boardings='公交上车人次',meanWait='公交候车及上车时间')
LABELS.update(taxiTrips='出租车完成旅程',taxiRescuedTrips='出租车补足旅程',taxiUnserved='出租车仍未满足需求',taxiMeanWait='出租车平均接客等待',taxiEmptyKm='出租车接客空驶里程',taxiOccupiedKm='出租车载客里程')
MONTHLY=set('movedIn movedOut relocated firmOpened firmClosed maintenance revenue firmProfit externalDemand localDemand fareRevenue operationCost'.split())
LABELS['facilityJobs']='设施岗位'
CUMULATIVE=set('constructionCost firmRelocations renewalCompleted renewalSpending renewalRelocated renewalMovedOut'.split())

def metric_definitions(stats,model):
    missing=set(stats)-set(UNITS)
    if missing: raise ValueError('指标缺少单位定义：'+','.join(sorted(missing)))
    result={}
    for key in stats:
        period='累计至当前' if key in CUMULATIVE else '最近结算日' if key in ('maintenance','revenue','movedIn','movedOut','relocated','firmOpened','firmClosed') else '模拟月' if key in MONTHLY else '典型工作日' if '/典型工作日' in UNITS[key] or key in ('modeShare','mainModeShare','commute','commuteMedian','commuteP90','commuteDistance','meanWait','taxiMeanWait','congestion') else '当前状态'
        sample='已完成完整旅程；失败需求另列' if key in ('modeShare','mainModeShare','commute','commuteMedian','commuteP90','commuteDistance','meanWait') else '地块等权' if key in ('landValue','landP10','landP90') else '全市实际状态'
        if key=='taxiMeanWait':sample='已完成出租车旅程等权；派单、前单结束及接客等待'
        elif key=='taxiRescuedTrips':sample='同次方式选择中其他方式均不可行、出租车实际完成的旅程'
        elif key=='taxiUnserved':sample='其他方式均不可行且出租车也未能完成的需求'
        result[key]=dict(label=LABELS.get(key,key),unit=UNITS[key],period=period,scope='全市',sample=sample,model=model,
            estimated=key in ('estimatedCO2','firmProfit','propertyValue','landValue','landP10','landP90','freightTrips','freightKm'))
    return result
