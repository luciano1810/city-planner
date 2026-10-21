# 地图样式实现与视觉验收

## 目标与范围

参考 Apple 官方标准地图截图：
https://developer.apple.com/maps/sample-code/images/custom-callout_2x.png

在现有 Canvas 城市地图中实现其制图语言，保留模拟城市的真实道路、建筑、设施及水系。参考图中的旧金山地理、照片标记、演示紫色图钉和 Apple 标识不属于城市数据，不生成替代装饰。

## 最终验收

本地实现验收通过。检查尺寸为 1600 × 1000 与 1024 × 768，像素比 1，包含全屏、窗口、近景和远景。独立 Chromium 集成检查使用真实 Python 后端和已有城市样本；云预览浏览器被环境 URL 策略拒绝，未继续尝试绕过。

- 道路：白色普通街道、灰色主干道、细描边、同层交叉口双遍合并、高架在上层绘制。铁路保持独立线型。
- 地表：暖白陆地、浅蓝水面、淡绿公园；建筑保持真实平面轮廓，取消阴影、屋顶材质、挤出和昼夜染色。
- 层次：城区标题、分类地点、主干道路名、普通道路名按优先级布局。路名按屏幕投影弧长取样，沿路旋转并保持正向；急弯与过短路段不强行标注。
- 地点：本地 Bootstrap 图标，分类色、白色字形、文字描边、四方向位置候选；长名称最多两行。图标与名称都可以选中对应设施。
- 避让：全部标注共享屏幕碰撞空间，包含旋转路名的包围盒和悬浮控件占位。普通庭院与广场随缩放简化。
- 功能：地图视图自动切换、手动保持、选择与数据图层继续工作；普通地图不叠加全部彩色运营线路，交通图层仍显示线路。
- 视口：全屏退出、窗口调整后保留地图中心，避免偏移到空白区域。

## 迭代记录

| 级别 | 发现 | 处理 | 验证 |
| --- | --- | --- | --- |
| P1 | 上版黄色主干道、深灰建筑与参考差异明显 | 重设道路、用地、建筑与水系配色 | 城市与街区截图复核 |
| P1 | 路名全部水平，设施缺少分类符号 | 弧长取样、正向旋转、分类图标 | 几何测试、真实场景截图 |
| P2 | 广场标注在远景过密，文字偏小 | 分级隐藏普通广场，提高字号层级 | 远景 3 个地点，近景 13 个地点 |
| P2 | 标注可能被悬浮控件遮住 | 将控件边界加入碰撞空间 | 避让测试、窗口与全屏截图 |
| P1 | 全屏退出或缩窗导致地图中心漂移 | 根据拟合比例重算平移量 | 前后中心误差小于 1 米，画面仍有内容 |
| P2 | 导出可能污染屏幕标注点击区域 | 只在主 Canvas 更新点击缓存 | 代码检查，既有屏幕选择回归 |

最终截图中未发现仍需处理的 P0、P1 或 P2 问题。样本街网密度与旧金山不同，这是城市数据差异；不以增加虚构道路或地点填充画面。

## 自动验证与证据

- JavaScript：`node --test tests/*.test.cjs`，72 项通过。
- Python 预览服务：`python -m unittest tests.test_terrain.ServerTests -q`，2 项通过。
- `scripts/check-map-style.cjs`：标注不重叠、地点名称点击、全屏退出与缩窗中心保持、脚本错误为空。
- 既有模式与时间回归：自动切换滞回、手动地图模式保持、地图昼夜像素一致；1×、2×、3×、5×以及高速档的光照/日历比例正确。

截图：
- `../docs/images/map-style-neighborhood.png`
- `../docs/images/map-style-overview.png`
- `../docs/images/map-style-detail.png`
- `../docs/images/map-style-city.png`
- `../docs/images/map-style-city-close.png`
- `../docs/images/map-style-compact.png`
- `../docs/images/map-style-city-compact.png`
- `../docs/images/map-style-comparison.png`

机器记录：`../docs/experiments/map-style-evidence.json`、`../docs/experiments/map-style-city-evidence.json`、`../docs/experiments/map-views-browser-evidence.json`。

双岸河谷截图使用 `scripts/grow_valley.py` 生成并在第 12 个月保存的场景，包含 23 条道路和 194 栋建筑。界面显示的内容均来自该场景。
