import { signedQuantity } from './signed-quantity';

describe('signedQuantity', () => {
  it('uses a real minus sign and a plus for increases', () => {
    expect(signedQuantity(-1)).toBe('−1');
    expect(signedQuantity(2)).toBe('+2');
    expect(signedQuantity(0)).toBe('0');
    expect(signedQuantity(-1200)).toBe('−1,200');
  });
});
