// node_modules/robust-predicates/esm/util.js
var epsilon = 11102230246251565e-32;
var splitter = 134217729;
var resulterrbound = (3 + 8 * epsilon) * epsilon;
function sum(elen, e, flen, f, h) {
  let Q, Qnew, hh, bvirt;
  let enow = e[0];
  let fnow = f[0];
  let eindex = 0;
  let findex = 0;
  if (fnow > enow === fnow > -enow) {
    Q = enow;
    enow = e[++eindex];
  } else {
    Q = fnow;
    fnow = f[++findex];
  }
  let hindex = 0;
  if (eindex < elen && findex < flen) {
    if (fnow > enow === fnow > -enow) {
      Qnew = enow + Q;
      hh = Q - (Qnew - enow);
      enow = e[++eindex];
    } else {
      Qnew = fnow + Q;
      hh = Q - (Qnew - fnow);
      fnow = f[++findex];
    }
    Q = Qnew;
    if (hh !== 0) {
      h[hindex++] = hh;
    }
    while (eindex < elen && findex < flen) {
      if (fnow > enow === fnow > -enow) {
        Qnew = Q + enow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (enow - bvirt);
        enow = e[++eindex];
      } else {
        Qnew = Q + fnow;
        bvirt = Qnew - Q;
        hh = Q - (Qnew - bvirt) + (fnow - bvirt);
        fnow = f[++findex];
      }
      Q = Qnew;
      if (hh !== 0) {
        h[hindex++] = hh;
      }
    }
  }
  while (eindex < elen) {
    Qnew = Q + enow;
    bvirt = Qnew - Q;
    hh = Q - (Qnew - bvirt) + (enow - bvirt);
    enow = e[++eindex];
    Q = Qnew;
    if (hh !== 0) {
      h[hindex++] = hh;
    }
  }
  while (findex < flen) {
    Qnew = Q + fnow;
    bvirt = Qnew - Q;
    hh = Q - (Qnew - bvirt) + (fnow - bvirt);
    fnow = f[++findex];
    Q = Qnew;
    if (hh !== 0) {
      h[hindex++] = hh;
    }
  }
  if (Q !== 0 || hindex === 0) {
    h[hindex++] = Q;
  }
  return hindex;
}
function estimate(elen, e) {
  let Q = e[0];
  for (let i = 1; i < elen; i++) Q += e[i];
  return Q;
}
function vec(n) {
  return new Float64Array(n);
}

