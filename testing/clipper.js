// Clipper 2 testing


Draw = CONFIG.GeometryLib.Draw
Point3d = CONFIG.GeometryLib.threeD.Point3d
api = game.modules.get("tokenvisibility").api
Plane = CONFIG.GeometryLib.threeD.Plane
ClipperPaths = CONFIG.GeometryLib.ClipperPaths
QBenchmarkLoopFn = CONFIG.GeometryLib.bench.QBenchmarkLoopFn
QBenchmarkLoopFnWithSleep = CONFIG.GeometryLib.bench.QBenchmarkLoopFnWithSleep
clipper2WASM = api.clipper2;
clipper2JS = api.Clipper2


// From https://github.com/ErikSom/Clipper2-WASM/blob/main/clipper2WASM-wasm/examples/benchmark/circlePath.js
function circlePath(center,radius,points) {
	const path = [];

	for (let i = 0; i < points; i++) {
		const radAngle = (i / points) * (Math.PI * 2);
		const p = {
		x: Math.round(center.x + Math.cos(radAngle) * radius),
		y: Math.round(center.y + Math.sin(radAngle) * radius),
		};
		path.push(p);
	}
	  return path;
}

function testPolyOperationClipper1(type, subjectFillType, subjectInput, clipInput) {
  const c = ClipperPaths.fromPolygons([new PIXI.Polygon(clipInput)])
  const solution = c._clipperClip(new PIXI.Polygon(subjectInput), type, subjectFillType, subjectFillType)
  return solution;
  /*
  const c = new ClipperLib.Clipper();
  const solution = [];
  c.AddPath(subjectInput, ClipperLib.PolyType.ptSubject, true);
  c.AddPath(clipInput, ClipperLib.PolyType.ptClip, true);
  c.Execute(clipType, solution, subjectFillType, subjectFillType);
  return solution
  */
}

//
// let out;
// function initPolyOperationClipper2(lib) {
// 	out = new lib.Paths64();
// }

function testPolyOperationClipper2(type, subjectFillType, subjectInput, clipInput) {
  const subject = new clipper2WASM.Paths64();
  const clip = new clipper2WASM.Paths64();

  const subjectInputArr = subjectInput.map((p) => [p.x, p.y]).flat();
  const clipInputArr = clipInput.map((p) => [p.x, p.y]).flat();
  subject.push_back(clipper2WASM.MakePath64(subjectInputArr));
  clip.push_back(clipper2WASM.MakePath64(clipInputArr));

  let solution;
  switch ( type ) {
    case clipper2WASM.ClipType['Intersection']: solution = clipper2WASM.Intersect64(subject, clip, subjectFillType); break;
    case clipper2WASM.ClipType['Union']: solution = clipper2WASM.Union64(subject, clip, subjectFillType); break;
    case clipper2WASM.ClipType['Difference']: solution = clipper2WASM.Difference64(subject, clip, subjectFillType); break;
    case clipper2WASM.ClipType['Xor']: solution = clipper2WASM.Xor64(subject, clip, subjectFillType); break;
  }

  const nPaths = solution.size()
  const paths = new Array(solution.size());
  for ( let s = 0; s < nPaths; s += 1 ) {
    const path = solution.get(s);
    const n = path.size();
    const solutionArr = new Float32Array(n * 2);
    for ( let i = 0, j = 0; i < n; i += 1, j += 2 ) {
      const pt = path.get(i);
      solutionArr[j] = Number(pt.x);
      solutionArr[j+1] = Number(pt.y);
    }
    paths[s] = solutionArr;
  }

  subject.delete;
  clip.delete;

  return paths;


// 	const c2 = new clipper2WASM.CreateClipper64(false);
// 	c2.AddSubject(subject);
// 	c2.AddClip(clip);
// 	c2.ExecutePath(clipType, subjectFillType, out);

	// c2.delete();
}

function testPolyOperationClipper2Fast(type, subjectFillType, subjectInputArr, clipInputArr) {
  const subject = new clipper2WASM.Paths64();
  const clip = new clipper2WASM.Paths64();

  subject.push_back(clipper2WASM.MakePath64(subjectInputArr));
  clip.push_back(clipper2WASM.MakePath64(clipInputArr));

  let solution;
  switch ( type ) {
    case clipper2WASM.ClipType['Intersection']: solution = clipper2WASM.Intersect64(subject, clip, subjectFillType); break;
    case clipper2WASM.ClipType['Union']: solution = clipper2WASM.Union64(subject, clip, subjectFillType); break;
    case clipper2WASM.ClipType['Difference']: solution = clipper2WASM.Difference64(subject, clip, subjectFillType); break;
    case clipper2WASM.ClipType['Xor']: solution = clipper2WASM.Xor64(subject, clip, subjectFillType); break;
  }

  const nPaths = solution.size()
  const paths = new Array(solution.size());
  for ( let s = 0; s < nPaths; s += 1 ) {
    const path = solution.get(s);
    const n = path.size();
    const solutionArr = new Float32Array(n * 2);
    for ( let i = 0, j = 0; i < n; i += 1, j += 2 ) {
      const pt = path.get(i);
      solutionArr[j] = Number(pt.x);
      solutionArr[j+1] = Number(pt.y);
    }
    paths[s] = solutionArr;
  }

  subject.delete;
  clip.delete;

  return paths;


// 	const c2 = new clipper2WASM.CreateClipper64(false);
// 	c2.AddSubject(subject);
// 	c2.AddClip(clip);
// 	c2.ExecutePath(clipType, subjectFillType, out);

	// c2.delete();
}

