import { randomUUID } from 'node:crypto';
import { AppError, assert } from './errors.js';

export class ModelRouter {
  constructor({ logger = console } = {}) {
    this.logger = logger;
    
    // Model cost definitions (USD per 1M tokens)
    this.modelCosts = new Map([
      // Anthropic
      ['anthropic/claude-3-5-haiku-20241022', { input: 1.0, output: 5.0, tier: 'fast' }],
      ['anthropic/claude-3-5-sonnet-20241022', { input: 3.0, output: 15.0, tier: 'balanced' }],
      ['anthropic/claude-3-opus-20240229', { input: 15.0, output: 75.0, tier: 'premium' }],
      
      // OpenAI
      ['openai/gpt-4o-mini', { input: 0.15, output: 0.60, tier: 'fast' }],
      ['openai/gpt-4o', { input: 2.50, output: 10.0, tier: 'balanced' }],
      ['openai/gpt-4-turbo', { input: 10.0, output: 30.0, tier: 'premium' }],
      
      // Google
      ['google/gemini-1.5-flash', { input: 0.075, output: 0.30, tier: 'fast' }],
      ['google/gemini-1.5-pro', { input: 1.25, output: 5.0, tier: 'balanced' }],
      
      // xAI
      ['xai/grok-beta', { input: 5.0, output: 20.0, tier: 'balanced' }],
      
      // OpenRouter free models
      ['meta-llama/llama-3-8b-instruct:free', { input: 0, output: 0, tier: 'free' }],
      ['mistralai/mistral-7b-instruct:free', { input: 0, output: 0, tier: 'free' }],
      ['gryphe/mythomist-7b:free', { input: 0, output: 0, tier: 'free' }],
      
      // Local Ollama models (cost is compute time)
      ['llama3.2:latest', { input: 0, output: 0, tier: 'local' }],
      ['phi3.5:latest', { input: 0, output: 0, tier: 'local' }],
      ['mistral:latest', { input: 0, output: 0, tier: 'local' }],
      ['gemma3:4b', { input: 0, output: 0, tier: 'local' }],
    ]);
    
    // Performance history tracking
    this.performanceHistory = new Map();
    this.maxHistorySize = 1000;
    
    // Recommended models by tier
    this.recommendedModels = {
      fast: [
        'anthropic/claude-3-5-haiku-20241022',
        'openai/gpt-4o-mini',
        'google/gemini-1.5-flash',
        'llama3.2:latest',
        'phi3.5:latest'
      ],
      balanced: [
        'anthropic/claude-3-5-sonnet-20241022',
        'openai/gpt-4o',
        'google/gemini-1.5-pro',
        'mistral:latest',
        'xai/grok-beta'
      ],
      premium: [
        'anthropic/claude-3-opus-20240229',
        'openai/gpt-4-turbo'
      ],
      free: [
        'meta-llama/llama-3-8b-instruct:free',
        'mistralai/mistral-7b-instruct:free',
        'gryphe/mythomist-7b:free'
      ],
      local: [
        'llama3.2:latest',
        'phi3.5:latest',
        'mistral:latest',
        'gemma3:4b'
      ]
    };
    
    // Bang-for-buck champions based on cost-performance analysis
    this.bangForBuckChampions = [
      { model: 'google/gemini-1.5-flash', score: 95, reason: 'Excellent speed, very low cost, strong reasoning' },
      { model: 'anthropic/claude-3-5-haiku-20241022', score: 92, reason: 'Fast, reliable, good quality for cost' },
      { model: 'openai/gpt-4o-mini', score: 90, reason: 'Very fast, low cost, good general purpose' },
      { model: 'llama3.2:latest', score: 88, reason: 'Free local inference, good quality' },
      { model: 'phi3.5:latest', score: 85, reason: 'Fastest local model, adequate for simple tasks' },
      { model: 'openai/gpt-4o', score: 82, reason: 'Premium quality at balanced cost' },
      { model: 'anthropic/claude-3-5-sonnet-20241022', score: 80, reason: 'Strong reasoning, moderate cost' },
    ];
  }
  
  getModelCost(model) {
    return this.modelCosts.get(model) ?? { input: 0, output: 0, tier: 'unknown' };
  }
  
  calculateCost(model, inputTokens, outputTokens) {
    const cost = this.getModelCost(model);
    return {
      inputCost: (inputTokens / 1_000_000) * cost.input,
      outputCost: (outputTokens / 1_000_000) * cost.output,
      totalCost: (inputTokens / 1_000_000) * cost.input + (outputTokens / 1_000_000) * cost.output
    };
  }
  
