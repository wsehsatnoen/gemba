import { sameQuery } from './same-query';

describe('sameQuery', () => {
  it('compares values, treating missing and undefined alike', () => {
    expect(sameQuery({ page: 0, zone: 'CHILLED' }, { zone: 'CHILLED', page: 0 })).toBe(true);
    expect(sameQuery({ page: 0, aboveP90: undefined }, { page: 0 })).toBe(true);
    expect(sameQuery({ page: 0 }, { page: 1 })).toBe(false);
    expect(sameQuery({ page: 0 }, { page: 0, partnerId: 'SIMUSR0142' })).toBe(false);
  });
});
