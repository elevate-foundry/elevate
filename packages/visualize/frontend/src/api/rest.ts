/** REST API client for experiment management. */

import type { Experiment, ExperimentDetail } from './types';

const BASE = '/api';

export async function listExperiments(params?: {
  type?: string;
  concept?: string;
  limit?: number;
  offset?: number;
}): Promise<Experiment[]> {
  const qs = new URLSearchParams();
  if (params?.type) qs.set('type', params.type);
  if (params?.concept) qs.set('concept', params.concept);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  const res = await fetch(`${BASE}/experiments?${qs}`);
  return res.json();
}

export async function getExperiment(id: number): Promise<ExperimentDetail> {
  const res = await fetch(`${BASE}/experiments/${id}`);
  return res.json();
}

export async function exportExperiment(id: number): Promise<ExperimentDetail> {
  const res = await fetch(`${BASE}/experiments/${id}/export`);
  return res.json();
}

export async function deleteExperiment(id: number): Promise<void> {
  await fetch(`${BASE}/experiments/${id}`, { method: 'DELETE' });
}
