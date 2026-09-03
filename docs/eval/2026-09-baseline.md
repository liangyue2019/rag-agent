# 评测基线报告

> 状态：⏳ 待产出真实数据（需配置真实 ZHIPU_API_KEY 后运行 `corepack pnpm --filter server eval`）

## 运行环境
- 日期：2026-09-03（框架创建）
- commit：f1206af 之后（实施完成时）
- 模型：glm-4-flash + embedding-3（1024 维）
- 数据集：eval/dataset.json（20 条：faq 6 / file 6 / url 4 / chat 2 / fallback 2）
  - ⚠️ expectedKeywords 为示例占位，需按实际入库知识调整

## 前置步骤
1. 配置真实 key 到 apps/server/.env
2. 启动 Qdrant（docker compose up -d）与服务（corepack pnpm dev）
3. 通过管理后台上传测试文档/FAQ（建议：售后政策文档 + 发货/退款 FAQ 若干）
4. 运行评测：corepack pnpm --filter server eval

## 指标1：召回率@5
| 日期 | commit | 参数 | 召回率 | 备注 |
|---|---|---|---|---|
| 待填 | | chunk 600/100, TOP_K 5 | 待填 | 基线 |

## 指标2：忠实度（LLM-as-judge，5 分制）
| 日期 | commit | 均分 | 样本数 | 备注 |
|---|---|---|---|---|
| 待填 | | 待填 | 5 | 抽检可召回问题 |

## 错例分析
（待填：逐条 ❌ 用例，归因——分块截断 / 检索未命中 / 评分误杀 / 生成偏离）

## 调优记录
| 轮次 | 调整 | 召回率变化 | 忠实度变化 | 结论 |
|---|---|---|---|---|
| 0 | 基线（chunk 600/100） | - | - | - |

## 调优候选动作
- chunk size 600→400 或 overlap 100→150（分块过粗导致检索噪声）
- PER_QUERY_TOPK 5→8（候选不足）
- 高频误杀问题补充为 FAQ（权威答案直出）
