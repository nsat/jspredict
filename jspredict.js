// jspredict v1.0.3
// Author: Roshan Jobanputra
// https://github.com/nsat/jspredict

// Changelog:
// v1.0.3 (rosh93)  - If we cant approximate our aos within max_iterations, return null and dont attempt to return a bad transit object. Fix a few jslint warnings
// v1.0.2 (jotenko)	- Added parameter 'maxTransits' to function 'transits' (allows the user to define a maximum number of transits to be calculated, for performance management)
// v1.0.1 (nsat)		- First release

// Copyright (c) 2015, Spire Global Inc
// All rights reserved.
//
// Redistribution and use in source and binary forms, with or without
// modification, are permitted provided that the following conditions are met:
//     * Redistributions of source code must retain the above copyright
//       notice, this list of conditions and the following disclaimer.
//     * Redistributions in binary form must reproduce the above copyright
//       notice, this list of conditions and the following disclaimer in the
//       documentation and/or other materials provided with the distribution.
//     * Neither the name of the Spire Global Inc nor the
//       names of its contributors may be used to endorse or promote products
//       derived from this software without specific prior written permission.
//
// THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
// "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
// LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
// FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
// Spire Global Inc BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
// SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
// LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF
// USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
// ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
// OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT
// OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
// SUCH DAMAGE.

// Based on:
// PREDICT: http://www.qsl.net/kd2bd/predict.html
// PyPredict: https://github.com/nsat/pypredict
// Python-SGP4: https://github.com/brandon-rhodes/python-sgp4
// Depends on:
// Satellite.js: https://github.com/shashwatak/satellite-js
// Moment.js: https://github.com/moment/moment

// API

// jspredict
//
// Inputs:
//   tle = 3 line string
//   qth = 3 element array [latitude (degrees), longitude (degrees), altitude (km)]
//   time/start/end = unix timestamp (ms) or date object (new Date())

  // observe(tle 'required', qth 'optional', time 'optional')
  //
  // observes(tle 'required', qth 'optional', start 'optional', end 'required', interval 'optional')
  //
  // transits(tle 'required', qth 'required', start 'optional', end 'required', minElevation 'optional')
  //   transit

