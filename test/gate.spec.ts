import { decide, TrackStats } from '../canary/gate';

const healthy = (requests: number): TrackStats => ({ requests, errors: 0, rejected: 0, p95Ms: 20 });

describe('Canary gate', () => {
  it('promotes a canary that meets every objective and matches stable', () => {
    expect(decide(healthy(400), healthy(3600)).decision).toBe('promote');
  });

  it('pauses when the sample is too small to tell, however good it looks', () => {
    const { decision, reasons } = decide(healthy(120), healthy(3600));

    expect(decision).toBe('pause');
    expect(reasons[0]).toContain('120 canary requests');
  });

  it('aborts a canary that fails while stable does not', () => {
    const { decision, reasons } = decide({ ...healthy(400), errors: 400 }, healthy(3600));

    expect(decision).toBe('abort');
    expect(reasons.join()).toContain('5xx rate over stable');
  });

  it('aborts a canary that answers late', () => {
    expect(decide({ ...healthy(400), p95Ms: 1600 }, healthy(3600)).decision).toBe('abort');
  });

  it('pauses on a borderline difference, for a person to look at', () => {
    // 2% errors: above the 1% pause line, below the 3% abort line.
    expect(decide({ ...healthy(400), errors: 8 }, healthy(3600)).decision).toBe('pause');
  });

  it('judges a canary at 100% on its objectives alone: there is no baseline left', () => {
    const { decision } = decide({ ...healthy(4000), p95Ms: 250 }, healthy(0));

    expect(decision).toBe('promote');
  });
});
