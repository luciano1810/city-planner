# 城市模拟逐项实现核对

日期：2026-10-21；模型：`shanhai-city-8`。本表对应需求文档全部编号，不将“存在一个入口”视为整个功能已验收。

v8 修正独立厂房、仓库照搬合并地块外框而产生台阶墙体的问题，按实际道路方向在用地内放置规整矩形主体；原有存档的建筑保持原状。相关算法、11 项回归与重新生长案例见 [工业建筑轮廓修正](city-industrial-footprints.md)。

v7 修正重复的双栋/四栋模板，新增连续沿街地块、偏心围合庭院、折转小巷与侧园组团；建筑数量随实际边长变化，并按实际折转路径计算步行距离。详见 [街区多样性](city-block-variety.md)。 修复后的 18 项相关回归、2 项庭院路径复查及 9 项 JavaScript 检查通过；日志和自然案例结果集中记录在该文档。 相同规则路网自然生长 48 月有 156 栋建筑，曲线案例有 164 栋，二者均无建筑重叠、占路、侵水或断连。

v6 新增完整小街区土地划分和共享通路，支持整块建筑、公园广场、两栋及多栋建筑院落，并修正内部补路与需求门槛，见 [街区布局验证](city-block-layouts.md)。v5 针对建筑空隙过大的反馈，增加靠街轮廓、同侧空档优先和开发比例约束的补路；不能以用途集聚指标代替沿街连续性验收。v4 修正了用户指出的办公零散、配套扎堆和高度不成群问题，新增分用途集聚、办公项目规模限制、扩建优先和更严格的 CBD 条件，不能继续用 v3 的 CBD 标签证明楼群形态合格。v3 已补齐区域铁路客货运、街区内部连通分割、货运用地合并、局部地块重算、交通分组复用、集中校准及性能实测。以下覆盖全部 134 个功能编号，区分可运行功能、需求允许的模型抽象与实测规模限制。功能入口、算法结果和性能容量分别验收，不把加载万栋建筑等同于支持十万人口实时演化。

“已测试/实操通过”表示有自动化或浏览器证据；“实现”表示已核对代码；“简化实现”说明当前模型抽象，完整要求仍以原需求为准。未以删除原需求的方式宣称全部达标。

核心证据：[城市回归](../terrain-atlas/tests/test_city.py)、[地形与自主生长](../terrain-atlas/tests/test_urban.py)、[v3 连通街区/区域铁路/经济对照](../terrain-atlas/tests/test_city_v3.py)、[v4 集聚与扩建回归](../terrain-atlas/tests/test_city_v4.py)、[v5 沿街填充回归](../terrain-atlas/tests/test_city_v5.py)、[新版形态验证](city-frontage-validation.md)、[v4 集聚验证](city-clustering-validation.md)、[v3 历史验收](city-realism-validation.md)、[实现说明](city-implementation.md)。

历史 v6 一次集中 `npm run test:city` 通过 69 项 Python、9 项 JavaScript 几何及前端/Electron 语法。新增 [小街区回归](../terrain-atlas/tests/test_city_v6.py)，自然运行与实操证据见 [小街区布局验证](city-block-layouts.md)。未运行无关地形全集。