function testPolyOperationClipper3(type, subjectFillType, subjectInput, clipInput) {
  const subject = new clipper2JS.Paths64(1);
  const clip = new clipper2JS.Paths64(1);
  const scale = 1

  const sPath = new clipper2JS.Path64(subjectInput.length * 2);
  for ( let i = 0, iMax = subjectInput.length, j = 0; i < iMax; i += 1, j += 2 ) {
    const pt = subjectInput[i];
    sPath[j] = pt.x * scale;
    sPath[j+1] = pt.y * scale;
  }
  subject[0] = sPath;

  const cPath = new clipper2JS.Path64(clipInput.length * 2);
  for ( let i = 0, iMax = clipInput.length, j = 0; i < iMax; i += 1, j += 2 ) {
    const pt = clipInput[i];
    cPath[j] = pt.x * scale;
    cPath[j+1] = pt.y * scale;
  }
  clip[0] = cPath;


  let solution;
  switch ( type ) {
    case clipper2JS.ClipType['Intersection']: solution = clipper2JS.Clipper.Intersect(subject, clip, subjectFillType); break;
    case clipper2JS.ClipType['Union']: solution = clipper2JS.Clipper.Union(subject, clip, subjectFillType); break;
    case clipper2JS.ClipType['Difference']: solution = clipper2JS.Clipper.Difference(subject, clip, subjectFillType); break;
    case clipper2JS.ClipType['Xor']: solution = clipper2JS.Clipper.Xor(subject, clip, subjectFillType); break;
  }

  return solution;


// 	const c2 = new clipper2WASM.CreateClipper64(false);
// 	c2.AddSubject(subject);
// 	c2.AddClip(clip);
// 	c2.ExecutePath(clipType, subjectFillType, out);

	// c2.delete();
}

function testPolyOperationClipper3Fast(type, subjectFillType, subjectInputArr, clipInputArr) {

  const subject = new clipper2JS.Paths64(1);
  const clip = new clipper2JS.Paths64(1);

  subject[0] = subjectInputArr;
  clip[0] = clipInputArr;

  let solution;
  switch ( type ) {
    case clipper2JS.ClipType['Intersection']: solution = clipper2JS.Clipper.Intersect(subject, clip, subjectFillType); break;
    case clipper2JS.ClipType['Union']: solution = clipper2JS.Clipper.Union(subject, clip, subjectFillType); break;
    case clipper2JS.ClipType['Difference']: solution = clipper2JS.Clipper.Difference(subject, clip, subjectFillType); break;
    case clipper2JS.ClipType['Xor']: solution = clipper2JS.Clipper.Xor(subject, clip, subjectFillType); break;
  }

  return solution;


// 	const c2 = new clipper2WASM.CreateClipper64(false);
// 	c2.AddSubject(subject);
// 	c2.AddClip(clip);
// 	c2.ExecutePath(clipType, subjectFillType, out);

	// c2.delete();
}


benchmarks = [
  { ops: 10, points: 500 },
  { ops: 10, points: 5000 },
];

clipTypes1 = {
  "Intersection": ClipperLib.ClipType.ctIntersection,
  "Union": ClipperLib.ClipType.ctUnion,
  "Difference": ClipperLib.ClipType.ctDifference,
  "XOR": ClipperLib.ClipType.ctXor,
};

clipTypes2 = {
  "Intersection": clipper2WASM.ClipType['Intersection'],
  "Union": clipper2WASM.ClipType['Union'],
  "Difference": clipper2WASM.ClipType['Difference'],
  "XOR": clipper2WASM.ClipType['Xor'],
}

clipTypes3 = {
  "Intersection": clipper2JS.ClipType['Intersection'],
  "Union": clipper2JS.ClipType['Union'],
  "Difference": clipper2JS.ClipType['Difference'],
  "XOR": clipper2JS.ClipType['Xor'],
}

polyFillTypes1 = {
  "EvenOdd": ClipperLib.PolyFillType.pftEvenOdd,
  // "NonZero": ClipperLib.PolyFillType.pftNonZero,
  // "Negative": ClipperLib.PolyFillType.pftNegative,
  // "Positive": ClipperLib.PolyFillType.pftPositive,
}

