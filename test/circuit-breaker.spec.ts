import { CircuitBreaker } from '../src/interop/circuit-breaker';

describe('Circuit breaker', () => {
  let now = 0;
  const breaker = () => new CircuitBreaker(3, 1_000, () => now);

  beforeEach(() => {
    now = 0;
  });

  it('opens after the threshold of failures in a row, and only then', () => {
    const circuit = breaker();

    expect(circuit.failed()).toBe(false);
    expect(circuit.failed()).toBe(false);
    expect(circuit.allow()).toBe(true);
    expect(circuit.failed()).toBe(true);

    expect(circuit.state).toBe('open');
    expect(circuit.allow()).toBe(false);
  });

  it('forgets failures that a success interrupts', () => {
    const circuit = breaker();

    circuit.failed();
    circuit.failed();
    circuit.succeeded();
    circuit.failed();

    expect(circuit.state).toBe('closed');
  });

  it('lets exactly one trial call through once the wait is over', () => {
    const circuit = breaker();
    for (let i = 0; i < 3; i++) circuit.failed();

    now = 1_000;
    expect(circuit.state).toBe('half-open');
    expect(circuit.allow()).toBe(true);
    expect(circuit.allow()).toBe(false);
  });

  it('closes on a good trial and opens again on a bad one', () => {
    const good = breaker();
    for (let i = 0; i < 3; i++) good.failed();
    now = 1_000;
    good.allow();
    good.succeeded();
    expect(good.state).toBe('closed');

    const bad = breaker();
    for (let i = 0; i < 3; i++) bad.failed();
    now = 2_000;
    bad.allow();
    bad.failed();
    expect(bad.state).toBe('open');
    now = 2_999;
    expect(bad.allow()).toBe(false);
  });
});