| 编号 | 功能 | 状态 | 代码入口与实际覆盖 |
| --- | --- | --- | --- |
| SIM-001 | 模拟时钟与运行控制 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：暂停、月步进、1/3/6 倍与一年逐月推进；模拟与动画分离。 |
| SIM-002 | 多时间尺度 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：早高峰、平峰、晚高峰代表日，月度市场，年度收支；不逐秒调度。 |
| SIM-003 | 更新依赖 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：固定月更新次序，竣工后才入住，编辑和模拟事务回滚。 |
| SIM-004 | 随机性与稳定性 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：随机状态、稳定 ID、完整恢复继续一致；地价限幅及城区惯性。 |
| SIM-005 | 空城启动与区域情景 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：有界迁入、外部岗位需求与可重设区域货运门户。 |
| WORLD-001 | 世界创建与建设阶段 | 实现 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：实际地形随城市固定，保存后返回世界设置。 |
| WORLD-002 | 坐标与单位 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：世界米制与屏幕坐标分离；前后端曲线几何一致。 |
| WORLD-003 | 建设适宜性 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：水体几何、面内采样与坡度；地块详情显示建设因素。 |
| WORLD-004 | 水体与地形精度 | 简化实现 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：水体掩膜与连续河道共同避让；双线性高程插值不增加原始精度。 |
| WORLD-005 | 地形后续修改 | 文档允许简化 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：建设期间锁定地形，没有局部整地编辑器。 |
| ROAD-001 | 绘制与编辑 | 实现 | [geometry.py](../terrain-atlas/backend/city/geometry.py)、[city.js](../terrain-atlas/renderer/city.js)：曲线/折线、吸附、拖点、预览、草稿保留、撤销；地形/重叠/建筑冲突返回位置并在图上标记。 |
| ROAD-002 | 道路属性 | 已测试、实操通过 | 高速公路、快速路、普通路、小路可直接绘制；保留主干道和步道。等级联动宽度、速度、容量、成本、步行与沿街开发；小路支持手绘和自动生成。 |
| ROAD-003 | 路口与拓扑 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：同层交叉拆分、丁字连接、跨层端点连接；重复、自交和短线拒绝。 |
| ROAD-004 | 跨河与坡度 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：水面需桥隧，坡地限建、速度/容量/费用修正。 |
| ROAD-005 | 步行网络 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：步行图、地面接驳、独立步道与真实邻里小径；高速公路和快速路无步行；改级后不会留下非法地块步行连接。 |
| ROAD-006 | 出入口 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：建筑入口到临街接入口，不绕行到整条路的端点；工业按门户货运。 |
| ROAD-007 | 升级与拆除影响 | 已测试、实操通过 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：所有等级及自动小路可修改，保留来源；拓宽检查建筑、公共空间和保护用地，失败回滚。道路变动只重算变动范围及其邻近临街地块，远处地块身份、边界与价格保持；关键网络与交通仍全网重建，不能误称所有计算均严格增量。 |
| ROAD-008 | 撤销语义 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：编辑批次 20 步撤销；模拟后清空；关键编辑前有磁盘检查点。 |
| PARCEL-001 | 开放道路旁的开发 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：开放道路两侧有不同临街宽度、进深和面积的地块；v5 缩短过深地块，允许合格的较小临街地块。 |
| PARCEL-002 | 闭合街区与细分 | 已测试 | [planning.py](../terrain-atlas/backend/city/planning.py)：大街区递归预留道路；空白小街区按 [blocks.py](../terrain-atlas/backend/city/blocks.py) 整体分配为单一用地、双建筑或多建筑院落，建筑用地与共享空间覆盖可用土地。 |
| PARCEL-003 | 大街区内部 | 已测试 | [planning.py](../terrain-atlas/backend/city/planning.py)：自动支路优先连接两侧已有街道，父路先建；一条冷启动连接后，随附近可用土地开发比例扩展，未接入腹地不开发。 |
| PARCEL-004 | 几何合法性 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：扣除道路、水体和既有地块，拒绝碎小/陡坡候选；测试检查面不重叠。 |
| PARCEL-005 | 地块属性与稳定身份 | 已测试 | [development.py](../terrain-atlas/backend/city/development.py)：既有地块/建筑保持稳定；工业仓储可合并最多 5 块相邻空地，记录 assembledFrom，不能吞并道路、保护地或已占用地块。 |
| PARCEL-006 | 用途控制 | 实现 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：自动用途，支持用途偏好与保护；高度由地形限制。 |
| BUILD-001 | 建筑用途 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：住宅、商业、办公、工业、仓储五类；useAreas 容纳用途面积，当前一栋一个主用途。 |
| BUILD-002 | 形态与容量 | 已测试 | [development.py](../terrain-atlas/backend/city/development.py)：实际占地、楼层、容量、成本同源；v6 支持单栋建筑占据小街区、双/多建筑分期建设，仍受实际需求限制；v5 建筑靠街，面积上限限制进深，保留临街宽度；标准层面积有个体变化，办公首期规模受需求份额约束，已入住建筑先评估扩建；真实后部开口院落保留。 |
| BUILD-003 | 视觉表达 | 实操通过 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：小住宅、板楼、塔楼、院落、商铺、厂房和仓库具有不同真实轮廓与屋顶；地图阴影不改变实际占地。 |
| BUILD-004 | 开发候选 | 已测试 | [development.py](../terrain-atlas/backend/city/development.py)：候选地按道路中心性、邻里集聚、实际居民、运营公交、地形和收益排名竞争，按同道路同侧沿街距离优先填充双侧已占用的空档。 |
| BUILD-005 | 开发收益 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：土地与地形建设成本、收益周期及项目上限；在建计入预期供应，采用简化开发能力。 |
| BUILD-006 | 生命周期 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：施工、使用、空置、加层、重新开发；不是完整施工企业模拟。 |
| BUILD-007 | 入住与迁入 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：住房不自动造人、企业岗位和匹配就业分开；拆迁记录迁出。 |
| BUILD-008 | 空置与衰退 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：持续空置阈值才更新，断连保留建筑。 |
| BUILD-009 | 原因解释 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：选中显示地形、接入、收益/需求阻碍、容量与占用。 |
| PEOPLE-001 | 人群与家庭属性 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：每户 1–4 人、收入、汽车与住房；每户一个代表劳动者，不是全龄个体模型。 |
| PEOPLE-002 | 城市迁入迁出 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：有限住房、可负担性、岗位约束迁入，压力累积后迁出。 |
| PEOPLE-003 | 城内搬迁 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：租金、岗位可达、服务和环境影响住房评分，压力阈值避免逐月无成本换房。 |
| PEOPLE-004 | 不同人群偏好 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：收入、汽车拥有和费用时间价值影响路线与住房选择。 |
| PEOPLE-005 | 未满足需求 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：待安置家庭池、失业、失败通勤及拆迁迁出分别计数。 |
| PEOPLE-006 | 人口收支 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：人口逐户守恒；不模拟出生死亡，定义净自然增长为零。 |
| ECON-001 | 企业与行业 | 简化实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：每个经营建筑为一个行业群组，记录面积、岗位、成本、收入与利润；不称真实企业数量。 |
| ECON-002 | 岗位与就业匹配 | 已测试 | [urban.py](../terrain-atlas/backend/city/urban.py)：设立岗位与就业分开，实际匹配不超岗位容量。 |
| ECON-003 | 企业选址 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：开发用途考虑劳动力、集聚、地价、地形和货运；亏损群组可寻找低租金替代空间。 |
| ECON-004 | 外部经济与需求 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：区域需求与本地需求分别记录，外部参数有界。 |
| ECON-005 | 经营变化 | 简化实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：连续亏损 9 月迁址或关闭，6 月冷却；岗位随需求扩缩。 |
| ECON-006 | 货运 | 已测试 | [regional.py](../terrain-atlas/backend/city/regional.py)：独立铁路货场及区域货运服务，按实际铁路时间、装卸、短驳和日吨位容量分配；满载回退公路，断轨失效；当前按代表日汇总货流。 |
| FLOW-001 | 出行目的 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：通勤、购物、学校、公园/广场休闲、就医及返程；代表家庭频率规则。 |
| FLOW-002 | 出行对象与时段 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：每次旅程记录起终点、目的、时段、人数和完成状态，早晚分向。 |
| FLOW-003 | 目的地选择 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：工作来自匹配，购物和服务按网络时间与可用容量；偏好不是完整离散选择估计。 |
| FLOW-004 | 完整旅程 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：完整建筑入口旅程，步行/汽车/多线公交及首末段接驳。 |
| FLOW-005 | 广义出行成本 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：时间、费用/收入、候车、换乘和容量替代路径；拥挤系数为游戏参数。 |
| FLOW-006 | 不可达处理 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：替代路线/方式及失败计数；分别记录网络不连通与班次/容量/可接受时间受限。 |
| FLOW-007 | 交通拥堵 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：两轮容量延误反馈，巴士跟随道路拥堵；参数未用现实观测校准。 |
| FLOW-008 | 有限容量与选择反馈 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：满载区段阻断，寻找其他公交/汽车/步行或记失败；没有跨班次排队人群。 |
| FLOW-009 | 展示与统计一致 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：动画最多抽样 250 条，统计由后端分配产生；汽车采用每车一人。 |
| TRANSIT-001 | 三层对象 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：轨道、站点、线路分开；仅铺轨不提供乘车路径。 |
| TRANSIT-002 | 站点与接入 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：站点到地面网络的明确接入，网络等时查询；站台容量目前由车辆区段容量代理。 |
| TRANSIT-003 | 换乘 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：有步行接入才可换乘，候车/上下车成本非零。 |
| TRANSIT-004 | 线路编辑 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：创建、名称、颜色、方向、重选停站顺序、关闭站点、启停/删除服务。 |
| TRANSIT-005 | 运营参数 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：首班、运营小时、班距、容量、停站、速度和混行规则。 |
| TRANSIT-006 | 运力与车队 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：周期与班距决定车队，缩班距增加资源和月运营成本。 |
| TRANSIT-007 | 候车计算 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：高频半班距，低频下一班近似；满载改道/失败，未做班班排队仿真。 |
| TRANSIT-008 | 巴士 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：巴士使用有向道路，断路/改向会使服务失效或改路。 |
| TRANSIT-009 | 有轨电车 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：电车用独立轨道，可配置混行延误。 |
| TRANSIT-010 | 地铁 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：轨道节点、站点、地面步行连接分别保存；出入口位置自动求取，尚不能编辑多入口站厅。 |
| TRANSIT-011 | 火车 | 已测试 | [regional.py](../terrain-atlas/backend/city/regional.py)：市内和区域外铁路客运、低频服务、边界终点、独立货场与货运服务；客运不能借用货场，区域旅程必须实际乘火车。 |
| TRANSIT-012 | 网络变更 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：线路及站点变更重算服务/交通，土地市场按月响应。 |
| ACCESS-001 | 可达性类型 | 简化实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：岗位、空缺、劳动力、服务和货运机会；实际家庭按收入组与早/平/晚时段汇总。时段使用当前轮道路拥堵成本。 |
| ACCESS-002 | 时间预算 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：30/45/60 分钟机会与自选等时范围，含接驳及候车。 |
| ACCESS-003 | 机会与容量 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：可达总岗位与空缺分开，服务设施容量与访问人数分开。 |
| ACCESS-004 | 缓存与失效 | 已测试 | [development.py](../terrain-atlas/backend/city/development.py)：网络变更清缓存；按机会目的地反向求最短路，保持有向可达时间一致；源结果最多 256 个、完整旅程结果最多 24,000 个。 |
| ACCESS-005 | 地图与解释 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：地块和站点网络等时范围，具体旅程与接入/开发阻碍查询。 |
| LAND-001 | 地块价格状态 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：每块土地有价格、月变化、驱动项和历史；用途租金独立于土地单价。 |
| LAND-002 | 地价驱动 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：交通、集聚、服务、需求、稀缺、景观、坡地成本、低地、污染噪声共同贡献。 |
| LAND-003 | 用途竞争 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：用途评分竞争和收益门槛；属于支付能力代理模型，非成交/竞拍模型。 |
| LAND-004 | 租金与空置 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：有效需求、供应、空置与品质缓慢调整租金；在建只计未来供应。 |
| LAND-005 | 调整速度与惯性 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：月度平滑，土地涨跌上限 7%，没有站点固定涨价。 |
| LAND-006 | 房产估值 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：租金收益资本化，物业估值汇总不再次叠加土地价格。 |
| LAND-007 | 可负担性 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：住房与交通月支出/收入、超负担人口；导入拒绝非法收入。 |
| LAND-008 | 迁移与替代 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：家庭压力搬迁/迁出，经营群组亏损迁址；受真实可用空间限制。 |
| LAND-009 | 供给反馈 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：新供应进入入住、空置、需求与租金反馈。 |
| LAND-010 | 地图和历史 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：地价、租金、空置、涨跌图层，地块历史及城区 P10/中位/P90。 |
| DISTRICT-001 | 识别依据 | 简化实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：400 m 初始格网后按邻接与网络连通聚类，依据用途面积、活动与历史。 |
| DISTRICT-002 | 城区类型 | 已测试 | [urban.py](../terrain-atlas/backend/city/urban.py)：居住、商业、工业仓储、办公、混合、CBD；新版默认至少 6 栋建筑含 5 栋有办公近邻的办公楼、800 岗位、500 名实际办公商业就业者及办公份额/可达性门槛；单栋大办公楼和高层住宅不构成 CBD。 |
| DISTRICT-003 | 自然形成条件 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：用途竞争使用就业、服务、环境、地形、货运与土地成本。 |
| DISTRICT-004 | 集聚与副中心 | 已测试 | [development.py](../terrain-atlas/backend/city/development.py)：分用途邻里亲和度、真实路网机会形成的持久经济核心、需求支持的高度梯度；[urban.py](../terrain-atlas/backend/city/urban.py) 按实际就业区分主副中心。不保证每个城市都有 CBD；本次自然案例不能代替多中心普遍性验证。 |
| DISTRICT-005 | 历史惯性 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：持续 3 月切换标签，城区保留父区和形成月。 |
| DISTRICT-006 | 城区查询 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：自然边界、用途、日夜人口、岗位、价格分位、流入流出、发展阶段和完整旅程主方式占比。 |
| ENV-001 | 环境影响 | 简化实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：工业污染/快速路噪声邻近指数、景观质量；非物理浓度。 |
| ENV-002 | 公共服务 | 已测试 | [urban.py](../terrain-atlas/backend/city/urban.py)：自动或手动公园、广场、学校、诊所；按人口/岗位及已有步行覆盖选址，同类最小间距约束，真实接入、容量、访问与费用。 |
| ENV-003 | 排放与风险 | 简化实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：汽车 0.17 kg/km 明确为可配置系数；低地邻水只作为地形代理指数。 |
| FIN-001 | 建设与维护成本 | 简化实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：分项累计建设、道路/站点/设施维护；车辆按租赁资源计入运营，未模拟购置资产与折旧。 |
| FIN-002 | 运营收支 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：运营成本与车辆/里程联动，完整公交旅程只收费一次。 |
| FIN-003 | 财政模式 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：默认沙盒保留账目，可切换预算约束，收入来自税及票款。 |
| STAT-001 | 单一数据来源 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：全部指标汇总权威状态，摘要带模型和时间；单位见实现说明与接口。 |
| STAT-002 | 多层查询 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：全市、城区、矩形范围、地块/建筑、道路、站点和线路查询。 |
| STAT-003 | 时间与分母 | 简化实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：月末存量、月流量、典型日及年度分开；代表日费用按 workingDaysPerMonth 推算，默认 22 天/月。 |
| STAT-004 | 方式占比 | 已测试 | [urban.py](../terrain-atlas/backend/city/urban.py)：完成旅程作分母，公交主方式按最长乘车距离，失败需求独列。 |
| STAT-005 | 流向图 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)、[city.js](../terrain-atlas/renderer/city.js)：实际活动 OD 按格网/目的/时段/主方式汇总，近景抽样路径；当月迁入/迁出/搬迁按实际家庭人数绘制虚线，外部采用明确标注的抽象门户。 |
| STAT-006 | 地图图层 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：用途、人口、岗位、地价、租金、空置、可达、交通、公交、发展与地形专题；站点范围用查询高亮。 |
| STAT-007 | 历史时间序列 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：城市月度历史和年鉴保存；地块历史最近 240 月，事件最近 250 条。 |
| STAT-008 | 城市年鉴与事件 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：中心、竣工、企业、年度事件；空置/拥堵/公交/通勤阈值连续 3 月、12 月冷却。 |
| STAT-009 | 解释边界 | 实现 | [urban.py](../terrain-atlas/backend/city/urban.py)：基线与方案比较提示观察变化，共同初态/期限/参数不同会警示。 |
| STAT-010 | 导出 | 实现 | [reporting.py](../terrain-atlas/backend/city/reporting.py)：每项统计带单位、时间、范围、样本和估算属性；CSV 各列注明口径并逐行输出模型版本，JSON 含完整字典。 |
| UI-001 | 工作模式 | 实操通过 | [city.js](../terrain-atlas/renderer/city.js)：世界创建与建设分离；建设、交通、观察分面板，地图主导。 |
| UI-002 | 工具冲突与键盘 | 实操通过 | [city.js](../terrain-atlas/renderer/city.js)：Enter、Esc、Backspace、空格平移和撤销；切换工具保留草稿。 |
| UI-003 | 即时预览 | 实操通过 | [city.js](../terrain-atlas/renderer/city.js)：前端即时曲线、后端地形/成本预览，等待状态、失败保留输入。 |
| UI-004 | 对象详情 | 实现 | [city.js](../terrain-atlas/renderer/city.js)：对象详情、开发约束和地形因素；失效线路保存并定位中断区间。 |
| UI-005 | 城市反馈 | 实现 | [city.js](../terrain-atlas/renderer/city.js)：核心/展开统计、完整事件历史；竣工/配套/企业/中心事件可定位，城市整体事件保留整体说明。 |
| UI-006 | 可访问性 | 简化实现 | [city.js](../terrain-atlas/renderer/city.js)：中文标签、键盘快捷键、坐标输入和对象列表、减少动态支持；未经过专业读屏与无障碍工具审计。 |
| UI-007 | 地图层级与缩放 | 实操通过 | [city.js](../terrain-atlas/renderer/city.js)：远景隐藏空地块细线、细小路径及站名，建筑/道路按视口裁剪；v3 历史万栋地图总览实测 83.4 FPS、输入 P95 49.5 ms。没有宣称实现瓦片引擎。 |
| SAVE-001 | 完整存档 | 已测试 | [service.py](../terrain-atlas/backend/city/service.py)：实际地形、城市、随机状态、运行态、参数、企业/公共空间全部保存。 |
| SAVE-002 | 保存原子性与恢复 | 已测试 | [service.py](../terrain-atlas/backend/city/service.py)：gzip 临时文件、fsync、原子替换；读完校验才建立新会话。 |
| SAVE-003 | 版本兼容 | 已测试 | [engine.py](../terrain-atlas/backend/city/engine.py)：支持 v1/v2/v3/v4/v5/v6/v7→v8，保留既有建筑与原有校准值，补充新增参数及经济核心；迁移提示不承诺跨模型结果一致，旧建筑不被强制搬移。 |
| SAVE-004 | 建设命令与检查点 | 实现 | [service.py](../terrain-atlas/backend/city/service.py)：稳定 ID、编辑命令、破坏性编辑前存档、分支检查点。 |
| COMPARE-001 | 分支方案 | 已测试 | [service.py](../terrain-atlas/backend/city/service.py)：共同检查点复制，原方案不被分支操作修改。 |
| COMPARE-002 | 比较条件 | 已测试 | [service.py](../terrain-atlas/backend/city/service.py)：检查初态、月份、情景、模型迁移与校准；不承诺分支随机事件一一配对。 |
| COMPARE-003 | 比较输出 | 实现 | [service.py](../terrain-atlas/backend/city/service.py)：人口、住房、就业、通勤、可达、客流、价格/租金、空置和费用差异，地价差异地图。 |
| TECH-001 | 职责分离 | 实现 | [service.py](../terrain-atlas/backend/city/service.py)：Python 权威模拟，Electron/HTTP 共用服务，Canvas 只渲染与提交命令。 |
| TECH-002 | 几何工具 | 实现 | [service.py](../terrain-atlas/backend/city/service.py)：Shapely 缓冲/裁剪/STRtree，层级连通自己控制；依赖锁定主兼容范围。 |
| TECH-003 | API 与增量 | 实现 | [service.py](../terrain-atlas/backend/city/service.py)：命令/推进/预览/查询/比较/摘要/存储接口，revision 防过期；常规响应不重复传地形。 |
| TECH-004 | 空间与计算分层 | 已测试 | [development.py](../terrain-atlas/backend/city/development.py)：STRtree 几何索引、邻域地块更新、400 m 区域/住址/收入/汽车分组及路线复用；逐人分配公交容量，反向机会场保持有向可达性。全局网络变化仍重算交通。 |
| NFR-001 | 首期规模 | 实操通过 | [engine.py](../terrain-atlas/backend/city/engine.py)：8×8 km 真实地形闭环已运行；世界面积上限不等于城市容量保证。 |
| NFR-002 | 性能验收基准 | 历史实测，规模受限 | v3 的 1.07 万人口城市与万栋/十万人口候选均测量；界面 FPS/P95 达到初始目标，十万人口恢复加一月计算超过 120 秒。v5 不沿用旧版性能保证，新实验记录逐月耗时。 |
| NFR-003 | 一致性与可恢复性 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：输入和占用一致性校验、失败事务回滚；交通有界轮次结束后记录时间变化及收敛标记，未收敛明确显示近似结果。 |
| NFR-004 | 本地与离线 | 实现 | [engine.py](../terrain-atlas/backend/city/engine.py)：核心完全本地，Electron 隔离、服务令牌/来源限制已有服务测试。 |
| NFR-005 | 可调参数 | 已测试 | [parameters.py](../terrain-atlas/backend/city/parameters.py)：urban-8 配置定义出行、容量、需求、开发、价格、迁移、用途集聚、办公规模、配套间距、沿街填充与补路开发门槛，带中文标签、单位及版本；界面可修改策略，存档保存校准表。 |
| TERRAIN-001 | 地块地形摘要 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：terrain.features 保存地形摘要和约束；水体、连续河道与高程网格共同作用。 |
| TERRAIN-002 | 交通与工程联动 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：相同几何在坡地的工程成本和行驶时间更高；实际曲线爬升可查。 |
| TERRAIN-003 | 土地与开发联动 | 已测试 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：建设倍率、地价贡献、用途评分和地形高度上限联动。 |
| TERRAIN-004 | 查询与统计 | 实操通过 | [geometry.py](../terrain-atlas/backend/city/geometry.py)：地块地形详情、专题地图、工程费用和城市地形统计。 |
| AUTO-001 | 自动社区支路 | 已测试 | [planning.py](../terrain-atlas/backend/city/planning.py)：闭合街区递归预留走廊、每月最多建 3 条支路；初始连接后至少 3 栋邻近建筑，外扩开发比例 52%、内部细分独立门槛 28%，开放道路保留地形引导的 130–210 m 支路策略；默认街区目标面积 22,000 m²。 |
| AUTO-002 | 入口、院内及邻里小径 | 已测试 | [urban.py](../terrain-atlas/backend/city/urban.py)：入口/院内小径与近邻步行连接；邻里路径及朝向共享院落的入口有真实图边，公共设施通过其地块通道接入，自动路径随存档恢复。 |
| AUTO-003 | 多样建筑与开放空间 | 已测试 | [development.py](../terrain-atlas/backend/city/development.py)：五种用途、不同占地及院落、办公核心高度梯度；[urban.py](../terrain-atlas/backend/city/urban.py) 生成有服务范围和间距的公园、广场、学校与诊所，均占真实土地并参与活动；小街区可由整块公园/广场占用，共享空间单独记账并保留通行。 |
| AUTO-004 | 恢复与控制 | 已测试 | [urban.py](../terrain-atlas/backend/city/urban.py)：自动配套开关、成长状态恢复、旧版迁移和工具草稿保留。 |

