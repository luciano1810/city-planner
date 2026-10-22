# 场景材质资产

## 建筑生命周期材质（2026-10-23）

默认 Canvas 精细视图新增选址、基坑与基础、主体施工、外墙收尾四种显示阶段，完成后恢复现有建筑屋面与立面。阶段读取存档中的 `status`、`constructionProgress`，不修改工期、建筑轮廓或容量。

- `building-stages-atlas.png`：内置 ImageGen 生成的 4×4 表面图集，[完整提示词](building-stages.prompt.txt)。目前接入前 8 格：压实土、碎石、两种开挖土、模板混凝土、钢筋网、安全网和木模板。后两行的完工表面保留为候选，建成建筑继续复用原有 `roof-atlas.png`、`facade-atlas.png` 和 `roof-equipment.png`。立面和屋顶的材质叠加强度分别调整为 34% 和 40%。
- `construction-equipment.png`：内置 ImageGen 生成并校正图集边界的 2×2 透明图集，[生成和编辑提示词](construction-equipment.prompt.txt)。格位为挖掘机、塔吊俯视吊臂、成捆木模板、钢筋与卷网。未使用外部 API/CLI。首次使用按透明边界裁取并缓存物件及阴影蒙版，太阳方向决定挖掘机和料堆的短投影。
- `construction-supplies.png`：内置 ImageGen 生成的另一张 2×2 透明图集，[完整提示词](construction-supplies.prompt.txt)。包括空心砖托盘、蓝色篷布料堆、临时房和剪叉升降平台；砖料用于住宅，篷布用于办公楼与工地，升降平台用于厂房。临时房格位保留为后续场地布置素材。
- 已选址显示测量轴线、放样边界、桩点和小标牌；基坑显示开挖边缘、基础梁、局部钢筋和施工机械；主体楼板包含分区浇筑面、边模、楼梯井、柱头钢筋和料堆；收尾阶段露出外墙窗洞，安全网退至上部作业层。围挡前后分层，塔吊立柱与吊臂分别投影。
- 施工地块使用临时场地材质，完工后再显示庭院铺装。选址和施工建筑加入原有 48 MiB / 256 项建筑 LRU；进度、状态和设备贴图版本进入缓存键。同一地块仅保留当前阶段。远景和拖动预览保留简化绘制，表面图集沿用 Worker、米制纹理与预过滤缩放机制。
- 本次新增阶段绘制用于默认 Canvas 贴图模式；地图概览与开发对照 WebGL 保留原有简化状态表现。

施工主体按类型区分：低层住宅分间、门洞与局部坡屋顶骨架，公寓走廊、隔墙与楼梯，办公楼核心筒及幕墙备料，厂房长跨钢屋架与局部金属屋面。地块 ID 固定选择 4 类施工布局，并进一步变化柱距、浇筑比例与方向、核心位置和塔吊位置；进度推进不会重新随机布置。对照图包含 4 种建筑的 5 个阶段，以及每类 4 个施工布局。

验证入口：`npm run test:building-stages`；浏览器检查需要可用的 Playwright 与 Chromium。对照图和检查报告写入 `output/playwright/building-stages/`。

生成方式：内置 ImageGen，2026-10-21 至 2026-10-22。以下 PNG 随项目本地提供，运行时不请求在线图片。图集按各自的行列布局取样；树冠、车辆与屋面设备保留透明 RGBA。原始生成图未做人工拼贴，渲染器按格位读取并缓存预过滤、缩放和日照着色结果。

## 资产与提示词要点

所有表面图集使用同一要求：严格 4×4 等分，无间隔、边框、文字或场景物件；正交平视表面、无透视，柔和中性漫射光，无烘焙的方向性投影；每块尽量独立无缝重复。以下按从左到右、从上到下记录每次生成的内容要求。

