# BOMBoard 项目计划

## 1. 项目目标

BOMBoard 是一个面向 PCB 贴片、维修、来料检查和制造审查场景的 2D PCB BOM/板图联动工具。

核心体验是：

- 左侧显示 PCB 板图、焊盘、孔、丝印、阻焊、外形等制造或设计信息。
- 右侧显示 BOM/元件列表。
- 支持 BOM 与板图之间的双向定位、同类高亮、搜索、筛选和侧面切换。
- 支持 Web 与 Electron 桌面端共用一套前端代码。
- 所有解析、匹配和渲染尽量在本地完成，不依赖远程服务。

本项目是 **2D 工具**，不是 3D PCB 查看器。

## 2. 最新架构决策

### 2.1 结论

采用四层结构：

```text
apps/web
  -> packages/runtime-web
       -> packages/core
       -> packages/parsers
       -> packages/viewer

packages/parsers
  -> packages/core

packages/viewer
  -> packages/core
```

核心原则：

- `packages/core` 是稳定契约层，定义 IR、数据接口、能力接口、错误码和运行时抽象。
- `packages/parsers` 是解析实现层，按 core 的 parser 契约把源文件转换为 core IR。
- `packages/viewer` 是渲染实现层，按 core 的 renderer/viewer 契约消费 core IR，不依赖 parser 内部类型。
- `packages/runtime-web` 是 Web 装配层，负责把 core 契约、parsers 实现和 viewer 实现组装成 Web 可调用的应用级 API。
- `apps/web` 不直接操作 parser 和 renderer，不直接 import `@bomboard/parsers` 或 `@bomboard/viewer`。

新增 `packages/runtime-web` 的目的，是避免让 `packages/core` 反向依赖 `packages/parsers` / `packages/viewer` 造成循环依赖。

### 2.2 为什么不能让 core 直接 import 实现包

如果 core 直接依赖 parsers/viewer，而 parsers/viewer 又必须依赖 core 的契约，会形成：

```text
core -> parsers -> core
core -> viewer  -> core
```

这会带来几个问题：

- workspace 构建顺序变脆。
- TypeScript declaration 输出容易互相牵连。
- core 的稳定契约会被具体实现污染。
- 后续 AD、EasyEDA、KiCad、Eagle/Fusion 接入时，core 会膨胀成实现集合。

因此 core 只定义抽象契约；装配包负责选择和调用具体实现。

## 3. 包职责

### 3.1 `packages/core`

core 是 parsers、viewer、runtime-web、apps 共同依赖的稳定契约层。

core 负责：

- 定义 `BomBoardProjectIR`。
- 定义统一坐标系。
- 定义 source file、board、layer、artwork、drill、via、component、BOM、diagnostic 等 IR 类型。
- 定义 parser 契约，例如 `ProjectParser`。
- 定义 renderer 契约，例如 `BoardRenderer`。
- 定义 viewer host 契约，例如 `BoardViewerHost`。
- 定义应用级 runtime 抽象，例如 `BomBoardRuntime`。
- 定义泛型 `BoardRenderModel` 契约，包含 viewer 需要的组件位置、显示位置、尺寸、命中区域和高亮几何，但不固定 DOM 容器或具体渲染承载形态。
- 定义统一导入错误码，例如 `missing-bom-file`、`missing-drill-file`。
- 定义 viewer handle、viewer state、selection event 等跨层交互接口。

core 不负责：

- 不写 Gerber 语法解析。
- 不写 BOM/坐标格式解析。
- 不写 AD/EasyEDA/KiCad/Eagle/Fusion 具体解析。
- 不写 PixiJS、Canvas、DOM 渲染。
- 不定义 Web `HTMLElement` 或浏览器 `File` 为核心必需类型。
- 不规定 renderer 必须输出 SVG、Canvas texture 或其他具体产物。
- 不 import `@bomboard/parsers`。
- 不 import `@bomboard/viewer`。

### 3.2 `packages/parsers`

parsers 是源文件解析实现层。

parsers 负责：

- 实现 core 定义的 parser 契约。
- 把 Gerber、Drill、BOM、Coordinate 等制造文件转换为 `BomBoardProjectIR`。
- 导出当前制造文件 `ProjectParser` 实现 `manufacturingProjectParser`。
- 后续新增 AD、EasyEDA、KiCad、Eagle/Fusion、InteractiveHtmlBom Generic JSON 等 parser。
- 保留格式探测、字段识别、单位转换、坐标转换、诊断收集等解析逻辑。

