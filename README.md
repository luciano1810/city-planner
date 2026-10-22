# City Planner · 山海

一个使用 Python + Electron 构建的本地地形生成与城市规划工作台。从程序化地形出发，绘制路网、发展街区、配置公共交通，观察人口、就业、土地市场与城市更新随月份演化。

地图生成、城市模拟与存档均在本机运行。项目目前以源码形式交付。

## 功能

- **生成地形**：海岛、海湾、山脉、群岛、沙漠、丘陵和冻原；支持种子、地图范围、地形起伏、河流与湖泊参数，以及最高 4096 像素输出。
- **规划城市**：绘制道路、桥隧与轨道，生成沿街地块，模拟住房、商业、办公、工业和仓储开发。
- **配置交通**：设置公交站点与线路，建设轨道交通，运营有限车队的出租车补充服务，观察通勤、可达性及货运。
- **推进模拟**：统一开始、暂停与速度控制，同步人车、昼夜及城市日历，跨月结算施工、人口、就业和财政。
- **更新街区**：建筑翻新、原址重建、片区更新，支持方案预览、安置、预算与分期施工。
- **保存与导出**：本地城市存档、独立方案对比、地图 PNG 和统计 CSV / JSON 导出。

## 快速开始

需要 **Node.js 22+**、**Python 3.11+** 和 Git。首次安装需要下载 npm、Python 依赖及 Electron 运行时。

### macOS / Linux

```bash
git clone https://github.com/luciano1810/city-planner.git
cd city-planner/city-planner
npm ci
npm run setup:electron
npm run setup:python
npm start
```

仓库根目录存放项目说明、设计文档、截图与实验资料；同名的 `city-planner/` 子目录包含应用代码。后续的 npm 命令均在该子目录执行。

macOS 安装完成后也可以双击应用目录里的 `启动山海.command`。

### Windows（PowerShell）

```powershell
git clone https://github.com/luciano1810/city-planner.git
cd city-planner/city-planner
npm ci
npm run setup:electron
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
npm start
```

应用默认使用项目内的 Python 虚拟环境，也可以通过 `TERRAIN_PYTHON` 指定已安装 NumPy 和 Shapely 的 Python 可执行文件。

## 第一次使用

1. 选择「新建地图」，调整参数并生成地形，确认后进入城市规划。
2. 绘制道路与街区，按 Enter 完成绘制；跨水道路需要桥梁或隧道。
3. 点击顶部「开始模拟」，用速度滑块从实时切换到每秒推进小时或天，观察人车活动与城市发展。
4. 在「交通」配置线路，在「观察」查看人口、地价、交通等专题。
5. 使用「存档」或 Ctrl/Cmd+S 保存；通过「文件」及「观察」导出地图和统计。

存档默认保存在 `~/.shanhai/saves`，可用 `SHANHAI_DATA_DIR` 更改数据目录。完整操作与模型说明见 [应用使用手册](city-planner/README.md)。

## 开发与测试

在 `city-planner/` 应用目录运行：

```bash
npm run preview        # 浏览器预览：http://127.0.0.1:8765
npm run test:workflow  # 界面流程相关后端、存档与服务检查
npm run test:city      # 城市模型与相关接口、前端检查
npm test               # 完整回归检查
```

以上预览和测试脚本使用 macOS / Linux 的 `.venv/bin/python` 路径。Windows 下可参照 `package.json`，将 Python 命令改为 `.venv\Scripts\python` 执行。

Electron 启动时自动启动本地 Python 服务并选择空闲端口；关闭应用时停止后端。前端使用 HTML、CSS 和 Canvas，后端使用 NumPy 处理地形、Shapely 处理城市几何。

```text
.
├── README.md
├── docs/                    # 项目目标、规则、架构与实现状态
├── examples/                # 应用内置城市案例存档
├── experiments/             # 历史资料；新实验输出默认忽略
└── city-planner/
    ├── backend/             # 地形、水文、HTTP 服务
    │   └── city/            # 城市演化、路网、开发、交通与存档
    ├── electron/            # 桌面窗口、进程管理与原生文件操作
    ├── renderer/            # 地图与城市交互界面
    ├── scripts/             # 模拟实验与诊断工具
    ├── tests/               # Python / JavaScript 回归测试
    │   └── fixtures/        # 测试与视觉检查输入数据
    └── README.md            # 详细使用手册与模型边界
```

## 文档与边界

完整项目说明从 [文档索引](docs/README.md) 开始：

- [项目目标与功能规则](docs/city-simulation-requirements.md)
- [系统架构与状态流](docs/city-implementation.md)
- [土地、建筑与城市生长](docs/city-growth.md)
- [道路、轨道与公共交通](docs/roads-and-transit.md)
- [实现状态与边界](docs/implementation-status.md)

地图使用虚构的本地米制坐标，不对应真实地理位置。水系与城市经济均为简化模型，适合实验和探索；地图范围上限不代表可承载同等规模的城市模拟。

当前地形使用浮点米制高度格式，不兼容旧版 uint16 地图，需要重新生成。应用尚未打包为独立安装程序。
