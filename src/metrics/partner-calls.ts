/**
 * How long each call to the other cloud took since the last publish. Raw
 * values, so CloudWatch can compute the percentiles itself.
 */
const pending: number[] = [];

export function recordPartnerCall(ms: number): void {
  pending.push(Math.round(ms));
}

export function drainPartnerCalls(): number[] {
  return pending.splice(0);
}