parsers 不负责：

- 不创建 PixiJS viewer。
- 不操作 DOM。
- 不处理 React 状态。
- 不承担应用 UI 编排。
- 不让 viewer 依赖其内部类型。

第一阶段已有制造文件入口：

```text
Gerber + Drill + BOM + Coordinate
  -> manufacturingProjectParser
  -> parseManufacturingProject()
  -> BomBoardProjectIR
```

### 3.3 `packages/viewer`

viewer 是渲染和交互实现层。

viewer 负责：

- 从 `BomBoardProjectIR` 或 core 定义的渲染输入派生板图渲染模型。
- 实现 core 定义的 `BoardRenderer`，当前默认实现为 `defaultBoardRenderer`。
- 实现 core 定义的 `BoardViewerHost`，当前默认实现为 `pixiBoardViewerHost`。
- 使用 PixiJS 挂载板图 viewer。
- 管理 pan/zoom、side 切换、选择、高亮、hit testing。
- 提供 viewer handle，供上层调用 `setSide()`、`selectComponent()`、`clearSelection()` 等。

viewer 不负责：

- 不 import `@bomboard/parsers`。
- 不知道 Gerber parser、BOM parser、AD parser 的内部类型。
- 不做源文件格式探测。
- 不读取上传文件集合。

### 3.4 `packages/runtime-web`

runtime-web 是装配包。

runtime-web 负责：

- 依赖 core、parsers、viewer。
- 把 `ProjectParser` 实现注册到 runtime。
- 把 `BoardRenderer` / `BoardViewerHost` 实现注册到 runtime。
- 只装配实现，不把格式探测、具体解析、Pixi viewer 适配代码写在 runtime-web 内部。
- 为 Web 提供应用级 API：
  - `parseBomBoardProject()`
  - `mountBomBoardViewer()`
  - `openBomBoardProject()`
  - `createWebBomBoardRuntime()`
- 实现 `BomBoardRuntime.openProject()` 和 `BomBoardRuntime.mountProjectViewer()`，让 project -> render model -> viewer 的真实 Web 流程也受 core 契约约束。
- 把 parsers 导出的 manufacturing parser 与 viewer 导出的默认 renderer/viewer host 装配起来。
- 承担 Web 环境相关的文件对象、footprint asset base URL、viewer mount container 等连接逻辑。

runtime-web 不负责：

- 不定义核心 IR。
- 不实现具体 Gerber 解析细节。
- 不实现 PixiJS 内部渲染细节。
- 不实现 `ProjectParser`、`BoardRenderer`、`BoardViewerHost` 的具体业务逻辑。
- 不持有 React UI 状态。

### 3.5 `apps/web`

web 是应用壳。

web 负责：

- 文件选择、ZIP 展开、持久化项目缓存。
- React UI 状态。
- 国际化文案。
- 错误展示。
- 把文件、容器、base URL、事件回调交给 runtime-web。

web 不负责：

- 不直接 import `@bomboard/parsers`。
- 不直接 import `@bomboard/viewer`。
- 不调用 `selectGerber2DFiles()`。
- 不调用 `parseManufacturingProject()`。
- 不调用 `createBoardRenderModel()`。
- 不调用 `createBoardViewer()`。

web 可以依赖 core 类型，例如 `ComponentIR`、`BoardViewerSide`、`BoardViewerHandle`，但应用级操作通过 `@bomboard/runtime-web` 完成。

## 4. 数据流

当前制造文件路线：

```text
用户选择文件
  -> apps/web 展开 ZIP / 过滤无效文件
  -> runtime-web.parseBomBoardProject()
  -> manufacturing ProjectParser
  -> packages/parsers 解析 Gerber/BOM/Coordinate/Drill/Via
  -> packages/core BomBoardProjectIR
  -> runtime-web.mountBomBoardViewer()
  -> packages/viewer 创建 Render Model 和 Pixi viewer
  -> apps/web 使用 BoardViewerHandle 做 UI 联动
```

目标路线：

```text
source files
  -> runtime parser selection
  -> parser implementation
  -> core IR
  -> renderer implementation
  -> viewer host implementation
  -> app UI
```

