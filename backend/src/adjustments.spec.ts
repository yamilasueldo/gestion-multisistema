import Decimal from 'decimal.js';

describe('cálculo de ajustes indexados', () => {
  it('compone las variaciones mensuales y redondea el precio a dos decimales', () => {
    const variations = [2.7, 3.1, 2.4].map(value => new Decimal(value).div(100));
    const factor = variations.reduce((result, value) => result.mul(value.add(1)), new Decimal(1));
    expect(factor.sub(1).mul(100).toDecimalPlaces(6).toString()).toBe('8.424909');
    expect(new Decimal(10000).mul(factor).toDecimalPlaces(2).toString()).toBe('10842.49');
  });
});
