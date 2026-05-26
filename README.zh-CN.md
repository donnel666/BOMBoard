# BOMBoard

[English](./README.md) | 中文

BOMBoard 是一个开源的 2D PCB 审板工具，用于在 PCB 制造数据、坐标数据和 BOM 数据之间进行交叉定位。

Web 应用在浏览器本地运行。它可以加载本地 ZIP 包或目录，校验项目文件，根据 Gerber 和钻孔数据渲染 PCB，并把板图视图与 BOM、坐标数据关联起来。项目数据会保存在浏览器存储中，刷新页面后可恢复当前工作区，直到用户手动关闭项目。

## 功能

- 支持加载本地 ZIP 包或目录，无需上传到服务器。
- 支持 Gerber 和 Excellon 钻孔文件渲染。
- 支持 BOM CSV/XLSX 和坐标 CSV/XLSX 解析。
- 支持板图视图与元件列表交叉定位。
- 支持按位号、封装、元件名称进行 BOM 模糊搜索。
- 针对常见贴片电阻、电容、电感优化 BOM 排序。
- 根据浏览器语言自动显示中文或英文界面。
- 基于 GPL-3.0 开源。

## 项目链接

- GitHub：<https://github.com/donnel666/BOMBoard>
- QQ 群：[2163055552](https://qm.qq.com/q/iBHcSKY3wk)
- 许可证：[GNU General Public License v3.0](./LICENSE)

## 环境要求

- Node.js 22 或更高版本
- pnpm 10 或更高版本

## 本地开发

```bash
pnpm install
pnpm dev:web
```

## 校验

```bash
pnpm build
pnpm typecheck
pnpm test
```
