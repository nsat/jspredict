const jspredict = require('./jspredict');

describe('transits', () => {
  test('it computes predictable transits', () => {
    const tle = "0 LEMUR-2 JEROEN\n1 40934U 15052E   15306.10048119  .00001740  00000-0  15647-3 0  9990\n2 40934   6.0033 141.2190 0010344 133.6141 226.4604 14.76056230  5130";
    const qth = [15, 130, .1];
    const transits = jspredict.transits(tle, qth, 1446516345242, 1446545135046, 2, 4);

    // From the README.
    const firstTransit = transits[0];
    expect(firstTransit.start).toBeCloseTo(1446519623929.2715);
    expect(firstTransit.end).toBeCloseTo(1446520436786.1265);
    expect(firstTransit.maxElevation).toBeCloseTo(26.592307317708105);
    expect(firstTransit.apexAzimuth).toBeCloseTo(173.4489444396936);
    expect(firstTransit.maxAzimuth).toBeCloseTo(244.2708297009277);
    expect(firstTransit.minAzimuth).toBeCloseTo(108.07476128814044);
    expect(firstTransit.duration).toBeCloseTo(812856.8549804688);
  });

  test('it returns no transits for geostationary satellites', () => {
    // INTELSAT 39 on Oct 31, 2019
    // https://www.n2yo.com/satellite/?s=44476
    const tle = "INTELSAT 39\n1 44476U 19049B   19304.31021668  .00000022  00000-0  00000+0 0  9995\n2 44476   0.0018 233.4327 0000272   5.2638 334.3170  1.00274937   908";
    const qth = [20.5937, 78.9629, 0.840];
    const transits = jspredict.transits(tle, qth, 1572562039000, 1572568039000, 2, 4);
    expect(transits).toStrictEqual([]);
  });
});