## 5. IR 原则

IR 是 source parser 与 viewer 之间的稳定兼容层。

IR 必须满足：

- 与输入格式无关。
- 与 PixiJS、Canvas、DOM 无关。
- 坐标系明确。
- 单位明确。
- side 明确。
- source file 可追踪。
- diagnostic 可追踪。
- 可序列化。
- 可 diff。
- 能支持参考项目输入输出比对。

当前统一坐标系：

```text
units: mm
origin: board
xAxis: right
yAxis: down
angleUnit: deg
angleDirection: clockwise
bottomMirroredInModel: false
```

第一阶段 IR 不保留 renderer 产物字段。Layer artwork 使用 core 定义的 primitive 列表承载，包括 path、circle、rect、polygon、polyline 等基础几何。Gerber parser 可以从 tracespace 产物转换出这些 primitive，但 SVG 字符串不进入 core 契约。

后续应在现有 primitive 基础上逐步补充更高语义的 Gerber/EDA artwork：

- pad
- track
- arc
- fill
- region
- polygon
- text
- drill
- via
- net
- component footprint geometry

## 6. 支持格式路线

### 6.1 Phase 1：制造文件路线

必须支持：

- Gerber
- Excellon drill
- BOM CSV/TXT
- Coordinate / Pick-and-Place / Centroid CSV/TXT
- Via info sidecar

制造文件最低有效输入：

- BOM
- Coordinate
- Gerber
- Drill

缺少 coordinate 时不能进入组件映射模式。第一阶段不做没有 coordinate 的组件位置推断 fallback。

### 6.2 Phase 2：IR JSON 输入

支持 `bomboard-project-v1.json` 直接导入。

用途：

- 让外部工具直接生成 BOMBoard IR。
- 让 AD exporter、脚本和测试工具先绕过 native parser。
- 支持黄金样例和回归测试。

### 6.3 Phase 3：InteractiveHtmlBom Generic JSON

支持 InteractiveHtmlBom Generic JSON 作为输入吸收能力。

用途：

- 吸收参考项目样例。
- 对比 `pcbdata + components` 与 BOMBoard IR 的表达差异。
- 辅助验证 IR 覆盖面。

注意：BOMBoard 不兼容 `pcbdata`，也不把 `pcbdata` 作为内部通用格式。输入可以转换，内部统一是 BOMBoard IR。

### 6.4 Phase 4：AD / Altium

第一阶段不做 native `.PcbDoc` direct parser。

优先路线：

```text
Altium Designer script/plugin
  -> PCBServer.GetCurrentPCBBoard()
  -> BomBoardProjectIR JSON
```

导出内容：

- board outline
- component
- pad
- via
- track
- arc
- fill
- region
- polygon
- text
- BOM fields / parameters

native `.PcbDoc` direct parser 后续评估，但必须基于 AD exporter 产物做黄金对比。

### 6.5 Phase 5：EasyEDA / KiCad / Eagle / Fusion

后续在 `packages/parsers` 中增加 parser 实现：

- EasyEDA Standard / Pro
- KiCad `.kicad_pcb`
- Eagle `.brd`
- Fusion Electronics exported board data

所有路线最终都输出 `BomBoardProjectIR`。

## 7. 当前第一阶段落地范围

第一阶段目标不是一次性支持全部格式，而是完成架构解耦。

验收标准：

- core 定义 IR 和跨层接口。
- runtime-web 只装配 parsers 和 viewer 导出的实现，避免 core 循环依赖和装配层业务化。
- web 不直接 import parsers/viewer。
- parsers 产出 `BomBoardProjectIR`。
- viewer 消费 `BomBoardProjectIR` / core render contract。
- 当前 Gerber+BOM+Coordinate+Drill 样例渲染不退化。
- BOM 点击、高亮、反查、side 切换继续可用。

第一阶段不做：

- 不引入 AD native parser。
- 不引入 EasyEDA native parser。
- 不引入 KiCad native parser。
- 不实现缺 coordinate 的组件推断。
- 不把 `pcbdata` 作为内部格式。
- 不把 parser 内部类型暴露给 viewer。

## 8. 测试与比对策略

后续所有 parser 都必须支持参考项目比对。

测试分层：