| 文件 | 图集内容 |
| --- | --- |
| `roof-atlas.png` | 第 1 行：灰白、暖灰、冷灰、米白混凝土。第 2 行：旧混凝土、浅碎石、沥青卷材、浅色防水膜。第 3 行：棕陶瓦、红陶瓦、深石板、灰色瓦片。第 4 行：蓝灰锌板、浅镀锌板、炭灰钢板、鼠尾草绿金属立缝。 |
| `ground-atlas.png` | 第 1 行：4 种细骨料沥青，含新铺蓝灰、暖旧路面、少量修补与平滑深灰。第 2 行：灰石方砖、米色混凝土、矩形花岗岩、砂岩。第 3 行：橄榄绿草地、干草地、混合草地、细砾石。第 4 行：粉米色铺装、浅石灰岩、深灰石板、灰卵石。 |
| `facade-atlas.png` | 第 1 行：象牙白灰泥、暖灰粉刷、米色石灰岩、旧混凝土。第 2 行：棕砖、红砖、沙色砖、蓝灰陶砖。第 3 行：浅灰面板、炭灰面板、银色金属、蓝灰面板。第 4 行：4 种中性蓝灰/烟色玻璃，轻微反射与分格。前 3 行不包含窗洞，窗格由渲染器绘制。 |
| `landscape-atlas.png` | 第 1 行：石板蓝湖水、青绿河水、深蓝灰水面、淡青喷泉水，小尺度涟漪，无岸线与强反光。第 2 行：冷灰细砾、暖米色砾石、灰碎石、压实棕砾。第 3 行：深橄榄草地、鲜绿草地、干绿褐草地、矮三叶草。第 4 行：干土、沙地、红黏土、深色覆盖土。 |
| `tree-canopies.png` | 2×2 透明树冠：橡树、绿枫、悬铃木、小叶行道树。真垂直俯视摄影质感，细叶片、树冠层次、中性漫射光；无地面、树干、文字和投影。 |
| `tree-species.png` | 4×4 透明树冠，16 种独立轮廓与叶片纹理。第 1 行：伦敦悬铃木、英国橡树、榆树、椴树。第 2 行：黄绿银杏、柔和铜红枫、淡粉樱花、浅绿白桦。第 3 行：伞形赤松、蓝云杉、冷杉、窄冠柏树。第 4 行：垂柳、羽状棕榈、少量乳白花的广玉兰、少量粉花的紫薇。真垂直俯视，每棵独立居中，透明边缘，不能是球形塑料树或平面矢量图标。 |

| `vehicles.png` | 4×4 透明车辆，正交垂直俯视，所有车头朝上，保留车窗、轮胎、后视镜和车灯。第 1 行：白色紧凑车、红色紧凑车、深蓝轿车、金色掀背车。第 2 行：银色旅行车、炭灰轿车、白色 SUV、蓝色 SUV。第 3 行：绿色轿跑、酒红轿车、奶油色掀背车、黑色商务车。第 4 行：白色配送车、银色小型厢车、白色服务车、深蓝旅行车。无地面、文字、投影和网格；柔和中性光照。 |

## 在渲染中的使用

- `material-catalog.js` 保存格位、米制重复尺寸和用途，不依赖图片文件名猜测种类。
- 64 块原始表面图块映射为沥青、铺装、屋面、屋瓦、金属、外墙、玻璃、草地、碎石、水面、泥土和路缘的多种变体；车漆与标线磨损另由程序生成。
- 地块、建筑和道路的标识作为固定种子；同一个对象重开后保留材质。道路平均颜色经过约束，避免每条路形成明显的拼接色块。
- 渲染器缓存 256、128、64、32、16、8、4 像素级别，根据屏幕投影选择合适的细节级别，避免缩放闪烁和条纹混叠。
- 20 种树冠各有冠幅、树高和分区搭配。单条道路统一树种，公园和庭院混植，广场边缘允许棕榈及花树。
- 树冠与建筑投影由同一太阳时钟驱动；图片本身不承担太阳方向计算。树冠缓存只保留当前小时的着色版本，避免跨昼夜运行不断积累。
- 精细视图默认使用 Canvas 贴图绘制，不创建 WebGL 上下文。树冠、车辆复用透明图集；建筑屋顶、立面和设施按当前显示密度预绘制为位图，并由 48 MiB、256 项上限的 LRU 缓存管理。
- 原 Three.js 渲染器仅保留为开发对照，可通过 `CityScene.configure({renderer:"webgl"})` 显式启用。日常显示不计算树冠网格、实时阴影图和 SSAO。
- 日照阴影采用缓存透明蒙版与二维投影，交通动画仍按实时位置、朝向和信号运行。

这些提示词要点用于维护同一视觉方向；再次生成不保证得到逐像素相同的图像。

## 绿化与铺装细化（2026-10-22）