polyFillTypes2 = {
  "EvenOdd": clipper2WASM.FillRule.EvenOdd,
  // "NonZero": clipper2WASM.FillRule.NonZero,
  // "Negative": clipper2WASM.FillRule.Negative,
  // "Positive": clipper2WASM.FillRule.Positive,
}

polyFillTypes3 = {
  "EvenOdd": clipper2JS.FillRule.EvenOdd,
  // "NonZero": clipper2JS.FillRule.NonZero,
  // "Negative": clipper2JS.FillRule.Negative,
  // "Positive": clipper2JS.FillRule.Positive,
}


for (const bench of benchmarks) {

  const poly1 = circlePath({ x: 1000, y: 1000 }, 1000, bench.points);
  const poly2 = circlePath({ x: 2500, y: 1000 }, 1000, bench.points);

  // convert to array of ints
  const poly1Arr = poly1.map((p) => [p.x, p.y]).flat();
  const poly2Arr = poly2.map((p) => [p.x, p.y]).flat();
//
//   const poly1Paths = new clipper2WASM.Paths64();
//   const poly2Paths = new clipper2WASM.Paths64();
//   poly1Paths.push_back(clipper2WASM.MakePath64(poly1ArrayInt));
//   poly2Paths.push_back(clipper2WASM.MakePath64(poly2ArrayInt));

  // initPolyOperationClipper2(clipper2WASM, poly1Paths, poly2Paths);



  for ( const clipType of Object.keys(clipTypes1) ) {
    for ( const polyFillType of Object.keys(polyFillTypes1) ) {

      let start1 = performance.now();
      for (let i = 0; i < bench.ops; i++) {
        const res = testPolyOperationClipper1(clipTypes1[clipType], polyFillTypes1[polyFillType], poly1, poly2);
      }
      let end1 = performance.now();

      let start2 = performance.now();
      for (let i = 0; i < bench.ops; i++) {
        const res = testPolyOperationClipper2(clipTypes2[clipType], polyFillTypes2[polyFillType], poly1, poly2);
      }
      let end2 = performance.now();

      let start3 = performance.now();
      for (let i = 0; i < bench.ops; i++) {
        const res = testPolyOperationClipper3(clipTypes3[clipType], polyFillTypes3[polyFillType], poly1, poly2);
      }
      let end3 = performance.now();

      let start4 = performance.now();
      for (let i = 0; i < bench.ops; i++) {
        const res = testPolyOperationClipper2Fast(clipTypes2[clipType], polyFillTypes2[polyFillType], poly1Arr, poly2Arr);
      }
      let end4 = performance.now();

      let start5 = performance.now();
      for (let i = 0; i < bench.ops; i++) {
        const res = testPolyOperationClipper3Fast(clipTypes3[clipType], polyFillTypes3[polyFillType], poly1Arr, poly2Arr);
      }
      let end5 = performance.now();


      console.log(`clipper1 ${clipType} ${polyFillType} ${bench.ops} ops ${bench.points} points: ${end1 - start1} ms`);
      console.log(`clipper2WASM ${clipType} ${polyFillType} ${bench.ops} ops ${bench.points} points: ${end2 - start2} ms`);
      console.log(`clipper3JS ${clipType} ${polyFillType} ${bench.ops} ops ${bench.points} points: ${end3 - start3} ms`);
      console.log(`clipper2WASM Fast ${clipType} ${polyFillType} ${bench.ops} ops ${bench.points} points: ${end4 - start4} ms`);
      console.log(`clipper3JS Fast ${clipType} ${polyFillType} ${bench.ops} ops ${bench.points} points: ${end5 - start5} ms`);
      console.log("-----")

    }
  }
};

// See https://eriksom.github.io/Clipper2-WASM/clipper2WASM-wasm/examples/es/basic.html

subjectPts = [100, 50, 10, 79, 65, 2, 65, 98, 10, 21];
clipPts = [98, 63, 4, 68, 77, 8, 52, 100, 19, 12]

subject = new clipper2WASM.Paths64();
clip = new clipper2WASM.Paths64();
subject.push_back(clipper2WASM.MakePath64([100, 50, 10, 79, 65, 2, 65, 98, 10, 21]));
clip.push_back(clipper2WASM.MakePath64([98, 63, 4, 68, 77, 8, 52, 100, 19, 12]));
solution = clipper2WASM.Intersect64(subject, clip, clipper2WASM.FillRule.NonZero);

// Get the solution points back from wasm
path = solution.get(0);
n = path.size();
solutionArr = new Float32Array(n * 2);
for ( let i = 0, j = 0; i < n; i += 1, j += 2 ) {
  const pt = path.get(i);
  solutionArr[j] = Number(pt.x);
  solutionArr[j+1] = Number(pt.y);
}



Draw.shape(new PIXI.Polygon(subjectPts), { color: Draw.COLORS.green })
Draw.shape(new PIXI.Polygon(clipPts), { color: Draw.COLORS.red })
Draw.shape(new PIXI.Polygon(...solutionArr), { color: Draw.COLORS.blue })