1. parser 单元测试
   - 字段识别
   - 单位转换
   - side 识别
   - rotation 归一化
   - drill/via 解析

2. IR snapshot / diff 测试
   - source file count
   - board bounds / viewBox
   - layer function / side
   - component count
   - BOM item count
   - drill/via count
   - diagnostics

3. viewer 边界测试
   - viewer 不 import parser 包。
   - render model 不包含 parser 内部类型。
   - BoardViewerHandle 只通过 core 契约暴露。

4. 参考项目差分测试
   - 与 InteractiveHtmlBom、EasyEDA iBOM extension、AD exporter 的输入输出逐项对比。
   - 差分报告必须区分：
     - 一致项
     - 精度误差
     - 坐标系差异
     - 参考项目 bug
     - BOMBoard 有意偏差
     - 未支持项

## 9. 关键风险

### 9.1 循环依赖

风险：core 直接依赖 parsers/viewer。

控制方式：

- core 只定义契约。
- runtime-web 做装配。
- CI/脚本扫描 core 中是否出现 `@bomboard/parsers` 或 `@bomboard/viewer`。

### 9.2 core 膨胀

风险：core 变成所有实现逻辑的集合。

控制方式：

- core 只放稳定接口、IR、错误码、状态和跨层协议。
- 格式解析留在 parsers。
- PixiJS/DOM 留在 viewer。
- Web mount target、浏览器 File 对象、viewer side artwork 等具体形态留在 runtime-web/viewer 的泛型实现中。
- Web 环境装配留在 runtime-web。

### 9.3 IR 不稳定

风险：parser 和 viewer 同时依赖 IR，频繁改 IR 会造成大面积修改。

控制方式：

- IR 版本号固定为 `bomboard-project-v1`。
- 新字段优先可选。
- 破坏性变更必须升级 schema version。
- 每个 parser 输出都要有 snapshot/diff 测试。

### 9.4 Gerber artwork 语义不足

风险：第一阶段虽然已经移除 core 中的 SVG fragment，但 artwork primitive 仍偏基础几何，尚未表达 net、track、pad、region、text 等更高层语义。

控制方式：

- core 只保留通用 primitive 和稳定语义字段，不接受 renderer 产物字段回流。
- viewer 只依赖 core IR 字段，不依赖 Gerber parser 类型。
- 后续逐步引入更高语义的结构化几何 IR。

### 9.5 格式支持扩大后的测试压力

风险：AD/EasyEDA/KiCad/Eagle/Fusion 各自坐标系、layer、component model 差异大。

控制方式：

- 每个格式先做字段映射表。
- 每个格式必须有黄金样例。
- 先支持导出 IR，再评估 native parser。

## 10. 里程碑

### M1：架构隔离完成

- core 定义 IR 和运行时接口。
- runtime-web 装配包存在。
- runtime-web 不实现 parser/renderer/viewer host 的具体业务逻辑。
- web 不直接 import parsers/viewer。
- parsers 输出 IR。
- viewer 消费 IR。
- 当前制造文件样例通过 smoke test。

### M2：IR JSON 导入

- 支持 `bomboard-project-v1.json`。
- 增加 schema 校验。
- 增加 IR snapshot 测试。

### M3：参考项目比对工具

- 建立输入输出差分脚本。
- 吸收 InteractiveHtmlBom Generic JSON。
- 生成差分报告。

### M4：AD exporter

- 提供 AD script/plugin 导出 BOMBoard IR。
- 建立 AD golden sample。
- 与 AD exporter 输出做稳定比对。

### M5：更多 EDA parser

- EasyEDA parser。
- KiCad parser。
- Eagle/Fusion parser。
- 每个 parser 独立测试并输出同一 IR。

## 11. 当前代码边界扫描目标

必须长期保持：

```text
packages/core/src
  不出现 @bomboard/parsers
  不出现 @bomboard/viewer

apps/web 源码和构建配置
  不出现 @bomboard/parsers
  不出现 @bomboard/viewer

packages/viewer/src
  不出现 @bomboard/parsers
  不出现 Gerber2DProject / ParsedBomCoordinateProject 等 parser 内部类型
```

允许：

```text
packages/runtime-web/src
  可以 import @bomboard/core
  可以 import @bomboard/parsers
  可以 import @bomboard/viewer
```

这是装配包的职责。