新增 `garden-canopies.png`，由内置 ImageGen 生成，透明 RGBA，完整提示词见 [garden-canopies.prompt.txt](garden-canopies.prompt.txt)。4×4 等分：前两行是橡树、绿枫、悬铃木、小叶行道树、伦敦悬铃木、英国橡树、榆树、椴树的分层树冠；第三行是黄杨、月桂、金绿绣线菊、海桐；第四行是白花地被、粉花矮灌木、观赏草和混合花境。树冠及灌木使用不同格位，原树种图集继续提供其他树种。

- 图集格位首次采样时保留主株的连通轮廓及抗锯齿边缘，避免邻格零碎叶片混入。树冠以 256 像素缓存，街区远景逐级使用 128～8 像素预过滤图片，阴影复用 128 像素透明蒙版；冠内明暗按太阳方向旋转，地面接触阴影复用一张小图。按小时清理旧光照和缩小图片版本。
- 花池、石块、座椅和喷泉地面预绘制到有容量上限的位图缓存，避免逐帧重复构建渐变和石材细节。
- 人行道采用世界坐标中的 1.2 米石板及细接缝。基础材质只提供细微石面色差，避免原照片接缝与程序接缝叠成多重网格。
- 路口先清除原直角路缘，再铺接弧形路面、排水边和石质路缘，消除两端的圆头描边接缝。以上均为二维绘制，无新增实时三维模型。

## 行人服装图集

`pedestrian-clothing.png` 由内置 ImageGen 生成，未使用 CLI 或外部图片服务。4×4 图集提供 16 格针织、斜纹、条纹、格纹、牛仔布和皮革基色素材；程序将它们映射到 16 套行人服装。默认二维视图按身体层高、朝向与步态预绘制行人贴图，按需缓存最多 192 张 88×112 图片（约 7.22 MiB），远景使用 8 个朝向和站姿。地面投影跟随太阳时钟，无逐帧创建画布或实时三维模型。

生成提示词：

> Use case: photorealistic-natural. Asset type: PBR base-color clothing material atlas for animated miniature pedestrians in an aerial 3D city game. Create a single square texture atlas, exactly 4 by 4 equal square tiles, no gaps no padding no borders, seamless fabric swatches photographed perfectly flat orthographic, diffuse shadowless lighting with no baked shadows or highlights. Each tile is an uninterrupted full field of fabric, NOT a person, NOT a garment silhouette, NOT a fashion illustration. Row 1: warm ivory cotton knit, navy blue cotton twill, muted coral red jersey, slate gray wool. Row 2: sage green linen, mustard ochre canvas, dusty blue cotton subtle thin stripes, off-white fine blue striped shirt fabric. Row 3: muted burgundy flannel small check, beige trench coat twill, deep teal knit, charcoal black matte technical fabric. Row 4: dark indigo denim, medium washed blue denim, taupe trousers fine weave, chocolate brown leather fine natural grain. Realistic restrained fine surface variation that remains legible at small scale, no dramatic wrinkles. Tile boundaries align exactly at 25%, 50%, 75%. Fill each tile edge to edge. No text, numbers, labels, logos, objects or checkerboard. High detail 1536x1536.

## 现实车型增补（2026-10-22）

`vehicles-real.png` 使用内置 ImageGen 生成并去除车标、字标、车牌文字；没有使用外部 CLI/API。完整最终编辑提示词见 [vehicles-real.prompt.txt](vehicles-real.prompt.txt)。这是用于城市视图的车型外观近似，非精密汽车模型。原先带车标的候选图未接入项目。

严格 4×4 排列，车头朝上，透明背景。第一行：小鹏 P7 银色、小米 SU7 蓝色、小鹏 P7 绿色、小米 SU7 紫色；第二行：Model 3、汉、ET5、007；第三行：凯美瑞、雅阁、宝马 3 系、奔驰 C 级；第四行：奥迪 A4、帕萨特、Taycan、MINI Cooper。程序按透明边界裁取车身，以米制尺寸绘制，不用图集格子宽度代替车宽。

