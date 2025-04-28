/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  16 July 2023                                                    *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2023                                         *
* Purpose   :  This module contains simple functions that will likely cover    *
*              most polygon boolean and offsetting needs, while also avoiding  *
*              the inherent complexities of the other modules.                 *
* Thanks    :  Special thanks to Thong Nguyen, Guus Kuiper, Phil Stopford,     *
*           :  and Daniel Gosnell for their invaluable assistance with C#.     *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
//
// Converted from C# implemention https://github.com/AngusJohnson/Clipper2/blob/main/CSharp/Clipper2Lib/Clipper.cs
// Removed support for USINGZ
//
// Converted by ChatGPT 4 August 3 version https://help.openai.com/en/articles/6825453-chatgpt-release-notes
//
import { ClipType, FillRule, InternalClipper, MidpointRounding, Path64, PathType, Paths64, Point64, Rect64, midPointRound } from "./core.mjs";
import { Clipper64 } from "./engine.mjs";
import { Minkowski } from "./minkowski.mjs";
import { ClipperOffset } from "./offset.mjs";
import { RectClip64, RectClipLines64 } from "./rectclip.mjs";
export class Clipper {
    static get InvalidRect64() {
        if (!Clipper.invalidRect64)
            Clipper.invalidRect64 = new Rect64(false);
        return this.invalidRect64;
    }
    static Intersect(subject, clip, fillRule) {
        return this.BooleanOp(ClipType.Intersection, subject, clip, fillRule);
    }
    static Union(subject, clip, fillRule = FillRule.EvenOdd) {
        return this.BooleanOp(ClipType.Union, subject, clip, fillRule);
    }
    static Difference(subject, clip, fillRule) {
        return this.BooleanOp(ClipType.Difference, subject, clip, fillRule);
    }
    static Xor(subject, clip, fillRule) {
        return this.BooleanOp(ClipType.Xor, subject, clip, fillRule);
    }
    static BooleanOp(clipType, subject, clip, fillRule = FillRule.EvenOdd) {
        const solution = new Paths64();
        if (!subject)
            return solution;
        const c = new Clipper64();
        c.addPaths(subject, PathType.Subject);
        if (clip)
            c.addPaths(clip, PathType.Clip);
        c.execute(clipType, fillRule, solution);
        return solution;
    }
    //public static BooleanOp(clipType: ClipType, subject: Paths64, clip: Paths64, polytree: PolyTree64, fillRule: FillRule): void {
    //  if (!subject) return;
    //  const c: Clipper64 = new Clipper64();
    //  c.addPaths(subject, PathType.Subject);
    //  if (clip)
    //    c.addPaths(clip, PathType.Clip);
    //  c.execute(clipType, fillRule, polytree);
    //}
    static InflatePaths(paths, delta, joinType, endType, miterLimit = 2.0) {
        const co = new ClipperOffset(miterLimit);
        co.addPaths(paths, joinType, endType);
        const solution = new Paths64();
        co.execute(delta, solution);
        return solution;
    }
    static RectClipPaths(rect, paths) {
        if (rect.isEmpty() || paths.length === 0)
            return new Paths64();
        const rc = new RectClip64(rect);
        return rc.execute(paths);
    }
    static RectClip(rect, path) {
        if (rect.isEmpty() || path.length === 0)
            return new Paths64();
        const tmp = new Paths64();
        tmp.push(path);
        return this.RectClipPaths(rect, tmp);
    }
    static RectClipLinesPaths(rect, paths) {
        if (rect.isEmpty() || paths.length === 0)
            return new Paths64();
        const rc = new RectClipLines64(rect);
        return rc.execute(paths);
    }
    static RectClipLines(rect, path) {
        if (rect.isEmpty() || path.length === 0)
            return new Paths64();
        const tmp = new Paths64();
        tmp.push(path);
        return this.RectClipLinesPaths(rect, tmp);
    }
    static MinkowskiSum(pattern, path, isClosed) {
        return Minkowski.sum(pattern, path, isClosed);
    }
    static MinkowskiDiff(pattern, path, isClosed) {
        return Minkowski.diff(pattern, path, isClosed);
    }
    static area(path) {
        // https://en.wikipedia.org/wiki/Shoelace_formula
        let a = 0.0;
        const cnt = path.length;
        if (cnt < 3)
            return 0.0;
        let prevPt = path[cnt - 1];
        for (const pt of path) {
            a += (prevPt.y + pt.y) * (prevPt.x - pt.x);
            prevPt = pt;
        }
        return a * 0.5;
    }
    static areaPaths(paths) {
        let a = 0.0;
        for (const path of paths)
            a += this.area(path);
        return a;
    }
    static isPositive(poly) {
        return this.area(poly) >= 0;
    }
    static path64ToString(path) {
        let result = "";
        for (const pt of path)
            result += pt.toString();
        return result + '\n';
    }
    static paths64ToString(paths) {
        let result = "";
        for (const path of paths)
            result += this.path64ToString(path);
        return result;
    }
    static offsetPath(path, dx, dy) {
        const result = new Path64();
        for (const pt of path)
            result.push(new Point64(pt.x + dx, pt.y + dy));
        return result;
    }
    static scalePoint64(pt, scale) {
        const result = new Point64(midPointRound(pt.x * scale, MidpointRounding.AwayFromZero), midPointRound(pt.y * scale, MidpointRounding.AwayFromZero));
        return result;
    }
    static scalePath(path, scale) {
        if (InternalClipper.isAlmostZero(scale - 1))
            return path;
        const result = [];
        for (const pt of path)
            result.push({ x: pt.x * scale, y: pt.y * scale });
        return result;
    }
    static scalePaths(paths, scale) {
        if (InternalClipper.isAlmostZero(scale - 1))
            return paths;
        const result = [];
        for (const path of paths)
            result.push(this.scalePath(path, scale));
        return result;
    }
    static translatePath(path, dx, dy) {
        const result = [];
        for (const pt of path) {
            result.push({ x: pt.x + dx, y: pt.y + dy });
        }
        return result;
    }
    static translatePaths(paths, dx, dy) {
        const result = [];
        for (const path of paths) {
            result.push(this.translatePath(path, dx, dy));
        }
        return result;
    }
    static reversePath(path) {
        return [...path].reverse();
    }
    static reversePaths(paths) {
        const result = [];
        for (const t of paths) {
            result.push(this.reversePath(t));
        }
        return result;
    }
    static getBounds(path) {
        const result = Clipper.InvalidRect64;
        for (const pt of path) {
            if (pt.x < result.left)
                result.left = pt.x;
            if (pt.x > result.right)
                result.right = pt.x;
            if (pt.y < result.top)
                result.top = pt.y;
            if (pt.y > result.bottom)
                result.bottom = pt.y;
        }
        return result.left === Number.MAX_SAFE_INTEGER ? new Rect64(0, 0, 0, 0) : result;
    }
    static getBoundsPaths(paths) {
        const result = Clipper.InvalidRect64;
        for (const path of paths) {
            for (const pt of path) {
                if (pt.x < result.left)
                    result.left = pt.x;
                if (pt.x > result.right)
                    result.right = pt.x;
                if (pt.y < result.top)
                    result.top = pt.y;
                if (pt.y > result.bottom)
                    result.bottom = pt.y;
            }
        }
        return result.left === Number.MAX_SAFE_INTEGER ? new Rect64(0, 0, 0, 0) : result;
    }
    static makePath(arr) {
        const len = arr.length / 2;
        const p = new Path64();
        for (let i = 0; i < len; i++)
            p.push(new Point64(arr[i * 2], arr[i * 2 + 1]));
        return p;
    }
    static stripDuplicates(path, isClosedPath) {
        const cnt = path.length;
        const result = new Path64();
        if (cnt === 0)
            return result;
        let lastPt = path[0];
        result.push(lastPt);
        for (let i = 1; i < cnt; i++)
            if (lastPt !== path[i]) {
                lastPt = path[i];
                result.push(lastPt);
            }
        if (isClosedPath && lastPt === result[0])
            result.pop();
        return result;
    }
    static addPolyNodeToPaths(polyPath, paths) {
        if (polyPath.polygon && polyPath.polygon.length > 0)
            paths.push(polyPath.polygon);
        for (let i = 0; i < polyPath.count; i++)
            this.addPolyNodeToPaths(polyPath.children[i], paths);
    }
    static polyTreeToPaths64(polyTree) {
        const result = new Paths64();
        for (let i = 0; i < polyTree.count; i++) {
            Clipper.addPolyNodeToPaths(polyTree.children[i], result);
        }
        return result;
    }
    static perpendicDistFromLineSqrd(pt, line1, line2) {
        const a = pt.x - line1.x;
        const b = pt.y - line1.y;
        const c = line2.x - line1.x;
        const d = line2.y - line1.y;
        if (c === 0 && d === 0)
            return 0;
        return Clipper.sqr(a * d - c * b) / (c * c + d * d);
    }
    static rdp(path, begin, end, epsSqrd, flags) {
        let idx = 0;
        let max_d = 0;
        while (end > begin && path[begin] === path[end]) {
            flags[end--] = false;
        }
        for (let i = begin + 1; i < end; i++) {
            const d = Clipper.perpendicDistFromLineSqrd(path[i], path[begin], path[end]);
            if (d <= max_d)
                continue;
            max_d = d;
            idx = i;
        }
        if (max_d <= epsSqrd)
            return;
        flags[idx] = true;
        if (idx > begin + 1)
            Clipper.rdp(path, begin, idx, epsSqrd, flags);
        if (idx < end - 1)
            Clipper.rdp(path, idx, end, epsSqrd, flags);
    }
    static ramerDouglasPeucker(path, epsilon) {
        const len = path.length;
        if (len < 5)
            return path;
        const flags = new Array(len).fill(false);
        flags[0] = true;
        flags[len - 1] = true;
        Clipper.rdp(path, 0, len - 1, Clipper.sqr(epsilon), flags);
        const result = [];
        for (let i = 0; i < len; i++) {
            if (flags[i])
                result.push(path[i]);
        }
        return result;
    }
    static ramerDouglasPeuckerPaths(paths, epsilon) {
        const result = [];
        for (const path of paths) {
            result.push(Clipper.ramerDouglasPeucker(path, epsilon));
        }
        return result;
    }
    static getNext(current, high, flags) {
        current++;
        while (current <= high && flags[current])
            current++;
        if (current <= high)
            return current;
        current = 0;
        while (flags[current])
            current++;
        return current;
    }
    static getPrior(current, high, flags) {
        if (current === 0)
            current = high;
        else
            current--;
        while (current > 0 && flags[current])
            current--;
        if (!flags[current])
            return current;
        current = high;
        while (flags[current])
            current--;
        return current;
    }
    static sqr(value) {
        return value * value;
    }
    static simplifyPath(path, epsilon, isClosedPath = false) {
        const len = path.length;
        const high = len - 1;
        const epsSqr = this.sqr(epsilon);
        if (len < 4)
            return path;
        const flags = new Array(len).fill(false);
        const dsq = new Array(len).fill(0);
        let prev = high;
        let curr = 0;
        let start, next, prior2, next2;
        if (isClosedPath) {
            dsq[0] = this.perpendicDistFromLineSqrd(path[0], path[high], path[1]);
            dsq[high] = this.perpendicDistFromLineSqrd(path[high], path[0], path[high - 1]);
        }
        else {
            dsq[0] = Number.MAX_VALUE;
            dsq[high] = Number.MAX_VALUE;
        }
        for (let i = 1; i < high; i++) {
            dsq[i] = this.perpendicDistFromLineSqrd(path[i], path[i - 1], path[i + 1]);
        }
        for (;;) {
            if (dsq[curr] > epsSqr) {
                start = curr;
                do {
                    curr = this.getNext(curr, high, flags);
                } while (curr !== start && dsq[curr] > epsSqr);
                if (curr === start)
                    break;
            }
            prev = this.getPrior(curr, high, flags);
            next = this.getNext(curr, high, flags);
            if (next === prev)
                break;
            if (dsq[next] < dsq[curr]) {
                flags[next] = true;
                next = this.getNext(next, high, flags);
                next2 = this.getNext(next, high, flags);
                dsq[curr] = this.perpendicDistFromLineSqrd(path[curr], path[prev], path[next]);
                if (next !== high || isClosedPath) {
                    dsq[next] = this.perpendicDistFromLineSqrd(path[next], path[curr], path[next2]);
                }
                curr = next;
            }
            else {
                flags[curr] = true;
                curr = next;
                next = this.getNext(next, high, flags);
                prior2 = this.getPrior(prev, high, flags);
                dsq[curr] = this.perpendicDistFromLineSqrd(path[curr], path[prev], path[next]);
                if (prev !== 0 || isClosedPath) {
                    dsq[prev] = this.perpendicDistFromLineSqrd(path[prev], path[prior2], path[curr]);
                }
            }
        }
        const result = [];
        for (let i = 0; i < len; i++) {
            if (!flags[i])
                result.push(path[i]);
        }
        return result;
    }
    static simplifyPaths(paths, epsilon, isClosedPaths = false) {
        const result = [];
        for (const path of paths) {
            result.push(this.simplifyPath(path, epsilon, isClosedPaths));
        }
        return result;
    }
    //private static getNext(current: number, high: number, flags: boolean[]): number {
    //  current++;
    //  while (current <= high && flags[current]) current++;
    //  return current;
    //}
    //private static getPrior(current: number, high: number, flags: boolean[]): number {
    //  if (current === 0) return high;
    //  current--;
    //  while (current > 0 && flags[current]) current--;
    //  return current;
    //}
    static trimCollinear(path, isOpen = false) {
        let len = path.length;
        let i = 0;
        if (!isOpen) {
            while (i < len - 1 && InternalClipper.crossProduct(path[len - 1], path[i], path[i + 1]) === 0)
                i++;
            while (i < len - 1 && InternalClipper.crossProduct(path[len - 2], path[len - 1], path[i]) === 0)
                len--;
        }
        if (len - i < 3) {
            if (!isOpen || len < 2 || path[0] === path[1]) {
                return [];
            }
            return path;
        }
        const result = [];
        let last = path[i];
        result.push(last);
        for (i++; i < len - 1; i++) {
            if (InternalClipper.crossProduct(last, path[i], path[i + 1]) === 0)
                continue;
            last = path[i];
            result.push(last);
        }
        if (isOpen) {
            result.push(path[len - 1]);
        }
        else if (InternalClipper.crossProduct(last, path[len - 1], result[0]) !== 0) {
            result.push(path[len - 1]);
        }
        else {
            while (result.length > 2 && InternalClipper.crossProduct(result[result.length - 1], result[result.length - 2], result[0]) === 0) {
                result.pop();
            }
            if (result.length < 3)
                result.splice(0, result.length);
        }
        return result;
    }
    static pointInPolygon(pt, polygon) {
        return InternalClipper.pointInPolygon(pt, polygon);
    }
    static ellipse(center, radiusX, radiusY = 0, steps = 0) {
        if (radiusX <= 0)
            return [];
        if (radiusY <= 0)
            radiusY = radiusX;
        if (steps <= 2)
            steps = Math.ceil(Math.PI * Math.sqrt((radiusX + radiusY) / 2));
        const si = Math.sin(2 * Math.PI / steps);
        const co = Math.cos(2 * Math.PI / steps);
        let dx = co, dy = si;
        const result = [{ x: center.x + radiusX, y: center.y }];
        for (let i = 1; i < steps; ++i) {
            result.push({ x: center.x + radiusX * dx, y: center.y + radiusY * dy });
            const x = dx * co - dy * si;
            dy = dy * co + dx * si;
            dx = x;
        }
        return result;
    }
    static showPolyPathStructure(pp, level) {
        const spaces = ' '.repeat(level * 2);
        const caption = pp.isHole ? "Hole " : "Outer ";
        if (pp.count === 0) {
            console.log(spaces + caption);
        }
        else {
            console.log(spaces + caption + `(${pp.count})`);
            pp.forEach(child => this.showPolyPathStructure(child, level + 1));
        }
    }
    static showPolyTreeStructure(polytree) {
        console.log("Polytree Root");
        polytree.forEach(child => this.showPolyPathStructure(child, 1));
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiY2xpcHBlci5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uL3Byb2plY3RzL2NsaXBwZXIyLWpzL3NyYy9saWIvY2xpcHBlci50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7Ozs7Ozs7Ozs7Z0ZBV2dGO0FBRWhGLEVBQUU7QUFDRixrSEFBa0g7QUFDbEgsNkJBQTZCO0FBQzdCLEVBQUU7QUFDRiw0R0FBNEc7QUFDNUcsRUFBRTtBQUVGLE9BQU8sRUFBRSxRQUFRLEVBQUUsUUFBUSxFQUFZLGVBQWUsRUFBRSxnQkFBZ0IsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxFQUFFLGFBQWEsRUFBRSxNQUFNLFFBQVEsQ0FBQztBQUNwSixPQUFPLEVBQUUsU0FBUyxFQUE4RCxNQUFNLFVBQVUsQ0FBQztBQUNqRyxPQUFPLEVBQUUsU0FBUyxFQUFFLE1BQU0sYUFBYSxDQUFDO0FBQ3hDLE9BQU8sRUFBRSxhQUFhLEVBQXFCLE1BQU0sVUFBVSxDQUFDO0FBQzVELE9BQU8sRUFBRSxVQUFVLEVBQUUsZUFBZSxFQUFFLE1BQU0sWUFBWSxDQUFDO0FBRXpELE1BQU0sT0FBTyxPQUFPO0lBR1gsTUFBTSxLQUFLLGFBQWE7UUFDN0IsSUFBSSxDQUFDLE9BQU8sQ0FBQyxhQUFhO1lBQUUsT0FBTyxDQUFDLGFBQWEsR0FBRyxJQUFJLE1BQU0sQ0FBQyxLQUFLLENBQUMsQ0FBQztRQUN0RSxPQUFPLElBQUksQ0FBQyxhQUFhLENBQUM7SUFDNUIsQ0FBQztJQUVNLE1BQU0sQ0FBQyxTQUFTLENBQUMsT0FBZ0IsRUFBRSxJQUFhLEVBQUUsUUFBa0I7UUFDekUsT0FBTyxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQyxZQUFZLEVBQUUsT0FBTyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsQ0FBQztJQUN4RSxDQUFDO0lBRU0sTUFBTSxDQUFDLEtBQUssQ0FBQyxPQUFnQixFQUFFLElBQWMsRUFB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QUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEtBQUssRUFBRSxLQUFLLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQztTQUNuRTtJQUNILENBQUM7SUFFTSxNQUFNLENBQUMscUJBQXFCLENBQUMsUUFBb0I7UUFDdEQsT0FBTyxDQUFDLEdBQUcsQ0FBQyxlQUFlLENBQUMsQ0FBQztRQUM3QixRQUFRLENBQUMsT0FBTyxDQUFDLEtBQUssQ0FBQyxFQUFFLENBQUMsSUFBSSxDQUFDLHFCQUFxQixDQUFDLEtBQUssRUFBRSxDQUFDLENBQUMsQ0FBQyxDQUFDO0lBQ2xFLENBQUM7Q0FFRiIsInNvdXJjZXNDb250ZW50IjpbIi8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXHJcbiogQXV0aG9yICAgIDogIEFuZ3VzIEpvaG5zb24gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbiogRGF0ZSAgICAgIDogIDE2IEp1bHkgMjAyMyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbiogV2Vic2l0ZSAgIDogIGh0dHA6Ly93d3cuYW5ndXNqLmNvbSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbiogQ29weXJpZ2h0IDogIEFuZ3VzIEpvaG5zb24gMjAxMC0yMDIzICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbiogUHVycG9zZSAgIDogIFRoaXMgbW9kdWxlIGNvbnRhaW5zIHNpbXBsZSBmdW5jdGlvbnMgdGhhdCB3aWxsIGxpa2VseSBjb3ZlciAgICAqXHJcbiogICAgICAgICAgICAgIG1vc3QgcG9seWdvbiBib29sZWFuIGFuZCBvZmZzZXR0aW5nIG5lZWRzLCB3aGlsZSBhbHNvIGF2b2lkaW5nICAqXHJcbiogICAgICAgICAgICAgIHRoZSBpbmhlcmVudCBjb21wbGV4aXRpZXMgb2YgdGhlIG90aGVyIG1vZHVsZXMuICAgICAgICAgICAgICAgICAqXHJcbiogVGhhbmtzICAgIDogIFNwZWNpYWwgdGhhbmtzIHRvIFRob25nIE5ndXllbiwgR3V1cyBLdWlwZXIsIFBoaWwgU3RvcGZvcmQsICAgICAqXHJcbiogICAgICAgICAgIDogIGFuZCBEYW5pZWwgR29zbmVsbCBmb3IgdGhlaXIgaW52YWx1YWJsZSBhc3Npc3RhbmNlIHdpdGggQyMuICAgICAqXHJcbiogTGljZW5zZSAgIDogIGh0dHA6Ly93d3cuYm9vc3Qub3JnL0xJQ0VOU0VfMV8wLnR4dCAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXHJcblxyXG4vL1xyXG4vLyBDb252ZXJ0ZWQgZnJvbSBDIyBpbXBsZW1lbnRpb24gaHR0cHM6Ly9naXRodWIuY29tL0FuZ3VzSm9obnNvbi9DbGlwcGVyMi9ibG9iL21haW4vQ1NoYXJwL0NsaXBwZXIyTGliL0NsaXBwZXIuY3NcclxuLy8gUmVtb3ZlZCBzdXBwb3J0IGZvciBVU0lOR1pcclxuLy9cclxuLy8gQ29udmVydGVkIGJ5IENoYXRHUFQgNCBBdWd1c3QgMyB2ZXJzaW9uIGh0dHBzOi8vaGVscC5vcGVuYWkuY29tL2VuL2FydGljbGVzLzY4MjU0NTMtY2hhdGdwdC1yZWxlYXNlLW5vdGVzXHJcbi8vXHJcblxyXG5pbXBvcnQgeyBDbGlwVHlwZSwgRmlsbFJ1bGUsIElQb2ludDY0LCBJbnRlcm5hbENsaXBwZXIsIE1pZHBvaW50Um91bmRpbmcsIFBhdGg2NCwgUGF0aFR5cGUsIFBhdGhzNjQsIFBvaW50NjQsIFJlY3Q2NCwgbWlkUG9pbnRSb3VuZCB9IGZyb20gXCIuL2NvcmVcIjtcclxuaW1wb3J0IHsgQ2xpcHBlcjY0LCBQb2ludEluUG9seWdvblJlc3VsdCwgUG9seVBhdGg2NCwgUG9seVBhdGhCYXNlLCBQb2x5VHJlZTY0IH0gZnJvbSBcIi4vZW5naW5lXCI7XHJcbmltcG9ydCB7IE1pbmtvd3NraSB9IGZyb20gXCIuL21pbmtvd3NraVwiO1xyXG5pbXBvcnQgeyBDbGlwcGVyT2Zmc2V0LCBFbmRUeXBlLCBKb2luVHlwZSB9IGZyb20gXCIuL29mZnNldFwiO1xyXG5pbXBvcnQgeyBSZWN0Q2xpcDY0LCBSZWN0Q2xpcExpbmVzNjQgfSBmcm9tIFwiLi9yZWN0Y2xpcFwiO1xyXG5cclxuZXhwb3J0IGNsYXNzIENsaXBwZXIge1xyXG5cclxuICBwcml2YXRlIHN0YXRpYyBpbnZhbGlkUmVjdDY0OiBSZWN0NjRcclxuICBwdWJsaWMgc3RhdGljIGdldCBJbnZhbGlkUmVjdDY0KCk6IFJlY3Q2NCB7XHJcbiAgICBpZiAoIUNsaXBwZXIuaW52YWxpZFJlY3Q2NCkgQ2xpcHBlci5pbnZhbGlkUmVjdDY0ID0gbmV3IFJlY3Q2NChmYWxzZSk7XHJcbiAgICByZXR1cm4gdGhpcy5pbnZhbGlkUmVjdDY0O1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBJbnRlcnNlY3Qoc3ViamVjdDogUGF0aHM2NCwgY2xpcDogUGF0aHM2NCwgZmlsbFJ1bGU6IEZpbGxSdWxlKTogUGF0aHM2NCB7XHJcbiAgICByZXR1cm4gdGhpcy5Cb29sZWFuT3AoQ2xpcFR5cGUuSW50ZXJzZWN0aW9uLCBzdWJqZWN0LCBjbGlwLCBmaWxsUnVsZSk7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIFVuaW9uKHN1YmplY3Q6IFBhdGhzNjQsIGNsaXA/OiBQYXRoczY0LCBmaWxsUnVsZSA9IEZpbGxSdWxlLkV2ZW5PZGQpOiBQYXRoczY0IHtcclxuICAgIHJldHVybiB0aGlzLkJvb2xlYW5PcChDbGlwVHlwZS5Vbmlvbiwgc3ViamVjdCwgY2xpcCwgZmlsbFJ1bGUpO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBEaWZmZXJlbmNlKHN1YmplY3Q6IFBhdGhzNjQsIGNsaXA6IFBhdGhzNjQsIGZpbGxSdWxlOiBGaWxsUnVsZSk6IFBhdGhzNjQge1xyXG4gICAgcmV0dXJuIHRoaXMuQm9vbGVhbk9wKENsaXBUeXBlLkRpZmZlcmVuY2UsIHN1YmplY3QsIGNsaXAsIGZpbGxSdWxlKTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgWG9yKHN1YmplY3Q6IFBhdGhzNjQsIGNsaXA6IFBhdGhzNjQsIGZpbGxSdWxlOiBGaWxsUnVsZSk6IFBhdGhzNjQge1xyXG4gICAgcmV0dXJuIHRoaXMuQm9vbGVhbk9wKENsaXBUeXBlLlhvciwgc3ViamVjdCwgY2xpcCwgZmlsbFJ1bGUpO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBCb29sZWFuT3AoY2xpcFR5cGU6IENsaXBUeXBlLCBzdWJqZWN0PzogUGF0aHM2NCwgY2xpcD86IFBhdGhzNjQsIGZpbGxSdWxlID0gRmlsbFJ1bGUuRXZlbk9kZCk6IFBhdGhzNjQge1xyXG4gICAgY29uc3Qgc29sdXRpb246IFBhdGhzNjQgPSBuZXcgUGF0aHM2NCgpO1xyXG4gICAgaWYgKCFzdWJqZWN0KSByZXR1cm4gc29sdXRpb247XHJcbiAgICBjb25zdCBjOiBDbGlwcGVyNjQgPSBuZXcgQ2xpcHBlcjY0KCk7XHJcbiAgICBjLmFkZFBhdGhzKHN1YmplY3QsIFBhdGhUeXBlLlN1YmplY3QpO1xyXG4gICAgaWYgKGNsaXApXHJcbiAgICAgIGMuYWRkUGF0aHMoY2xpcCwgUGF0aFR5cGUuQ2xpcCk7XHJcbiAgICBjLmV4ZWN1dGUoY2xpcFR5cGUsIGZpbGxSdWxlLCBzb2x1dGlvbik7XHJcbiAgICByZXR1cm4gc29sdXRpb247XHJcbiAgfVxyXG5cclxuICAvL3B1YmxpYyBzdGF0aWMgQm9vbGVhbk9wKGNsaXBUeXBlOiBDbGlwVHlwZSwgc3ViamVjdDogUGF0aHM2NCwgY2xpcDogUGF0aHM2NCwgcG9seXRyZWU6IFBvbHlUcmVlNjQsIGZpbGxSdWxlOiBGaWxsUnVsZSk6IHZvaWQge1xyXG4gIC8vICBpZiAoIXN1YmplY3QpIHJldHVybjtcclxuICAvLyAgY29uc3QgYzogQ2xpcHBlcjY0ID0gbmV3IENsaXBwZXI2NCgpO1xyXG4gIC8vICBjLmFkZFBhdGhzKHN1YmplY3QsIFBhdGhUeXBlLlN1YmplY3QpO1xyXG4gIC8vICBpZiAoY2xpcClcclxuICAvLyAgICBjLmFkZFBhdGhzKGNsaXAsIFBhdGhUeXBlLkNsaXApO1xyXG4gIC8vICBjLmV4ZWN1dGUoY2xpcFR5cGUsIGZpbGxSdWxlLCBwb2x5dHJlZSk7XHJcbiAgLy99XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgSW5mbGF0ZVBhdGhzKHBhdGhzOiBQYXRoczY0LCBkZWx0YTogbnVtYmVyLCBqb2luVHlwZTogSm9pblR5cGUsIGVuZFR5cGU6IEVuZFR5cGUsIG1pdGVyTGltaXQ6IG51bWJlciA9IDIuMCk6IFBhdGhzNjQge1xyXG4gICAgY29uc3QgY286IENsaXBwZXJPZmZzZXQgPSBuZXcgQ2xpcHBlck9mZnNldChtaXRlckxpbWl0KTtcclxuICAgIGNvLmFkZFBhdGhzKHBhdGhzLCBqb2luVHlwZSwgZW5kVHlwZSk7XHJcbiAgICBjb25zdCBzb2x1dGlvbjogUGF0aHM2NCA9IG5ldyBQYXRoczY0KCk7XHJcbiAgICBjby5leGVjdXRlKGRlbHRhLCBzb2x1dGlvbik7XHJcbiAgICByZXR1cm4gc29sdXRpb247XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIFJlY3RDbGlwUGF0aHMocmVjdDogUmVjdDY0LCBwYXRoczogUGF0aHM2NCk6IFBhdGhzNjQge1xyXG4gICAgaWYgKHJlY3QuaXNFbXB0eSgpIHx8IHBhdGhzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIG5ldyBQYXRoczY0KCk7XHJcbiAgICBjb25zdCByYyA9IG5ldyBSZWN0Q2xpcDY0KHJlY3QpO1xyXG4gICAgcmV0dXJuIHJjLmV4ZWN1dGUocGF0aHMpO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBSZWN0Q2xpcChyZWN0OiBSZWN0NjQsIHBhdGg6IFBhdGg2NCk6IFBhdGhzNjQge1xyXG4gICAgaWYgKHJlY3QuaXNFbXB0eSgpIHx8IHBhdGgubGVuZ3RoID09PSAwKSByZXR1cm4gbmV3IFBhdGhzNjQoKTtcclxuICAgIGNvbnN0IHRtcDogUGF0aHM2NCA9IG5ldyBQYXRoczY0KCk7XHJcbiAgICB0bXAucHVzaChwYXRoKTtcclxuICAgIHJldHVybiB0aGlzLlJlY3RDbGlwUGF0aHMocmVjdCwgdG1wKTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgUmVjdENsaXBMaW5lc1BhdGhzKHJlY3Q6IFJlY3Q2NCwgcGF0aHM6IFBhdGhzNjQpOiBQYXRoczY0IHtcclxuICAgIGlmIChyZWN0LmlzRW1wdHkoKSB8fCBwYXRocy5sZW5ndGggPT09IDApIHJldHVybiBuZXcgUGF0aHM2NCgpO1xyXG4gICAgY29uc3QgcmMgPSBuZXcgUmVjdENsaXBMaW5lczY0KHJlY3QpO1xyXG4gICAgcmV0dXJuIHJjLmV4ZWN1dGUocGF0aHMpO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBSZWN0Q2xpcExpbmVzKHJlY3Q6IFJlY3Q2NCwgcGF0aDogUGF0aDY0KTogUGF0aHM2NCB7XHJcbiAgICBpZiAocmVjdC5pc0VtcHR5KCkgfHwgcGF0aC5sZW5ndGggPT09IDApIHJldHVybiBuZXcgUGF0aHM2NCgpO1xyXG4gICAgY29uc3QgdG1wOiBQYXRoczY0ID0gbmV3IFBhdGhzNjQoKTtcclxuICAgIHRtcC5wdXNoKHBhdGgpO1xyXG4gICAgcmV0dXJuIHRoaXMuUmVjdENsaXBMaW5lc1BhdGhzKHJlY3QsIHRtcCk7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIE1pbmtvd3NraVN1bShwYXR0ZXJuOiBQYXRoNjQsIHBhdGg6IFBhdGg2NCwgaXNDbG9zZWQ6IGJvb2xlYW4pOiBQYXRoczY0IHtcclxuICAgIHJldHVybiBNaW5rb3dza2kuc3VtKHBhdHRlcm4sIHBhdGgsIGlzQ2xvc2VkKTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgTWlua293c2tpRGlmZihwYXR0ZXJuOiBQYXRoNjQsIHBhdGg6IFBhdGg2NCwgaXNDbG9zZWQ6IGJvb2xlYW4pOiBQYXRoczY0IHtcclxuICAgIHJldHVybiBNaW5rb3dza2kuZGlmZihwYXR0ZXJuLCBwYXRoLCBpc0Nsb3NlZCk7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIGFyZWEocGF0aDogUGF0aDY0KTogbnVtYmVyIHtcclxuICAgIC8vIGh0dHBzOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL1Nob2VsYWNlX2Zvcm11bGFcclxuICAgIGxldCBhID0gMC4wO1xyXG4gICAgY29uc3QgY250ID0gcGF0aC5sZW5ndGg7XHJcbiAgICBpZiAoY250IDwgMykgcmV0dXJuIDAuMDtcclxuICAgIGxldCBwcmV2UHQgPSBwYXRoW2NudCAtIDFdO1xyXG4gICAgZm9yIChjb25zdCBwdCBvZiBwYXRoKSB7XHJcbiAgICAgIGEgKz0gKHByZXZQdC55ICsgcHQueSkgKiAocHJldlB0LnggLSBwdC54KTtcclxuICAgICAgcHJldlB0ID0gcHQ7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYSAqIDAuNTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgYXJlYVBhdGhzKHBhdGhzOiBQYXRoczY0KTogbnVtYmVyIHtcclxuICAgIGxldCBhID0gMC4wO1xyXG4gICAgZm9yIChjb25zdCBwYXRoIG9mIHBhdGhzKVxyXG4gICAgICBhICs9IHRoaXMuYXJlYShwYXRoKTtcclxuICAgIHJldHVybiBhO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBpc1Bvc2l0aXZlKHBvbHk6IFBhdGg2NCk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHRoaXMuYXJlYShwb2x5KSA+PSAwO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBwYXRoNjRUb1N0cmluZyhwYXRoOiBQYXRoNjQpOiBzdHJpbmcge1xyXG4gICAgbGV0IHJlc3VsdCA9IFwiXCI7XHJcbiAgICBmb3IgKGNvbnN0IHB0IG9mIHBhdGgpXHJcbiAgICAgIHJlc3VsdCArPSBwdC50b1N0cmluZygpO1xyXG4gICAgcmV0dXJuIHJlc3VsdCArICdcXG4nO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBwYXRoczY0VG9TdHJpbmcocGF0aHM6IFBhdGhzNjQpOiBzdHJpbmcge1xyXG4gICAgbGV0IHJlc3VsdCA9IFwiXCI7XHJcbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgcGF0aHMpXHJcbiAgICAgIHJlc3VsdCArPSB0aGlzLnBhdGg2NFRvU3RyaW5nKHBhdGgpO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgb2Zmc2V0UGF0aChwYXRoOiBQYXRoNjQsIGR4OiBudW1iZXIsIGR5OiBudW1iZXIpOiBQYXRoNjQge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gbmV3IFBhdGg2NCgpO1xyXG4gICAgZm9yIChjb25zdCBwdCBvZiBwYXRoKVxyXG4gICAgICByZXN1bHQucHVzaChuZXcgUG9pbnQ2NChwdC54ICsgZHgsIHB0LnkgKyBkeSkpO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgc2NhbGVQb2ludDY0KHB0OiBQb2ludDY0LCBzY2FsZTogbnVtYmVyKTogUG9pbnQ2NCB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBuZXcgUG9pbnQ2NChcclxuICAgICAgbWlkUG9pbnRSb3VuZChwdC54ICogc2NhbGUsIE1pZHBvaW50Um91bmRpbmcuQXdheUZyb21aZXJvKSxcclxuICAgICAgbWlkUG9pbnRSb3VuZChwdC55ICogc2NhbGUsIE1pZHBvaW50Um91bmRpbmcuQXdheUZyb21aZXJvKVxyXG4gICAgKVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgc2NhbGVQYXRoKHBhdGg6IFBhdGg2NCwgc2NhbGU6IG51bWJlcik6IFBhdGg2NCB7XHJcbiAgICBpZiAoSW50ZXJuYWxDbGlwcGVyLmlzQWxtb3N0WmVybyhzY2FsZSAtIDEpKSByZXR1cm4gcGF0aDtcclxuICAgIGNvbnN0IHJlc3VsdDogUGF0aDY0ID0gW107XHJcbiAgICBmb3IgKGNvbnN0IHB0IG9mIHBhdGgpXHJcbiAgICAgIHJlc3VsdC5wdXNoKHsgeDogcHQueCAqIHNjYWxlLCB5OiBwdC55ICogc2NhbGUgfSk7XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBzY2FsZVBhdGhzKHBhdGhzOiBQYXRoczY0LCBzY2FsZTogbnVtYmVyKTogUGF0aHM2NCB7XHJcbiAgICBpZiAoSW50ZXJuYWxDbGlwcGVyLmlzQWxtb3N0WmVybyhzY2FsZSAtIDEpKSByZXR1cm4gcGF0aHM7XHJcbiAgICBjb25zdCByZXN1bHQ6IFBhdGhzNjQgPSBbXTtcclxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwYXRocylcclxuICAgICAgcmVzdWx0LnB1c2godGhpcy5zY2FsZVBhdGgocGF0aCwgc2NhbGUpKTtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIHRyYW5zbGF0ZVBhdGgocGF0aDogUGF0aDY0LCBkeDogbnVtYmVyLCBkeTogbnVtYmVyKTogUGF0aDY0IHtcclxuICAgIGNvbnN0IHJlc3VsdDogUGF0aDY0ID0gW107XHJcbiAgICBmb3IgKGNvbnN0IHB0IG9mIHBhdGgpIHtcclxuICAgICAgcmVzdWx0LnB1c2goeyB4OiBwdC54ICsgZHgsIHk6IHB0LnkgKyBkeSB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIHRyYW5zbGF0ZVBhdGhzKHBhdGhzOiBQYXRoczY0LCBkeDogbnVtYmVyLCBkeTogbnVtYmVyKTogUGF0aHM2NCB7XHJcbiAgICBjb25zdCByZXN1bHQ6IFBhdGhzNjQgPSBbXTtcclxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwYXRocykge1xyXG4gICAgICByZXN1bHQucHVzaCh0aGlzLnRyYW5zbGF0ZVBhdGgocGF0aCwgZHgsIGR5KSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyByZXZlcnNlUGF0aChwYXRoOiBQYXRoNjQpOiBQYXRoNjQge1xyXG4gICAgcmV0dXJuIFsuLi5wYXRoXS5yZXZlcnNlKCk7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIHJldmVyc2VQYXRocyhwYXRoczogUGF0aHM2NCk6IFBhdGhzNjQge1xyXG4gICAgY29uc3QgcmVzdWx0OiBQYXRoczY0ID0gW107XHJcbiAgICBmb3IgKGNvbnN0IHQgb2YgcGF0aHMpIHtcclxuICAgICAgcmVzdWx0LnB1c2godGhpcy5yZXZlcnNlUGF0aCh0KSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBnZXRCb3VuZHMocGF0aDogUGF0aDY0KTogUmVjdDY0IHtcclxuICAgIGNvbnN0IHJlc3VsdDogUmVjdDY0ID0gQ2xpcHBlci5JbnZhbGlkUmVjdDY0O1xyXG4gICAgZm9yIChjb25zdCBwdCBvZiBwYXRoKSB7XHJcbiAgICAgIGlmIChwdC54IDwgcmVzdWx0LmxlZnQpIHJlc3VsdC5sZWZ0ID0gcHQueDtcclxuICAgICAgaWYgKHB0LnggPiByZXN1bHQucmlnaHQpIHJlc3VsdC5yaWdodCA9IHB0Lng7XHJcbiAgICAgIGlmIChwdC55IDwgcmVzdWx0LnRvcCkgcmVzdWx0LnRvcCA9IHB0Lnk7XHJcbiAgICAgIGlmIChwdC55ID4gcmVzdWx0LmJvdHRvbSkgcmVzdWx0LmJvdHRvbSA9IHB0Lnk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0LmxlZnQgPT09IE51bWJlci5NQVhfU0FGRV9JTlRFR0VSID8gbmV3IFJlY3Q2NCgwLCAwLCAwLCAwKSA6IHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgZ2V0Qm91bmRzUGF0aHMocGF0aHM6IFBhdGhzNjQpOiBSZWN0NjQge1xyXG4gICAgY29uc3QgcmVzdWx0OiBSZWN0NjQgPSBDbGlwcGVyLkludmFsaWRSZWN0NjQ7XHJcbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgcGF0aHMpIHtcclxuICAgICAgZm9yIChjb25zdCBwdCBvZiBwYXRoKSB7XHJcbiAgICAgICAgaWYgKHB0LnggPCByZXN1bHQubGVmdCkgcmVzdWx0LmxlZnQgPSBwdC54O1xyXG4gICAgICAgIGlmIChwdC54ID4gcmVzdWx0LnJpZ2h0KSByZXN1bHQucmlnaHQgPSBwdC54O1xyXG4gICAgICAgIGlmIChwdC55IDwgcmVzdWx0LnRvcCkgcmVzdWx0LnRvcCA9IHB0Lnk7XHJcbiAgICAgICAgaWYgKHB0LnkgPiByZXN1bHQuYm90dG9tKSByZXN1bHQuYm90dG9tID0gcHQueTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdC5sZWZ0ID09PSBOdW1iZXIuTUFYX1NBRkVfSU5URUdFUiA/IG5ldyBSZWN0NjQoMCwgMCwgMCwgMCkgOiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgbWFrZVBhdGgoYXJyOiBudW1iZXJbXSk6IFBhdGg2NCB7XHJcbiAgICBjb25zdCBsZW4gPSBhcnIubGVuZ3RoIC8gMjtcclxuICAgIGNvbnN0IHAgPSBuZXcgUGF0aDY0KCk7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IGxlbjsgaSsrKVxyXG4gICAgICBwLnB1c2gobmV3IFBvaW50NjQoYXJyW2kgKiAyXSwgYXJyW2kgKiAyICsgMV0pKTtcclxuICAgIHJldHVybiBwO1xyXG4gIH1cclxuXHJcbiAgc3RhdGljIHN0cmlwRHVwbGljYXRlcyhwYXRoOiBQYXRoNjQsIGlzQ2xvc2VkUGF0aDogYm9vbGVhbik6IFBhdGg2NCB7XHJcbiAgICBjb25zdCBjbnQgPSBwYXRoLmxlbmd0aDtcclxuICAgIGNvbnN0IHJlc3VsdCA9IG5ldyBQYXRoNjQoKTtcclxuICAgIGlmIChjbnQgPT09IDApIHJldHVybiByZXN1bHQ7XHJcbiAgICBsZXQgbGFzdFB0ID0gcGF0aFswXTtcclxuICAgIHJlc3VsdC5wdXNoKGxhc3RQdCk7XHJcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8IGNudDsgaSsrKVxyXG4gICAgICBpZiAobGFzdFB0ICE9PSBwYXRoW2ldKSB7XHJcbiAgICAgICAgbGFzdFB0ID0gcGF0aFtpXTtcclxuICAgICAgICByZXN1bHQucHVzaChsYXN0UHQpO1xyXG4gICAgICB9XHJcbiAgICBpZiAoaXNDbG9zZWRQYXRoICYmIGxhc3RQdCA9PT0gcmVzdWx0WzBdKVxyXG4gICAgICByZXN1bHQucG9wKCk7XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgYWRkUG9seU5vZGVUb1BhdGhzKHBvbHlQYXRoOiBQb2x5UGF0aEJhc2UsIHBhdGhzOiBQYXRoczY0KTogdm9pZCB7XHJcbiAgICBpZiAocG9seVBhdGgucG9seWdvbiAmJiBwb2x5UGF0aC5wb2x5Z29uLmxlbmd0aCA+IDApXHJcbiAgICAgIHBhdGhzLnB1c2gocG9seVBhdGgucG9seWdvbik7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBvbHlQYXRoLmNvdW50OyBpKyspXHJcbiAgICAgIHRoaXMuYWRkUG9seU5vZGVUb1BhdGhzKHBvbHlQYXRoLmNoaWxkcmVuW2ldLCBwYXRocyk7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIHBvbHlUcmVlVG9QYXRoczY0KHBvbHlUcmVlOiBQb2x5VHJlZTY0KTogUGF0aHM2NCB7XHJcbiAgICBjb25zdCByZXN1bHQ6IFBhdGhzNjQgPSBuZXcgUGF0aHM2NCgpO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwb2x5VHJlZS5jb3VudDsgaSsrKSB7XHJcbiAgICAgIENsaXBwZXIuYWRkUG9seU5vZGVUb1BhdGhzKHBvbHlUcmVlLmNoaWxkcmVuW2ldIGFzIFBvbHlQYXRoNjQsIHJlc3VsdCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBwZXJwZW5kaWNEaXN0RnJvbUxpbmVTcXJkKHB0OiBJUG9pbnQ2NCwgbGluZTE6IElQb2ludDY0LCBsaW5lMjogSVBvaW50NjQpOiBudW1iZXIge1xyXG4gICAgY29uc3QgYSA9IHB0LnggLSBsaW5lMS54O1xyXG4gICAgY29uc3QgYiA9IHB0LnkgLSBsaW5lMS55O1xyXG4gICAgY29uc3QgYyA9IGxpbmUyLnggLSBsaW5lMS54O1xyXG4gICAgY29uc3QgZCA9IGxpbmUyLnkgLSBsaW5lMS55O1xyXG4gICAgaWYgKGMgPT09IDAgJiYgZCA9PT0gMCkgcmV0dXJuIDA7XHJcbiAgICByZXR1cm4gQ2xpcHBlci5zcXIoYSAqIGQgLSBjICogYikgLyAoYyAqIGMgKyBkICogZCk7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgcmRwKHBhdGg6IFBhdGg2NCwgYmVnaW46IG51bWJlciwgZW5kOiBudW1iZXIsIGVwc1NxcmQ6IG51bWJlciwgZmxhZ3M6IGJvb2xlYW5bXSk6IHZvaWQge1xyXG4gICAgbGV0IGlkeCA9IDA7XHJcbiAgICBsZXQgbWF4X2QgPSAwO1xyXG5cclxuICAgIHdoaWxlIChlbmQgPiBiZWdpbiAmJiBwYXRoW2JlZ2luXSA9PT0gcGF0aFtlbmRdKSB7XHJcbiAgICAgIGZsYWdzW2VuZC0tXSA9IGZhbHNlO1xyXG4gICAgfVxyXG4gICAgZm9yIChsZXQgaSA9IGJlZ2luICsgMTsgaSA8IGVuZDsgaSsrKSB7XHJcbiAgICAgIGNvbnN0IGQgPSBDbGlwcGVyLnBlcnBlbmRpY0Rpc3RGcm9tTGluZVNxcmQocGF0aFtpXSwgcGF0aFtiZWdpbl0sIHBhdGhbZW5kXSk7XHJcbiAgICAgIGlmIChkIDw9IG1heF9kKSBjb250aW51ZTtcclxuICAgICAgbWF4X2QgPSBkO1xyXG4gICAgICBpZHggPSBpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtYXhfZCA8PSBlcHNTcXJkKSByZXR1cm47XHJcblxyXG4gICAgZmxhZ3NbaWR4XSA9IHRydWU7XHJcbiAgICBpZiAoaWR4ID4gYmVnaW4gKyAxKSBDbGlwcGVyLnJkcChwYXRoLCBiZWdpbiwgaWR4LCBlcHNTcXJkLCBmbGFncyk7XHJcbiAgICBpZiAoaWR4IDwgZW5kIC0gMSkgQ2xpcHBlci5yZHAocGF0aCwgaWR4LCBlbmQsIGVwc1NxcmQsIGZsYWdzKTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgcmFtZXJEb3VnbGFzUGV1Y2tlcihwYXRoOiBQYXRoNjQsIGVwc2lsb246IG51bWJlcik6IFBhdGg2NCB7XHJcbiAgICBjb25zdCBsZW4gPSBwYXRoLmxlbmd0aDtcclxuICAgIGlmIChsZW4gPCA1KSByZXR1cm4gcGF0aDtcclxuXHJcbiAgICBjb25zdCBmbGFncyA9IG5ldyBBcnJheTxib29sZWFuPihsZW4pLmZpbGwoZmFsc2UpO1xyXG4gICAgZmxhZ3NbMF0gPSB0cnVlO1xyXG4gICAgZmxhZ3NbbGVuIC0gMV0gPSB0cnVlO1xyXG4gICAgQ2xpcHBlci5yZHAocGF0aCwgMCwgbGVuIC0gMSwgQ2xpcHBlci5zcXIoZXBzaWxvbiksIGZsYWdzKTtcclxuXHJcbiAgICBjb25zdCByZXN1bHQ6IFBhdGg2NCA9IFtdO1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCBsZW47IGkrKykge1xyXG4gICAgICBpZiAoZmxhZ3NbaV0pIHJlc3VsdC5wdXNoKHBhdGhbaV0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgcmFtZXJEb3VnbGFzUGV1Y2tlclBhdGhzKHBhdGhzOiBQYXRoczY0LCBlcHNpbG9uOiBudW1iZXIpOiBQYXRoczY0IHtcclxuICAgIGNvbnN0IHJlc3VsdDogUGF0aHM2NCA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBwYXRoIG9mIHBhdGhzKSB7XHJcbiAgICAgIHJlc3VsdC5wdXNoKENsaXBwZXIucmFtZXJEb3VnbGFzUGV1Y2tlcihwYXRoLCBlcHNpbG9uKSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgZ2V0TmV4dChjdXJyZW50OiBudW1iZXIsIGhpZ2g6IG51bWJlciwgZmxhZ3M6IGJvb2xlYW5bXSk6IG51bWJlciB7XHJcbiAgICBjdXJyZW50Kys7XHJcbiAgICB3aGlsZSAoY3VycmVudCA8PSBoaWdoICYmIGZsYWdzW2N1cnJlbnRdKSBjdXJyZW50Kys7XHJcbiAgICBpZiAoY3VycmVudCA8PSBoaWdoKSByZXR1cm4gY3VycmVudDtcclxuICAgIGN1cnJlbnQgPSAwO1xyXG4gICAgd2hpbGUgKGZsYWdzW2N1cnJlbnRdKSBjdXJyZW50Kys7XHJcbiAgICByZXR1cm4gY3VycmVudDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGdldFByaW9yKGN1cnJlbnQ6IG51bWJlciwgaGlnaDogbnVtYmVyLCBmbGFnczogYm9vbGVhbltdKTogbnVtYmVyIHtcclxuICAgIGlmIChjdXJyZW50ID09PSAwKSBjdXJyZW50ID0gaGlnaDtcclxuICAgIGVsc2UgY3VycmVudC0tO1xyXG4gICAgd2hpbGUgKGN1cnJlbnQgPiAwICYmIGZsYWdzW2N1cnJlbnRdKSBjdXJyZW50LS07XHJcbiAgICBpZiAoIWZsYWdzW2N1cnJlbnRdKSByZXR1cm4gY3VycmVudDtcclxuICAgIGN1cnJlbnQgPSBoaWdoO1xyXG4gICAgd2hpbGUgKGZsYWdzW2N1cnJlbnRdKSBjdXJyZW50LS07XHJcbiAgICByZXR1cm4gY3VycmVudDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIHNxcih2YWx1ZTogbnVtYmVyKTogbnVtYmVyIHtcclxuICAgIHJldHVybiB2YWx1ZSAqIHZhbHVlO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBzaW1wbGlmeVBhdGgocGF0aDogUGF0aDY0LCBlcHNpbG9uOiBudW1iZXIsIGlzQ2xvc2VkUGF0aDogYm9vbGVhbiA9IGZhbHNlKTogUGF0aDY0IHtcclxuICAgIGNvbnN0IGxlbiA9IHBhdGgubGVuZ3RoO1xyXG4gICAgY29uc3QgaGlnaCA9IGxlbiAtIDE7XHJcbiAgICBjb25zdCBlcHNTcXIgPSB0aGlzLnNxcihlcHNpbG9uKTtcclxuICAgIGlmIChsZW4gPCA0KSByZXR1cm4gcGF0aDtcclxuXHJcbiAgICBjb25zdCBmbGFnczogYm9vbGVhbltdID0gbmV3IEFycmF5PGJvb2xlYW4+KGxlbikuZmlsbChmYWxzZSk7XHJcbiAgICBjb25zdCBkc3E6IG51bWJlcltdID0gbmV3IEFycmF5PG51bWJlcj4obGVuKS5maWxsKDApO1xyXG4gICAgbGV0IHByZXYgPSBoaWdoO1xyXG4gICAgbGV0IGN1cnIgPSAwO1xyXG4gICAgbGV0IHN0YXJ0OiBudW1iZXIsIG5leHQ6IG51bWJlciwgcHJpb3IyOiBudW1iZXIsIG5leHQyOiBudW1iZXI7XHJcblxyXG4gICAgaWYgKGlzQ2xvc2VkUGF0aCkge1xyXG4gICAgICBkc3FbMF0gPSB0aGlzLnBlcnBlbmRpY0Rpc3RGcm9tTGluZVNxcmQocGF0aFswXSwgcGF0aFtoaWdoXSwgcGF0aFsxXSk7XHJcbiAgICAgIGRzcVtoaWdoXSA9IHRoaXMucGVycGVuZGljRGlzdEZyb21MaW5lU3FyZChwYXRoW2hpZ2hdLCBwYXRoWzBdLCBwYXRoW2hpZ2ggLSAxXSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBkc3FbMF0gPSBOdW1iZXIuTUFYX1ZBTFVFO1xyXG4gICAgICBkc3FbaGlnaF0gPSBOdW1iZXIuTUFYX1ZBTFVFO1xyXG4gICAgfVxyXG5cclxuICAgIGZvciAobGV0IGkgPSAxOyBpIDwgaGlnaDsgaSsrKSB7XHJcbiAgICAgIGRzcVtpXSA9IHRoaXMucGVycGVuZGljRGlzdEZyb21MaW5lU3FyZChwYXRoW2ldLCBwYXRoW2kgLSAxXSwgcGF0aFtpICsgMV0pO1xyXG4gICAgfVxyXG5cclxuICAgIGZvciAoOyA7KSB7XHJcbiAgICAgIGlmIChkc3FbY3Vycl0gPiBlcHNTcXIpIHtcclxuICAgICAgICBzdGFydCA9IGN1cnI7XHJcbiAgICAgICAgZG8ge1xyXG4gICAgICAgICAgY3VyciA9IHRoaXMuZ2V0TmV4dChjdXJyLCBoaWdoLCBmbGFncyk7XHJcbiAgICAgICAgfSB3aGlsZSAoY3VyciAhPT0gc3RhcnQgJiYgZHNxW2N1cnJdID4gZXBzU3FyKTtcclxuICAgICAgICBpZiAoY3VyciA9PT0gc3RhcnQpIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBwcmV2ID0gdGhpcy5nZXRQcmlvcihjdXJyLCBoaWdoLCBmbGFncyk7XHJcbiAgICAgIG5leHQgPSB0aGlzLmdldE5leHQoY3VyciwgaGlnaCwgZmxhZ3MpO1xyXG4gICAgICBpZiAobmV4dCA9PT0gcHJldikgYnJlYWs7XHJcblxyXG4gICAgICBpZiAoZHNxW25leHRdIDwgZHNxW2N1cnJdKSB7XHJcbiAgICAgICAgZmxhZ3NbbmV4dF0gPSB0cnVlO1xyXG4gICAgICAgIG5leHQgPSB0aGlzLmdldE5leHQobmV4dCwgaGlnaCwgZmxhZ3MpO1xyXG4gICAgICAgIG5leHQyID0gdGhpcy5nZXROZXh0KG5leHQsIGhpZ2gsIGZsYWdzKTtcclxuICAgICAgICBkc3FbY3Vycl0gPSB0aGlzLnBlcnBlbmRpY0Rpc3RGcm9tTGluZVNxcmQocGF0aFtjdXJyXSwgcGF0aFtwcmV2XSwgcGF0aFtuZXh0XSk7XHJcbiAgICAgICAgaWYgKG5leHQgIT09IGhpZ2ggfHwgaXNDbG9zZWRQYXRoKSB7XHJcbiAgICAgICAgICBkc3FbbmV4dF0gPSB0aGlzLnBlcnBlbmRpY0Rpc3RGcm9tTGluZVNxcmQocGF0aFtuZXh0XSwgcGF0aFtjdXJyXSwgcGF0aFtuZXh0Ml0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjdXJyID0gbmV4dDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBmbGFnc1tjdXJyXSA9IHRydWU7XHJcbiAgICAgICAgY3VyciA9IG5leHQ7XHJcbiAgICAgICAgbmV4dCA9IHRoaXMuZ2V0TmV4dChuZXh0LCBoaWdoLCBmbGFncyk7XHJcbiAgICAgICAgcHJpb3IyID0gdGhpcy5nZXRQcmlvcihwcmV2LCBoaWdoLCBmbGFncyk7XHJcbiAgICAgICAgZHNxW2N1cnJdID0gdGhpcy5wZXJwZW5kaWNEaXN0RnJvbUxpbmVTcXJkKHBhdGhbY3Vycl0sIHBhdGhbcHJldl0sIHBhdGhbbmV4dF0pO1xyXG4gICAgICAgIGlmIChwcmV2ICE9PSAwIHx8IGlzQ2xvc2VkUGF0aCkge1xyXG4gICAgICAgICAgZHNxW3ByZXZdID0gdGhpcy5wZXJwZW5kaWNEaXN0RnJvbUxpbmVTcXJkKHBhdGhbcHJldl0sIHBhdGhbcHJpb3IyXSwgcGF0aFtjdXJyXSk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzdWx0OiBQYXRoNjQgPSBbXTtcclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcclxuICAgICAgaWYgKCFmbGFnc1tpXSkgcmVzdWx0LnB1c2gocGF0aFtpXSk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBzaW1wbGlmeVBhdGhzKHBhdGhzOiBQYXRoczY0LCBlcHNpbG9uOiBudW1iZXIsIGlzQ2xvc2VkUGF0aHM6IGJvb2xlYW4gPSBmYWxzZSk6IFBhdGhzNjQge1xyXG4gICAgY29uc3QgcmVzdWx0OiBQYXRoczY0ID0gW107XHJcbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgcGF0aHMpIHtcclxuICAgICAgcmVzdWx0LnB1c2godGhpcy5zaW1wbGlmeVBhdGgocGF0aCwgZXBzaWxvbiwgaXNDbG9zZWRQYXRocykpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIC8vcHJpdmF0ZSBzdGF0aWMgZ2V0TmV4dChjdXJyZW50OiBudW1iZXIsIGhpZ2g6IG51bWJlciwgZmxhZ3M6IGJvb2xlYW5bXSk6IG51bWJlciB7XHJcbiAgLy8gIGN1cnJlbnQrKztcclxuICAvLyAgd2hpbGUgKGN1cnJlbnQgPD0gaGlnaCAmJiBmbGFnc1tjdXJyZW50XSkgY3VycmVudCsrO1xyXG4gIC8vICByZXR1cm4gY3VycmVudDtcclxuICAvL31cclxuXHJcbiAgLy9wcml2YXRlIHN0YXRpYyBnZXRQcmlvcihjdXJyZW50OiBudW1iZXIsIGhpZ2g6IG51bWJlciwgZmxhZ3M6IGJvb2xlYW5bXSk6IG51bWJlciB7XHJcbiAgLy8gIGlmIChjdXJyZW50ID09PSAwKSByZXR1cm4gaGlnaDtcclxuICAvLyAgY3VycmVudC0tO1xyXG4gIC8vICB3aGlsZSAoY3VycmVudCA+IDAgJiYgZmxhZ3NbY3VycmVudF0pIGN1cnJlbnQtLTtcclxuICAvLyAgcmV0dXJuIGN1cnJlbnQ7XHJcbiAgLy99XHJcblxyXG5cclxuICBwdWJsaWMgc3RhdGljIHRyaW1Db2xsaW5lYXIocGF0aDogUGF0aDY0LCBpc09wZW46IGJvb2xlYW4gPSBmYWxzZSk6IFBhdGg2NCB7XHJcbiAgICBsZXQgbGVuID0gcGF0aC5sZW5ndGg7XHJcbiAgICBsZXQgaSA9IDA7XHJcblxyXG4gICAgaWYgKCFpc09wZW4pIHtcclxuICAgICAgd2hpbGUgKGkgPCBsZW4gLSAxICYmIEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3QocGF0aFtsZW4gLSAxXSwgcGF0aFtpXSwgcGF0aFtpICsgMV0pID09PSAwKSBpKys7XHJcbiAgICAgIHdoaWxlIChpIDwgbGVuIC0gMSAmJiBJbnRlcm5hbENsaXBwZXIuY3Jvc3NQcm9kdWN0KHBhdGhbbGVuIC0gMl0sIHBhdGhbbGVuIC0gMV0sIHBhdGhbaV0pID09PSAwKSBsZW4tLTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobGVuIC0gaSA8IDMpIHtcclxuICAgICAgaWYgKCFpc09wZW4gfHwgbGVuIDwgMiB8fCBwYXRoWzBdID09PSBwYXRoWzFdKSB7XHJcbiAgICAgICAgcmV0dXJuIFtdO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiBwYXRoO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlc3VsdDogUGF0aDY0ID0gW107XHJcbiAgICBsZXQgbGFzdCA9IHBhdGhbaV07XHJcbiAgICByZXN1bHQucHVzaChsYXN0KTtcclxuXHJcbiAgICBmb3IgKGkrKzsgaSA8IGxlbiAtIDE7IGkrKykge1xyXG4gICAgICBpZiAoSW50ZXJuYWxDbGlwcGVyLmNyb3NzUHJvZHVjdChsYXN0LCBwYXRoW2ldLCBwYXRoW2kgKyAxXSkgPT09IDApIGNvbnRpbnVlO1xyXG4gICAgICBsYXN0ID0gcGF0aFtpXTtcclxuICAgICAgcmVzdWx0LnB1c2gobGFzdCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGlzT3Blbikge1xyXG4gICAgICByZXN1bHQucHVzaChwYXRoW2xlbiAtIDFdKTtcclxuICAgIH0gZWxzZSBpZiAoSW50ZXJuYWxDbGlwcGVyLmNyb3NzUHJvZHVjdChsYXN0LCBwYXRoW2xlbiAtIDFdLCByZXN1bHRbMF0pICE9PSAwKSB7XHJcbiAgICAgIHJlc3VsdC5wdXNoKHBhdGhbbGVuIC0gMV0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgd2hpbGUgKHJlc3VsdC5sZW5ndGggPiAyICYmIEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3QocmVzdWx0W3Jlc3VsdC5sZW5ndGggLSAxXSwgcmVzdWx0W3Jlc3VsdC5sZW5ndGggLSAyXSwgcmVzdWx0WzBdKSA9PT0gMCkge1xyXG4gICAgICAgIHJlc3VsdC5wb3AoKTtcclxuICAgICAgfVxyXG4gICAgICBpZiAocmVzdWx0Lmxlbmd0aCA8IDMpIHJlc3VsdC5zcGxpY2UoMCwgcmVzdWx0Lmxlbmd0aCk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgcG9pbnRJblBvbHlnb24ocHQ6IFBvaW50NjQsIHBvbHlnb246IFBhdGg2NCk6IFBvaW50SW5Qb2x5Z29uUmVzdWx0IHtcclxuICAgIHJldHVybiBJbnRlcm5hbENsaXBwZXIucG9pbnRJblBvbHlnb24ocHQsIHBvbHlnb24pO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBlbGxpcHNlKGNlbnRlcjogSVBvaW50NjQsIHJhZGl1c1g6IG51bWJlciwgcmFkaXVzWTogbnVtYmVyID0gMCwgc3RlcHM6IG51bWJlciA9IDApOiBQYXRoNjQge1xyXG4gICAgaWYgKHJhZGl1c1ggPD0gMCkgcmV0dXJuIFtdO1xyXG4gICAgaWYgKHJhZGl1c1kgPD0gMCkgcmFkaXVzWSA9IHJhZGl1c1g7XHJcbiAgICBpZiAoc3RlcHMgPD0gMikgc3RlcHMgPSBNYXRoLmNlaWwoTWF0aC5QSSAqIE1hdGguc3FydCgocmFkaXVzWCArIHJhZGl1c1kpIC8gMikpO1xyXG5cclxuICAgIGNvbnN0IHNpID0gTWF0aC5zaW4oMiAqIE1hdGguUEkgLyBzdGVwcyk7XHJcbiAgICBjb25zdCBjbyA9IE1hdGguY29zKDIgKiBNYXRoLlBJIC8gc3RlcHMpO1xyXG4gICAgbGV0IGR4ID0gY28sIGR5ID0gc2k7XHJcbiAgICBjb25zdCByZXN1bHQ6IFBhdGg2NCA9IFt7IHg6IGNlbnRlci54ICsgcmFkaXVzWCwgeTogY2VudGVyLnkgfV07XHJcbiAgICBmb3IgKGxldCBpID0gMTsgaSA8IHN0ZXBzOyArK2kpIHtcclxuICAgICAgcmVzdWx0LnB1c2goeyB4OiBjZW50ZXIueCArIHJhZGl1c1ggKiBkeCwgeTogY2VudGVyLnkgKyByYWRpdXNZICogZHkgfSk7XHJcbiAgICAgIGNvbnN0IHggPSBkeCAqIGNvIC0gZHkgKiBzaTtcclxuICAgICAgZHkgPSBkeSAqIGNvICsgZHggKiBzaTtcclxuICAgICAgZHggPSB4O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIHNob3dQb2x5UGF0aFN0cnVjdHVyZShwcDogUG9seVBhdGhCYXNlLCBsZXZlbDogbnVtYmVyKTogdm9pZCB7XHJcbiAgICBjb25zdCBzcGFjZXMgPSAnICcucmVwZWF0KGxldmVsICogMik7XHJcbiAgICBjb25zdCBjYXB0aW9uID0gcHAuaXNIb2xlID8gXCJIb2xlIFwiIDogXCJPdXRlciBcIjtcclxuICAgIGlmIChwcC5jb3VudCA9PT0gMCkge1xyXG4gICAgICBjb25zb2xlLmxvZyhzcGFjZXMgKyBjYXB0aW9uKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKHNwYWNlcyArIGNhcHRpb24gKyBgKCR7cHAuY291bnR9KWApO1xyXG4gICAgICBwcC5mb3JFYWNoKGNoaWxkID0+IHRoaXMuc2hvd1BvbHlQYXRoU3RydWN0dXJlKGNoaWxkLCBsZXZlbCArIDEpKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHB1YmxpYyBzdGF0aWMgc2hvd1BvbHlUcmVlU3RydWN0dXJlKHBvbHl0cmVlOiBQb2x5VHJlZTY0KTogdm9pZCB7XHJcbiAgICBjb25zb2xlLmxvZyhcIlBvbHl0cmVlIFJvb3RcIik7XHJcbiAgICBwb2x5dHJlZS5mb3JFYWNoKGNoaWxkID0+IHRoaXMuc2hvd1BvbHlQYXRoU3RydWN0dXJlKGNoaWxkLCAxKSk7XHJcbiAgfVxyXG5cclxufVxyXG4iXX0=