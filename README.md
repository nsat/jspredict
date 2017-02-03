# JsPredict

A Javascript port of the popular `predict` satellite tracking library.

### Based on:
- PREDICT: http://www.qsl.net/kd2bd/predict.html
- PyPredict: https://github.com/nsat/pypredict
- Python-SGP4: https://github.com/brandon-rhodes/python-sgp4

### Depends on:
- Satellite.js: https://github.com/shashwatak/satellite-js
- Moment.js: https://github.com/moment/moment

## Installation

JsPredict has been pushed to the `NPM`, `Meteor` (Atmosphere), and `Bower` package registries, and can also be used by including the src file directly.

### NPM

```
npm install jspredict
```

### Meteor

```
meteor add rosh93:jspredict
```

### Bower

```
bower install jspredict
```

### Manual Include

Download and include `moment.js`: http://momentjs.com/

Include both `satellite.js` and `jspredict.js` to get `satellite` and `jspredict` available on the global `window` namespace.

## API

#### Input Types

```js
tle = 3 line string with "\n" character line breaks

qth = 3 element array [latitude (degrees), longitude (degrees), altitude (km)]

time, start, or end = unix timestamp (ms) or date object "new Date()"
```

#### Methods

```js
observe(tle 'required', qth 'optional', time 'optional')

observes(tle 'required', qth 'optional', start 'optional', end 'required', interval 'optional')

transits(tle 'required', qth 'required', start 'optional', end 'required', minElevation 'optional', maxTransits 'optional')
```

## Examples

### Observe a Satellite:

```js
> var tle = '0 LEMUR-2 JEROEN\n1 40934U 15052E   15306.10048119  .00001740  00000-0  15647-3 0  9990\n2 40934   6.0033 141.2190 0010344 133.6141 226.4604 14.76056230  5130';
> var jspredict = require('jspredict');
> jspredict.observe(tle, null);
{ eci:
   { position:
      { x: 6780.217861682045,
        y: -1754.945569075624,
        z: -382.1001487529574 },
     velocity:
      { x: 1.8548312182745958,
        y: 7.28225574805238,
        z: -0.6742937006920255 } },
  gmst: 1.2743405900207918,
  latitude: -3.141891992384467,
  longitude: -87.52591692501754,
  altitude: 635.9975103859342,
  footprint: 5474.178485006438 }
```

### Observe a Satellite from an Observer at 15 lat, 130, lon, 10m alt:

```js
> var tle = '0 LEMUR-2 JEROEN\n1 40934U 15052E   15306.10048119  .00001740  00000-0  15647-3 0  9990\n2 40934   6.0033 141.2190 0010344 133.6141 226.4604 14.76056230  5130';
> var qth = [15, 130, .1];
> jspredict.observe(tle, qth);
{ eci:
   { position:
      { x: 6808.890168241923,
        y: -1638.1745052042197,
        z: -392.83171494347425 },
     velocity:
      { x: 1.729088700801128,
        y: 7.313653076194647,
        z: -0.6671038712037236 } },
  gmst: 1.275507328110315,
  latitude: -3.2301661539920232,
  longitude: -86.6090669346031,
  altitude: 636.124394452163,
  footprint: 5474.682764305541,
  azimuth: 75.42118188269167,
  elevation: -70.0809770796008,
  rangeSat: 12666.306550391646,
  doppler: 1.0000075435881037 }
```

### Get Transits for Satellite and Observer (minimum elevation of 2 degrees; obtain a maximum of 4 transits)

```js
> var tle = '0 LEMUR-2 JEROEN\n1 40934U 15052E   15306.10048119  .00001740  00000-0  15647-3 0  9990\n2 40934   6.0033 141.2190 0010344 133.6141 226.4604 14.76056230  5130';
> var qth = [15, 130, .1];
> jspredict.transits(tle, qth, 1446516345242, 1446545135046, 2, 4);
[ { start: 1446519623929.2715,
    end: 1446520436786.1265,
    maxElevation: 26.592307317708126,
    apexAzimuth: 173.44894443969358,
    maxAzimuth: 244.2708297009277,
    minAzimuth: 108.07476128814045,
    duration: 812856.8549804688 },
  { start: 1446525901933.6611,
    end: 1446526693580.5254,
    maxElevation: 24.777958881102588,
    apexAzimuth: 170.71484739848532,
    maxAzimuth: 244.97838417889344,
    minAzimuth: 110.85020906380568,
    duration: 791646.8642578125 },
  { start: 1446532176864.1306,
    end: 1446533027054.9875,
    maxElevation: 20.48579856021555,
    apexAzimuth: 194.49205827738396,
    maxAzimuth: 242.43145831257118,
    minAzimuth: 114.97146874644389,
    duration: 850190.8569335938 },
  { start: 1446538461828.8735,
    end: 1446539183964.2942,
    maxElevation: 15.359176537330036,
    apexAzimuth: 188.34763284223402,
    maxAzimuth: 236.24036969182643,
    minAzimuth: 123.49296057832372,
    duration: 722135.4206542969 } ]
>
```
