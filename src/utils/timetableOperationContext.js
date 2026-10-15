import { assertServerOperationContext } from './serverAuthTransport.js';

// The caller captures context before starting asynchronous preparation.
export async function prepareTimetableSnapshots(operationContext, load) {
  if (operationContext) assertServerOperationContext(operationContext);
  const snapshots = await load();
  if (operationContext) assertServerOperationContext(operationContext);
  return snapshots;
}
