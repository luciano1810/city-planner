# 测试输入数据

本目录保存自动化测试和视觉检查使用的固定输入。测试应读取这些文件，不将运行输出写回；报告、截图和临时文件使用各自输出位置。

| 文件 | 使用者 | 覆盖内容 |
| --- | --- | --- |
| `metric-heights.json` | Python 与 JavaScript 高度格式测试 | 米制高程与水面编码 |
| `industrial-frontages.json` | 工业建筑轮廓测试 | 真实道路方向和用地几何 |
| `lighting-materials-city.json` | `test_naming.py`、`scripts/check-map-style.cjs` | 既有城市的地名及地图显示 |
| `auto-facilities-city.json` | `special-buildings.test.cjs` | 自动设施实际占地及建筑布局 |
| `block-architecture-cases.json` | `special-buildings.test.cjs` | 不规则场地、自适应体块和开窗几何 |

地图视觉检查可用 `MAP_FIXTURE` 指定其他输入，默认读取本目录中的城市。它生成的证据仍写入仓库根目录 `experiments/`，截图写入 `images/`。这些新生成的实验输出和截图均由 Git 忽略。
