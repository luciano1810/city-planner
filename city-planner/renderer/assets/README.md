# 场景材质资产

生成方式：内置 ImageGen，2026-10-21。以下 PNG 随项目本地提供，运行时不请求在线图片。材质与树冠图集为 1254×1254 像素，车辆图集为 1280×1280 像素；树冠与车辆为透明 RGBA。原始生成图未做人工拼贴，渲染器按格位读取并进行实时预过滤、缩放和日照着色。

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
- 精细实景使用 Three.js 标准光照材质，复用屋顶、立面和金属贴图作为轻微凹凸细节；粗糙度按材质类别设置。未将这些彩色图集描述为独立法线、粗糙度或位移资产包。
- 树冠映射到弯曲冠幅网格，车辆映射到带有车顶起伏的网格，并配有车身和轮胎体积，参与实际深度遮挡及太阳投影。

这些提示词要点用于维护同一视觉方向；再次生成不保证得到逐像素相同的图像。

## 行人服装图集

`pedestrian-clothing.png` 由内置 ImageGen 生成，未使用 CLI 或外部图片服务。4×4 图集提供 16 格针织、斜纹、条纹、格纹、牛仔布和皮革基色素材；程序将它们映射到 16 套行人服装。阴影与肢体动画由实际三维模型计算，图片不承担人物姿态或日照方向。

生成提示词：

> Use case: photorealistic-natural. Asset type: PBR base-color clothing material atlas for animated miniature pedestrians in an aerial 3D city game. Create a single square texture atlas, exactly 4 by 4 equal square tiles, no gaps no padding no borders, seamless fabric swatches photographed perfectly flat orthographic, diffuse shadowless lighting with no baked shadows or highlights. Each tile is an uninterrupted full field of fabric, NOT a person, NOT a garment silhouette, NOT a fashion illustration. Row 1: warm ivory cotton knit, navy blue cotton twill, muted coral red jersey, slate gray wool. Row 2: sage green linen, mustard ochre canvas, dusty blue cotton subtle thin stripes, off-white fine blue striped shirt fabric. Row 3: muted burgundy flannel small check, beige trench coat twill, deep teal knit, charcoal black matte technical fabric. Row 4: dark indigo denim, medium washed blue denim, taupe trousers fine weave, chocolate brown leather fine natural grain. Realistic restrained fine surface variation that remains legible at small scale, no dramatic wrinkles. Tile boundaries align exactly at 25%, 50%, 75%. Fill each tile edge to edge. No text, numbers, labels, logos, objects or checkerboard. High detail 1536x1536.