查找的俯视参考：[小鹏官方 XPILOT 展示](https://www.xpeng.com/intelligent/xpilot)、[SU7 顶视照片](https://www.carsales.com.au/editorial/details/xiaomi-su7-is-chinese-smartphone-makers-first-car-143411/)。部分原图链接加载失败，未将这些照片直接用作游戏资产。新图集与原有 16 格共同组成 32 格车辆外观，同一个车辆 ID 重载后仍选择同一格。

### Z4 与挑战者增补（2026-10-22）

`vehicles-sport.png` 是独立的 2×2 透明 RGBA 图集，1254×1254 像素、约 861 KiB，使用内置 ImageGen 生成并定点去除鼻端徽章；完整生成和编辑提示词保存在 [vehicles-sport.prompt.txt](vehicles-sport.prompt.txt)，没有使用外部 CLI/API 或人工绘图覆盖照片。按从左到右、从上到下排列：红色 BMW Z4 G29 敞篷、蓝色 BMW Z4 G29 敞篷、橙色 Dodge Challenger、紫色 Dodge Challenger。所有车辆车头朝上，保留车窗、车灯、后视镜、双座敞篷内饰和两款车各自的车身轮廓；无车标、文字、车牌字或地面投影。

先查阅 [BMW 官方 Z4 图库](https://www.press.bmwgroup.com/global/photo/topic/4225/z4?forceSitePreference=DESKTOP) 与 [Dodge 官方 Challenger 图库](https://www.dodge.com/am/en/2023/challenger/gallery.html)，再通过浏览器实际查看 [KBB/EVOX 的 Z4 俯视照片](https://www.kbb.com/bmw/z4/2020/)和 [Autocar 刊载的 Challenger 顶视照片](https://www.autocar.co.uk/car-news/new-cars/dodge-challenger-srt-demon-170-1025bhp-farewell-v8)。参考的是 Z4 长发动机盖、双座舱、收起软顶与短尾部，以及 Challenger 长而方正的车身、宽肩、实体车顶和独立后备厢；参考照片没有作为游戏资产复制分发。生成外观是用于城市视图的车型近似。

`SurfaceVariation.vehicleAtlases` 明确记录各图集行列数，原有两张 4×4 图集保持原位；新增图集按 2×2 格位独立裁切并以透明边界确定车身范围，最终按场景中的米制外观尺寸绘制。Z4 视觉长度为 4.32 米，Challenger 为 5.03 米，仅用于外观缩放，不修改交通仿真中的碰撞或跟车尺寸。总计 36 格车辆外观；独立稳定种子让新车型约占一成，其余车辆保留此前的格位选择。车辆图片加载完成会同时使建筑与设施位图缓存失效，防止停车场永久保留加载前的简化车形。

## 体积树冠和屋顶设备（2026-10-22）

本轮使用内置 ImageGen，未使用外部 CLI/API。当时接入的图片及完整提示词（后续版本见文末）：

| 资产 | 用途与提示词 |
| --- | --- |
| `tree-volumes-v3.png` | 2×2 大叶簇树冠，替代前版过细的航拍叶纹。[提示词](tree-volumes-v3.prompt.txt)；`tree-volumes-v2.png` 为保留的上一版。 |
| `shrub-volumes-v2.png` | 2×2 黄杨、金绿灌木等低矮团块，覆盖花池与中分带。[提示词](shrub-volumes-v2.prompt.txt)。 |
| `roof-equipment.png` | 2×2 空调双风扇机组、金属通风管、屋顶设备间、玻璃天窗；按透明边界裁取并烘焙进建筑缓存。[提示词](roof-equipment.prompt.txt)。 |

屋面设备贴图替代相应的简化色块，屋顶仍按原建筑轮廓、层高、退台和设备布局绘制。太阳能板的电池格、屋顶设备短投影、女儿墙压顶、窗格反射与地面接触暗部全部进入建筑位图缓存，不增加逐帧的实时模型。喷泉的池壁、石材压顶、凹入水面与水花同样进入设施地面缓存。

## 车辆自然光修正（2026-10-22）

初版自然光修正使用 `vehicles-daylight.png`、`vehicles-real-daylight.png` 和 `vehicles-sport-daylight.png`；这些版本保留供对照，当前加载的 V2 见文末。三次编辑均使用内置 ImageGen，完整提示词分别保存于 [通用车](vehicles-daylight.prompt.txt)、[现实车型](vehicles-real-daylight.prompt.txt)、[Z4 与 Challenger](vehicles-sport-daylight.prompt.txt)。保留所有车型格位、轮廓、配色和透明背景，去掉车标，以及棚拍灯箱造成的细长白色反射，改用柔和宽面的天空反射。

首次裁切缓存时，程序仅压缩局部车漆亮峰，保护浅色车漆、深色玻璃、车灯和敞篷内饰。每款车预生成四个方向的半透明车漆受光场，运行时根据车头与世界太阳方向混合其中两格；只有一张完整车身图片，避免半透明整车重复叠加形成暗边。受光缓存上限 96 项、12 MiB，转弯与日照变化不新建画布、不重新读取像素。接触阴影缩入车底，车身投影使用带柔边留白的轮廓缓存，并按统一太阳方向计算。

## 材质对比与密集场景（2026-10-22）

对比度按材质分别调整：沥青中间调加深，浅石铺装与路缘提亮，草地和树冠保留较深的绿灰暗部；建筑侧墙和窗格降低中间调，屋顶压顶、立边与设备接触阴影形成清晰层次。车辆继续使用柔和天空反射，不随地面一起增强高光。以上处理进入材质及对象缓存，没有新增全屏对比滤镜或实时三维模型。

行道树避让使用 64 米空间格筛选附近建筑、入口和前庭，再执行原来的精确几何判断。路缘细接缝只在近景生成可见的 32 米路段，缓存最多 512 段；路口装饰缓存最多 256 项。原建筑、道路、随机种子和交通状态保持不变。

Chrome 原生图形路径、1600×1000 视口、DPR 2 的 10,000 栋建筑静态夹具：近景绘制中位数从 33.9 ms 降至 5.7 ms，街区视图从 45.3 ms 降至 15.4 ms；缓存预热后静止视图无建筑缓存失效。该容量夹具没有行驶车辆和行人；包含交通的 16 栋建筑场景近景为 3.1 ms。测量文件分别位于 `output/playwright/contrast-dense-indexed/performance.json` 和 `output/playwright/contrast-final/performance.json`，属于本机样本，不代表所有设备或城市布局。

该轮聚焦回归 42/42 通过；浏览器验证覆盖昼夜、地图与精细视图切换、Canvas 回退、缓存上限和紧凑窗口，未发现页面错误。当时的实景、建筑、广场及四车型转向光照图位于 `output/playwright/contrast-final/`。

## 当前精细材质与街道物件（2026-10-22）

下面的 PNG 均由内置 ImageGen 生成或编辑，未使用外部 API/CLI；完整提示词与每张图片一同保存。旧资产保留用于对照。

| 当前资产 | 内容与完整提示词 |
| --- | --- |
| `tree-volumes-v4.png` | 2×2 橡树、绿枫、悬铃木、小叶行道树；[提示词](tree-volumes-v4.prompt.txt)。 |
| `tree-species-volumes-v4.png` | 2×2 榆树、银杏、白桦、广玉兰；[提示词](tree-species-volumes-v4.prompt.txt)。 |
| `shrub-volumes-v3.png` | 2×2 矮灌木；[提示词](shrub-volumes-v3.prompt.txt)。 |
| `vehicles-daylight-v2.png` | 通用车辆 4×4；[提示词](vehicles-daylight-v2.prompt.txt)。 |
| `vehicles-real-daylight-v2.png` | 包含小鹏 P7、小米 SU7 的现实车型 4×4；[提示词](vehicles-real-daylight-v2.prompt.txt)。 |
| `vehicles-sport-daylight-v2.png` | 宝马 Z4、道奇 Challenger 各两色，2×2；[提示词](vehicles-sport-daylight-v2.prompt.txt)。 |
| `fountain-daylight.png` | 石质池沿、蓝色水面和水花，透明单图；[提示词](fountain-daylight.prompt.txt)。 |
| `street-furniture.png` | 2×2：暖木长椅、深绿圆桶、蓝绿双桶、深木长椅；[提示词](street-furniture.prompt.txt)。 |

树木保留用户认可的 V4，不再继续替换。车辆维持原有 36 款外观与无 logo 约束，V2 调整宽面车漆反射、车肩体积和玻璃层次；运行时仅压窄白亮峰，减少外缘的黑色描边感，继续复用四向受光缓存。

屋顶设备按用途分组，单个屋面最多 8 件；设备基座、短投影、女儿墙厚度、窗洞与窗台进入原建筑缓存。设备的顶面与侧面分开投影，旋转建筑时不再把图集中固定朝向的侧面一起转动。建筑地面阴影由根部到末端稍作渐变，仍使用共享日照时钟。喷泉进入原有设施地面缓存。

沥青减少低频云斑，加入预过滤后的真实骨料明暗；铺装减弱接缝与逐块色差。额外的路缘磨损、稀疏修补和短封缝按道路 ID、侧别与全路米制位置生成，近景才构建，并与原路缘共用最多 512 段的缓存。32 米缓存分段只分配图案归属，不重启随机序列；平移、缩放和重建缓存不会改变位置。

`street-furniture.js` 沿地面街道和主干道按稳定种子布置长椅、圆桶与双桶，局部密度不同，少量长椅旁有垃圾桶。长椅 1.8×0.65 米、圆桶 0.6×0.6 米、双桶 1.1×0.65 米，朝向道路并留出步行净空；避开路口、车行道、建筑、出入口和树根。布局仅在可见的 64 米路段生成，64 米空间索引筛选邻近障碍，缓存最多 512 段；四格贴图首次裁取后复用，转向、日照与平移不重新读像素。物件与道路纹理均为显示层，不修改存档和交通几何。

弯道衔接按实际道路折线上的接点与局部切线构造，直线和曲角共用 `roadCrossSection` 中的六层断面宽度。不同宽度的人行带在曲线内部平滑过渡，端点保留道路方向；移除原先擦除路缘后再平移描边的做法，消除白色路缘及暖色带的错台。路径仍只在可见路口生成，最多缓存 256 处。放大对照：修复前 `output/playwright/street-furniture-review/corner.png`，修复后 `output/playwright/streetscape-final/corner.png`（同一中心 `[484,579]`，38 CSS px/m）。

当前聚焦回归 **65/65 通过**，覆盖曲路/混合宽度端点连续性、道路随机细节的米制锚定、街具避让及缓存、双桶轮廓裁切、车辆方向光照与屋顶设备。记录：`output/playwright/streetscape-final/focused-tests.tap`。

浏览器验证通过昼夜、地图/精细视图切换、Canvas 回退和紧凑窗口检查，页面错误为 0、WebGL 上下文为 0。包含行驶车辆和行人的 16 栋建筑夹具，近景绘制中位数 3.4 ms（P95 4.2 ms）。记录：`output/playwright/streetscape-final/evidence.json` 与 `performance.json`；街具实景见同目录 `street-bench.png`、`street-bins.png`。

同机 Chrome 原生图形路径、1600×1000、DPR 2 的 10,000 栋建筑静态夹具：近景中位数 6.9 ms / P95 7.8 ms，街区视图 18.2 ms / P95 19.3 ms。新增街具的平均绘制成本分别约 0.07 / 0.58 ms；预热后建筑缓存未失效，街具和路面细节无重复构建，街具缓存 216/512 段、路面细节 30/512 段、曲角 46/256 处。相比前轮 5.7 / 15.4 ms，当前细节版本的总绘制耗时略有增加；街区容量样本不表示恒定 60 FPS。该夹具无行驶交通，本次隔离导入耗时约 48.6 秒。完整记录：`output/playwright/streetscape-dense-final/performance.json`。

## 拖动、缩放与首次材质准备（2026-10-23）

`CityApp.paint` 保留原绘制顺序，拆为静态 `base`、动态 `overlay` 与完整的 `all`。道路、停放车辆、街具、建筑、阴影和植被缓存后，行驶车辆、信号、行人、高架及编辑预览继续合成。悬停、道路预览和动画不清空基底；真实城市编辑、显示策略或资产变化仍使其失效。

平移通过设备像素对齐的自复制保留旧图。缩放超出直接复用范围时，按世界原点在同一画布内重新采样，只对新暴露的四边条带补画预览，避免整幅画面反复切换精细/简化状态。停止缩放 160 ms 后，在精确密度下按 192 CSS 像素小块恢复细节，每帧 6 ms 软预算。小块有 8 设备像素采样余量，分数 DPR 的边界仍对齐设备像素；建筑候选包含最长 95 米太阳投影。基底和 scratch 合计最多 64 MiB，边缘余量从最多 192 CSS 像素自适应缩小，无法容纳完整视口时回退常规绘制。

静态日照按模拟分钟采样，同一批补绘使用固定时刻。新的日照和材质完成通知合并到手势及当前批次之后，保留已有完整图像；暂停时也会完成最后一次更新。带太阳光的树源贴图保留两个小时，冠影合成缓存最多两组、280 张小图和 20 MiB；近景仍用原 V4 树冠、独立接触影和太阳投影。设施空间索引及实际 tile 边界裁剪避免在每个小块遍历全城庭院。行道树在共享障碍索引上按可见道路惰性生成，整条道路的原随机序列、树位和顺序保持不变，并保留画面外的投影来源。首次预览不生成冷街具/树冠，已有细节在手势中持续保留，停手后按小块补齐。

`material-preparation.js` 为主线程回退和 `material-worker.js` 共用像素算法。材质首次合成在一个 Worker 中串行完成，主线程只提交有界任务与转移原图集。小尺寸足够时不重新生成大图；同一静止视口对每种材质至多请求一次扩展，超预算时保留小图，避免循环淘汰和补绘。原生 Electron 从已解码的本地图集创建 ImageBitmap 并转移，Worker 不依赖 file:// fetch；扩展材质图在主线程按 96 MiB LRU 预算保留。CPU 像素加工画布声明 `willReadFrequently`，显示画布和基底仍保留默认图形路径。首次未完成的材质使用对应底色；已完成的材质另有 24 MiB / 96 张的 256px 纹理缓存，扩展图驱逐后使用相同世界周期的小图过渡。新材质按批次发布，并清理该材质的旧 mip；建筑不会随每张结果到达而重复失效。图集的分数像素裁切先归一化到原生像素画布，主线程与 Worker 的 RGBA 输出一致。出错时退回同步生成。

`SurfaceVariation.synthesize` 复用约 640 KiB 的 Float64 插值表，把节点采样地址、铺砖行列和色差移出像素循环。九组旧算法 SHA-256 基准覆盖自然材质、结构材质、铺砖、负种子及不同源图尺寸，要求输出逐字节一致。

`scripts/check-detail-interaction.cjs` 使用隔离存档、真实鼠标和滚轮输入，按当前 7200% 精细视图门槛测首次进入、暂停/运行、短/长拖动和连续缩放。记录输入到绘制 RAF 的延迟、RAF 间隔、长任务和缓存统计；RAF 不等同最终显示扫描时间。`INTERACTION_FOLLOW_TRAFFIC=1` 还要求输入期间确有可见车辆移动。所有截图、完整重绘像素对照、悬停缓存稳定性和原生 Canvas/Worker 材质 RGBA 对照都安排在计时之后，避免读回像素改变浏览器图形路径。计时目标为输入 RAF P95 ≤ 33.4 ms，停手补绘无持续超过 100 ms 的任务；脚本报告超标值，不掩盖单次停顿。


本轮验证记录：67 项受影响的缓存、材质、合成、植被与街具检查通过（`interaction-final-validation/changed-tests.log`、`material-budget-tests.log`，重合项只计一次）。Chrome 1600×1000、DPR 2 的万栋建筑夹具首次进入：绘制最大 67.7 ms、停手补绘最大 69.5 ms、RAF P95 16.8 ms；仍有一次 109 ms 冷启动长任务，不能视作完全无停顿。`interaction-final-cold/performance.json` 中悬停 5 次加离开时基底构建/补绘增量均为 0，完整重绘对照平均通道差为 0.022 / 0.187（0–255），7 类原生 Canvas/Worker 材质 RGBA 完全一致。

16 栋建筑的实际行驶车辆夹具在长拖动、连续放大/缩小时，RAF P95 为 16.7–16.8 ms，输入期间车辆持续移动，整屏重绘次数均为 0；记录 `interaction-final-moving/performance.json`。滚轮事件时间戳到 RAF 的 P95 为 33.6–33.9 ms，其中事件分发前约 31 ms，应用处理结束到 RAF 的 P95 为 2.1–2.6 ms；未把 RAF 帧率等同于输入延迟，也未放宽 33.4 ms 诊断目标。原生 Electron 的 file:// 路径完成 38 张材质、错误 0，缓存与补绘收敛，见 `interaction-final-native/verification.json`。可用 `scripts/check-detail-native.cjs` 复核本地 Worker 路径；上述生成记录均位于忽略的 `output/playwright/`。
