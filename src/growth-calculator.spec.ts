import { correctedLengthCm, evaluateGrowth, interpolatedLms, lmsZ, normalCdf } from './growth-calculator';

describe('WHO LMS growth calculation', () => {
  // WHO igrowup-spss/wazlms.sav, male, day 0: L=.3487 M=3.3464 S=.14602.
  const wazBirthBoy = { x: 0, l: .3487, m: 3.3464, s: .14602 };
  it('reproduces the WHO median as Z=0', () => expect(lmsZ(3.3464, wazBirthBoy)).toBeCloseTo(0, 10));
  it('computes a low percentile and labels it without conflating it with an OMS diagnostic', () => {
    const evaluation = evaluateGrowth('PESO_EDAD', 2.5, wazBirthBoy);
    expect(evaluation.state).toBe('EVALUABLE'); expect(evaluation.classification).toBe('BAJO_P5'); expect(evaluation.percentile).toBeLessThan(5);
  });
  it('uses the WHO 0.7cm recumbent/standing correction at 24 months', () => {
    expect(correctedLengthCm(80, 730, 'TALLA')).toBeCloseTo(80.7); expect(correctedLengthCm(80, 731, 'LONGITUD')).toBeCloseTo(79.3); expect(correctedLengthCm(80, 731, 'TALLA')).toBe(80);
  });
  it('interpolates height tables between their 0.1cm values', () => {
    const value = interpolatedLms([{ x: 65, l: -.35, m: 7.43, s: .082 }, { x: 65.1, l: -.34, m: 7.45, s: .081 }], 65.05); expect(value?.x).toBe(65.05); expect(value?.m).toBeCloseTo(7.44, 8);
  });
  it('does not invent WHO percentiles outside published ±3 Z tables', () => {
    const evaluation = evaluateGrowth('PESO_EDAD', 20, wazBirthBoy); expect(evaluation.percentile).toBeNull();
  });
  it('keeps the normal CDF numerically stable at the median', () => expect(normalCdf(0)).toBeCloseTo(.5, 6));
});
