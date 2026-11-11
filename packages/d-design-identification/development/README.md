# 开发文件使用说明

本目录的脚本与测试留给开发维护，业务用户日常不需要修改。Node命令使用支持内置测试、fetch、Intl.Segmenter及Web Crypto的Node 22或兼容版本；没有npm依赖。

在规则包根目录执行：

```bash
node development/check.mjs
node --test development/tests/*.test.mjs
node development/resolve.mjs development/examples/portrait.request.json
```

修改共用数据、模块、文档后，先检查差异，再重算依赖摘要和示例：

```bash
node development/check.mjs --refresh-manifest
node --test development/tests/*.test.mjs
node development/check.mjs
```

检查报告与生成的极端示例约束统一放在 `development/results/`；它们不参加包本身的文件摘要，也不是品牌审核结果。

常规M原有字体测量检查使用Python 3与Pillow，需显式提供团队有权使用的字体目录（含65S、50S）：

```bash
python3 development/regular/check_rules.py --font-dir "/实际路径/fonts"
python3 development/regular/extract_psd.py --input-dir "/实际路径/PSD所在目录"
```

常规脚本通过 `load_rules.py`从同一份共用JSON生成兼容视图，不单独维护一份字体/边距常量。它只验证M候选几何及给定字体宽度，示意图用占位品牌与QR，不能证明AI语义断行已实现。

`schemas/`为接口格式；运行时还有业务条件检查。`integration/`包含GitHub数据加载和旧项目字段适配示例，不会自动接入网站。`github/check-rules.yml`是可选CI模板，需按[接入说明](接入说明.md)放入实际仓库的工作流目录。
