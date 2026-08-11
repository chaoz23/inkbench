/** Small deterministic PRNG suitable for repeatable search, not cryptography. */
export class Prng {
  private state: number;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) throw new RangeError("seed must be a safe integer");
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  }

  integer(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1) {
      throw new RangeError("maxExclusive must be a positive integer");
    }
    return Math.floor(this.next() * maxExclusive);
  }

  pick<T>(values: readonly T[]): T {
    if (values.length === 0) throw new RangeError("cannot pick from an empty list");
    return values[this.integer(values.length)]!;
  }

  shuffle<T>(values: readonly T[]): T[] {
    const out = [...values];
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.integer(i + 1);
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }
}
