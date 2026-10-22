# 建成建筑外观

`renderer/building-appearance.js` 为既有建筑按固定 ID 选择外观，包含住宅 6 套、办公 4 套、商业 4 套、工业 3 套、仓储 3 套。施工状态、人口变化和重载不改变风格。

## 体量与材质

- 适合的矩形住宅加入错层、L 形、U 形组合；办公楼加入双塔、L 形和分级退台；商业楼加入围合中庭和露台组合。上下楼体共用现有几何、阴影和施工进度接口。特殊地标、复杂多体量和过小地块沿用既有布局。
- 原始 footprint、楼层、高度、容量和模拟数据保持原值；变化属于显示层。最高体量保持建筑总高度，分块不越出原始可建矩形。
- `architecture-facades-atlas.png` 是 4×4 立面图集：6 格住宅、2 格商业、4 格办公、4 格工业/仓储。每格包含两个窗跨、两个楼层。按墙长和实际楼层拟合，不使用随机纹理合成打散窗洞。贴图生效后跳过原有程序窗格，避免重影。
- `architecture-roof-zones.png` 是 2×2 透明屋顶组合图集：屋顶花园、玻璃中庭、机械设备区、太阳能阵列。每块平屋顶最多两组，自动避让高层体量、原有屋顶设备、女儿墙和其他组合；坡屋顶继续采用原有设备布置。
- 两张新增图集使用内置 ImageGen 生成，完整提示词与 PNG 一同保存在 `renderer/assets/architecture-facades.prompt.txt` 和 `architecture-roof-zones.prompt.txt`。
- 原屋顶三角面在 Canvas 中成对合并为四边形，消除屋面内部抗锯齿对角缝。原网格仍用于开发用 WebGL 路径。

## 缓存和限制

默认 Canvas 精细视图将外墙细节和屋顶组合写入原有 48 MiB、256 项建筑 LRU。立面按 256 至 8 像素预过滤并惰性缓存，16 格至多 96 张，屋顶组合最多 4 张。贴图加载版本纳入对象缓存键，加载完成请求重绘。远景保留轻量建筑体量，不制作细节贴图。新增立面与屋顶组合主要用于默认 Canvas 路径；开发用 WebGL 路径共用新体量，保留其原材质与屋顶设备。

## 验证

在 `city-planner/` 下执行：

```bash
npm run test:architecture
npm run test:architecture:visual
```

视觉脚本需可用的 Playwright/Chrome；可通过 `NODE_PATH` 和 `CHROMIUM_EXECUTABLE` 指定现有安装。脚本使用独立临时存档目录，输出到 `output/playwright/building-appearance/`，包括白天、傍晚、旋转近景和缓存检查。单位检查覆盖稳定外观、几何边界、上下体量和设备避让、存档数据不变、屋顶及 LOD 回归。