// node_modules/robust-predicates/esm/orient2d.js
var ccwerrboundA = (3 + 16 * epsilon) * epsilon;
var ccwerrboundB = (2 + 12 * epsilon) * epsilon;
var ccwerrboundC = (9 + 64 * epsilon) * epsilon * epsilon;
var B = vec(4);
var C1 = vec(8);
var C2 = vec(12);
var D = vec(16);
var u = vec(4);
function orient2dadapt(ax, ay, bx, by, cx, cy, detsum) {
  let acxtail, acytail, bcxtail, bcytail;
  let bvirt, c, ahi, alo, bhi, blo, _i, _j, _0, s1, s0, t1, t0, u32;
  const acx = ax - cx;
  const bcx = bx - cx;
  const acy = ay - cy;
  const bcy = by - cy;
  s1 = acx * bcy;
  c = splitter * acx;
  ahi = c - (c - acx);
  alo = acx - ahi;
  c = splitter * bcy;
  bhi = c - (c - bcy);
  blo = bcy - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acy * bcx;
  c = splitter * acy;
  ahi = c - (c - acy);
  alo = acy - ahi;
  c = splitter * bcx;
  bhi = c - (c - bcx);
  blo = bcx - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  B[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  B[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u32 = _j + _i;
  bvirt = u32 - _j;
  B[2] = _j - (u32 - bvirt) + (_i - bvirt);
  B[3] = u32;
  let det = estimate(4, B);
  let errbound = ccwerrboundB * detsum;
  if (det >= errbound || -det >= errbound) {
    return det;
  }
  bvirt = ax - acx;
  acxtail = ax - (acx + bvirt) + (bvirt - cx);
  bvirt = bx - bcx;
  bcxtail = bx - (bcx + bvirt) + (bvirt - cx);
  bvirt = ay - acy;
  acytail = ay - (acy + bvirt) + (bvirt - cy);
  bvirt = by - bcy;
  bcytail = by - (bcy + bvirt) + (bvirt - cy);
  if (acxtail === 0 && acytail === 0 && bcxtail === 0 && bcytail === 0) {
    return det;
  }
  errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
  det += acx * bcytail + bcy * acxtail - (acy * bcxtail + bcx * acytail);
  if (det >= errbound || -det >= errbound) return det;
  s1 = acxtail * bcy;
  c = splitter * acxtail;
  ahi = c - (c - acxtail);
  alo = acxtail - ahi;
  c = splitter * bcy;
  bhi = c - (c - bcy);
  blo = bcy - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acytail * bcx;
  c = splitter * acytail;
  ahi = c - (c - acytail);
  alo = acytail - ahi;
  c = splitter * bcx;
  bhi = c - (c - bcx);
  blo = bcx - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  u[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  u[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u32 = _j + _i;
  bvirt = u32 - _j;
  u[2] = _j - (u32 - bvirt) + (_i - bvirt);
  u[3] = u32;
  const C1len = sum(4, B, 4, u, C1);
  s1 = acx * bcytail;
  c = splitter * acx;
  ahi = c - (c - acx);
  alo = acx - ahi;
  c = splitter * bcytail;
  bhi = c - (c - bcytail);
  blo = bcytail - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acy * bcxtail;
  c = splitter * acy;
  ahi = c - (c - acy);
  alo = acy - ahi;
  c = splitter * bcxtail;
  bhi = c - (c - bcxtail);
  blo = bcxtail - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  u[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  u[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u32 = _j + _i;
  bvirt = u32 - _j;
  u[2] = _j - (u32 - bvirt) + (_i - bvirt);
  u[3] = u32;
  const C2len = sum(C1len, C1, 4, u, C2);
  s1 = acxtail * bcytail;
  c = splitter * acxtail;
  ahi = c - (c - acxtail);
  alo = acxtail - ahi;
  c = splitter * bcytail;
  bhi = c - (c - bcytail);
  blo = bcytail - bhi;
  s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
  t1 = acytail * bcxtail;
  c = splitter * acytail;
  ahi = c - (c - acytail);
  alo = acytail - ahi;
  c = splitter * bcxtail;
  bhi = c - (c - bcxtail);
  blo = bcxtail - bhi;
  t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
  _i = s0 - t0;
  bvirt = s0 - _i;
  u[0] = s0 - (_i + bvirt) + (bvirt - t0);
  _j = s1 + _i;
  bvirt = _j - s1;
  _0 = s1 - (_j - bvirt) + (_i - bvirt);
  _i = _0 - t1;
  bvirt = _0 - _i;
  u[1] = _0 - (_i + bvirt) + (bvirt - t1);
  u32 = _j + _i;
  bvirt = u32 - _j;
  u[2] = _j - (u32 - bvirt) + (_i - bvirt);
  u[3] = u32;
  const Dlen = sum(C2len, C2, 4, u, D);
  return D[Dlen - 1];
}
function orient2d(ax, ay, bx, by, cx, cy) {
  const detleft = (ay - cy) * (bx - cx);
  const detright = (ax - cx) * (by - cy);
  const det = detleft - detright;
  const detsum = Math.abs(detleft + detright);
  if (Math.abs(det) >= ccwerrboundA * detsum) return det;
  return -orient2dadapt(ax, ay, bx, by, cx, cy, detsum);
}

// node_modules/robust-predicates/esm/orient3d.js
var o3derrboundA = (7 + 56 * epsilon) * epsilon;
var o3derrboundB = (3 + 28 * epsilon) * epsilon;
var o3derrboundC = (26 + 288 * epsilon) * epsilon * epsilon;
var bc = vec(4);
var ca = vec(4);
var ab = vec(4);
var at_b = vec(4);
var at_c = vec(4);
var bt_c = vec(4);
var bt_a = vec(4);
var ct_a = vec(4);
var ct_b = vec(4);
var bct = vec(8);
var cat = vec(8);
var abt = vec(8);
var u2 = vec(4);
var _8 = vec(8);
var _8b = vec(8);
var _16 = vec(8);
var _12 = vec(12);
var fin = vec(192);
var fin2 = vec(192);

// node_modules/robust-predicates/esm/incircle.js
var iccerrboundA = (10 + 96 * epsilon) * epsilon;
var iccerrboundB = (4 + 48 * epsilon) * epsilon;
var iccerrboundC = (44 + 576 * epsilon) * epsilon * epsilon;
var bc2 = vec(4);
var ca2 = vec(4);
var ab2 = vec(4);
var aa = vec(4);
var bb = vec(4);
var cc = vec(4);
var u3 = vec(4);
var v = vec(4);
var axtbc = vec(8);
var aytbc = vec(8);
var bxtca = vec(8);
var bytca = vec(8);
var cxtab = vec(8);
var cytab = vec(8);
var abt2 = vec(8);
var bct2 = vec(8);
var cat2 = vec(8);
var abtt = vec(4);
var bctt = vec(4);
var catt = vec(4);
var _82 = vec(8);
var _162 = vec(16);
var _16b = vec(16);
var _16c = vec(16);
var _32 = vec(32);
var _32b = vec(32);
var _48 = vec(48);
var _64 = vec(64);
var fin3 = vec(1152);
var fin22 = vec(1152);

// node_modules/robust-predicates/esm/insphere.js
var isperrboundA = (16 + 224 * epsilon) * epsilon;
var isperrboundB = (5 + 72 * epsilon) * epsilon;
var isperrboundC = (71 + 1408 * epsilon) * epsilon * epsilon;
var ab3 = vec(4);
var bc3 = vec(4);
var cd = vec(4);
var de = vec(4);
var ea = vec(4);
var ac = vec(4);
var bd = vec(4);
var ce = vec(4);
var da = vec(4);
var eb = vec(4);
var abc = vec(24);
var bcd = vec(24);
var cde = vec(24);
var dea = vec(24);
var eab = vec(24);
var abd = vec(24);
var bce = vec(24);
var cda = vec(24);
var deb = vec(24);
var eac = vec(24);
var adet = vec(1152);
var bdet = vec(1152);
var cdet = vec(1152);
var ddet = vec(1152);
var edet = vec(1152);
var abdet = vec(2304);
var cddet = vec(2304);
var cdedet = vec(3456);
var deter = vec(5760);
var _83 = vec(8);
var _8b2 = vec(8);
var _8c = vec(8);
var _163 = vec(16);
var _24 = vec(24);
var _482 = vec(48);
var _48b = vec(48);
var _96 = vec(96);
var _192 = vec(192);
var _384x = vec(384);
var _384y = vec(384);
var _384z = vec(384);
var _768 = vec(768);
var xdet = vec(96);
var ydet = vec(96);
var zdet = vec(96);
var fin4 = vec(1152);

// node_modules/delaunator/index.js
var EPSILON = Math.pow(2, -52);
var EDGE_STACK = new Uint32Array(512);
var Delaunator = class _Delaunator {
  static from(points, getX = defaultGetX, getY = defaultGetY) {
    const n = points.length;
    const coords = new Float64Array(n * 2);
    for (let i = 0; i < n; i++) {
      const p = points[i];
      coords[2 * i] = getX(p);
      coords[2 * i + 1] = getY(p);
    }
    return new _Delaunator(coords);
  }
  constructor(coords) {
    const n = coords.length >> 1;
    if (n > 0 && typeof coords[0] !== "number") throw new Error("Expected coords to contain numbers.");
    this.coords = coords;
    const maxTriangles = Math.max(2 * n - 5, 0);
    this._triangles = new Uint32Array(maxTriangles * 3);
    this._halfedges = new Int32Array(maxTriangles * 3);
    this._hashSize = Math.ceil(Math.sqrt(n));
    this._hullPrev = new Uint32Array(n);
    this._hullNext = new Uint32Array(n);
    this._hullTri = new Uint32Array(n);
    this._hullHash = new Int32Array(this._hashSize);
    this._ids = new Uint32Array(n);
    this._dists = new Float64Array(n);
    this.update();
  }
  update() {
    const { coords, _hullPrev: hullPrev, _hullNext: hullNext, _hullTri: hullTri, _hullHash: hullHash } = this;
    const n = coords.length >> 1;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      const x = coords[2 * i];
      const y = coords[2 * i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      this._ids[i] = i;
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    let i0, i1, i2;
    for (let i = 0, minDist = Infinity; i < n; i++) {
      const d = dist(cx, cy, coords[2 * i], coords[2 * i + 1]);
      if (d < minDist) {
        i0 = i;
        minDist = d;
      }
    }
    const i0x = coords[2 * i0];
    const i0y = coords[2 * i0 + 1];
    for (let i = 0, minDist = Infinity; i < n; i++) {
      if (i === i0) continue;
      const d = dist(i0x, i0y, coords[2 * i], coords[2 * i + 1]);
      if (d < minDist && d > 0) {
        i1 = i;
        minDist = d;
      }
    }
    let i1x = coords[2 * i1];
    let i1y = coords[2 * i1 + 1];
    let minRadius = Infinity;
    for (let i = 0; i < n; i++) {
      if (i === i0 || i === i1) continue;
      const r = circumradius(i0x, i0y, i1x, i1y, coords[2 * i], coords[2 * i + 1]);
      if (r < minRadius) {
        i2 = i;
        minRadius = r;
      }
    }
    let i2x = coords[2 * i2];
    let i2y = coords[2 * i2 + 1];
    if (minRadius === Infinity) {
      for (let i = 0; i < n; i++) {
        this._dists[i] = coords[2 * i] - coords[0] || coords[2 * i + 1] - coords[1];
      }
      quicksort(this._ids, this._dists, 0, n - 1);
      const hull = new Uint32Array(n);
      let j = 0;
      for (let i = 0, d0 = -Infinity; i < n; i++) {
        const id = this._ids[i];
        const d = this._dists[id];
        if (d > d0) {
          hull[j++] = id;
          d0 = d;
        }
      }
      this.hull = hull.subarray(0, j);
      this.triangles = new Uint32Array(0);
      this.halfedges = new Uint32Array(0);
      return;
    }
    if (orient2d(i0x, i0y, i1x, i1y, i2x, i2y) < 0) {
      const i = i1;
      const x = i1x;
      const y = i1y;
      i1 = i2;
      i1x = i2x;
      i1y = i2y;
      i2 = i;
      i2x = x;
      i2y = y;
    }
    const center = circumcenter(i0x, i0y, i1x, i1y, i2x, i2y);
    this._cx = center.x;
    this._cy = center.y;
    for (let i = 0; i < n; i++) {
      this._dists[i] = dist(coords[2 * i], coords[2 * i + 1], center.x, center.y);
    }
    quicksort(this._ids, this._dists, 0, n - 1);
    this._hullStart = i0;
    let hullSize = 3;
    hullNext[i0] = hullPrev[i2] = i1;
    hullNext[i1] = hullPrev[i0] = i2;
    hullNext[i2] = hullPrev[i1] = i0;
    hullTri[i0] = 0;
    hullTri[i1] = 1;
    hullTri[i2] = 2;
    hullHash.fill(-1);
    hullHash[this._hashKey(i0x, i0y)] = i0;
    hullHash[this._hashKey(i1x, i1y)] = i1;
    hullHash[this._hashKey(i2x, i2y)] = i2;
    this.trianglesLen = 0;
    this._addTriangle(i0, i1, i2, -1, -1, -1);
    for (let k = 0, xp, yp; k < this._ids.length; k++) {
      const i = this._ids[k];
      const x = coords[2 * i];
      const y = coords[2 * i + 1];
      if (k > 0 && Math.abs(x - xp) <= EPSILON && Math.abs(y - yp) <= EPSILON) continue;
      xp = x;
      yp = y;
      if (i === i0 || i === i1 || i === i2) continue;
      let start = 0;
      for (let j = 0, key = this._hashKey(x, y); j < this._hashSize; j++) {
        start = hullHash[(key + j) % this._hashSize];
        if (start !== -1 && start !== hullNext[start]) break;
      }
      start = hullPrev[start];
      let e = start, q;
      while (q = hullNext[e], orient2d(x, y, coords[2 * e], coords[2 * e + 1], coords[2 * q], coords[2 * q + 1]) >= 0) {
        e = q;
        if (e === start) {
          e = -1;
          break;
        }
      }
      if (e === -1) continue;
      let t = this._addTriangle(e, i, hullNext[e], -1, -1, hullTri[e]);
      hullTri[i] = this._legalize(t + 2);
      hullTri[e] = t;
      hullSize++;
      let n2 = hullNext[e];
      while (q = hullNext[n2], orient2d(x, y, coords[2 * n2], coords[2 * n2 + 1], coords[2 * q], coords[2 * q + 1]) < 0) {
        t = this._addTriangle(n2, i, q, hullTri[i], -1, hullTri[n2]);
        hullTri[i] = this._legalize(t + 2);
        hullNext[n2] = n2;
        hullSize--;
        n2 = q;
      }
      if (e === start) {
        while (q = hullPrev[e], orient2d(x, y, coords[2 * q], coords[2 * q + 1], coords[2 * e], coords[2 * e + 1]) < 0) {
          t = this._addTriangle(q, i, e, -1, hullTri[e], hullTri[q]);
          this._legalize(t + 2);
          hullTri[q] = t;
          hullNext[e] = e;
          hullSize--;
          e = q;
        }
      }
      this._hullStart = hullPrev[i] = e;
      hullNext[e] = hullPrev[n2] = i;
      hullNext[i] = n2;
      hullHash[this._hashKey(x, y)] = i;
      hullHash[this._hashKey(coords[2 * e], coords[2 * e + 1])] = e;
    }
    this.hull = new Uint32Array(hullSize);
    for (let i = 0, e = this._hullStart; i < hullSize; i++) {
      this.hull[i] = e;
      e = hullNext[e];
    }
    this.triangles = this._triangles.subarray(0, this.trianglesLen);
    this.halfedges = this._halfedges.subarray(0, this.trianglesLen);
  }
  _hashKey(x, y) {
    return Math.floor(pseudoAngle(x - this._cx, y - this._cy) * this._hashSize) % this._hashSize;
  }
  _legalize(a) {
    const { _triangles: triangles, _halfedges: halfedges, coords } = this;
    let i = 0;
    let ar = 0;
    while (true) {
      const b = halfedges[a];
      const a0 = a - a % 3;
      ar = a0 + (a + 2) % 3;
      if (b === -1) {
        if (i === 0) break;
        a = EDGE_STACK[--i];
        continue;
      }
      const b0 = b - b % 3;
      const al = a0 + (a + 1) % 3;
      const bl = b0 + (b + 2) % 3;
      const p0 = triangles[ar];
      const pr = triangles[a];
      const pl = triangles[al];
      const p1 = triangles[bl];
      const illegal = inCircle(
        coords[2 * p0],
        coords[2 * p0 + 1],
        coords[2 * pr],
        coords[2 * pr + 1],
        coords[2 * pl],
        coords[2 * pl + 1],
        coords[2 * p1],
        coords[2 * p1 + 1]
      );
      if (illegal) {
        triangles[a] = p1;
        triangles[b] = p0;
        const hbl = halfedges[bl];
        if (hbl === -1) {
          let e = this._hullStart;
          do {
            if (this._hullTri[e] === bl) {
              this._hullTri[e] = a;
              break;
            }
            e = this._hullPrev[e];
          } while (e !== this._hullStart);
        }
        this._link(a, hbl);
        this._link(b, halfedges[ar]);
        this._link(ar, bl);
        const br = b0 + (b + 1) % 3;
        if (i < EDGE_STACK.length) {
          EDGE_STACK[i++] = br;
        }
      } else {
        if (i === 0) break;
        a = EDGE_STACK[--i];
      }
    }
    return ar;
  }
  _link(a, b) {
    this._halfedges[a] = b;
    if (b !== -1) this._halfedges[b] = a;
  }
  // add a new triangle given vertex indices and adjacent half-edge ids
  _addTriangle(i0, i1, i2, a, b, c) {
    const t = this.trianglesLen;
    this._triangles[t] = i0;
    this._triangles[t + 1] = i1;
    this._triangles[t + 2] = i2;
    this._link(t, a);
    this._link(t + 1, b);
    this._link(t + 2, c);
    this.trianglesLen += 3;
    return t;
  }
};
function pseudoAngle(dx, dy) {
  const p = dx / (Math.abs(dx) + Math.abs(dy));
  return (dy > 0 ? 3 - p : 1 + p) / 4;
}
function dist(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
function inCircle(ax, ay, bx, by, cx, cy, px, py) {
  const dx = ax - px;
  const dy = ay - py;
  const ex = bx - px;
  const ey = by - py;
  const fx = cx - px;
  const fy = cy - py;
  const ap = dx * dx + dy * dy;
  const bp = ex * ex + ey * ey;
  const cp = fx * fx + fy * fy;
  return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0;
}
function circumradius(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax;
  const dy = by - ay;
  const ex = cx - ax;
  const ey = cy - ay;
  const bl = dx * dx + dy * dy;
  const cl = ex * ex + ey * ey;
  const d = 0.5 / (dx * ey - dy * ex);
  const x = (ey * bl - dy * cl) * d;
  const y = (dx * cl - ex * bl) * d;
  return x * x + y * y;
}
function circumcenter(ax, ay, bx, by, cx, cy) {
  const dx = bx - ax;
  const dy = by - ay;
  const ex = cx - ax;
  const ey = cy - ay;
  const bl = dx * dx + dy * dy;
  const cl = ex * ex + ey * ey;
  const d = 0.5 / (dx * ey - dy * ex);
  const x = ax + (ey * bl - dy * cl) * d;
  const y = ay + (dx * cl - ex * bl) * d;
  return { x, y };
}
function quicksort(ids, dists, left, right) {
  if (right - left <= 20) {
    for (let i = left + 1; i <= right; i++) {
      const temp = ids[i];
      const tempDist = dists[temp];
      let j = i - 1;
      while (j >= left && dists[ids[j]] > tempDist) ids[j + 1] = ids[j--];
      ids[j + 1] = temp;
    }
  } else {
    const median = left + right >> 1;
    let i = left + 1;
    let j = right;
    swap(ids, median, i);
    if (dists[ids[left]] > dists[ids[right]]) swap(ids, left, right);
    if (dists[ids[i]] > dists[ids[right]]) swap(ids, i, right);
    if (dists[ids[left]] > dists[ids[i]]) swap(ids, left, i);
    const temp = ids[i];
    const tempDist = dists[temp];
    while (true) {
      do
        i++;
      while (dists[ids[i]] < tempDist);
      do
        j--;
      while (dists[ids[j]] > tempDist);
      if (j < i) break;
      swap(ids, i, j);
    }
    ids[left + 1] = ids[j];
    ids[j] = temp;
    if (right - i + 1 >= j - left) {
      quicksort(ids, dists, i, right);
      quicksort(ids, dists, left, j - 1);
    } else {
      quicksort(ids, dists, left, j - 1);
      quicksort(ids, dists, i, right);
    }
  }
}
function swap(arr, i, j) {
  const tmp = arr[i];
  arr[i] = arr[j];
  arr[j] = tmp;
}
function defaultGetX(p) {
  return p[0];
}
function defaultGetY(p) {
  return p[1];
}

// node_modules/d3-delaunay/src/path.js
var epsilon2 = 1e-6;
var Path = class {
  constructor() {
    this._x0 = this._y0 = // start of current subpath
    this._x1 = this._y1 = null;
    this._ = "";
  }
  moveTo(x, y) {
    this._ += `M${this._x0 = this._x1 = +x},${this._y0 = this._y1 = +y}`;
  }
  closePath() {
    if (this._x1 !== null) {
      this._x1 = this._x0, this._y1 = this._y0;
      this._ += "Z";
    }
  }
  lineTo(x, y) {
    this._ += `L${this._x1 = +x},${this._y1 = +y}`;
  }
  arc(x, y, r) {
    x = +x, y = +y, r = +r;
    const x03 = x + r;
    const y03 = y;
    if (r < 0) throw new Error("negative radius");
    if (this._x1 === null) this._ += `M${x03},${y03}`;
    else if (Math.abs(this._x1 - x03) > epsilon2 || Math.abs(this._y1 - y03) > epsilon2) this._ += "L" + x03 + "," + y03;
    if (!r) return;
    this._ += `A${r},${r},0,1,1,${x - r},${y}A${r},${r},0,1,1,${this._x1 = x03},${this._y1 = y03}`;
  }
  rect(x, y, w, h) {
    this._ += `M${this._x0 = this._x1 = +x},${this._y0 = this._y1 = +y}h${+w}v${+h}h${-w}Z`;
  }
  value() {
    return this._ || null;
  }
};

// node_modules/d3-delaunay/src/polygon.js
var Polygon = class {
  constructor() {
    this._ = [];
  }
  moveTo(x, y) {
    this._.push([x, y]);
  }
  closePath() {
    this._.push(this._[0].slice());
  }
  lineTo(x, y) {
    this._.push([x, y]);
  }
  value() {
    return this._.length ? this._ : null;
  }
};

// node_modules/d3-delaunay/src/voronoi.js
var Voronoi = class {
  constructor(delaunay, [xmin, ymin, xmax, ymax] = [0, 0, 960, 500]) {
    if (!((xmax = +xmax) >= (xmin = +xmin)) || !((ymax = +ymax) >= (ymin = +ymin))) throw new Error("invalid bounds");
    this.delaunay = delaunay;
    this._circumcenters = new Float64Array(delaunay.points.length * 2);
    this.vectors = new Float64Array(delaunay.points.length * 2);
    this.xmax = xmax, this.xmin = xmin;
    this.ymax = ymax, this.ymin = ymin;
    this._init();
  }
  update() {
    this.delaunay.update();
    this._init();
    return this;
  }
  _init() {
    const { delaunay: { points, hull, triangles }, vectors } = this;
    let bx, by;
    const circumcenters = this.circumcenters = this._circumcenters.subarray(0, triangles.length / 3 * 2);
    for (let i = 0, j = 0, n = triangles.length, x, y; i < n; i += 3, j += 2) {
      const t1 = triangles[i] * 2;
      const t2 = triangles[i + 1] * 2;
      const t3 = triangles[i + 2] * 2;
      const x13 = points[t1];
      const y13 = points[t1 + 1];
      const x2 = points[t2];
      const y2 = points[t2 + 1];
      const x3 = points[t3];
      const y3 = points[t3 + 1];
      const dx = x2 - x13;
      const dy = y2 - y13;
      const ex = x3 - x13;
      const ey = y3 - y13;
      const ab4 = (dx * ey - dy * ex) * 2;
      if (Math.abs(ab4) < 1e-9) {
        if (bx === void 0) {
          bx = by = 0;
          for (const i2 of hull) bx += points[i2 * 2], by += points[i2 * 2 + 1];
          bx /= hull.length, by /= hull.length;
        }
        const a = 1e9 * Math.sign((bx - x13) * ey - (by - y13) * ex);
        x = (x13 + x3) / 2 - a * ey;
        y = (y13 + y3) / 2 + a * ex;
      } else {
        const d = 1 / ab4;
        const bl = dx * dx + dy * dy;
        const cl = ex * ex + ey * ey;
        x = x13 + (ey * bl - dy * cl) * d;
        y = y13 + (dx * cl - ex * bl) * d;
      }
      circumcenters[j] = x;
      circumcenters[j + 1] = y;
    }
    let h = hull[hull.length - 1];
    let p0, p1 = h * 4;
    let x03, x12 = points[2 * h];
    let y03, y12 = points[2 * h + 1];
    vectors.fill(0);
    for (let i = 0; i < hull.length; ++i) {
      h = hull[i];
      p0 = p1, x03 = x12, y03 = y12;
      p1 = h * 4, x12 = points[2 * h], y12 = points[2 * h + 1];
      vectors[p0 + 2] = vectors[p1] = y03 - y12;
      vectors[p0 + 3] = vectors[p1 + 1] = x12 - x03;
    }
  }
  render(context) {
    const buffer = context == null ? context = new Path() : void 0;
    const { delaunay: { halfedges, inedges, hull }, circumcenters, vectors } = this;
    if (hull.length <= 1) return null;
    for (let i = 0, n = halfedges.length; i < n; ++i) {
      const j = halfedges[i];
      if (j < i) continue;
      const ti = Math.floor(i / 3) * 2;
      const tj = Math.floor(j / 3) * 2;
      const xi = circumcenters[ti];
      const yi = circumcenters[ti + 1];
      const xj = circumcenters[tj];
      const yj = circumcenters[tj + 1];
      this._renderSegment(xi, yi, xj, yj, context);
    }
    let h0, h1 = hull[hull.length - 1];
    for (let i = 0; i < hull.length; ++i) {
      h0 = h1, h1 = hull[i];
      const t = Math.floor(inedges[h1] / 3) * 2;
      const x = circumcenters[t];
      const y = circumcenters[t + 1];
      const v2 = h0 * 4;
      const p = this._project(x, y, vectors[v2 + 2], vectors[v2 + 3]);
      if (p) this._renderSegment(x, y, p[0], p[1], context);
    }
    return buffer && buffer.value();
  }
  renderBounds(context) {
    const buffer = context == null ? context = new Path() : void 0;
    context.rect(this.xmin, this.ymin, this.xmax - this.xmin, this.ymax - this.ymin);
    return buffer && buffer.value();
  }
  renderCell(i, context) {
    const buffer = context == null ? context = new Path() : void 0;
    const points = this._clip(i);
    if (points === null || !points.length) return;
    context.moveTo(points[0], points[1]);
    let n = points.length;
    while (points[0] === points[n - 2] && points[1] === points[n - 1] && n > 1) n -= 2;
    for (let i2 = 2; i2 < n; i2 += 2) {
      if (points[i2] !== points[i2 - 2] || points[i2 + 1] !== points[i2 - 1])
        context.lineTo(points[i2], points[i2 + 1]);
    }
    context.closePath();
    return buffer && buffer.value();
  }
  *cellPolygons() {
    const { delaunay: { points } } = this;
    for (let i = 0, n = points.length / 2; i < n; ++i) {
      const cell = this.cellPolygon(i);
      if (cell) cell.index = i, yield cell;
    }
  }
  cellPolygon(i) {
    const polygon = new Polygon();
    this.renderCell(i, polygon);
    return polygon.value();
  }
  _renderSegment(x03, y03, x12, y12, context) {
    let S;
    const c0 = this._regioncode(x03, y03);
    const c1 = this._regioncode(x12, y12);
    if (c0 === 0 && c1 === 0) {
      context.moveTo(x03, y03);
      context.lineTo(x12, y12);
    } else if (S = this._clipSegment(x03, y03, x12, y12, c0, c1)) {
      context.moveTo(S[0], S[1]);
      context.lineTo(S[2], S[3]);
    }
  }
  contains(i, x, y) {
    if ((x = +x, x !== x) || (y = +y, y !== y)) return false;
    return this.delaunay._step(i, x, y) === i;
  }
  *neighbors(i) {
    const ci = this._clip(i);
    if (ci) for (const j of this.delaunay.neighbors(i)) {
      const cj = this._clip(j);
      if (cj) loop: for (let ai = 0, li = ci.length; ai < li; ai += 2) {
        for (let aj = 0, lj = cj.length; aj < lj; aj += 2) {
          if (ci[ai] === cj[aj] && ci[ai + 1] === cj[aj + 1] && ci[(ai + 2) % li] === cj[(aj + lj - 2) % lj] && ci[(ai + 3) % li] === cj[(aj + lj - 1) % lj]) {
            yield j;
            break loop;
          }
        }
      }
    }
  }
  _cell(i) {
    const { circumcenters, delaunay: { inedges, halfedges, triangles } } = this;
    const e0 = inedges[i];
    if (e0 === -1) return null;
    const points = [];
    let e = e0;
    do {
      const t = Math.floor(e / 3);
      points.push(circumcenters[t * 2], circumcenters[t * 2 + 1]);
      e = e % 3 === 2 ? e - 2 : e + 1;
      if (triangles[e] !== i) break;
      e = halfedges[e];
    } while (e !== e0 && e !== -1);
    return points;
  }
  _clip(i) {
    if (i === 0 && this.delaunay.hull.length === 1) {
      return [this.xmax, this.ymin, this.xmax, this.ymax, this.xmin, this.ymax, this.xmin, this.ymin];
    }
    const points = this._cell(i);
    if (points === null) return null;
    const { vectors: V } = this;
    const v2 = i * 4;
    return this._simplify(V[v2] || V[v2 + 1] ? this._clipInfinite(i, points, V[v2], V[v2 + 1], V[v2 + 2], V[v2 + 3]) : this._clipFinite(i, points));
  }
  _clipFinite(i, points) {
    const n = points.length;
    let P = null;
    let x03, y03, x12 = points[n - 2], y12 = points[n - 1];
    let c0, c1 = this._regioncode(x12, y12);
    let e0, e1 = 0;
    for (let j = 0; j < n; j += 2) {
      x03 = x12, y03 = y12, x12 = points[j], y12 = points[j + 1];
      c0 = c1, c1 = this._regioncode(x12, y12);
      if (c0 === 0 && c1 === 0) {
        e0 = e1, e1 = 0;
        if (P) P.push(x12, y12);
        else P = [x12, y12];
      } else {
        let S, sx0, sy0, sx1, sy1;
        if (c0 === 0) {
          if ((S = this._clipSegment(x03, y03, x12, y12, c0, c1)) === null) continue;
          [sx0, sy0, sx1, sy1] = S;
        } else {
          if ((S = this._clipSegment(x12, y12, x03, y03, c1, c0)) === null) continue;
          [sx1, sy1, sx0, sy0] = S;
          e0 = e1, e1 = this._edgecode(sx0, sy0);
          if (e0 && e1) this._edge(i, e0, e1, P, P.length);
          if (P) P.push(sx0, sy0);
          else P = [sx0, sy0];
        }
        e0 = e1, e1 = this._edgecode(sx1, sy1);
        if (e0 && e1) this._edge(i, e0, e1, P, P.length);
        if (P) P.push(sx1, sy1);
        else P = [sx1, sy1];
      }
    }
    if (P) {
      e0 = e1, e1 = this._edgecode(P[0], P[1]);
      if (e0 && e1) this._edge(i, e0, e1, P, P.length);
    } else if (this.contains(i, (this.xmin + this.xmax) / 2, (this.ymin + this.ymax) / 2)) {
      return [this.xmax, this.ymin, this.xmax, this.ymax, this.xmin, this.ymax, this.xmin, this.ymin];
    }
    return P;
  }
  _clipSegment(x03, y03, x12, y12, c0, c1) {
    const flip = c0 < c1;
    if (flip) [x03, y03, x12, y12, c0, c1] = [x12, y12, x03, y03, c1, c0];
    while (true) {
      if (c0 === 0 && c1 === 0) return flip ? [x12, y12, x03, y03] : [x03, y03, x12, y12];
      if (c0 & c1) return null;
      let x, y, c = c0 || c1;
      if (c & 8) x = x03 + (x12 - x03) * (this.ymax - y03) / (y12 - y03), y = this.ymax;
      else if (c & 4) x = x03 + (x12 - x03) * (this.ymin - y03) / (y12 - y03), y = this.ymin;
      else if (c & 2) y = y03 + (y12 - y03) * (this.xmax - x03) / (x12 - x03), x = this.xmax;
      else y = y03 + (y12 - y03) * (this.xmin - x03) / (x12 - x03), x = this.xmin;
      if (c0) x03 = x, y03 = y, c0 = this._regioncode(x03, y03);
      else x12 = x, y12 = y, c1 = this._regioncode(x12, y12);
    }
  }
  _clipInfinite(i, points, vx0, vy0, vxn, vyn) {
    let P = Array.from(points), p;
    if (p = this._project(P[0], P[1], vx0, vy0)) P.unshift(p[0], p[1]);
    if (p = this._project(P[P.length - 2], P[P.length - 1], vxn, vyn)) P.push(p[0], p[1]);
    if (P = this._clipFinite(i, P)) {
      for (let j = 0, n = P.length, c0, c1 = this._edgecode(P[n - 2], P[n - 1]); j < n; j += 2) {
        c0 = c1, c1 = this._edgecode(P[j], P[j + 1]);
        if (c0 && c1) j = this._edge(i, c0, c1, P, j), n = P.length;
      }
    } else if (this.contains(i, (this.xmin + this.xmax) / 2, (this.ymin + this.ymax) / 2)) {
      P = [this.xmin, this.ymin, this.xmax, this.ymin, this.xmax, this.ymax, this.xmin, this.ymax];
    }
    return P;
  }
  _edge(i, e0, e1, P, j) {
    while (e0 !== e1) {
      let x, y;
      switch (e0) {
        case 5:
          e0 = 4;
          continue;
        // top-left
        case 4:
          e0 = 6, x = this.xmax, y = this.ymin;
          break;
        // top
        case 6:
          e0 = 2;
          continue;
        // top-right
        case 2:
          e0 = 10, x = this.xmax, y = this.ymax;
          break;
        // right
        case 10:
          e0 = 8;
          continue;
        // bottom-right
        case 8:
          e0 = 9, x = this.xmin, y = this.ymax;
          break;
        // bottom
        case 9:
          e0 = 1;
          continue;
        // bottom-left
        case 1:
          e0 = 5, x = this.xmin, y = this.ymin;
          break;
      }
      if ((P[j] !== x || P[j + 1] !== y) && this.contains(i, x, y)) {
        P.splice(j, 0, x, y), j += 2;
      }
    }
    return j;
  }
  _project(x03, y03, vx, vy) {
    let t = Infinity, c, x, y;
    if (vy < 0) {
      if (y03 <= this.ymin) return null;
      if ((c = (this.ymin - y03) / vy) < t) y = this.ymin, x = x03 + (t = c) * vx;
    } else if (vy > 0) {
      if (y03 >= this.ymax) return null;
      if ((c = (this.ymax - y03) / vy) < t) y = this.ymax, x = x03 + (t = c) * vx;
    }
    if (vx > 0) {
      if (x03 >= this.xmax) return null;
      if ((c = (this.xmax - x03) / vx) < t) x = this.xmax, y = y03 + (t = c) * vy;
    } else if (vx < 0) {
      if (x03 <= this.xmin) return null;
      if ((c = (this.xmin - x03) / vx) < t) x = this.xmin, y = y03 + (t = c) * vy;
    }
    return [x, y];
  }
  _edgecode(x, y) {
    return (x === this.xmin ? 1 : x === this.xmax ? 2 : 0) | (y === this.ymin ? 4 : y === this.ymax ? 8 : 0);
  }
  _regioncode(x, y) {
    return (x < this.xmin ? 1 : x > this.xmax ? 2 : 0) | (y < this.ymin ? 4 : y > this.ymax ? 8 : 0);
  }
  _simplify(P) {
    if (P && P.length > 4) {
      for (let i = 0; i < P.length; i += 2) {
        const j = (i + 2) % P.length, k = (i + 4) % P.length;
        if (P[i] === P[j] && P[j] === P[k] || P[i + 1] === P[j + 1] && P[j + 1] === P[k + 1]) {
          P.splice(j, 2), i -= 2;
        }
      }
      if (!P.length) P = null;
    }
    return P;
  }
};

// node_modules/d3-delaunay/src/delaunay.js
var tau = 2 * Math.PI;
var pow = Math.pow;
function pointX(p) {
  return p[0];
}
function pointY(p) {
  return p[1];
}
function collinear(d) {
  const { triangles, coords } = d;
  for (let i = 0; i < triangles.length; i += 3) {
    const a = 2 * triangles[i], b = 2 * triangles[i + 1], c = 2 * triangles[i + 2], cross = (coords[c] - coords[a]) * (coords[b + 1] - coords[a + 1]) - (coords[b] - coords[a]) * (coords[c + 1] - coords[a + 1]);
    if (cross > 1e-10) return false;
  }
  return true;
}
function jitter(x, y, r) {
  return [x + Math.sin(x + y) * r, y + Math.cos(x - y) * r];
}
var Delaunay = class _Delaunay {
  static from(points, fx = pointX, fy = pointY, that) {
    return new _Delaunay("length" in points ? flatArray(points, fx, fy, that) : Float64Array.from(flatIterable(points, fx, fy, that)));
  }
  constructor(points) {
    this._delaunator = new Delaunator(points);
    this.inedges = new Int32Array(points.length / 2);
    this._hullIndex = new Int32Array(points.length / 2);
    this.points = this._delaunator.coords;
    this._init();
  }
  update() {
    this._delaunator.update();
    this._init();
    return this;
  }
  _init() {
    const d = this._delaunator, points = this.points;
    if (d.hull && d.hull.length > 2 && collinear(d)) {
      this.collinear = Int32Array.from({ length: points.length / 2 }, (_, i) => i).sort((i, j) => points[2 * i] - points[2 * j] || points[2 * i + 1] - points[2 * j + 1]);
      const e = this.collinear[0], f = this.collinear[this.collinear.length - 1], bounds = [points[2 * e], points[2 * e + 1], points[2 * f], points[2 * f + 1]], r = 1e-8 * Math.hypot(bounds[3] - bounds[1], bounds[2] - bounds[0]);
      for (let i = 0, n = points.length / 2; i < n; ++i) {
        const p = jitter(points[2 * i], points[2 * i + 1], r);
        points[2 * i] = p[0];
        points[2 * i + 1] = p[1];
      }
      this._delaunator = new Delaunator(points);
    } else {
      delete this.collinear;
    }
    const halfedges = this.halfedges = this._delaunator.halfedges;
    const hull = this.hull = this._delaunator.hull;
    const triangles = this.triangles = this._delaunator.triangles;
    const inedges = this.inedges.fill(-1);
    const hullIndex = this._hullIndex.fill(-1);
    for (let e = 0, n = halfedges.length; e < n; ++e) {
      const p = triangles[e % 3 === 2 ? e - 2 : e + 1];
      if (halfedges[e] === -1 || inedges[p] === -1) inedges[p] = e;
    }
    for (let i = 0, n = hull.length; i < n; ++i) {
      hullIndex[hull[i]] = i;
    }
    if (hull.length <= 2 && hull.length > 0) {
      this.triangles = new Int32Array(3).fill(-1);
      this.halfedges = new Int32Array(3).fill(-1);
      this.triangles[0] = hull[0];
      inedges[hull[0]] = 1;
      if (hull.length === 2) {
        inedges[hull[1]] = 0;
        this.triangles[1] = hull[1];
        this.triangles[2] = hull[1];
      }
    }
  }
  voronoi(bounds) {
    return new Voronoi(this, bounds);
  }
  *neighbors(i) {
    const { inedges, hull, _hullIndex, halfedges, triangles, collinear: collinear2 } = this;
    if (collinear2) {
      const l = collinear2.indexOf(i);
      if (l > 0) yield collinear2[l - 1];
      if (l < collinear2.length - 1) yield collinear2[l + 1];
      return;
    }
    const e0 = inedges[i];
    if (e0 === -1) return;
    let e = e0, p0 = -1;
    do {
      yield p0 = triangles[e];
      e = e % 3 === 2 ? e - 2 : e + 1;
      if (triangles[e] !== i) return;
      e = halfedges[e];
      if (e === -1) {
        const p = hull[(_hullIndex[i] + 1) % hull.length];
        if (p !== p0) yield p;
        return;
      }
    } while (e !== e0);
  }
  find(x, y, i = 0) {
    if ((x = +x, x !== x) || (y = +y, y !== y)) return -1;
    const i0 = i;
    let c;
    while ((c = this._step(i, x, y)) >= 0 && c !== i && c !== i0) i = c;
    return c;
  }
  _step(i, x, y) {
    const { inedges, hull, _hullIndex, halfedges, triangles, points } = this;
    if (inedges[i] === -1 || !points.length) return (i + 1) % (points.length >> 1);
    let c = i;
    let dc = pow(x - points[i * 2], 2) + pow(y - points[i * 2 + 1], 2);
    const e0 = inedges[i];
    let e = e0;
    do {
      let t = triangles[e];
      const dt = pow(x - points[t * 2], 2) + pow(y - points[t * 2 + 1], 2);
      if (dt < dc) dc = dt, c = t;
      e = e % 3 === 2 ? e - 2 : e + 1;
      if (triangles[e] !== i) break;
      e = halfedges[e];
      if (e === -1) {
        e = hull[(_hullIndex[i] + 1) % hull.length];
        if (e !== t) {
          if (pow(x - points[e * 2], 2) + pow(y - points[e * 2 + 1], 2) < dc) return e;
        }
        break;
      }
    } while (e !== e0);
    return c;
  }
  render(context) {
    const buffer = context == null ? context = new Path() : void 0;
    const { points, halfedges, triangles } = this;
    for (let i = 0, n = halfedges.length; i < n; ++i) {
      const j = halfedges[i];
      if (j < i) continue;
      const ti = triangles[i] * 2;
      const tj = triangles[j] * 2;
      context.moveTo(points[ti], points[ti + 1]);
      context.lineTo(points[tj], points[tj + 1]);
    }
    this.renderHull(context);
    return buffer && buffer.value();
  }
  renderPoints(context, r) {
    if (r === void 0 && (!context || typeof context.moveTo !== "function")) r = context, context = null;
    r = r == void 0 ? 2 : +r;
    const buffer = context == null ? context = new Path() : void 0;
    const { points } = this;
    for (let i = 0, n = points.length; i < n; i += 2) {
      const x = points[i], y = points[i + 1];
      context.moveTo(x + r, y);
      context.arc(x, y, r, 0, tau);
    }
    return buffer && buffer.value();
  }
  renderHull(context) {
    const buffer = context == null ? context = new Path() : void 0;
    const { hull, points } = this;
    const h = hull[0] * 2, n = hull.length;
    context.moveTo(points[h], points[h + 1]);
    for (let i = 1; i < n; ++i) {
      const h2 = 2 * hull[i];
      context.lineTo(points[h2], points[h2 + 1]);
    }
    context.closePath();
    return buffer && buffer.value();
  }
  hullPolygon() {
    const polygon = new Polygon();
    this.renderHull(polygon);
    return polygon.value();
  }
  renderTriangle(i, context) {
    const buffer = context == null ? context = new Path() : void 0;
    const { points, triangles } = this;
    const t0 = triangles[i *= 3] * 2;
    const t1 = triangles[i + 1] * 2;
    const t2 = triangles[i + 2] * 2;
    context.moveTo(points[t0], points[t0 + 1]);
    context.lineTo(points[t1], points[t1 + 1]);
    context.lineTo(points[t2], points[t2 + 1]);
    context.closePath();
    return buffer && buffer.value();
  }
  *trianglePolygons() {
    const { triangles } = this;
    for (let i = 0, n = triangles.length / 3; i < n; ++i) {
      yield this.trianglePolygon(i);
    }
  }
  trianglePolygon(i) {
    const polygon = new Polygon();
    this.renderTriangle(i, polygon);
    return polygon.value();
  }
};
function flatArray(points, fx, fy, that) {
  const n = points.length;
  const array = new Float64Array(n * 2);
  for (let i = 0; i < n; ++i) {
    const p = points[i];
    array[i * 2] = fx.call(that, p, i, points);
    array[i * 2 + 1] = fy.call(that, p, i, points);
  }
  return array;
}
function* flatIterable(points, fx, fy, that) {
  let i = 0;
  for (const p of points) {
    yield fx.call(that, p, i, points);
    yield fy.call(that, p, i, points);
    ++i;
  }
}

// node_modules/d3-array/src/extent.js
function extent(values, valueof) {
  let min2;
  let max2;
  if (valueof === void 0) {
    for (const value of values) {
      if (value != null) {
        if (min2 === void 0) {
          if (value >= value) min2 = max2 = value;
        } else {
          if (min2 > value) min2 = value;
          if (max2 < value) max2 = value;
        }
      }
    }
  } else {
    let index = -1;
    for (let value of values) {
      if ((value = valueof(value, ++index, values)) != null) {
        if (min2 === void 0) {
          if (value >= value) min2 = max2 = value;
        } else {
          if (min2 > value) min2 = value;
          if (max2 < value) max2 = value;
        }
      }
    }
  }
  return [min2, max2];
}

// node_modules/d3-array/src/fsum.js
var Adder = class {
  constructor() {
    this._partials = new Float64Array(32);
    this._n = 0;
  }
  add(x) {
    const p = this._partials;
    let i = 0;
    for (let j = 0; j < this._n && j < 32; j++) {
      const y = p[j], hi = x + y, lo = Math.abs(x) < Math.abs(y) ? x - (hi - y) : y - (hi - x);
      if (lo) p[i++] = lo;
      x = hi;
    }
    p[i] = x;
    this._n = i + 1;
    return this;
  }
  valueOf() {
    const p = this._partials;
    let n = this._n, x, y, lo, hi = 0;
    if (n > 0) {
      hi = p[--n];
      while (n > 0) {
        x = hi;
        y = p[--n];
        hi = x + y;
        lo = y - (hi - x);
        if (lo) break;
      }
      if (n > 0 && (lo < 0 && p[n - 1] < 0 || lo > 0 && p[n - 1] > 0)) {
        y = lo * 2;
        x = hi + y;
        if (y == x - hi) hi = x;
      }
    }
    return hi;
  }
};

// node_modules/d3-array/src/merge.js
function* flatten(arrays) {
  for (const array of arrays) {
    yield* array;
  }
}
function merge(arrays) {
  return Array.from(flatten(arrays));
}

// node_modules/d3-geo/src/math.js
var epsilon3 = 1e-6;
var epsilon22 = 1e-12;
var pi = Math.PI;
var halfPi = pi / 2;
var quarterPi = pi / 4;
var tau2 = pi * 2;
var degrees = 180 / pi;
var radians = pi / 180;
var abs = Math.abs;
var atan = Math.atan;
var atan2 = Math.atan2;
var cos = Math.cos;
var hypot = Math.hypot;
var sin = Math.sin;
var sign = Math.sign || function(x) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
};
var sqrt = Math.sqrt;
function acos(x) {
  return x > 1 ? 0 : x < -1 ? pi : Math.acos(x);
}
function asin(x) {
  return x > 1 ? halfPi : x < -1 ? -halfPi : Math.asin(x);
}

// node_modules/d3-geo/src/noop.js
function noop() {
}

// node_modules/d3-geo/src/stream.js
function streamGeometry(geometry, stream) {
  if (geometry && streamGeometryType.hasOwnProperty(geometry.type)) {
    streamGeometryType[geometry.type](geometry, stream);
  }
}
var streamObjectType = {
  Feature: function(object2, stream) {
    streamGeometry(object2.geometry, stream);
  },
  FeatureCollection: function(object2, stream) {
    var features = object2.features, i = -1, n = features.length;
    while (++i < n) streamGeometry(features[i].geometry, stream);
  }
};
var streamGeometryType = {
  Sphere: function(object2, stream) {
    stream.sphere();
  },
  Point: function(object2, stream) {
    object2 = object2.coordinates;
    stream.point(object2[0], object2[1], object2[2]);
  },
  MultiPoint: function(object2, stream) {
    var coordinates2 = object2.coordinates, i = -1, n = coordinates2.length;
    while (++i < n) object2 = coordinates2[i], stream.point(object2[0], object2[1], object2[2]);
  },
  LineString: function(object2, stream) {
    streamLine(object2.coordinates, stream, 0);
  },
  MultiLineString: function(object2, stream) {
    var coordinates2 = object2.coordinates, i = -1, n = coordinates2.length;
    while (++i < n) streamLine(coordinates2[i], stream, 0);
  },
  Polygon: function(object2, stream) {
    streamPolygon(object2.coordinates, stream);
  },
  MultiPolygon: function(object2, stream) {
    var coordinates2 = object2.coordinates, i = -1, n = coordinates2.length;
    while (++i < n) streamPolygon(coordinates2[i], stream);
  },
  GeometryCollection: function(object2, stream) {
    var geometries = object2.geometries, i = -1, n = geometries.length;
    while (++i < n) streamGeometry(geometries[i], stream);
  }
};
function streamLine(coordinates2, stream, closed) {
  var i = -1, n = coordinates2.length - closed, coordinate;
  stream.lineStart();
  while (++i < n) coordinate = coordinates2[i], stream.point(coordinate[0], coordinate[1], coordinate[2]);
  stream.lineEnd();
}
function streamPolygon(coordinates2, stream) {
  var i = -1, n = coordinates2.length;
  stream.polygonStart();
  while (++i < n) streamLine(coordinates2[i], stream, 1);
  stream.polygonEnd();
}
function stream_default(object2, stream) {
  if (object2 && streamObjectType.hasOwnProperty(object2.type)) {
    streamObjectType[object2.type](object2, stream);
  } else {
    streamGeometry(object2, stream);
  }
}

// node_modules/d3-geo/src/cartesian.js
function spherical(cartesian3) {
  return [atan2(cartesian3[1], cartesian3[0]), asin(cartesian3[2])];
}
function cartesian(spherical3) {
  var lambda = spherical3[0], phi = spherical3[1], cosPhi = cos(phi);
  return [cosPhi * cos(lambda), cosPhi * sin(lambda), sin(phi)];
}
function cartesianDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cartesianCross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function cartesianAddInPlace(a, b) {
  a[0] += b[0], a[1] += b[1], a[2] += b[2];
}
function cartesianScale(vector, k) {
  return [vector[0] * k, vector[1] * k, vector[2] * k];
}
function cartesianNormalizeInPlace(d) {
  var l = sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  d[0] /= l, d[1] /= l, d[2] /= l;
}

// node_modules/d3-geo/src/centroid.js
var W0;
var W1;
var X0;
var Y0;
var Z0;
var X1;
var Y1;
var Z1;
var X2;
var Y2;
var Z2;
var lambda00;
var phi00;
var x0;
var y0;
var z0;
var centroidStream = {
  sphere: noop,
  point: centroidPoint,
  lineStart: centroidLineStart,
  lineEnd: centroidLineEnd,
  polygonStart: function() {
    centroidStream.lineStart = centroidRingStart;
    centroidStream.lineEnd = centroidRingEnd;
  },
  polygonEnd: function() {
    centroidStream.lineStart = centroidLineStart;
    centroidStream.lineEnd = centroidLineEnd;
  }
};
function centroidPoint(lambda, phi) {
  lambda *= radians, phi *= radians;
  var cosPhi = cos(phi);
  centroidPointCartesian(cosPhi * cos(lambda), cosPhi * sin(lambda), sin(phi));
}
function centroidPointCartesian(x, y, z) {
  ++W0;
  X0 += (x - X0) / W0;
  Y0 += (y - Y0) / W0;
  Z0 += (z - Z0) / W0;
}
function centroidLineStart() {
  centroidStream.point = centroidLinePointFirst;
}
function centroidLinePointFirst(lambda, phi) {
  lambda *= radians, phi *= radians;
  var cosPhi = cos(phi);
  x0 = cosPhi * cos(lambda);
  y0 = cosPhi * sin(lambda);
  z0 = sin(phi);
  centroidStream.point = centroidLinePoint;
  centroidPointCartesian(x0, y0, z0);
}
function centroidLinePoint(lambda, phi) {
  lambda *= radians, phi *= radians;
  var cosPhi = cos(phi), x = cosPhi * cos(lambda), y = cosPhi * sin(lambda), z = sin(phi), w = atan2(sqrt((w = y0 * z - z0 * y) * w + (w = z0 * x - x0 * z) * w + (w = x0 * y - y0 * x) * w), x0 * x + y0 * y + z0 * z);
  W1 += w;
  X1 += w * (x0 + (x0 = x));
  Y1 += w * (y0 + (y0 = y));
  Z1 += w * (z0 + (z0 = z));
  centroidPointCartesian(x0, y0, z0);
}
function centroidLineEnd() {
  centroidStream.point = centroidPoint;
}
function centroidRingStart() {
  centroidStream.point = centroidRingPointFirst;
}
function centroidRingEnd() {
  centroidRingPoint(lambda00, phi00);
  centroidStream.point = centroidPoint;
}
function centroidRingPointFirst(lambda, phi) {
  lambda00 = lambda, phi00 = phi;
  lambda *= radians, phi *= radians;
  centroidStream.point = centroidRingPoint;
  var cosPhi = cos(phi);
  x0 = cosPhi * cos(lambda);
  y0 = cosPhi * sin(lambda);
  z0 = sin(phi);
  centroidPointCartesian(x0, y0, z0);
}
function centroidRingPoint(lambda, phi) {
  lambda *= radians, phi *= radians;
  var cosPhi = cos(phi), x = cosPhi * cos(lambda), y = cosPhi * sin(lambda), z = sin(phi), cx = y0 * z - z0 * y, cy = z0 * x - x0 * z, cz = x0 * y - y0 * x, m = hypot(cx, cy, cz), w = asin(m), v2 = m && -w / m;
  X2.add(v2 * cx);
  Y2.add(v2 * cy);
  Z2.add(v2 * cz);
  W1 += w;
  X1 += w * (x0 + (x0 = x));
  Y1 += w * (y0 + (y0 = y));
  Z1 += w * (z0 + (z0 = z));
  centroidPointCartesian(x0, y0, z0);
}
function centroid_default(object2) {
  W0 = W1 = X0 = Y0 = Z0 = X1 = Y1 = Z1 = 0;
  X2 = new Adder();
  Y2 = new Adder();
  Z2 = new Adder();
  stream_default(object2, centroidStream);
  var x = +X2, y = +Y2, z = +Z2, m = hypot(x, y, z);
  if (m < epsilon22) {
    x = X1, y = Y1, z = Z1;
    if (W1 < epsilon3) x = X0, y = Y0, z = Z0;
    m = hypot(x, y, z);
    if (m < epsilon22) return [NaN, NaN];
  }
  return [atan2(y, x) * degrees, asin(z / m) * degrees];
}

// node_modules/d3-geo/src/compose.js
function compose_default(a, b) {
  function compose(x, y) {
    return x = a(x, y), b(x[0], x[1]);
  }
  if (a.invert && b.invert) compose.invert = function(x, y) {
    return x = b.invert(x, y), x && a.invert(x[0], x[1]);
  };
  return compose;
}

// node_modules/d3-geo/src/rotation.js
function rotationIdentity(lambda, phi) {
  if (abs(lambda) > pi) lambda -= Math.round(lambda / tau2) * tau2;
  return [lambda, phi];
}
rotationIdentity.invert = rotationIdentity;
function rotateRadians(deltaLambda, deltaPhi, deltaGamma) {
  return (deltaLambda %= tau2) ? deltaPhi || deltaGamma ? compose_default(rotationLambda(deltaLambda), rotationPhiGamma(deltaPhi, deltaGamma)) : rotationLambda(deltaLambda) : deltaPhi || deltaGamma ? rotationPhiGamma(deltaPhi, deltaGamma) : rotationIdentity;
}
function forwardRotationLambda(deltaLambda) {
  return function(lambda, phi) {
    lambda += deltaLambda;
    if (abs(lambda) > pi) lambda -= Math.round(lambda / tau2) * tau2;
    return [lambda, phi];
  };
}
function rotationLambda(deltaLambda) {
  var rotation = forwardRotationLambda(deltaLambda);
  rotation.invert = forwardRotationLambda(-deltaLambda);
  return rotation;
}
function rotationPhiGamma(deltaPhi, deltaGamma) {
  var cosDeltaPhi = cos(deltaPhi), sinDeltaPhi = sin(deltaPhi), cosDeltaGamma = cos(deltaGamma), sinDeltaGamma = sin(deltaGamma);
  function rotation(lambda, phi) {
    var cosPhi = cos(phi), x = cos(lambda) * cosPhi, y = sin(lambda) * cosPhi, z = sin(phi), k = z * cosDeltaPhi + x * sinDeltaPhi;
    return [
      atan2(y * cosDeltaGamma - k * sinDeltaGamma, x * cosDeltaPhi - z * sinDeltaPhi),
      asin(k * cosDeltaGamma + y * sinDeltaGamma)
    ];
  }
  rotation.invert = function(lambda, phi) {
    var cosPhi = cos(phi), x = cos(lambda) * cosPhi, y = sin(lambda) * cosPhi, z = sin(phi), k = z * cosDeltaGamma - y * sinDeltaGamma;
    return [
      atan2(y * cosDeltaGamma + z * sinDeltaGamma, x * cosDeltaPhi + k * sinDeltaPhi),
      asin(k * cosDeltaPhi - x * sinDeltaPhi)
    ];
  };
  return rotation;
}
function rotation_default(rotate) {
  rotate = rotateRadians(rotate[0] * radians, rotate[1] * radians, rotate.length > 2 ? rotate[2] * radians : 0);
  function forward(coordinates2) {
    coordinates2 = rotate(coordinates2[0] * radians, coordinates2[1] * radians);
    return coordinates2[0] *= degrees, coordinates2[1] *= degrees, coordinates2;
  }
  forward.invert = function(coordinates2) {
    coordinates2 = rotate.invert(coordinates2[0] * radians, coordinates2[1] * radians);
    return coordinates2[0] *= degrees, coordinates2[1] *= degrees, coordinates2;
  };
  return forward;
}

// node_modules/d3-geo/src/circle.js
function circleStream(stream, radius, delta, direction, t0, t1) {
  if (!delta) return;
  var cosRadius = cos(radius), sinRadius = sin(radius), step = direction * delta;
  if (t0 == null) {
    t0 = radius + direction * tau2;
    t1 = radius - step / 2;
  } else {
    t0 = circleRadius(cosRadius, t0);
    t1 = circleRadius(cosRadius, t1);
    if (direction > 0 ? t0 < t1 : t0 > t1) t0 += direction * tau2;
  }
  for (var point, t = t0; direction > 0 ? t > t1 : t < t1; t -= step) {
    point = spherical([cosRadius, -sinRadius * cos(t), -sinRadius * sin(t)]);
    stream.point(point[0], point[1]);
  }
}
function circleRadius(cosRadius, point) {
  point = cartesian(point), point[0] -= cosRadius;
  cartesianNormalizeInPlace(point);
  var radius = acos(-point[1]);
  return ((-point[2] < 0 ? -radius : radius) + tau2 - epsilon3) % tau2;
}

// node_modules/d3-geo/src/clip/buffer.js
function buffer_default() {
  var lines = [], line;
  return {
    point: function(x, y, m) {
      line.push([x, y, m]);
    },
    lineStart: function() {
      lines.push(line = []);
    },
    lineEnd: noop,
    rejoin: function() {
      if (lines.length > 1) lines.push(lines.pop().concat(lines.shift()));
    },
    result: function() {
      var result = lines;
      lines = [];
      line = null;
      return result;
    }
  };
}

// node_modules/d3-geo/src/pointEqual.js
function pointEqual_default(a, b) {
  return abs(a[0] - b[0]) < epsilon3 && abs(a[1] - b[1]) < epsilon3;
}

// node_modules/d3-geo/src/clip/rejoin.js
function Intersection(point, points, other, entry) {
  this.x = point;
  this.z = points;
  this.o = other;
  this.e = entry;
  this.v = false;
  this.n = this.p = null;
}
function rejoin_default(segments, compareIntersection2, startInside, interpolate, stream) {
  var subject = [], clip = [], i, n;
  segments.forEach(function(segment) {
    if ((n2 = segment.length - 1) <= 0) return;
    var n2, p0 = segment[0], p1 = segment[n2], x;
    if (pointEqual_default(p0, p1)) {
      if (!p0[2] && !p1[2]) {
        stream.lineStart();
        for (i = 0; i < n2; ++i) stream.point((p0 = segment[i])[0], p0[1]);
        stream.lineEnd();
        return;
      }
      p1[0] += 2 * epsilon3;
    }
    subject.push(x = new Intersection(p0, segment, null, true));
    clip.push(x.o = new Intersection(p0, null, x, false));
    subject.push(x = new Intersection(p1, segment, null, false));
    clip.push(x.o = new Intersection(p1, null, x, true));
  });
  if (!subject.length) return;
  clip.sort(compareIntersection2);
  link(subject);
  link(clip);
  for (i = 0, n = clip.length; i < n; ++i) {
    clip[i].e = startInside = !startInside;
  }
  var start = subject[0], points, point;
  while (1) {
    var current = start, isSubject = true;
    while (current.v) if ((current = current.n) === start) return;
    points = current.z;
    stream.lineStart();
    do {
      current.v = current.o.v = true;
      if (current.e) {
        if (isSubject) {
          for (i = 0, n = points.length; i < n; ++i) stream.point((point = points[i])[0], point[1]);
        } else {
          interpolate(current.x, current.n.x, 1, stream);
        }
        current = current.n;
      } else {
        if (isSubject) {
          points = current.p.z;
          for (i = points.length - 1; i >= 0; --i) stream.point((point = points[i])[0], point[1]);
        } else {
          interpolate(current.x, current.p.x, -1, stream);
        }
        current = current.p;
      }
      current = current.o;
      points = current.z;
      isSubject = !isSubject;
    } while (!current.v);
    stream.lineEnd();
  }
}
function link(array) {
  if (!(n = array.length)) return;
  var n, i = 0, a = array[0], b;
  while (++i < n) {
    a.n = b = array[i];
    b.p = a;
    a = b;
  }
  a.n = b = array[0];
  b.p = a;
}

// node_modules/d3-geo/src/polygonContains.js
function longitude(point) {
  return abs(point[0]) <= pi ? point[0] : sign(point[0]) * ((abs(point[0]) + pi) % tau2 - pi);
}
function polygonContains_default(polygon, point) {
  var lambda = longitude(point), phi = point[1], sinPhi = sin(phi), normal = [sin(lambda), -cos(lambda), 0], angle = 0, winding = 0;
  var sum2 = new Adder();
  if (sinPhi === 1) phi = halfPi + epsilon3;
  else if (sinPhi === -1) phi = -halfPi - epsilon3;
  for (var i = 0, n = polygon.length; i < n; ++i) {
    if (!(m = (ring = polygon[i]).length)) continue;
    var ring, m, point0 = ring[m - 1], lambda02 = longitude(point0), phi0 = point0[1] / 2 + quarterPi, sinPhi02 = sin(phi0), cosPhi02 = cos(phi0);
    for (var j = 0; j < m; ++j, lambda02 = lambda1, sinPhi02 = sinPhi1, cosPhi02 = cosPhi1, point0 = point1) {
      var point1 = ring[j], lambda1 = longitude(point1), phi1 = point1[1] / 2 + quarterPi, sinPhi1 = sin(phi1), cosPhi1 = cos(phi1), delta = lambda1 - lambda02, sign3 = delta >= 0 ? 1 : -1, absDelta = sign3 * delta, antimeridian = absDelta > pi, k = sinPhi02 * sinPhi1;
      sum2.add(atan2(k * sign3 * sin(absDelta), cosPhi02 * cosPhi1 + k * cos(absDelta)));
      angle += antimeridian ? delta + sign3 * tau2 : delta;
      if (antimeridian ^ lambda02 >= lambda ^ lambda1 >= lambda) {
        var arc = cartesianCross(cartesian(point0), cartesian(point1));
        cartesianNormalizeInPlace(arc);
        var intersection = cartesianCross(normal, arc);
        cartesianNormalizeInPlace(intersection);
        var phiArc = (antimeridian ^ delta >= 0 ? -1 : 1) * asin(intersection[2]);
        if (phi > phiArc || phi === phiArc && (arc[0] || arc[1])) {
          winding += antimeridian ^ delta >= 0 ? 1 : -1;
        }
      }
    }
  }
  return (angle < -epsilon3 || angle < epsilon3 && sum2 < -epsilon22) ^ winding & 1;
}

// node_modules/d3-geo/src/clip/index.js
function clip_default(pointVisible, clipLine, interpolate, start) {
  return function(sink) {
    var line = clipLine(sink), ringBuffer = buffer_default(), ringSink = clipLine(ringBuffer), polygonStarted = false, polygon, segments, ring;
    var clip = {
      point,
      lineStart,
      lineEnd,
      polygonStart: function() {
        clip.point = pointRing;
        clip.lineStart = ringStart;
        clip.lineEnd = ringEnd;
        segments = [];
        polygon = [];
      },
      polygonEnd: function() {
        clip.point = point;
        clip.lineStart = lineStart;
        clip.lineEnd = lineEnd;
        segments = merge(segments);
        var startInside = polygonContains_default(polygon, start);
        if (segments.length) {
          if (!polygonStarted) sink.polygonStart(), polygonStarted = true;
          rejoin_default(segments, compareIntersection, startInside, interpolate, sink);
        } else if (startInside) {
          if (!polygonStarted) sink.polygonStart(), polygonStarted = true;
          sink.lineStart();
          interpolate(null, null, 1, sink);
          sink.lineEnd();
        }
        if (polygonStarted) sink.polygonEnd(), polygonStarted = false;
        segments = polygon = null;
      },
      sphere: function() {
        sink.polygonStart();
        sink.lineStart();
        interpolate(null, null, 1, sink);
        sink.lineEnd();
        sink.polygonEnd();
      }
    };
    function point(lambda, phi) {
      if (pointVisible(lambda, phi)) sink.point(lambda, phi);
    }
    function pointLine(lambda, phi) {
      line.point(lambda, phi);
    }
    function lineStart() {
      clip.point = pointLine;
      line.lineStart();
    }
    function lineEnd() {
      clip.point = point;
      line.lineEnd();
    }
    function pointRing(lambda, phi) {
      ring.push([lambda, phi]);
      ringSink.point(lambda, phi);
    }
    function ringStart() {
      ringSink.lineStart();
      ring = [];
    }
    function ringEnd() {
      pointRing(ring[0][0], ring[0][1]);
      ringSink.lineEnd();
      var clean = ringSink.clean(), ringSegments = ringBuffer.result(), i, n = ringSegments.length, m, segment, point2;
      ring.pop();
      polygon.push(ring);
      ring = null;
      if (!n) return;
      if (clean & 1) {
        segment = ringSegments[0];
        if ((m = segment.length - 1) > 0) {
          if (!polygonStarted) sink.polygonStart(), polygonStarted = true;
          sink.lineStart();
          for (i = 0; i < m; ++i) sink.point((point2 = segment[i])[0], point2[1]);
          sink.lineEnd();
        }
        return;
      }
      if (n > 1 && clean & 2) ringSegments.push(ringSegments.pop().concat(ringSegments.shift()));
      segments.push(ringSegments.filter(validSegment));
    }
    return clip;
  };
}
function validSegment(segment) {
  return segment.length > 1;
}
function compareIntersection(a, b) {
  return ((a = a.x)[0] < 0 ? a[1] - halfPi - epsilon3 : halfPi - a[1]) - ((b = b.x)[0] < 0 ? b[1] - halfPi - epsilon3 : halfPi - b[1]);
}

// node_modules/d3-geo/src/clip/antimeridian.js
var antimeridian_default = clip_default(
  function() {
    return true;
  },
  clipAntimeridianLine,
  clipAntimeridianInterpolate,
  [-pi, -halfPi]
);
function clipAntimeridianLine(stream) {
  var lambda02 = NaN, phi0 = NaN, sign0 = NaN, clean;
  return {
    lineStart: function() {
      stream.lineStart();
      clean = 1;
    },
    point: function(lambda1, phi1) {
      var sign1 = lambda1 > 0 ? pi : -pi, delta = abs(lambda1 - lambda02);
      if (abs(delta - pi) < epsilon3) {
        stream.point(lambda02, phi0 = (phi0 + phi1) / 2 > 0 ? halfPi : -halfPi);
        stream.point(sign0, phi0);
        stream.lineEnd();
        stream.lineStart();
        stream.point(sign1, phi0);
        stream.point(lambda1, phi0);
        clean = 0;
      } else if (sign0 !== sign1 && delta >= pi) {
        if (abs(lambda02 - sign0) < epsilon3) lambda02 -= sign0 * epsilon3;
        if (abs(lambda1 - sign1) < epsilon3) lambda1 -= sign1 * epsilon3;
        phi0 = clipAntimeridianIntersect(lambda02, phi0, lambda1, phi1);
        stream.point(sign0, phi0);
        stream.lineEnd();
        stream.lineStart();
        stream.point(sign1, phi0);
        clean = 0;
      }
      stream.point(lambda02 = lambda1, phi0 = phi1);
      sign0 = sign1;
    },
    lineEnd: function() {
      stream.lineEnd();
      lambda02 = phi0 = NaN;
    },
    clean: function() {
      return 2 - clean;
    }
  };
}
function clipAntimeridianIntersect(lambda02, phi0, lambda1, phi1) {
  var cosPhi02, cosPhi1, sinLambda0Lambda1 = sin(lambda02 - lambda1);
  return abs(sinLambda0Lambda1) > epsilon3 ? atan((sin(phi0) * (cosPhi1 = cos(phi1)) * sin(lambda1) - sin(phi1) * (cosPhi02 = cos(phi0)) * sin(lambda02)) / (cosPhi02 * cosPhi1 * sinLambda0Lambda1)) : (phi0 + phi1) / 2;
}
function clipAntimeridianInterpolate(from, to, direction, stream) {
  var phi;
  if (from == null) {
    phi = direction * halfPi;
    stream.point(-pi, phi);
    stream.point(0, phi);
    stream.point(pi, phi);
    stream.point(pi, 0);
    stream.point(pi, -phi);
    stream.point(0, -phi);
    stream.point(-pi, -phi);
    stream.point(-pi, 0);
    stream.point(-pi, phi);
  } else if (abs(from[0] - to[0]) > epsilon3) {
    var lambda = from[0] < to[0] ? pi : -pi;
    phi = direction * lambda / 2;
    stream.point(-lambda, phi);
    stream.point(0, phi);
    stream.point(lambda, phi);
  } else {
    stream.point(to[0], to[1]);
  }
}

// node_modules/d3-geo/src/clip/circle.js
function circle_default(radius) {
  var cr = cos(radius), delta = 2 * radians, smallRadius = cr > 0, notHemisphere = abs(cr) > epsilon3;
  function interpolate(from, to, direction, stream) {
    circleStream(stream, radius, delta, direction, from, to);
  }
  function visible(lambda, phi) {
    return cos(lambda) * cos(phi) > cr;
  }
  function clipLine(stream) {
    var point0, c0, v0, v00, clean;
    return {
      lineStart: function() {
        v00 = v0 = false;
        clean = 1;
      },
      point: function(lambda, phi) {
        var point1 = [lambda, phi], point2, v2 = visible(lambda, phi), c = smallRadius ? v2 ? 0 : code(lambda, phi) : v2 ? code(lambda + (lambda < 0 ? pi : -pi), phi) : 0;
        if (!point0 && (v00 = v0 = v2)) stream.lineStart();
        if (v2 !== v0) {
          point2 = intersect(point0, point1);
          if (!point2 || pointEqual_default(point0, point2) || pointEqual_default(point1, point2))
            point1[2] = 1;
        }
        if (v2 !== v0) {
          clean = 0;
          if (v2) {
            stream.lineStart();
            point2 = intersect(point1, point0);
            stream.point(point2[0], point2[1]);
          } else {
            point2 = intersect(point0, point1);
            stream.point(point2[0], point2[1], 2);
            stream.lineEnd();
          }
          point0 = point2;
        } else if (notHemisphere && point0 && smallRadius ^ v2) {
          var t;
          if (!(c & c0) && (t = intersect(point1, point0, true))) {
            clean = 0;
            if (smallRadius) {
              stream.lineStart();
              stream.point(t[0][0], t[0][1]);
              stream.point(t[1][0], t[1][1]);
              stream.lineEnd();
            } else {
              stream.point(t[1][0], t[1][1]);
              stream.lineEnd();
              stream.lineStart();
              stream.point(t[0][0], t[0][1], 3);
            }
          }
        }
        if (v2 && (!point0 || !pointEqual_default(point0, point1))) {
          stream.point(point1[0], point1[1]);
        }
        point0 = point1, v0 = v2, c0 = c;
      },
      lineEnd: function() {
        if (v0) stream.lineEnd();
        point0 = null;
      },
      // Rejoin first and last segments if there were intersections and the first
      // and last points were visible.
      clean: function() {
        return clean | (v00 && v0) << 1;
      }
    };
  }
  function intersect(a, b, two) {
    var pa = cartesian(a), pb = cartesian(b);
    var n1 = [1, 0, 0], n2 = cartesianCross(pa, pb), n2n2 = cartesianDot(n2, n2), n1n2 = n2[0], determinant = n2n2 - n1n2 * n1n2;
    if (!determinant) return !two && a;
    var c1 = cr * n2n2 / determinant, c2 = -cr * n1n2 / determinant, n1xn2 = cartesianCross(n1, n2), A = cartesianScale(n1, c1), B2 = cartesianScale(n2, c2);
    cartesianAddInPlace(A, B2);
    var u4 = n1xn2, w = cartesianDot(A, u4), uu = cartesianDot(u4, u4), t2 = w * w - uu * (cartesianDot(A, A) - 1);
    if (t2 < 0) return;
    var t = sqrt(t2), q = cartesianScale(u4, (-w - t) / uu);
    cartesianAddInPlace(q, A);
    q = spherical(q);
    if (!two) return q;
    var lambda02 = a[0], lambda1 = b[0], phi0 = a[1], phi1 = b[1], z;
    if (lambda1 < lambda02) z = lambda02, lambda02 = lambda1, lambda1 = z;
    var delta2 = lambda1 - lambda02, polar = abs(delta2 - pi) < epsilon3, meridian = polar || delta2 < epsilon3;
    if (!polar && phi1 < phi0) z = phi0, phi0 = phi1, phi1 = z;
    if (meridian ? polar ? phi0 + phi1 > 0 ^ q[1] < (abs(q[0] - lambda02) < epsilon3 ? phi0 : phi1) : phi0 <= q[1] && q[1] <= phi1 : delta2 > pi ^ (lambda02 <= q[0] && q[0] <= lambda1)) {
      var q1 = cartesianScale(u4, (-w + t) / uu);
      cartesianAddInPlace(q1, A);
      return [q, spherical(q1)];
    }
  }
  function code(lambda, phi) {
    var r = smallRadius ? radius : pi - radius, code2 = 0;
    if (lambda < -r) code2 |= 1;
    else if (lambda > r) code2 |= 2;
    if (phi < -r) code2 |= 4;
    else if (phi > r) code2 |= 8;
    return code2;
  }
  return clip_default(visible, clipLine, interpolate, smallRadius ? [0, -radius] : [-pi, radius - pi]);
}

// node_modules/d3-geo/src/clip/line.js
function line_default(a, b, x03, y03, x12, y12) {
  var ax = a[0], ay = a[1], bx = b[0], by = b[1], t0 = 0, t1 = 1, dx = bx - ax, dy = by - ay, r;
  r = x03 - ax;
  if (!dx && r > 0) return;
  r /= dx;
  if (dx < 0) {
    if (r < t0) return;
    if (r < t1) t1 = r;
  } else if (dx > 0) {
    if (r > t1) return;
    if (r > t0) t0 = r;
  }
  r = x12 - ax;
  if (!dx && r < 0) return;
  r /= dx;
  if (dx < 0) {
    if (r > t1) return;
    if (r > t0) t0 = r;
  } else if (dx > 0) {
    if (r < t0) return;
    if (r < t1) t1 = r;
  }
  r = y03 - ay;
  if (!dy && r > 0) return;
  r /= dy;
  if (dy < 0) {
    if (r < t0) return;
    if (r < t1) t1 = r;
  } else if (dy > 0) {
    if (r > t1) return;
    if (r > t0) t0 = r;
  }
  r = y12 - ay;
  if (!dy && r < 0) return;
  r /= dy;
  if (dy < 0) {
    if (r > t1) return;
    if (r > t0) t0 = r;
  } else if (dy > 0) {
    if (r < t0) return;
    if (r < t1) t1 = r;
  }
  if (t0 > 0) a[0] = ax + t0 * dx, a[1] = ay + t0 * dy;
  if (t1 < 1) b[0] = ax + t1 * dx, b[1] = ay + t1 * dy;
  return true;
}

// node_modules/d3-geo/src/clip/rectangle.js
var clipMax = 1e9;
var clipMin = -clipMax;
function clipRectangle(x03, y03, x12, y12) {
  function visible(x, y) {
    return x03 <= x && x <= x12 && y03 <= y && y <= y12;
  }
  function interpolate(from, to, direction, stream) {
    var a = 0, a1 = 0;
    if (from == null || (a = corner(from, direction)) !== (a1 = corner(to, direction)) || comparePoint(from, to) < 0 ^ direction > 0) {
      do
        stream.point(a === 0 || a === 3 ? x03 : x12, a > 1 ? y12 : y03);
      while ((a = (a + direction + 4) % 4) !== a1);
    } else {
      stream.point(to[0], to[1]);
    }
  }
  function corner(p, direction) {
    return abs(p[0] - x03) < epsilon3 ? direction > 0 ? 0 : 3 : abs(p[0] - x12) < epsilon3 ? direction > 0 ? 2 : 1 : abs(p[1] - y03) < epsilon3 ? direction > 0 ? 1 : 0 : direction > 0 ? 3 : 2;
  }
  function compareIntersection2(a, b) {
    return comparePoint(a.x, b.x);
  }
  function comparePoint(a, b) {
    var ca3 = corner(a, 1), cb = corner(b, 1);
    return ca3 !== cb ? ca3 - cb : ca3 === 0 ? b[1] - a[1] : ca3 === 1 ? a[0] - b[0] : ca3 === 2 ? a[1] - b[1] : b[0] - a[0];
  }
  return function(stream) {
    var activeStream = stream, bufferStream = buffer_default(), segments, polygon, ring, x__, y__, v__, x_, y_, v_, first, clean;
    var clipStream = {
      point,
      lineStart,
      lineEnd,
      polygonStart,
      polygonEnd
    };
    function point(x, y) {
      if (visible(x, y)) activeStream.point(x, y);
    }
    function polygonInside() {
      var winding = 0;
      for (var i = 0, n = polygon.length; i < n; ++i) {
        for (var ring2 = polygon[i], j = 1, m = ring2.length, point2 = ring2[0], a0, a1, b0 = point2[0], b1 = point2[1]; j < m; ++j) {
          a0 = b0, a1 = b1, point2 = ring2[j], b0 = point2[0], b1 = point2[1];
          if (a1 <= y12) {
            if (b1 > y12 && (b0 - a0) * (y12 - a1) > (b1 - a1) * (x03 - a0)) ++winding;
          } else {
            if (b1 <= y12 && (b0 - a0) * (y12 - a1) < (b1 - a1) * (x03 - a0)) --winding;
          }
        }
      }
      return winding;
    }
    function polygonStart() {
      activeStream = bufferStream, segments = [], polygon = [], clean = true;
    }
    function polygonEnd() {
      var startInside = polygonInside(), cleanInside = clean && startInside, visible2 = (segments = merge(segments)).length;
      if (cleanInside || visible2) {
        stream.polygonStart();
        if (cleanInside) {
          stream.lineStart();
          interpolate(null, null, 1, stream);
          stream.lineEnd();
        }
        if (visible2) {
          rejoin_default(segments, compareIntersection2, startInside, interpolate, stream);
        }
        stream.polygonEnd();
      }
      activeStream = stream, segments = polygon = ring = null;
    }
    function lineStart() {
      clipStream.point = linePoint;
      if (polygon) polygon.push(ring = []);
      first = true;
      v_ = false;
      x_ = y_ = NaN;
    }
    function lineEnd() {
      if (segments) {
        linePoint(x__, y__);
        if (v__ && v_) bufferStream.rejoin();
        segments.push(bufferStream.result());
      }
      clipStream.point = point;
      if (v_) activeStream.lineEnd();
    }
    function linePoint(x, y) {
      var v2 = visible(x, y);
      if (polygon) ring.push([x, y]);
      if (first) {
        x__ = x, y__ = y, v__ = v2;
        first = false;
        if (v2) {
          activeStream.lineStart();
          activeStream.point(x, y);
        }
      } else {
        if (v2 && v_) activeStream.point(x, y);
        else {
          var a = [x_ = Math.max(clipMin, Math.min(clipMax, x_)), y_ = Math.max(clipMin, Math.min(clipMax, y_))], b = [x = Math.max(clipMin, Math.min(clipMax, x)), y = Math.max(clipMin, Math.min(clipMax, y))];
          if (line_default(a, b, x03, y03, x12, y12)) {
            if (!v_) {
              activeStream.lineStart();
              activeStream.point(a[0], a[1]);
            }
            activeStream.point(b[0], b[1]);
            if (!v2) activeStream.lineEnd();
            clean = false;
          } else if (v2) {
            activeStream.lineStart();
            activeStream.point(x, y);
            clean = false;
          }
        }
      }
      x_ = x, y_ = y, v_ = v2;
    }
    return clipStream;
  };
}

// node_modules/d3-geo/src/length.js
var lengthSum;
var lambda0;
var sinPhi0;
var cosPhi0;
var lengthStream = {
  sphere: noop,
  point: noop,
  lineStart: lengthLineStart,
  lineEnd: noop,
  polygonStart: noop,
  polygonEnd: noop
};
function lengthLineStart() {
  lengthStream.point = lengthPointFirst;
  lengthStream.lineEnd = lengthLineEnd;
}
function lengthLineEnd() {
  lengthStream.point = lengthStream.lineEnd = noop;
}
function lengthPointFirst(lambda, phi) {
  lambda *= radians, phi *= radians;
  lambda0 = lambda, sinPhi0 = sin(phi), cosPhi0 = cos(phi);
  lengthStream.point = lengthPoint;
}
function lengthPoint(lambda, phi) {
  lambda *= radians, phi *= radians;
  var sinPhi = sin(phi), cosPhi = cos(phi), delta = abs(lambda - lambda0), cosDelta = cos(delta), sinDelta = sin(delta), x = cosPhi * sinDelta, y = cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosDelta, z = sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDelta;
  lengthSum.add(atan2(sqrt(x * x + y * y), z));
  lambda0 = lambda, sinPhi0 = sinPhi, cosPhi0 = cosPhi;
}
function length_default(object2) {
  lengthSum = new Adder();
  stream_default(object2, lengthStream);
  return +lengthSum;
}

// node_modules/d3-geo/src/distance.js
var coordinates = [null, null];
var object = { type: "LineString", coordinates };
function distance_default(a, b) {
  coordinates[0] = a;
  coordinates[1] = b;
  return length_default(object);
}

// node_modules/d3-geo/src/identity.js
var identity_default = (x) => x;

// node_modules/d3-geo/src/path/bounds.js
var x02 = Infinity;
var y02 = x02;
var x1 = -x02;
var y1 = x1;
var boundsStream = {
  point: boundsPoint,
  lineStart: noop,
  lineEnd: noop,
  polygonStart: noop,
  polygonEnd: noop,
  result: function() {
    var bounds = [[x02, y02], [x1, y1]];
    x1 = y1 = -(y02 = x02 = Infinity);
    return bounds;
  }
};
function boundsPoint(x, y) {
  if (x < x02) x02 = x;
  if (x > x1) x1 = x;
  if (y < y02) y02 = y;
  if (y > y1) y1 = y;
}
var bounds_default = boundsStream;

// node_modules/d3-geo/src/transform.js
function transformer(methods) {
  return function(stream) {
    var s = new TransformStream();
    for (var key in methods) s[key] = methods[key];
    s.stream = stream;
    return s;
  };
}
function TransformStream() {
}
TransformStream.prototype = {
  constructor: TransformStream,
  point: function(x, y) {
    this.stream.point(x, y);
  },
  sphere: function() {
    this.stream.sphere();
  },
  lineStart: function() {
    this.stream.lineStart();
  },
  lineEnd: function() {
    this.stream.lineEnd();
  },
  polygonStart: function() {
    this.stream.polygonStart();
  },
  polygonEnd: function() {
    this.stream.polygonEnd();
  }
};

// node_modules/d3-geo/src/projection/fit.js
function fit(projection2, fitBounds, object2) {
  var clip = projection2.clipExtent && projection2.clipExtent();
  projection2.scale(150).translate([0, 0]);
  if (clip != null) projection2.clipExtent(null);
  stream_default(object2, projection2.stream(bounds_default));
  fitBounds(bounds_default.result());
  if (clip != null) projection2.clipExtent(clip);
  return projection2;
}
function fitExtent(projection2, extent2, object2) {
  return fit(projection2, function(b) {
    var w = extent2[1][0] - extent2[0][0], h = extent2[1][1] - extent2[0][1], k = Math.min(w / (b[1][0] - b[0][0]), h / (b[1][1] - b[0][1])), x = +extent2[0][0] + (w - k * (b[1][0] + b[0][0])) / 2, y = +extent2[0][1] + (h - k * (b[1][1] + b[0][1])) / 2;
    projection2.scale(150 * k).translate([x, y]);
  }, object2);
}
function fitSize(projection2, size, object2) {
  return fitExtent(projection2, [[0, 0], size], object2);
}
function fitWidth(projection2, width, object2) {
  return fit(projection2, function(b) {
    var w = +width, k = w / (b[1][0] - b[0][0]), x = (w - k * (b[1][0] + b[0][0])) / 2, y = -k * b[0][1];
    projection2.scale(150 * k).translate([x, y]);
  }, object2);
}
function fitHeight(projection2, height, object2) {
  return fit(projection2, function(b) {
    var h = +height, k = h / (b[1][1] - b[0][1]), x = -k * b[0][0], y = (h - k * (b[1][1] + b[0][1])) / 2;
    projection2.scale(150 * k).translate([x, y]);
  }, object2);
}

// node_modules/d3-geo/src/projection/resample.js
var maxDepth = 16;
var cosMinDistance = cos(30 * radians);
function resample_default(project, delta2) {
  return +delta2 ? resample(project, delta2) : resampleNone(project);
}
function resampleNone(project) {
  return transformer({
    point: function(x, y) {
      x = project(x, y);
      this.stream.point(x[0], x[1]);
    }
  });
}
function resample(project, delta2) {
  function resampleLineTo(x03, y03, lambda02, a0, b0, c0, x12, y12, lambda1, a1, b1, c1, depth, stream) {
    var dx = x12 - x03, dy = y12 - y03, d2 = dx * dx + dy * dy;
    if (d2 > 4 * delta2 && depth--) {
      var a = a0 + a1, b = b0 + b1, c = c0 + c1, m = sqrt(a * a + b * b + c * c), phi2 = asin(c /= m), lambda2 = abs(abs(c) - 1) < epsilon3 || abs(lambda02 - lambda1) < epsilon3 ? (lambda02 + lambda1) / 2 : atan2(b, a), p = project(lambda2, phi2), x2 = p[0], y2 = p[1], dx2 = x2 - x03, dy2 = y2 - y03, dz = dy * dx2 - dx * dy2;
      if (dz * dz / d2 > delta2 || abs((dx * dx2 + dy * dy2) / d2 - 0.5) > 0.3 || a0 * a1 + b0 * b1 + c0 * c1 < cosMinDistance) {
        resampleLineTo(x03, y03, lambda02, a0, b0, c0, x2, y2, lambda2, a /= m, b /= m, c, depth, stream);
        stream.point(x2, y2);
        resampleLineTo(x2, y2, lambda2, a, b, c, x12, y12, lambda1, a1, b1, c1, depth, stream);
      }
    }
  }
  return function(stream) {
    var lambda002, x00, y00, a00, b00, c00, lambda02, x03, y03, a0, b0, c0;
    var resampleStream = {
      point,
      lineStart,
      lineEnd,
      polygonStart: function() {
        stream.polygonStart();
        resampleStream.lineStart = ringStart;
      },
      polygonEnd: function() {
        stream.polygonEnd();
        resampleStream.lineStart = lineStart;
      }
    };
    function point(x, y) {
      x = project(x, y);
      stream.point(x[0], x[1]);
    }
    function lineStart() {
      x03 = NaN;
      resampleStream.point = linePoint;
      stream.lineStart();
    }
    function linePoint(lambda, phi) {
      var c = cartesian([lambda, phi]), p = project(lambda, phi);
      resampleLineTo(x03, y03, lambda02, a0, b0, c0, x03 = p[0], y03 = p[1], lambda02 = lambda, a0 = c[0], b0 = c[1], c0 = c[2], maxDepth, stream);
      stream.point(x03, y03);
    }
    function lineEnd() {
      resampleStream.point = point;
      stream.lineEnd();
    }
    function ringStart() {
      lineStart();
      resampleStream.point = ringPoint;
      resampleStream.lineEnd = ringEnd;
    }
    function ringPoint(lambda, phi) {
      linePoint(lambda002 = lambda, phi), x00 = x03, y00 = y03, a00 = a0, b00 = b0, c00 = c0;
      resampleStream.point = linePoint;
    }
    function ringEnd() {
      resampleLineTo(x03, y03, lambda02, a0, b0, c0, x00, y00, lambda002, a00, b00, c00, maxDepth, stream);
      resampleStream.lineEnd = lineEnd;
      lineEnd();
    }
    return resampleStream;
  };
}

// node_modules/d3-geo/src/projection/index.js
var transformRadians = transformer({
  point: function(x, y) {
    this.stream.point(x * radians, y * radians);
  }
});
function transformRotate(rotate) {
  return transformer({
    point: function(x, y) {
      var r = rotate(x, y);
      return this.stream.point(r[0], r[1]);
    }
  });
}
function scaleTranslate(k, dx, dy, sx, sy) {
  function transform(x, y) {
    x *= sx;
    y *= sy;
    return [dx + k * x, dy - k * y];
  }
  transform.invert = function(x, y) {
    return [(x - dx) / k * sx, (dy - y) / k * sy];
  };
  return transform;
}
function scaleTranslateRotate(k, dx, dy, sx, sy, alpha) {
  if (!alpha) return scaleTranslate(k, dx, dy, sx, sy);
  var cosAlpha = cos(alpha), sinAlpha = sin(alpha), a = cosAlpha * k, b = sinAlpha * k, ai = cosAlpha / k, bi = sinAlpha / k, ci = (sinAlpha * dy - cosAlpha * dx) / k, fi = (sinAlpha * dx + cosAlpha * dy) / k;
  function transform(x, y) {
    x *= sx;
    y *= sy;
    return [a * x - b * y + dx, dy - b * x - a * y];
  }
  transform.invert = function(x, y) {
    return [sx * (ai * x - bi * y + ci), sy * (fi - bi * x - ai * y)];
  };
  return transform;
}
function projection(project) {
  return projectionMutator(function() {
    return project;
  })();
}
function projectionMutator(projectAt) {
  var project, k = 150, x = 480, y = 250, lambda = 0, phi = 0, deltaLambda = 0, deltaPhi = 0, deltaGamma = 0, rotate, alpha = 0, sx = 1, sy = 1, theta = null, preclip = antimeridian_default, x03 = null, y03, x12, y12, postclip = identity_default, delta2 = 0.5, projectResample, projectTransform, projectRotateTransform, cache, cacheStream;
  function projection2(point) {
    return projectRotateTransform(point[0] * radians, point[1] * radians);
  }
  function invert(point) {
    point = projectRotateTransform.invert(point[0], point[1]);
    return point && [point[0] * degrees, point[1] * degrees];
  }
  projection2.stream = function(stream) {
    return cache && cacheStream === stream ? cache : cache = transformRadians(transformRotate(rotate)(preclip(projectResample(postclip(cacheStream = stream)))));
  };
  projection2.preclip = function(_) {
    return arguments.length ? (preclip = _, theta = void 0, reset()) : preclip;
  };
  projection2.postclip = function(_) {
    return arguments.length ? (postclip = _, x03 = y03 = x12 = y12 = null, reset()) : postclip;
  };
  projection2.clipAngle = function(_) {
    return arguments.length ? (preclip = +_ ? circle_default(theta = _ * radians) : (theta = null, antimeridian_default), reset()) : theta * degrees;
  };
  projection2.clipExtent = function(_) {
    return arguments.length ? (postclip = _ == null ? (x03 = y03 = x12 = y12 = null, identity_default) : clipRectangle(x03 = +_[0][0], y03 = +_[0][1], x12 = +_[1][0], y12 = +_[1][1]), reset()) : x03 == null ? null : [[x03, y03], [x12, y12]];
  };
  projection2.scale = function(_) {
    return arguments.length ? (k = +_, recenter()) : k;
  };
  projection2.translate = function(_) {
    return arguments.length ? (x = +_[0], y = +_[1], recenter()) : [x, y];
  };
  projection2.center = function(_) {
    return arguments.length ? (lambda = _[0] % 360 * radians, phi = _[1] % 360 * radians, recenter()) : [lambda * degrees, phi * degrees];
  };
  projection2.rotate = function(_) {
    return arguments.length ? (deltaLambda = _[0] % 360 * radians, deltaPhi = _[1] % 360 * radians, deltaGamma = _.length > 2 ? _[2] % 360 * radians : 0, recenter()) : [deltaLambda * degrees, deltaPhi * degrees, deltaGamma * degrees];
  };
  projection2.angle = function(_) {
    return arguments.length ? (alpha = _ % 360 * radians, recenter()) : alpha * degrees;
  };
  projection2.reflectX = function(_) {
    return arguments.length ? (sx = _ ? -1 : 1, recenter()) : sx < 0;
  };
  projection2.reflectY = function(_) {
    return arguments.length ? (sy = _ ? -1 : 1, recenter()) : sy < 0;
  };
  projection2.precision = function(_) {
    return arguments.length ? (projectResample = resample_default(projectTransform, delta2 = _ * _), reset()) : sqrt(delta2);
  };
  projection2.fitExtent = function(extent2, object2) {
    return fitExtent(projection2, extent2, object2);
  };
  projection2.fitSize = function(size, object2) {
    return fitSize(projection2, size, object2);
  };
  projection2.fitWidth = function(width, object2) {
    return fitWidth(projection2, width, object2);
  };
  projection2.fitHeight = function(height, object2) {
    return fitHeight(projection2, height, object2);
  };
  function recenter() {
    var center = scaleTranslateRotate(k, 0, 0, sx, sy, alpha).apply(null, project(lambda, phi)), transform = scaleTranslateRotate(k, x - center[0], y - center[1], sx, sy, alpha);
    rotate = rotateRadians(deltaLambda, deltaPhi, deltaGamma);
    projectTransform = compose_default(project, transform);
    projectRotateTransform = compose_default(rotate, projectTransform);
    projectResample = resample_default(projectTransform, delta2);
    return reset();
  }
  function reset() {
    cache = cacheStream = null;
    return projection2;
  }
  return function() {
    project = projectAt.apply(this, arguments);
    projection2.invert = project.invert && invert;
    return recenter();
  };
}

// node_modules/d3-geo/src/projection/azimuthal.js
function azimuthalInvert(angle) {
  return function(x, y) {
    var z = sqrt(x * x + y * y), c = angle(z), sc = sin(c), cc2 = cos(c);
    return [
      atan2(x * sc, z * cc2),
      asin(z && y * sc / z)
    ];
  };
}

// node_modules/d3-geo/src/projection/stereographic.js
function stereographicRaw(x, y) {
  var cy = cos(y), k = 1 + cos(x) * cy;
  return [cy * sin(x) / k, sin(y) / k];
}
stereographicRaw.invert = azimuthalInvert(function(z) {
  return 2 * atan(z);
});
function stereographic_default() {
  return projection(stereographicRaw).scale(250).clipAngle(142);
}

// node_modules/d3-geo-voronoi/src/math.js
var pi2 = Math.PI;
var halfPi2 = pi2 / 2;
var quarterPi2 = pi2 / 4;
var tau3 = pi2 * 2;
var degrees2 = 180 / pi2;
var radians2 = pi2 / 180;
var atan22 = Math.atan2;
var cos2 = Math.cos;
var max = Math.max;
var min = Math.min;
var sin2 = Math.sin;
var sign2 = Math.sign || function(x) {
  return x > 0 ? 1 : x < 0 ? -1 : 0;
};
var sqrt2 = Math.sqrt;
function asin2(x) {
  return x > 1 ? halfPi2 : x < -1 ? -halfPi2 : Math.asin(x);
}

// node_modules/d3-geo-voronoi/src/cartesian.js
function cartesianDot2(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cartesianCross2(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}
function cartesianAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function cartesianNormalize(d) {
  var l = sqrt2(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  return [d[0] / l, d[1] / l, d[2] / l];
}

// node_modules/d3-geo-voronoi/src/delaunay.js
function spherical2(cartesian3) {
  return [
    atan22(cartesian3[1], cartesian3[0]) * degrees2,
    asin2(max(-1, min(1, cartesian3[2]))) * degrees2
  ];
}
function cartesian2(coordinates2) {
  const lambda = coordinates2[0] * radians2, phi = coordinates2[1] * radians2, cosphi = cos2(phi);
  return [cosphi * cos2(lambda), cosphi * sin2(lambda), sin2(phi)];
}
function excess(triangle) {
  triangle = triangle.map((p) => cartesian2(p));
  return cartesianDot2(triangle[0], cartesianCross2(triangle[2], triangle[1]));
}
function geoDelaunay(points) {
  const delaunay = geo_delaunay_from(points), triangles = geo_triangles(delaunay), edges = geo_edges(triangles, points), neighbors = geo_neighbors(triangles, points.length), find = geo_find(neighbors, points), circumcenters = geo_circumcenters(triangles, points), { polygons, centers } = geo_polygons(circumcenters, triangles, points), mesh = geo_mesh(polygons), hull = geo_hull(triangles, points), urquhart = geo_urquhart(edges, triangles);
  return {
    delaunay,
    edges,
    triangles,
    centers,
    neighbors,
    polygons,
    mesh,
    hull,
    urquhart,
    find
  };
}
function geo_find(neighbors, points) {
  function distance2(a, b) {
    let x = a[0] - b[0], y = a[1] - b[1], z = a[2] - b[2];
    return x * x + y * y + z * z;
  }
  return function find(x, y, next) {
    if (next === void 0) next = 0;
    let cell, dist2, found = next;
    const xyz = cartesian2([x, y]);
    do {
      cell = next;
      next = null;
      dist2 = distance2(xyz, cartesian2(points[cell]));
      neighbors[cell].forEach((i) => {
        let ndist = distance2(xyz, cartesian2(points[i]));
        if (ndist < dist2) {
          dist2 = ndist;
          next = i;
          found = i;
          return;
        }
      });
    } while (next !== null);
    return found;
  };
}
function geo_delaunay_from(points) {
  if (points.length < 2) return {};
  let pivot = 0;
  while (isNaN(points[pivot][0] + points[pivot][1]) && pivot++ < points.length) ;
  const r = rotation_default(points[pivot]), projection2 = stereographic_default().translate([0, 0]).scale(1).rotate(r.invert([180, 0]));
  points = points.map(projection2);
  const zeros = [];
  let max2 = 1;
  for (let i = 0, n = points.length; i < n; i++) {
    let m = points[i][0] ** 2 + points[i][1] ** 2;
    if (!isFinite(m) || m > 1e32) zeros.push(i);
    else if (m > max2) max2 = m;
  }
  const FAR = 1e6 * sqrt2(max2);
  zeros.forEach((i) => points[i] = [FAR, 0]);
  points.push([0, FAR]);
  points.push([-FAR, 0]);
  points.push([0, -FAR]);
  const delaunay = Delaunay.from(points);
  delaunay.projection = projection2;
  const { triangles, halfedges, inedges } = delaunay;
  const degenerate = [];
  for (let i = 0, l = halfedges.length; i < l; i++) {
    if (halfedges[i] < 0) {
      const j = i % 3 == 2 ? i - 2 : i + 1;
      const k = i % 3 == 0 ? i + 2 : i - 1;
      const a = halfedges[j];
      const b = halfedges[k];
      halfedges[a] = b;
      halfedges[b] = a;
      halfedges[j] = halfedges[k] = -1;
      triangles[i] = triangles[j] = triangles[k] = pivot;
      inedges[triangles[a]] = a % 3 == 0 ? a + 2 : a - 1;
      inedges[triangles[b]] = b % 3 == 0 ? b + 2 : b - 1;
      degenerate.push(Math.min(i, j, k));
      i += 2 - i % 3;
    } else if (triangles[i] > points.length - 3 - 1) {
      triangles[i] = pivot;
    }
  }
  return delaunay;
}
function geo_edges(triangles, points) {
  const _index = /* @__PURE__ */ new Set();
  if (points.length === 2) return [[0, 1]];
  triangles.forEach((tri) => {
    if (tri[0] === tri[1]) return;
    if (excess(tri.map((i) => points[i])) < 0) return;
    for (let i = 0, j; i < 3; i++) {
      j = (i + 1) % 3;
      _index.add(extent([tri[i], tri[j]]).join("-"));
    }
  });
  return Array.from(_index, (d) => d.split("-").map(Number));
}
function geo_triangles(delaunay) {
  const { triangles } = delaunay;
  if (!triangles) return [];
  const geo_triangles2 = [];
  for (let i = 0, n = triangles.length / 3; i < n; i++) {
    const a = triangles[3 * i], b = triangles[3 * i + 1], c = triangles[3 * i + 2];
    if (a !== b && b !== c) {
      geo_triangles2.push([a, c, b]);
    }
  }
  return geo_triangles2;
}
function geo_circumcenters(triangles, points) {
  return triangles.map((tri) => {
    const c = tri.map((i) => points[i]).map(cartesian2), V = cartesianAdd(
      cartesianAdd(cartesianCross2(c[1], c[0]), cartesianCross2(c[2], c[1])),
      cartesianCross2(c[0], c[2])
    );
    return spherical2(cartesianNormalize(V));
  });
}
function geo_neighbors(triangles, npoints) {
  const neighbors = [];
  triangles.forEach((tri) => {
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3];
      neighbors[a] = neighbors[a] || [];
      neighbors[a].push(b);
    }
  });
  if (triangles.length === 0) {
    if (npoints === 2) neighbors[0] = [1], neighbors[1] = [0];
    else if (npoints === 1) neighbors[0] = [];
  }
  return neighbors;
}
function geo_polygons(circumcenters, triangles, points) {
  const polygons = [];
  const centers = circumcenters.slice();
  if (triangles.length === 0) {
    if (points.length < 2) return { polygons, centers };
    if (points.length === 2) {
      const a = cartesian2(points[0]), b = cartesian2(points[1]), m = cartesianNormalize(cartesianAdd(a, b)), d = cartesianNormalize(cartesianCross2(a, b)), c = cartesianCross2(m, d);
      const poly = [
        m,
        cartesianCross2(m, c),
        cartesianCross2(cartesianCross2(m, c), c),
        cartesianCross2(cartesianCross2(cartesianCross2(m, c), c), c)
      ].map(spherical2).map(supplement);
      return polygons.push(poly), polygons.push(poly.slice().reverse()), { polygons, centers };
    }
  }
  triangles.forEach((tri, t) => {
    for (let j = 0; j < 3; j++) {
      const a = tri[j], b = tri[(j + 1) % 3], c = tri[(j + 2) % 3];
      polygons[a] = polygons[a] || [];
      polygons[a].push([b, c, t, [a, b, c]]);
    }
  });
  const reordered = polygons.map((poly) => {
    const p = [poly[0][2]];
    let k = poly[0][1];
    for (let i = 1; i < poly.length; i++) {
      for (let j = 0; j < poly.length; j++) {
        if (poly[j][0] == k) {
          k = poly[j][1];
          p.push(poly[j][2]);
          break;
        }
      }
    }
    if (p.length > 2) {
      return p;
    } else if (p.length == 2) {
      const R0 = o_midpoint(
        points[poly[0][3][0]],
        points[poly[0][3][1]],
        centers[p[0]]
      ), R1 = o_midpoint(
        points[poly[0][3][2]],
        points[poly[0][3][0]],
        centers[p[0]]
      );
      const i0 = supplement(R0), i1 = supplement(R1);
      return [p[0], i1, p[1], i0];
    }
  });
  function supplement(point) {
    let f = -1;
    centers.slice(triangles.length, Infinity).forEach((p, i) => {
      if (p[0] === point[0] && p[1] === point[1]) f = i + triangles.length;
    });
    if (f < 0) f = centers.length, centers.push(point);
    return f;
  }
  return { polygons: reordered, centers };
}
function o_midpoint(a, b, c) {
  a = cartesian2(a);
  b = cartesian2(b);
  c = cartesian2(c);
  const s = sign2(cartesianDot2(cartesianCross2(b, a), c));
  return spherical2(cartesianNormalize(cartesianAdd(a, b)).map((d) => s * d));
}
function geo_mesh(polygons) {
  const mesh = [];
  polygons.forEach((poly) => {
    if (!poly) return;
    let p = poly[poly.length - 1];
    for (let q of poly) {
      if (q > p) mesh.push([p, q]);
      p = q;
    }
  });
  return mesh;
}
function geo_urquhart(edges, triangles) {
  return function(distances) {
    const _lengths = /* @__PURE__ */ new Map(), _urquhart = /* @__PURE__ */ new Map();
    edges.forEach((edge, i) => {
      const u4 = edge.join("-");
      _lengths.set(u4, distances[i]);
      _urquhart.set(u4, true);
    });
    triangles.forEach((tri) => {
      let l = 0, remove = -1;
      for (let j = 0; j < 3; j++) {
        let u4 = extent([tri[j], tri[(j + 1) % 3]]).join("-");
        if (_lengths.get(u4) > l) {
          l = _lengths.get(u4);
          remove = u4;
        }
      }
      _urquhart.set(remove, false);
    });
    return edges.map((edge) => _urquhart.get(edge.join("-")));
  };
}
function geo_hull(triangles, points) {
  const _hull = /* @__PURE__ */ new Set(), hull = [];
  triangles.map((tri) => {
    if (excess(tri.map((i) => points[i > points.length ? 0 : i])) > 1e-12)
      return;
    for (let i = 0; i < 3; i++) {
      let e = [tri[i], tri[(i + 1) % 3]], code = `${e[0]}-${e[1]}`;
      if (_hull.has(code)) _hull.delete(code);
      else _hull.add(`${e[1]}-${e[0]}`);
    }
  });
  const _index = /* @__PURE__ */ new Map();
  let start;
  _hull.forEach((e) => {
    e = e.split("-").map(Number);
    _index.set(e[0], e[1]);
    start = e[0];
  });
  if (start === void 0) return hull;
  let next = start;
  do {
    hull.push(next);
    let n = _index.get(next);
    _index.set(next, -1);
    next = n;
  } while (next > -1 && next !== start);
  return hull;
}

// node_modules/d3-geo-voronoi/src/voronoi.js
function geoVoronoi(data) {
  const v2 = function(data2) {
    v2.delaunay = null;
    v2._data = data2;
    if (typeof v2._data === "object" && v2._data.type === "FeatureCollection") {
      v2._data = v2._data.features;
    }
    if (typeof v2._data === "object") {
      const temp = v2._data.map((d) => [v2._vx(d), v2._vy(d), d]).filter((d) => isFinite(d[0] + d[1]));
      v2.points = temp.map((d) => [d[0], d[1]]);
      v2.valid = temp.map((d) => d[2]);
      v2.delaunay = geoDelaunay(v2.points);
    }
    return v2;
  };
  v2._vx = function(d) {
    if (typeof d == "object" && "type" in d) {
      return centroid_default(d)[0];
    }
    if (0 in d) return d[0];
  };
  v2._vy = function(d) {
    if (typeof d == "object" && "type" in d) {
      return centroid_default(d)[1];
    }
    if (1 in d) return d[1];
  };
  v2.x = function(f) {
    if (!f) return v2._vx;
    v2._vx = f;
    return v2;
  };
  v2.y = function(f) {
    if (!f) return v2._vy;
    v2._vy = f;
    return v2;
  };
  v2.polygons = function(data2) {
    if (data2 !== void 0) {
      v2(data2);
    }
    if (!v2.delaunay) return false;
    const coll = {
      type: "FeatureCollection",
      features: []
    };
    if (v2.valid.length === 0) return coll;
    v2.delaunay.polygons.forEach(
      (poly, i) => coll.features.push({
        type: "Feature",
        geometry: !poly ? null : {
          type: "Polygon",
          coordinates: [
            [...poly, poly[0]].map((i2) => v2.delaunay.centers[i2])
          ]
        },
        properties: {
          site: v2.valid[i],
          sitecoordinates: v2.points[i],
          neighbours: v2.delaunay.neighbors[i]
          // not part of the public API
        }
      })
    );
    if (v2.valid.length === 1)
      coll.features.push({
        type: "Feature",
        geometry: { type: "Sphere" },
        properties: {
          site: v2.valid[0],
          sitecoordinates: v2.points[0],
          neighbours: []
        }
      });
    return coll;
  };
  v2.triangles = function(data2) {
    if (data2 !== void 0) {
      v2(data2);
    }
    if (!v2.delaunay) return false;
    return {
      type: "FeatureCollection",
      features: v2.delaunay.triangles.map((tri, index) => {
        tri = tri.map((i) => v2.points[i]);
        tri.center = v2.delaunay.centers[index];
        return tri;
      }).filter((tri) => excess(tri) > 0).map((tri) => ({
        type: "Feature",
        properties: {
          circumcenter: tri.center
        },
        geometry: {
          type: "Polygon",
          coordinates: [[...tri, tri[0]]]
        }
      }))
    };
  };
  v2.links = function(data2) {
    if (data2 !== void 0) {
      v2(data2);
    }
    if (!v2.delaunay) return false;
    const _distances = v2.delaunay.edges.map(
      (e) => distance_default(v2.points[e[0]], v2.points[e[1]])
    ), _urquart = v2.delaunay.urquhart(_distances);
    return {
      type: "FeatureCollection",
      features: v2.delaunay.edges.map((e, i) => ({
        type: "Feature",
        properties: {
          source: v2.valid[e[0]],
          target: v2.valid[e[1]],
          length: _distances[i],
          urquhart: !!_urquart[i]
        },
        geometry: {
          type: "LineString",
          coordinates: [v2.points[e[0]], v2.points[e[1]]]
        }
      }))
    };
  };
  v2.mesh = function(data2) {
    if (data2 !== void 0) {
      v2(data2);
    }
    if (!v2.delaunay) return false;
    return {
      type: "MultiLineString",
      coordinates: v2.delaunay.edges.map((e) => [
        v2.points[e[0]],
        v2.points[e[1]]
      ])
    };
  };
  v2.cellMesh = function(data2) {
    if (data2 !== void 0) {
      v2(data2);
    }
    if (!v2.delaunay) return false;
    const { centers, polygons } = v2.delaunay;
    const coordinates2 = [];
    for (const p of polygons) {
      if (!p) continue;
      for (let n = p.length, p0 = p[n - 1], p1 = p[0], i = 0; i < n; p0 = p1, p1 = p[++i]) {
        if (p1 > p0) {
          coordinates2.push([centers[p0], centers[p1]]);
        }
      }
    }
    return {
      type: "MultiLineString",
      coordinates: coordinates2
    };
  };
  v2._found = void 0;
  v2.find = function(x, y, radius) {
    v2._found = v2.delaunay.find(x, y, v2._found);
    if (!radius || distance_default([x, y], v2.points[v2._found]) < radius)
      return v2._found;
  };
  v2.hull = function(data2) {
    if (data2 !== void 0) {
      v2(data2);
    }
    const hull = v2.delaunay.hull, points = v2.points;
    return hull.length === 0 ? null : {
      type: "Polygon",
      coordinates: [[...hull.map((i) => points[i]), points[hull[0]]]]
    };
  };
  return data ? v2(data) : v2;
}
export {
  geoDelaunay,
  geoVoronoi
};