(function (global, factory) {
    typeof exports === 'object' && typeof module !== 'undefined' ? module.exports = factory() :
    typeof define === 'function' && define.amd ? define(factory) :
    global.jspredict = factory()
}(this, function () {
  // Meteor includes the moment dependency differently than Npm or Bower,
  // so we need this hack (using m_moment) else it gets upset about moment = require('moment');
  var m_moment;

  // Npm
  if (typeof require !== 'undefined') {
    var satellite = require('satellite.js').satellite;
    m_moment = require('moment');
  }
  // Meteor
  if (this.satellite) {
    var satellite = this.satellite;
  }
  m_moment = m_moment || moment;

  var xkmper = 6.378137E3; // earth radius (km) wgs84
  var astro_unit = 1.49597870691E8; // Astronomical unit - km (IAU 76)
  var solar_radius = 6.96000E5; // solar radius - km (IAU 76)
  var deg2rad = Math.PI / 180;
  var ms2day = 1000 * 60 * 60 * 24; // milliseconds to day
  var max_iterations = 250;
  var defaultMinElevation = 4; // degrees

  var _jspredict = {
    observe: function(tle, qth, start) {
      var tles = tle.split('\n');
      var satrec = satellite.twoline2satrec(tles[1], tles[2]);

      if (this._badSat(satrec, qth, start)) {
        return null;
      }

      return this._observe(satrec, qth, start)
    },

    observes: function(tle, qth, start, end, interval) {
      start = m_moment(start);
      end = m_moment(end);

      var tles = tle.split('\n');
      var satrec = satellite.twoline2satrec(tles[1], tles[2]);

      if (this._badSat(satrec, qth, start)) {
        return null;
      }

      var observes = [], observed;
      var iterations = 0;
      while (start < end && iterations < max_iterations) {
        observed = this._observe(satrec, qth, start);
        if (!observed) {
          break;
        }
        observes.push(observed);
        start.add(interval);
        iterations += 1;
      }

      return observes
    },

    transits: function(tle, qth, start, end, minElevation, maxTransits) {
      start = m_moment(start);
      end = m_moment(end);

      if (!minElevation) {
        minElevation = defaultMinElevation;
      }

      if (!maxTransits) {
        maxTransits = max_iterations;
      }

      var tles = tle.split('\n');
      var satrec = satellite.twoline2satrec(tles[1], tles[2]);
      if (this._badSat(satrec, qth, start)) {
        return [];
      }

      var time = start.valueOf();
      var transits = [];
      var nextTransit;
      var iterations = 0;

      while (iterations < max_iterations && transits.length < maxTransits) {
        transit = this._quickPredict(satrec, qth, time);
        if (!transit) {
          break;
        }
        if (transit.end > end.valueOf()) {
          break;
        }
        if (transit.end > start.valueOf() && transit.maxElevation > minElevation) {
          transits.push(transit);
        }
        time = transit.end + 60 * 1000;
        iterations += 1;
      }

      return transits
    },

    _observe: function(satrec, qth, start) {
      start = m_moment(start);
      var eci = this._eci(satrec, start);
      var gmst = this._gmst(start);
      if (!eci.position) {
        return null;
      }
      var geo = satellite.eciToGeodetic(eci.position, gmst);

      var solar_vector = this._calculateSolarPosition(start.valueOf());
      var eclipse = this._satEclipsed(eci.position, solar_vector);

      var track = {
        eci: eci,
        gmst: gmst,
        latitude: geo.latitude / deg2rad,
        longitude: this._boundLongitude(geo.longitude / deg2rad),
        altitude: geo.height,
        footprint: 12756.33 * Math.acos(xkmper / (xkmper + geo.height)),
        sunlit: !eclipse.eclipsed,
        eclipseDepth: eclipse.depth / deg2rad
      }

      // If we have a groundstation let's get those additional observe parameters
      if (qth && qth.length == 3) {
        var observerGd = {
          longitude: qth[1] * deg2rad,
          latitude: qth[0] * deg2rad,
          height: qth[2]
        }

        var positionEcf = satellite.eciToEcf(eci.position, gmst),
          velocityEcf = satellite.eciToEcf(eci.velocity, gmst),
          observerEcf = satellite.geodeticToEcf(observerGd),
          lookAngles = satellite.ecfToLookAngles(observerGd, positionEcf),
          doppler = satellite.dopplerFactor(observerEcf, positionEcf, velocityEcf);

        track.azimuth = lookAngles.azimuth / deg2rad;
        track.elevation = lookAngles.elevation / deg2rad;
        track.rangeSat = lookAngles.rangeSat;
        track.doppler = doppler;
      }

      return track
    },

    _quickPredict: function(satrec, qth, start) {
      var transit = {};
      var lastel = 0;
      var iterations = 0;

      if (this._badSat(satrec, qth, start)) {
        return null;
      }

      var daynum = this._findAOS(satrec, qth, start);
      if (!daynum) {
        return null;
      }
      transit.start = daynum;

      var observed = this._observe(satrec, qth, daynum);
      if (!observed) {
        return null;
      }

      var iel = Math.round(observed.elevation);

      var maxEl = 0, apexAz = 0, minAz = 360, maxAz = 0;

      while (iel >= 0 && iterations < max_iterations) {
        lastel = iel;
        daynum = daynum + ms2day * Math.cos((observed.elevation-1.0)*deg2rad)*Math.sqrt(observed.altitude)/25000.0;
        observed = this._observe(satrec, qth, daynum);
        iel = Math.round(observed.elevation);
        if (maxEl < observed.elevation) {
          maxEl = observed.elevation;
          apexAz = observed.azimuth;
        }
        maxAz = Math.max(maxAz, observed.azimuth);
        minAz = Math.min(minAz, observed.azimuth);
        iterations += 1;
      }
      if (lastel !== 0) {
        daynum = this._findLOS(satrec, qth, daynum);
      }

      transit.end = daynum;
      transit.maxElevation = maxEl;
      transit.apexAzimuth = apexAz;
      transit.maxAzimuth = maxAz;
      transit.minAzimuth = minAz;
      transit.duration = transit.end - transit.start;

      return transit
    },

    _badSat: function(satrec, qth, start) {
      if (qth && !this._aosHappens(satrec, qth)) {
        return true
      } else if (start && this._decayed(satrec, start)) {
        return true
      } else {
        return false
      }
    },

    _aosHappens: function(satrec, qth) {
      var lin, sma, apogee;
      var meanmo = satrec.no * 24 * 60 / (2 * Math.PI); // convert rad/min to rev/day
      if (meanmo === 0) {
        return false
      } else {
        lin = satrec.inclo / deg2rad;

        if (lin >= 90.0) {
          lin = 180.0 - lin;
        }

        sma = 331.25 * Math.exp(Math.log(1440.0/meanmo)*(2.0/3.0));
        apogee = sma * (1.0 + satrec.ecco) - xkmper;

        if ((Math.acos(xkmper/(apogee+xkmper))+(lin*deg2rad)) > Math.abs(qth[0]*deg2rad)) {
          return true
        } else {
          return false
        }
      }
    },

    _decayed: function(satrec, start) {
      start = m_moment(start);

      var satepoch = m_moment.utc(satrec.epochyr, "YY").add(satrec.epochdays, 'days').valueOf();

      var meanmo = satrec.no * 24 * 60 / (2 * Math.PI); // convert rad/min to rev/day
      var drag = satrec.ndot * 24 * 60 * 24 * 60 / (2 * Math.PI); // convert rev/day^2

      if (satepoch + ms2day * ((16.666666-meanmo)/(10.0*Math.abs(drag))) < start) {
        return true
      } else {
        return false
      }
    },

    _findAOS: function(satrec, qth, start) {
      var current = start;
      var observed = this._observe(satrec, qth, current);
      if (!observed) {
        return null;
      }
      var aostime = 0;
      var iterations = 0;

      if (observed.elevation > 0) {
        return current
      }
      while (observed.elevation < -1 && iterations < max_iterations) {
        current = current - ms2day * 0.00035*(observed.elevation*((observed.altitude/8400.0)+0.46)-2.0);
        observed = this._observe(satrec, qth, current);
        if (!observed) {
          break;
        }
        iterations += 1;
      }
      iterations = 0;
      while (aostime === 0 && iterations < max_iterations) {
        if (!observed) {
          break;
        }
        if (Math.abs(observed.elevation) < 0.50) { // this was 0.03 but switched to 0.50 for performance
          aostime = current;
        } else {
          current = current - ms2day * observed.elevation * Math.sqrt(observed.altitude)/530000.0;
          observed = this._observe(satrec, qth, current);
        }
        iterations += 1;
      }
      if (aostime === 0) {
        return null;
      }
      return aostime
    },

    _findLOS: function(satrec, qth, start) {
      var current = start;
      var observed = this._observe(satrec, qth, current);
      var lostime = 0;
      var iterations = 0;

      while (lostime === 0 && iterations < max_iterations) {
        if (Math.abs(observed.elevation) < 0.50) { // this was 0.03 but switched to 0.50 for performance
          lostime = current;
        } else {
          current = current + ms2day * observed.elevation * Math.sqrt(observed.altitude)/502500.0;
          observed = this._observe(satrec, qth, current);
          if (!observed) {
            break;
          }
        }
        iterations += 1;
      }
      return lostime
    },

    _eci: function(satrec, date) {
      date = new Date(date.valueOf());
      return satellite.propagate(
        satrec,
        date.getUTCFullYear(),
        date.getUTCMonth() + 1, // months range 1-12
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds()
      );
    },

    _gmst: function(date) {
      date = new Date(date.valueOf());
      return satellite.gstimeFromDate(
        date.getUTCFullYear(),
        date.getUTCMonth() + 1, // months range 1-12
        date.getUTCDate(),
        date.getUTCHours(),
        date.getUTCMinutes(),
        date.getUTCSeconds()
      );
    },

    _boundLongitude: function(longitude) {
      while (longitude < -180) {
        longitude += 360;
      }
      while (longitude > 180) {
        longitude -= 360;
      }
      return longitude
    },

    _satEclipsed: function(pos, sol) {
      var sd_earth = Math.asin(xkmper / this._magnitude(pos));
      var rho = this._vecSub(sol, pos);
      var sd_sun = Math.asin(solar_radius / rho.w);
      var earth = this._scalarMultiply(-1, pos);
      var delta = this._angle(sol, earth);

      var eclipseDepth = sd_earth - sd_sun - delta;
      var eclipse;
      if (sd_earth < sd_sun) {
        eclipse = false;
      } else if (eclipseDepth >= 0) {
        eclipse = true;
      } else {
        eclipse = false;
      }
      return {
        depth: eclipseDepth,
        eclipsed: eclipse
      }
    },

    _calculateSolarPosition: function(start) {
      var time = start / ms2day + 2444238.5; // jul_utc

      var mjd = time - 2415020.0;
      var year = 1900 + mjd / 365.25;
      var T = (mjd + this._deltaET(year) / (ms2day / 1000)) / 36525.0;
      var M = deg2rad * ((358.47583 + ((35999.04975 * T) % 360) - (0.000150 + 0.0000033 * T) * Math.pow(T, 2)) % 360);
      var L = deg2rad * ((279.69668 + ((36000.76892 * T) % 360) + 0.0003025 * Math.pow(T, 2)) % 360);
      var e = 0.01675104 - (0.0000418 + 0.000000126 * T) * T;
      var C = deg2rad * ((1.919460 - (0.004789 + 0.000014 * T) * T) * Math.sin(M) + (0.020094 - 0.000100 * T) * Math.sin(2 * M) + 0.000293 * Math.sin(3 * M));
      var O = deg2rad * ((259.18 - 1934.142 * T) % 360.0);
      var Lsa = (L + C - deg2rad * (0.00569 - 0.00479 * Math.sin(O))) % (2 * Math.PI);
      var nu = (M + C) % (2 * Math.PI);
      var R = 1.0000002 * (1 - Math.pow(e, 2)) / (1 + e * Math.cos(nu));
      var eps = deg2rad * (23.452294 - (0.0130125 + (0.00000164 - 0.000000503 * T) * T) * T + 0.00256 * Math.cos(O));
      var R = astro_unit * R;

      return {
        x: R * Math.cos(Lsa),
        y: R * Math.sin(Lsa) * Math.cos(eps),
        z: R * Math.sin(Lsa) * Math.sin(eps),
        w: R
      }
    },

    _deltaET: function(year) {
      return 26.465 + 0.747622 * (year - 1950) + 1.886913 * Math.sin((2 * Math.PI) * (year - 1975) / 33)
    },

    _vecSub: function(v1, v2) {
      var vec = {
        x: v1.x - v2.x,
        y: v1.y - v2.y,
        z: v1.z - v2.z
      }
      vec.w = this._magnitude(vec);
      return vec
    },

    _scalarMultiply: function(k, v) {
      return {
        x: k * v.x,
        y: k * v.y,
        z: k * v.z,
        w: v.w ? Math.abs(k) * v.w : undefined
      }
    },

    _magnitude: function(v) {
      return Math.sqrt(Math.pow(v.x, 2) + Math.pow(v.y, 2) + Math.pow(v.z, 2))
    },

    _angle: function(v1, v2) {
      var dot = (v1.x * v2.x + v1.y * v2.y + v1.z * v2.z);
      return Math.acos(dot / (this._magnitude(v1) * this._magnitude(v2)))
    }
  }

  return _jspredict;
}));
