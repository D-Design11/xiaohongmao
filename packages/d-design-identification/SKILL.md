---
name: d-design-identification
description: 维护与解释D-Design口号仅作识别信息的常规和极端版式规则，并计算固定6比1横版、1比6竖版的布局约束。用于规则核对、组件继承和布局约束检查。
---

# D-Design 仅识别信息

先区分常规物料和固定6:1／1:6极端物料。读取 `rules/common.json`、相应的 `rules/regular.json` 或 `rules/extreme.json`，按 `references/asset-bindings.json`解析资产；规则中候选参数不等于品牌批准。

- 常规S/M/L主标题上限10/12/14，副标题均18；8/10/12换行阈值只用于副标题。主标题采用“AI推荐语义断行，用户可以调整”的策略；本地几何脚本没有接入模型，不能把宽度排满或人工例句描述为AI结果。
- 画面延展读取 `rules/image-extension.json` 与 `references/approved-image-extensions.json`：先计算模板实际图片区，人物优先，背景必须铺满；绑定原图摘要与模板比例复用已确认背景。未匹配的素材提示待扩图或人工确认裁切，不以纯色留边当作成功。不得把预置样稿宣称为实时扩图；手写文案裁切授权按原图摘要生效，系统品牌文字始终保护。
- 极端模块只支持固定6:1／1:6，主标题10、副标题16，不绘制二维码、不占位、不继承常规二维码联动。其他极端比例不按最近比例回退。
- 通用安全空间、联合标识、字体基准来自共用组件；具体画幅标识高度和文本容量来自场景模块。合作资产、联乘符号、反白素材按批准版本使用。
- 保持图片原色和素材比例；不通过黑色蒙层、压字、改字或临时缩字解决冲突。语义断行尊重用户有效手动换行，之后仍须校验字号、宽度、行数和碰撞。

计算极端约束时使用：

```bash
node development/resolve.mjs development/examples/landscape.request.json
```

后台使用 `runtime/load-rules.mjs`加载，`runtime/extreme.mjs`返回约束并检查可信布局器给出的可见边界；它不生成图片。常规M实字体宽度检查见 `development/README.md`，不代表S/L/XL的全布局均已验证。

修改规则时保留来源和待确认状态，并运行 `node development/check.mjs --refresh-manifest`、`node --test development/tests/*.test.mjs`。外部发布和网站部署不属于规则整理本身。

按需阅读：

- [常规版式](docs/常规版式.md)：字数、二维码、M参数与语义断行。
- [画面延展](docs/画面延展.md)：主体保护、背景延展、已确认测试素材和实现边界。
- [极端尺寸](docs/极端尺寸.md)：特殊画幅标识、品牌柱和结构限制。
- [来源与待确认](docs/来源与待确认.md)：规范与建议值区分。
- [开发接入](development/接入说明.md)：统一包数据入口和平台接入。

本目录是完整Skill与规则资源包，应整体保留。没有调用模型、真实字体渲染或生产检查时，明确报告尚未验证的部分。