  recordPerformance({ model, inputTokens, outputTokens, latencyMs, qualityScore, requestId }) {
    const cost = this.calculateCost(model, inputTokens, outputTokens);
    
    const performance = {
      id: randomUUID(),
      requestId,
      model,
      inputTokens,
      outputTokens,
      latencyMs,
      qualityScore,
      cost: cost.totalCost,
      tokensPerSecond: (outputTokens / latencyMs) * 1000,
      costPerToken: cost.totalCost / (inputTokens + outputTokens),
      timestamp: new Date().toISOString()
    };
    
    if (!this.performanceHistory.has(model)) {
      this.performanceHistory.set(model, []);
    }
    
    const history = this.performanceHistory.get(model);
    history.push(performance);
    
    if (history.length > this.maxHistorySize) {
      history.shift();
    }
    
    return performance;
  }
  
  getModelStats(model) {
    const history = this.performanceHistory.get(model) ?? [];
    
    if (history.length === 0) {
      return null;
    }
    
    const avgLatency = history.reduce((sum, p) => sum + p.latencyMs, 0) / history.length;
    const avgTokensPerSecond = history.reduce((sum, p) => sum + p.tokensPerSecond, 0) / history.length;
    const avgCostPerToken = history.reduce((sum, p) => sum + p.costPerToken, 0) / history.length;
    const avgQuality = history.reduce((sum, p) => sum + p.qualityScore, 0) / history.length;
    
    const cost = this.getModelCost(model);
    
    // Calculate bang-for-buck score
    // Higher score = better value
    const speedScore = Math.min(100, (avgTokensPerSecond / 100) * 100);
    const costScore = cost.input === 0 && cost.output === 0 ? 100 : Math.max(0, 100 - (avgCostPerToken * 10000));
    const qualityScore = avgQuality;
    const bangForBuck = (speedScore * 0.3) + (costScore * 0.4) + (qualityScore * 0.3);
    
    return {
      model,
      cost,
      stats: {
        requestCount: history.length,
        avgLatencyMs: Math.round(avgLatency),
        avgTokensPerSecond: Math.round(avgTokensPerSecond),
        avgCostPerToken,
        avgQualityScore: Math.round(avgQuality),
        bangForBuck: Math.round(bangForBuck)
      }
    };
  }
  
  selectModelsForTask({ availableModels, budget, qualityThreshold, maxLatencyMs }) {
    const candidates = availableModels
      .map(model => this.getModelStats(model))
      .filter(stats => stats !== null);
    
    // Filter by constraints
    let filtered = candidates;
    
    if (budget !== undefined) {
      filtered = filtered.filter(stats => {
        const avgCost = stats.stats.avgCostPerToken;
        // Estimate 1000 tokens per request
        return (avgCost * 1000) <= budget;
      });
    }
    
    if (qualityThreshold !== undefined) {
      filtered = filtered.filter(stats => stats.stats.avgQualityScore >= qualityThreshold);
    }
    
    if (maxLatencyMs !== undefined) {
      filtered = filtered.filter(stats => stats.stats.avgLatencyMs <= maxLatencyMs);
    }
    
    // Sort by bang-for-buck score
    filtered.sort((a, b) => b.stats.bangForBuck - a.stats.bangForBuck);
    
    return filtered.map(stats => stats.model);
  }
  
  getBangForBuckChampions(limit = 5) {
    return this.bangForBuckChampions.slice(0, limit);
  }
  
  getRecommendedModelsByTier(tier) {
    return this.recommendedModels[tier] ?? [];
  }
  
  getOptimalModelForRequest({ promptLength, requiresHighQuality, requiresSpeed, budget }) {
    // Simple heuristic-based selection
    const champions = this.getBangForBuckChampions(10);
    
    let candidates = champions;
    
    if (requiresHighQuality) {
      candidates = champions.filter(c => c.score >= 85);
    }
    
    if (requiresSpeed) {
      const fastModels = ['google/gemini-1.5-flash', 'anthropic/claude-3-5-haiku-20241022', 'openai/gpt-4o-mini', 'phi3.5:latest'];
      candidates = champions.filter(c => fastModels.includes(c.model));
    }
    
    if (budget !== undefined) {
      const cost = this.getModelCost(candidates[0]?.model);
      const estimatedCost = (promptLength / 1000) * (cost.input + cost.output);
      if (estimatedCost > budget) {
        // Fall back to cheaper models
        candidates = champions.filter(c => {
          const cCost = this.getModelCost(c.model);
          const cEstimated = (promptLength / 1000) * (cCost.input + cCost.output);
          return cEstimated <= budget;
        });
      }
    }
    
    return candidates[0]?.model ?? this.bangForBuckChampions[0].model;
  }
  
  getAllModelStats() {
    const stats = [];
    for (const model of this.performanceHistory.keys()) {
      const modelStats = this.getModelStats(model);
      if (modelStats) {
        stats.push(modelStats);
      }
    }
    return stats.sort((a, b) => b.stats.bangForBuck - a.stats.bangForBuck);
  }
}
