# Changelog

本项目的所有显著变更都会记录在此文件中。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.1] - 2026-08-15

### 修复

- **修复 DSH 服务自动启动失败**：启动命令现在以「命令 + 参数」的结构化方式拼接，即使设置里误填了带参数的完整命令（如 `dsh web`）也能正确启动，不再出现 `dsh web web` 之类的错误。
- **设置项文案澄清**：「启动命令」改名为「启动命令名」，明确只填命令名不带参数；误填带参数时会自动只取第一个词。
- **npx 回退路径修复**：回退到 npx/npm 时的命令拼接 bug 修复，自动启动更可靠。

## [0.1.0] - 2026-08-14

### 新增

- 初始发布：在 Obsidian 侧边栏嵌入 DeepSeek Harness (DSH) Web UI。
- 自动探测并启动本地 `dsh web` 服务。
- 支持将 vault 根目录作为 DSH 工作区。
