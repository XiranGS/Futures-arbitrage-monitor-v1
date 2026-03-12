# 化工能源期货实时套利监控系统

[![Python](https://img.shields.io/badge/Python-3.12-blue.svg)](https://www.python.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg)](https://reactjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688.svg)](https://fastapi.tiangolo.com/)
[![TianQin](https://img.shields.io/badge/TianQin-SDK-green.svg)](https://www.shinnytech.com/)

> 实时监测化工能源板块期货与现货价差，辅助套利决策的专业金融工具

![Dashboard Preview](./docs/preview.png)

## ✨ 功能特性

- **实时行情推送**：基于天勤 SDK 实时获取期货行情数据
- **多品种监控**：支持能源板块（原油、燃料油、沥青）和化工板块（PTA、甲醇、PVC、PP、PE、纯碱）
- **基差计算**：自动计算现货与期货的价差（Basis = 现货 - 期货）
- **年化收益估算**：根据到期天数自动计算年化套利收益率
- **实时曲线**：ECharts 绘制基差波动曲线，支持品种切换
- **私有计算器**：自定义现货价格、物流成本、资金利率，计算净利润
- **合约乘数**：自动加载各品种合约乘数（SC:1000桶/手，其他:5-20吨/手）
- **深色主题**：专业金融 UI 风格，绿色正收益/红色负收益

## 🛠 技术栈

### 前端
- **React 18** + **Vite** - 现代前端构建工具
- **Tailwind CSS** - 原子化 CSS 框架
- **ECharts** - 专业数据可视化图表
- **Lucide React** - 图标库

### 后端
- **FastAPI** - 高性能 Python Web 框架
- **TianQin SDK (tqsdk)** - 期货行情数据接入
- **python-socks** - WebSocket 代理支持
- **WebSocket / HTTP Polling** - 双模式数据推送

### 数据源
- **期货价格**：天勤行情（上海期货交易所、大连商品交易所、郑州商品交易所）
- **现货参考价**：内置 SMM、Business社 参考数据

## 📦 安装步骤

### 1. 克隆项目

```bash
git clone https://github.com/XiranGS/Futures-arbitrage-monitor-v1.git
cd Futures-arbitrage-monitor-v1
```

### 2. 安装后端依赖

```bash
# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate  # Linux/Mac
# .venv\Scripts\activate  # Windows

# 安装依赖
pip install -r backend/requirements.txt
```

### 3. 安装前端依赖

```bash
npm install
```

### 4. 配置环境变量

复制 `.env.example` 为 `.env`，并填入你的天勤账号：

```bash
cp backend/.env.example backend/.env
```

编辑 `.env` 文件：

```ini
# 天勤账号（必填）
TQ_USER=你的天勤用户名
TQ_PASSWORD=你的天勤密码
```

> 获取天勤账号：https://www.shinnytech.com/

## 🚀 运行项目

### 方式一：开发模式（推荐）

**终端 1 - 启动后端：**

```bash
cd /path/to/project
source .venv/bin/activate
uvicorn backend.main:app --reload --port 8000
```

**终端 2 - 启动前端：**

```bash
cd /path/to/project
npm run dev
```

浏览器打开：`http://localhost:5173`

### 方式二：生产构建

```bash
# 构建前端
npm run build

# 使用任意静态服务器托管 dist 文件夹
python -m http.server 5173 --directory dist
```

## 📊 支持的期货品种

### 能源板块
| 品种 | 合约代码 | 交易所 | 合约乘数 |
|------|----------|--------|----------|
| 原油 | SC | INE | 1000 桶/手 |
| 低硫燃料油 | LU | INE | 10 吨/手 |
| 燃料油 | FU | SHFE | 10 吨/手 |
| 沥青 | BU | SHFE | 10 吨/手 |

### 化工板块
| 品种 | 合约代码 | 交易所 | 合约乘数 |
|------|----------|--------|----------|
| PTA | TA | CZCE | 5 吨/手 |
| 甲醇 | MA | CZCE | 10 吨/手 |
| PVC | V | DCE | 5 吨/手 |
| 聚丙烯 | PP | DCE | 5 吨/手 |
| 聚乙烯 | L | DCE | 5 吨/手 |
| 纯碱 | SA | CZCE | 20 吨/手 |

## 🏗 项目结构

```
.
├── backend/              # Python 后端
│   ├── main.py           # FastAPI 主程序
│   ├── .env              # 环境变量配置
│   └── requirements.txt  # Python 依赖
├── src/                  # React 前端源码
│   ├── components/       # React 组件
│   │   └── RealTimeArbitrageDashboard.jsx
│   ├── App.jsx
│   └── main.jsx
├── index.html
├── package.json
├── vite.config.mts       # Vite 配置（含代理）
├── tailwind.config.js    # Tailwind 配置
└── README.md             # 本文件
```

## 🔌 API 接口

### 后端接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/ctp-status` | GET | 天勤连接状态查询 |
| `/ticks` | GET | 获取最新行情快照 |
| `/ws` | WebSocket | 实时行情推送 |

### 前端代理

Vite 配置已将 `/api/*` 代理到 `http://127.0.0.1:8000`

## ⚠️ 免责声明

本项目仅供**策略研究和学习交流**使用，不构成任何投资建议。期货交易风险极高，可能导致本金全部损失，请谨慎决策。

## 📄 许可证

MIT License

## 🙏 致谢

- [天勤量化](https://www.shinnytech.com/) - 期货行情数据支持
- [FastAPI](https://fastapi.tiangolo.com/) - 后端框架
- [React](https://reactjs.org/) - 前端框架
- [ECharts](https://echarts.apache.org/) - 图表库

---

**作者**：XiranGS  
**项目地址**：https://github.com/XiranGS/Futures-arbitrage-monitor-v1
