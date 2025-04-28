/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  24 September 2023                                               *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2023                                         *
* Purpose   :  Path Offset (Inflate/Shrink)                                    *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
//
// Converted from C# implemention https://github.com/AngusJohnson/Clipper2/blob/main/CSharp/Clipper2Lib/Clipper.Core.cs
// Removed support for USINGZ
//
// Converted by ChatGPT 4 August 3 version https://help.openai.com/en/articles/6825453-chatgpt-release-notes
//
import { Clipper } from "./clipper.mjs";
import { ClipType, FillRule, InternalClipper, Point64, Rect64 } from "./core.mjs";
import { Clipper64 } from "./engine.mjs";
export var JoinType;
(function (JoinType) {
    JoinType[JoinType["Miter"] = 0] = "Miter";
    JoinType[JoinType["Square"] = 1] = "Square";
    JoinType[JoinType["Bevel"] = 2] = "Bevel";
    JoinType[JoinType["Round"] = 3] = "Round";
})(JoinType || (JoinType = {}));
export var EndType;
(function (EndType) {
    EndType[EndType["Polygon"] = 0] = "Polygon";
    EndType[EndType["Joined"] = 1] = "Joined";
    EndType[EndType["Butt"] = 2] = "Butt";
    EndType[EndType["Square"] = 3] = "Square";
    EndType[EndType["Round"] = 4] = "Round";
})(EndType || (EndType = {}));
class Group {
    constructor(paths, joinType, endType = EndType.Polygon) {
        this.inPaths = [...paths]; // creates a shallow copy of paths
        this.joinType = joinType;
        this.endType = endType;
        this.outPath = [];
        this.outPaths = [];
        this.pathsReversed = false;
    }
}
export class PointD {
    constructor(xOrPt, yOrScale) {
        if (typeof xOrPt === 'number' && typeof yOrScale === 'number') {
            this.x = xOrPt;
            this.y = yOrScale;
        }
        else if (xOrPt instanceof PointD) {
            if (yOrScale !== undefined) {
                this.x = xOrPt.x * yOrScale;
                this.y = xOrPt.y * yOrScale;
            }
            else {
                this.x = xOrPt.x;
                this.y = xOrPt.y;
            }
        }
        else {
            this.x = xOrPt.x * (yOrScale || 1);
            this.y = xOrPt.y * (yOrScale || 1);
        }
    }
    toString(precision = 2) {
        return `${this.x.toFixed(precision)},${this.y.toFixed(precision)}`;
    }
    static equals(lhs, rhs) {
        return InternalClipper.isAlmostZero(lhs.x - rhs.x) &&
            InternalClipper.isAlmostZero(lhs.y - rhs.y);
    }
    static notEquals(lhs, rhs) {
        return !InternalClipper.isAlmostZero(lhs.x - rhs.x) ||
            !InternalClipper.isAlmostZero(lhs.y - rhs.y);
    }
    equals(obj) {
        if (obj instanceof PointD) {
            return PointD.equals(this, obj);
        }
        return false;
    }
    negate() {
        this.x = -this.x;
        this.y = -this.y;
    }
}
export class ClipperOffset {
    constructor(miterLimit = 2.0, arcTolerance = 0.0, preserveCollinear = false, reverseSolution = false) {
        this._groupList = [];
        this._normals = [];
        this._solution = [];
        this.MiterLimit = miterLimit;
        this.ArcTolerance = arcTolerance;
        this.MergeGroups = true;
        this.PreserveCollinear = preserveCollinear;
        this.ReverseSolution = reverseSolution;
    }
    clear() {
        this._groupList = [];
    }
    addPath(path, joinType, endType) {
        if (path.length === 0)
            return;
        const pp = [path];
        this.addPaths(pp, joinType, endType);
    }
    addPaths(paths, joinType, endType) {
        if (paths.length === 0)
            return;
        this._groupList.push(new Group(paths, joinType, endType));
    }
    executeInternal(delta) {
        this._solution = [];
        if (this._groupList.length === 0)
            return;
        if (Math.abs(delta) < 0.5) {
            for (const group of this._groupList) {
                for (const path of group.inPaths) {
                    this._solution.push(path);
                }
            }
        }
        else {
            this._delta = delta;
            this._mitLimSqr = (this.MiterLimit <= 1 ? 2.0 : 2.0 / this.sqr(this.MiterLimit));
            for (const group of this._groupList) {
                this.doGroupOffset(group);
            }
        }
    }
    sqr(value) {
        return value * value;
    }
    execute(delta, solution) {
        solution.length = 0;
        this.executeInternal(delta);
        if (this._groupList.length === 0)
            return;
        // clean up self-intersections ...
        const c = new Clipper64();
        c.preserveCollinear = this.PreserveCollinear;
        // the solution should retain the orientation of the input
        c.reverseSolution = this.ReverseSolution !== this._groupList[0].pathsReversed;
        c.addSubjectPaths(this._solution);
        if (this._groupList[0].pathsReversed)
            c.execute(ClipType.Union, FillRule.Negative, solution);
        else
            c.execute(ClipType.Union, FillRule.Positive, solution);
    }
    executePolytree(delta, polytree) {
        polytree.clear();
        this.executeInternal(delta);
        if (this._groupList.length === 0)
            return;
        // clean up self-intersections ...
        const c = new Clipper64();
        c.preserveCollinear = this.PreserveCollinear;
        // the solution should retain the orientation of the input
        c.reverseSolution = this.ReverseSolution !== this._groupList[0].pathsReversed;
        c.addSubjectPaths(this._solution);
        if (this._groupList[0].pathsReversed)
            c.executePolyTree(ClipType.Union, FillRule.Negative, polytree);
        else
            c.executePolyTree(ClipType.Union, FillRule.Positive, polytree);
    }
    static getUnitNormal(pt1, pt2) {
        let dx = pt2.x - pt1.x;
        let dy = pt2.y - pt1.y;
        if (dx === 0 && dy === 0)
            return new PointD(0, 0);
        const f = 1.0 / Math.sqrt(dx * dx + dy * dy);
        dx *= f;
        dy *= f;
        return new PointD(dy, -dx);
    }
    executeCallback(deltaCallback, solution) {
        this.DeltaCallback = deltaCallback;
        this.execute(1.0, solution);
    }
    static getBoundsAndLowestPolyIdx(paths) {
        const rec = new Rect64(false); // ie invalid rect
        let lpX = Number.MIN_SAFE_INTEGER;
        let index = -1;
        for (let i = 0; i < paths.length; i++) {
            for (const pt of paths[i]) {
                if (pt.y >= rec.bottom) {
                    if (pt.y > rec.bottom || pt.x < lpX) {
                        index = i;
                        lpX = pt.x;
                        rec.bottom = pt.y;
                    }
                }
                else if (pt.y < rec.top)
                    rec.top = pt.y;
                if (pt.x > rec.right)
                    rec.right = pt.x;
                else if (pt.x < rec.left)
                    rec.left = pt.x;
            }
        }
        return { index, rec };
    }
    static translatePoint(pt, dx, dy) {
        return new PointD(pt.x + dx, pt.y + dy);
    }
    static reflectPoint(pt, pivot) {
        return new PointD(pivot.x + (pivot.x - pt.x), pivot.y + (pivot.y - pt.y));
    }
    static almostZero(value, epsilon = 0.001) {
        return Math.abs(value) < epsilon;
    }
    static hypotenuse(x, y) {
        return Math.sqrt(Math.pow(x, 2) + Math.pow(y, 2));
    }
    static normalizeVector(vec) {
        const h = this.hypotenuse(vec.x, vec.y);
        if (this.almostZero(h))
            return new PointD(0, 0);
        const inverseHypot = 1 / h;
        return new PointD(vec.x * inverseHypot, vec.y * inverseHypot);
    }
    static getAvgUnitVector(vec1, vec2) {
        return this.normalizeVector(new PointD(vec1.x + vec2.x, vec1.y + vec2.y));
    }
    static intersectPoint(pt1a, pt1b, pt2a, pt2b) {
        if (InternalClipper.isAlmostZero(pt1a.x - pt1b.x)) { //vertical
            if (InternalClipper.isAlmostZero(pt2a.x - pt2b.x))
                return new PointD(0, 0);
            const m2 = (pt2b.y - pt2a.y) / (pt2b.x - pt2a.x);
            const b2 = pt2a.y - m2 * pt2a.x;
            return new PointD(pt1a.x, m2 * pt1a.x + b2);
        }
        if (InternalClipper.isAlmostZero(pt2a.x - pt2b.x)) { //vertical
            const m1 = (pt1b.y - pt1a.y) / (pt1b.x - pt1a.x);
            const b1 = pt1a.y - m1 * pt1a.x;
            return new PointD(pt2a.x, m1 * pt2a.x + b1);
        }
        else {
            const m1 = (pt1b.y - pt1a.y) / (pt1b.x - pt1a.x);
            const b1 = pt1a.y - m1 * pt1a.x;
            const m2 = (pt2b.y - pt2a.y) / (pt2b.x - pt2a.x);
            const b2 = pt2a.y - m2 * pt2a.x;
            if (InternalClipper.isAlmostZero(m1 - m2))
                return new PointD(0, 0);
            const x = (b2 - b1) / (m1 - m2);
            return new PointD(x, m1 * x + b1);
        }
    }
    getPerpendic(pt, norm) {
        return new Point64(pt.x + norm.x * this._groupDelta, pt.y + norm.y * this._groupDelta);
    }
    getPerpendicD(pt, norm) {
        return new PointD(pt.x + norm.x * this._groupDelta, pt.y + norm.y * this._groupDelta);
    }
    doBevel(group, path, j, k) {
        let pt1, pt2;
        if (j == k) {
            const absDelta = Math.abs(this._groupDelta);
            pt1 = new Point64(path[j].x - absDelta * this._normals[j].x, path[j].y - absDelta * this._normals[j].y);
            pt2 = new Point64(path[j].x + absDelta * this._normals[j].x, path[j].y + absDelta * this._normals[j].y);
        }
        else {
            pt1 = new Point64(path[j].x + this._groupDelta * this._normals[k].x, path[j].y + this._groupDelta * this._normals[k].y);
            pt2 = new Point64(path[j].x + this._groupDelta * this._normals[j].x, path[j].y + this._groupDelta * this._normals[j].y);
        }
        group.outPath.push(pt1);
        group.outPath.push(pt2);
    }
    doSquare(group, path, j, k) {
        let vec;
        if (j === k) {
            vec = new PointD(this._normals[j].y, -this._normals[j].x);
        }
        else {
            vec = ClipperOffset.getAvgUnitVector(new PointD(-this._normals[k].y, this._normals[k].x), new PointD(this._normals[j].y, -this._normals[j].x));
        }
        const absDelta = Math.abs(this._groupDelta);
        // now offset the original vertex delta units along unit vector
        let ptQ = new PointD(path[j].x, path[j].y);
        ptQ = ClipperOffset.translatePoint(ptQ, absDelta * vec.x, absDelta * vec.y);
        // get perpendicular vertices
        const pt1 = ClipperOffset.translatePoint(ptQ, this._groupDelta * vec.y, this._groupDelta * -vec.x);
        const pt2 = ClipperOffset.translatePoint(ptQ, this._groupDelta * -vec.y, this._groupDelta * vec.x);
        // get 2 vertices along one edge offset
        const pt3 = this.getPerpendicD(path[k], this._normals[k]);
        if (j === k) {
            const pt4 = new PointD(pt3.x + vec.x * this._groupDelta, pt3.y + vec.y * this._groupDelta);
            const pt = ClipperOffset.intersectPoint(pt1, pt2, pt3, pt4);
            //get the second intersect point through reflection
            group.outPath.push(new Point64(ClipperOffset.reflectPoint(pt, ptQ).x, ClipperOffset.reflectPoint(pt, ptQ).y));
            group.outPath.push(new Point64(pt.x, pt.y));
        }
        else {
            const pt4 = this.getPerpendicD(path[j], this._normals[k]);
            const pt = ClipperOffset.intersectPoint(pt1, pt2, pt3, pt4);
            group.outPath.push(new Point64(pt.x, pt.y));
            //get the second intersect point through reflection
            group.outPath.push(new Point64(ClipperOffset.reflectPoint(pt, ptQ).x, ClipperOffset.reflectPoint(pt, ptQ).y));
        }
    }
    doMiter(group, path, j, k, cosA) {
        const q = this._groupDelta / (cosA + 1);
        group.outPath.push(new Point64(path[j].x + (this._normals[k].x + this._normals[j].x) * q, path[j].y + (this._normals[k].y + this._normals[j].y) * q));
    }
    doRound(group, path, j, k, angle) {
        if (typeof this.DeltaCallback !== "undefined") {
            const absDelta = Math.abs(this._groupDelta);
            const arcTol = this.ArcTolerance > 0.01
                ? this.ArcTolerance
                : Math.log10(2 + absDelta) * InternalClipper.defaultArcTolerance;
            const stepsPer360 = Math.PI / Math.acos(1 - arcTol / absDelta);
            this._stepSin = Math.sin((2 * Math.PI) / stepsPer360);
            this._stepCos = Math.cos((2 * Math.PI) / stepsPer360);
            if (this._groupDelta < 0.0)
                this._stepSin = -this._stepSin;
            this._stepsPerRad = stepsPer360 / (2 * Math.PI);
        }
        const pt = path[j];
        let offsetVec = new PointD(this._normals[k].x * this._groupDelta, this._normals[k].y * this._groupDelta);
        if (j === k)
            offsetVec.negate();
        group.outPath.push(new Point64(pt.x + offsetVec.x, pt.y + offsetVec.y));
        const steps = Math.ceil(this._stepsPerRad * Math.abs(angle));
        for (let i = 1; i < steps; i++) {
            offsetVec = new PointD(offsetVec.x * this._stepCos - this._stepSin * offsetVec.y, offsetVec.x * this._stepSin + offsetVec.y * this._stepCos);
            group.outPath.push(new Point64(pt.x + offsetVec.x, pt.y + offsetVec.y));
        }
        group.outPath.push(this.getPerpendic(pt, this._normals[j]));
    }
    buildNormals(path) {
        const cnt = path.length;
        this._normals = [];
        this._normals.length = cnt;
        for (let i = 0; i < cnt - 1; i++) {
            this._normals[i] = ClipperOffset.getUnitNormal(path[i], path[i + 1]);
        }
        this._normals[cnt - 1] = ClipperOffset.getUnitNormal(path[cnt - 1], path[0]);
    }
    crossProduct(vec1, vec2) {
        return (vec1.y * vec2.x - vec2.y * vec1.x);
    }
    dotProduct(vec1, vec2) {
        return (vec1.x * vec2.x + vec1.y * vec2.y);
    }
    offsetPoint(group, path, j, k) {
        const sinA = this.crossProduct(this._normals[j], this._normals[k]);
        let cosA = this.dotProduct(this._normals[j], this._normals[k]);
        if (sinA > 1.0)
            cosA = 1.0;
        else if (sinA < -1.0)
            cosA = -1.0;
        if (typeof this.DeltaCallback !== "undefined") {
            this._groupDelta = this.DeltaCallback(path, this._normals, j, k);
            if (group.pathsReversed)
                this._groupDelta = -this._groupDelta;
        }
        if (Math.abs(this._groupDelta) < ClipperOffset.Tolerance) {
            group.outPath.push(path[j]);
            return;
        }
        if (cosA > -0.99 && (sinA * this._groupDelta < 0)) { // test for concavity first (#593)
            // is concave
            group.outPath.push(this.getPerpendic(path[j], this._normals[k]));
            // this extra point is the only (simple) way to ensure that
            // path reversals are fully cleaned with the trailing clipper
            group.outPath.push(path[j]);
            group.outPath.push(this.getPerpendic(path[j], this._normals[j]));
        }
        else if (cosA > 0.999) {
            this.doMiter(group, path, j, k, cosA);
        }
        else if (this._joinType === JoinType.Miter) {
            // miter unless the angle is so acute the miter would exceeds ML
            if (cosA > this._mitLimSqr - 1) {
                this.doMiter(group, path, j, k, cosA);
            }
            else {
                this.doSquare(group, path, j, k);
            }
        }
        else if (cosA > 0.99 || this._joinType == JoinType.Bevel)
            //angle less than 8 degrees or a squared join
            this.doBevel(group, path, j, k);
        else if (this._joinType == JoinType.Round)
            this.doRound(group, path, j, k, Math.atan2(sinA, cosA));
        else
            this.doSquare(group, path, j, k);
        k = j;
    }
    offsetPolygon(group, path) {
        const area = Clipper.area(path);
        if ((area < 0) !== (this._groupDelta < 0)) {
            const rect = Clipper.getBounds(path);
            const offsetMinDim = Math.abs(this._groupDelta) * 2;
            if (offsetMinDim > rect.width || offsetMinDim > rect.height)
                return;
        }
        group.outPath = [];
        const cnt = path.length;
        const prev = cnt - 1;
        for (let i = 0; i < cnt; i++) {
            this.offsetPoint(group, path, i, prev);
        }
        group.outPaths.push(group.outPath);
    }
    offsetOpenJoined(group, path) {
        this.offsetPolygon(group, path);
        path = Clipper.reversePath(path);
        this.buildNormals(path);
        this.offsetPolygon(group, path);
    }
    offsetOpenPath(group, path) {
        group.outPath = [];
        const highI = path.length - 1;
        if (typeof this.DeltaCallback !== "undefined") {
            this._groupDelta = this.DeltaCallback(path, this._normals, 0, 0);
        }
        if (Math.abs(this._groupDelta) < ClipperOffset.Tolerance) {
            group.outPath.push(path[0]);
        }
        else {
            switch (this._endType) {
                case EndType.Butt:
                    this.doBevel(group, path, 0, 0);
                    break;
                case EndType.Round:
                    this.doRound(group, path, 0, 0, Math.PI);
                    break;
                default:
                    this.doSquare(group, path, 0, 0);
                    break;
            }
        }
        for (let i = 1, k = 0; i < highI; i++) {
            this.offsetPoint(group, path, i, k);
        }
        for (let i = highI; i > 0; i--) {
            this._normals[i] = new PointD(-this._normals[i - 1].x, -this._normals[i - 1].y);
        }
        this._normals[0] = this._normals[highI];
        if (typeof this.DeltaCallback !== "undefined") {
            this._groupDelta = this.DeltaCallback(path, this._normals, highI, highI);
        }
        if (Math.abs(this._groupDelta) < ClipperOffset.Tolerance) {
            group.outPath.push(path[highI]);
        }
        else {
            switch (this._endType) {
                case EndType.Butt:
                    this.doBevel(group, path, highI, highI);
                    break;
                case EndType.Round:
                    this.doRound(group, path, highI, highI, Math.PI);
                    break;
                default:
                    this.doSquare(group, path, highI, highI);
                    break;
            }
        }
        for (let i = highI, k = 0; i > 0; i--) {
            this.offsetPoint(group, path, i, k);
        }
        group.outPaths.push(group.outPath);
    }
    doGroupOffset(group) {
        if (group.endType == EndType.Polygon) {
            const { index } = ClipperOffset.getBoundsAndLowestPolyIdx(group.inPaths);
            if (index < 0)
                return;
            const area = Clipper.area(group.inPaths[index]);
            group.pathsReversed = area < 0;
            if (group.pathsReversed) {
                this._groupDelta = -this._delta;
            }
            else {
                this._groupDelta = this._delta;
            }
        }
        else {
            group.pathsReversed = false;
            this._groupDelta = Math.abs(this._delta) * 0.5;
        }
        const absDelta = Math.abs(this._groupDelta);
        this._joinType = group.joinType;
        this._endType = group.endType;
        if (!this.DeltaCallback &&
            (group.joinType == JoinType.Round || group.endType == EndType.Round)) {
            const arcTol = this.ArcTolerance > 0.01
                ? this.ArcTolerance
                : Math.log10(2 + absDelta) * InternalClipper.defaultArcTolerance;
            const stepsPer360 = Math.PI / Math.acos(1 - arcTol / absDelta);
            this._stepSin = Math.sin((2 * Math.PI) / stepsPer360);
            this._stepCos = Math.cos((2 * Math.PI) / stepsPer360);
            if (this._groupDelta < 0.0) {
                this._stepSin = -this._stepSin;
            }
            this._stepsPerRad = stepsPer360 / (2 * Math.PI);
        }
        const isJoined = group.endType == EndType.Joined || group.endType == EndType.Polygon;
        for (const p of group.inPaths) {
            const path = Clipper.stripDuplicates(p, isJoined);
            const cnt = path.length;
            if (cnt === 0 || (cnt < 3 && this._endType == EndType.Polygon)) {
                continue;
            }
            if (cnt == 1) {
                group.outPath = [];
                if (group.endType == EndType.Round) {
                    const r = absDelta;
                    const steps = Math.ceil(this._stepsPerRad * 2 * Math.PI);
                    group.outPath = Clipper.ellipse(path[0], r, r, steps);
                }
                else {
                    const d = Math.ceil(this._groupDelta);
                    const r = new Rect64(path[0].x - d, path[0].y - d, path[0].x - d, path[0].y - d);
                    group.outPath = r.asPath();
                }
                group.outPaths.push(group.outPath);
            }
            else {
                if (cnt == 2 && group.endType == EndType.Joined) {
                    if (group.joinType == JoinType.Round) {
                        this._endType = EndType.Round;
                    }
                    else {
                        this._endType = EndType.Square;
                    }
                }
                this.buildNormals(path);
                if (this._endType == EndType.Polygon) {
                    this.offsetPolygon(group, path);
                }
                else if (this._endType == EndType.Joined) {
                    this.offsetOpenJoined(group, path);
                }
                else {
                    this.offsetOpenPath(group, path);
                }
            }
        }
        this._solution.push(...group.outPaths);
        group.outPaths = [];
    }
}
ClipperOffset.Tolerance = 1.0E-12;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoib2Zmc2V0LmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vcHJvamVjdHMvY2xpcHBlcjItanMvc3JjL2xpYi9vZmZzZXQudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Z0ZBT2dGO0FBRWhGLEVBQUU7QUFDRix1SEFBdUg7QUFDdkgsNkJBQTZCO0FBQzdCLEVBQUU7QUFDRiw0R0FBNEc7QUFDNUcsRUFBRTtBQUVGLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxXQUFXLENBQUM7QUFDcEMsT0FBTyxFQUFFLFFBQVEsRUFBRSxRQUFRLEVBQVksZUFBZSxFQUFtQixPQUFPLEVBQUUsTUFBTSxFQUFFLE1BQU0sUUFBUSxDQUFDO0FBQ3pHLE9BQU8sRUFBRSxTQUFTLEVBQWMsTUFBTSxVQUFVLENBQUM7QUFFakQsTUFBTSxDQUFOLElBQVksUUFLWDtBQUxELFdBQVksUUFBUTtJQUNsQix5Q0FBSyxDQUFBO0lBQ0wsMkNBQU0sQ0FBQTtJQUNOLHlDQUFLLENBQUE7SUFDTCx5Q0FBSyxDQUFBO0FBQ1AsQ0FBQyxFQUxXLFFBQVEsS0FBUixRQUFRLFFBS25CO0FBRUQsTUFBTSxDQUFOLElBQVksT0FNWDtBQU5ELFdBQVksT0FBTztJQUNqQiwyQ0FBTyxDQUFBO0lBQ1AseUNBQU0sQ0FBQTtJQUNOLHFDQUFJLENBQUE7SUFDSix5Q0FBTSxDQUFBO0lBQ04sdUNBQUssQ0FBQTtBQUNQLENBQUMsRUFOVyxPQUFPLEtBQVAsT0FBTyxRQU1sQjtBQUVELE1BQU0sS0FBSztJQVFULFlBQVksS0FBYyxFQUFFLFFBQWtCLEVBQUUsVUFBbUIsT0FBTyxDQUFDLE9BQU87UUFDaEYsSUFBSSxDQUFDLE9BQU8sR0FBRyxDQUFDLEdBQUcsS0FBSyxDQUFDLENBQUMsQ0FBQyxrQ0FBa0M7UUFDN0QsSUFBSSxDQUFDLFFBQVEsR0FBRyxRQUFRLENBQUM7UUFDekIsSUFBSSxDQUFDLE9BQU8sR0FBRyxPQUFPLENBQUM7UUFDdkIsSUFBSSxD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QUMsQ0FBQyxDQUFDLEVBQUUsRUFBRSxVQUFVO1lBQzdELElBQUksZUFBZSxDQUFDLFlBQVksQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUM7Z0JBQUUsT0FBTyxJQUFJLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDM0UsTUFBTSxFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxDQUFDO1lBQ2pELE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDLEdBQUcsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUM7WUFDaEMsT0FBTyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsQ0FBQyxFQUFFLEVBQUUsR0FBRyxJQUFJLENBQUMsQ0FBQyxHQUFHLEVBQUUsQ0FBQyxDQUFDO1NBQzdDO1FBRUQsSUFBSSxlQUFlLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxFQUFFLEVBQUUsVUFBVTtZQUM3RCxNQUFNLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDakQsTUFBTSxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUMsR0FBRyxFQUFFLEdBQUcsSUFBSSxDQUFDLENBQUMsQ0FBQztZQUNoQyxPQUFPLElBQUksTUFBTSxDQUFDLElBQUksQ0FBQyxDQUFDLEVBQUUsRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDLEdBQUcsRUFBRSxDQUFDLENBQUM7U0FDN0M7YUFBTTtZQUNMLE1BQU0sRUFBRSxHQUFHLENBQUMsSUFBSSxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxJQUFJLENB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SSxDQUFDLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxXQUFXLENBQUMsQ0FBQztZQUN0RCxJQUFJLENBQUMsUUFBUSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsQ0FBQyxDQUFDLEdBQUcsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLFdBQVcsQ0FBQyxDQUFDO1lBQ3RELElBQUksSUFBSSxDQUFDLFdBQVcsR0FBRyxHQUFHO2dCQUFFLElBQUksQ0FBQyxRQUFRLEdBQUcsQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDO1lBQzNELElBQUksQ0FBQyxZQUFZLEdBQUcsV0FBVyxHQUFHLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztTQUNqRDtRQUVELE1BQU0sRUFBRSxHQUFHLElBQUksQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUNuQixJQUFJLFNBQVMsR0FBRyxJQUFJLE1BQU0sQ0FBQyxJQUFJLENBQUMsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLElBQUksQ0FBQyxRQUFRLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxHQUFHLElBQUksQ0FBQyxXQUFXLENBQUMsQ0FBQztRQUN6RyxJQUFJLENBQUMsS0FBSyxDQUFDO1lBQUUsU0FBUyxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQ2hDLEtBQUssQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksT0FBTyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEdBQUcsU0FBUyxDQUFDLENBQUMsRUFBRSxFQUFFLENBQUMsQ0FBQyxHQUFHLFNBQVMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBRXhFLE1BQU0sS0FBSyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFDLFlBQVksR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7UUFDN0QsS0FBSyxJQUFJLENBQUMsR0FB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R0FBVyxPQUFPLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4qIEF1dGhvciAgICA6ICBBbmd1cyBKb2huc29uICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIERhdGUgICAgICA6ICAyNCBTZXB0ZW1iZXIgMjAyMyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIFdlYnNpdGUgICA6ICBodHRwOi8vd3d3LmFuZ3Vzai5jb20gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIENvcHlyaWdodCA6ICBBbmd1cyBKb2huc29uIDIwMTAtMjAyMyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIFB1cnBvc2UgICA6ICBQYXRoIE9mZnNldCAoSW5mbGF0ZS9TaHJpbmspICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIExpY2Vuc2UgICA6ICBodHRwOi8vd3d3LmJvb3N0Lm9yZy9MSUNFTlNFXzFfMC50eHQgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xyXG5cclxuLy9cclxuLy8gQ29udmVydGVkIGZyb20gQyMgaW1wbGVtZW50aW9uIGh0dHBzOi8vZ2l0aHViLmNvbS9Bbmd1c0pvaG5zb24vQ2xpcHBlcjIvYmxvYi9tYWluL0NTaGFycC9DbGlwcGVyMkxpYi9DbGlwcGVyLkNvcmUuY3NcclxuLy8gUmVtb3ZlZCBzdXBwb3J0IGZvciBVU0lOR1pcclxuLy9cclxuLy8gQ29udmVydGVkIGJ5IENoYXRHUFQgNCBBdWd1c3QgMyB2ZXJzaW9uIGh0dHBzOi8vaGVscC5vcGVuYWkuY29tL2VuL2FydGljbGVzLzY4MjU0NTMtY2hhdGdwdC1yZWxlYXNlLW5vdGVzXHJcbi8vXHJcblxyXG5pbXBvcnQgeyBDbGlwcGVyIH0gZnJvbSBcIi4vY2xpcHBlclwiO1xyXG5pbXBvcnQgeyBDbGlwVHlwZSwgRmlsbFJ1bGUsIElQb2ludDY0LCBJbnRlcm5hbENsaXBwZXIsIFBhdGg2NCwgUGF0aHM2NCwgUG9pbnQ2NCwgUmVjdDY0IH0gZnJvbSBcIi4vY29yZVwiO1xyXG5pbXBvcnQgeyBDbGlwcGVyNjQsIFBvbHlUcmVlNjQgfSBmcm9tIFwiLi9lbmdpbmVcIjtcclxuXHJcbmV4cG9ydCBlbnVtIEpvaW5UeXBlIHtcclxuICBNaXRlcixcclxuICBTcXVhcmUsXHJcbiAgQmV2ZWwsXHJcbiAgUm91bmRcclxufVxyXG5cclxuZXhwb3J0IGVudW0gRW5kVHlwZSB7XHJcbiAgUG9seWdvbixcclxuICBKb2luZWQsXHJcbiAgQnV0dCxcclxuICBTcXVhcmUsXHJcbiAgUm91bmRcclxufVxyXG5cclxuY2xhc3MgR3JvdXAge1xyXG4gIGluUGF0aHM6IFBhdGhzNjQ7XHJcbiAgb3V0UGF0aDogUGF0aDY0O1xyXG4gIG91dFBhdGhzOiBQYXRoczY0O1xyXG4gIGpvaW5UeXBlOiBKb2luVHlwZTtcclxuICBlbmRUeXBlOiBFbmRUeXBlO1xyXG4gIHBhdGhzUmV2ZXJzZWQ6IGJvb2xlYW47XHJcblxyXG4gIGNvbnN0cnVjdG9yKHBhdGhzOiBQYXRoczY0LCBqb2luVHlwZTogSm9pblR5cGUsIGVuZFR5cGU6IEVuZFR5cGUgPSBFbmRUeXBlLlBvbHlnb24pIHtcclxuICAgIHRoaXMuaW5QYXRocyA9IFsuLi5wYXRoc107IC8vIGNyZWF0ZXMgYSBzaGFsbG93IGNvcHkgb2YgcGF0aHNcclxuICAgIHRoaXMuam9pblR5cGUgPSBqb2luVHlwZTtcclxuICAgIHRoaXMuZW5kVHlwZSA9IGVuZFR5cGU7XHJcbiAgICB0aGlzLm91dFBhdGggPSBbXTtcclxuICAgIHRoaXMub3V0UGF0aHMgPSBbXTtcclxuICAgIHRoaXMucGF0aHNSZXZlcnNlZCA9IGZhbHNlO1xyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFBvaW50RCBpbXBsZW1lbnRzIElQb2ludDY0IHtcclxuICBwdWJsaWMgeDogbnVtYmVyO1xyXG4gIHB1YmxpYyB5OiBudW1iZXI7XHJcblxyXG4gIGNvbnN0cnVjdG9yKHhPclB0OiBudW1iZXIgfCBQb2ludEQgfCBQb2ludDY0LCB5T3JTY2FsZT86IG51bWJlcikge1xyXG4gICAgaWYgKHR5cGVvZiB4T3JQdCA9PT0gJ251bWJlcicgJiYgdHlwZW9mIHlPclNjYWxlID09PSAnbnVtYmVyJykge1xyXG4gICAgICB0aGlzLnggPSB4T3JQdDtcclxuICAgICAgdGhpcy55ID0geU9yU2NhbGU7XHJcbiAgICB9IGVsc2UgaWYgKHhPclB0IGluc3RhbmNlb2YgUG9pbnREKSB7XHJcbiAgICAgIGlmICh5T3JTY2FsZSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy54ID0geE9yUHQueCAqIHlPclNjYWxlO1xyXG4gICAgICAgIHRoaXMueSA9IHhPclB0LnkgKiB5T3JTY2FsZTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLnggPSB4T3JQdC54O1xyXG4gICAgICAgIHRoaXMueSA9IHhPclB0Lnk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRoaXMueCA9ICg8UG9pbnQ2ND54T3JQdCkueCAqICh5T3JTY2FsZSB8fCAxKTtcclxuICAgICAgdGhpcy55ID0gKDxQb2ludDY0PnhPclB0KS55ICogKHlPclNjYWxlIHx8IDEpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHVibGljIHRvU3RyaW5nKHByZWNpc2lvbjogbnVtYmVyID0gMik6IHN0cmluZyB7XHJcbiAgICByZXR1cm4gYCR7dGhpcy54LnRvRml4ZWQocHJlY2lzaW9uKX0sJHt0aGlzLnkudG9GaXhlZChwcmVjaXNpb24pfWA7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIGVxdWFscyhsaHM6IFBvaW50RCwgcmhzOiBQb2ludEQpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBJbnRlcm5hbENsaXBwZXIuaXNBbG1vc3RaZXJvKGxocy54IC0gcmhzLngpICYmXHJcbiAgICAgIEludGVybmFsQ2xpcHBlci5pc0FsbW9zdFplcm8obGhzLnkgLSByaHMueSk7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIG5vdEVxdWFscyhsaHM6IFBvaW50RCwgcmhzOiBQb2ludEQpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAhSW50ZXJuYWxDbGlwcGVyLmlzQWxtb3N0WmVybyhsaHMueCAtIHJocy54KSB8fFxyXG4gICAgICAhSW50ZXJuYWxDbGlwcGVyLmlzQWxtb3N0WmVybyhsaHMueSAtIHJocy55KTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBlcXVhbHMob2JqOiBQb2ludEQpOiBib29sZWFuIHtcclxuICAgIGlmIChvYmogaW5zdGFuY2VvZiBQb2ludEQpIHtcclxuICAgICAgcmV0dXJuIFBvaW50RC5lcXVhbHModGhpcywgb2JqKTtcclxuICAgIH1cclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBuZWdhdGUoKTogdm9pZCB7XHJcbiAgICB0aGlzLnggPSAtdGhpcy54O1xyXG4gICAgdGhpcy55ID0gLXRoaXMueTtcclxuICB9XHJcblxyXG4gIC8vICBwdWJsaWMgZ2V0SGFzaENvZGUoKTogbnVtYmVyIHtcclxuICAvLyAgICByZXR1cm4gdGhpcy54IF4gdGhpcy55OyAgLy8gWE9SLWJhc2VkIGhhc2ggY29tYmluYXRpb24uIEFkanVzdCBpZiBuZWVkZWQuXHJcbiAgLy8gIH1cclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIENsaXBwZXJPZmZzZXQge1xyXG5cclxuICBwcml2YXRlIHN0YXRpYyBUb2xlcmFuY2U6IG51bWJlciA9IDEuMEUtMTI7XHJcbiAgcHJpdmF0ZSBfZ3JvdXBMaXN0OiBBcnJheTxHcm91cD4gPSBbXTtcclxuICBwcml2YXRlIF9ub3JtYWxzOiBBcnJheTxQb2ludEQ+ID0gW107XHJcbiAgcHJpdmF0ZSBfc29sdXRpb246IFBhdGhzNjQgPSBbXTtcclxuICBwcml2YXRlIF9ncm91cERlbHRhITogbnVtYmVyOyAvLyowLjUgZm9yIG9wZW4gcGF0aHM7ICotMS4wIGZvciBuZWdhdGl2ZSBhcmVhc1xyXG4gIHByaXZhdGUgX2RlbHRhITogbnVtYmVyO1xyXG4gIHByaXZhdGUgX21pdExpbVNxciE6IG51bWJlcjtcclxuICBwcml2YXRlIF9zdGVwc1BlclJhZCE6IG51bWJlcjtcclxuICBwcml2YXRlIF9zdGVwU2luITogbnVtYmVyO1xyXG4gIHByaXZhdGUgX3N0ZXBDb3MhOiBudW1iZXI7XHJcbiAgcHJpdmF0ZSBfam9pblR5cGUhOiBKb2luVHlwZTtcclxuICBwcml2YXRlIF9lbmRUeXBlITogRW5kVHlwZTtcclxuICBwdWJsaWMgQXJjVG9sZXJhbmNlOiBudW1iZXI7XHJcbiAgcHVibGljIE1lcmdlR3JvdXBzOiBib29sZWFuO1xyXG4gIHB1YmxpYyBNaXRlckxpbWl0OiBudW1iZXI7XHJcbiAgcHVibGljIFByZXNlcnZlQ29sbGluZWFyOiBib29sZWFuO1xyXG4gIHB1YmxpYyBSZXZlcnNlU29sdXRpb246IGJvb2xlYW47XHJcblxyXG4gIHB1YmxpYyBEZWx0YUNhbGxiYWNrPzogKHBhdGg6IElQb2ludDY0W10sIHBhdGhfbm9ybXM6IFBvaW50RFtdLCBjdXJyUHQ6IG51bWJlciwgcHJldlB0OiBudW1iZXIpID0+IG51bWJlcjtcclxuXHJcbiAgY29uc3RydWN0b3IobWl0ZXJMaW1pdDogbnVtYmVyID0gMi4wLCBhcmNUb2xlcmFuY2U6IG51bWJlciA9IDAuMCxcclxuICAgIHByZXNlcnZlQ29sbGluZWFyOiBib29sZWFuID0gZmFsc2UsIHJldmVyc2VTb2x1dGlvbjogYm9vbGVhbiA9IGZhbHNlKSB7XHJcbiAgICB0aGlzLk1pdGVyTGltaXQgPSBtaXRlckxpbWl0O1xyXG4gICAgdGhpcy5BcmNUb2xlcmFuY2UgPSBhcmNUb2xlcmFuY2U7XHJcbiAgICB0aGlzLk1lcmdlR3JvdXBzID0gdHJ1ZTtcclxuICAgIHRoaXMuUHJlc2VydmVDb2xsaW5lYXIgPSBwcmVzZXJ2ZUNvbGxpbmVhcjtcclxuICAgIHRoaXMuUmV2ZXJzZVNvbHV0aW9uID0gcmV2ZXJzZVNvbHV0aW9uO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIGNsZWFyKCk6IHZvaWQge1xyXG4gICAgdGhpcy5fZ3JvdXBMaXN0ID0gW107XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgYWRkUGF0aChwYXRoOiBQb2ludDY0W10sIGpvaW5UeXBlOiBKb2luVHlwZSwgZW5kVHlwZTogRW5kVHlwZSk6IHZvaWQge1xyXG4gICAgaWYgKHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm47XHJcbiAgICBjb25zdCBwcDogUG9pbnQ2NFtdW10gPSBbcGF0aF07XHJcbiAgICB0aGlzLmFkZFBhdGhzKHBwLCBqb2luVHlwZSwgZW5kVHlwZSk7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgYWRkUGF0aHMocGF0aHM6IFBhdGhzNjQsIGpvaW5UeXBlOiBKb2luVHlwZSwgZW5kVHlwZTogRW5kVHlwZSk6IHZvaWQge1xyXG4gICAgaWYgKHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG4gICAgdGhpcy5fZ3JvdXBMaXN0LnB1c2gobmV3IEdyb3VwKHBhdGhzLCBqb2luVHlwZSwgZW5kVHlwZSkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBleGVjdXRlSW50ZXJuYWwoZGVsdGE6IG51bWJlcik6IHZvaWQge1xyXG4gICAgdGhpcy5fc29sdXRpb24gPSBbXTtcclxuICAgIGlmICh0aGlzLl9ncm91cExpc3QubGVuZ3RoID09PSAwKSByZXR1cm47XHJcblxyXG4gICAgaWYgKE1hdGguYWJzKGRlbHRhKSA8IDAuNSkge1xyXG4gICAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIHRoaXMuX2dyb3VwTGlzdCkge1xyXG4gICAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBncm91cC5pblBhdGhzKSB7XHJcbiAgICAgICAgICB0aGlzLl9zb2x1dGlvbi5wdXNoKHBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhpcy5fZGVsdGEgPSBkZWx0YTtcclxuICAgICAgdGhpcy5fbWl0TGltU3FyID0gKHRoaXMuTWl0ZXJMaW1pdCA8PSAxID8gMi4wIDogMi4wIC8gdGhpcy5zcXIodGhpcy5NaXRlckxpbWl0KSk7XHJcbiAgICAgIGZvciAoY29uc3QgZ3JvdXAgb2YgdGhpcy5fZ3JvdXBMaXN0KSB7XHJcbiAgICAgICAgdGhpcy5kb0dyb3VwT2Zmc2V0KGdyb3VwKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzcXIodmFsdWU6IG51bWJlcik6IG51bWJlciB7XHJcbiAgICByZXR1cm4gdmFsdWUgKiB2YWx1ZTtcclxuICB9XHJcblxyXG5cclxuICBwdWJsaWMgZXhlY3V0ZShkZWx0YTogbnVtYmVyLCBzb2x1dGlvbjogUGF0aHM2NCk6IHZvaWQge1xyXG4gICAgc29sdXRpb24ubGVuZ3RoID0gMDtcclxuICAgIHRoaXMuZXhlY3V0ZUludGVybmFsKGRlbHRhKTtcclxuICAgIGlmICh0aGlzLl9ncm91cExpc3QubGVuZ3RoID09PSAwKSByZXR1cm47XHJcblxyXG4gICAgLy8gY2xlYW4gdXAgc2VsZi1pbnRlcnNlY3Rpb25zIC4uLlxyXG4gICAgY29uc3QgYyA9IG5ldyBDbGlwcGVyNjQoKVxyXG4gICAgYy5wcmVzZXJ2ZUNvbGxpbmVhciA9IHRoaXMuUHJlc2VydmVDb2xsaW5lYXJcclxuICAgIC8vIHRoZSBzb2x1dGlvbiBzaG91bGQgcmV0YWluIHRoZSBvcmllbnRhdGlvbiBvZiB0aGUgaW5wdXRcclxuICAgIGMucmV2ZXJzZVNvbHV0aW9uID0gdGhpcy5SZXZlcnNlU29sdXRpb24gIT09IHRoaXMuX2dyb3VwTGlzdFswXS5wYXRoc1JldmVyc2VkXHJcblxyXG4gICAgYy5hZGRTdWJqZWN0UGF0aHModGhpcy5fc29sdXRpb24pO1xyXG4gICAgaWYgKHRoaXMuX2dyb3VwTGlzdFswXS5wYXRoc1JldmVyc2VkKVxyXG4gICAgICBjLmV4ZWN1dGUoQ2xpcFR5cGUuVW5pb24sIEZpbGxSdWxlLk5lZ2F0aXZlLCBzb2x1dGlvbik7XHJcbiAgICBlbHNlXHJcbiAgICAgIGMuZXhlY3V0ZShDbGlwVHlwZS5VbmlvbiwgRmlsbFJ1bGUuUG9zaXRpdmUsIHNvbHV0aW9uKTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBleGVjdXRlUG9seXRyZWUoZGVsdGE6IG51bWJlciwgcG9seXRyZWU6IFBvbHlUcmVlNjQpOiB2b2lkIHtcclxuICAgIHBvbHl0cmVlLmNsZWFyKCk7XHJcbiAgICB0aGlzLmV4ZWN1dGVJbnRlcm5hbChkZWx0YSk7XHJcbiAgICBpZiAodGhpcy5fZ3JvdXBMaXN0Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG5cclxuICAgIC8vIGNsZWFuIHVwIHNlbGYtaW50ZXJzZWN0aW9ucyAuLi5cclxuICAgIGNvbnN0IGMgPSBuZXcgQ2xpcHBlcjY0KClcclxuICAgIGMucHJlc2VydmVDb2xsaW5lYXIgPSB0aGlzLlByZXNlcnZlQ29sbGluZWFyXHJcbiAgICAvLyB0aGUgc29sdXRpb24gc2hvdWxkIHJldGFpbiB0aGUgb3JpZW50YXRpb24gb2YgdGhlIGlucHV0XHJcbiAgICBjLnJldmVyc2VTb2x1dGlvbiA9IHRoaXMuUmV2ZXJzZVNvbHV0aW9uICE9PSB0aGlzLl9ncm91cExpc3RbMF0ucGF0aHNSZXZlcnNlZFxyXG5cclxuICAgIGMuYWRkU3ViamVjdFBhdGhzKHRoaXMuX3NvbHV0aW9uKTtcclxuICAgIGlmICh0aGlzLl9ncm91cExpc3RbMF0ucGF0aHNSZXZlcnNlZClcclxuICAgICAgYy5leGVjdXRlUG9seVRyZWUoQ2xpcFR5cGUuVW5pb24sIEZpbGxSdWxlLk5lZ2F0aXZlLCBwb2x5dHJlZSk7XHJcbiAgICBlbHNlXHJcbiAgICAgIGMuZXhlY3V0ZVBvbHlUcmVlKENsaXBUeXBlLlVuaW9uLCBGaWxsUnVsZS5Qb3NpdGl2ZSwgcG9seXRyZWUpO1xyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIHN0YXRpYyBnZXRVbml0Tm9ybWFsKHB0MTogSVBvaW50NjQsIHB0MjogSVBvaW50NjQpOiBQb2ludEQge1xyXG4gICAgbGV0IGR4ID0gcHQyLnggLSBwdDEueDtcclxuICAgIGxldCBkeSA9IHB0Mi55IC0gcHQxLnk7XHJcbiAgICBpZiAoZHggPT09IDAgJiYgZHkgPT09IDApIHJldHVybiBuZXcgUG9pbnREKDAsIDApO1xyXG5cclxuICAgIGNvbnN0IGYgPSAxLjAgLyBNYXRoLnNxcnQoZHggKiBkeCArIGR5ICogZHkpO1xyXG4gICAgZHggKj0gZjtcclxuICAgIGR5ICo9IGY7XHJcblxyXG4gICAgcmV0dXJuIG5ldyBQb2ludEQoZHksIC1keCk7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgZXhlY3V0ZUNhbGxiYWNrKGRlbHRhQ2FsbGJhY2s6IChwYXRoOiBJUG9pbnQ2NFtdLCBwYXRoX25vcm1zOiBQb2ludERbXSwgY3VyclB0OiBudW1iZXIsIHByZXZQdDogbnVtYmVyKSA9PiBudW1iZXIsIHNvbHV0aW9uOiBQb2ludDY0W11bXSk6IHZvaWQge1xyXG4gICAgdGhpcy5EZWx0YUNhbGxiYWNrID0gZGVsdGFDYWxsYmFjaztcclxuICAgIHRoaXMuZXhlY3V0ZSgxLjAsIHNvbHV0aW9uKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGdldEJvdW5kc0FuZExvd2VzdFBvbHlJZHgocGF0aHM6IFBhdGhzNjQpOiB7IGluZGV4OiBudW1iZXIsIHJlYzogUmVjdDY0IH0ge1xyXG4gICAgY29uc3QgcmVjID0gbmV3IFJlY3Q2NChmYWxzZSk7IC8vIGllIGludmFsaWQgcmVjdFxyXG4gICAgbGV0IGxwWDogbnVtYmVyID0gTnVtYmVyLk1JTl9TQUZFX0lOVEVHRVI7XHJcbiAgICBsZXQgaW5kZXggPSAtMTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGF0aHMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgZm9yIChjb25zdCBwdCBvZiBwYXRoc1tpXSkge1xyXG4gICAgICAgIGlmIChwdC55ID49IHJlYy5ib3R0b20pIHtcclxuICAgICAgICAgIGlmIChwdC55ID4gcmVjLmJvdHRvbSB8fCBwdC54IDwgbHBYKSB7XHJcbiAgICAgICAgICAgIGluZGV4ID0gaTtcclxuICAgICAgICAgICAgbHBYID0gcHQueDtcclxuICAgICAgICAgICAgcmVjLmJvdHRvbSA9IHB0Lnk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBlbHNlIGlmIChwdC55IDwgcmVjLnRvcCkgcmVjLnRvcCA9IHB0Lnk7XHJcbiAgICAgICAgaWYgKHB0LnggPiByZWMucmlnaHQpIHJlYy5yaWdodCA9IHB0Lng7XHJcbiAgICAgICAgZWxzZSBpZiAocHQueCA8IHJlYy5sZWZ0KSByZWMubGVmdCA9IHB0Lng7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHJldHVybiB7IGluZGV4LCByZWMgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgdHJhbnNsYXRlUG9pbnQocHQ6IFBvaW50RCwgZHg6IG51bWJlciwgZHk6IG51bWJlcik6IFBvaW50RCB7XHJcbiAgICByZXR1cm4gbmV3IFBvaW50RChwdC54ICsgZHgsIHB0LnkgKyBkeSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyByZWZsZWN0UG9pbnQocHQ6IFBvaW50RCwgcGl2b3Q6IFBvaW50RCk6IFBvaW50RCB7XHJcbiAgICByZXR1cm4gbmV3IFBvaW50RChwaXZvdC54ICsgKHBpdm90LnggLSBwdC54KSwgcGl2b3QueSArIChwaXZvdC55IC0gcHQueSkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgYWxtb3N0WmVybyh2YWx1ZTogbnVtYmVyLCBlcHNpbG9uOiBudW1iZXIgPSAwLjAwMSk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIE1hdGguYWJzKHZhbHVlKSA8IGVwc2lsb247XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBoeXBvdGVudXNlKHg6IG51bWJlciwgeTogbnVtYmVyKTogbnVtYmVyIHtcclxuICAgIHJldHVybiBNYXRoLnNxcnQoTWF0aC5wb3coeCwgMikgKyBNYXRoLnBvdyh5LCAyKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBub3JtYWxpemVWZWN0b3IodmVjOiBQb2ludEQpOiBQb2ludEQge1xyXG4gICAgY29uc3QgaCA9IHRoaXMuaHlwb3RlbnVzZSh2ZWMueCwgdmVjLnkpO1xyXG4gICAgaWYgKHRoaXMuYWxtb3N0WmVybyhoKSkgcmV0dXJuIG5ldyBQb2ludEQoMCwgMCk7XHJcbiAgICBjb25zdCBpbnZlcnNlSHlwb3QgPSAxIC8gaDtcclxuICAgIHJldHVybiBuZXcgUG9pbnREKHZlYy54ICogaW52ZXJzZUh5cG90LCB2ZWMueSAqIGludmVyc2VIeXBvdCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBnZXRBdmdVbml0VmVjdG9yKHZlYzE6IFBvaW50RCwgdmVjMjogUG9pbnREKTogUG9pbnREIHtcclxuICAgIHJldHVybiB0aGlzLm5vcm1hbGl6ZVZlY3RvcihuZXcgUG9pbnREKHZlYzEueCArIHZlYzIueCwgdmVjMS55ICsgdmVjMi55KSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBpbnRlcnNlY3RQb2ludChwdDFhOiBQb2ludEQsIHB0MWI6IFBvaW50RCwgcHQyYTogUG9pbnRELCBwdDJiOiBQb2ludEQpOiBQb2ludEQge1xyXG4gICAgaWYgKEludGVybmFsQ2xpcHBlci5pc0FsbW9zdFplcm8ocHQxYS54IC0gcHQxYi54KSkgeyAvL3ZlcnRpY2FsXHJcbiAgICAgIGlmIChJbnRlcm5hbENsaXBwZXIuaXNBbG1vc3RaZXJvKHB0MmEueCAtIHB0MmIueCkpIHJldHVybiBuZXcgUG9pbnREKDAsIDApO1xyXG4gICAgICBjb25zdCBtMiA9IChwdDJiLnkgLSBwdDJhLnkpIC8gKHB0MmIueCAtIHB0MmEueCk7XHJcbiAgICAgIGNvbnN0IGIyID0gcHQyYS55IC0gbTIgKiBwdDJhLng7XHJcbiAgICAgIHJldHVybiBuZXcgUG9pbnREKHB0MWEueCwgbTIgKiBwdDFhLnggKyBiMik7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKEludGVybmFsQ2xpcHBlci5pc0FsbW9zdFplcm8ocHQyYS54IC0gcHQyYi54KSkgeyAvL3ZlcnRpY2FsXHJcbiAgICAgIGNvbnN0IG0xID0gKHB0MWIueSAtIHB0MWEueSkgLyAocHQxYi54IC0gcHQxYS54KTtcclxuICAgICAgY29uc3QgYjEgPSBwdDFhLnkgLSBtMSAqIHB0MWEueDtcclxuICAgICAgcmV0dXJuIG5ldyBQb2ludEQocHQyYS54LCBtMSAqIHB0MmEueCArIGIxKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnN0IG0xID0gKHB0MWIueSAtIHB0MWEueSkgLyAocHQxYi54IC0gcHQxYS54KTtcclxuICAgICAgY29uc3QgYjEgPSBwdDFhLnkgLSBtMSAqIHB0MWEueDtcclxuICAgICAgY29uc3QgbTIgPSAocHQyYi55IC0gcHQyYS55KSAvIChwdDJiLnggLSBwdDJhLngpO1xyXG4gICAgICBjb25zdCBiMiA9IHB0MmEueSAtIG0yICogcHQyYS54O1xyXG4gICAgICBpZiAoSW50ZXJuYWxDbGlwcGVyLmlzQWxtb3N0WmVybyhtMSAtIG0yKSkgcmV0dXJuIG5ldyBQb2ludEQoMCwgMCk7XHJcbiAgICAgIGNvbnN0IHggPSAoYjIgLSBiMSkgLyAobTEgLSBtMik7XHJcbiAgICAgIHJldHVybiBuZXcgUG9pbnREKHgsIG0xICogeCArIGIxKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ2V0UGVycGVuZGljKHB0OiBJUG9pbnQ2NCwgbm9ybTogUG9pbnREKTogUG9pbnQ2NCB7XHJcbiAgICByZXR1cm4gbmV3IFBvaW50NjQocHQueCArIG5vcm0ueCAqIHRoaXMuX2dyb3VwRGVsdGEsIHB0LnkgKyBub3JtLnkgKiB0aGlzLl9ncm91cERlbHRhKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZ2V0UGVycGVuZGljRChwdDogSVBvaW50NjQsIG5vcm06IFBvaW50RCk6IFBvaW50RCB7XHJcbiAgICByZXR1cm4gbmV3IFBvaW50RChwdC54ICsgbm9ybS54ICogdGhpcy5fZ3JvdXBEZWx0YSwgcHQueSArIG5vcm0ueSAqIHRoaXMuX2dyb3VwRGVsdGEpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBkb0JldmVsKGdyb3VwOiBHcm91cCwgcGF0aDogUGF0aDY0LCBqOiBudW1iZXIsIGs6IG51bWJlcikge1xyXG4gICAgbGV0IHB0MTogSVBvaW50NjQsIHB0MjogSVBvaW50NjRcclxuICAgIGlmIChqID09IGspIHtcclxuICAgICAgY29uc3QgYWJzRGVsdGEgPSBNYXRoLmFicyh0aGlzLl9ncm91cERlbHRhKTtcclxuICAgICAgcHQxID0gbmV3IFBvaW50NjQocGF0aFtqXS54IC0gYWJzRGVsdGEgKiB0aGlzLl9ub3JtYWxzW2pdLngsIHBhdGhbal0ueSAtIGFic0RlbHRhICogdGhpcy5fbm9ybWFsc1tqXS55KTtcclxuICAgICAgcHQyID0gbmV3IFBvaW50NjQocGF0aFtqXS54ICsgYWJzRGVsdGEgKiB0aGlzLl9ub3JtYWxzW2pdLngsIHBhdGhbal0ueSArIGFic0RlbHRhICogdGhpcy5fbm9ybWFsc1tqXS55KTtcclxuICAgIH1cclxuICAgIGVsc2Uge1xyXG4gICAgICBwdDEgPSBuZXcgUG9pbnQ2NChwYXRoW2pdLnggKyB0aGlzLl9ncm91cERlbHRhICogdGhpcy5fbm9ybWFsc1trXS54LCBwYXRoW2pdLnkgKyB0aGlzLl9ncm91cERlbHRhICogdGhpcy5fbm9ybWFsc1trXS55KTtcclxuICAgICAgcHQyID0gbmV3IFBvaW50NjQocGF0aFtqXS54ICsgdGhpcy5fZ3JvdXBEZWx0YSAqIHRoaXMuX25vcm1hbHNbal0ueCwgcGF0aFtqXS55ICsgdGhpcy5fZ3JvdXBEZWx0YSAqIHRoaXMuX25vcm1hbHNbal0ueSk7XHJcbiAgICB9XHJcbiAgICBncm91cC5vdXRQYXRoLnB1c2gocHQxKTtcclxuICAgIGdyb3VwLm91dFBhdGgucHVzaChwdDIpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBkb1NxdWFyZShncm91cDogR3JvdXAsIHBhdGg6IFBhdGg2NCwgajogbnVtYmVyLCBrOiBudW1iZXIpOiB2b2lkIHtcclxuICAgIGxldCB2ZWM6IFBvaW50RDtcclxuICAgIGlmIChqID09PSBrKSB7XHJcbiAgICAgIHZlYyA9IG5ldyBQb2ludEQodGhpcy5fbm9ybWFsc1tqXS55LCAtdGhpcy5fbm9ybWFsc1tqXS54KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHZlYyA9IENsaXBwZXJPZmZzZXQuZ2V0QXZnVW5pdFZlY3RvcihcclxuICAgICAgICBuZXcgUG9pbnREKC10aGlzLl9ub3JtYWxzW2tdLnksIHRoaXMuX25vcm1hbHNba10ueCksXHJcbiAgICAgICAgbmV3IFBvaW50RCh0aGlzLl9ub3JtYWxzW2pdLnksIC10aGlzLl9ub3JtYWxzW2pdLngpXHJcbiAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYWJzRGVsdGEgPSBNYXRoLmFicyh0aGlzLl9ncm91cERlbHRhKTtcclxuICAgIC8vIG5vdyBvZmZzZXQgdGhlIG9yaWdpbmFsIHZlcnRleCBkZWx0YSB1bml0cyBhbG9uZyB1bml0IHZlY3RvclxyXG4gICAgbGV0IHB0USA9IG5ldyBQb2ludEQocGF0aFtqXS54LCBwYXRoW2pdLnkpO1xyXG4gICAgcHRRID0gQ2xpcHBlck9mZnNldC50cmFuc2xhdGVQb2ludChwdFEsIGFic0RlbHRhICogdmVjLngsIGFic0RlbHRhICogdmVjLnkpO1xyXG5cclxuICAgIC8vIGdldCBwZXJwZW5kaWN1bGFyIHZlcnRpY2VzXHJcbiAgICBjb25zdCBwdDEgPSBDbGlwcGVyT2Zmc2V0LnRyYW5zbGF0ZVBvaW50KHB0USwgdGhpcy5fZ3JvdXBEZWx0YSAqIHZlYy55LCB0aGlzLl9ncm91cERlbHRhICogLXZlYy54KTtcclxuICAgIGNvbnN0IHB0MiA9IENsaXBwZXJPZmZzZXQudHJhbnNsYXRlUG9pbnQocHRRLCB0aGlzLl9ncm91cERlbHRhICogLXZlYy55LCB0aGlzLl9ncm91cERlbHRhICogdmVjLngpO1xyXG4gICAgLy8gZ2V0IDIgdmVydGljZXMgYWxvbmcgb25lIGVkZ2Ugb2Zmc2V0XHJcbiAgICBjb25zdCBwdDMgPSB0aGlzLmdldFBlcnBlbmRpY0QocGF0aFtrXSwgdGhpcy5fbm9ybWFsc1trXSk7XHJcblxyXG4gICAgaWYgKGogPT09IGspIHtcclxuICAgICAgY29uc3QgcHQ0ID0gbmV3IFBvaW50RChwdDMueCArIHZlYy54ICogdGhpcy5fZ3JvdXBEZWx0YSwgcHQzLnkgKyB2ZWMueSAqIHRoaXMuX2dyb3VwRGVsdGEpO1xyXG4gICAgICBjb25zdCBwdCA9IENsaXBwZXJPZmZzZXQuaW50ZXJzZWN0UG9pbnQocHQxLCBwdDIsIHB0MywgcHQ0KTtcclxuICAgICAgLy9nZXQgdGhlIHNlY29uZCBpbnRlcnNlY3QgcG9pbnQgdGhyb3VnaCByZWZsZWN0aW9uXHJcbiAgICAgIGdyb3VwLm91dFBhdGgucHVzaChuZXcgUG9pbnQ2NChDbGlwcGVyT2Zmc2V0LnJlZmxlY3RQb2ludChwdCwgcHRRKS54LCBDbGlwcGVyT2Zmc2V0LnJlZmxlY3RQb2ludChwdCwgcHRRKS55KSk7XHJcbiAgICAgIGdyb3VwLm91dFBhdGgucHVzaChuZXcgUG9pbnQ2NChwdC54LCBwdC55KSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBjb25zdCBwdDQgPSB0aGlzLmdldFBlcnBlbmRpY0QocGF0aFtqXSwgdGhpcy5fbm9ybWFsc1trXSk7XHJcbiAgICAgIGNvbnN0IHB0ID0gQ2xpcHBlck9mZnNldC5pbnRlcnNlY3RQb2ludChwdDEsIHB0MiwgcHQzLCBwdDQpO1xyXG4gICAgICBncm91cC5vdXRQYXRoLnB1c2gobmV3IFBvaW50NjQocHQueCwgcHQueSkpO1xyXG4gICAgICAvL2dldCB0aGUgc2Vjb25kIGludGVyc2VjdCBwb2ludCB0aHJvdWdoIHJlZmxlY3Rpb25cclxuICAgICAgZ3JvdXAub3V0UGF0aC5wdXNoKG5ldyBQb2ludDY0KENsaXBwZXJPZmZzZXQucmVmbGVjdFBvaW50KHB0LCBwdFEpLngsIENsaXBwZXJPZmZzZXQucmVmbGVjdFBvaW50KHB0LCBwdFEpLnkpKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgZG9NaXRlcihncm91cDogR3JvdXAsIHBhdGg6IFBhdGg2NCwgajogbnVtYmVyLCBrOiBudW1iZXIsIGNvc0E6IG51bWJlcik6IHZvaWQge1xyXG4gICAgY29uc3QgcSA9IHRoaXMuX2dyb3VwRGVsdGEgLyAoY29zQSArIDEpO1xyXG4gICAgZ3JvdXAub3V0UGF0aC5wdXNoKG5ldyBQb2ludDY0KFxyXG4gICAgICBwYXRoW2pdLnggKyAodGhpcy5fbm9ybWFsc1trXS54ICsgdGhpcy5fbm9ybWFsc1tqXS54KSAqIHEsXHJcbiAgICAgIHBhdGhbal0ueSArICh0aGlzLl9ub3JtYWxzW2tdLnkgKyB0aGlzLl9ub3JtYWxzW2pdLnkpICogcVxyXG4gICAgKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRvUm91bmQoZ3JvdXA6IEdyb3VwLCBwYXRoOiBQYXRoNjQsIGo6IG51bWJlciwgazogbnVtYmVyLCBhbmdsZTogbnVtYmVyKTogdm9pZCB7XHJcbiAgICBpZiAodHlwZW9mIHRoaXMuRGVsdGFDYWxsYmFjayAhPT0gXCJ1bmRlZmluZWRcIikge1xyXG4gICAgICBjb25zdCBhYnNEZWx0YSA9IE1hdGguYWJzKHRoaXMuX2dyb3VwRGVsdGEpO1xyXG4gICAgICBjb25zdCBhcmNUb2wgPSB0aGlzLkFyY1RvbGVyYW5jZSA+IDAuMDFcclxuICAgICAgICA/IHRoaXMuQXJjVG9sZXJhbmNlXHJcbiAgICAgICAgOiBNYXRoLmxvZzEwKDIgKyBhYnNEZWx0YSkgKiBJbnRlcm5hbENsaXBwZXIuZGVmYXVsdEFyY1RvbGVyYW5jZTtcclxuICAgICAgY29uc3Qgc3RlcHNQZXIzNjAgPSBNYXRoLlBJIC8gTWF0aC5hY29zKDEgLSBhcmNUb2wgLyBhYnNEZWx0YSk7XHJcbiAgICAgIHRoaXMuX3N0ZXBTaW4gPSBNYXRoLnNpbigoMiAqIE1hdGguUEkpIC8gc3RlcHNQZXIzNjApO1xyXG4gICAgICB0aGlzLl9zdGVwQ29zID0gTWF0aC5jb3MoKDIgKiBNYXRoLlBJKSAvIHN0ZXBzUGVyMzYwKTtcclxuICAgICAgaWYgKHRoaXMuX2dyb3VwRGVsdGEgPCAwLjApIHRoaXMuX3N0ZXBTaW4gPSAtdGhpcy5fc3RlcFNpbjtcclxuICAgICAgdGhpcy5fc3RlcHNQZXJSYWQgPSBzdGVwc1BlcjM2MCAvICgyICogTWF0aC5QSSk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcHQgPSBwYXRoW2pdO1xyXG4gICAgbGV0IG9mZnNldFZlYyA9IG5ldyBQb2ludEQodGhpcy5fbm9ybWFsc1trXS54ICogdGhpcy5fZ3JvdXBEZWx0YSwgdGhpcy5fbm9ybWFsc1trXS55ICogdGhpcy5fZ3JvdXBEZWx0YSk7XHJcbiAgICBpZiAoaiA9PT0gaykgb2Zmc2V0VmVjLm5lZ2F0ZSgpO1xyXG4gICAgZ3JvdXAub3V0UGF0aC5wdXNoKG5ldyBQb2ludDY0KHB0LnggKyBvZmZzZXRWZWMueCwgcHQueSArIG9mZnNldFZlYy55KSk7XHJcblxyXG4gICAgY29uc3Qgc3RlcHMgPSBNYXRoLmNlaWwodGhpcy5fc3RlcHNQZXJSYWQgKiBNYXRoLmFicyhhbmdsZSkpO1xyXG4gICAgZm9yIChsZXQgaSA9IDE7IGkgPCBzdGVwczsgaSsrKSB7XHJcbiAgICAgIG9mZnNldFZlYyA9IG5ldyBQb2ludEQoXHJcbiAgICAgICAgb2Zmc2V0VmVjLnggKiB0aGlzLl9zdGVwQ29zIC0gdGhpcy5fc3RlcFNpbiAqIG9mZnNldFZlYy55LFxyXG4gICAgICAgIG9mZnNldFZlYy54ICogdGhpcy5fc3RlcFNpbiArIG9mZnNldFZlYy55ICogdGhpcy5fc3RlcENvc1xyXG4gICAgICApO1xyXG4gICAgICBncm91cC5vdXRQYXRoLnB1c2gobmV3IFBvaW50NjQocHQueCArIG9mZnNldFZlYy54LCBwdC55ICsgb2Zmc2V0VmVjLnkpKTtcclxuICAgIH1cclxuICAgIGdyb3VwLm91dFBhdGgucHVzaCh0aGlzLmdldFBlcnBlbmRpYyhwdCwgdGhpcy5fbm9ybWFsc1tqXSkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBidWlsZE5vcm1hbHMocGF0aDogUGF0aDY0KTogdm9pZCB7XHJcbiAgICBjb25zdCBjbnQgPSBwYXRoLmxlbmd0aDtcclxuICAgIHRoaXMuX25vcm1hbHMgPSBbXTtcclxuICAgIHRoaXMuX25vcm1hbHMubGVuZ3RoID0gY250O1xyXG5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgY250IC0gMTsgaSsrKSB7XHJcbiAgICAgIHRoaXMuX25vcm1hbHNbaV0gPSBDbGlwcGVyT2Zmc2V0LmdldFVuaXROb3JtYWwocGF0aFtpXSwgcGF0aFtpICsgMV0pO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fbm9ybWFsc1tjbnQgLSAxXSA9IENsaXBwZXJPZmZzZXQuZ2V0VW5pdE5vcm1hbChwYXRoW2NudCAtIDFdLCBwYXRoWzBdKTtcclxuICB9XHJcblxyXG4gIGNyb3NzUHJvZHVjdCh2ZWMxOiBQb2ludEQsIHZlYzI6IFBvaW50RCk6IG51bWJlciB7XHJcbiAgICByZXR1cm4gKHZlYzEueSAqIHZlYzIueCAtIHZlYzIueSAqIHZlYzEueCk7XHJcbiAgfVxyXG5cclxuICBkb3RQcm9kdWN0KHZlYzE6IFBvaW50RCwgdmVjMjogUG9pbnREKTogbnVtYmVyIHtcclxuICAgIHJldHVybiAodmVjMS54ICogdmVjMi54ICsgdmVjMS55ICogdmVjMi55KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgb2Zmc2V0UG9pbnQoZ3JvdXA6IEdyb3VwLCBwYXRoOiBQYXRoNjQsIGo6IG51bWJlciwgazogbnVtYmVyKTogdm9pZCB7XHJcbiAgICBjb25zdCBzaW5BID0gdGhpcy5jcm9zc1Byb2R1Y3QodGhpcy5fbm9ybWFsc1tqXSwgdGhpcy5fbm9ybWFsc1trXSk7XHJcbiAgICBsZXQgY29zQSA9IHRoaXMuZG90UHJvZHVjdCh0aGlzLl9ub3JtYWxzW2pdLCB0aGlzLl9ub3JtYWxzW2tdKTtcclxuICAgIGlmIChzaW5BID4gMS4wKSBjb3NBID0gMS4wO1xyXG4gICAgZWxzZSBpZiAoc2luQSA8IC0xLjApIGNvc0EgPSAtMS4wO1xyXG5cclxuICAgIGlmICh0eXBlb2YgdGhpcy5EZWx0YUNhbGxiYWNrICE9PSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgIHRoaXMuX2dyb3VwRGVsdGEgPSB0aGlzLkRlbHRhQ2FsbGJhY2socGF0aCwgdGhpcy5fbm9ybWFscywgaiwgayk7XHJcbiAgICAgIGlmIChncm91cC5wYXRoc1JldmVyc2VkKSB0aGlzLl9ncm91cERlbHRhID0gLXRoaXMuX2dyb3VwRGVsdGE7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKE1hdGguYWJzKHRoaXMuX2dyb3VwRGVsdGEpIDwgQ2xpcHBlck9mZnNldC5Ub2xlcmFuY2UpIHtcclxuICAgICAgZ3JvdXAub3V0UGF0aC5wdXNoKHBhdGhbal0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGNvc0EgPiAtMC45OSAmJiAoc2luQSAqIHRoaXMuX2dyb3VwRGVsdGEgPCAwKSkgeyAvLyB0ZXN0IGZvciBjb25jYXZpdHkgZmlyc3QgKCM1OTMpXHJcbiAgICAgIC8vIGlzIGNvbmNhdmVcclxuICAgICAgZ3JvdXAub3V0UGF0aC5wdXNoKHRoaXMuZ2V0UGVycGVuZGljKHBhdGhbal0sIHRoaXMuX25vcm1hbHNba10pKTtcclxuICAgICAgLy8gdGhpcyBleHRyYSBwb2ludCBpcyB0aGUgb25seSAoc2ltcGxlKSB3YXkgdG8gZW5zdXJlIHRoYXRcclxuICAgICAgLy8gcGF0aCByZXZlcnNhbHMgYXJlIGZ1bGx5IGNsZWFuZWQgd2l0aCB0aGUgdHJhaWxpbmcgY2xpcHBlclxyXG4gICAgICBncm91cC5vdXRQYXRoLnB1c2gocGF0aFtqXSk7XHJcbiAgICAgIGdyb3VwLm91dFBhdGgucHVzaCh0aGlzLmdldFBlcnBlbmRpYyhwYXRoW2pdLCB0aGlzLl9ub3JtYWxzW2pdKSk7XHJcbiAgICB9IGVsc2UgaWYgKGNvc0EgPiAwLjk5OSkge1xyXG4gICAgICB0aGlzLmRvTWl0ZXIoZ3JvdXAsIHBhdGgsIGosIGssIGNvc0EpO1xyXG4gICAgfSBlbHNlIGlmICh0aGlzLl9qb2luVHlwZSA9PT0gSm9pblR5cGUuTWl0ZXIpIHtcclxuICAgICAgLy8gbWl0ZXIgdW5sZXNzIHRoZSBhbmdsZSBpcyBzbyBhY3V0ZSB0aGUgbWl0ZXIgd291bGQgZXhjZWVkcyBNTFxyXG4gICAgICBpZiAoY29zQSA+IHRoaXMuX21pdExpbVNxciAtIDEpIHtcclxuICAgICAgICB0aGlzLmRvTWl0ZXIoZ3JvdXAsIHBhdGgsIGosIGssIGNvc0EpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuZG9TcXVhcmUoZ3JvdXAsIHBhdGgsIGosIGspO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKGNvc0EgPiAwLjk5IHx8IHRoaXMuX2pvaW5UeXBlID09IEpvaW5UeXBlLkJldmVsKVxyXG4gICAgICAvL2FuZ2xlIGxlc3MgdGhhbiA4IGRlZ3JlZXMgb3IgYSBzcXVhcmVkIGpvaW5cclxuICAgICAgdGhpcy5kb0JldmVsKGdyb3VwLCBwYXRoLCBqLCBrKTtcclxuICAgIGVsc2UgaWYgKHRoaXMuX2pvaW5UeXBlID09IEpvaW5UeXBlLlJvdW5kKVxyXG4gICAgICB0aGlzLmRvUm91bmQoZ3JvdXAsIHBhdGgsIGosIGssIE1hdGguYXRhbjIoc2luQSwgY29zQSkpO1xyXG4gICAgZWxzZVxyXG4gICAgICB0aGlzLmRvU3F1YXJlKGdyb3VwLCBwYXRoLCBqLCBrKTtcclxuXHJcbiAgICBrID0gajtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgb2Zmc2V0UG9seWdvbihncm91cDogR3JvdXAsIHBhdGg6IFBhdGg2NCk6IHZvaWQge1xyXG4gICAgY29uc3QgYXJlYSA9IENsaXBwZXIuYXJlYShwYXRoKTtcclxuICAgIGlmICgoYXJlYSA8IDApICE9PSAodGhpcy5fZ3JvdXBEZWx0YSA8IDApKSB7XHJcbiAgICAgIGNvbnN0IHJlY3QgPSBDbGlwcGVyLmdldEJvdW5kcyhwYXRoKTtcclxuICAgICAgY29uc3Qgb2Zmc2V0TWluRGltID0gTWF0aC5hYnModGhpcy5fZ3JvdXBEZWx0YSkgKiAyO1xyXG4gICAgICBpZiAob2Zmc2V0TWluRGltID4gcmVjdC53aWR0aCB8fCBvZmZzZXRNaW5EaW0gPiByZWN0LmhlaWdodCkgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGdyb3VwLm91dFBhdGggPSBbXTtcclxuICAgIGNvbnN0IGNudCA9IHBhdGgubGVuZ3RoO1xyXG4gICAgY29uc3QgcHJldiA9IGNudCAtIDE7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGNudDsgaSsrKSB7XHJcbiAgICAgIHRoaXMub2Zmc2V0UG9pbnQoZ3JvdXAsIHBhdGgsIGksIHByZXYpO1xyXG4gICAgfVxyXG4gICAgZ3JvdXAub3V0UGF0aHMucHVzaChncm91cC5vdXRQYXRoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgb2Zmc2V0T3BlbkpvaW5lZChncm91cDogR3JvdXAsIHBhdGg6IFBhdGg2NCk6IHZvaWQge1xyXG4gICAgdGhpcy5vZmZzZXRQb2x5Z29uKGdyb3VwLCBwYXRoKTtcclxuICAgIHBhdGggPSBDbGlwcGVyLnJldmVyc2VQYXRoKHBhdGgpO1xyXG4gICAgdGhpcy5idWlsZE5vcm1hbHMocGF0aCk7XHJcbiAgICB0aGlzLm9mZnNldFBvbHlnb24oZ3JvdXAsIHBhdGgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvZmZzZXRPcGVuUGF0aChncm91cDogR3JvdXAsIHBhdGg6IFBhdGg2NCk6IHZvaWQge1xyXG4gICAgZ3JvdXAub3V0UGF0aCA9IFtdO1xyXG4gICAgY29uc3QgaGlnaEkgPSBwYXRoLmxlbmd0aCAtIDE7XHJcblxyXG4gICAgaWYgKHR5cGVvZiB0aGlzLkRlbHRhQ2FsbGJhY2sgIT09IFwidW5kZWZpbmVkXCIpIHtcclxuICAgICAgdGhpcy5fZ3JvdXBEZWx0YSA9IHRoaXMuRGVsdGFDYWxsYmFjayhwYXRoLCB0aGlzLl9ub3JtYWxzLCAwLCAwKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoTWF0aC5hYnModGhpcy5fZ3JvdXBEZWx0YSkgPCBDbGlwcGVyT2Zmc2V0LlRvbGVyYW5jZSkge1xyXG4gICAgICBncm91cC5vdXRQYXRoLnB1c2gocGF0aFswXSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBzd2l0Y2ggKHRoaXMuX2VuZFR5cGUpIHtcclxuICAgICAgICBjYXNlIEVuZFR5cGUuQnV0dDpcclxuICAgICAgICAgIHRoaXMuZG9CZXZlbChncm91cCwgcGF0aCwgMCwgMCk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEVuZFR5cGUuUm91bmQ6XHJcbiAgICAgICAgICB0aGlzLmRvUm91bmQoZ3JvdXAsIHBhdGgsIDAsIDAsIE1hdGguUEkpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgZGVmYXVsdDpcclxuICAgICAgICAgIHRoaXMuZG9TcXVhcmUoZ3JvdXAsIHBhdGgsIDAsIDApO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGxldCBpID0gMSwgayA9IDA7IGkgPCBoaWdoSTsgaSsrKSB7XHJcbiAgICAgIHRoaXMub2Zmc2V0UG9pbnQoZ3JvdXAsIHBhdGgsIGksIGspO1xyXG4gICAgfVxyXG5cclxuICAgIGZvciAobGV0IGkgPSBoaWdoSTsgaSA+IDA7IGktLSkge1xyXG4gICAgICB0aGlzLl9ub3JtYWxzW2ldID0gbmV3IFBvaW50RCgtdGhpcy5fbm9ybWFsc1tpIC0gMV0ueCwgLXRoaXMuX25vcm1hbHNbaSAtIDFdLnkpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5fbm9ybWFsc1swXSA9IHRoaXMuX25vcm1hbHNbaGlnaEldO1xyXG5cclxuICAgIGlmICh0eXBlb2YgdGhpcy5EZWx0YUNhbGxiYWNrICE9PSBcInVuZGVmaW5lZFwiKSB7XHJcbiAgICAgIHRoaXMuX2dyb3VwRGVsdGEgPSB0aGlzLkRlbHRhQ2FsbGJhY2socGF0aCwgdGhpcy5fbm9ybWFscywgaGlnaEksIGhpZ2hJKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoTWF0aC5hYnModGhpcy5fZ3JvdXBEZWx0YSkgPCBDbGlwcGVyT2Zmc2V0LlRvbGVyYW5jZSkge1xyXG4gICAgICBncm91cC5vdXRQYXRoLnB1c2gocGF0aFtoaWdoSV0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgc3dpdGNoICh0aGlzLl9lbmRUeXBlKSB7XHJcbiAgICAgICAgY2FzZSBFbmRUeXBlLkJ1dHQ6XHJcbiAgICAgICAgICB0aGlzLmRvQmV2ZWwoZ3JvdXAsIHBhdGgsIGhpZ2hJLCBoaWdoSSk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEVuZFR5cGUuUm91bmQ6XHJcbiAgICAgICAgICB0aGlzLmRvUm91bmQoZ3JvdXAsIHBhdGgsIGhpZ2hJLCBoaWdoSSwgTWF0aC5QSSk7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICBkZWZhdWx0OlxyXG4gICAgICAgICAgdGhpcy5kb1NxdWFyZShncm91cCwgcGF0aCwgaGlnaEksIGhpZ2hJKTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgZm9yIChsZXQgaSA9IGhpZ2hJLCBrID0gMDsgaSA+IDA7IGktLSkge1xyXG4gICAgICB0aGlzLm9mZnNldFBvaW50KGdyb3VwLCBwYXRoLCBpLCBrKTtcclxuICAgIH1cclxuXHJcbiAgICBncm91cC5vdXRQYXRocy5wdXNoKGdyb3VwLm91dFBhdGgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBkb0dyb3VwT2Zmc2V0KGdyb3VwOiBHcm91cCk6IHZvaWQge1xyXG4gICAgaWYgKGdyb3VwLmVuZFR5cGUgPT0gRW5kVHlwZS5Qb2x5Z29uKSB7XHJcblxyXG4gICAgICBjb25zdCB7IGluZGV4IH0gPSBDbGlwcGVyT2Zmc2V0LmdldEJvdW5kc0FuZExvd2VzdFBvbHlJZHgoZ3JvdXAuaW5QYXRocyk7XHJcblxyXG4gICAgICBpZiAoaW5kZXggPCAwKSByZXR1cm47XHJcblxyXG4gICAgICBjb25zdCBhcmVhID0gQ2xpcHBlci5hcmVhKGdyb3VwLmluUGF0aHNbaW5kZXhdKTtcclxuICAgICAgZ3JvdXAucGF0aHNSZXZlcnNlZCA9IGFyZWEgPCAwO1xyXG5cclxuICAgICAgaWYgKGdyb3VwLnBhdGhzUmV2ZXJzZWQpIHtcclxuICAgICAgICB0aGlzLl9ncm91cERlbHRhID0gLXRoaXMuX2RlbHRhO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuX2dyb3VwRGVsdGEgPSB0aGlzLl9kZWx0YTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgZ3JvdXAucGF0aHNSZXZlcnNlZCA9IGZhbHNlO1xyXG4gICAgICB0aGlzLl9ncm91cERlbHRhID0gTWF0aC5hYnModGhpcy5fZGVsdGEpICogMC41O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGFic0RlbHRhID0gTWF0aC5hYnModGhpcy5fZ3JvdXBEZWx0YSk7XHJcbiAgICB0aGlzLl9qb2luVHlwZSA9IGdyb3VwLmpvaW5UeXBlO1xyXG4gICAgdGhpcy5fZW5kVHlwZSA9IGdyb3VwLmVuZFR5cGU7XHJcblxyXG4gICAgaWYgKCF0aGlzLkRlbHRhQ2FsbGJhY2sgJiZcclxuICAgICAgKGdyb3VwLmpvaW5UeXBlID09IEpvaW5UeXBlLlJvdW5kIHx8IGdyb3VwLmVuZFR5cGUgPT0gRW5kVHlwZS5Sb3VuZCkpIHtcclxuICAgICAgY29uc3QgYXJjVG9sID0gdGhpcy5BcmNUb2xlcmFuY2UgPiAwLjAxXHJcbiAgICAgICAgPyB0aGlzLkFyY1RvbGVyYW5jZVxyXG4gICAgICAgIDogTWF0aC5sb2cxMCgyICsgYWJzRGVsdGEpICogSW50ZXJuYWxDbGlwcGVyLmRlZmF1bHRBcmNUb2xlcmFuY2U7XHJcblxyXG4gICAgICBjb25zdCBzdGVwc1BlcjM2MCA9IE1hdGguUEkgLyBNYXRoLmFjb3MoMSAtIGFyY1RvbCAvIGFic0RlbHRhKTtcclxuICAgICAgdGhpcy5fc3RlcFNpbiA9IE1hdGguc2luKCgyICogTWF0aC5QSSkgLyBzdGVwc1BlcjM2MCk7XHJcbiAgICAgIHRoaXMuX3N0ZXBDb3MgPSBNYXRoLmNvcygoMiAqIE1hdGguUEkpIC8gc3RlcHNQZXIzNjApO1xyXG5cclxuICAgICAgaWYgKHRoaXMuX2dyb3VwRGVsdGEgPCAwLjApIHtcclxuICAgICAgICB0aGlzLl9zdGVwU2luID0gLXRoaXMuX3N0ZXBTaW47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMuX3N0ZXBzUGVyUmFkID0gc3RlcHNQZXIzNjAgLyAoMiAqIE1hdGguUEkpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGlzSm9pbmVkID0gZ3JvdXAuZW5kVHlwZSA9PSBFbmRUeXBlLkpvaW5lZCB8fCBncm91cC5lbmRUeXBlID09IEVuZFR5cGUuUG9seWdvbjtcclxuXHJcbiAgICBmb3IgKGNvbnN0IHAgb2YgZ3JvdXAuaW5QYXRocykge1xyXG4gICAgICBjb25zdCBwYXRoID0gQ2xpcHBlci5zdHJpcER1cGxpY2F0ZXMocCwgaXNKb2luZWQpO1xyXG4gICAgICBjb25zdCBjbnQgPSBwYXRoLmxlbmd0aDtcclxuXHJcbiAgICAgIGlmIChjbnQgPT09IDAgfHwgKGNudCA8IDMgJiYgdGhpcy5fZW5kVHlwZSA9PSBFbmRUeXBlLlBvbHlnb24pKSB7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChjbnQgPT0gMSkge1xyXG4gICAgICAgIGdyb3VwLm91dFBhdGggPSBbXTtcclxuXHJcbiAgICAgICAgaWYgKGdyb3VwLmVuZFR5cGUgPT0gRW5kVHlwZS5Sb3VuZCkge1xyXG4gICAgICAgICAgY29uc3QgciA9IGFic0RlbHRhO1xyXG4gICAgICAgICAgY29uc3Qgc3RlcHMgPSBNYXRoLmNlaWwodGhpcy5fc3RlcHNQZXJSYWQgKiAyICogTWF0aC5QSSk7XHJcbiAgICAgICAgICBncm91cC5vdXRQYXRoID0gQ2xpcHBlci5lbGxpcHNlKHBhdGhbMF0sIHIsIHIsIHN0ZXBzKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgY29uc3QgZCA9IE1hdGguY2VpbCh0aGlzLl9ncm91cERlbHRhKTtcclxuICAgICAgICAgIGNvbnN0IHIgPSBuZXcgUmVjdDY0KHBhdGhbMF0ueCAtIGQsIHBhdGhbMF0ueSAtIGQsIHBhdGhbMF0ueCAtIGQsIHBhdGhbMF0ueSAtIGQpO1xyXG4gICAgICAgICAgZ3JvdXAub3V0UGF0aCA9IHIuYXNQYXRoKCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBncm91cC5vdXRQYXRocy5wdXNoKGdyb3VwLm91dFBhdGgpO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGlmIChjbnQgPT0gMiAmJiBncm91cC5lbmRUeXBlID09IEVuZFR5cGUuSm9pbmVkKSB7XHJcbiAgICAgICAgICBpZiAoZ3JvdXAuam9pblR5cGUgPT0gSm9pblR5cGUuUm91bmQpIHtcclxuICAgICAgICAgICAgdGhpcy5fZW5kVHlwZSA9IEVuZFR5cGUuUm91bmQ7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICB0aGlzLl9lbmRUeXBlID0gRW5kVHlwZS5TcXVhcmU7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB0aGlzLmJ1aWxkTm9ybWFscyhwYXRoKTtcclxuXHJcbiAgICAgICAgaWYgKHRoaXMuX2VuZFR5cGUgPT0gRW5kVHlwZS5Qb2x5Z29uKSB7XHJcbiAgICAgICAgICB0aGlzLm9mZnNldFBvbHlnb24oZ3JvdXAsIHBhdGgpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAodGhpcy5fZW5kVHlwZSA9PSBFbmRUeXBlLkpvaW5lZCkge1xyXG4gICAgICAgICAgdGhpcy5vZmZzZXRPcGVuSm9pbmVkKGdyb3VwLCBwYXRoKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgdGhpcy5vZmZzZXRPcGVuUGF0aChncm91cCwgcGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5fc29sdXRpb24ucHVzaCguLi5ncm91cC5vdXRQYXRocyk7XHJcbiAgICBncm91cC5vdXRQYXRocyA9IFtdO1xyXG4gIH1cclxufVxyXG4iXX0=