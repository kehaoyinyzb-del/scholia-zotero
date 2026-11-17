const allowed = {
  queued: ['detecting'],
  detecting: ['metadata', 'failed'],
  metadata: ['pdf', 'complete', 'partial'],
  pdf: ['complete', 'partial'],
  partial: ['pdf'],
  failed: ['detecting'],
  complete: [],
};

export function moveImport(job, next) {
  if (!allowed[job.state]?.includes(next)) {
    throw new Error(`Invalid import transition ${job.state} to ${next}`);
  }
  return { ...job, state: next };
}

export function recoverImport(job) {
  if (['queued', 'detecting', 'metadata', 'pdf'].includes(job.state)) {
    return { ...job, state: job.itemID ? 'partial' : 'failed' };
  }
  return job;
}
