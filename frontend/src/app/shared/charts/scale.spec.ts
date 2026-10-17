import { bandCenter, barPath, extent, linePath, linearScale, niceTicks } from './scale';

describe('chart scales', () => {
  describe('extent', () => {
    it('finds the smallest and largest value, skipping nulls', () => {
      expect(extent([104, null, 81, 115])).toEqual({ min: 81, max: 115 });
    });

    it('is null when there are no values', () => {
      expect(extent([])).toBeNull();
      expect(extent([null, null])).toBeNull();
    });
  });

  describe('linearScale', () => {
    it('maps the domain onto the range, including an inverted range', () => {
      const y = linearScale(0, 100, 200, 0);
      expect(y(0)).toBe(200);
      expect(y(100)).toBe(0);
      expect(y(25)).toBe(150);
    });

    it('maps a zero-width domain to the middle of the range', () => {
      const y = linearScale(5, 5, 0, 40);
      expect(y(5)).toBe(20);
      expect(y(99)).toBe(20);
    });
  });

  describe('bandCenter', () => {
    it('returns the middle of each equal band', () => {
      expect(bandCenter(0, 7, 0, 700)).toBe(50);
      expect(bandCenter(6, 7, 0, 700)).toBe(650);
    });
  });

  describe('niceTicks', () => {
    it('covers the range with round steps', () => {
      expect(niceTicks(81, 115, 4)).toEqual([80, 90, 100, 110, 120]);
      expect(niceTicks(0, 1243, 4)).toEqual([0, 500, 1000, 1500]);
    });

    it('keeps decimal steps free of floating-point drift', () => {
      expect(niceTicks(0.1, 0.35, 4)).toEqual([0.1, 0.2, 0.3, 0.4]);
    });

    it('returns the single value for a flat range', () => {
      expect(niceTicks(100, 100)).toEqual([100]);
    });
  });

  describe('linePath', () => {
    it('draws one segment through consecutive points', () => {
      expect(
        linePath([
          { x: 0, y: 10 },
          { x: 5, y: 2.555 },
        ]),
      ).toBe('M0 10 L5 2.56');
    });

    it('breaks the line at a null and skips a lone point', () => {
      const d = linePath([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        null,
        { x: 3, y: 3 },
        null,
        { x: 5, y: 5 },
        { x: 6, y: 6 },
      ]);
      expect(d).toBe('M0 0 L1 1 M5 5 L6 6');
    });

    it('is empty with no points', () => {
      expect(linePath([])).toBe('');
    });
  });

  describe('barPath', () => {
    it('draws a bar with rounded top corners from the baseline up', () => {
      expect(barPath(10, 20, 50, 100)).toBe('M10 100 V54 Q10 50 14 50 H26 Q30 50 30 54 V100 Z');
    });

    it('shrinks the corner radius for a short bar', () => {
      expect(barPath(0, 20, 98, 100)).toBe('M0 100 V100 Q0 98 2 98 H18 Q20 98 20 100 V100 Z');
    });

    it('is empty for a zero-height bar', () => {
      expect(barPath(0, 20, 100, 100)).toBe('');
    });
  });
});