## 综合验收场景追踪

| 场景 | 证据及状态 |
| --- | --- |
| AC-01–04 | 临街地块、闭合街区递归补路、交点层级、公制几何与既有地块保持检查。 |
| AC-05–06 | 生长、施工不造人、真实住房容量与人口守恒检查。 |
| AC-07–08 | 水体桥隧、唯一道路删除；新增两岸同初态有桥/无桥 12 月市场对照，西岸可达岗位从 0 到 200，地价依网络响应。 |
| AC-09–11 | 四种公交、无服务无客流、班距成本、满载回退；新增独立铁路货场容量及断轨失效检查。 |
| AC-12–13 | 跨层不虚构连接及站点接入检查；新增巴士→地铁真实步行换乘案例，完整旅程一次、上车两次。 |
| AC-14–16 | 无需求不强制开发、供应与租金反馈；固定租金/收入的 10 月压力迁移对照及人口收支守恒。 |
| AC-17–19 | 中心/副中心持续期、单栋办公和高层住宅不误判；v4 增加办公楼近邻与规模约束，并用空路网自然生长复核楼群。副中心仍由控制条件案例验收，不声称每个城市必然多中心。 |
| AC-20–22 | 汇总与下钻、恢复继续、独立分支及比较条件检查；当前回归覆盖恢复后的继续一致性，覆盖 v3/v4 旧档几何和校准保留。 |

## 模型边界和支持规模

- 当前完整可玩实测是约 1.07 万居民、148 栋多层/大型建筑、5 条四模式客运线路的自然生长城市。万栋建筑、十万人口、20 条线路的合成样本用于容量压测，不能充当自然生长成果；月计算超时仍是明确的性能瓶颈。
- 交通采用代表日及有限轮次分配、家庭采用代表劳动者；公交满载采用改道/失败，站台容量由区段运力代理。车辆以租赁资源计费，地形风险为代理指数；没有逐秒微观车流、站厅多入口、车辆资产折旧或物理洪水模型。
- 中文标签、标注避让、键盘、对象列表、坐标输入及减少动态已经实现；专业读屏和无障碍审计尚未进行。
- 功能闭环与这些边界分别记录。不能宣称已实现现实城市预测模型，也不能把未来精细模型与已实现的玩法混为一谈。
