/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  3 September 2023                                                  *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2023                                         *
* Purpose   :  This is the main polygon clipping module                        *
* Thanks    :  Special thanks to Thong Nguyen, Guus Kuiper, Phil Stopford,     *
*           :  and Daniel Gosnell for their invaluable assistance with C#.     *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
import { Clipper } from "./clipper.mjs";
import { ClipType, FillRule, InternalClipper, MidpointRounding, Path64, PathType, Paths64, Point64, Rect64, midPointRound } from "./core.mjs";
//
// Converted from C# implemention https://github.com/AngusJohnson/Clipper2/blob/main/CSharp/Clipper2Lib/Clipper.Engine.cs
// Removed support for USINGZ
//
// Converted by ChatGPT 4 August 3 version https://help.openai.com/en/articles/6825453-chatgpt-release-notes
//
export var PointInPolygonResult;
(function (PointInPolygonResult) {
    PointInPolygonResult[PointInPolygonResult["IsOn"] = 0] = "IsOn";
    PointInPolygonResult[PointInPolygonResult["IsInside"] = 1] = "IsInside";
    PointInPolygonResult[PointInPolygonResult["IsOutside"] = 2] = "IsOutside";
})(PointInPolygonResult || (PointInPolygonResult = {}));
export var VertexFlags;
(function (VertexFlags) {
    VertexFlags[VertexFlags["None"] = 0] = "None";
    VertexFlags[VertexFlags["OpenStart"] = 1] = "OpenStart";
    VertexFlags[VertexFlags["OpenEnd"] = 2] = "OpenEnd";
    VertexFlags[VertexFlags["LocalMax"] = 4] = "LocalMax";
    VertexFlags[VertexFlags["LocalMin"] = 8] = "LocalMin";
})(VertexFlags || (VertexFlags = {}));
class Vertex {
    constructor(pt, flags, prev) {
        this.pt = pt;
        this.flags = flags;
        this.next = undefined;
        this.prev = prev;
    }
}
class LocalMinima {
    constructor(vertex, polytype, isOpen = false) {
        this.vertex = vertex;
        this.polytype = polytype;
        this.isOpen = isOpen;
    }
    static equals(lm1, lm2) {
        return lm1.vertex === lm2.vertex;
    }
    static notEquals(lm1, lm2) {
        return lm1.vertex !== lm2.vertex;
    }
}
class IntersectNode {
    constructor(pt, edge1, edge2) {
        this.pt = pt;
        this.edge1 = edge1;
        this.edge2 = edge2;
    }
}
class OutPt {
    constructor(pt, outrec) {
        this.pt = pt;
        this.outrec = outrec;
        this.next = this;
        this.prev = this;
        this.horz = undefined;
    }
}
export var JoinWith;
(function (JoinWith) {
    JoinWith[JoinWith["None"] = 0] = "None";
    JoinWith[JoinWith["Left"] = 1] = "Left";
    JoinWith[JoinWith["Right"] = 2] = "Right";
})(JoinWith || (JoinWith = {}));
export var HorzPosition;
(function (HorzPosition) {
    HorzPosition[HorzPosition["Bottom"] = 0] = "Bottom";
    HorzPosition[HorzPosition["Middle"] = 1] = "Middle";
    HorzPosition[HorzPosition["Top"] = 2] = "Top";
})(HorzPosition || (HorzPosition = {}));
export class OutRec {
    constructor(idx) {
        this.idx = idx;
        this.isOpen = false;
    }
}
class HorzSegment {
    constructor(op) {
        this.leftOp = op;
        this.rightOp = undefined;
        this.leftToRight = true;
    }
}
class HorzJoin {
    constructor(ltor, rtol) {
        this.op1 = ltor;
        this.op2 = rtol;
    }
}
///////////////////////////////////////////////////////////////////
// Important: UP and DOWN here are premised on Y-axis positive down
// displays, which is the orientation used in Clipper's development.
///////////////////////////////////////////////////////////////////
export class Active {
    constructor() {
        this.dx = this.windCount = this.windCount2 = 0;
        this.isLeftBound = false;
        this.joinWith = JoinWith.None;
    }
}
export class ClipperEngine {
    static addLocMin(vert, polytype, isOpen, minimaList) {
        // make sure the vertex is added only once ...
        if ((vert.flags & VertexFlags.LocalMin) !== VertexFlags.None)
            return;
        vert.flags |= VertexFlags.LocalMin;
        const lm = new LocalMinima(vert, polytype, isOpen);
        minimaList.push(lm);
    }
    static addPathsToVertexList(paths, polytype, isOpen, minimaList, vertexList) {
        let totalVertCnt = 0;
        for (const path of paths)
            totalVertCnt += path.length;
        for (const path of paths) {
            let v0 = undefined;
            let prev_v = undefined;
            let curr_v = undefined;
            for (const pt of path) {
                if (!v0) {
                    v0 = new Vertex(pt, VertexFlags.None, undefined);
                    vertexList.push(v0);
                    prev_v = v0;
                }
                else if (prev_v.pt !== pt) { // i.e., skips duplicates
                    curr_v = new Vertex(pt, VertexFlags.None, prev_v);
                    vertexList.push(curr_v);
                    prev_v.next = curr_v;
                    prev_v = curr_v;
                }
            }
            if (!prev_v || !prev_v.prev)
                continue;
            if (!isOpen && prev_v.pt === v0.pt)
                prev_v = prev_v.prev;
            prev_v.next = v0;
            v0.prev = prev_v;
            if (!isOpen && prev_v.next === prev_v)
                continue;
            // OK, we have a valid path
            let going_up = false;
            if (isOpen) {
                curr_v = v0.next;
                let count = 0;
                while (curr_v !== v0 && curr_v.pt.y === v0.pt.y) {
                    curr_v = curr_v.next;
                    if (count++ > totalVertCnt) {
                        console.warn('infinite loop detected');
                        break;
                    }
                }
                going_up = curr_v.pt.y <= v0.pt.y;
                if (going_up) {
                    v0.flags = VertexFlags.OpenStart;
                    this.addLocMin(v0, polytype, true, minimaList);
                }
                else {
                    v0.flags = VertexFlags.OpenStart | VertexFlags.LocalMax;
                }
            }
            else { // closed path
                prev_v = v0.prev;
                let count = 0;
                while (prev_v !== v0 && prev_v.pt.y === v0.pt.y) {
                    prev_v = prev_v.prev;
                    if (count++ > totalVertCnt) {
                        console.warn('infinite loop detected');
                        break;
                    }
                }
                if (prev_v === v0) {
                    continue; // only open paths can be completely flat
                }
                going_up = prev_v.pt.y > v0.pt.y;
            }
            const going_up0 = going_up;
            prev_v = v0;
            curr_v = v0.next;
            let count = 0;
            while (curr_v !== v0) {
                if (curr_v.pt.y > prev_v.pt.y && going_up) {
                    prev_v.flags |= VertexFlags.LocalMax;
                    going_up = false;
                }
                else if (curr_v.pt.y < prev_v.pt.y && !going_up) {
                    going_up = true;
                    this.addLocMin(prev_v, polytype, isOpen, minimaList);
                }
                prev_v = curr_v;
                curr_v = curr_v.next;
                if (count++ > totalVertCnt) {
                    console.warn('infinite loop detected');
                    break;
                }
            }
            if (isOpen) {
                prev_v.flags |= VertexFlags.OpenEnd;
                if (going_up) {
                    prev_v.flags |= VertexFlags.LocalMax;
                }
                else {
                    this.addLocMin(prev_v, polytype, isOpen, minimaList);
                }
            }
            else if (going_up !== going_up0) {
                if (going_up0) {
                    this.addLocMin(prev_v, polytype, false, minimaList);
                }
                else {
                    prev_v.flags |= VertexFlags.LocalMax;
                }
            }
        }
    }
}
export class ReuseableDataContainer64 {
    constructor() {
        this._minimaList = [];
        this._vertexList = [];
    }
    clear() {
        this._minimaList.length = 0;
        this._vertexList.length = 0;
    }
    addPaths(paths, pt, isOpen) {
        ClipperEngine.addPathsToVertexList(paths, pt, isOpen, this._minimaList, this._vertexList);
    }
}
class SimpleNavigableSet {
    constructor() {
        this.items = [];
        this.items = [];
    }
    clear() { this.items.length = 0; }
    isEmpty() { return this.items.length == 0; }
    pollLast() {
        return this.items.pop();
    }
    add(item) {
        if (!this.items.includes(item)) {
            this.items.push(item);
            this.items.sort((a, b) => a - b);
        }
    }
}
export class ClipperBase {
    constructor() {
        this._cliptype = ClipType.None;
        this._fillrule = FillRule.EvenOdd;
        this._currentLocMin = 0;
        this._currentBotY = 0;
        this._isSortedMinimaList = false;
        this._hasOpenPaths = false;
        this._using_polytree = false;
        this._succeeded = false;
        this.reverseSolution = false;
        this._minimaList = [];
        this._intersectList = [];
        this._vertexList = [];
        this._outrecList = [];
        this._scanlineList = new SimpleNavigableSet();
        this._horzSegList = [];
        this._horzJoinList = [];
        this.preserveCollinear = true;
    }
    static isOdd(val) {
        return ((val & 1) !== 0);
    }
    static isHotEdgeActive(ae) {
        return ae.outrec !== undefined;
    }
    static isOpen(ae) {
        return ae.localMin.isOpen;
    }
    static isOpenEndActive(ae) {
        return ae.localMin.isOpen && ClipperBase.isOpenEnd(ae.vertexTop);
    }
    static isOpenEnd(v) {
        return (v.flags & (VertexFlags.OpenStart | VertexFlags.OpenEnd)) !== VertexFlags.None;
    }
    static getPrevHotEdge(ae) {
        let prev = ae.prevInAEL;
        while (prev && (ClipperBase.isOpen(prev) || !ClipperBase.isHotEdgeActive(prev)))
            prev = prev.prevInAEL;
        return prev;
    }
    static isFront(ae) {
        return ae === ae.outrec.frontEdge;
    }
    /*******************************************************************************
    *  Dx:                             0(90deg)                                    *
    *                                  |                                           *
    *               +inf (180deg) <--- o --. -inf (0deg)                          *
    *******************************************************************************/
    static getDx(pt1, pt2) {
        const dy = pt2.y - pt1.y;
        if (dy !== 0)
            return (pt2.x - pt1.x) / dy;
        if (pt2.x > pt1.x)
            return Number.NEGATIVE_INFINITY;
        return Number.POSITIVE_INFINITY;
    }
    static topX(ae, currentY) {
        if ((currentY === ae.top.y) || (ae.top.x === ae.bot.x))
            return ae.top.x;
        if (currentY === ae.bot.y)
            return ae.bot.x;
        return ae.bot.x + midPointRound(ae.dx * (currentY - ae.bot.y), MidpointRounding.ToEven);
    }
    static isHorizontal(ae) {
        return (ae.top.y === ae.bot.y);
    }
    static isHeadingRightHorz(ae) {
        return (Number.NEGATIVE_INFINITY === ae.dx);
    }
    static isHeadingLeftHorz(ae) {
        return (Number.POSITIVE_INFINITY === ae.dx);
    }
    static swapActives(ae1, ae2) {
        [ae2, ae1] = [ae1, ae2];
    }
    static getPolyType(ae) {
        return ae.localMin.polytype;
    }
    static isSamePolyType(ae1, ae2) {
        return ae1.localMin.polytype === ae2.localMin.polytype;
    }
    static setDx(ae) {
        ae.dx = ClipperBase.getDx(ae.bot, ae.top);
    }
    static nextVertex(ae) {
        if (ae.windDx > 0)
            return ae.vertexTop.next;
        return ae.vertexTop.prev;
    }
    static prevPrevVertex(ae) {
        if (ae.windDx > 0)
            return ae.vertexTop.prev.prev;
        return ae.vertexTop.next.next;
    }
    static isMaxima(vertex) {
        return (vertex.flags & VertexFlags.LocalMax) !== VertexFlags.None;
    }
    static isMaximaActive(ae) {
        return ClipperBase.isMaxima(ae.vertexTop);
    }
    static getMaximaPair(ae) {
        let ae2 = ae.nextInAEL;
        while (ae2) {
            if (ae2.vertexTop === ae.vertexTop)
                return ae2; // Found!
            ae2 = ae2.nextInAEL;
        }
        return undefined;
    }
    static getCurrYMaximaVertex_Open(ae) {
        let result = ae.vertexTop;
        if (ae.windDx > 0) {
            while (result.next.pt.y === result.pt.y &&
                ((result.flags & (VertexFlags.OpenEnd |
                    VertexFlags.LocalMax)) === VertexFlags.None))
                result = result.next;
        }
        else {
            while (result.prev.pt.y === result.pt.y &&
                ((result.flags & (VertexFlags.OpenEnd |
                    VertexFlags.LocalMax)) === VertexFlags.None))
                result = result.prev;
        }
        if (!ClipperBase.isMaxima(result))
            result = undefined; // not a maxima
        return result;
    }
    static getCurrYMaximaVertex(ae) {
        let result = ae.vertexTop;
        if (ae.windDx > 0) {
            while (result.next.pt.y === result.pt.y)
                result = result.next;
        }
        else {
            while (result.prev.pt.y === result.pt.y)
                result = result.prev;
        }
        if (!ClipperBase.isMaxima(result))
            result = undefined; // not a maxima
        return result;
    }
    static setSides(outrec, startEdge, endEdge) {
        outrec.frontEdge = startEdge;
        outrec.backEdge = endEdge;
    }
    static swapOutrecs(ae1, ae2) {
        const or1 = ae1.outrec;
        const or2 = ae2.outrec;
        if (or1 === or2) {
            const ae = or1.frontEdge;
            or1.frontEdge = or1.backEdge;
            or1.backEdge = ae;
            return;
        }
        if (or1) {
            if (ae1 === or1.frontEdge)
                or1.frontEdge = ae2;
            else
                or1.backEdge = ae2;
        }
        if (or2) {
            if (ae2 === or2.frontEdge)
                or2.frontEdge = ae1;
            else
                or2.backEdge = ae1;
        }
        ae1.outrec = or2;
        ae2.outrec = or1;
    }
    static setOwner(outrec, newOwner) {
        while (newOwner.owner && !newOwner.owner.pts) {
            newOwner.owner = newOwner.owner.owner;
        }
        //make sure that outrec isn't an owner of newOwner
        let tmp = newOwner;
        while (tmp && tmp !== outrec)
            tmp = tmp.owner;
        if (tmp)
            newOwner.owner = outrec.owner;
        outrec.owner = newOwner;
    }
    static area(op) {
        // https://en.wikipedia.org/wiki/Shoelace_formula
        let area = 0.0;
        let op2 = op;
        do {
            area += (op2.prev.pt.y + op2.pt.y) *
                (op2.prev.pt.x - op2.pt.x);
            op2 = op2.next;
        } while (op2 !== op);
        return area * 0.5;
    }
    static areaTriangle(pt1, pt2, pt3) {
        return (pt3.y + pt1.y) * (pt3.x - pt1.x) +
            (pt1.y + pt2.y) * (pt1.x - pt2.x) +
            (pt2.y + pt3.y) * (pt2.x - pt3.x);
    }
    static getRealOutRec(outRec) {
        while (outRec !== undefined && outRec.pts === undefined) {
            outRec = outRec.owner;
        }
        return outRec;
    }
    static isValidOwner(outRec, testOwner) {
        while (testOwner !== undefined && testOwner !== outRec)
            testOwner = testOwner.owner;
        return testOwner === undefined;
    }
    static uncoupleOutRec(ae) {
        const outrec = ae.outrec;
        if (outrec === undefined)
            return;
        outrec.frontEdge.outrec = undefined;
        outrec.backEdge.outrec = undefined;
        outrec.frontEdge = undefined;
        outrec.backEdge = undefined;
    }
    static outrecIsAscending(hotEdge) {
        return (hotEdge === hotEdge.outrec.frontEdge);
    }
    static swapFrontBackSides(outrec) {
        // while this proc. is needed for open paths
        // it's almost never needed for closed paths
        const ae2 = outrec.frontEdge;
        outrec.frontEdge = outrec.backEdge;
        outrec.backEdge = ae2;
        outrec.pts = outrec.pts.next;
    }
    static edgesAdjacentInAEL(inode) {
        return (inode.edge1.nextInAEL === inode.edge2) || (inode.edge1.prevInAEL === inode.edge2);
    }
    clearSolutionOnly() {
        while (this._actives)
            this.deleteFromAEL(this._actives);
        this._scanlineList.clear();
        this.disposeIntersectNodes();
        this._outrecList.length = 0;
        this._horzSegList.length = 0;
        this._horzJoinList.length = 0;
    }
    clear() {
        this.clearSolutionOnly();
        this._minimaList.length = 0;
        this._vertexList.length = 0;
        this._currentLocMin = 0;
        this._isSortedMinimaList = false;
        this._hasOpenPaths = false;
    }
    reset() {
        if (!this._isSortedMinimaList) {
            this._minimaList.sort((locMin1, locMin2) => locMin2.vertex.pt.y - locMin1.vertex.pt.y);
            this._isSortedMinimaList = true;
        }
        for (let i = this._minimaList.length - 1; i >= 0; i--) {
            this._scanlineList.add(this._minimaList[i].vertex.pt.y);
        }
        this._currentBotY = 0;
        this._currentLocMin = 0;
        this._actives = undefined;
        this._sel = undefined;
        this._succeeded = true;
    }
    insertScanline(y) {
        this._scanlineList.add(y);
    }
    popScanline() {
        return this._scanlineList.pollLast();
    }
    hasLocMinAtY(y) {
        return (this._currentLocMin < this._minimaList.length && this._minimaList[this._currentLocMin].vertex.pt.y == y);
    }
    popLocalMinima() {
        return this._minimaList[this._currentLocMin++];
    }
    addLocMin(vert, polytype, isOpen) {
        // make sure the vertex is added only once ...
        if ((vert.flags & VertexFlags.LocalMin) != VertexFlags.None)
            return;
        vert.flags |= VertexFlags.LocalMin;
        const lm = new LocalMinima(vert, polytype, isOpen);
        this._minimaList.push(lm);
    }
    addSubject(path) {
        this.addPath(path, PathType.Subject);
    }
    addOpenSubject(path) {
        this.addPath(path, PathType.Subject, true);
    }
    addClip(path) {
        this.addPath(path, PathType.Clip);
    }
    addPath(path, polytype, isOpen = false) {
        const tmp = [path];
        this.addPaths(tmp, polytype, isOpen);
    }
    addPaths(paths, polytype, isOpen = false) {
        if (isOpen)
            this._hasOpenPaths = true;
        this._isSortedMinimaList = false;
        ClipperEngine.addPathsToVertexList(paths, polytype, isOpen, this._minimaList, this._vertexList);
    }
    addReuseableData(reuseableData) {
        if (reuseableData._minimaList.length === 0)
            return;
        this._isSortedMinimaList = false;
        for (const lm of reuseableData._minimaList) {
            this._minimaList.push(new LocalMinima(lm.vertex, lm.polytype, lm.isOpen));
            if (lm.isOpen)
                this._hasOpenPaths = true;
        }
    }
    isContributingClosed(ae) {
        switch (this._fillrule) {
            case FillRule.Positive:
                if (ae.windCount !== 1)
                    return false;
                break;
            case FillRule.Negative:
                if (ae.windCount !== -1)
                    return false;
                break;
            case FillRule.NonZero:
                if (Math.abs(ae.windCount) !== 1)
                    return false;
                break;
        }
        switch (this._cliptype) {
            case ClipType.Intersection:
                switch (this._fillrule) {
                    case FillRule.Positive: return ae.windCount2 > 0;
                    case FillRule.Negative: return ae.windCount2 < 0;
                    default: return ae.windCount2 !== 0;
                }
            case ClipType.Union:
                switch (this._fillrule) {
                    case FillRule.Positive: return ae.windCount2 <= 0;
                    case FillRule.Negative: return ae.windCount2 >= 0;
                    default: return ae.windCount2 === 0;
                }
            case ClipType.Difference:
                const result = this._fillrule === FillRule.Positive ? (ae.windCount2 <= 0) :
                    this._fillrule === FillRule.Negative ? (ae.windCount2 >= 0) :
                        (ae.windCount2 === 0);
                return ClipperBase.getPolyType(ae) === PathType.Subject ? result : !result;
            case ClipType.Xor:
                return true;
            default:
                return false;
        }
    }
    isContributingOpen(ae) {
        let isInClip, isInSubj;
        switch (this._fillrule) {
            case FillRule.Positive:
                isInSubj = ae.windCount > 0;
                isInClip = ae.windCount2 > 0;
                break;
            case FillRule.Negative:
                isInSubj = ae.windCount < 0;
                isInClip = ae.windCount2 < 0;
                break;
            default:
                isInSubj = ae.windCount !== 0;
                isInClip = ae.windCount2 !== 0;
                break;
        }
        switch (this._cliptype) {
            case ClipType.Intersection:
                return isInClip;
            case ClipType.Union:
                return !isInSubj && !isInClip;
            default:
                return !isInClip;
        }
    }
    setWindCountForClosedPathEdge(ae) {
        let ae2 = ae.prevInAEL;
        const pt = ClipperBase.getPolyType(ae);
        while (ae2 !== undefined && (ClipperBase.getPolyType(ae2) !== pt || ClipperBase.isOpen(ae2))) {
            ae2 = ae2.prevInAEL;
        }
        if (ae2 === undefined) {
            ae.windCount = ae.windDx;
            ae2 = this._actives;
        }
        else if (this._fillrule === FillRule.EvenOdd) {
            ae.windCount = ae.windDx;
            ae.windCount2 = ae2.windCount2;
            ae2 = ae2.nextInAEL;
        }
        else {
            // NonZero, positive, or negative filling here ...
            // when e2's WindCnt is in the SAME direction as its WindDx,
            // then polygon will fill on the right of 'e2' (and 'e' will be inside)
            // nb: neither e2.WindCnt nor e2.WindDx should ever be 0.
            if (ae2.windCount * ae2.windDx < 0) {
                // opposite directions so 'ae' is outside 'ae2' ...
                if (Math.abs(ae2.windCount) > 1) {
                    // outside prev poly but still inside another.
                    if (ae2.windDx * ae.windDx < 0)
                        // reversing direction so use the same WC
                        ae.windCount = ae2.windCount;
                    else
                        // otherwise keep 'reducing' the WC by 1 (i.e. towards 0) ...
                        ae.windCount = ae2.windCount + ae.windDx;
                }
                else {
                    // now outside all polys of same polytype so set own WC ...
                    ae.windCount = (ClipperBase.isOpen(ae) ? 1 : ae.windDx);
                }
            }
            else {
                // 'ae' must be inside 'ae2'
                if (ae2.windDx * ae.windDx < 0)
                    // reversing direction so use the same WC
                    ae.windCount = ae2.windCount;
                else
                    // otherwise keep 'increasing' the WC by 1 (i.e. away from 0) ...
                    ae.windCount = ae2.windCount + ae.windDx;
            }
            ae.windCount2 = ae2.windCount2;
            ae2 = ae2.nextInAEL; // i.e. get ready to calc WindCnt2
        }
        if (this._fillrule === FillRule.EvenOdd) {
            while (ae2 !== ae) {
                if (ClipperBase.getPolyType(ae2) !== pt && !ClipperBase.isOpen(ae2)) {
                    ae.windCount2 = (ae.windCount2 === 0 ? 1 : 0);
                }
                ae2 = ae2.nextInAEL;
            }
        }
        else {
            while (ae2 !== ae) {
                if (ClipperBase.getPolyType(ae2) !== pt && !ClipperBase.isOpen(ae2)) {
                    ae.windCount2 += ae2.windDx;
                }
                ae2 = ae2.nextInAEL;
            }
        }
    }
    setWindCountForOpenPathEdge(ae) {
        let ae2 = this._actives;
        if (this._fillrule === FillRule.EvenOdd) {
            let cnt1 = 0, cnt2 = 0;
            while (ae2 !== ae) {
                if (ClipperBase.getPolyType(ae2) === PathType.Clip)
                    cnt2++;
                else if (!ClipperBase.isOpen(ae2))
                    cnt1++;
                ae2 = ae2.nextInAEL;
            }
            ae.windCount = (ClipperBase.isOdd(cnt1) ? 1 : 0);
            ae.windCount2 = (ClipperBase.isOdd(cnt2) ? 1 : 0);
        }
        else {
            while (ae2 !== ae) {
                if (ClipperBase.getPolyType(ae2) === PathType.Clip)
                    ae.windCount2 += ae2.windDx;
                else if (!ClipperBase.isOpen(ae2))
                    ae.windCount += ae2.windDx;
                ae2 = ae2.nextInAEL;
            }
        }
    }
    static isValidAelOrder(resident, newcomer) {
        if (newcomer.curX !== resident.curX)
            return newcomer.curX > resident.curX;
        // get the turning direction  a1.top, a2.bot, a2.top
        const d = InternalClipper.crossProduct(resident.top, newcomer.bot, newcomer.top);
        if (d !== 0.0)
            return (d < 0);
        // edges must be collinear to get here
        // for starting open paths, place them according to
        // the direction they're about to turn
        if (!this.isMaximaActive(resident) && (resident.top.y > newcomer.top.y)) {
            return InternalClipper.crossProduct(newcomer.bot, resident.top, this.nextVertex(resident).pt) <= 0;
        }
        if (!this.isMaximaActive(newcomer) && (newcomer.top.y > resident.top.y)) {
            return InternalClipper.crossProduct(newcomer.bot, newcomer.top, this.nextVertex(newcomer).pt) >= 0;
        }
        const y = newcomer.bot.y;
        const newcomerIsLeft = newcomer.isLeftBound;
        if (resident.bot.y !== y || resident.localMin.vertex.pt.y !== y)
            return newcomer.isLeftBound;
        // resident must also have just been inserted
        if (resident.isLeftBound !== newcomerIsLeft)
            return newcomerIsLeft;
        if (InternalClipper.crossProduct(this.prevPrevVertex(resident).pt, resident.bot, resident.top) === 0)
            return true;
        // compare turning direction of the alternate bound
        return (InternalClipper.crossProduct(this.prevPrevVertex(resident).pt, newcomer.bot, this.prevPrevVertex(newcomer).pt) > 0) === newcomerIsLeft;
    }
    insertLeftEdge(ae) {
        let ae2;
        if (!this._actives) {
            ae.prevInAEL = undefined;
            ae.nextInAEL = undefined;
            this._actives = ae;
        }
        else if (!ClipperBase.isValidAelOrder(this._actives, ae)) {
            ae.prevInAEL = undefined;
            ae.nextInAEL = this._actives;
            this._actives.prevInAEL = ae;
            this._actives = ae;
        }
        else {
            ae2 = this._actives;
            while (ae2.nextInAEL && ClipperBase.isValidAelOrder(ae2.nextInAEL, ae))
                ae2 = ae2.nextInAEL;
            //don't separate joined edges
            if (ae2.joinWith === JoinWith.Right)
                ae2 = ae2.nextInAEL;
            ae.nextInAEL = ae2.nextInAEL;
            if (ae2.nextInAEL)
                ae2.nextInAEL.prevInAEL = ae;
            ae.prevInAEL = ae2;
            ae2.nextInAEL = ae;
        }
    }
    static insertRightEdge(ae, ae2) {
        ae2.nextInAEL = ae.nextInAEL;
        if (ae.nextInAEL)
            ae.nextInAEL.prevInAEL = ae2;
        ae2.prevInAEL = ae;
        ae.nextInAEL = ae2;
    }
    insertLocalMinimaIntoAEL(botY) {
        let localMinima;
        let leftBound;
        let rightBound;
        // Add any local minima (if any) at BotY ...
        // NB horizontal local minima edges should contain locMin.vertex.prev
        while (this.hasLocMinAtY(botY)) {
            localMinima = this.popLocalMinima();
            if ((localMinima.vertex.flags & VertexFlags.OpenStart) !== VertexFlags.None) {
                leftBound = undefined;
            }
            else {
                leftBound = new Active();
                leftBound.bot = localMinima.vertex.pt;
                leftBound.curX = localMinima.vertex.pt.x;
                leftBound.windDx = -1;
                leftBound.vertexTop = localMinima.vertex.prev;
                leftBound.top = localMinima.vertex.prev.pt;
                leftBound.outrec = undefined;
                leftBound.localMin = localMinima;
                ClipperBase.setDx(leftBound);
            }
            if ((localMinima.vertex.flags & VertexFlags.OpenEnd) !== VertexFlags.None) {
                rightBound = undefined;
            }
            else {
                rightBound = new Active();
                rightBound.bot = localMinima.vertex.pt;
                rightBound.curX = localMinima.vertex.pt.x;
                rightBound.windDx = 1;
                rightBound.vertexTop = localMinima.vertex.next;
                rightBound.top = localMinima.vertex.next.pt;
                rightBound.outrec = undefined;
                rightBound.localMin = localMinima;
                ClipperBase.setDx(rightBound);
            }
            if (leftBound && rightBound) {
                if (ClipperBase.isHorizontal(leftBound)) {
                    if (ClipperBase.isHeadingRightHorz(leftBound)) {
                        [rightBound, leftBound] = [leftBound, rightBound];
                    }
                }
                else if (ClipperBase.isHorizontal(rightBound)) {
                    if (ClipperBase.isHeadingLeftHorz(rightBound)) {
                        [rightBound, leftBound] = [leftBound, rightBound];
                    }
                }
                else if (leftBound.dx < rightBound.dx) {
                    [rightBound, leftBound] = [leftBound, rightBound];
                }
                //so when leftBound has windDx == 1, the polygon will be oriented
                //counter-clockwise in Cartesian coords (clockwise with inverted Y).
            }
            else if (leftBound === undefined) {
                leftBound = rightBound;
                rightBound = undefined;
            }
            let contributing = false;
            leftBound.isLeftBound = true;
            this.insertLeftEdge(leftBound);
            if (ClipperBase.isOpen(leftBound)) {
                this.setWindCountForOpenPathEdge(leftBound);
                contributing = this.isContributingOpen(leftBound);
            }
            else {
                this.setWindCountForClosedPathEdge(leftBound);
                contributing = this.isContributingClosed(leftBound);
            }
            if (rightBound) {
                rightBound.windCount = leftBound.windCount;
                rightBound.windCount2 = leftBound.windCount2;
                ClipperBase.insertRightEdge(leftBound, rightBound);
                if (contributing) {
                    this.addLocalMinPoly(leftBound, rightBound, leftBound.bot, true);
                    if (!ClipperBase.isHorizontal(leftBound)) {
                        this.checkJoinLeft(leftBound, leftBound.bot);
                    }
                }
                while (rightBound.nextInAEL &&
                    ClipperBase.isValidAelOrder(rightBound.nextInAEL, rightBound)) {
                    this.intersectEdges(rightBound, rightBound.nextInAEL, rightBound.bot);
                    this.swapPositionsInAEL(rightBound, rightBound.nextInAEL);
                }
                if (ClipperBase.isHorizontal(rightBound)) {
                    this.pushHorz(rightBound);
                }
                else {
                    this.checkJoinRight(rightBound, rightBound.bot);
                    this.insertScanline(rightBound.top.y);
                }
            }
            else if (contributing) {
                this.startOpenPath(leftBound, leftBound.bot);
            }
            if (ClipperBase.isHorizontal(leftBound)) {
                this.pushHorz(leftBound);
            }
            else {
                this.insertScanline(leftBound.top.y);
            }
        }
    }
    pushHorz(ae) {
        ae.nextInSEL = this._sel;
        this._sel = ae;
    }
    popHorz() {
        const ae = this._sel;
        if (this._sel === undefined)
            return undefined;
        this._sel = this._sel.nextInSEL;
        return ae;
    }
    addLocalMinPoly(ae1, ae2, pt, isNew = false) {
        const outrec = this.newOutRec();
        ae1.outrec = outrec;
        ae2.outrec = outrec;
        if (ClipperBase.isOpen(ae1)) {
            outrec.owner = undefined;
            outrec.isOpen = true;
            if (ae1.windDx > 0)
                ClipperBase.setSides(outrec, ae1, ae2);
            else
                ClipperBase.setSides(outrec, ae2, ae1);
        }
        else {
            outrec.isOpen = false;
            const prevHotEdge = ClipperBase.getPrevHotEdge(ae1);
            // e.windDx is the winding direction of the **input** paths
            // and unrelated to the winding direction of output polygons.
            // Output orientation is determined by e.outrec.frontE which is
            // the ascending edge (see AddLocalMinPoly).
            if (prevHotEdge) {
                if (this._using_polytree)
                    ClipperBase.setOwner(outrec, prevHotEdge.outrec);
                outrec.owner = prevHotEdge.outrec;
                if (ClipperBase.outrecIsAscending(prevHotEdge) === isNew)
                    ClipperBase.setSides(outrec, ae2, ae1);
                else
                    ClipperBase.setSides(outrec, ae1, ae2);
            }
            else {
                outrec.owner = undefined;
                if (isNew)
                    ClipperBase.setSides(outrec, ae1, ae2);
                else
                    ClipperBase.setSides(outrec, ae2, ae1);
            }
        }
        const op = new OutPt(pt, outrec);
        outrec.pts = op;
        return op;
    }
    addLocalMaxPoly(ae1, ae2, pt) {
        if (ClipperBase.isJoined(ae1))
            this.split(ae1, pt);
        if (ClipperBase.isJoined(ae2))
            this.split(ae2, pt);
        if (ClipperBase.isFront(ae1) === ClipperBase.isFront(ae2)) {
            if (ClipperBase.isOpenEndActive(ae1))
                ClipperBase.swapFrontBackSides(ae1.outrec);
            else if (ClipperBase.isOpenEndActive(ae2))
                ClipperBase.swapFrontBackSides(ae2.outrec);
            else {
                this._succeeded = false;
                return undefined;
            }
        }
        const result = ClipperBase.addOutPt(ae1, pt);
        if (ae1.outrec === ae2.outrec) {
            const outrec = ae1.outrec;
            outrec.pts = result;
            if (this._using_polytree) {
                const e = ClipperBase.getPrevHotEdge(ae1);
                if (e === undefined)
                    outrec.owner = undefined;
                else
                    ClipperBase.setOwner(outrec, e.outrec);
            }
            ClipperBase.uncoupleOutRec(ae1);
        }
        else if (ClipperBase.isOpen(ae1)) {
            if (ae1.windDx < 0)
                ClipperBase.joinOutrecPaths(ae1, ae2);
            else
                ClipperBase.joinOutrecPaths(ae2, ae1);
        }
        else if (ae1.outrec.idx < ae2.outrec.idx)
            ClipperBase.joinOutrecPaths(ae1, ae2);
        else
            ClipperBase.joinOutrecPaths(ae2, ae1);
        return result;
    }
    static joinOutrecPaths(ae1, ae2) {
        // join ae2 outrec path onto ae1 outrec path and then delete ae2 outrec path
        // pointers. (NB Only very rarely do the joining ends share the same coords.)
        const p1Start = ae1.outrec.pts;
        const p2Start = ae2.outrec.pts;
        const p1End = p1Start.next;
        const p2End = p2Start.next;
        if (ClipperBase.isFront(ae1)) {
            p2End.prev = p1Start;
            p1Start.next = p2End;
            p2Start.next = p1End;
            p1End.prev = p2Start;
            ae1.outrec.pts = p2Start;
            // nb: if IsOpen(e1) then e1 & e2 must be a 'maximaPair'
            ae1.outrec.frontEdge = ae2.outrec.frontEdge;
            if (ae1.outrec.frontEdge)
                ae1.outrec.frontEdge.outrec = ae1.outrec;
        }
        else {
            p1End.prev = p2Start;
            p2Start.next = p1End;
            p1Start.next = p2End;
            p2End.prev = p1Start;
            ae1.outrec.backEdge = ae2.outrec.backEdge;
            if (ae1.outrec.backEdge)
                ae1.outrec.backEdge.outrec = ae1.outrec;
        }
        // after joining, the ae2.OutRec must contains no vertices ...
        ae2.outrec.frontEdge = undefined;
        ae2.outrec.backEdge = undefined;
        ae2.outrec.pts = undefined;
        ClipperBase.setOwner(ae2.outrec, ae1.outrec);
        if (ClipperBase.isOpenEndActive(ae1)) {
            ae2.outrec.pts = ae1.outrec.pts;
            ae1.outrec.pts = undefined;
        }
        // and ae1 and ae2 are maxima and are about to be dropped from the Actives list.
        ae1.outrec = undefined;
        ae2.outrec = undefined;
    }
    static addOutPt(ae, pt) {
        const outrec = ae.outrec;
        const toFront = ClipperBase.isFront(ae);
        const opFront = outrec.pts;
        const opBack = opFront.next;
        if (toFront && (pt == opFront.pt))
            return opFront;
        else if (!toFront && (pt == opBack.pt))
            return opBack;
        const newOp = new OutPt(pt, outrec);
        opBack.prev = newOp;
        newOp.prev = opFront;
        newOp.next = opBack;
        opFront.next = newOp;
        if (toFront)
            outrec.pts = newOp;
        return newOp;
    }
    newOutRec() {
        const result = new OutRec(this._outrecList.length);
        this._outrecList.push(result);
        return result;
    }
    startOpenPath(ae, pt) {
        const outrec = this.newOutRec();
        outrec.isOpen = true;
        if (ae.windDx > 0) {
            outrec.frontEdge = ae;
            outrec.backEdge = undefined;
        }
        else {
            outrec.frontEdge = undefined;
            outrec.backEdge = ae;
        }
        ae.outrec = outrec;
        const op = new OutPt(pt, outrec);
        outrec.pts = op;
        return op;
    }
    updateEdgeIntoAEL(ae) {
        ae.bot = ae.top;
        ae.vertexTop = ClipperBase.nextVertex(ae);
        ae.top = ae.vertexTop.pt;
        ae.curX = ae.bot.x;
        ClipperBase.setDx(ae);
        if (ClipperBase.isJoined(ae))
            this.split(ae, ae.bot);
        if (ClipperBase.isHorizontal(ae))
            return;
        this.insertScanline(ae.top.y);
        this.checkJoinLeft(ae, ae.bot);
        this.checkJoinRight(ae, ae.bot, true);
    }
    static findEdgeWithMatchingLocMin(e) {
        let result = e.nextInAEL;
        while (result) {
            if (result.localMin === e.localMin)
                return result;
            if (!ClipperBase.isHorizontal(result) && e.bot !== result.bot)
                result = undefined;
            else
                result = result.nextInAEL;
        }
        result = e.prevInAEL;
        while (result) {
            if (result.localMin === e.localMin)
                return result;
            if (!ClipperBase.isHorizontal(result) && e.bot !== result.bot)
                return undefined;
            result = result.prevInAEL;
        }
        return result;
    }
    intersectEdges(ae1, ae2, pt) {
        let resultOp = undefined;
        // MANAGE OPEN PATH INTERSECTIONS SEPARATELY ...
        if (this._hasOpenPaths && (ClipperBase.isOpen(ae1) || ClipperBase.isOpen(ae2))) {
            if (ClipperBase.isOpen(ae1) && ClipperBase.isOpen(ae2))
                return undefined;
            // the following line avoids duplicating quite a bit of code
            if (ClipperBase.isOpen(ae2))
                ClipperBase.swapActives(ae1, ae2);
            if (ClipperBase.isJoined(ae2))
                this.split(ae2, pt);
            if (this._cliptype === ClipType.Union) {
                if (!ClipperBase.isHotEdgeActive(ae2))
                    return undefined;
            }
            else if (ae2.localMin.polytype === PathType.Subject)
                return undefined;
            switch (this._fillrule) {
                case FillRule.Positive:
                    if (ae2.windCount !== 1)
                        return undefined;
                    break;
                case FillRule.Negative:
                    if (ae2.windCount !== -1)
                        return undefined;
                    break;
                default:
                    if (Math.abs(ae2.windCount) !== 1)
                        return undefined;
                    break;
            }
            // toggle contribution ...
            if (ClipperBase.isHotEdgeActive(ae1)) {
                resultOp = ClipperBase.addOutPt(ae1, pt);
                if (ClipperBase.isFront(ae1)) {
                    ae1.outrec.frontEdge = undefined;
                }
                else {
                    ae1.outrec.backEdge = undefined;
                }
                ae1.outrec = undefined;
                // horizontal edges can pass under open paths at a LocMins
            }
            else if (pt === ae1.localMin.vertex.pt && !ClipperBase.isOpenEnd(ae1.localMin.vertex)) {
                // find the other side of the LocMin and
                // if it's 'hot' join up with it ...
                const ae3 = ClipperBase.findEdgeWithMatchingLocMin(ae1);
                if (ae3 && ClipperBase.isHotEdgeActive(ae3)) {
                    ae1.outrec = ae3.outrec;
                    if (ae1.windDx > 0) {
                        ClipperBase.setSides(ae3.outrec, ae1, ae3);
                    }
                    else {
                        ClipperBase.setSides(ae3.outrec, ae3, ae1);
                    }
                    return ae3.outrec.pts;
                }
                resultOp = this.startOpenPath(ae1, pt);
            }
            else {
                resultOp = this.startOpenPath(ae1, pt);
            }
            return resultOp;
        }
        // MANAGING CLOSED PATHS FROM HERE ON
        if (ClipperBase.isJoined(ae1))
            this.split(ae1, pt);
        if (ClipperBase.isJoined(ae2))
            this.split(ae2, pt);
        // UPDATE WINDING COUNTS...
        let oldE1WindCount;
        let oldE2WindCount;
        if (ae1.localMin.polytype === ae2.localMin.polytype) {
            if (this._fillrule === FillRule.EvenOdd) {
                oldE1WindCount = ae1.windCount;
                ae1.windCount = ae2.windCount;
                ae2.windCount = oldE1WindCount;
            }
            else {
                if (ae1.windCount + ae2.windDx === 0)
                    ae1.windCount = -ae1.windCount;
                else
                    ae1.windCount += ae2.windDx;
                if (ae2.windCount - ae1.windDx === 0)
                    ae2.windCount = -ae2.windCount;
                else
                    ae2.windCount -= ae1.windDx;
            }
        }
        else {
            if (this._fillrule !== FillRule.EvenOdd)
                ae1.windCount2 += ae2.windDx;
            else
                ae1.windCount2 = (ae1.windCount2 === 0 ? 1 : 0);
            if (this._fillrule !== FillRule.EvenOdd)
                ae2.windCount2 -= ae1.windDx;
            else
                ae2.windCount2 = (ae2.windCount2 === 0 ? 1 : 0);
        }
        switch (this._fillrule) {
            case FillRule.Positive:
                oldE1WindCount = ae1.windCount;
                oldE2WindCount = ae2.windCount;
                break;
            case FillRule.Negative:
                oldE1WindCount = -ae1.windCount;
                oldE2WindCount = -ae2.windCount;
                break;
            default:
                oldE1WindCount = Math.abs(ae1.windCount);
                oldE2WindCount = Math.abs(ae2.windCount);
                break;
        }
        const e1WindCountIs0or1 = oldE1WindCount === 0 || oldE1WindCount === 1;
        const e2WindCountIs0or1 = oldE2WindCount === 0 || oldE2WindCount === 1;
        if ((!ClipperBase.isHotEdgeActive(ae1) && !e1WindCountIs0or1) || (!ClipperBase.isHotEdgeActive(ae2) && !e2WindCountIs0or1))
            return undefined;
        // NOW PROCESS THE INTERSECTION ...
        // if both edges are 'hot' ...
        if (ClipperBase.isHotEdgeActive(ae1) && ClipperBase.isHotEdgeActive(ae2)) {
            if ((oldE1WindCount !== 0 && oldE1WindCount !== 1) ||
                (oldE2WindCount !== 0 && oldE2WindCount !== 1) ||
                (ae1.localMin.polytype !== ae2.localMin.polytype &&
                    this._cliptype !== ClipType.Xor)) {
                resultOp = this.addLocalMaxPoly(ae1, ae2, pt);
            }
            else if (ClipperBase.isFront(ae1) || (ae1.outrec === ae2.outrec)) {
                // this 'else if' condition isn't strictly needed but
                // it's sensible to split polygons that only touch at
                // a common vertex (not at common edges).
                resultOp = this.addLocalMaxPoly(ae1, ae2, pt);
                this.addLocalMinPoly(ae1, ae2, pt);
            }
            else {
                // can't treat as maxima & minima
                resultOp = ClipperBase.addOutPt(ae1, pt);
                ClipperBase.addOutPt(ae2, pt);
                ClipperBase.swapOutrecs(ae1, ae2);
            }
        }
        // if one or the other edge is 'hot' ...
        else if (ClipperBase.isHotEdgeActive(ae1)) {
            resultOp = ClipperBase.addOutPt(ae1, pt);
            ClipperBase.swapOutrecs(ae1, ae2);
        }
        else if (ClipperBase.isHotEdgeActive(ae2)) {
            resultOp = ClipperBase.addOutPt(ae2, pt);
            ClipperBase.swapOutrecs(ae1, ae2);
        }
        // neither edge is 'hot'
        else {
            let e1Wc2;
            let e2Wc2;
            switch (this._fillrule) {
                case FillRule.Positive:
                    e1Wc2 = ae1.windCount2;
                    e2Wc2 = ae2.windCount2;
                    break;
                case FillRule.Negative:
                    e1Wc2 = -ae1.windCount2;
                    e2Wc2 = -ae2.windCount2;
                    break;
                default:
                    e1Wc2 = Math.abs(ae1.windCount2);
                    e2Wc2 = Math.abs(ae2.windCount2);
                    break;
            }
            if (!ClipperBase.isSamePolyType(ae1, ae2)) {
                resultOp = this.addLocalMinPoly(ae1, ae2, pt);
            }
            else if (oldE1WindCount === 1 && oldE2WindCount === 1) {
                resultOp = undefined;
                switch (this._cliptype) {
                    case ClipType.Union:
                        if (e1Wc2 > 0 && e2Wc2 > 0)
                            return undefined;
                        resultOp = this.addLocalMinPoly(ae1, ae2, pt);
                        break;
                    case ClipType.Difference:
                        if (((ClipperBase.getPolyType(ae1) === PathType.Clip) && (e1Wc2 > 0) && (e2Wc2 > 0)) ||
                            ((ClipperBase.getPolyType(ae1) === PathType.Subject) && (e1Wc2 <= 0) && (e2Wc2 <= 0))) {
                            resultOp = this.addLocalMinPoly(ae1, ae2, pt);
                        }
                        break;
                    case ClipType.Xor:
                        resultOp = this.addLocalMinPoly(ae1, ae2, pt);
                        break;
                    default: // ClipType.Intersection:
                        if (e1Wc2 <= 0 || e2Wc2 <= 0)
                            return undefined;
                        resultOp = this.addLocalMinPoly(ae1, ae2, pt);
                        break;
                }
            }
        }
        return resultOp;
    }
    deleteFromAEL(ae) {
        const prev = ae.prevInAEL;
        const next = ae.nextInAEL;
        if (!prev && !next && ae !== this._actives)
            return; // already deleted
        if (prev)
            prev.nextInAEL = next;
        else
            this._actives = next;
        if (next)
            next.prevInAEL = prev;
    }
    adjustCurrXAndCopyToSEL(topY) {
        let ae = this._actives;
        this._sel = ae;
        while (ae) {
            ae.prevInSEL = ae.prevInAEL;
            ae.nextInSEL = ae.nextInAEL;
            ae.jump = ae.nextInSEL;
            if (ae.joinWith === JoinWith.Left)
                ae.curX = ae.prevInAEL.curX; // This also avoids complications
            else
                ae.curX = ClipperBase.topX(ae, topY);
            // NB don't update ae.curr.Y yet (see AddNewIntersectNode)
            ae = ae.nextInAEL;
        }
    }
    executeInternal(ct, fillRule) {
        if (ct === ClipType.None)
            return;
        this._fillrule = fillRule;
        this._cliptype = ct;
        this.reset();
        let y = this.popScanline();
        if (y === undefined)
            return;
        while (this._succeeded) {
            this.insertLocalMinimaIntoAEL(y);
            let ae = this.popHorz();
            while (ae) {
                this.doHorizontal(ae);
                ae = this.popHorz();
            }
            if (this._horzSegList.length > 0) {
                this.convertHorzSegsToJoins();
                this._horzSegList.length = 0;
            }
            this._currentBotY = y; // bottom of scanbeam
            y = this.popScanline();
            if (y === undefined)
                break; // y new top of scanbeam
            this.doIntersections(y);
            this.doTopOfScanbeam(y);
            ae = this.popHorz();
            while (ae) {
                this.doHorizontal(ae);
                ae = this.popHorz();
            }
        }
        if (this._succeeded)
            this.processHorzJoins();
    }
    doIntersections(topY) {
        if (this.buildIntersectList(topY)) {
            this.processIntersectList();
            this.disposeIntersectNodes();
        }
    }
    disposeIntersectNodes() {
        this._intersectList.length = 0;
    }
    addNewIntersectNode(ae1, ae2, topY) {
        const result = InternalClipper.getIntersectPoint(ae1.bot, ae1.top, ae2.bot, ae2.top);
        let ip = result.ip;
        if (!result.success) {
            ip = new Point64(ae1.curX, topY);
        }
        if (ip.y > this._currentBotY || ip.y < topY) {
            const absDx1 = Math.abs(ae1.dx);
            const absDx2 = Math.abs(ae2.dx);
            if (absDx1 > 100 && absDx2 > 100) {
                if (absDx1 > absDx2) {
                    ip = InternalClipper.getClosestPtOnSegment(ip, ae1.bot, ae1.top);
                }
                else {
                    ip = InternalClipper.getClosestPtOnSegment(ip, ae2.bot, ae2.top);
                }
            }
            else if (absDx1 > 100) {
                ip = InternalClipper.getClosestPtOnSegment(ip, ae1.bot, ae1.top);
            }
            else if (absDx2 > 100) {
                ip = InternalClipper.getClosestPtOnSegment(ip, ae2.bot, ae2.top);
            }
            else {
                if (ip.y < topY) {
                    ip.y = topY;
                }
                else {
                    ip.y = this._currentBotY;
                }
                if (absDx1 < absDx2) {
                    ip.x = ClipperBase.topX(ae1, ip.y);
                }
                else {
                    ip.x = ClipperBase.topX(ae2, ip.y);
                }
            }
        }
        const node = new IntersectNode(ip, ae1, ae2);
        this._intersectList.push(node);
    }
    static extractFromSEL(ae) {
        const res = ae.nextInSEL;
        if (res) {
            res.prevInSEL = ae.prevInSEL;
        }
        ae.prevInSEL.nextInSEL = res;
        return res;
    }
    static insert1Before2InSEL(ae1, ae2) {
        ae1.prevInSEL = ae2.prevInSEL;
        if (ae1.prevInSEL) {
            ae1.prevInSEL.nextInSEL = ae1;
        }
        ae1.nextInSEL = ae2;
        ae2.prevInSEL = ae1;
    }
    buildIntersectList(topY) {
        if (!this._actives || !this._actives.nextInAEL)
            return false;
        // Calculate edge positions at the top of the current scanbeam, and from this
        // we will determine the intersections required to reach these new positions.
        this.adjustCurrXAndCopyToSEL(topY);
        // Find all edge intersections in the current scanbeam using a stable merge
        // sort that ensures only adjacent edges are intersecting. Intersect info is
        // stored in FIntersectList ready to be processed in ProcessIntersectList.
        // Re merge sorts see https://stackoverflow.com/a/46319131/359538
        let left = this._sel, right, lEnd, rEnd, currBase, prevBase, tmp;
        while (left.jump) {
            prevBase = undefined;
            while (left && left.jump) {
                currBase = left;
                right = left.jump;
                lEnd = right;
                rEnd = right.jump;
                left.jump = rEnd;
                while (left !== lEnd && right !== rEnd) {
                    if (right.curX < left.curX) {
                        tmp = right.prevInSEL;
                        for (;;) {
                            this.addNewIntersectNode(tmp, right, topY);
                            if (tmp === left)
                                break;
                            tmp = tmp.prevInSEL;
                        }
                        tmp = right;
                        right = ClipperBase.extractFromSEL(tmp);
                        lEnd = right;
                        ClipperBase.insert1Before2InSEL(tmp, left);
                        if (left === currBase) {
                            currBase = tmp;
                            currBase.jump = rEnd;
                            if (prevBase === undefined)
                                this._sel = currBase;
                            else
                                prevBase.jump = currBase;
                        }
                    }
                    else {
                        left = left.nextInSEL;
                    }
                }
                prevBase = currBase;
                left = rEnd;
            }
            left = this._sel;
        }
        return this._intersectList.length > 0;
    }
    processIntersectList() {
        // We now have a list of intersections required so that edges will be
        // correctly positioned at the top of the scanbeam. However, it's important
        // that edge intersections are processed from the bottom up, but it's also
        // crucial that intersections only occur between adjacent edges.
        // First we do a quicksort so intersections proceed in a bottom up order ...
        this._intersectList.sort((a, b) => {
            if (a.pt.y === b.pt.y) {
                if (a.pt.x === b.pt.x)
                    return 0;
                return (a.pt.x < b.pt.x) ? -1 : 1;
            }
            return (a.pt.y > b.pt.y) ? -1 : 1;
        });
        // Now as we process these intersections, we must sometimes adjust the order
        // to ensure that intersecting edges are always adjacent ...
        for (let i = 0; i < this._intersectList.length; ++i) {
            if (!ClipperBase.edgesAdjacentInAEL(this._intersectList[i])) {
                let j = i + 1;
                while (!ClipperBase.edgesAdjacentInAEL(this._intersectList[j]))
                    j++;
                // swap
                [this._intersectList[j], this._intersectList[i]] =
                    [this._intersectList[i], this._intersectList[j]];
            }
            const node = this._intersectList[i];
            this.intersectEdges(node.edge1, node.edge2, node.pt);
            this.swapPositionsInAEL(node.edge1, node.edge2);
            node.edge1.curX = node.pt.x;
            node.edge2.curX = node.pt.x;
            this.checkJoinLeft(node.edge2, node.pt, true);
            this.checkJoinRight(node.edge1, node.pt, true);
        }
    }
    swapPositionsInAEL(ae1, ae2) {
        // preconditon: ae1 must be immediately to the left of ae2
        const next = ae2.nextInAEL;
        if (next)
            next.prevInAEL = ae1;
        const prev = ae1.prevInAEL;
        if (prev)
            prev.nextInAEL = ae2;
        ae2.prevInAEL = prev;
        ae2.nextInAEL = ae1;
        ae1.prevInAEL = ae2;
        ae1.nextInAEL = next;
        if (!ae2.prevInAEL)
            this._actives = ae2;
    }
    static resetHorzDirection(horz, vertexMax) {
        let leftX, rightX;
        if (horz.bot.x === horz.top.x) {
            // the horizontal edge is going nowhere ...
            leftX = horz.curX;
            rightX = horz.curX;
            let ae = horz.nextInAEL;
            while (ae && ae.vertexTop !== vertexMax)
                ae = ae.nextInAEL;
            return { isLeftToRight: ae !== undefined, leftX, rightX };
        }
        if (horz.curX < horz.top.x) {
            leftX = horz.curX;
            rightX = horz.top.x;
            return { isLeftToRight: true, leftX, rightX };
        }
        leftX = horz.top.x;
        rightX = horz.curX;
        return { isLeftToRight: false, leftX, rightX }; // right to left
    }
    static horzIsSpike(horz) {
        const nextPt = ClipperBase.nextVertex(horz).pt;
        return (horz.bot.x < horz.top.x) !== (horz.top.x < nextPt.x);
    }
    static trimHorz(horzEdge, preserveCollinear) {
        let wasTrimmed = false;
        let pt = ClipperBase.nextVertex(horzEdge).pt;
        while (pt.y === horzEdge.top.y) {
            // always trim 180 deg. spikes (in closed paths)
            // but otherwise break if preserveCollinear = true
            if (preserveCollinear &&
                (pt.x < horzEdge.top.x) !== (horzEdge.bot.x < horzEdge.top.x)) {
                break;
            }
            horzEdge.vertexTop = ClipperBase.nextVertex(horzEdge);
            horzEdge.top = pt;
            wasTrimmed = true;
            if (ClipperBase.isMaximaActive(horzEdge))
                break;
            pt = ClipperBase.nextVertex(horzEdge).pt;
        }
        if (wasTrimmed)
            ClipperBase.setDx(horzEdge); // +/-infinity
    }
    addToHorzSegList(op) {
        if (op.outrec.isOpen)
            return;
        this._horzSegList.push(new HorzSegment(op));
    }
    getLastOp(hotEdge) {
        const outrec = hotEdge.outrec;
        return (hotEdge === outrec.frontEdge) ?
            outrec.pts : outrec.pts.next;
    }
    /*******************************************************************************
    * Notes: Horizontal edges (HEs) at scanline intersections (i.e. at the top or    *
    * bottom of a scanbeam) are processed as if layered.The order in which HEs     *
    * are processed doesn't matter. HEs intersect with the bottom vertices of      *
    * other HEs[#] and with non-horizontal edges [*]. Once these intersections     *
    * are completed, intermediate HEs are 'promoted' to the next edge in their     *
    * bounds, and they in turn may be intersected[%] by other HEs.                 *
    *                                                                              *
    * eg: 3 horizontals at a scanline:    /   |                     /           /  *
    *              |                     /    |     (HE3)o ========%========== o   *
    *              o ======= o(HE2)     /     |         /         /                *
    *          o ============#=========*======*========#=========o (HE1)           *
    *         /              |        /       |       /                            *
    *******************************************************************************/
    doHorizontal(horz) {
        let pt;
        const horzIsOpen = ClipperBase.isOpen(horz);
        const Y = horz.bot.y;
        const vertex_max = horzIsOpen ?
            ClipperBase.getCurrYMaximaVertex_Open(horz) :
            ClipperBase.getCurrYMaximaVertex(horz);
        // remove 180 deg.spikes and also simplify
        // consecutive horizontals when PreserveCollinear = true
        if (vertex_max && !horzIsOpen && vertex_max !== horz.vertexTop)
            ClipperBase.trimHorz(horz, this.preserveCollinear);
        let { isLeftToRight, leftX, rightX } = ClipperBase.resetHorzDirection(horz, vertex_max);
        if (ClipperBase.isHotEdgeActive(horz)) {
            const op = ClipperBase.addOutPt(horz, new Point64(horz.curX, Y));
            this.addToHorzSegList(op);
        }
        for (;;) {
            // loops through consec. horizontal edges (if open)
            let ae = isLeftToRight ? horz.nextInAEL : horz.prevInAEL;
            while (ae) {
                if (ae.vertexTop === vertex_max) {
                    // do this first!!
                    if (ClipperBase.isHotEdgeActive(horz) && ClipperBase.isJoined(ae))
                        this.split(ae, ae.top);
                    if (ClipperBase.isHotEdgeActive(horz)) {
                        while (horz.vertexTop !== vertex_max) {
                            ClipperBase.addOutPt(horz, horz.top);
                            this.updateEdgeIntoAEL(horz);
                        }
                        if (isLeftToRight)
                            this.addLocalMaxPoly(horz, ae, horz.top);
                        else
                            this.addLocalMaxPoly(ae, horz, horz.top);
                    }
                    this.deleteFromAEL(ae);
                    this.deleteFromAEL(horz);
                    return;
                }
                // if horzEdge is a maxima, keep going until we reach
                // its maxima pair, otherwise check for break conditions
                if (vertex_max !== horz.vertexTop || ClipperBase.isOpenEndActive(horz)) {
                    // otherwise stop when 'ae' is beyond the end of the horizontal line
                    if ((isLeftToRight && ae.curX > rightX) || (!isLeftToRight && ae.curX < leftX))
                        break;
                    if (ae.curX === horz.top.x && !ClipperBase.isHorizontal(ae)) {
                        pt = ClipperBase.nextVertex(horz).pt;
                        // to maximize the possibility of putting open edges into
                        // solutions, we'll only break if it's past HorzEdge's end
                        if (ClipperBase.isOpen(ae) && !ClipperBase.isSamePolyType(ae, horz) && !ClipperBase.isHotEdgeActive(ae)) {
                            if ((isLeftToRight && (ClipperBase.topX(ae, pt.y) > pt.x)) || (!isLeftToRight && (ClipperBase.topX(ae, pt.y) < pt.x)))
                                break;
                        }
                        // otherwise for edges at horzEdge's end, only stop when horzEdge's
                        // outslope is greater than e's slope when heading right or when
                        // horzEdge's outslope is less than e's slope when heading left.
                        else if ((isLeftToRight && (ClipperBase.topX(ae, pt.y) >= pt.x)) || (!isLeftToRight && (ClipperBase.topX(ae, pt.y) <= pt.x)))
                            break;
                    }
                }
                pt = new Point64(ae.curX, Y);
                if (isLeftToRight) {
                    this.intersectEdges(horz, ae, pt);
                    this.swapPositionsInAEL(horz, ae);
                    horz.curX = ae.curX;
                    ae = horz.nextInAEL;
                }
                else {
                    this.intersectEdges(ae, horz, pt);
                    this.swapPositionsInAEL(ae, horz);
                    horz.curX = ae.curX;
                    ae = horz.prevInAEL;
                }
                if (ClipperBase.isHotEdgeActive(horz))
                    this.addToHorzSegList(this.getLastOp(horz));
            } // we've reached the end of this horizontal
            // check if we've finished looping
            // through consecutive horizontals
            if (horzIsOpen && ClipperBase.isOpenEndActive(horz)) { // ie open at top
                if (ClipperBase.isHotEdgeActive(horz)) {
                    ClipperBase.addOutPt(horz, horz.top);
                    if (ClipperBase.isFront(horz))
                        horz.outrec.frontEdge = undefined;
                    else
                        horz.outrec.backEdge = undefined;
                    horz.outrec = undefined;
                }
                this.deleteFromAEL(horz);
                return;
            }
            else if (ClipperBase.nextVertex(horz).pt.y !== horz.top.y)
                break;
            // still more horizontals in bound to process ...
            if (ClipperBase.isHotEdgeActive(horz)) {
                ClipperBase.addOutPt(horz, horz.top);
            }
            this.updateEdgeIntoAEL(horz);
            if (this.preserveCollinear && !horzIsOpen && ClipperBase.horzIsSpike(horz)) {
                ClipperBase.trimHorz(horz, true);
            }
            const result = ClipperBase.resetHorzDirection(horz, vertex_max);
            isLeftToRight = result.isLeftToRight;
            leftX = result.leftX;
            rightX = result.rightX;
        }
        if (ClipperBase.isHotEdgeActive(horz)) {
            const op = ClipperBase.addOutPt(horz, horz.top);
            this.addToHorzSegList(op);
        }
        this.updateEdgeIntoAEL(horz);
    }
    doTopOfScanbeam(y) {
        this._sel = undefined; // _sel is reused to flag horizontals (see pushHorz below)
        let ae = this._actives;
        while (ae) {
            // NB 'ae' will never be horizontal here
            if (ae.top.y === y) {
                ae.curX = ae.top.x;
                if (ClipperBase.isMaximaActive(ae)) {
                    ae = this.doMaxima(ae); // TOP OF BOUND (MAXIMA)
                    continue;
                }
                // INTERMEDIATE VERTEX ...
                if (ClipperBase.isHotEdgeActive(ae))
                    ClipperBase.addOutPt(ae, ae.top);
                this.updateEdgeIntoAEL(ae);
                if (ClipperBase.isHorizontal(ae))
                    this.pushHorz(ae); // horizontals are processed later
            }
            else { // i.e. not the top of the edge
                ae.curX = ClipperBase.topX(ae, y);
            }
            ae = ae.nextInAEL;
        }
    }
    doMaxima(ae) {
        const prevE = ae.prevInAEL;
        let nextE = ae.nextInAEL;
        if (ClipperBase.isOpenEndActive(ae)) {
            if (ClipperBase.isHotEdgeActive(ae))
                ClipperBase.addOutPt(ae, ae.top);
            if (!ClipperBase.isHorizontal(ae)) {
                if (ClipperBase.isHotEdgeActive(ae)) {
                    if (ClipperBase.isFront(ae))
                        ae.outrec.frontEdge = undefined;
                    else
                        ae.outrec.backEdge = undefined;
                    ae.outrec = undefined;
                }
                this.deleteFromAEL(ae);
            }
            return nextE;
        }
        const maxPair = ClipperBase.getMaximaPair(ae);
        if (!maxPair)
            return nextE; // eMaxPair is horizontal
        if (ClipperBase.isJoined(ae))
            this.split(ae, ae.top);
        if (ClipperBase.isJoined(maxPair))
            this.split(maxPair, maxPair.top);
        // only non-horizontal maxima here.
        // process any edges between maxima pair ...
        while (nextE !== maxPair) {
            this.intersectEdges(ae, nextE, ae.top);
            this.swapPositionsInAEL(ae, nextE);
            nextE = ae.nextInAEL;
        }
        if (ClipperBase.isOpen(ae)) {
            if (ClipperBase.isHotEdgeActive(ae))
                this.addLocalMaxPoly(ae, maxPair, ae.top);
            this.deleteFromAEL(maxPair);
            this.deleteFromAEL(ae);
            return (prevE ? prevE.nextInAEL : this._actives);
        }
        // here ae.nextInAel == ENext == EMaxPair ...
        if (ClipperBase.isHotEdgeActive(ae))
            this.addLocalMaxPoly(ae, maxPair, ae.top);
        this.deleteFromAEL(ae);
        this.deleteFromAEL(maxPair);
        return (prevE ? prevE.nextInAEL : this._actives);
    }
    static isJoined(e) {
        return e.joinWith !== JoinWith.None;
    }
    split(e, currPt) {
        if (e.joinWith === JoinWith.Right) {
            e.joinWith = JoinWith.None;
            e.nextInAEL.joinWith = JoinWith.None;
            this.addLocalMinPoly(e, e.nextInAEL, currPt, true);
        }
        else {
            e.joinWith = JoinWith.None;
            e.prevInAEL.joinWith = JoinWith.None;
            this.addLocalMinPoly(e.prevInAEL, e, currPt, true);
        }
    }
    checkJoinLeft(e, pt, checkCurrX = false) {
        const prev = e.prevInAEL;
        if (!prev || ClipperBase.isOpen(e) || ClipperBase.isOpen(prev) ||
            !ClipperBase.isHotEdgeActive(e) || !ClipperBase.isHotEdgeActive(prev))
            return;
        if ((pt.y < e.top.y + 2 || pt.y < prev.top.y + 2) && // avoid trivial joins
            ((e.bot.y > pt.y) || (prev.bot.y > pt.y)))
            return; // (#490)
        if (checkCurrX) {
            if (Clipper.perpendicDistFromLineSqrd(pt, prev.bot, prev.top) > 0.25)
                return;
        }
        else if (e.curX !== prev.curX)
            return;
        if (InternalClipper.crossProduct(e.top, pt, prev.top) !== 0)
            return;
        if (e.outrec.idx === prev.outrec.idx)
            this.addLocalMaxPoly(prev, e, pt);
        else if (e.outrec.idx < prev.outrec.idx)
            ClipperBase.joinOutrecPaths(e, prev);
        else
            ClipperBase.joinOutrecPaths(prev, e);
        prev.joinWith = JoinWith.Right;
        e.joinWith = JoinWith.Left;
    }
    checkJoinRight(e, pt, checkCurrX = false) {
        const next = e.nextInAEL;
        if (ClipperBase.isOpen(e) || !ClipperBase.isHotEdgeActive(e) || ClipperBase.isJoined(e) ||
            !next || ClipperBase.isOpen(next) || !ClipperBase.isHotEdgeActive(next))
            return;
        if ((pt.y < e.top.y + 2 || pt.y < next.top.y + 2) && // avoid trivial joins
            ((e.bot.y > pt.y) || (next.bot.y > pt.y)))
            return; // (#490)
        if (checkCurrX) {
            if (Clipper.perpendicDistFromLineSqrd(pt, next.bot, next.top) > 0.25)
                return;
        }
        else if (e.curX !== next.curX)
            return;
        if (InternalClipper.crossProduct(e.top, pt, next.top) !== 0)
            return;
        if (e.outrec.idx === next.outrec.idx)
            this.addLocalMaxPoly(e, next, pt);
        else if (e.outrec.idx < next.outrec.idx)
            ClipperBase.joinOutrecPaths(e, next);
        else
            ClipperBase.joinOutrecPaths(next, e);
        e.joinWith = JoinWith.Right;
        next.joinWith = JoinWith.Left;
    }
    static fixOutRecPts(outrec) {
        let op = outrec.pts;
        do {
            op.outrec = outrec;
            op = op.next;
        } while (op !== outrec.pts);
    }
    static setHorzSegHeadingForward(hs, opP, opN) {
        if (opP.pt.x === opN.pt.x)
            return false;
        if (opP.pt.x < opN.pt.x) {
            hs.leftOp = opP;
            hs.rightOp = opN;
            hs.leftToRight = true;
        }
        else {
            hs.leftOp = opN;
            hs.rightOp = opP;
            hs.leftToRight = false;
        }
        return true;
    }
    static updateHorzSegment(hs) {
        const op = hs.leftOp;
        const outrec = this.getRealOutRec(op.outrec);
        const outrecHasEdges = outrec.frontEdge !== undefined;
        const curr_y = op.pt.y;
        let opP = op, opN = op;
        if (outrecHasEdges) {
            const opA = outrec.pts, opZ = opA.next;
            while (opP !== opZ && opP.prev.pt.y === curr_y)
                opP = opP.prev;
            while (opN !== opA && opN.next.pt.y === curr_y)
                opN = opN.next;
        }
        else {
            while (opP.prev !== opN && opP.prev.pt.y === curr_y)
                opP = opP.prev;
            while (opN.next !== opP && opN.next.pt.y === curr_y)
                opN = opN.next;
        }
        const result = this.setHorzSegHeadingForward(hs, opP, opN) && hs.leftOp.horz === undefined;
        if (result)
            hs.leftOp.horz = hs;
        else
            hs.rightOp = undefined; // (for sorting)
        return result;
    }
    static duplicateOp(op, insert_after) {
        const result = new OutPt(op.pt, op.outrec);
        if (insert_after) {
            result.next = op.next;
            result.next.prev = result;
            result.prev = op;
            op.next = result;
        }
        else {
            result.prev = op.prev;
            result.prev.next = result;
            result.next = op;
            op.prev = result;
        }
        return result;
    }
    convertHorzSegsToJoins() {
        let k = 0;
        for (const hs of this._horzSegList) {
            if (ClipperBase.updateHorzSegment(hs))
                k++;
        }
        if (k < 2)
            return;
        this._horzSegList.sort((hs1, hs2) => {
            if (!hs1 || !hs2)
                return 0;
            if (!hs1.rightOp) {
                return !hs2.rightOp ? 0 : 1;
            }
            else if (!hs2.rightOp)
                return -1;
            else
                return hs1.leftOp.pt.x - hs2.leftOp.pt.x;
        });
        for (let i = 0; i < k - 1; i++) {
            const hs1 = this._horzSegList[i];
            // for each HorzSegment, find others that overlap
            for (let j = i + 1; j < k; j++) {
                const hs2 = this._horzSegList[j];
                if (hs2.leftOp.pt.x >= hs1.rightOp.pt.x ||
                    hs2.leftToRight === hs1.leftToRight ||
                    hs2.rightOp.pt.x <= hs1.leftOp.pt.x)
                    continue;
                const curr_y = hs1.leftOp.pt.y;
                if (hs1.leftToRight) {
                    while (hs1.leftOp.next.pt.y === curr_y &&
                        hs1.leftOp.next.pt.x <= hs2.leftOp.pt.x) {
                        hs1.leftOp = hs1.leftOp.next;
                    }
                    while (hs2.leftOp.prev.pt.y === curr_y &&
                        hs2.leftOp.prev.pt.x <= hs1.leftOp.pt.x) {
                        hs2.leftOp = hs2.leftOp.prev;
                    }
                    const join = new HorzJoin(ClipperBase.duplicateOp(hs1.leftOp, true), ClipperBase.duplicateOp(hs2.leftOp, false));
                    this._horzJoinList.push(join);
                }
                else {
                    while (hs1.leftOp.prev.pt.y === curr_y &&
                        hs1.leftOp.prev.pt.x <= hs2.leftOp.pt.x) {
                        hs1.leftOp = hs1.leftOp.prev;
                    }
                    while (hs2.leftOp.next.pt.y === curr_y &&
                        hs2.leftOp.next.pt.x <= hs1.leftOp.pt.x) {
                        hs2.leftOp = hs2.leftOp.next;
                    }
                    const join = new HorzJoin(ClipperBase.duplicateOp(hs2.leftOp, true), ClipperBase.duplicateOp(hs1.leftOp, false));
                    this._horzJoinList.push(join);
                }
            }
        }
    }
    static getCleanPath(op) {
        const result = new Path64();
        let op2 = op;
        while (op2.next !== op &&
            ((op2.pt.x === op2.next.pt.x && op2.pt.x === op2.prev.pt.x) ||
                (op2.pt.y === op2.next.pt.y && op2.pt.y === op2.prev.pt.y))) {
            op2 = op2.next;
        }
        result.push(op2.pt);
        let prevOp = op2;
        op2 = op2.next;
        while (op2 !== op) {
            if ((op2.pt.x !== op2.next.pt.x || op2.pt.x !== prevOp.pt.x) &&
                (op2.pt.y !== op2.next.pt.y || op2.pt.y !== prevOp.pt.y)) {
                result.push(op2.pt);
                prevOp = op2;
            }
            op2 = op2.next;
        }
        return result;
    }
    static pointInOpPolygon(pt, op) {
        if (op === op.next || op.prev === op.next)
            return PointInPolygonResult.IsOutside;
        let op2 = op;
        do {
            if (op.pt.y !== pt.y)
                break;
            op = op.next;
        } while (op !== op2);
        if (op.pt.y === pt.y) // not a proper polygon
            return PointInPolygonResult.IsOutside;
        let isAbove = op.pt.y < pt.y;
        const startingAbove = isAbove;
        let val = 0;
        op2 = op.next;
        while (op2 !== op) {
            if (isAbove)
                while (op2 !== op && op2.pt.y < pt.y)
                    op2 = op2.next;
            else
                while (op2 !== op && op2.pt.y > pt.y)
                    op2 = op2.next;
            if (op2 === op)
                break;
            if (op2.pt.y === pt.y) {
                if (op2.pt.x === pt.x || (op2.pt.y === op2.prev.pt.y &&
                    (pt.x < op2.prev.pt.x) !== (pt.x < op2.pt.x)))
                    return PointInPolygonResult.IsOn;
                op2 = op2.next;
                if (op2 === op)
                    break;
                continue;
            }
            if (op2.pt.x <= pt.x || op2.prev.pt.x <= pt.x) {
                if (op2.prev.pt.x < pt.x && op2.pt.x < pt.x)
                    val = 1 - val;
                else {
                    const d = InternalClipper.crossProduct(op2.prev.pt, op2.pt, pt);
                    if (d === 0)
                        return PointInPolygonResult.IsOn;
                    if ((d < 0) === isAbove)
                        val = 1 - val;
                }
            }
            isAbove = !isAbove;
            op2 = op2.next;
        }
        if (isAbove !== startingAbove) {
            const d = InternalClipper.crossProduct(op2.prev.pt, op2.pt, pt);
            if (d === 0)
                return PointInPolygonResult.IsOn;
            if ((d < 0) === isAbove)
                val = 1 - val;
        }
        if (val === 0)
            return PointInPolygonResult.IsOutside;
        else
            return PointInPolygonResult.IsInside;
    }
    static path1InsidePath2(op1, op2) {
        let result;
        let outside_cnt = 0;
        let op = op1;
        do {
            result = this.pointInOpPolygon(op.pt, op2);
            if (result === PointInPolygonResult.IsOutside)
                ++outside_cnt;
            else if (result === PointInPolygonResult.IsInside)
                --outside_cnt;
            op = op.next;
        } while (op !== op1 && Math.abs(outside_cnt) < 2);
        if (Math.abs(outside_cnt) > 1)
            return (outside_cnt < 0);
        const mp = ClipperBase.getBoundsPath(this.getCleanPath(op1)).midPoint();
        const path2 = this.getCleanPath(op2);
        return InternalClipper.pointInPolygon(mp, path2) !== PointInPolygonResult.IsOutside;
    }
    moveSplits(fromOr, toOr) {
        if (!fromOr.splits)
            return;
        toOr.splits = toOr.splits || [];
        for (const i of fromOr.splits) {
            toOr.splits.push(i);
        }
        fromOr.splits = undefined;
    }
    processHorzJoins() {
        for (const j of this._horzJoinList) {
            const or1 = ClipperBase.getRealOutRec(j.op1.outrec);
            let or2 = ClipperBase.getRealOutRec(j.op2.outrec);
            const op1b = j.op1.next;
            const op2b = j.op2.prev;
            j.op1.next = j.op2;
            j.op2.prev = j.op1;
            op1b.prev = op2b;
            op2b.next = op1b;
            if (or1 === or2) {
                or2 = this.newOutRec();
                or2.pts = op1b;
                ClipperBase.fixOutRecPts(or2);
                if (or1.pts.outrec === or2) {
                    or1.pts = j.op1;
                    or1.pts.outrec = or1;
                }
                if (this._using_polytree) {
                    if (ClipperBase.path1InsidePath2(or1.pts, or2.pts)) {
                        const tmp = or1.pts;
                        or1.pts = or2.pts;
                        or2.pts = tmp;
                        ClipperBase.fixOutRecPts(or1);
                        ClipperBase.fixOutRecPts(or2);
                        or2.owner = or1;
                    }
                    else if (ClipperBase.path1InsidePath2(or2.pts, or1.pts)) {
                        or2.owner = or1;
                    }
                    else {
                        or2.owner = or1.owner;
                    }
                    or1.splits = or1.splits || [];
                    or1.splits.push(or2.idx);
                }
                else {
                    or2.owner = or1;
                }
            }
            else {
                or2.pts = undefined;
                if (this._using_polytree) {
                    ClipperBase.setOwner(or2, or1);
                    this.moveSplits(or2, or1);
                }
                else {
                    or2.owner = or1;
                }
            }
        }
    }
    static ptsReallyClose(pt1, pt2) {
        return (Math.abs(pt1.x - pt2.x) < 2) && (Math.abs(pt1.y - pt2.y) < 2);
    }
    static isVerySmallTriangle(op) {
        return op.next.next === op.prev &&
            (this.ptsReallyClose(op.prev.pt, op.next.pt) ||
                this.ptsReallyClose(op.pt, op.next.pt) ||
                this.ptsReallyClose(op.pt, op.prev.pt));
    }
    static isValidClosedPath(op) {
        return op !== undefined && op.next !== op &&
            (op.next !== op.prev || !this.isVerySmallTriangle(op));
    }
    static disposeOutPt(op) {
        const result = op.next === op ? undefined : op.next;
        op.prev.next = op.next;
        op.next.prev = op.prev;
        return result;
    }
    cleanCollinear(outrec) {
        outrec = ClipperBase.getRealOutRec(outrec);
        if (outrec === undefined || outrec.isOpen)
            return;
        if (!ClipperBase.isValidClosedPath(outrec.pts)) {
            outrec.pts = undefined;
            return;
        }
        let startOp = outrec.pts;
        let op2 = startOp;
        for (;;) {
            // NB if preserveCollinear == true, then only remove 180 deg. spikes
            if (InternalClipper.crossProduct(op2.prev.pt, op2.pt, op2.next.pt) === 0 &&
                (op2.pt === op2.prev.pt || op2.pt === op2.next.pt || !this.preserveCollinear ||
                    InternalClipper.dotProduct(op2.prev.pt, op2.pt, op2.next.pt) < 0)) {
                if (op2 === outrec.pts) {
                    outrec.pts = op2.prev;
                }
                op2 = ClipperBase.disposeOutPt(op2);
                if (!ClipperBase.isValidClosedPath(op2)) {
                    outrec.pts = undefined;
                    return;
                }
                startOp = op2;
                continue;
            }
            op2 = op2.next;
            if (op2 === startOp)
                break;
        }
        this.fixSelfIntersects(outrec);
    }
    doSplitOp(outrec, splitOp) {
        // splitOp.prev <=> splitOp &&
        // splitOp.next <=> splitOp.next.next are intersecting
        const prevOp = splitOp.prev;
        const nextNextOp = splitOp.next.next;
        outrec.pts = prevOp;
        const ip = InternalClipper.getIntersectPoint(prevOp.pt, splitOp.pt, splitOp.next.pt, nextNextOp.pt).ip;
        const area1 = ClipperBase.area(prevOp);
        const absArea1 = Math.abs(area1);
        if (absArea1 < 2) {
            outrec.pts = undefined;
            return;
        }
        const area2 = ClipperBase.areaTriangle(ip, splitOp.pt, splitOp.next.pt);
        const absArea2 = Math.abs(area2);
        // de-link splitOp and splitOp.next from the path
        // while inserting the intersection point
        if (ip === prevOp.pt || ip === nextNextOp.pt) {
            nextNextOp.prev = prevOp;
            prevOp.next = nextNextOp;
        }
        else {
            const newOp2 = new OutPt(ip, outrec);
            newOp2.prev = prevOp;
            newOp2.next = nextNextOp;
            nextNextOp.prev = newOp2;
            prevOp.next = newOp2;
        }
        // nb: area1 is the path's area *before* splitting, whereas area2 is
        // the area of the triangle containing splitOp & splitOp.next.
        // So the only way for these areas to have the same sign is if
        // the split triangle is larger than the path containing prevOp or
        // if there's more than one self=intersection.
        if (absArea2 > 1 &&
            (absArea2 > absArea1 || (area2 > 0) === (area1 > 0))) {
            const newOutRec = this.newOutRec();
            newOutRec.owner = outrec.owner;
            splitOp.outrec = newOutRec;
            splitOp.next.outrec = newOutRec;
            const newOp = new OutPt(ip, newOutRec);
            newOp.prev = splitOp.next;
            newOp.next = splitOp;
            newOutRec.pts = newOp;
            splitOp.prev = newOp;
            splitOp.next.next = newOp;
            if (this._using_polytree) {
                if (ClipperBase.path1InsidePath2(prevOp, newOp)) {
                    newOutRec.splits = newOutRec.splits || [];
                    newOutRec.splits.push(outrec.idx);
                }
                else {
                    outrec.splits = outrec.splits || [];
                    outrec.splits.push(newOutRec.idx);
                }
            }
        }
        // else { splitOp = undefined; splitOp.next = undefined; }
    }
    fixSelfIntersects(outrec) {
        let op2 = outrec.pts;
        for (;;) {
            if (op2.prev === op2.next.next)
                break;
            if (InternalClipper.segsIntersect(op2.prev.pt, op2.pt, op2.next.pt, op2.next.next.pt)) {
                this.doSplitOp(outrec, op2);
                if (!outrec.pts)
                    return;
                op2 = outrec.pts;
                continue;
            }
            else {
                op2 = op2.next;
            }
            if (op2 === outrec.pts)
                break;
        }
    }
    static buildPath(op, reverse, isOpen, path) {
        if (op === undefined || op.next === op || (!isOpen && op.next === op.prev))
            return false;
        path.length = 0;
        let lastPt;
        let op2;
        if (reverse) {
            lastPt = op.pt;
            op2 = op.prev;
        }
        else {
            op = op.next;
            lastPt = op.pt;
            op2 = op.next;
        }
        path.push(lastPt);
        while (op2 !== op) {
            if (op2.pt !== lastPt) {
                lastPt = op2.pt;
                path.push(lastPt);
            }
            if (reverse) {
                op2 = op2.prev;
            }
            else {
                op2 = op2.next;
            }
        }
        if (path.length === 3 && this.isVerySmallTriangle(op2))
            return false;
        else
            return true;
    }
    buildPaths(solutionClosed, solutionOpen) {
        solutionClosed.length = 0;
        solutionOpen.length = 0;
        let i = 0;
        while (i < this._outrecList.length) {
            const outrec = this._outrecList[i++];
            if (!outrec.pts)
                continue;
            const path = new Path64();
            if (outrec.isOpen) {
                if (ClipperBase.buildPath(outrec.pts, this.reverseSolution, true, path)) {
                    solutionOpen.push(path);
                }
            }
            else {
                this.cleanCollinear(outrec);
                // closed paths should always return a Positive orientation
                // except when reverseSolution == true
                if (ClipperBase.buildPath(outrec.pts, this.reverseSolution, false, path)) {
                    solutionClosed.push(path);
                }
            }
        }
        return true;
    }
    static getBoundsPath(path) {
        if (path.length === 0)
            return new Rect64();
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
        return result;
    }
    checkBounds(outrec) {
        if (outrec.pts === undefined)
            return false;
        if (!outrec.bounds.isEmpty())
            return true;
        this.cleanCollinear(outrec);
        if (outrec.pts === undefined || !ClipperBase.buildPath(outrec.pts, this.reverseSolution, false, outrec.path))
            return false;
        outrec.bounds = ClipperBase.getBoundsPath(outrec.path);
        return true;
    }
    checkSplitOwner(outrec, splits) {
        for (const i of splits) {
            const split = ClipperBase.getRealOutRec(this._outrecList[i]);
            if (split === undefined || split === outrec || split.recursiveSplit === outrec)
                continue;
            split.recursiveSplit = outrec; //#599
            if (split.splits !== undefined && this.checkSplitOwner(outrec, split.splits))
                return true;
            if (ClipperBase.isValidOwner(outrec, split) &&
                this.checkBounds(split) &&
                split.bounds.containsRect(outrec.bounds) &&
                ClipperBase.path1InsidePath2(outrec.pts, split.pts)) {
                outrec.owner = split; //found in split
                return true;
            }
        }
        return false;
    }
    recursiveCheckOwners(outrec, polypath) {
        // pre-condition: outrec will have valid bounds
        // post-condition: if a valid path, outrec will have a polypath
        if (outrec.polypath !== undefined || outrec.bounds.isEmpty())
            return;
        while (outrec.owner !== undefined) {
            if (outrec.owner.splits !== undefined &&
                this.checkSplitOwner(outrec, outrec.owner.splits))
                break;
            else if (outrec.owner.pts !== undefined && this.checkBounds(outrec.owner) &&
                ClipperBase.path1InsidePath2(outrec.pts, outrec.owner.pts))
                break;
            outrec.owner = outrec.owner.owner;
        }
        if (outrec.owner !== undefined) {
            if (outrec.owner.polypath === undefined)
                this.recursiveCheckOwners(outrec.owner, polypath);
            outrec.polypath = outrec.owner.polypath.addChild(outrec.path);
        }
        else {
            outrec.polypath = polypath.addChild(outrec.path);
        }
    }
    buildTree(polytree, solutionOpen) {
        polytree.clear();
        solutionOpen.length = 0;
        let i = 0;
        while (i < this._outrecList.length) {
            const outrec = this._outrecList[i++];
            if (outrec.pts === undefined)
                continue;
            if (outrec.isOpen) {
                const open_path = new Path64();
                if (ClipperBase.buildPath(outrec.pts, this.reverseSolution, true, open_path))
                    solutionOpen.push(open_path);
                continue;
            }
            if (this.checkBounds(outrec))
                this.recursiveCheckOwners(outrec, polytree);
        }
    }
    getBounds() {
        const bounds = Clipper.InvalidRect64;
        for (const t of this._vertexList) {
            let v = t;
            do {
                if (v.pt.x < bounds.left)
                    bounds.left = v.pt.x;
                if (v.pt.x > bounds.right)
                    bounds.right = v.pt.x;
                if (v.pt.y < bounds.top)
                    bounds.top = v.pt.y;
                if (v.pt.y > bounds.bottom)
                    bounds.bottom = v.pt.y;
                v = v.next;
            } while (v !== t);
        }
        return bounds.isEmpty() ? new Rect64(0, 0, 0, 0) : bounds;
    }
}
export class Clipper64 extends ClipperBase {
    addPath(path, polytype, isOpen = false) {
        super.addPath(path, polytype, isOpen);
    }
    addReusableData(reusableData) {
        super.addReuseableData(reusableData);
    }
    addPaths(paths, polytype, isOpen = false) {
        super.addPaths(paths, polytype, isOpen);
    }
    addSubjectPaths(paths) {
        this.addPaths(paths, PathType.Subject);
    }
    addOpenSubjectPaths(paths) {
        this.addPaths(paths, PathType.Subject, true);
    }
    addClipPaths(paths) {
        this.addPaths(paths, PathType.Clip);
    }
    execute(clipType, fillRule, solutionClosed, solutionOpen = new Paths64()) {
        solutionClosed.length = 0;
        solutionOpen.length = 0;
        try {
            this.executeInternal(clipType, fillRule);
            this.buildPaths(solutionClosed, solutionOpen);
        }
        catch (error) {
            this._succeeded = false;
        }
        this.clearSolutionOnly();
        return this._succeeded;
    }
    executePolyTree(clipType, fillRule, polytree, openPaths = new Paths64()) {
        polytree.clear();
        openPaths.length = 0;
        this._using_polytree = true;
        try {
            this.executeInternal(clipType, fillRule);
            this.buildTree(polytree, openPaths);
        }
        catch (error) {
            this._succeeded = false;
        }
        this.clearSolutionOnly();
        return this._succeeded;
    }
}
export class PolyPathBase {
    get isHole() {
        return this.getIsHole();
    }
    constructor(parent) {
        this.children = [];
        this.forEach = this.children.forEach;
        this._parent = parent;
    }
    getLevel() {
        let result = 0;
        let pp = this._parent;
        while (pp !== undefined) {
            ++result;
            pp = pp._parent;
        }
        return result;
    }
    get level() {
        return this.getLevel();
    }
    getIsHole() {
        const lvl = this.getLevel();
        return lvl !== 0 && (lvl & 1) === 0;
    }
    get count() {
        return this.children.length;
    }
    clear() {
        this.children.length = 0;
    }
    toStringInternal(idx, level) {
        let result = "", padding = "", plural = "s";
        if (this.children.length === 1)
            plural = "";
        padding = padding.padStart(level * 2);
        if ((level & 1) === 0)
            result += `${padding}+- hole (${idx}) contains ${this.children.length} nested polygon${plural}.\n`;
        else
            result += `${padding}+- polygon (${idx}) contains ${this.children.length} hole${plural}.\n`;
        for (let i = 0; i < this.children.length; i++)
            if (this.children[i].children.length > 0)
                result += this.children[i].toStringInternal(i, level + 1);
        return result;
    }
    toString() {
        if (this.level > 0)
            return ""; //only accept tree root
        let plural = "s";
        if (this.children.length === 1)
            plural = "";
        let result = `Polytree with ${this.children.length} polygon${plural}.\n`;
        for (let i = 0; i < this.children.length; i++)
            if (this.children[i].children.length > 0)
                result += this.children[i].toStringInternal(i, 1);
        return result + '\n';
    }
} // end of PolyPathBase class
export class PolyPath64 extends PolyPathBase {
    constructor(parent) {
        super(parent);
    }
    addChild(p) {
        const newChild = new PolyPath64(this);
        newChild.polygon = p;
        this.children.push(newChild);
        return newChild;
    }
    get(index) {
        if (index < 0 || index >= this.children.length) {
            throw new Error("InvalidOperationException");
        }
        return this.children[index];
    }
    child(index) {
        if (index < 0 || index >= this.children.length) {
            throw new Error("InvalidOperationException");
        }
        return this.children[index];
    }
    area() {
        let result = this.polygon ? Clipper.area(this.polygon) : 0;
        for (const polyPathBase of this.children) {
            const child = polyPathBase;
            result += child.area();
        }
        return result;
    }
}
export class PolyTree64 extends PolyPath64 {
}
export class ClipperLibException extends Error {
    constructor(description) {
        super(description);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZW5naW5lLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vcHJvamVjdHMvY2xpcHBlcjItanMvc3JjL2xpYi9lbmdpbmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7OztnRkFTZ0Y7QUFFaEYsT0FBTyxFQUFFLE9BQU8sRUFBRSxNQUFNLFdBQVcsQ0FBQztBQUNwQyxPQUFPLEVBQUUsUUFBUSxFQUFFLFFBQVEsRUFBWSxlQUFlLEVBQUUsZ0JBQWdCLEVBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0sRUFBRSxhQUFhLEVBQUUsTUFBTSxRQUFRLENBQUM7QUFFcEosRUFBRTtBQUNGLHlIQUF5SDtBQUN6SCw2QkFBNkI7QUFDN0IsRUFBRTtBQUNGLDRHQUE0RztBQUM1RyxFQUFFO0FBRUYsTUFBTSxDQUFOLElBQVksb0JBSVg7QUFKRCxXQUFZLG9CQUFvQjtJQUM5QiwrREFBUSxDQUFBO0lBQ1IsdUVBQVksQ0FBQTtJQUNaLHlFQUFhLENBQUE7QUFDZixDQUFDLEVBSlcsb0JBQW9CLEtBQXBCLG9CQUFvQixRQUkvQjtBQUVELE1BQU0sQ0FBTixJQUFZLFdBTVg7QUFORCxXQUFZLFdBQVc7SUFDckIsNkNBQVEsQ0FBQTtJQUNSLHVEQUFhLENBQUE7SUFDYixtREFBVyxDQUFBO0lBQ1gscURBQVksQ0FBQTtJQUNaLHFEQUFZLENBQUE7QUFDZCxDQUFDLEVBTlcsV0FBVyxLQUFYLFdBQVcsUUFNdEI7QUFFRCxNQUFNLE1BQU07SUFNVixZQUFZLEVBQVksRUFBRSxLQUFrQixFQUFFLElBQXdCO1FBQ3BFLElBQUksQ0FBQyxFQUFFLEdBQUcsRUFBRSxDQUFDO1FBQ2IsSUFBSSxDQUFDLEtBQUssR0FBRyxLQUFLLENBQUM7UUFDbkIsSUFBSSxDQUFDLElBQUksR0FBRyxTQUFTLENBQUM7UUFDdEIsSUFBSSxDQUFDLElBQUksR0FBRyxJQUFJLENBQUM7SUFDbkIsQ0FBQztDQUNG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RUQsR0FBRyxDQUFDLEtBQWE7UUFDZixJQUFJLEtBQUssR0FBRyxDQUFDLElBQUksS0FBSyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsTUFBTSxFQUFFO1lBQzlDLE1BQU0sSUFBSSxLQUFLLENBQUMsMkJBQTJCLENBQUMsQ0FBQztTQUM5QztRQUNELE9BQU8sSUFBSSxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQWUsQ0FBQztJQUM1QyxDQUFDO0lBRUQsS0FBSyxDQUFDLEtBQWE7UUFDakIsSUFBSSxLQUFLLEdBQUcsQ0FBQyxJQUFJLEtBQUssSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLE1BQU0sRUFBRTtZQUM5QyxNQUFNLElBQUksS0FBSyxDQUFDLDJCQUEyQixDQUFDLENBQUM7U0FDOUM7UUFDRCxPQUFPLElBQUksQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFlLENBQUM7SUFDNUMsQ0FBQztJQUVELElBQUk7UUFDRixJQUFJLE1BQU0sR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBQzNELEtBQUssTUFBTSxZQUFZLElBQUksSUFBSSxDQUFDLFFBQVEsRUFBRTtZQUN4QyxNQUFNLEtBQUssR0FBRyxZQUEwQixDQUFDO1lBQ3pDLE1BQU0sSUFBSSxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7U0FDeEI7UUFDRCxPQUFPLE1BQU0sQ0FBQztJQUNoQixDQUFDO0NBQ0Y7QUFHRCxNQUFNLE9BQU8sVUFBVyxTQUFRLFVBQVU7Q0FBSTtBQUc5QyxNQUFNLE9BQU8sbUJBQW9CLFNBQVEsS0FBSztJQUM1QyxZQUFZLFdBQW1CO1FBQzdCLEtBQUssQ0FBQyxXQUFXLENBQUMsQ0FBQztJQUNyQixDQUFDO0NBQ0YiLCJzb3VyY2VzQ29udGVudCI6WyIvKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKlxyXG4qIEF1dGhvciAgICA6ICBBbmd1cyBKb2huc29uICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIERhdGUgICAgICA6ICAzIFNlcHRlbWJlciAyMDIzICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbiogV2Vic2l0ZSAgIDogIGh0dHA6Ly93d3cuYW5ndXNqLmNvbSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbiogQ29weXJpZ2h0IDogIEFuZ3VzIEpvaG5zb24gMjAxMC0yMDIzICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbiogUHVycG9zZSAgIDogIFRoaXMgaXMgdGhlIG1haW4gcG9seWdvbiBjbGlwcGluZyBtb2R1bGUgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbiogVGhhbmtzICAgIDogIFNwZWNpYWwgdGhhbmtzIHRvIFRob25nIE5ndXllbiwgR3V1cyBLdWlwZXIsIFBoaWwgU3RvcGZvcmQsICAgICAqXHJcbiogICAgICAgICAgIDogIGFuZCBEYW5pZWwgR29zbmVsbCBmb3IgdGhlaXIgaW52YWx1YWJsZSBhc3Npc3RhbmNlIHdpdGggQyMuICAgICAqXHJcbiogTGljZW5zZSAgIDogIGh0dHA6Ly93d3cuYm9vc3Qub3JnL0xJQ0VOU0VfMV8wLnR4dCAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXHJcblxyXG5pbXBvcnQgeyBDbGlwcGVyIH0gZnJvbSBcIi4vY2xpcHBlclwiO1xyXG5pbXBvcnQgeyBDbGlwVHlwZSwgRmlsbFJ1bGUsIElQb2ludDY0LCBJbnRlcm5hbENsaXBwZXIsIE1pZHBvaW50Um91bmRpbmcsIFBhdGg2NCwgUGF0aFR5cGUsIFBhdGhzNjQsIFBvaW50NjQsIFJlY3Q2NCwgbWlkUG9pbnRSb3VuZCB9IGZyb20gXCIuL2NvcmVcIjtcclxuXHJcbi8vXHJcbi8vIENvbnZlcnRlZCBmcm9tIEMjIGltcGxlbWVudGlvbiBodHRwczovL2dpdGh1Yi5jb20vQW5ndXNKb2huc29uL0NsaXBwZXIyL2Jsb2IvbWFpbi9DU2hhcnAvQ2xpcHBlcjJMaWIvQ2xpcHBlci5FbmdpbmUuY3NcclxuLy8gUmVtb3ZlZCBzdXBwb3J0IGZvciBVU0lOR1pcclxuLy9cclxuLy8gQ29udmVydGVkIGJ5IENoYXRHUFQgNCBBdWd1c3QgMyB2ZXJzaW9uIGh0dHBzOi8vaGVscC5vcGVuYWkuY29tL2VuL2FydGljbGVzLzY4MjU0NTMtY2hhdGdwdC1yZWxlYXNlLW5vdGVzXHJcbi8vXHJcblxyXG5leHBvcnQgZW51bSBQb2ludEluUG9seWdvblJlc3VsdCB7XHJcbiAgSXNPbiA9IDAsXHJcbiAgSXNJbnNpZGUgPSAxLFxyXG4gIElzT3V0c2lkZSA9IDJcclxufVxyXG5cclxuZXhwb3J0IGVudW0gVmVydGV4RmxhZ3Mge1xyXG4gIE5vbmUgPSAwLFxyXG4gIE9wZW5TdGFydCA9IDEsXHJcbiAgT3BlbkVuZCA9IDIsXHJcbiAgTG9jYWxNYXggPSA0LFxyXG4gIExvY2FsTWluID0gOFxyXG59XHJcblxyXG5jbGFzcyBWZXJ0ZXgge1xyXG4gIHJlYWRvbmx5IHB0OiBJUG9pbnQ2NDtcclxuICBuZXh0OiBWZXJ0ZXggfCB1bmRlZmluZWQ7XHJcbiAgcHJldjogVmVydGV4IHwgdW5kZWZpbmVkO1xyXG4gIGZsYWdzOiBWZXJ0ZXhGbGFncztcclxuXHJcbiAgY29uc3RydWN0b3IocHQ6IElQb2ludDY0LCBmbGFnczogVmVydGV4RmxhZ3MsIHByZXY6IFZlcnRleCB8IHVuZGVmaW5lZCkge1xyXG4gICAgdGhpcy5wdCA9IHB0O1xyXG4gICAgdGhpcy5mbGFncyA9IGZsYWdzO1xyXG4gICAgdGhpcy5uZXh0ID0gdW5kZWZpbmVkO1xyXG4gICAgdGhpcy5wcmV2ID0gcHJldjtcclxuICB9XHJcbn1cclxuXHJcblxyXG5jbGFzcyBMb2NhbE1pbmltYSB7XHJcbiAgcmVhZG9ubHkgdmVydGV4OiBWZXJ0ZXg7XHJcbiAgcmVhZG9ubHkgcG9seXR5cGU6IFBhdGhUeXBlO1xyXG4gIHJlYWRvbmx5IGlzT3BlbjogYm9vbGVhbjtcclxuXHJcbiAgY29uc3RydWN0b3IodmVydGV4OiBWZXJ0ZXgsIHBvbHl0eXBlOiBQYXRoVHlwZSwgaXNPcGVuOiBib29sZWFuID0gZmFsc2UpIHtcclxuICAgIHRoaXMudmVydGV4ID0gdmVydGV4O1xyXG4gICAgdGhpcy5wb2x5dHlwZSA9IHBvbHl0eXBlO1xyXG4gICAgdGhpcy5pc09wZW4gPSBpc09wZW47XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgZXF1YWxzKGxtMTogTG9jYWxNaW5pbWEsIGxtMjogTG9jYWxNaW5pbWEpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBsbTEudmVydGV4ID09PSBsbTIudmVydGV4O1xyXG4gIH1cclxuXHJcbiAgc3RhdGljIG5vdEVxdWFscyhsbTE6IExvY2FsTWluaW1hLCBsbTI6IExvY2FsTWluaW1hKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gbG0xLnZlcnRleCAhPT0gbG0yLnZlcnRleDtcclxuICB9XHJcblxyXG4gIC8vaGFzaENvZGUoKTogbnVtYmVyIHtcclxuICAvLyAgcmV0dXJuIHRoaXMudmVydGV4Lmhhc2hDb2RlKCk7XHJcbiAgLy99XHJcbn1cclxuXHJcbmNsYXNzIEludGVyc2VjdE5vZGUge1xyXG4gIHJlYWRvbmx5IHB0OiBJUG9pbnQ2NDtcclxuICByZWFkb25seSBlZGdlMTogQWN0aXZlO1xyXG4gIHJlYWRvbmx5IGVkZ2UyOiBBY3RpdmU7XHJcblxyXG4gIGNvbnN0cnVjdG9yKHB0OiBJUG9pbnQ2NCwgZWRnZTE6IEFjdGl2ZSwgZWRnZTI6IEFjdGl2ZSkge1xyXG4gICAgdGhpcy5wdCA9IHB0O1xyXG4gICAgdGhpcy5lZGdlMSA9IGVkZ2UxO1xyXG4gICAgdGhpcy5lZGdlMiA9IGVkZ2UyO1xyXG4gIH1cclxufVxyXG5cclxuY2xhc3MgT3V0UHQge1xyXG4gIHB0OiBJUG9pbnQ2NDtcclxuICBuZXh0OiBPdXRQdCB8IHVuZGVmaW5lZDtcclxuICBwcmV2OiBPdXRQdDtcclxuICBvdXRyZWM6IE91dFJlYztcclxuICBob3J6OiBIb3J6U2VnbWVudCB8IHVuZGVmaW5lZDtcclxuXHJcbiAgY29uc3RydWN0b3IocHQ6IElQb2ludDY0LCBvdXRyZWM6IE91dFJlYykge1xyXG4gICAgdGhpcy5wdCA9IHB0O1xyXG4gICAgdGhpcy5vdXRyZWMgPSBvdXRyZWM7XHJcbiAgICB0aGlzLm5leHQgPSB0aGlzO1xyXG4gICAgdGhpcy5wcmV2ID0gdGhpcztcclxuICAgIHRoaXMuaG9yeiA9IHVuZGVmaW5lZDtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBlbnVtIEpvaW5XaXRoIHtcclxuICBOb25lLFxyXG4gIExlZnQsXHJcbiAgUmlnaHRcclxufVxyXG5cclxuZXhwb3J0IGVudW0gSG9yelBvc2l0aW9uIHtcclxuICBCb3R0b20sXHJcbiAgTWlkZGxlLFxyXG4gIFRvcFxyXG59XHJcblxyXG5cclxuZXhwb3J0IGNsYXNzIE91dFJlYyB7XHJcbiAgaWR4OiBudW1iZXI7XHJcbiAgb3duZXI6IE91dFJlYyB8IHVuZGVmaW5lZDtcclxuICBmcm9udEVkZ2U6IEFjdGl2ZSB8IHVuZGVmaW5lZDtcclxuICBiYWNrRWRnZTogQWN0aXZlIHwgdW5kZWZpbmVkO1xyXG4gIHB0czogT3V0UHQgfCB1bmRlZmluZWQ7XHJcbiAgcG9seXBhdGg6IFBvbHlQYXRoQmFzZSB8IHVuZGVmaW5lZDtcclxuICBib3VuZHMhOiBSZWN0NjQ7XHJcbiAgcGF0aCE6IFBhdGg2NDtcclxuICBpc09wZW46IGJvb2xlYW47XHJcbiAgc3BsaXRzOiBudW1iZXJbXSB8IHVuZGVmaW5lZDtcclxuICByZWN1cnNpdmVTcGxpdDogT3V0UmVjIHwgdW5kZWZpbmVkO1xyXG4gIGNvbnN0cnVjdG9yKGlkeDogbnVtYmVyKSB7XHJcbiAgICB0aGlzLmlkeCA9IGlkeFxyXG4gICAgdGhpcy5pc09wZW4gPSBmYWxzZVxyXG4gIH1cclxufVxyXG5cclxuY2xhc3MgSG9yelNlZ21lbnQge1xyXG4gIGxlZnRPcDogT3V0UHQgLy98IHVuZGVmaW5lZDtcclxuICByaWdodE9wOiBPdXRQdCB8IHVuZGVmaW5lZDtcclxuICBsZWZ0VG9SaWdodDogYm9vbGVhbjtcclxuXHJcbiAgY29uc3RydWN0b3Iob3A6IE91dFB0KSB7XHJcbiAgICB0aGlzLmxlZnRPcCA9IG9wO1xyXG4gICAgdGhpcy5yaWdodE9wID0gdW5kZWZpbmVkO1xyXG4gICAgdGhpcy5sZWZ0VG9SaWdodCA9IHRydWU7XHJcbiAgfVxyXG59XHJcblxyXG5jbGFzcyBIb3J6Sm9pbiB7XHJcbiAgb3AxOiBPdXRQdCB8IHVuZGVmaW5lZDtcclxuICBvcDI6IE91dFB0IHwgdW5kZWZpbmVkO1xyXG5cclxuICBjb25zdHJ1Y3RvcihsdG9yOiBPdXRQdCwgcnRvbDogT3V0UHQpIHtcclxuICAgIHRoaXMub3AxID0gbHRvcjtcclxuICAgIHRoaXMub3AyID0gcnRvbDtcclxuICB9XHJcbn1cclxuXHJcbi8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cclxuLy8gSW1wb3J0YW50OiBVUCBhbmQgRE9XTiBoZXJlIGFyZSBwcmVtaXNlZCBvbiBZLWF4aXMgcG9zaXRpdmUgZG93blxyXG4vLyBkaXNwbGF5cywgd2hpY2ggaXMgdGhlIG9yaWVudGF0aW9uIHVzZWQgaW4gQ2xpcHBlcidzIGRldmVsb3BtZW50LlxyXG4vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vXHJcblxyXG5leHBvcnQgY2xhc3MgQWN0aXZlIHtcclxuICBib3QhOiBJUG9pbnQ2NFxyXG4gIHRvcCE6IElQb2ludDY0XHJcbiAgY3VyWCE6IG51bWJlcjsvLyBjdXJyZW50ICh1cGRhdGVkIGF0IGV2ZXJ5IG5ldyBzY2FubGluZSlcclxuICBkeDogbnVtYmVyO1xyXG4gIHdpbmREeCE6IG51bWJlcjsvLyAxIG9yIC0xIGRlcGVuZGluZyBvbiB3aW5kaW5nIGRpcmVjdGlvblxyXG4gIHdpbmRDb3VudDogbnVtYmVyO1xyXG4gIHdpbmRDb3VudDI6IG51bWJlcjsvLyB3aW5kaW5nIGNvdW50IG9mIHRoZSBvcHBvc2l0ZSBwb2x5dHlwZVxyXG4gIG91dHJlYzogT3V0UmVjIHwgdW5kZWZpbmVkO1xyXG5cclxuICAvLyBBRUw6ICdhY3RpdmUgZWRnZSBsaXN0JyAoVmF0dGkncyBBRVQgLSBhY3RpdmUgZWRnZSB0YWJsZSlcclxuICAvLyAgICAgYSBsaW5rZWQgbGlzdCBvZiBhbGwgZWRnZXMgKGZyb20gbGVmdCB0byByaWdodCkgdGhhdCBhcmUgcHJlc2VudFxyXG4gIC8vICAgICAob3IgJ2FjdGl2ZScpIHdpdGhpbiB0aGUgY3VycmVudCBzY2FuYmVhbSAoYSBob3Jpem9udGFsICdiZWFtJyB0aGF0XHJcbiAgLy8gICAgIHN3ZWVwcyBmcm9tIGJvdHRvbSB0byB0b3Agb3ZlciB0aGUgcGF0aHMgaW4gdGhlIGNsaXBwaW5nIG9wZXJhdGlvbikuXHJcbiAgcHJldkluQUVMOiBBY3RpdmUgfCB1bmRlZmluZWQ7XHJcbiAgbmV4dEluQUVMOiBBY3RpdmUgfCB1bmRlZmluZWQ7XHJcblxyXG4gIC8vIFNFTDogJ3NvcnRlZCBlZGdlIGxpc3QnIChWYXR0aSdzIFNUIC0gc29ydGVkIHRhYmxlKVxyXG4gIC8vICAgICBsaW5rZWQgbGlzdCB1c2VkIHdoZW4gc29ydGluZyBlZGdlcyBpbnRvIHRoZWlyIG5ldyBwb3NpdGlvbnMgYXQgdGhlXHJcbiAgLy8gICAgIHRvcCBvZiBzY2FuYmVhbXMsIGJ1dCBhbHNvIChyZSl1c2VkIHRvIHByb2Nlc3MgaG9yaXpvbnRhbHMuXHJcbiAgcHJldkluU0VMOiBBY3RpdmUgfCB1bmRlZmluZWQ7XHJcbiAgbmV4dEluU0VMOiBBY3RpdmUgfCB1bmRlZmluZWQ7XHJcbiAganVtcDogQWN0aXZlIHwgdW5kZWZpbmVkO1xyXG4gIHZlcnRleFRvcDogVmVydGV4IHwgdW5kZWZpbmVkXHJcbiAgbG9jYWxNaW4hOiBMb2NhbE1pbmltYSAvLyB0aGUgYm90dG9tIG9mIGFuIGVkZ2UgJ2JvdW5kJyAoYWxzbyBWYXR0aSlcclxuICBpc0xlZnRCb3VuZDogYm9vbGVhblxyXG4gIGpvaW5XaXRoOiBKb2luV2l0aFxyXG5cclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIHRoaXMuZHggPSB0aGlzLndpbmRDb3VudCA9IHRoaXMud2luZENvdW50MiA9IDBcclxuICAgIHRoaXMuaXNMZWZ0Qm91bmQgPSBmYWxzZVxyXG4gICAgdGhpcy5qb2luV2l0aCA9IEpvaW5XaXRoLk5vbmVcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBDbGlwcGVyRW5naW5lIHtcclxuICBzdGF0aWMgYWRkTG9jTWluKHZlcnQ6IFZlcnRleCwgcG9seXR5cGU6IFBhdGhUeXBlLCBpc09wZW46IGJvb2xlYW4sIG1pbmltYUxpc3Q6IExvY2FsTWluaW1hW10pOiB2b2lkIHtcclxuICAgIC8vIG1ha2Ugc3VyZSB0aGUgdmVydGV4IGlzIGFkZGVkIG9ubHkgb25jZSAuLi5cclxuICAgIGlmICgodmVydC5mbGFncyAmIFZlcnRleEZsYWdzLkxvY2FsTWluKSAhPT0gVmVydGV4RmxhZ3MuTm9uZSkgcmV0dXJuO1xyXG4gICAgdmVydC5mbGFncyB8PSBWZXJ0ZXhGbGFncy5Mb2NhbE1pbjtcclxuXHJcbiAgICBjb25zdCBsbSA9IG5ldyBMb2NhbE1pbmltYSh2ZXJ0LCBwb2x5dHlwZSwgaXNPcGVuKTtcclxuICAgIG1pbmltYUxpc3QucHVzaChsbSk7XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgYWRkUGF0aHNUb1ZlcnRleExpc3QocGF0aHM6IFBhdGg2NFtdLCBwb2x5dHlwZTogUGF0aFR5cGUsIGlzT3BlbjogYm9vbGVhbiwgbWluaW1hTGlzdDogTG9jYWxNaW5pbWFbXSwgdmVydGV4TGlzdDogVmVydGV4W10pOiB2b2lkIHtcclxuICAgIGxldCB0b3RhbFZlcnRDbnQgPSAwO1xyXG4gICAgZm9yIChjb25zdCBwYXRoIG9mIHBhdGhzKVxyXG4gICAgICB0b3RhbFZlcnRDbnQgKz0gcGF0aC5sZW5ndGg7XHJcblxyXG4gICAgZm9yIChjb25zdCBwYXRoIG9mIHBhdGhzKSB7XHJcbiAgICAgIGxldCB2MDogVmVydGV4IHwgdW5kZWZpbmVkID0gdW5kZWZpbmVkO1xyXG4gICAgICBsZXQgcHJldl92OiBWZXJ0ZXggfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XHJcbiAgICAgIGxldCBjdXJyX3Y6IFZlcnRleCB8IHVuZGVmaW5lZCA9IHVuZGVmaW5lZDtcclxuICAgICAgZm9yIChjb25zdCBwdCBvZiBwYXRoKSB7XHJcbiAgICAgICAgaWYgKCF2MCkge1xyXG4gICAgICAgICAgdjAgPSBuZXcgVmVydGV4KHB0LCBWZXJ0ZXhGbGFncy5Ob25lLCB1bmRlZmluZWQpO1xyXG4gICAgICAgICAgdmVydGV4TGlzdC5wdXNoKHYwKTtcclxuICAgICAgICAgIHByZXZfdiA9IHYwO1xyXG4gICAgICAgIH0gZWxzZSBpZiAocHJldl92IS5wdCAhPT0gcHQpIHsgIC8vIGkuZS4sIHNraXBzIGR1cGxpY2F0ZXNcclxuICAgICAgICAgIGN1cnJfdiA9IG5ldyBWZXJ0ZXgocHQsIFZlcnRleEZsYWdzLk5vbmUsIHByZXZfdik7XHJcbiAgICAgICAgICB2ZXJ0ZXhMaXN0LnB1c2goY3Vycl92KTtcclxuICAgICAgICAgIHByZXZfdiEubmV4dCA9IGN1cnJfdjtcclxuICAgICAgICAgIHByZXZfdiA9IGN1cnJfdjtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgICAgaWYgKCFwcmV2X3YgfHwgIXByZXZfdi5wcmV2KSBjb250aW51ZTtcclxuICAgICAgaWYgKCFpc09wZW4gJiYgcHJldl92LnB0ID09PSB2MCEucHQpIHByZXZfdiA9IHByZXZfdi5wcmV2O1xyXG4gICAgICBwcmV2X3YubmV4dCA9IHYwO1xyXG4gICAgICB2MCEucHJldiA9IHByZXZfdjtcclxuICAgICAgaWYgKCFpc09wZW4gJiYgcHJldl92Lm5leHQgPT09IHByZXZfdikgY29udGludWU7XHJcblxyXG4gICAgICAvLyBPSywgd2UgaGF2ZSBhIHZhbGlkIHBhdGhcclxuICAgICAgbGV0IGdvaW5nX3VwID0gZmFsc2VcclxuXHJcbiAgICAgIGlmIChpc09wZW4pIHtcclxuICAgICAgICBjdXJyX3YgPSB2MCEubmV4dDtcclxuICAgICAgICBsZXQgY291bnQgPSAwXHJcbiAgICAgICAgd2hpbGUgKGN1cnJfdiAhPT0gdjAgJiYgY3Vycl92IS5wdC55ID09PSB2MCEucHQueSkge1xyXG4gICAgICAgICAgY3Vycl92ID0gY3Vycl92IS5uZXh0O1xyXG4gICAgICAgICAgaWYgKGNvdW50KysgPiB0b3RhbFZlcnRDbnQpIHtcclxuICAgICAgICAgICAgY29uc29sZS53YXJuKCdpbmZpbml0ZSBsb29wIGRldGVjdGVkJylcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGdvaW5nX3VwID0gY3Vycl92IS5wdC55IDw9IHYwIS5wdC55O1xyXG4gICAgICAgIGlmIChnb2luZ191cCkge1xyXG4gICAgICAgICAgdjAhLmZsYWdzID0gVmVydGV4RmxhZ3MuT3BlblN0YXJ0O1xyXG4gICAgICAgICAgdGhpcy5hZGRMb2NNaW4odjAhLCBwb2x5dHlwZSwgdHJ1ZSwgbWluaW1hTGlzdCk7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHYwIS5mbGFncyA9IFZlcnRleEZsYWdzLk9wZW5TdGFydCB8IFZlcnRleEZsYWdzLkxvY2FsTWF4O1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHsgLy8gY2xvc2VkIHBhdGhcclxuICAgICAgICBwcmV2X3YgPSB2MCEucHJldjtcclxuICAgICAgICBsZXQgY291bnQgPSAwXHJcbiAgICAgICAgd2hpbGUgKHByZXZfdiAhPT0gdjAgJiYgcHJldl92IS5wdC55ID09PSB2MCEucHQueSkge1xyXG4gICAgICAgICAgcHJldl92ID0gcHJldl92IS5wcmV2O1xyXG5cclxuICAgICAgICAgIGlmIChjb3VudCsrID4gdG90YWxWZXJ0Q250KSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUud2FybignaW5maW5pdGUgbG9vcCBkZXRlY3RlZCcpXHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAocHJldl92ID09PSB2MCkge1xyXG4gICAgICAgICAgY29udGludWU7IC8vIG9ubHkgb3BlbiBwYXRocyBjYW4gYmUgY29tcGxldGVseSBmbGF0XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGdvaW5nX3VwID0gcHJldl92IS5wdC55ID4gdjAhLnB0Lnk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGdvaW5nX3VwMCA9IGdvaW5nX3VwO1xyXG4gICAgICBwcmV2X3YgPSB2MDtcclxuICAgICAgY3Vycl92ID0gdjAhLm5leHQ7XHJcblxyXG4gICAgICBsZXQgY291bnQgPSAwXHJcbiAgICAgIHdoaWxlIChjdXJyX3YgIT09IHYwKSB7XHJcbiAgICAgICAgaWYgKGN1cnJfdiEucHQueSA+IHByZXZfdiEucHQueSAmJiBnb2luZ191cCkge1xyXG4gICAgICAgICAgcHJldl92IS5mbGFncyB8PSBWZXJ0ZXhGbGFncy5Mb2NhbE1heDtcclxuICAgICAgICAgIGdvaW5nX3VwID0gZmFsc2U7XHJcbiAgICAgICAgfSBlbHNlIGlmIChjdXJyX3YhLnB0LnkgPCBwcmV2X3YhLnB0LnkgJiYgIWdvaW5nX3VwKSB7XHJcbiAgICAgICAgICBnb2luZ191cCA9IHRydWU7XHJcbiAgICAgICAgICB0aGlzLmFkZExvY01pbihwcmV2X3YhLCBwb2x5dHlwZSwgaXNPcGVuLCBtaW5pbWFMaXN0KTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcHJldl92ID0gY3Vycl92O1xyXG4gICAgICAgIGN1cnJfdiA9IGN1cnJfdiEubmV4dDtcclxuXHJcbiAgICAgICAgaWYgKGNvdW50KysgPiB0b3RhbFZlcnRDbnQpIHtcclxuICAgICAgICAgIGNvbnNvbGUud2FybignaW5maW5pdGUgbG9vcCBkZXRlY3RlZCcpXHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcblxyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoaXNPcGVuKSB7XHJcbiAgICAgICAgcHJldl92IS5mbGFncyB8PSBWZXJ0ZXhGbGFncy5PcGVuRW5kO1xyXG4gICAgICAgIGlmIChnb2luZ191cCkge1xyXG4gICAgICAgICAgcHJldl92IS5mbGFncyB8PSBWZXJ0ZXhGbGFncy5Mb2NhbE1heDtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgdGhpcy5hZGRMb2NNaW4ocHJldl92ISwgcG9seXR5cGUsIGlzT3BlbiwgbWluaW1hTGlzdCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKGdvaW5nX3VwICE9PSBnb2luZ191cDApIHtcclxuICAgICAgICBpZiAoZ29pbmdfdXAwKSB7XHJcbiAgICAgICAgICB0aGlzLmFkZExvY01pbihwcmV2X3YhLCBwb2x5dHlwZSwgZmFsc2UsIG1pbmltYUxpc3QpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBwcmV2X3YhLmZsYWdzIHw9IFZlcnRleEZsYWdzLkxvY2FsTWF4O1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFJldXNlYWJsZURhdGFDb250YWluZXI2NCB7XHJcbiAgcmVhZG9ubHkgX21pbmltYUxpc3Q6IExvY2FsTWluaW1hW107XHJcbiAgcHJpdmF0ZSByZWFkb25seSBfdmVydGV4TGlzdDogVmVydGV4W107XHJcblxyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5fbWluaW1hTGlzdCA9IFtdO1xyXG4gICAgdGhpcy5fdmVydGV4TGlzdCA9IFtdO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIGNsZWFyKCk6IHZvaWQge1xyXG4gICAgdGhpcy5fbWluaW1hTGlzdC5sZW5ndGggPSAwO1xyXG4gICAgdGhpcy5fdmVydGV4TGlzdC5sZW5ndGggPSAwO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIGFkZFBhdGhzKHBhdGhzOiBQYXRoczY0LCBwdDogUGF0aFR5cGUsIGlzT3BlbjogYm9vbGVhbik6IHZvaWQge1xyXG4gICAgQ2xpcHBlckVuZ2luZS5hZGRQYXRoc1RvVmVydGV4TGlzdChwYXRocywgcHQsIGlzT3BlbiwgdGhpcy5fbWluaW1hTGlzdCwgdGhpcy5fdmVydGV4TGlzdCk7XHJcbiAgfVxyXG59XHJcblxyXG5jbGFzcyBTaW1wbGVOYXZpZ2FibGVTZXQge1xyXG4gIGl0ZW1zOiBBcnJheTxudW1iZXI+ID0gW11cclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLml0ZW1zID0gW107XHJcbiAgfVxyXG5cclxuICBjbGVhcigpOiB2b2lkIHsgdGhpcy5pdGVtcy5sZW5ndGggPSAwIH1cclxuICBpc0VtcHR5KCk6IGJvb2xlYW4geyByZXR1cm4gdGhpcy5pdGVtcy5sZW5ndGggPT0gMCB9XHJcblxyXG4gIHBvbGxMYXN0KCk6IG51bWJlciB8IHVuZGVmaW5lZCB7XHJcbiAgICByZXR1cm4gdGhpcy5pdGVtcy5wb3AoKTtcclxuICB9XHJcblxyXG4gIGFkZChpdGVtOiBudW1iZXIpIHtcclxuICAgIGlmICghdGhpcy5pdGVtcy5pbmNsdWRlcyhpdGVtKSkge1xyXG4gICAgICB0aGlzLml0ZW1zLnB1c2goaXRlbSk7XHJcbiAgICAgIHRoaXMuaXRlbXMuc29ydCgoYSwgYikgPT4gYSAtIGIpO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIENsaXBwZXJCYXNlIHtcclxuICBwcml2YXRlIF9jbGlwdHlwZTogQ2xpcFR5cGUgPSBDbGlwVHlwZS5Ob25lXHJcbiAgcHJpdmF0ZSBfZmlsbHJ1bGU6IEZpbGxSdWxlID0gRmlsbFJ1bGUuRXZlbk9kZFxyXG4gIHByaXZhdGUgX2FjdGl2ZXM/OiBBY3RpdmU7XHJcbiAgcHJpdmF0ZSBfc2VsPzogQWN0aXZlO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgX21pbmltYUxpc3Q6IExvY2FsTWluaW1hW107XHJcbiAgcHJpdmF0ZSByZWFkb25seSBfaW50ZXJzZWN0TGlzdDogSW50ZXJzZWN0Tm9kZVtdO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgX3ZlcnRleExpc3Q6IFZlcnRleFtdO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgX291dHJlY0xpc3Q6IE91dFJlY1tdO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgX3NjYW5saW5lTGlzdDogU2ltcGxlTmF2aWdhYmxlU2V0O1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgX2hvcnpTZWdMaXN0OiBIb3J6U2VnbWVudFtdO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgX2hvcnpKb2luTGlzdDogSG9yekpvaW5bXTtcclxuICBwcml2YXRlIF9jdXJyZW50TG9jTWluOiBudW1iZXIgPSAwXHJcbiAgcHJpdmF0ZSBfY3VycmVudEJvdFk6IG51bWJlciA9IDBcclxuICBwcml2YXRlIF9pc1NvcnRlZE1pbmltYUxpc3Q6IGJvb2xlYW4gPSBmYWxzZVxyXG4gIHByaXZhdGUgX2hhc09wZW5QYXRoczogYm9vbGVhbiA9IGZhbHNlXHJcbiAgcHJvdGVjdGVkIF91c2luZ19wb2x5dHJlZTogYm9vbGVhbiA9IGZhbHNlXHJcbiAgcHJvdGVjdGVkIF9zdWNjZWVkZWQ6IGJvb2xlYW4gPSBmYWxzZVxyXG4gIHB1YmxpYyBwcmVzZXJ2ZUNvbGxpbmVhcjogYm9vbGVhbjtcclxuICBwdWJsaWMgcmV2ZXJzZVNvbHV0aW9uOiBib29sZWFuID0gZmFsc2VcclxuXHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLl9taW5pbWFMaXN0ID0gW107XHJcbiAgICB0aGlzLl9pbnRlcnNlY3RMaXN0ID0gW107XHJcbiAgICB0aGlzLl92ZXJ0ZXhMaXN0ID0gW107XHJcbiAgICB0aGlzLl9vdXRyZWNMaXN0ID0gW107XHJcbiAgICB0aGlzLl9zY2FubGluZUxpc3QgPSBuZXcgU2ltcGxlTmF2aWdhYmxlU2V0KClcclxuICAgIHRoaXMuX2hvcnpTZWdMaXN0ID0gW107XHJcbiAgICB0aGlzLl9ob3J6Sm9pbkxpc3QgPSBbXTtcclxuICAgIHRoaXMucHJlc2VydmVDb2xsaW5lYXIgPSB0cnVlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgaXNPZGQodmFsOiBudW1iZXIpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAoKHZhbCAmIDEpICE9PSAwKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGlzSG90RWRnZUFjdGl2ZShhZTogQWN0aXZlKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gYWUub3V0cmVjICE9PSB1bmRlZmluZWQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBpc09wZW4oYWU6IEFjdGl2ZSk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIGFlLmxvY2FsTWluLmlzT3BlbjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGlzT3BlbkVuZEFjdGl2ZShhZTogQWN0aXZlKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gYWUubG9jYWxNaW4uaXNPcGVuICYmIENsaXBwZXJCYXNlLmlzT3BlbkVuZChhZS52ZXJ0ZXhUb3AhKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGlzT3BlbkVuZCh2OiBWZXJ0ZXgpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAodi5mbGFncyAmIChWZXJ0ZXhGbGFncy5PcGVuU3RhcnQgfCBWZXJ0ZXhGbGFncy5PcGVuRW5kKSkgIT09IFZlcnRleEZsYWdzLk5vbmU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBnZXRQcmV2SG90RWRnZShhZTogQWN0aXZlKTogQWN0aXZlIHwgdW5kZWZpbmVkIHtcclxuICAgIGxldCBwcmV2OiBBY3RpdmUgfCB1bmRlZmluZWQgPSBhZS5wcmV2SW5BRUw7XHJcbiAgICB3aGlsZSAocHJldiAmJiAoQ2xpcHBlckJhc2UuaXNPcGVuKHByZXYpIHx8ICFDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUocHJldikpKVxyXG4gICAgICBwcmV2ID0gcHJldi5wcmV2SW5BRUw7XHJcbiAgICByZXR1cm4gcHJldjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGlzRnJvbnQoYWU6IEFjdGl2ZSk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIGFlID09PSBhZS5vdXRyZWMhLmZyb250RWRnZTtcclxuICB9XHJcblxyXG4gIC8qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqXHJcbiAgKiAgRHg6ICAgICAgICAgICAgICAgICAgICAgICAgICAgICAwKDkwZGVnKSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICpcclxuICAqICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHwgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4gICogICAgICAgICAgICAgICAraW5mICgxODBkZWcpIDwtLS0gbyAtLS4gLWluZiAoMGRlZykgICAgICAgICAgICAgICAgICAgICAgICAgICpcclxuICAqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xyXG5cclxuICBwcml2YXRlIHN0YXRpYyBnZXREeChwdDE6IElQb2ludDY0LCBwdDI6IElQb2ludDY0KTogbnVtYmVyIHtcclxuICAgIGNvbnN0IGR5OiBudW1iZXIgPSBwdDIueSAtIHB0MS55O1xyXG4gICAgaWYgKGR5ICE9PSAwKVxyXG4gICAgICByZXR1cm4gKHB0Mi54IC0gcHQxLngpIC8gZHk7XHJcbiAgICBpZiAocHQyLnggPiBwdDEueClcclxuICAgICAgcmV0dXJuIE51bWJlci5ORUdBVElWRV9JTkZJTklUWTtcclxuICAgIHJldHVybiBOdW1iZXIuUE9TSVRJVkVfSU5GSU5JVFk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyB0b3BYKGFlOiBBY3RpdmUsIGN1cnJlbnRZOiBudW1iZXIpOiBudW1iZXIge1xyXG4gICAgaWYgKChjdXJyZW50WSA9PT0gYWUudG9wLnkpIHx8IChhZS50b3AueCA9PT0gYWUuYm90LngpKSByZXR1cm4gYWUudG9wLng7XHJcbiAgICBpZiAoY3VycmVudFkgPT09IGFlLmJvdC55KSByZXR1cm4gYWUuYm90Lng7XHJcbiAgICByZXR1cm4gYWUuYm90LnggKyBtaWRQb2ludFJvdW5kKGFlLmR4ICogKGN1cnJlbnRZIC0gYWUuYm90LnkpLCBNaWRwb2ludFJvdW5kaW5nLlRvRXZlbik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBpc0hvcml6b250YWwoYWU6IEFjdGl2ZSk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIChhZS50b3AueSA9PT0gYWUuYm90LnkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgaXNIZWFkaW5nUmlnaHRIb3J6KGFlOiBBY3RpdmUpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAoTnVtYmVyLk5FR0FUSVZFX0lORklOSVRZID09PSBhZS5keCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBpc0hlYWRpbmdMZWZ0SG9yeihhZTogQWN0aXZlKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gKE51bWJlci5QT1NJVElWRV9JTkZJTklUWSA9PT0gYWUuZHgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgc3dhcEFjdGl2ZXMoYWUxOiBBY3RpdmUsIGFlMjogQWN0aXZlKTogdm9pZCB7XHJcbiAgICBbYWUyLCBhZTFdID0gW2FlMSwgYWUyXTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGdldFBvbHlUeXBlKGFlOiBBY3RpdmUpOiBQYXRoVHlwZSB7XHJcbiAgICByZXR1cm4gYWUubG9jYWxNaW4ucG9seXR5cGU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBpc1NhbWVQb2x5VHlwZShhZTE6IEFjdGl2ZSwgYWUyOiBBY3RpdmUpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBhZTEubG9jYWxNaW4ucG9seXR5cGUgPT09IGFlMi5sb2NhbE1pbi5wb2x5dHlwZTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIHNldER4KGFlOiBBY3RpdmUpOiB2b2lkIHtcclxuICAgIGFlLmR4ID0gQ2xpcHBlckJhc2UuZ2V0RHgoYWUuYm90LCBhZS50b3ApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgbmV4dFZlcnRleChhZTogQWN0aXZlKTogVmVydGV4IHtcclxuICAgIGlmIChhZS53aW5kRHggPiAwKVxyXG4gICAgICByZXR1cm4gYWUudmVydGV4VG9wIS5uZXh0ITtcclxuICAgIHJldHVybiBhZS52ZXJ0ZXhUb3AhLnByZXYhO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgcHJldlByZXZWZXJ0ZXgoYWU6IEFjdGl2ZSk6IFZlcnRleCB7XHJcbiAgICBpZiAoYWUud2luZER4ID4gMClcclxuICAgICAgcmV0dXJuIGFlLnZlcnRleFRvcCEucHJldiEucHJldiE7XHJcbiAgICByZXR1cm4gYWUudmVydGV4VG9wIS5uZXh0IS5uZXh0ITtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGlzTWF4aW1hKHZlcnRleDogVmVydGV4KTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gKHZlcnRleC5mbGFncyAmIFZlcnRleEZsYWdzLkxvY2FsTWF4KSAhPT0gVmVydGV4RmxhZ3MuTm9uZTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGlzTWF4aW1hQWN0aXZlKGFlOiBBY3RpdmUpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBDbGlwcGVyQmFzZS5pc01heGltYShhZS52ZXJ0ZXhUb3AhKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGdldE1heGltYVBhaXIoYWU6IEFjdGl2ZSk6IEFjdGl2ZSB8IHVuZGVmaW5lZCB7XHJcbiAgICBsZXQgYWUyOiBBY3RpdmUgfCB1bmRlZmluZWQgPSBhZS5uZXh0SW5BRUw7XHJcbiAgICB3aGlsZSAoYWUyKSB7XHJcbiAgICAgIGlmIChhZTIudmVydGV4VG9wID09PSBhZS52ZXJ0ZXhUb3ApIHJldHVybiBhZTI7IC8vIEZvdW5kIVxyXG4gICAgICBhZTIgPSBhZTIubmV4dEluQUVMO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHVuZGVmaW5lZDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGdldEN1cnJZTWF4aW1hVmVydGV4X09wZW4oYWU6IEFjdGl2ZSk6IFZlcnRleCB8IHVuZGVmaW5lZCB7XHJcbiAgICBsZXQgcmVzdWx0OiBWZXJ0ZXggfCB1bmRlZmluZWQgPSBhZS52ZXJ0ZXhUb3A7XHJcbiAgICBpZiAoYWUud2luZER4ID4gMCkge1xyXG4gICAgICB3aGlsZSAocmVzdWx0IS5uZXh0IS5wdC55ID09PSByZXN1bHQhLnB0LnkgJiZcclxuICAgICAgICAoKHJlc3VsdCEuZmxhZ3MgJiAoVmVydGV4RmxhZ3MuT3BlbkVuZCB8XHJcbiAgICAgICAgICBWZXJ0ZXhGbGFncy5Mb2NhbE1heCkpID09PSBWZXJ0ZXhGbGFncy5Ob25lKSlcclxuICAgICAgICByZXN1bHQgPSByZXN1bHQhLm5leHQ7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB3aGlsZSAocmVzdWx0IS5wcmV2IS5wdC55ID09PSByZXN1bHQhLnB0LnkgJiZcclxuICAgICAgICAoKHJlc3VsdCEuZmxhZ3MgJiAoVmVydGV4RmxhZ3MuT3BlbkVuZCB8XHJcbiAgICAgICAgICBWZXJ0ZXhGbGFncy5Mb2NhbE1heCkpID09PSBWZXJ0ZXhGbGFncy5Ob25lKSlcclxuICAgICAgICByZXN1bHQgPSByZXN1bHQhLnByZXY7XHJcbiAgICB9XHJcbiAgICBpZiAoIUNsaXBwZXJCYXNlLmlzTWF4aW1hKHJlc3VsdCEpKSByZXN1bHQgPSB1bmRlZmluZWQ7IC8vIG5vdCBhIG1heGltYVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGdldEN1cnJZTWF4aW1hVmVydGV4KGFlOiBBY3RpdmUpOiBWZXJ0ZXggfCB1bmRlZmluZWQge1xyXG4gICAgbGV0IHJlc3VsdDogVmVydGV4IHwgdW5kZWZpbmVkID0gYWUudmVydGV4VG9wO1xyXG4gICAgaWYgKGFlLndpbmREeCA+IDApIHtcclxuICAgICAgd2hpbGUgKHJlc3VsdCEubmV4dCEucHQueSA9PT0gcmVzdWx0IS5wdC55KSByZXN1bHQgPSByZXN1bHQhLm5leHQ7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB3aGlsZSAocmVzdWx0IS5wcmV2IS5wdC55ID09PSByZXN1bHQhLnB0LnkpIHJlc3VsdCA9IHJlc3VsdCEucHJldjtcclxuICAgIH1cclxuICAgIGlmICghQ2xpcHBlckJhc2UuaXNNYXhpbWEocmVzdWx0ISkpIHJlc3VsdCA9IHVuZGVmaW5lZDsgLy8gbm90IGEgbWF4aW1hXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgc2V0U2lkZXMob3V0cmVjOiBPdXRSZWMsIHN0YXJ0RWRnZTogQWN0aXZlLCBlbmRFZGdlOiBBY3RpdmUpOiB2b2lkIHtcclxuICAgIG91dHJlYy5mcm9udEVkZ2UgPSBzdGFydEVkZ2U7XHJcbiAgICBvdXRyZWMuYmFja0VkZ2UgPSBlbmRFZGdlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgc3dhcE91dHJlY3MoYWUxOiBBY3RpdmUsIGFlMjogQWN0aXZlKTogdm9pZCB7XHJcbiAgICBjb25zdCBvcjE6IE91dFJlYyB8IHVuZGVmaW5lZCA9IGFlMS5vdXRyZWM7XHJcbiAgICBjb25zdCBvcjI6IE91dFJlYyB8IHVuZGVmaW5lZCA9IGFlMi5vdXRyZWM7XHJcbiAgICBpZiAob3IxID09PSBvcjIpIHtcclxuICAgICAgY29uc3QgYWU6IEFjdGl2ZSB8IHVuZGVmaW5lZCA9IG9yMSEuZnJvbnRFZGdlO1xyXG4gICAgICBvcjEhLmZyb250RWRnZSA9IG9yMSEuYmFja0VkZ2U7XHJcbiAgICAgIG9yMSEuYmFja0VkZ2UgPSBhZTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChvcjEpIHtcclxuICAgICAgaWYgKGFlMSA9PT0gb3IxLmZyb250RWRnZSlcclxuICAgICAgICBvcjEuZnJvbnRFZGdlID0gYWUyO1xyXG4gICAgICBlbHNlXHJcbiAgICAgICAgb3IxLmJhY2tFZGdlID0gYWUyO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChvcjIpIHtcclxuICAgICAgaWYgKGFlMiA9PT0gb3IyLmZyb250RWRnZSlcclxuICAgICAgICBvcjIuZnJvbnRFZGdlID0gYWUxO1xyXG4gICAgICBlbHNlXHJcbiAgICAgICAgb3IyLmJhY2tFZGdlID0gYWUxO1xyXG4gICAgfVxyXG5cclxuICAgIGFlMS5vdXRyZWMgPSBvcjI7XHJcbiAgICBhZTIub3V0cmVjID0gb3IxO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgc2V0T3duZXIob3V0cmVjOiBPdXRSZWMsIG5ld093bmVyOiBPdXRSZWMpOiB2b2lkIHtcclxuICAgIHdoaWxlIChuZXdPd25lci5vd25lciAmJiAhbmV3T3duZXIub3duZXIucHRzKSB7XHJcbiAgICAgIG5ld093bmVyLm93bmVyID0gbmV3T3duZXIub3duZXIub3duZXI7XHJcbiAgICB9XHJcblxyXG4gICAgLy9tYWtlIHN1cmUgdGhhdCBvdXRyZWMgaXNuJ3QgYW4gb3duZXIgb2YgbmV3T3duZXJcclxuICAgIGxldCB0bXA6IE91dFJlYyB8IHVuZGVmaW5lZCA9IG5ld093bmVyO1xyXG4gICAgd2hpbGUgKHRtcCAmJiB0bXAgIT09IG91dHJlYylcclxuICAgICAgdG1wID0gdG1wLm93bmVyO1xyXG4gICAgaWYgKHRtcClcclxuICAgICAgbmV3T3duZXIub3duZXIgPSBvdXRyZWMub3duZXI7XHJcbiAgICBvdXRyZWMub3duZXIgPSBuZXdPd25lcjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGFyZWEob3A6IE91dFB0KTogbnVtYmVyIHtcclxuICAgIC8vIGh0dHBzOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL1Nob2VsYWNlX2Zvcm11bGFcclxuICAgIGxldCBhcmVhID0gMC4wO1xyXG4gICAgbGV0IG9wMiA9IG9wO1xyXG4gICAgZG8ge1xyXG4gICAgICBhcmVhICs9IChvcDIucHJldi5wdC55ICsgb3AyLnB0LnkpICpcclxuICAgICAgICAob3AyLnByZXYucHQueCAtIG9wMi5wdC54KTtcclxuICAgICAgb3AyID0gb3AyLm5leHQhO1xyXG4gICAgfSB3aGlsZSAob3AyICE9PSBvcCk7XHJcbiAgICByZXR1cm4gYXJlYSAqIDAuNTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGFyZWFUcmlhbmdsZShwdDE6IElQb2ludDY0LCBwdDI6IElQb2ludDY0LCBwdDM6IElQb2ludDY0KTogbnVtYmVyIHtcclxuICAgIHJldHVybiAocHQzLnkgKyBwdDEueSkgKiAocHQzLnggLSBwdDEueCkgK1xyXG4gICAgICAocHQxLnkgKyBwdDIueSkgKiAocHQxLnggLSBwdDIueCkgK1xyXG4gICAgICAocHQyLnkgKyBwdDMueSkgKiAocHQyLnggLSBwdDMueCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBnZXRSZWFsT3V0UmVjKG91dFJlYzogT3V0UmVjIHwgdW5kZWZpbmVkKTogT3V0UmVjIHwgdW5kZWZpbmVkIHtcclxuICAgIHdoaWxlIChvdXRSZWMgIT09IHVuZGVmaW5lZCAmJiBvdXRSZWMucHRzID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgb3V0UmVjID0gb3V0UmVjLm93bmVyO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIG91dFJlYztcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGlzVmFsaWRPd25lcihvdXRSZWM6IE91dFJlYyB8IHVuZGVmaW5lZCwgdGVzdE93bmVyOiBPdXRSZWMgfCB1bmRlZmluZWQpOiBib29sZWFuIHtcclxuICAgIHdoaWxlICh0ZXN0T3duZXIgIT09IHVuZGVmaW5lZCAmJiB0ZXN0T3duZXIgIT09IG91dFJlYylcclxuICAgICAgdGVzdE93bmVyID0gdGVzdE93bmVyLm93bmVyO1xyXG4gICAgcmV0dXJuIHRlc3RPd25lciA9PT0gdW5kZWZpbmVkO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgdW5jb3VwbGVPdXRSZWMoYWU6IEFjdGl2ZSk6IHZvaWQge1xyXG4gICAgY29uc3Qgb3V0cmVjID0gYWUub3V0cmVjO1xyXG4gICAgaWYgKG91dHJlYyA9PT0gdW5kZWZpbmVkKSByZXR1cm47XHJcbiAgICBvdXRyZWMuZnJvbnRFZGdlIS5vdXRyZWMgPSB1bmRlZmluZWQ7XHJcbiAgICBvdXRyZWMuYmFja0VkZ2UhLm91dHJlYyA9IHVuZGVmaW5lZDtcclxuICAgIG91dHJlYy5mcm9udEVkZ2UgPSB1bmRlZmluZWQ7XHJcbiAgICBvdXRyZWMuYmFja0VkZ2UgPSB1bmRlZmluZWQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBvdXRyZWNJc0FzY2VuZGluZyhob3RFZGdlOiBBY3RpdmUpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAoaG90RWRnZSA9PT0gaG90RWRnZS5vdXRyZWMhLmZyb250RWRnZSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBzd2FwRnJvbnRCYWNrU2lkZXMob3V0cmVjOiBPdXRSZWMpOiB2b2lkIHtcclxuICAgIC8vIHdoaWxlIHRoaXMgcHJvYy4gaXMgbmVlZGVkIGZvciBvcGVuIHBhdGhzXHJcbiAgICAvLyBpdCdzIGFsbW9zdCBuZXZlciBuZWVkZWQgZm9yIGNsb3NlZCBwYXRoc1xyXG4gICAgY29uc3QgYWUyID0gb3V0cmVjLmZyb250RWRnZSE7XHJcbiAgICBvdXRyZWMuZnJvbnRFZGdlID0gb3V0cmVjLmJhY2tFZGdlO1xyXG4gICAgb3V0cmVjLmJhY2tFZGdlID0gYWUyO1xyXG4gICAgb3V0cmVjLnB0cyA9IG91dHJlYy5wdHMhLm5leHQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBlZGdlc0FkamFjZW50SW5BRUwoaW5vZGU6IEludGVyc2VjdE5vZGUpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAoaW5vZGUuZWRnZTEubmV4dEluQUVMID09PSBpbm9kZS5lZGdlMikgfHwgKGlub2RlLmVkZ2UxLnByZXZJbkFFTCA9PT0gaW5vZGUuZWRnZTIpO1xyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIGNsZWFyU29sdXRpb25Pbmx5KCk6IHZvaWQge1xyXG4gICAgd2hpbGUgKHRoaXMuX2FjdGl2ZXMpIHRoaXMuZGVsZXRlRnJvbUFFTCh0aGlzLl9hY3RpdmVzKTtcclxuICAgIHRoaXMuX3NjYW5saW5lTGlzdC5jbGVhcigpXHJcbiAgICB0aGlzLmRpc3Bvc2VJbnRlcnNlY3ROb2RlcygpO1xyXG4gICAgdGhpcy5fb3V0cmVjTGlzdC5sZW5ndGggPSAwXHJcbiAgICB0aGlzLl9ob3J6U2VnTGlzdC5sZW5ndGggPSAwXHJcbiAgICB0aGlzLl9ob3J6Sm9pbkxpc3QubGVuZ3RoID0gMFxyXG4gIH1cclxuXHJcbiAgcHVibGljIGNsZWFyKCk6IHZvaWQge1xyXG4gICAgdGhpcy5jbGVhclNvbHV0aW9uT25seSgpO1xyXG4gICAgdGhpcy5fbWluaW1hTGlzdC5sZW5ndGggPSAwXHJcbiAgICB0aGlzLl92ZXJ0ZXhMaXN0Lmxlbmd0aCA9IDBcclxuICAgIHRoaXMuX2N1cnJlbnRMb2NNaW4gPSAwO1xyXG4gICAgdGhpcy5faXNTb3J0ZWRNaW5pbWFMaXN0ID0gZmFsc2U7XHJcbiAgICB0aGlzLl9oYXNPcGVuUGF0aHMgPSBmYWxzZTtcclxuICB9XHJcblxyXG4gIHByb3RlY3RlZCByZXNldCgpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5faXNTb3J0ZWRNaW5pbWFMaXN0KSB7XHJcbiAgICAgIHRoaXMuX21pbmltYUxpc3Quc29ydCgobG9jTWluMSwgbG9jTWluMikgPT4gbG9jTWluMi52ZXJ0ZXgucHQueSAtIGxvY01pbjEudmVydGV4LnB0LnkpO1xyXG4gICAgICB0aGlzLl9pc1NvcnRlZE1pbmltYUxpc3QgPSB0cnVlO1xyXG4gICAgfVxyXG5cclxuICAgIGZvciAobGV0IGkgPSB0aGlzLl9taW5pbWFMaXN0Lmxlbmd0aCAtIDE7IGkgPj0gMDsgaS0tKSB7XHJcbiAgICAgIHRoaXMuX3NjYW5saW5lTGlzdC5hZGQodGhpcy5fbWluaW1hTGlzdFtpXS52ZXJ0ZXgucHQueSk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5fY3VycmVudEJvdFkgPSAwO1xyXG4gICAgdGhpcy5fY3VycmVudExvY01pbiA9IDA7XHJcbiAgICB0aGlzLl9hY3RpdmVzID0gdW5kZWZpbmVkO1xyXG4gICAgdGhpcy5fc2VsID0gdW5kZWZpbmVkO1xyXG4gICAgdGhpcy5fc3VjY2VlZGVkID0gdHJ1ZTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgaW5zZXJ0U2NhbmxpbmUoeTogbnVtYmVyKTogdm9pZCB7XHJcbiAgICB0aGlzLl9zY2FubGluZUxpc3QuYWRkKHkpXHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHBvcFNjYW5saW5lKCk6IG51bWJlciB8IHVuZGVmaW5lZCB7XHJcbiAgICByZXR1cm4gdGhpcy5fc2NhbmxpbmVMaXN0LnBvbGxMYXN0KCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGhhc0xvY01pbkF0WSh5OiBudW1iZXIpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAodGhpcy5fY3VycmVudExvY01pbiA8IHRoaXMuX21pbmltYUxpc3QubGVuZ3RoICYmIHRoaXMuX21pbmltYUxpc3RbdGhpcy5fY3VycmVudExvY01pbl0udmVydGV4LnB0LnkgPT0geSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHBvcExvY2FsTWluaW1hKCk6IExvY2FsTWluaW1hIHtcclxuICAgIHJldHVybiB0aGlzLl9taW5pbWFMaXN0W3RoaXMuX2N1cnJlbnRMb2NNaW4rK107XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFkZExvY01pbih2ZXJ0OiBWZXJ0ZXgsIHBvbHl0eXBlOiBQYXRoVHlwZSwgaXNPcGVuOiBib29sZWFuKTogdm9pZCB7XHJcbiAgICAvLyBtYWtlIHN1cmUgdGhlIHZlcnRleCBpcyBhZGRlZCBvbmx5IG9uY2UgLi4uXHJcbiAgICBpZiAoKHZlcnQuZmxhZ3MgJiBWZXJ0ZXhGbGFncy5Mb2NhbE1pbikgIT0gVmVydGV4RmxhZ3MuTm9uZSkgcmV0dXJuXHJcblxyXG4gICAgdmVydC5mbGFncyB8PSBWZXJ0ZXhGbGFncy5Mb2NhbE1pbjtcclxuXHJcbiAgICBjb25zdCBsbSA9IG5ldyBMb2NhbE1pbmltYSh2ZXJ0LCBwb2x5dHlwZSwgaXNPcGVuKTtcclxuICAgIHRoaXMuX21pbmltYUxpc3QucHVzaChsbSk7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgYWRkU3ViamVjdChwYXRoOiBQYXRoNjQpOiB2b2lkIHtcclxuICAgIHRoaXMuYWRkUGF0aChwYXRoLCBQYXRoVHlwZS5TdWJqZWN0KTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBhZGRPcGVuU3ViamVjdChwYXRoOiBQYXRoNjQpOiB2b2lkIHtcclxuICAgIHRoaXMuYWRkUGF0aChwYXRoLCBQYXRoVHlwZS5TdWJqZWN0LCB0cnVlKTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBhZGRDbGlwKHBhdGg6IFBhdGg2NCk6IHZvaWQge1xyXG4gICAgdGhpcy5hZGRQYXRoKHBhdGgsIFBhdGhUeXBlLkNsaXApO1xyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIGFkZFBhdGgocGF0aDogUGF0aDY0LCBwb2x5dHlwZTogUGF0aFR5cGUsIGlzT3BlbiA9IGZhbHNlKTogdm9pZCB7XHJcbiAgICBjb25zdCB0bXA6IFBhdGhzNjQgPSBbcGF0aF07XHJcbiAgICB0aGlzLmFkZFBhdGhzKHRtcCwgcG9seXR5cGUsIGlzT3Blbik7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgYWRkUGF0aHMocGF0aHM6IFBhdGhzNjQsIHBvbHl0eXBlOiBQYXRoVHlwZSwgaXNPcGVuID0gZmFsc2UpOiB2b2lkIHtcclxuICAgIGlmIChpc09wZW4pIHRoaXMuX2hhc09wZW5QYXRocyA9IHRydWU7XHJcbiAgICB0aGlzLl9pc1NvcnRlZE1pbmltYUxpc3QgPSBmYWxzZTtcclxuICAgIENsaXBwZXJFbmdpbmUuYWRkUGF0aHNUb1ZlcnRleExpc3QocGF0aHMsIHBvbHl0eXBlLCBpc09wZW4sIHRoaXMuX21pbmltYUxpc3QsIHRoaXMuX3ZlcnRleExpc3QpO1xyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIGFkZFJldXNlYWJsZURhdGEocmV1c2VhYmxlRGF0YTogUmV1c2VhYmxlRGF0YUNvbnRhaW5lcjY0KTogdm9pZCB7XHJcbiAgICBpZiAocmV1c2VhYmxlRGF0YS5fbWluaW1hTGlzdC5sZW5ndGggPT09IDApIHJldHVybjtcclxuXHJcbiAgICB0aGlzLl9pc1NvcnRlZE1pbmltYUxpc3QgPSBmYWxzZTtcclxuICAgIGZvciAoY29uc3QgbG0gb2YgcmV1c2VhYmxlRGF0YS5fbWluaW1hTGlzdCkge1xyXG4gICAgICB0aGlzLl9taW5pbWFMaXN0LnB1c2gobmV3IExvY2FsTWluaW1hKGxtLnZlcnRleCwgbG0ucG9seXR5cGUsIGxtLmlzT3BlbikpO1xyXG4gICAgICBpZiAobG0uaXNPcGVuKSB0aGlzLl9oYXNPcGVuUGF0aHMgPSB0cnVlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBpc0NvbnRyaWJ1dGluZ0Nsb3NlZChhZTogQWN0aXZlKTogYm9vbGVhbiB7XHJcbiAgICBzd2l0Y2ggKHRoaXMuX2ZpbGxydWxlKSB7XHJcbiAgICAgIGNhc2UgRmlsbFJ1bGUuUG9zaXRpdmU6XHJcbiAgICAgICAgaWYgKGFlLndpbmRDb3VudCAhPT0gMSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICBjYXNlIEZpbGxSdWxlLk5lZ2F0aXZlOlxyXG4gICAgICAgIGlmIChhZS53aW5kQ291bnQgIT09IC0xKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIGNhc2UgRmlsbFJ1bGUuTm9uWmVybzpcclxuICAgICAgICBpZiAoTWF0aC5hYnMoYWUud2luZENvdW50KSAhPT0gMSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgfVxyXG5cclxuICAgIHN3aXRjaCAodGhpcy5fY2xpcHR5cGUpIHtcclxuICAgICAgY2FzZSBDbGlwVHlwZS5JbnRlcnNlY3Rpb246XHJcbiAgICAgICAgc3dpdGNoICh0aGlzLl9maWxscnVsZSkge1xyXG4gICAgICAgICAgY2FzZSBGaWxsUnVsZS5Qb3NpdGl2ZTogcmV0dXJuIGFlLndpbmRDb3VudDIgPiAwO1xyXG4gICAgICAgICAgY2FzZSBGaWxsUnVsZS5OZWdhdGl2ZTogcmV0dXJuIGFlLndpbmRDb3VudDIgPCAwO1xyXG4gICAgICAgICAgZGVmYXVsdDogcmV0dXJuIGFlLndpbmRDb3VudDIgIT09IDA7XHJcbiAgICAgICAgfVxyXG4gICAgICBjYXNlIENsaXBUeXBlLlVuaW9uOlxyXG4gICAgICAgIHN3aXRjaCAodGhpcy5fZmlsbHJ1bGUpIHtcclxuICAgICAgICAgIGNhc2UgRmlsbFJ1bGUuUG9zaXRpdmU6IHJldHVybiBhZS53aW5kQ291bnQyIDw9IDA7XHJcbiAgICAgICAgICBjYXNlIEZpbGxSdWxlLk5lZ2F0aXZlOiByZXR1cm4gYWUud2luZENvdW50MiA+PSAwO1xyXG4gICAgICAgICAgZGVmYXVsdDogcmV0dXJuIGFlLndpbmRDb3VudDIgPT09IDA7XHJcbiAgICAgICAgfVxyXG4gICAgICBjYXNlIENsaXBUeXBlLkRpZmZlcmVuY2U6XHJcbiAgICAgICAgY29uc3QgcmVzdWx0ID0gdGhpcy5fZmlsbHJ1bGUgPT09IEZpbGxSdWxlLlBvc2l0aXZlID8gKGFlLndpbmRDb3VudDIgPD0gMCkgOlxyXG4gICAgICAgICAgdGhpcy5fZmlsbHJ1bGUgPT09IEZpbGxSdWxlLk5lZ2F0aXZlID8gKGFlLndpbmRDb3VudDIgPj0gMCkgOlxyXG4gICAgICAgICAgICAoYWUud2luZENvdW50MiA9PT0gMCk7XHJcbiAgICAgICAgcmV0dXJuIENsaXBwZXJCYXNlLmdldFBvbHlUeXBlKGFlKSA9PT0gUGF0aFR5cGUuU3ViamVjdCA/IHJlc3VsdCA6ICFyZXN1bHQ7XHJcblxyXG4gICAgICBjYXNlIENsaXBUeXBlLlhvcjpcclxuICAgICAgICByZXR1cm4gdHJ1ZTtcclxuXHJcbiAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBpc0NvbnRyaWJ1dGluZ09wZW4oYWU6IEFjdGl2ZSk6IGJvb2xlYW4ge1xyXG4gICAgbGV0IGlzSW5DbGlwOiBib29sZWFuLCBpc0luU3ViajogYm9vbGVhbjtcclxuICAgIHN3aXRjaCAodGhpcy5fZmlsbHJ1bGUpIHtcclxuICAgICAgY2FzZSBGaWxsUnVsZS5Qb3NpdGl2ZTpcclxuICAgICAgICBpc0luU3ViaiA9IGFlLndpbmRDb3VudCA+IDA7XHJcbiAgICAgICAgaXNJbkNsaXAgPSBhZS53aW5kQ291bnQyID4gMDtcclxuICAgICAgICBicmVhaztcclxuICAgICAgY2FzZSBGaWxsUnVsZS5OZWdhdGl2ZTpcclxuICAgICAgICBpc0luU3ViaiA9IGFlLndpbmRDb3VudCA8IDA7XHJcbiAgICAgICAgaXNJbkNsaXAgPSBhZS53aW5kQ291bnQyIDwgMDtcclxuICAgICAgICBicmVhaztcclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICBpc0luU3ViaiA9IGFlLndpbmRDb3VudCAhPT0gMDtcclxuICAgICAgICBpc0luQ2xpcCA9IGFlLndpbmRDb3VudDIgIT09IDA7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICB9XHJcblxyXG4gICAgc3dpdGNoICh0aGlzLl9jbGlwdHlwZSkge1xyXG4gICAgICBjYXNlIENsaXBUeXBlLkludGVyc2VjdGlvbjpcclxuICAgICAgICByZXR1cm4gaXNJbkNsaXA7XHJcbiAgICAgIGNhc2UgQ2xpcFR5cGUuVW5pb246XHJcbiAgICAgICAgcmV0dXJuICFpc0luU3ViaiAmJiAhaXNJbkNsaXA7XHJcbiAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgcmV0dXJuICFpc0luQ2xpcDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2V0V2luZENvdW50Rm9yQ2xvc2VkUGF0aEVkZ2UoYWU6IEFjdGl2ZSk6IHZvaWQge1xyXG4gICAgbGV0IGFlMjogQWN0aXZlIHwgdW5kZWZpbmVkID0gYWUucHJldkluQUVMO1xyXG4gICAgY29uc3QgcHQ6IFBhdGhUeXBlID0gQ2xpcHBlckJhc2UuZ2V0UG9seVR5cGUoYWUpO1xyXG5cclxuICAgIHdoaWxlIChhZTIgIT09IHVuZGVmaW5lZCAmJiAoQ2xpcHBlckJhc2UuZ2V0UG9seVR5cGUoYWUyKSAhPT0gcHQgfHwgQ2xpcHBlckJhc2UuaXNPcGVuKGFlMikpKSB7XHJcbiAgICAgIGFlMiA9IGFlMi5wcmV2SW5BRUw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGFlMiA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIGFlLndpbmRDb3VudCA9IGFlLndpbmREeDtcclxuICAgICAgYWUyID0gdGhpcy5fYWN0aXZlcztcclxuICAgIH0gZWxzZSBpZiAodGhpcy5fZmlsbHJ1bGUgPT09IEZpbGxSdWxlLkV2ZW5PZGQpIHtcclxuICAgICAgYWUud2luZENvdW50ID0gYWUud2luZER4O1xyXG4gICAgICBhZS53aW5kQ291bnQyID0gYWUyLndpbmRDb3VudDI7XHJcbiAgICAgIGFlMiA9IGFlMi5uZXh0SW5BRUw7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBOb25aZXJvLCBwb3NpdGl2ZSwgb3IgbmVnYXRpdmUgZmlsbGluZyBoZXJlIC4uLlxyXG4gICAgICAvLyB3aGVuIGUyJ3MgV2luZENudCBpcyBpbiB0aGUgU0FNRSBkaXJlY3Rpb24gYXMgaXRzIFdpbmREeCxcclxuICAgICAgLy8gdGhlbiBwb2x5Z29uIHdpbGwgZmlsbCBvbiB0aGUgcmlnaHQgb2YgJ2UyJyAoYW5kICdlJyB3aWxsIGJlIGluc2lkZSlcclxuICAgICAgLy8gbmI6IG5laXRoZXIgZTIuV2luZENudCBub3IgZTIuV2luZER4IHNob3VsZCBldmVyIGJlIDAuXHJcbiAgICAgIGlmIChhZTIud2luZENvdW50ICogYWUyLndpbmREeCA8IDApIHtcclxuICAgICAgICAvLyBvcHBvc2l0ZSBkaXJlY3Rpb25zIHNvICdhZScgaXMgb3V0c2lkZSAnYWUyJyAuLi5cclxuICAgICAgICBpZiAoTWF0aC5hYnMoYWUyLndpbmRDb3VudCkgPiAxKSB7XHJcbiAgICAgICAgICAvLyBvdXRzaWRlIHByZXYgcG9seSBidXQgc3RpbGwgaW5zaWRlIGFub3RoZXIuXHJcbiAgICAgICAgICBpZiAoYWUyLndpbmREeCAqIGFlLndpbmREeCA8IDApXHJcbiAgICAgICAgICAgIC8vIHJldmVyc2luZyBkaXJlY3Rpb24gc28gdXNlIHRoZSBzYW1lIFdDXHJcbiAgICAgICAgICAgIGFlLndpbmRDb3VudCA9IGFlMi53aW5kQ291bnQ7XHJcbiAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgIC8vIG90aGVyd2lzZSBrZWVwICdyZWR1Y2luZycgdGhlIFdDIGJ5IDEgKGkuZS4gdG93YXJkcyAwKSAuLi5cclxuICAgICAgICAgICAgYWUud2luZENvdW50ID0gYWUyLndpbmRDb3VudCArIGFlLndpbmREeDtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgLy8gbm93IG91dHNpZGUgYWxsIHBvbHlzIG9mIHNhbWUgcG9seXR5cGUgc28gc2V0IG93biBXQyAuLi5cclxuICAgICAgICAgIGFlLndpbmRDb3VudCA9IChDbGlwcGVyQmFzZS5pc09wZW4oYWUpID8gMSA6IGFlLndpbmREeCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIC8vICdhZScgbXVzdCBiZSBpbnNpZGUgJ2FlMidcclxuICAgICAgICBpZiAoYWUyLndpbmREeCAqIGFlLndpbmREeCA8IDApXHJcbiAgICAgICAgICAvLyByZXZlcnNpbmcgZGlyZWN0aW9uIHNvIHVzZSB0aGUgc2FtZSBXQ1xyXG4gICAgICAgICAgYWUud2luZENvdW50ID0gYWUyLndpbmRDb3VudDtcclxuICAgICAgICBlbHNlXHJcbiAgICAgICAgICAvLyBvdGhlcndpc2Uga2VlcCAnaW5jcmVhc2luZycgdGhlIFdDIGJ5IDEgKGkuZS4gYXdheSBmcm9tIDApIC4uLlxyXG4gICAgICAgICAgYWUud2luZENvdW50ID0gYWUyLndpbmRDb3VudCArIGFlLndpbmREeDtcclxuICAgICAgfVxyXG5cclxuICAgICAgYWUud2luZENvdW50MiA9IGFlMi53aW5kQ291bnQyO1xyXG4gICAgICBhZTIgPSBhZTIubmV4dEluQUVMOyAgLy8gaS5lLiBnZXQgcmVhZHkgdG8gY2FsYyBXaW5kQ250MlxyXG5cclxuICAgIH1cclxuXHJcbiAgICBpZiAodGhpcy5fZmlsbHJ1bGUgPT09IEZpbGxSdWxlLkV2ZW5PZGQpIHtcclxuICAgICAgd2hpbGUgKGFlMiAhPT0gYWUpIHtcclxuICAgICAgICBpZiAoQ2xpcHBlckJhc2UuZ2V0UG9seVR5cGUoYWUyISkgIT09IHB0ICYmICFDbGlwcGVyQmFzZS5pc09wZW4oYWUyISkpIHtcclxuICAgICAgICAgIGFlLndpbmRDb3VudDIgPSAoYWUud2luZENvdW50MiA9PT0gMCA/IDEgOiAwKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgYWUyID0gYWUyIS5uZXh0SW5BRUw7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHdoaWxlIChhZTIgIT09IGFlKSB7XHJcbiAgICAgICAgaWYgKENsaXBwZXJCYXNlLmdldFBvbHlUeXBlKGFlMiEpICE9PSBwdCAmJiAhQ2xpcHBlckJhc2UuaXNPcGVuKGFlMiEpKSB7XHJcbiAgICAgICAgICBhZS53aW5kQ291bnQyICs9IGFlMiEud2luZER4O1xyXG4gICAgICAgIH1cclxuICAgICAgICBhZTIgPSBhZTIhLm5leHRJbkFFTDtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzZXRXaW5kQ291bnRGb3JPcGVuUGF0aEVkZ2UoYWU6IEFjdGl2ZSkge1xyXG4gICAgbGV0IGFlMjogQWN0aXZlIHwgdW5kZWZpbmVkID0gdGhpcy5fYWN0aXZlcztcclxuICAgIGlmICh0aGlzLl9maWxscnVsZSA9PT0gRmlsbFJ1bGUuRXZlbk9kZCkge1xyXG4gICAgICBsZXQgY250MSA9IDAsIGNudDIgPSAwO1xyXG4gICAgICB3aGlsZSAoYWUyICE9PSBhZSkge1xyXG4gICAgICAgIGlmIChDbGlwcGVyQmFzZS5nZXRQb2x5VHlwZShhZTIhKSA9PT0gUGF0aFR5cGUuQ2xpcClcclxuICAgICAgICAgIGNudDIrKztcclxuICAgICAgICBlbHNlIGlmICghQ2xpcHBlckJhc2UuaXNPcGVuKGFlMiEpKVxyXG4gICAgICAgICAgY250MSsrO1xyXG4gICAgICAgIGFlMiA9IGFlMiEubmV4dEluQUVMO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBhZS53aW5kQ291bnQgPSAoQ2xpcHBlckJhc2UuaXNPZGQoY250MSkgPyAxIDogMCk7XHJcbiAgICAgIGFlLndpbmRDb3VudDIgPSAoQ2xpcHBlckJhc2UuaXNPZGQoY250MikgPyAxIDogMCk7XHJcbiAgICB9XHJcbiAgICBlbHNlIHtcclxuICAgICAgd2hpbGUgKGFlMiAhPT0gYWUpIHtcclxuICAgICAgICBpZiAoQ2xpcHBlckJhc2UuZ2V0UG9seVR5cGUoYWUyISkgPT09IFBhdGhUeXBlLkNsaXApXHJcbiAgICAgICAgICBhZS53aW5kQ291bnQyICs9IGFlMiEud2luZER4O1xyXG4gICAgICAgIGVsc2UgaWYgKCFDbGlwcGVyQmFzZS5pc09wZW4oYWUyISkpXHJcbiAgICAgICAgICBhZS53aW5kQ291bnQgKz0gYWUyIS53aW5kRHg7XHJcbiAgICAgICAgYWUyID0gYWUyIS5uZXh0SW5BRUw7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGlzVmFsaWRBZWxPcmRlcihyZXNpZGVudDogQWN0aXZlLCBuZXdjb21lcjogQWN0aXZlKTogYm9vbGVhbiB7XHJcbiAgICBpZiAobmV3Y29tZXIuY3VyWCAhPT0gcmVzaWRlbnQuY3VyWClcclxuICAgICAgcmV0dXJuIG5ld2NvbWVyLmN1clggPiByZXNpZGVudC5jdXJYO1xyXG5cclxuICAgIC8vIGdldCB0aGUgdHVybmluZyBkaXJlY3Rpb24gIGExLnRvcCwgYTIuYm90LCBhMi50b3BcclxuICAgIGNvbnN0IGQ6IG51bWJlciA9IEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3QocmVzaWRlbnQudG9wLCBuZXdjb21lci5ib3QsIG5ld2NvbWVyLnRvcCk7XHJcbiAgICBpZiAoZCAhPT0gMC4wKSByZXR1cm4gKGQgPCAwKTtcclxuXHJcbiAgICAvLyBlZGdlcyBtdXN0IGJlIGNvbGxpbmVhciB0byBnZXQgaGVyZVxyXG5cclxuICAgIC8vIGZvciBzdGFydGluZyBvcGVuIHBhdGhzLCBwbGFjZSB0aGVtIGFjY29yZGluZyB0b1xyXG4gICAgLy8gdGhlIGRpcmVjdGlvbiB0aGV5J3JlIGFib3V0IHRvIHR1cm5cclxuICAgIGlmICghdGhpcy5pc01heGltYUFjdGl2ZShyZXNpZGVudCkgJiYgKHJlc2lkZW50LnRvcC55ID4gbmV3Y29tZXIudG9wLnkpKSB7XHJcbiAgICAgIHJldHVybiBJbnRlcm5hbENsaXBwZXIuY3Jvc3NQcm9kdWN0KG5ld2NvbWVyLmJvdCxcclxuICAgICAgICByZXNpZGVudC50b3AsIHRoaXMubmV4dFZlcnRleChyZXNpZGVudCkucHQpIDw9IDA7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCF0aGlzLmlzTWF4aW1hQWN0aXZlKG5ld2NvbWVyKSAmJiAobmV3Y29tZXIudG9wLnkgPiByZXNpZGVudC50b3AueSkpIHtcclxuICAgICAgcmV0dXJuIEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3QobmV3Y29tZXIuYm90LFxyXG4gICAgICAgIG5ld2NvbWVyLnRvcCwgdGhpcy5uZXh0VmVydGV4KG5ld2NvbWVyKS5wdCkgPj0gMDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB5OiBudW1iZXIgPSBuZXdjb21lci5ib3QueTtcclxuICAgIGNvbnN0IG5ld2NvbWVySXNMZWZ0OiBib29sZWFuID0gbmV3Y29tZXIuaXNMZWZ0Qm91bmQ7XHJcblxyXG4gICAgaWYgKHJlc2lkZW50LmJvdC55ICE9PSB5IHx8IHJlc2lkZW50LmxvY2FsTWluLnZlcnRleC5wdC55ICE9PSB5KVxyXG4gICAgICByZXR1cm4gbmV3Y29tZXIuaXNMZWZ0Qm91bmQ7XHJcbiAgICAvLyByZXNpZGVudCBtdXN0IGFsc28gaGF2ZSBqdXN0IGJlZW4gaW5zZXJ0ZWRcclxuICAgIGlmIChyZXNpZGVudC5pc0xlZnRCb3VuZCAhPT0gbmV3Y29tZXJJc0xlZnQpXHJcbiAgICAgIHJldHVybiBuZXdjb21lcklzTGVmdDtcclxuICAgIGlmIChJbnRlcm5hbENsaXBwZXIuY3Jvc3NQcm9kdWN0KHRoaXMucHJldlByZXZWZXJ0ZXgocmVzaWRlbnQpLnB0LFxyXG4gICAgICByZXNpZGVudC5ib3QsIHJlc2lkZW50LnRvcCkgPT09IDApIHJldHVybiB0cnVlO1xyXG4gICAgLy8gY29tcGFyZSB0dXJuaW5nIGRpcmVjdGlvbiBvZiB0aGUgYWx0ZXJuYXRlIGJvdW5kXHJcbiAgICByZXR1cm4gKEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3QodGhpcy5wcmV2UHJldlZlcnRleChyZXNpZGVudCkucHQsXHJcbiAgICAgIG5ld2NvbWVyLmJvdCwgdGhpcy5wcmV2UHJldlZlcnRleChuZXdjb21lcikucHQpID4gMCkgPT09IG5ld2NvbWVySXNMZWZ0O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBpbnNlcnRMZWZ0RWRnZShhZTogQWN0aXZlKTogdm9pZCB7XHJcbiAgICBsZXQgYWUyOiBBY3RpdmU7XHJcblxyXG4gICAgaWYgKCF0aGlzLl9hY3RpdmVzKSB7XHJcbiAgICAgIGFlLnByZXZJbkFFTCA9IHVuZGVmaW5lZDtcclxuICAgICAgYWUubmV4dEluQUVMID0gdW5kZWZpbmVkO1xyXG4gICAgICB0aGlzLl9hY3RpdmVzID0gYWU7XHJcbiAgICB9IGVsc2UgaWYgKCFDbGlwcGVyQmFzZS5pc1ZhbGlkQWVsT3JkZXIodGhpcy5fYWN0aXZlcywgYWUpKSB7XHJcbiAgICAgIGFlLnByZXZJbkFFTCA9IHVuZGVmaW5lZDtcclxuICAgICAgYWUubmV4dEluQUVMID0gdGhpcy5fYWN0aXZlcztcclxuICAgICAgdGhpcy5fYWN0aXZlcy5wcmV2SW5BRUwgPSBhZTtcclxuICAgICAgdGhpcy5fYWN0aXZlcyA9IGFlO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgYWUyID0gdGhpcy5fYWN0aXZlcztcclxuICAgICAgd2hpbGUgKGFlMi5uZXh0SW5BRUwgJiYgQ2xpcHBlckJhc2UuaXNWYWxpZEFlbE9yZGVyKGFlMi5uZXh0SW5BRUwsIGFlKSlcclxuICAgICAgICBhZTIgPSBhZTIubmV4dEluQUVMO1xyXG4gICAgICAvL2Rvbid0IHNlcGFyYXRlIGpvaW5lZCBlZGdlc1xyXG4gICAgICBpZiAoYWUyLmpvaW5XaXRoID09PSBKb2luV2l0aC5SaWdodCkgYWUyID0gYWUyLm5leHRJbkFFTCE7XHJcbiAgICAgIGFlLm5leHRJbkFFTCA9IGFlMi5uZXh0SW5BRUw7XHJcbiAgICAgIGlmIChhZTIubmV4dEluQUVMKSBhZTIubmV4dEluQUVMLnByZXZJbkFFTCA9IGFlO1xyXG4gICAgICBhZS5wcmV2SW5BRUwgPSBhZTI7XHJcbiAgICAgIGFlMi5uZXh0SW5BRUwgPSBhZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGluc2VydFJpZ2h0RWRnZShhZTogQWN0aXZlLCBhZTI6IEFjdGl2ZSk6IHZvaWQge1xyXG4gICAgYWUyLm5leHRJbkFFTCA9IGFlLm5leHRJbkFFTDtcclxuICAgIGlmIChhZS5uZXh0SW5BRUwpIGFlLm5leHRJbkFFTC5wcmV2SW5BRUwgPSBhZTI7XHJcbiAgICBhZTIucHJldkluQUVMID0gYWU7XHJcbiAgICBhZS5uZXh0SW5BRUwgPSBhZTI7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGluc2VydExvY2FsTWluaW1hSW50b0FFTChib3RZOiBudW1iZXIpOiB2b2lkIHtcclxuICAgIGxldCBsb2NhbE1pbmltYTogTG9jYWxNaW5pbWE7XHJcbiAgICBsZXQgbGVmdEJvdW5kOiBBY3RpdmUgfCB1bmRlZmluZWQ7XHJcbiAgICBsZXQgcmlnaHRCb3VuZDogQWN0aXZlIHwgdW5kZWZpbmVkO1xyXG5cclxuICAgIC8vIEFkZCBhbnkgbG9jYWwgbWluaW1hIChpZiBhbnkpIGF0IEJvdFkgLi4uXHJcbiAgICAvLyBOQiBob3Jpem9udGFsIGxvY2FsIG1pbmltYSBlZGdlcyBzaG91bGQgY29udGFpbiBsb2NNaW4udmVydGV4LnByZXZcclxuICAgIHdoaWxlICh0aGlzLmhhc0xvY01pbkF0WShib3RZKSkge1xyXG4gICAgICBsb2NhbE1pbmltYSA9IHRoaXMucG9wTG9jYWxNaW5pbWEoKTtcclxuXHJcbiAgICAgIGlmICgobG9jYWxNaW5pbWEudmVydGV4LmZsYWdzICYgVmVydGV4RmxhZ3MuT3BlblN0YXJ0KSAhPT0gVmVydGV4RmxhZ3MuTm9uZSkge1xyXG4gICAgICAgIGxlZnRCb3VuZCA9IHVuZGVmaW5lZDtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBsZWZ0Qm91bmQgPSBuZXcgQWN0aXZlKClcclxuICAgICAgICBsZWZ0Qm91bmQuYm90ID0gbG9jYWxNaW5pbWEudmVydGV4LnB0XHJcbiAgICAgICAgbGVmdEJvdW5kLmN1clggPSBsb2NhbE1pbmltYS52ZXJ0ZXgucHQueFxyXG4gICAgICAgIGxlZnRCb3VuZC53aW5kRHggPSAtMVxyXG4gICAgICAgIGxlZnRCb3VuZC52ZXJ0ZXhUb3AgPSBsb2NhbE1pbmltYS52ZXJ0ZXgucHJldlxyXG4gICAgICAgIGxlZnRCb3VuZC50b3AgPSBsb2NhbE1pbmltYS52ZXJ0ZXgucHJldiEucHRcclxuICAgICAgICBsZWZ0Qm91bmQub3V0cmVjID0gdW5kZWZpbmVkXHJcbiAgICAgICAgbGVmdEJvdW5kLmxvY2FsTWluID0gbG9jYWxNaW5pbWFcclxuXHJcbiAgICAgICAgQ2xpcHBlckJhc2Uuc2V0RHgobGVmdEJvdW5kKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKChsb2NhbE1pbmltYS52ZXJ0ZXguZmxhZ3MgJiBWZXJ0ZXhGbGFncy5PcGVuRW5kKSAhPT0gVmVydGV4RmxhZ3MuTm9uZSkge1xyXG4gICAgICAgIHJpZ2h0Qm91bmQgPSB1bmRlZmluZWQ7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcmlnaHRCb3VuZCA9IG5ldyBBY3RpdmUoKVxyXG4gICAgICAgIHJpZ2h0Qm91bmQuYm90ID0gbG9jYWxNaW5pbWEudmVydGV4LnB0XHJcbiAgICAgICAgcmlnaHRCb3VuZC5jdXJYID0gbG9jYWxNaW5pbWEudmVydGV4LnB0LnhcclxuICAgICAgICByaWdodEJvdW5kLndpbmREeCA9IDFcclxuICAgICAgICByaWdodEJvdW5kLnZlcnRleFRvcCA9IGxvY2FsTWluaW1hLnZlcnRleC5uZXh0XHJcbiAgICAgICAgcmlnaHRCb3VuZC50b3AgPSBsb2NhbE1pbmltYS52ZXJ0ZXgubmV4dCEucHRcclxuICAgICAgICByaWdodEJvdW5kLm91dHJlYyA9IHVuZGVmaW5lZFxyXG4gICAgICAgIHJpZ2h0Qm91bmQubG9jYWxNaW4gPSBsb2NhbE1pbmltYVxyXG5cclxuICAgICAgICBDbGlwcGVyQmFzZS5zZXREeChyaWdodEJvdW5kKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGxlZnRCb3VuZCAmJiByaWdodEJvdW5kKSB7XHJcbiAgICAgICAgaWYgKENsaXBwZXJCYXNlLmlzSG9yaXpvbnRhbChsZWZ0Qm91bmQpKSB7XHJcbiAgICAgICAgICBpZiAoQ2xpcHBlckJhc2UuaXNIZWFkaW5nUmlnaHRIb3J6KGxlZnRCb3VuZCkpIHtcclxuICAgICAgICAgICAgW3JpZ2h0Qm91bmQsIGxlZnRCb3VuZF0gPSBbbGVmdEJvdW5kLCByaWdodEJvdW5kXVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSBpZiAoQ2xpcHBlckJhc2UuaXNIb3Jpem9udGFsKHJpZ2h0Qm91bmQpKSB7XHJcbiAgICAgICAgICBpZiAoQ2xpcHBlckJhc2UuaXNIZWFkaW5nTGVmdEhvcnoocmlnaHRCb3VuZCkpIHtcclxuICAgICAgICAgICAgW3JpZ2h0Qm91bmQsIGxlZnRCb3VuZF0gPSBbbGVmdEJvdW5kLCByaWdodEJvdW5kXVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSBpZiAobGVmdEJvdW5kLmR4IDwgcmlnaHRCb3VuZC5keCkge1xyXG4gICAgICAgICAgW3JpZ2h0Qm91bmQsIGxlZnRCb3VuZF0gPSBbbGVmdEJvdW5kLCByaWdodEJvdW5kXVxyXG4gICAgICAgIH1cclxuICAgICAgICAvL3NvIHdoZW4gbGVmdEJvdW5kIGhhcyB3aW5kRHggPT0gMSwgdGhlIHBvbHlnb24gd2lsbCBiZSBvcmllbnRlZFxyXG4gICAgICAgIC8vY291bnRlci1jbG9ja3dpc2UgaW4gQ2FydGVzaWFuIGNvb3JkcyAoY2xvY2t3aXNlIHdpdGggaW52ZXJ0ZWQgWSkuXHJcbiAgICAgIH0gZWxzZSBpZiAobGVmdEJvdW5kID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBsZWZ0Qm91bmQgPSByaWdodEJvdW5kO1xyXG4gICAgICAgIHJpZ2h0Qm91bmQgPSB1bmRlZmluZWQ7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGxldCBjb250cmlidXRpbmcgPSBmYWxzZVxyXG4gICAgICBsZWZ0Qm91bmQhLmlzTGVmdEJvdW5kID0gdHJ1ZTtcclxuICAgICAgdGhpcy5pbnNlcnRMZWZ0RWRnZShsZWZ0Qm91bmQhKTtcclxuXHJcbiAgICAgIGlmIChDbGlwcGVyQmFzZS5pc09wZW4obGVmdEJvdW5kISkpIHtcclxuICAgICAgICB0aGlzLnNldFdpbmRDb3VudEZvck9wZW5QYXRoRWRnZShsZWZ0Qm91bmQhKTtcclxuICAgICAgICBjb250cmlidXRpbmcgPSB0aGlzLmlzQ29udHJpYnV0aW5nT3BlbihsZWZ0Qm91bmQhKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLnNldFdpbmRDb3VudEZvckNsb3NlZFBhdGhFZGdlKGxlZnRCb3VuZCEpO1xyXG4gICAgICAgIGNvbnRyaWJ1dGluZyA9IHRoaXMuaXNDb250cmlidXRpbmdDbG9zZWQobGVmdEJvdW5kISk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChyaWdodEJvdW5kKSB7XHJcbiAgICAgICAgcmlnaHRCb3VuZC53aW5kQ291bnQgPSBsZWZ0Qm91bmQhLndpbmRDb3VudDtcclxuICAgICAgICByaWdodEJvdW5kLndpbmRDb3VudDIgPSBsZWZ0Qm91bmQhLndpbmRDb3VudDI7XHJcbiAgICAgICAgQ2xpcHBlckJhc2UuaW5zZXJ0UmlnaHRFZGdlKGxlZnRCb3VuZCEsIHJpZ2h0Qm91bmQpO1xyXG5cclxuICAgICAgICBpZiAoY29udHJpYnV0aW5nKSB7XHJcbiAgICAgICAgICB0aGlzLmFkZExvY2FsTWluUG9seShsZWZ0Qm91bmQhLCByaWdodEJvdW5kLCBsZWZ0Qm91bmQhLmJvdCwgdHJ1ZSk7XHJcbiAgICAgICAgICBpZiAoIUNsaXBwZXJCYXNlLmlzSG9yaXpvbnRhbChsZWZ0Qm91bmQhKSkge1xyXG4gICAgICAgICAgICB0aGlzLmNoZWNrSm9pbkxlZnQobGVmdEJvdW5kISwgbGVmdEJvdW5kIS5ib3QpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgd2hpbGUgKHJpZ2h0Qm91bmQubmV4dEluQUVMICYmXHJcbiAgICAgICAgICBDbGlwcGVyQmFzZS5pc1ZhbGlkQWVsT3JkZXIocmlnaHRCb3VuZC5uZXh0SW5BRUwsIHJpZ2h0Qm91bmQpKSB7XHJcbiAgICAgICAgICB0aGlzLmludGVyc2VjdEVkZ2VzKHJpZ2h0Qm91bmQsIHJpZ2h0Qm91bmQubmV4dEluQUVMLCByaWdodEJvdW5kLmJvdCk7XHJcbiAgICAgICAgICB0aGlzLnN3YXBQb3NpdGlvbnNJbkFFTChyaWdodEJvdW5kLCByaWdodEJvdW5kLm5leHRJbkFFTCk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoQ2xpcHBlckJhc2UuaXNIb3Jpem9udGFsKHJpZ2h0Qm91bmQpKSB7XHJcbiAgICAgICAgICB0aGlzLnB1c2hIb3J6KHJpZ2h0Qm91bmQpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICB0aGlzLmNoZWNrSm9pblJpZ2h0KHJpZ2h0Qm91bmQsIHJpZ2h0Qm91bmQuYm90KTtcclxuICAgICAgICAgIHRoaXMuaW5zZXJ0U2NhbmxpbmUocmlnaHRCb3VuZC50b3AueSk7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgfSBlbHNlIGlmIChjb250cmlidXRpbmcpIHtcclxuICAgICAgICB0aGlzLnN0YXJ0T3BlblBhdGgobGVmdEJvdW5kISwgbGVmdEJvdW5kIS5ib3QpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoQ2xpcHBlckJhc2UuaXNIb3Jpem9udGFsKGxlZnRCb3VuZCEpKSB7XHJcbiAgICAgICAgdGhpcy5wdXNoSG9yeihsZWZ0Qm91bmQhKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLmluc2VydFNjYW5saW5lKGxlZnRCb3VuZCEudG9wLnkpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHB1c2hIb3J6KGFlOiBBY3RpdmUpOiB2b2lkIHtcclxuICAgIGFlLm5leHRJblNFTCA9IHRoaXMuX3NlbDtcclxuICAgIHRoaXMuX3NlbCA9IGFlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBwb3BIb3J6KCk6IEFjdGl2ZSB8IHVuZGVmaW5lZCB7XHJcbiAgICBjb25zdCBhZSA9IHRoaXMuX3NlbDtcclxuICAgIGlmICh0aGlzLl9zZWwgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgIHRoaXMuX3NlbCA9IHRoaXMuX3NlbC5uZXh0SW5TRUw7XHJcbiAgICByZXR1cm4gYWU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFkZExvY2FsTWluUG9seShhZTE6IEFjdGl2ZSwgYWUyOiBBY3RpdmUsIHB0OiBJUG9pbnQ2NCwgaXNOZXc6IGJvb2xlYW4gPSBmYWxzZSk6IE91dFB0IHtcclxuICAgIGNvbnN0IG91dHJlYzogT3V0UmVjID0gdGhpcy5uZXdPdXRSZWMoKTtcclxuICAgIGFlMS5vdXRyZWMgPSBvdXRyZWM7XHJcbiAgICBhZTIub3V0cmVjID0gb3V0cmVjO1xyXG5cclxuICAgIGlmIChDbGlwcGVyQmFzZS5pc09wZW4oYWUxKSkge1xyXG4gICAgICBvdXRyZWMub3duZXIgPSB1bmRlZmluZWQ7XHJcbiAgICAgIG91dHJlYy5pc09wZW4gPSB0cnVlO1xyXG4gICAgICBpZiAoYWUxLndpbmREeCA+IDApXHJcbiAgICAgICAgQ2xpcHBlckJhc2Uuc2V0U2lkZXMob3V0cmVjLCBhZTEsIGFlMik7XHJcbiAgICAgIGVsc2VcclxuICAgICAgICBDbGlwcGVyQmFzZS5zZXRTaWRlcyhvdXRyZWMsIGFlMiwgYWUxKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIG91dHJlYy5pc09wZW4gPSBmYWxzZTtcclxuICAgICAgY29uc3QgcHJldkhvdEVkZ2UgPSBDbGlwcGVyQmFzZS5nZXRQcmV2SG90RWRnZShhZTEpO1xyXG5cclxuICAgICAgLy8gZS53aW5kRHggaXMgdGhlIHdpbmRpbmcgZGlyZWN0aW9uIG9mIHRoZSAqKmlucHV0KiogcGF0aHNcclxuICAgICAgLy8gYW5kIHVucmVsYXRlZCB0byB0aGUgd2luZGluZyBkaXJlY3Rpb24gb2Ygb3V0cHV0IHBvbHlnb25zLlxyXG4gICAgICAvLyBPdXRwdXQgb3JpZW50YXRpb24gaXMgZGV0ZXJtaW5lZCBieSBlLm91dHJlYy5mcm9udEUgd2hpY2ggaXNcclxuICAgICAgLy8gdGhlIGFzY2VuZGluZyBlZGdlIChzZWUgQWRkTG9jYWxNaW5Qb2x5KS5cclxuICAgICAgaWYgKHByZXZIb3RFZGdlKSB7XHJcbiAgICAgICAgaWYgKHRoaXMuX3VzaW5nX3BvbHl0cmVlKVxyXG4gICAgICAgICAgQ2xpcHBlckJhc2Uuc2V0T3duZXIob3V0cmVjLCBwcmV2SG90RWRnZS5vdXRyZWMhKTtcclxuICAgICAgICBvdXRyZWMub3duZXIgPSBwcmV2SG90RWRnZS5vdXRyZWM7XHJcblxyXG4gICAgICAgIGlmIChDbGlwcGVyQmFzZS5vdXRyZWNJc0FzY2VuZGluZyhwcmV2SG90RWRnZSkgPT09IGlzTmV3KVxyXG4gICAgICAgICAgQ2xpcHBlckJhc2Uuc2V0U2lkZXMob3V0cmVjLCBhZTIsIGFlMSk7XHJcbiAgICAgICAgZWxzZVxyXG4gICAgICAgICAgQ2xpcHBlckJhc2Uuc2V0U2lkZXMob3V0cmVjLCBhZTEsIGFlMik7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgb3V0cmVjLm93bmVyID0gdW5kZWZpbmVkO1xyXG4gICAgICAgIGlmIChpc05ldylcclxuICAgICAgICAgIENsaXBwZXJCYXNlLnNldFNpZGVzKG91dHJlYywgYWUxLCBhZTIpO1xyXG4gICAgICAgIGVsc2VcclxuICAgICAgICAgIENsaXBwZXJCYXNlLnNldFNpZGVzKG91dHJlYywgYWUyLCBhZTEpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgb3AgPSBuZXcgT3V0UHQocHQsIG91dHJlYyk7XHJcbiAgICBvdXRyZWMucHRzID0gb3A7XHJcbiAgICByZXR1cm4gb3A7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFkZExvY2FsTWF4UG9seShhZTE6IEFjdGl2ZSwgYWUyOiBBY3RpdmUsIHB0OiBJUG9pbnQ2NCk6IE91dFB0IHwgdW5kZWZpbmVkIHtcclxuICAgIGlmIChDbGlwcGVyQmFzZS5pc0pvaW5lZChhZTEpKSB0aGlzLnNwbGl0KGFlMSwgcHQpO1xyXG4gICAgaWYgKENsaXBwZXJCYXNlLmlzSm9pbmVkKGFlMikpIHRoaXMuc3BsaXQoYWUyLCBwdCk7XHJcblxyXG4gICAgaWYgKENsaXBwZXJCYXNlLmlzRnJvbnQoYWUxKSA9PT0gQ2xpcHBlckJhc2UuaXNGcm9udChhZTIpKSB7XHJcbiAgICAgIGlmIChDbGlwcGVyQmFzZS5pc09wZW5FbmRBY3RpdmUoYWUxKSlcclxuICAgICAgICBDbGlwcGVyQmFzZS5zd2FwRnJvbnRCYWNrU2lkZXMoYWUxLm91dHJlYyEpO1xyXG4gICAgICBlbHNlIGlmIChDbGlwcGVyQmFzZS5pc09wZW5FbmRBY3RpdmUoYWUyKSlcclxuICAgICAgICBDbGlwcGVyQmFzZS5zd2FwRnJvbnRCYWNrU2lkZXMoYWUyLm91dHJlYyEpO1xyXG4gICAgICBlbHNlIHtcclxuICAgICAgICB0aGlzLl9zdWNjZWVkZWQgPSBmYWxzZTtcclxuICAgICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzdWx0ID0gQ2xpcHBlckJhc2UuYWRkT3V0UHQoYWUxLCBwdCk7XHJcbiAgICBpZiAoYWUxLm91dHJlYyA9PT0gYWUyLm91dHJlYykge1xyXG4gICAgICBjb25zdCBvdXRyZWMgPSBhZTEub3V0cmVjITtcclxuICAgICAgb3V0cmVjLnB0cyA9IHJlc3VsdDtcclxuXHJcbiAgICAgIGlmICh0aGlzLl91c2luZ19wb2x5dHJlZSkge1xyXG4gICAgICAgIGNvbnN0IGUgPSBDbGlwcGVyQmFzZS5nZXRQcmV2SG90RWRnZShhZTEpO1xyXG4gICAgICAgIGlmIChlID09PSB1bmRlZmluZWQpXHJcbiAgICAgICAgICBvdXRyZWMub3duZXIgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgZWxzZVxyXG4gICAgICAgICAgQ2xpcHBlckJhc2Uuc2V0T3duZXIob3V0cmVjLCBlLm91dHJlYyEpO1xyXG4gICAgICB9XHJcbiAgICAgIENsaXBwZXJCYXNlLnVuY291cGxlT3V0UmVjKGFlMSk7XHJcbiAgICB9IGVsc2UgaWYgKENsaXBwZXJCYXNlLmlzT3BlbihhZTEpKSB7XHJcbiAgICAgIGlmIChhZTEud2luZER4IDwgMClcclxuICAgICAgICBDbGlwcGVyQmFzZS5qb2luT3V0cmVjUGF0aHMoYWUxLCBhZTIpO1xyXG4gICAgICBlbHNlXHJcbiAgICAgICAgQ2xpcHBlckJhc2Uuam9pbk91dHJlY1BhdGhzKGFlMiwgYWUxKTtcclxuICAgIH0gZWxzZSBpZiAoYWUxLm91dHJlYyEuaWR4IDwgYWUyLm91dHJlYyEuaWR4KVxyXG4gICAgICBDbGlwcGVyQmFzZS5qb2luT3V0cmVjUGF0aHMoYWUxLCBhZTIpO1xyXG4gICAgZWxzZVxyXG4gICAgICBDbGlwcGVyQmFzZS5qb2luT3V0cmVjUGF0aHMoYWUyLCBhZTEpO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGpvaW5PdXRyZWNQYXRocyhhZTE6IEFjdGl2ZSwgYWUyOiBBY3RpdmUpOiB2b2lkIHtcclxuICAgIC8vIGpvaW4gYWUyIG91dHJlYyBwYXRoIG9udG8gYWUxIG91dHJlYyBwYXRoIGFuZCB0aGVuIGRlbGV0ZSBhZTIgb3V0cmVjIHBhdGhcclxuICAgIC8vIHBvaW50ZXJzLiAoTkIgT25seSB2ZXJ5IHJhcmVseSBkbyB0aGUgam9pbmluZyBlbmRzIHNoYXJlIHRoZSBzYW1lIGNvb3Jkcy4pXHJcbiAgICBjb25zdCBwMVN0YXJ0OiBPdXRQdCA9IGFlMS5vdXRyZWMhLnB0cyE7XHJcbiAgICBjb25zdCBwMlN0YXJ0OiBPdXRQdCA9IGFlMi5vdXRyZWMhLnB0cyE7XHJcbiAgICBjb25zdCBwMUVuZDogT3V0UHQgPSBwMVN0YXJ0Lm5leHQhO1xyXG4gICAgY29uc3QgcDJFbmQ6IE91dFB0ID0gcDJTdGFydC5uZXh0ITtcclxuXHJcbiAgICBpZiAoQ2xpcHBlckJhc2UuaXNGcm9udChhZTEpKSB7XHJcbiAgICAgIHAyRW5kLnByZXYgPSBwMVN0YXJ0O1xyXG4gICAgICBwMVN0YXJ0Lm5leHQgPSBwMkVuZDtcclxuICAgICAgcDJTdGFydC5uZXh0ID0gcDFFbmQ7XHJcbiAgICAgIHAxRW5kLnByZXYgPSBwMlN0YXJ0O1xyXG5cclxuICAgICAgYWUxLm91dHJlYyEucHRzID0gcDJTdGFydDtcclxuICAgICAgLy8gbmI6IGlmIElzT3BlbihlMSkgdGhlbiBlMSAmIGUyIG11c3QgYmUgYSAnbWF4aW1hUGFpcidcclxuICAgICAgYWUxLm91dHJlYyEuZnJvbnRFZGdlID0gYWUyLm91dHJlYyEuZnJvbnRFZGdlO1xyXG4gICAgICBpZiAoYWUxLm91dHJlYyEuZnJvbnRFZGdlKVxyXG4gICAgICAgIGFlMS5vdXRyZWMhLmZyb250RWRnZSEub3V0cmVjID0gYWUxLm91dHJlYztcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHAxRW5kLnByZXYgPSBwMlN0YXJ0O1xyXG4gICAgICBwMlN0YXJ0Lm5leHQgPSBwMUVuZDtcclxuICAgICAgcDFTdGFydC5uZXh0ID0gcDJFbmQ7XHJcbiAgICAgIHAyRW5kLnByZXYgPSBwMVN0YXJ0O1xyXG5cclxuICAgICAgYWUxLm91dHJlYyEuYmFja0VkZ2UgPSBhZTIub3V0cmVjIS5iYWNrRWRnZTtcclxuICAgICAgaWYgKGFlMS5vdXRyZWMhLmJhY2tFZGdlKVxyXG4gICAgICAgIGFlMS5vdXRyZWMhLmJhY2tFZGdlIS5vdXRyZWMgPSBhZTEub3V0cmVjO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIGFmdGVyIGpvaW5pbmcsIHRoZSBhZTIuT3V0UmVjIG11c3QgY29udGFpbnMgbm8gdmVydGljZXMgLi4uXHJcbiAgICBhZTIub3V0cmVjIS5mcm9udEVkZ2UgPSB1bmRlZmluZWQ7XHJcbiAgICBhZTIub3V0cmVjIS5iYWNrRWRnZSA9IHVuZGVmaW5lZDtcclxuICAgIGFlMi5vdXRyZWMhLnB0cyA9IHVuZGVmaW5lZDtcclxuICAgIENsaXBwZXJCYXNlLnNldE93bmVyKGFlMi5vdXRyZWMhLCBhZTEub3V0cmVjISk7XHJcblxyXG4gICAgaWYgKENsaXBwZXJCYXNlLmlzT3BlbkVuZEFjdGl2ZShhZTEpKSB7XHJcbiAgICAgIGFlMi5vdXRyZWMhLnB0cyA9IGFlMS5vdXRyZWMhLnB0cztcclxuICAgICAgYWUxLm91dHJlYyEucHRzID0gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIGFuZCBhZTEgYW5kIGFlMiBhcmUgbWF4aW1hIGFuZCBhcmUgYWJvdXQgdG8gYmUgZHJvcHBlZCBmcm9tIHRoZSBBY3RpdmVzIGxpc3QuXHJcbiAgICBhZTEub3V0cmVjID0gdW5kZWZpbmVkO1xyXG4gICAgYWUyLm91dHJlYyA9IHVuZGVmaW5lZDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGFkZE91dFB0KGFlOiBBY3RpdmUsIHB0OiBJUG9pbnQ2NCk6IE91dFB0IHtcclxuICAgIGNvbnN0IG91dHJlYzogT3V0UmVjID0gYWUub3V0cmVjITtcclxuICAgIGNvbnN0IHRvRnJvbnQ6IGJvb2xlYW4gPSBDbGlwcGVyQmFzZS5pc0Zyb250KGFlKTtcclxuICAgIGNvbnN0IG9wRnJvbnQ6IE91dFB0ID0gb3V0cmVjLnB0cyE7XHJcbiAgICBjb25zdCBvcEJhY2s6IE91dFB0ID0gb3BGcm9udC5uZXh0ITtcclxuXHJcbiAgICBpZiAodG9Gcm9udCAmJiAocHQgPT0gb3BGcm9udC5wdCkpIHJldHVybiBvcEZyb250O1xyXG4gICAgZWxzZSBpZiAoIXRvRnJvbnQgJiYgKHB0ID09IG9wQmFjay5wdCkpIHJldHVybiBvcEJhY2s7XHJcblxyXG4gICAgY29uc3QgbmV3T3AgPSBuZXcgT3V0UHQocHQsIG91dHJlYyk7XHJcbiAgICBvcEJhY2sucHJldiA9IG5ld09wO1xyXG4gICAgbmV3T3AucHJldiA9IG9wRnJvbnQ7XHJcbiAgICBuZXdPcC5uZXh0ID0gb3BCYWNrO1xyXG4gICAgb3BGcm9udC5uZXh0ID0gbmV3T3A7XHJcblxyXG4gICAgaWYgKHRvRnJvbnQpIG91dHJlYy5wdHMgPSBuZXdPcDtcclxuXHJcbiAgICByZXR1cm4gbmV3T3A7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIG5ld091dFJlYygpOiBPdXRSZWMge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gbmV3IE91dFJlYyh0aGlzLl9vdXRyZWNMaXN0Lmxlbmd0aCk7XHJcbiAgICB0aGlzLl9vdXRyZWNMaXN0LnB1c2gocmVzdWx0KTtcclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXJ0T3BlblBhdGgoYWU6IEFjdGl2ZSwgcHQ6IElQb2ludDY0KTogT3V0UHQge1xyXG4gICAgY29uc3Qgb3V0cmVjID0gdGhpcy5uZXdPdXRSZWMoKTtcclxuICAgIG91dHJlYy5pc09wZW4gPSB0cnVlO1xyXG4gICAgaWYgKGFlLndpbmREeCA+IDApIHtcclxuICAgICAgb3V0cmVjLmZyb250RWRnZSA9IGFlO1xyXG4gICAgICBvdXRyZWMuYmFja0VkZ2UgPSB1bmRlZmluZWQ7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBvdXRyZWMuZnJvbnRFZGdlID0gdW5kZWZpbmVkO1xyXG4gICAgICBvdXRyZWMuYmFja0VkZ2UgPSBhZTtcclxuICAgIH1cclxuXHJcbiAgICBhZS5vdXRyZWMgPSBvdXRyZWM7XHJcbiAgICBjb25zdCBvcCA9IG5ldyBPdXRQdChwdCwgb3V0cmVjKTtcclxuICAgIG91dHJlYy5wdHMgPSBvcDtcclxuICAgIHJldHVybiBvcDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgdXBkYXRlRWRnZUludG9BRUwoYWU6IEFjdGl2ZSk6IHZvaWQge1xyXG4gICAgYWUuYm90ID0gYWUudG9wITtcclxuICAgIGFlLnZlcnRleFRvcCA9IENsaXBwZXJCYXNlLm5leHRWZXJ0ZXgoYWUpO1xyXG4gICAgYWUudG9wID0gYWUudmVydGV4VG9wIS5wdDtcclxuICAgIGFlLmN1clggPSBhZS5ib3QueDtcclxuICAgIENsaXBwZXJCYXNlLnNldER4KGFlKTtcclxuXHJcbiAgICBpZiAoQ2xpcHBlckJhc2UuaXNKb2luZWQoYWUpKSB0aGlzLnNwbGl0KGFlLCBhZS5ib3QpO1xyXG5cclxuICAgIGlmIChDbGlwcGVyQmFzZS5pc0hvcml6b250YWwoYWUpKSByZXR1cm47XHJcbiAgICB0aGlzLmluc2VydFNjYW5saW5lKGFlLnRvcC55KTtcclxuXHJcbiAgICB0aGlzLmNoZWNrSm9pbkxlZnQoYWUsIGFlLmJvdCk7XHJcbiAgICB0aGlzLmNoZWNrSm9pblJpZ2h0KGFlLCBhZS5ib3QsIHRydWUpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgZmluZEVkZ2VXaXRoTWF0Y2hpbmdMb2NNaW4oZTogQWN0aXZlKTogQWN0aXZlIHwgdW5kZWZpbmVkIHtcclxuICAgIGxldCByZXN1bHQ6IEFjdGl2ZSB8IHVuZGVmaW5lZCA9IGUubmV4dEluQUVMO1xyXG4gICAgd2hpbGUgKHJlc3VsdCkge1xyXG4gICAgICBpZiAocmVzdWx0LmxvY2FsTWluID09PSBlLmxvY2FsTWluKSByZXR1cm4gcmVzdWx0O1xyXG4gICAgICBpZiAoIUNsaXBwZXJCYXNlLmlzSG9yaXpvbnRhbChyZXN1bHQpICYmIGUuYm90ICE9PSByZXN1bHQuYm90KSByZXN1bHQgPSB1bmRlZmluZWQ7XHJcbiAgICAgIGVsc2UgcmVzdWx0ID0gcmVzdWx0Lm5leHRJbkFFTDtcclxuICAgIH1cclxuXHJcbiAgICByZXN1bHQgPSBlLnByZXZJbkFFTDtcclxuICAgIHdoaWxlIChyZXN1bHQpIHtcclxuICAgICAgaWYgKHJlc3VsdC5sb2NhbE1pbiA9PT0gZS5sb2NhbE1pbikgcmV0dXJuIHJlc3VsdDtcclxuICAgICAgaWYgKCFDbGlwcGVyQmFzZS5pc0hvcml6b250YWwocmVzdWx0KSAmJiBlLmJvdCAhPT0gcmVzdWx0LmJvdCkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgICAgcmVzdWx0ID0gcmVzdWx0LnByZXZJbkFFTDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBpbnRlcnNlY3RFZGdlcyhhZTE6IEFjdGl2ZSwgYWUyOiBBY3RpdmUsIHB0OiBJUG9pbnQ2NCk6IE91dFB0IHwgdW5kZWZpbmVkIHtcclxuICAgIGxldCByZXN1bHRPcDogT3V0UHQgfCB1bmRlZmluZWQgPSB1bmRlZmluZWQ7XHJcblxyXG4gICAgLy8gTUFOQUdFIE9QRU4gUEFUSCBJTlRFUlNFQ1RJT05TIFNFUEFSQVRFTFkgLi4uXHJcbiAgICBpZiAodGhpcy5faGFzT3BlblBhdGhzICYmIChDbGlwcGVyQmFzZS5pc09wZW4oYWUxKSB8fCBDbGlwcGVyQmFzZS5pc09wZW4oYWUyKSkpIHtcclxuICAgICAgaWYgKENsaXBwZXJCYXNlLmlzT3BlbihhZTEpICYmIENsaXBwZXJCYXNlLmlzT3BlbihhZTIpKSByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICAvLyB0aGUgZm9sbG93aW5nIGxpbmUgYXZvaWRzIGR1cGxpY2F0aW5nIHF1aXRlIGEgYml0IG9mIGNvZGVcclxuICAgICAgaWYgKENsaXBwZXJCYXNlLmlzT3BlbihhZTIpKSBDbGlwcGVyQmFzZS5zd2FwQWN0aXZlcyhhZTEsIGFlMik7XHJcbiAgICAgIGlmIChDbGlwcGVyQmFzZS5pc0pvaW5lZChhZTIpKSB0aGlzLnNwbGl0KGFlMiwgcHQpO1xyXG5cclxuICAgICAgaWYgKHRoaXMuX2NsaXB0eXBlID09PSBDbGlwVHlwZS5Vbmlvbikge1xyXG4gICAgICAgIGlmICghQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKGFlMikpIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgIH0gZWxzZSBpZiAoYWUyLmxvY2FsTWluLnBvbHl0eXBlID09PSBQYXRoVHlwZS5TdWJqZWN0KVxyXG4gICAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcblxyXG4gICAgICBzd2l0Y2ggKHRoaXMuX2ZpbGxydWxlKSB7XHJcbiAgICAgICAgY2FzZSBGaWxsUnVsZS5Qb3NpdGl2ZTpcclxuICAgICAgICAgIGlmIChhZTIud2luZENvdW50ICE9PSAxKSByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgY2FzZSBGaWxsUnVsZS5OZWdhdGl2ZTpcclxuICAgICAgICAgIGlmIChhZTIud2luZENvdW50ICE9PSAtMSkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICBpZiAoTWF0aC5hYnMoYWUyLndpbmRDb3VudCkgIT09IDEpIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gdG9nZ2xlIGNvbnRyaWJ1dGlvbiAuLi5cclxuICAgICAgaWYgKENsaXBwZXJCYXNlLmlzSG90RWRnZUFjdGl2ZShhZTEpKSB7XHJcbiAgICAgICAgcmVzdWx0T3AgPSBDbGlwcGVyQmFzZS5hZGRPdXRQdChhZTEsIHB0KTtcclxuICAgICAgICBpZiAoQ2xpcHBlckJhc2UuaXNGcm9udChhZTEpKSB7XHJcbiAgICAgICAgICBhZTEub3V0cmVjIS5mcm9udEVkZ2UgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGFlMS5vdXRyZWMhLmJhY2tFZGdlID0gdW5kZWZpbmVkO1xyXG4gICAgICAgIH1cclxuICAgICAgICBhZTEub3V0cmVjID0gdW5kZWZpbmVkO1xyXG5cclxuICAgICAgICAvLyBob3Jpem9udGFsIGVkZ2VzIGNhbiBwYXNzIHVuZGVyIG9wZW4gcGF0aHMgYXQgYSBMb2NNaW5zXHJcbiAgICAgIH0gZWxzZSBpZiAocHQgPT09IGFlMS5sb2NhbE1pbi52ZXJ0ZXgucHQgJiYgIUNsaXBwZXJCYXNlLmlzT3BlbkVuZChhZTEubG9jYWxNaW4udmVydGV4KSkge1xyXG4gICAgICAgIC8vIGZpbmQgdGhlIG90aGVyIHNpZGUgb2YgdGhlIExvY01pbiBhbmRcclxuICAgICAgICAvLyBpZiBpdCdzICdob3QnIGpvaW4gdXAgd2l0aCBpdCAuLi5cclxuICAgICAgICBjb25zdCBhZTM6IEFjdGl2ZSB8IHVuZGVmaW5lZCA9IENsaXBwZXJCYXNlLmZpbmRFZGdlV2l0aE1hdGNoaW5nTG9jTWluKGFlMSk7XHJcbiAgICAgICAgaWYgKGFlMyAmJiBDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUoYWUzKSkge1xyXG4gICAgICAgICAgYWUxLm91dHJlYyA9IGFlMy5vdXRyZWM7XHJcbiAgICAgICAgICBpZiAoYWUxLndpbmREeCA+IDApIHtcclxuICAgICAgICAgICAgQ2xpcHBlckJhc2Uuc2V0U2lkZXMoYWUzLm91dHJlYyEsIGFlMSwgYWUzKTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIENsaXBwZXJCYXNlLnNldFNpZGVzKGFlMy5vdXRyZWMhLCBhZTMsIGFlMSk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICByZXR1cm4gYWUzLm91dHJlYyEucHRzO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXN1bHRPcCA9IHRoaXMuc3RhcnRPcGVuUGF0aChhZTEsIHB0KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICByZXN1bHRPcCA9IHRoaXMuc3RhcnRPcGVuUGF0aChhZTEsIHB0KTtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHJlc3VsdE9wO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIE1BTkFHSU5HIENMT1NFRCBQQVRIUyBGUk9NIEhFUkUgT05cclxuICAgIGlmIChDbGlwcGVyQmFzZS5pc0pvaW5lZChhZTEpKSB0aGlzLnNwbGl0KGFlMSwgcHQpO1xyXG4gICAgaWYgKENsaXBwZXJCYXNlLmlzSm9pbmVkKGFlMikpIHRoaXMuc3BsaXQoYWUyLCBwdCk7XHJcblxyXG4gICAgLy8gVVBEQVRFIFdJTkRJTkcgQ09VTlRTLi4uXHJcbiAgICBsZXQgb2xkRTFXaW5kQ291bnQ6IG51bWJlcjtcclxuICAgIGxldCBvbGRFMldpbmRDb3VudDogbnVtYmVyO1xyXG5cclxuICAgIGlmIChhZTEubG9jYWxNaW4ucG9seXR5cGUgPT09IGFlMi5sb2NhbE1pbi5wb2x5dHlwZSkge1xyXG4gICAgICBpZiAodGhpcy5fZmlsbHJ1bGUgPT09IEZpbGxSdWxlLkV2ZW5PZGQpIHtcclxuICAgICAgICBvbGRFMVdpbmRDb3VudCA9IGFlMS53aW5kQ291bnQ7XHJcbiAgICAgICAgYWUxLndpbmRDb3VudCA9IGFlMi53aW5kQ291bnQ7XHJcbiAgICAgICAgYWUyLndpbmRDb3VudCA9IG9sZEUxV2luZENvdW50O1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGlmIChhZTEud2luZENvdW50ICsgYWUyLndpbmREeCA9PT0gMClcclxuICAgICAgICAgIGFlMS53aW5kQ291bnQgPSAtYWUxLndpbmRDb3VudDtcclxuICAgICAgICBlbHNlXHJcbiAgICAgICAgICBhZTEud2luZENvdW50ICs9IGFlMi53aW5kRHg7XHJcbiAgICAgICAgaWYgKGFlMi53aW5kQ291bnQgLSBhZTEud2luZER4ID09PSAwKVxyXG4gICAgICAgICAgYWUyLndpbmRDb3VudCA9IC1hZTIud2luZENvdW50O1xyXG4gICAgICAgIGVsc2VcclxuICAgICAgICAgIGFlMi53aW5kQ291bnQgLT0gYWUxLndpbmREeDtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgaWYgKHRoaXMuX2ZpbGxydWxlICE9PSBGaWxsUnVsZS5FdmVuT2RkKVxyXG4gICAgICAgIGFlMS53aW5kQ291bnQyICs9IGFlMi53aW5kRHg7XHJcbiAgICAgIGVsc2VcclxuICAgICAgICBhZTEud2luZENvdW50MiA9IChhZTEud2luZENvdW50MiA9PT0gMCA/IDEgOiAwKTtcclxuICAgICAgaWYgKHRoaXMuX2ZpbGxydWxlICE9PSBGaWxsUnVsZS5FdmVuT2RkKVxyXG4gICAgICAgIGFlMi53aW5kQ291bnQyIC09IGFlMS53aW5kRHg7XHJcbiAgICAgIGVsc2VcclxuICAgICAgICBhZTIud2luZENvdW50MiA9IChhZTIud2luZENvdW50MiA9PT0gMCA/IDEgOiAwKTtcclxuICAgIH1cclxuXHJcbiAgICBzd2l0Y2ggKHRoaXMuX2ZpbGxydWxlKSB7XHJcbiAgICAgIGNhc2UgRmlsbFJ1bGUuUG9zaXRpdmU6XHJcbiAgICAgICAgb2xkRTFXaW5kQ291bnQgPSBhZTEud2luZENvdW50O1xyXG4gICAgICAgIG9sZEUyV2luZENvdW50ID0gYWUyLndpbmRDb3VudDtcclxuICAgICAgICBicmVhaztcclxuICAgICAgY2FzZSBGaWxsUnVsZS5OZWdhdGl2ZTpcclxuICAgICAgICBvbGRFMVdpbmRDb3VudCA9IC1hZTEud2luZENvdW50O1xyXG4gICAgICAgIG9sZEUyV2luZENvdW50ID0gLWFlMi53aW5kQ291bnQ7XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgb2xkRTFXaW5kQ291bnQgPSBNYXRoLmFicyhhZTEud2luZENvdW50KTtcclxuICAgICAgICBvbGRFMldpbmRDb3VudCA9IE1hdGguYWJzKGFlMi53aW5kQ291bnQpO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGUxV2luZENvdW50SXMwb3IxOiBib29sZWFuID0gb2xkRTFXaW5kQ291bnQgPT09IDAgfHwgb2xkRTFXaW5kQ291bnQgPT09IDE7XHJcbiAgICBjb25zdCBlMldpbmRDb3VudElzMG9yMTogYm9vbGVhbiA9IG9sZEUyV2luZENvdW50ID09PSAwIHx8IG9sZEUyV2luZENvdW50ID09PSAxO1xyXG5cclxuICAgIGlmICgoIUNsaXBwZXJCYXNlLmlzSG90RWRnZUFjdGl2ZShhZTEpICYmICFlMVdpbmRDb3VudElzMG9yMSkgfHwgKCFDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUoYWUyKSAmJiAhZTJXaW5kQ291bnRJczBvcjEpKSByZXR1cm4gdW5kZWZpbmVkO1xyXG5cclxuICAgIC8vIE5PVyBQUk9DRVNTIFRIRSBJTlRFUlNFQ1RJT04gLi4uXHJcblxyXG4gICAgLy8gaWYgYm90aCBlZGdlcyBhcmUgJ2hvdCcgLi4uXHJcbiAgICBpZiAoQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKGFlMSkgJiYgQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKGFlMikpIHtcclxuICAgICAgaWYgKChvbGRFMVdpbmRDb3VudCAhPT0gMCAmJiBvbGRFMVdpbmRDb3VudCAhPT0gMSkgfHxcclxuICAgICAgICAob2xkRTJXaW5kQ291bnQgIT09IDAgJiYgb2xkRTJXaW5kQ291bnQgIT09IDEpIHx8XHJcbiAgICAgICAgKGFlMS5sb2NhbE1pbi5wb2x5dHlwZSAhPT0gYWUyLmxvY2FsTWluLnBvbHl0eXBlICYmXHJcbiAgICAgICAgICB0aGlzLl9jbGlwdHlwZSAhPT0gQ2xpcFR5cGUuWG9yKSkge1xyXG4gICAgICAgIHJlc3VsdE9wID0gdGhpcy5hZGRMb2NhbE1heFBvbHkoYWUxLCBhZTIsIHB0KTtcclxuICAgICAgfSBlbHNlIGlmIChDbGlwcGVyQmFzZS5pc0Zyb250KGFlMSkgfHwgKGFlMS5vdXRyZWMgPT09IGFlMi5vdXRyZWMpKSB7XHJcbiAgICAgICAgLy8gdGhpcyAnZWxzZSBpZicgY29uZGl0aW9uIGlzbid0IHN0cmljdGx5IG5lZWRlZCBidXRcclxuICAgICAgICAvLyBpdCdzIHNlbnNpYmxlIHRvIHNwbGl0IHBvbHlnb25zIHRoYXQgb25seSB0b3VjaCBhdFxyXG4gICAgICAgIC8vIGEgY29tbW9uIHZlcnRleCAobm90IGF0IGNvbW1vbiBlZGdlcykuXHJcbiAgICAgICAgcmVzdWx0T3AgPSB0aGlzLmFkZExvY2FsTWF4UG9seShhZTEsIGFlMiwgcHQpO1xyXG4gICAgICAgIHRoaXMuYWRkTG9jYWxNaW5Qb2x5KGFlMSwgYWUyLCBwdCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gY2FuJ3QgdHJlYXQgYXMgbWF4aW1hICYgbWluaW1hXHJcbiAgICAgICAgcmVzdWx0T3AgPSBDbGlwcGVyQmFzZS5hZGRPdXRQdChhZTEsIHB0KTtcclxuICAgICAgICBDbGlwcGVyQmFzZS5hZGRPdXRQdChhZTIsIHB0KTtcclxuICAgICAgICBDbGlwcGVyQmFzZS5zd2FwT3V0cmVjcyhhZTEsIGFlMik7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIC8vIGlmIG9uZSBvciB0aGUgb3RoZXIgZWRnZSBpcyAnaG90JyAuLi5cclxuICAgIGVsc2UgaWYgKENsaXBwZXJCYXNlLmlzSG90RWRnZUFjdGl2ZShhZTEpKSB7XHJcbiAgICAgIHJlc3VsdE9wID0gQ2xpcHBlckJhc2UuYWRkT3V0UHQoYWUxLCBwdCk7XHJcbiAgICAgIENsaXBwZXJCYXNlLnN3YXBPdXRyZWNzKGFlMSwgYWUyKTtcclxuICAgIH0gZWxzZSBpZiAoQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKGFlMikpIHtcclxuICAgICAgcmVzdWx0T3AgPSBDbGlwcGVyQmFzZS5hZGRPdXRQdChhZTIsIHB0KTtcclxuICAgICAgQ2xpcHBlckJhc2Uuc3dhcE91dHJlY3MoYWUxLCBhZTIpO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIG5laXRoZXIgZWRnZSBpcyAnaG90J1xyXG4gICAgZWxzZSB7XHJcbiAgICAgIGxldCBlMVdjMjogbnVtYmVyO1xyXG4gICAgICBsZXQgZTJXYzI6IG51bWJlcjtcclxuXHJcbiAgICAgIHN3aXRjaCAodGhpcy5fZmlsbHJ1bGUpIHtcclxuICAgICAgICBjYXNlIEZpbGxSdWxlLlBvc2l0aXZlOlxyXG4gICAgICAgICAgZTFXYzIgPSBhZTEud2luZENvdW50MjtcclxuICAgICAgICAgIGUyV2MyID0gYWUyLndpbmRDb3VudDI7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICBjYXNlIEZpbGxSdWxlLk5lZ2F0aXZlOlxyXG4gICAgICAgICAgZTFXYzIgPSAtYWUxLndpbmRDb3VudDI7XHJcbiAgICAgICAgICBlMldjMiA9IC1hZTIud2luZENvdW50MjtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgICBlMVdjMiA9IE1hdGguYWJzKGFlMS53aW5kQ291bnQyKTtcclxuICAgICAgICAgIGUyV2MyID0gTWF0aC5hYnMoYWUyLndpbmRDb3VudDIpO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmICghQ2xpcHBlckJhc2UuaXNTYW1lUG9seVR5cGUoYWUxLCBhZTIpKSB7XHJcbiAgICAgICAgcmVzdWx0T3AgPSB0aGlzLmFkZExvY2FsTWluUG9seShhZTEsIGFlMiwgcHQpO1xyXG4gICAgICB9IGVsc2UgaWYgKG9sZEUxV2luZENvdW50ID09PSAxICYmIG9sZEUyV2luZENvdW50ID09PSAxKSB7XHJcbiAgICAgICAgcmVzdWx0T3AgPSB1bmRlZmluZWQ7XHJcblxyXG4gICAgICAgIHN3aXRjaCAodGhpcy5fY2xpcHR5cGUpIHtcclxuICAgICAgICAgIGNhc2UgQ2xpcFR5cGUuVW5pb246XHJcbiAgICAgICAgICAgIGlmIChlMVdjMiA+IDAgJiYgZTJXYzIgPiAwKSByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgICByZXN1bHRPcCA9IHRoaXMuYWRkTG9jYWxNaW5Qb2x5KGFlMSwgYWUyLCBwdCk7XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG5cclxuICAgICAgICAgIGNhc2UgQ2xpcFR5cGUuRGlmZmVyZW5jZTpcclxuICAgICAgICAgICAgaWYgKCgoQ2xpcHBlckJhc2UuZ2V0UG9seVR5cGUoYWUxKSA9PT0gUGF0aFR5cGUuQ2xpcCkgJiYgKGUxV2MyID4gMCkgJiYgKGUyV2MyID4gMCkpIHx8XHJcbiAgICAgICAgICAgICAgKChDbGlwcGVyQmFzZS5nZXRQb2x5VHlwZShhZTEpID09PSBQYXRoVHlwZS5TdWJqZWN0KSAmJiAoZTFXYzIgPD0gMCkgJiYgKGUyV2MyIDw9IDApKSkge1xyXG4gICAgICAgICAgICAgIHJlc3VsdE9wID0gdGhpcy5hZGRMb2NhbE1pblBvbHkoYWUxLCBhZTIsIHB0KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBicmVhaztcclxuXHJcbiAgICAgICAgICBjYXNlIENsaXBUeXBlLlhvcjpcclxuICAgICAgICAgICAgcmVzdWx0T3AgPSB0aGlzLmFkZExvY2FsTWluUG9seShhZTEsIGFlMiwgcHQpO1xyXG4gICAgICAgICAgICBicmVhaztcclxuXHJcbiAgICAgICAgICBkZWZhdWx0OiAvLyBDbGlwVHlwZS5JbnRlcnNlY3Rpb246XHJcbiAgICAgICAgICAgIGlmIChlMVdjMiA8PSAwIHx8IGUyV2MyIDw9IDApIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICAgICAgICAgIHJlc3VsdE9wID0gdGhpcy5hZGRMb2NhbE1pblBvbHkoYWUxLCBhZTIsIHB0KTtcclxuICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdE9wO1xyXG4gIH1cclxuXHJcblxyXG4gIHByaXZhdGUgZGVsZXRlRnJvbUFFTChhZTogQWN0aXZlKTogdm9pZCB7XHJcbiAgICBjb25zdCBwcmV2OiBBY3RpdmUgfCB1bmRlZmluZWQgPSBhZS5wcmV2SW5BRUw7XHJcbiAgICBjb25zdCBuZXh0OiBBY3RpdmUgfCB1bmRlZmluZWQgPSBhZS5uZXh0SW5BRUw7XHJcbiAgICBpZiAoIXByZXYgJiYgIW5leHQgJiYgYWUgIT09IHRoaXMuX2FjdGl2ZXMpIHJldHVybjsgIC8vIGFscmVhZHkgZGVsZXRlZFxyXG5cclxuICAgIGlmIChwcmV2KVxyXG4gICAgICBwcmV2Lm5leHRJbkFFTCA9IG5leHQ7XHJcbiAgICBlbHNlXHJcbiAgICAgIHRoaXMuX2FjdGl2ZXMgPSBuZXh0O1xyXG5cclxuICAgIGlmIChuZXh0KVxyXG4gICAgICBuZXh0LnByZXZJbkFFTCA9IHByZXY7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFkanVzdEN1cnJYQW5kQ29weVRvU0VMKHRvcFk6IG51bWJlcik6IHZvaWQge1xyXG4gICAgbGV0IGFlOiBBY3RpdmUgfCB1bmRlZmluZWQgPSB0aGlzLl9hY3RpdmVzO1xyXG4gICAgdGhpcy5fc2VsID0gYWU7XHJcbiAgICB3aGlsZSAoYWUpIHtcclxuICAgICAgYWUucHJldkluU0VMID0gYWUucHJldkluQUVMO1xyXG4gICAgICBhZS5uZXh0SW5TRUwgPSBhZS5uZXh0SW5BRUw7XHJcbiAgICAgIGFlLmp1bXAgPSBhZS5uZXh0SW5TRUw7XHJcbiAgICAgIGlmIChhZS5qb2luV2l0aCA9PT0gSm9pbldpdGguTGVmdClcclxuICAgICAgICBhZS5jdXJYID0gYWUucHJldkluQUVMIS5jdXJYOyAgLy8gVGhpcyBhbHNvIGF2b2lkcyBjb21wbGljYXRpb25zXHJcbiAgICAgIGVsc2VcclxuICAgICAgICBhZS5jdXJYID0gQ2xpcHBlckJhc2UudG9wWChhZSwgdG9wWSk7XHJcbiAgICAgIC8vIE5CIGRvbid0IHVwZGF0ZSBhZS5jdXJyLlkgeWV0IChzZWUgQWRkTmV3SW50ZXJzZWN0Tm9kZSlcclxuICAgICAgYWUgPSBhZS5uZXh0SW5BRUw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgZXhlY3V0ZUludGVybmFsKGN0OiBDbGlwVHlwZSwgZmlsbFJ1bGU6IEZpbGxSdWxlKTogdm9pZCB7XHJcbiAgICBpZiAoY3QgPT09IENsaXBUeXBlLk5vbmUpIHJldHVybjtcclxuICAgIHRoaXMuX2ZpbGxydWxlID0gZmlsbFJ1bGU7XHJcbiAgICB0aGlzLl9jbGlwdHlwZSA9IGN0O1xyXG4gICAgdGhpcy5yZXNldCgpO1xyXG5cclxuICAgIGxldCB5ID0gdGhpcy5wb3BTY2FubGluZSgpXHJcbiAgICBpZiAoeSA9PT0gdW5kZWZpbmVkKSByZXR1cm5cclxuXHJcbiAgICB3aGlsZSAodGhpcy5fc3VjY2VlZGVkKSB7XHJcbiAgICAgIHRoaXMuaW5zZXJ0TG9jYWxNaW5pbWFJbnRvQUVMKHkpXHJcbiAgICAgIGxldCBhZSA9IHRoaXMucG9wSG9yeigpXHJcbiAgICAgIHdoaWxlIChhZSkge1xyXG4gICAgICAgIHRoaXMuZG9Ib3Jpem9udGFsKGFlKVxyXG4gICAgICAgIGFlID0gdGhpcy5wb3BIb3J6KClcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHRoaXMuX2hvcnpTZWdMaXN0Lmxlbmd0aCA+IDApIHtcclxuICAgICAgICB0aGlzLmNvbnZlcnRIb3J6U2Vnc1RvSm9pbnMoKTtcclxuICAgICAgICB0aGlzLl9ob3J6U2VnTGlzdC5sZW5ndGggPSAwXHJcbiAgICAgIH1cclxuICAgICAgdGhpcy5fY3VycmVudEJvdFkgPSB5OyAgLy8gYm90dG9tIG9mIHNjYW5iZWFtXHJcblxyXG4gICAgICB5ID0gdGhpcy5wb3BTY2FubGluZSgpXHJcbiAgICAgIGlmICh5ID09PSB1bmRlZmluZWQpIGJyZWFrOyAgLy8geSBuZXcgdG9wIG9mIHNjYW5iZWFtXHJcblxyXG4gICAgICB0aGlzLmRvSW50ZXJzZWN0aW9ucyh5KTtcclxuICAgICAgdGhpcy5kb1RvcE9mU2NhbmJlYW0oeSk7XHJcblxyXG4gICAgICBhZSA9IHRoaXMucG9wSG9yeigpXHJcbiAgICAgIHdoaWxlIChhZSkge1xyXG4gICAgICAgIHRoaXMuZG9Ib3Jpem9udGFsKGFlKVxyXG4gICAgICAgIGFlID0gdGhpcy5wb3BIb3J6KClcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgaWYgKHRoaXMuX3N1Y2NlZWRlZCkgdGhpcy5wcm9jZXNzSG9yekpvaW5zKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRvSW50ZXJzZWN0aW9ucyh0b3BZOiBudW1iZXIpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLmJ1aWxkSW50ZXJzZWN0TGlzdCh0b3BZKSkge1xyXG4gICAgICB0aGlzLnByb2Nlc3NJbnRlcnNlY3RMaXN0KCk7XHJcbiAgICAgIHRoaXMuZGlzcG9zZUludGVyc2VjdE5vZGVzKCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRpc3Bvc2VJbnRlcnNlY3ROb2RlcygpOiB2b2lkIHtcclxuICAgIHRoaXMuX2ludGVyc2VjdExpc3QubGVuZ3RoID0gMFxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhZGROZXdJbnRlcnNlY3ROb2RlKGFlMTogQWN0aXZlLCBhZTI6IEFjdGl2ZSwgdG9wWTogbnVtYmVyKTogdm9pZCB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBJbnRlcm5hbENsaXBwZXIuZ2V0SW50ZXJzZWN0UG9pbnQoYWUxLmJvdCwgYWUxLnRvcCwgYWUyLmJvdCwgYWUyLnRvcClcclxuICAgIGxldCBpcDogSVBvaW50NjQgPSByZXN1bHQuaXBcclxuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgaXAgPSBuZXcgUG9pbnQ2NChhZTEuY3VyWCwgdG9wWSk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGlwLnkgPiB0aGlzLl9jdXJyZW50Qm90WSB8fCBpcC55IDwgdG9wWSkge1xyXG4gICAgICBjb25zdCBhYnNEeDE6IG51bWJlciA9IE1hdGguYWJzKGFlMS5keCk7XHJcbiAgICAgIGNvbnN0IGFic0R4MjogbnVtYmVyID0gTWF0aC5hYnMoYWUyLmR4KTtcclxuICAgICAgaWYgKGFic0R4MSA+IDEwMCAmJiBhYnNEeDIgPiAxMDApIHtcclxuICAgICAgICBpZiAoYWJzRHgxID4gYWJzRHgyKSB7XHJcbiAgICAgICAgICBpcCA9IEludGVybmFsQ2xpcHBlci5nZXRDbG9zZXN0UHRPblNlZ21lbnQoaXAsIGFlMS5ib3QsIGFlMS50b3ApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBpcCA9IEludGVybmFsQ2xpcHBlci5nZXRDbG9zZXN0UHRPblNlZ21lbnQoaXAsIGFlMi5ib3QsIGFlMi50b3ApO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIGlmIChhYnNEeDEgPiAxMDApIHtcclxuICAgICAgICBpcCA9IEludGVybmFsQ2xpcHBlci5nZXRDbG9zZXN0UHRPblNlZ21lbnQoaXAsIGFlMS5ib3QsIGFlMS50b3ApO1xyXG4gICAgICB9IGVsc2UgaWYgKGFic0R4MiA+IDEwMCkge1xyXG4gICAgICAgIGlwID0gSW50ZXJuYWxDbGlwcGVyLmdldENsb3Nlc3RQdE9uU2VnbWVudChpcCwgYWUyLmJvdCwgYWUyLnRvcCk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaWYgKGlwLnkgPCB0b3BZKSB7XHJcbiAgICAgICAgICBpcC55ID0gdG9wWTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgaXAueSA9IHRoaXMuX2N1cnJlbnRCb3RZO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoYWJzRHgxIDwgYWJzRHgyKSB7XHJcbiAgICAgICAgICBpcC54ID0gQ2xpcHBlckJhc2UudG9wWChhZTEsIGlwLnkpO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBpcC54ID0gQ2xpcHBlckJhc2UudG9wWChhZTIsIGlwLnkpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgY29uc3Qgbm9kZTogSW50ZXJzZWN0Tm9kZSA9IG5ldyBJbnRlcnNlY3ROb2RlKGlwLCBhZTEsIGFlMik7XHJcbiAgICB0aGlzLl9pbnRlcnNlY3RMaXN0LnB1c2gobm9kZSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBleHRyYWN0RnJvbVNFTChhZTogQWN0aXZlKTogQWN0aXZlIHwgdW5kZWZpbmVkIHtcclxuICAgIGNvbnN0IHJlczogQWN0aXZlIHwgdW5kZWZpbmVkID0gYWUubmV4dEluU0VMO1xyXG4gICAgaWYgKHJlcykge1xyXG4gICAgICByZXMucHJldkluU0VMID0gYWUucHJldkluU0VMO1xyXG4gICAgfVxyXG4gICAgYWUucHJldkluU0VMIS5uZXh0SW5TRUwgPSByZXM7XHJcbiAgICByZXR1cm4gcmVzO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgaW5zZXJ0MUJlZm9yZTJJblNFTChhZTE6IEFjdGl2ZSwgYWUyOiBBY3RpdmUpOiB2b2lkIHtcclxuICAgIGFlMS5wcmV2SW5TRUwgPSBhZTIucHJldkluU0VMO1xyXG4gICAgaWYgKGFlMS5wcmV2SW5TRUwpIHtcclxuICAgICAgYWUxLnByZXZJblNFTC5uZXh0SW5TRUwgPSBhZTE7XHJcbiAgICB9XHJcbiAgICBhZTEubmV4dEluU0VMID0gYWUyO1xyXG4gICAgYWUyLnByZXZJblNFTCA9IGFlMTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYnVpbGRJbnRlcnNlY3RMaXN0KHRvcFk6IG51bWJlcik6IGJvb2xlYW4ge1xyXG4gICAgaWYgKCF0aGlzLl9hY3RpdmVzIHx8ICF0aGlzLl9hY3RpdmVzLm5leHRJbkFFTCkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICAgIC8vIENhbGN1bGF0ZSBlZGdlIHBvc2l0aW9ucyBhdCB0aGUgdG9wIG9mIHRoZSBjdXJyZW50IHNjYW5iZWFtLCBhbmQgZnJvbSB0aGlzXHJcbiAgICAvLyB3ZSB3aWxsIGRldGVybWluZSB0aGUgaW50ZXJzZWN0aW9ucyByZXF1aXJlZCB0byByZWFjaCB0aGVzZSBuZXcgcG9zaXRpb25zLlxyXG4gICAgdGhpcy5hZGp1c3RDdXJyWEFuZENvcHlUb1NFTCh0b3BZKTtcclxuXHJcbiAgICAvLyBGaW5kIGFsbCBlZGdlIGludGVyc2VjdGlvbnMgaW4gdGhlIGN1cnJlbnQgc2NhbmJlYW0gdXNpbmcgYSBzdGFibGUgbWVyZ2VcclxuICAgIC8vIHNvcnQgdGhhdCBlbnN1cmVzIG9ubHkgYWRqYWNlbnQgZWRnZXMgYXJlIGludGVyc2VjdGluZy4gSW50ZXJzZWN0IGluZm8gaXNcclxuICAgIC8vIHN0b3JlZCBpbiBGSW50ZXJzZWN0TGlzdCByZWFkeSB0byBiZSBwcm9jZXNzZWQgaW4gUHJvY2Vzc0ludGVyc2VjdExpc3QuXHJcbiAgICAvLyBSZSBtZXJnZSBzb3J0cyBzZWUgaHR0cHM6Ly9zdGFja292ZXJmbG93LmNvbS9hLzQ2MzE5MTMxLzM1OTUzOFxyXG5cclxuICAgIGxldCBsZWZ0OiBBY3RpdmUgfCB1bmRlZmluZWQgPSB0aGlzLl9zZWwsXHJcbiAgICAgIHJpZ2h0OiBBY3RpdmUgfCB1bmRlZmluZWQsXHJcbiAgICAgIGxFbmQ6IEFjdGl2ZSB8IHVuZGVmaW5lZCxcclxuICAgICAgckVuZDogQWN0aXZlIHwgdW5kZWZpbmVkLFxyXG4gICAgICBjdXJyQmFzZTogQWN0aXZlIHwgdW5kZWZpbmVkLFxyXG4gICAgICBwcmV2QmFzZTogQWN0aXZlIHwgdW5kZWZpbmVkLFxyXG4gICAgICB0bXA6IEFjdGl2ZSB8IHVuZGVmaW5lZDtcclxuXHJcbiAgICB3aGlsZSAobGVmdCEuanVtcCkge1xyXG4gICAgICBwcmV2QmFzZSA9IHVuZGVmaW5lZDtcclxuICAgICAgd2hpbGUgKGxlZnQgJiYgbGVmdC5qdW1wKSB7XHJcbiAgICAgICAgY3VyckJhc2UgPSBsZWZ0O1xyXG4gICAgICAgIHJpZ2h0ID0gbGVmdC5qdW1wO1xyXG4gICAgICAgIGxFbmQgPSByaWdodDtcclxuICAgICAgICByRW5kID0gcmlnaHQhLmp1bXA7XHJcbiAgICAgICAgbGVmdC5qdW1wID0gckVuZDtcclxuICAgICAgICB3aGlsZSAobGVmdCAhPT0gbEVuZCAmJiByaWdodCAhPT0gckVuZCkge1xyXG4gICAgICAgICAgaWYgKHJpZ2h0IS5jdXJYIDwgbGVmdCEuY3VyWCkge1xyXG4gICAgICAgICAgICB0bXAgPSByaWdodCEucHJldkluU0VMITtcclxuICAgICAgICAgICAgZm9yICg7IDspIHtcclxuICAgICAgICAgICAgICB0aGlzLmFkZE5ld0ludGVyc2VjdE5vZGUodG1wLCByaWdodCEsIHRvcFkpO1xyXG4gICAgICAgICAgICAgIGlmICh0bXAgPT09IGxlZnQpIGJyZWFrO1xyXG4gICAgICAgICAgICAgIHRtcCA9IHRtcC5wcmV2SW5TRUwhO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB0bXAgPSByaWdodDtcclxuICAgICAgICAgICAgcmlnaHQgPSBDbGlwcGVyQmFzZS5leHRyYWN0RnJvbVNFTCh0bXAhKTtcclxuICAgICAgICAgICAgbEVuZCA9IHJpZ2h0O1xyXG4gICAgICAgICAgICBDbGlwcGVyQmFzZS5pbnNlcnQxQmVmb3JlMkluU0VMKHRtcCEsIGxlZnQhKTtcclxuICAgICAgICAgICAgaWYgKGxlZnQgPT09IGN1cnJCYXNlKSB7XHJcbiAgICAgICAgICAgICAgY3VyckJhc2UgPSB0bXA7XHJcbiAgICAgICAgICAgICAgY3VyckJhc2UhLmp1bXAgPSByRW5kO1xyXG4gICAgICAgICAgICAgIGlmIChwcmV2QmFzZSA9PT0gdW5kZWZpbmVkKSB0aGlzLl9zZWwgPSBjdXJyQmFzZTtcclxuICAgICAgICAgICAgICBlbHNlIHByZXZCYXNlLmp1bXAgPSBjdXJyQmFzZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgbGVmdCA9IGxlZnQhLm5leHRJblNFTDtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIHByZXZCYXNlID0gY3VyckJhc2U7XHJcbiAgICAgICAgbGVmdCA9IHJFbmQ7XHJcbiAgICAgIH1cclxuICAgICAgbGVmdCA9IHRoaXMuX3NlbDtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcy5faW50ZXJzZWN0TGlzdC5sZW5ndGggPiAwO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBwcm9jZXNzSW50ZXJzZWN0TGlzdCgpOiB2b2lkIHtcclxuICAgIC8vIFdlIG5vdyBoYXZlIGEgbGlzdCBvZiBpbnRlcnNlY3Rpb25zIHJlcXVpcmVkIHNvIHRoYXQgZWRnZXMgd2lsbCBiZVxyXG4gICAgLy8gY29ycmVjdGx5IHBvc2l0aW9uZWQgYXQgdGhlIHRvcCBvZiB0aGUgc2NhbmJlYW0uIEhvd2V2ZXIsIGl0J3MgaW1wb3J0YW50XHJcbiAgICAvLyB0aGF0IGVkZ2UgaW50ZXJzZWN0aW9ucyBhcmUgcHJvY2Vzc2VkIGZyb20gdGhlIGJvdHRvbSB1cCwgYnV0IGl0J3MgYWxzb1xyXG4gICAgLy8gY3J1Y2lhbCB0aGF0IGludGVyc2VjdGlvbnMgb25seSBvY2N1ciBiZXR3ZWVuIGFkamFjZW50IGVkZ2VzLlxyXG5cclxuICAgIC8vIEZpcnN0IHdlIGRvIGEgcXVpY2tzb3J0IHNvIGludGVyc2VjdGlvbnMgcHJvY2VlZCBpbiBhIGJvdHRvbSB1cCBvcmRlciAuLi5cclxuICAgIHRoaXMuX2ludGVyc2VjdExpc3Quc29ydCgoYSwgYikgPT4ge1xyXG4gICAgICBpZiAoYS5wdC55ID09PSBiLnB0LnkpIHtcclxuICAgICAgICBpZiAoYS5wdC54ID09PSBiLnB0LngpIHJldHVybiAwO1xyXG4gICAgICAgIHJldHVybiAoYS5wdC54IDwgYi5wdC54KSA/IC0xIDogMTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm4gKGEucHQueSA+IGIucHQueSkgPyAtMSA6IDE7XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBOb3cgYXMgd2UgcHJvY2VzcyB0aGVzZSBpbnRlcnNlY3Rpb25zLCB3ZSBtdXN0IHNvbWV0aW1lcyBhZGp1c3QgdGhlIG9yZGVyXHJcbiAgICAvLyB0byBlbnN1cmUgdGhhdCBpbnRlcnNlY3RpbmcgZWRnZXMgYXJlIGFsd2F5cyBhZGphY2VudCAuLi5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgdGhpcy5faW50ZXJzZWN0TGlzdC5sZW5ndGg7ICsraSkge1xyXG4gICAgICBpZiAoIUNsaXBwZXJCYXNlLmVkZ2VzQWRqYWNlbnRJbkFFTCh0aGlzLl9pbnRlcnNlY3RMaXN0W2ldKSkge1xyXG4gICAgICAgIGxldCBqID0gaSArIDE7XHJcbiAgICAgICAgd2hpbGUgKCFDbGlwcGVyQmFzZS5lZGdlc0FkamFjZW50SW5BRUwodGhpcy5faW50ZXJzZWN0TGlzdFtqXSkpIGorKztcclxuICAgICAgICAvLyBzd2FwXHJcbiAgICAgICAgW3RoaXMuX2ludGVyc2VjdExpc3Rbal0sIHRoaXMuX2ludGVyc2VjdExpc3RbaV1dID1cclxuICAgICAgICAgIFt0aGlzLl9pbnRlcnNlY3RMaXN0W2ldLCB0aGlzLl9pbnRlcnNlY3RMaXN0W2pdXTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3Qgbm9kZSA9IHRoaXMuX2ludGVyc2VjdExpc3RbaV07XHJcbiAgICAgIHRoaXMuaW50ZXJzZWN0RWRnZXMobm9kZS5lZGdlMSwgbm9kZS5lZGdlMiwgbm9kZS5wdCk7XHJcbiAgICAgIHRoaXMuc3dhcFBvc2l0aW9uc0luQUVMKG5vZGUuZWRnZTEsIG5vZGUuZWRnZTIpO1xyXG5cclxuICAgICAgbm9kZS5lZGdlMS5jdXJYID0gbm9kZS5wdC54O1xyXG4gICAgICBub2RlLmVkZ2UyLmN1clggPSBub2RlLnB0Lng7XHJcbiAgICAgIHRoaXMuY2hlY2tKb2luTGVmdChub2RlLmVkZ2UyLCBub2RlLnB0LCB0cnVlKTtcclxuICAgICAgdGhpcy5jaGVja0pvaW5SaWdodChub2RlLmVkZ2UxLCBub2RlLnB0LCB0cnVlKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3dhcFBvc2l0aW9uc0luQUVMKGFlMTogQWN0aXZlLCBhZTI6IEFjdGl2ZSk6IHZvaWQge1xyXG4gICAgLy8gcHJlY29uZGl0b246IGFlMSBtdXN0IGJlIGltbWVkaWF0ZWx5IHRvIHRoZSBsZWZ0IG9mIGFlMlxyXG4gICAgY29uc3QgbmV4dDogQWN0aXZlIHwgdW5kZWZpbmVkID0gYWUyLm5leHRJbkFFTDtcclxuICAgIGlmIChuZXh0KSBuZXh0LnByZXZJbkFFTCA9IGFlMTtcclxuICAgIGNvbnN0IHByZXY6IEFjdGl2ZSB8IHVuZGVmaW5lZCA9IGFlMS5wcmV2SW5BRUw7XHJcbiAgICBpZiAocHJldikgcHJldi5uZXh0SW5BRUwgPSBhZTI7XHJcbiAgICBhZTIucHJldkluQUVMID0gcHJldjtcclxuICAgIGFlMi5uZXh0SW5BRUwgPSBhZTE7XHJcbiAgICBhZTEucHJldkluQUVMID0gYWUyO1xyXG4gICAgYWUxLm5leHRJbkFFTCA9IG5leHQ7XHJcbiAgICBpZiAoIWFlMi5wcmV2SW5BRUwpIHRoaXMuX2FjdGl2ZXMgPSBhZTI7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyByZXNldEhvcnpEaXJlY3Rpb24oaG9yejogQWN0aXZlLCB2ZXJ0ZXhNYXg6IFZlcnRleCB8IHVuZGVmaW5lZCk6IHsgaXNMZWZ0VG9SaWdodDogYm9vbGVhbiwgbGVmdFg6IG51bWJlciwgcmlnaHRYOiBudW1iZXIgfSB7XHJcbiAgICBsZXQgbGVmdFgsIHJpZ2h0WFxyXG5cclxuICAgIGlmIChob3J6LmJvdC54ID09PSBob3J6LnRvcC54KSB7XHJcbiAgICAgIC8vIHRoZSBob3Jpem9udGFsIGVkZ2UgaXMgZ29pbmcgbm93aGVyZSAuLi5cclxuICAgICAgbGVmdFggPSBob3J6LmN1clg7XHJcbiAgICAgIHJpZ2h0WCA9IGhvcnouY3VyWDtcclxuICAgICAgbGV0IGFlOiBBY3RpdmUgfCB1bmRlZmluZWQgPSBob3J6Lm5leHRJbkFFTDtcclxuICAgICAgd2hpbGUgKGFlICYmIGFlLnZlcnRleFRvcCAhPT0gdmVydGV4TWF4KVxyXG4gICAgICAgIGFlID0gYWUubmV4dEluQUVMO1xyXG4gICAgICByZXR1cm4geyBpc0xlZnRUb1JpZ2h0OiBhZSAhPT0gdW5kZWZpbmVkLCBsZWZ0WCwgcmlnaHRYIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoaG9yei5jdXJYIDwgaG9yei50b3AueCkge1xyXG4gICAgICBsZWZ0WCA9IGhvcnouY3VyWDtcclxuICAgICAgcmlnaHRYID0gaG9yei50b3AueDtcclxuICAgICAgcmV0dXJuIHsgaXNMZWZ0VG9SaWdodDogdHJ1ZSwgbGVmdFgsIHJpZ2h0WCB9XHJcbiAgICB9XHJcbiAgICBsZWZ0WCA9IGhvcnoudG9wLng7XHJcbiAgICByaWdodFggPSBob3J6LmN1clg7XHJcbiAgICByZXR1cm4geyBpc0xlZnRUb1JpZ2h0OiBmYWxzZSwgbGVmdFgsIHJpZ2h0WCB9IC8vIHJpZ2h0IHRvIGxlZnRcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGhvcnpJc1NwaWtlKGhvcno6IEFjdGl2ZSk6IGJvb2xlYW4ge1xyXG4gICAgY29uc3QgbmV4dFB0OiBJUG9pbnQ2NCA9IENsaXBwZXJCYXNlLm5leHRWZXJ0ZXgoaG9yeikucHQ7XHJcbiAgICByZXR1cm4gKGhvcnouYm90LnggPCBob3J6LnRvcC54KSAhPT0gKGhvcnoudG9wLnggPCBuZXh0UHQueCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyB0cmltSG9yeihob3J6RWRnZTogQWN0aXZlLCBwcmVzZXJ2ZUNvbGxpbmVhcjogYm9vbGVhbik6IHZvaWQge1xyXG4gICAgbGV0IHdhc1RyaW1tZWQgPSBmYWxzZTtcclxuICAgIGxldCBwdDogSVBvaW50NjQgPSBDbGlwcGVyQmFzZS5uZXh0VmVydGV4KGhvcnpFZGdlKS5wdDtcclxuXHJcbiAgICB3aGlsZSAocHQueSA9PT0gaG9yekVkZ2UudG9wLnkpIHtcclxuICAgICAgLy8gYWx3YXlzIHRyaW0gMTgwIGRlZy4gc3Bpa2VzIChpbiBjbG9zZWQgcGF0aHMpXHJcbiAgICAgIC8vIGJ1dCBvdGhlcndpc2UgYnJlYWsgaWYgcHJlc2VydmVDb2xsaW5lYXIgPSB0cnVlXHJcbiAgICAgIGlmIChwcmVzZXJ2ZUNvbGxpbmVhciAmJlxyXG4gICAgICAgIChwdC54IDwgaG9yekVkZ2UudG9wLngpICE9PSAoaG9yekVkZ2UuYm90LnggPCBob3J6RWRnZS50b3AueCkpIHtcclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgaG9yekVkZ2UudmVydGV4VG9wID0gQ2xpcHBlckJhc2UubmV4dFZlcnRleChob3J6RWRnZSk7XHJcbiAgICAgIGhvcnpFZGdlLnRvcCA9IHB0O1xyXG4gICAgICB3YXNUcmltbWVkID0gdHJ1ZTtcclxuICAgICAgaWYgKENsaXBwZXJCYXNlLmlzTWF4aW1hQWN0aXZlKGhvcnpFZGdlKSkgYnJlYWs7XHJcbiAgICAgIHB0ID0gQ2xpcHBlckJhc2UubmV4dFZlcnRleChob3J6RWRnZSkucHQ7XHJcbiAgICB9XHJcbiAgICBpZiAod2FzVHJpbW1lZCkgQ2xpcHBlckJhc2Uuc2V0RHgoaG9yekVkZ2UpOyAvLyArLy1pbmZpbml0eVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhZGRUb0hvcnpTZWdMaXN0KG9wOiBPdXRQdCk6IHZvaWQge1xyXG4gICAgaWYgKG9wLm91dHJlYy5pc09wZW4pIHJldHVybjtcclxuICAgIHRoaXMuX2hvcnpTZWdMaXN0LnB1c2gobmV3IEhvcnpTZWdtZW50KG9wKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldExhc3RPcChob3RFZGdlOiBBY3RpdmUpOiBPdXRQdCB7XHJcbiAgICBjb25zdCBvdXRyZWM6IE91dFJlYyA9IGhvdEVkZ2Uub3V0cmVjITtcclxuICAgIHJldHVybiAoaG90RWRnZSA9PT0gb3V0cmVjLmZyb250RWRnZSkgP1xyXG4gICAgICBvdXRyZWMucHRzISA6IG91dHJlYy5wdHMhLm5leHQhO1xyXG4gIH1cclxuXHJcbiAgLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuICAqIE5vdGVzOiBIb3Jpem9udGFsIGVkZ2VzIChIRXMpIGF0IHNjYW5saW5lIGludGVyc2VjdGlvbnMgKGkuZS4gYXQgdGhlIHRvcCBvciAgICAqXHJcbiAgKiBib3R0b20gb2YgYSBzY2FuYmVhbSkgYXJlIHByb2Nlc3NlZCBhcyBpZiBsYXllcmVkLlRoZSBvcmRlciBpbiB3aGljaCBIRXMgICAgICpcclxuICAqIGFyZSBwcm9jZXNzZWQgZG9lc24ndCBtYXR0ZXIuIEhFcyBpbnRlcnNlY3Qgd2l0aCB0aGUgYm90dG9tIHZlcnRpY2VzIG9mICAgICAgKlxyXG4gICogb3RoZXIgSEVzWyNdIGFuZCB3aXRoIG5vbi1ob3Jpem9udGFsIGVkZ2VzIFsqXS4gT25jZSB0aGVzZSBpbnRlcnNlY3Rpb25zICAgICAqXHJcbiAgKiBhcmUgY29tcGxldGVkLCBpbnRlcm1lZGlhdGUgSEVzIGFyZSAncHJvbW90ZWQnIHRvIHRoZSBuZXh0IGVkZ2UgaW4gdGhlaXIgICAgICpcclxuICAqIGJvdW5kcywgYW5kIHRoZXkgaW4gdHVybiBtYXkgYmUgaW50ZXJzZWN0ZWRbJV0gYnkgb3RoZXIgSEVzLiAgICAgICAgICAgICAgICAgKlxyXG4gICogICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAqXHJcbiAgKiBlZzogMyBob3Jpem9udGFscyBhdCBhIHNjYW5saW5lOiAgICAvICAgfCAgICAgICAgICAgICAgICAgICAgIC8gICAgICAgICAgIC8gICpcclxuICAqICAgICAgICAgICAgICB8ICAgICAgICAgICAgICAgICAgICAgLyAgICB8ICAgICAoSEUzKW8gPT09PT09PT0lPT09PT09PT09PSBvICAgKlxyXG4gICogICAgICAgICAgICAgIG8gPT09PT09PSBvKEhFMikgICAgIC8gICAgIHwgICAgICAgICAvICAgICAgICAgLyAgICAgICAgICAgICAgICAqXHJcbiAgKiAgICAgICAgICBvID09PT09PT09PT09PSM9PT09PT09PT0qPT09PT09Kj09PT09PT09Iz09PT09PT09PW8gKEhFMSkgICAgICAgICAgICpcclxuICAqICAgICAgICAgLyAgICAgICAgICAgICAgfCAgICAgICAgLyAgICAgICB8ICAgICAgIC8gICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4gICoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKiovXHJcbiAgcHJpdmF0ZSBkb0hvcml6b250YWwoaG9yejogQWN0aXZlKTogdm9pZCB7XHJcbiAgICBsZXQgcHQ6IElQb2ludDY0O1xyXG4gICAgY29uc3QgaG9yeklzT3BlbiA9IENsaXBwZXJCYXNlLmlzT3Blbihob3J6KTtcclxuICAgIGNvbnN0IFkgPSBob3J6LmJvdC55O1xyXG5cclxuICAgIGNvbnN0IHZlcnRleF9tYXg6IFZlcnRleCB8IHVuZGVmaW5lZCA9IGhvcnpJc09wZW4gP1xyXG4gICAgICBDbGlwcGVyQmFzZS5nZXRDdXJyWU1heGltYVZlcnRleF9PcGVuKGhvcnopIDpcclxuICAgICAgQ2xpcHBlckJhc2UuZ2V0Q3VycllNYXhpbWFWZXJ0ZXgoaG9yeik7XHJcblxyXG4gICAgLy8gcmVtb3ZlIDE4MCBkZWcuc3Bpa2VzIGFuZCBhbHNvIHNpbXBsaWZ5XHJcbiAgICAvLyBjb25zZWN1dGl2ZSBob3Jpem9udGFscyB3aGVuIFByZXNlcnZlQ29sbGluZWFyID0gdHJ1ZVxyXG4gICAgaWYgKHZlcnRleF9tYXggJiYgIWhvcnpJc09wZW4gJiYgdmVydGV4X21heCAhPT0gaG9yei52ZXJ0ZXhUb3ApXHJcbiAgICAgIENsaXBwZXJCYXNlLnRyaW1Ib3J6KGhvcnosIHRoaXMucHJlc2VydmVDb2xsaW5lYXIpO1xyXG5cclxuICAgIGxldCB7IGlzTGVmdFRvUmlnaHQsIGxlZnRYLCByaWdodFggfSA9XHJcbiAgICAgIENsaXBwZXJCYXNlLnJlc2V0SG9yekRpcmVjdGlvbihob3J6LCB2ZXJ0ZXhfbWF4KTtcclxuXHJcbiAgICBpZiAoQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKGhvcnopKSB7XHJcbiAgICAgIGNvbnN0IG9wID0gQ2xpcHBlckJhc2UuYWRkT3V0UHQoaG9yeiwgbmV3IFBvaW50NjQoaG9yei5jdXJYLCBZKSk7XHJcbiAgICAgIHRoaXMuYWRkVG9Ib3J6U2VnTGlzdChvcCk7XHJcbiAgICB9XHJcblxyXG4gICAgZm9yICg7IDspIHtcclxuICAgICAgLy8gbG9vcHMgdGhyb3VnaCBjb25zZWMuIGhvcml6b250YWwgZWRnZXMgKGlmIG9wZW4pXHJcbiAgICAgIGxldCBhZTogQWN0aXZlIHwgdW5kZWZpbmVkID0gaXNMZWZ0VG9SaWdodCA/IGhvcnoubmV4dEluQUVMIDogaG9yei5wcmV2SW5BRUw7XHJcblxyXG4gICAgICB3aGlsZSAoYWUpIHtcclxuICAgICAgICBpZiAoYWUudmVydGV4VG9wID09PSB2ZXJ0ZXhfbWF4KSB7XHJcbiAgICAgICAgICAvLyBkbyB0aGlzIGZpcnN0ISFcclxuICAgICAgICAgIGlmIChDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUoaG9yeikgJiYgQ2xpcHBlckJhc2UuaXNKb2luZWQoYWUpKSB0aGlzLnNwbGl0KGFlLCBhZS50b3ApO1xyXG5cclxuICAgICAgICAgIGlmIChDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUoaG9yeikpIHtcclxuICAgICAgICAgICAgd2hpbGUgKGhvcnoudmVydGV4VG9wICE9PSB2ZXJ0ZXhfbWF4KSB7XHJcbiAgICAgICAgICAgICAgQ2xpcHBlckJhc2UuYWRkT3V0UHQoaG9yeiwgaG9yei50b3ApO1xyXG4gICAgICAgICAgICAgIHRoaXMudXBkYXRlRWRnZUludG9BRUwoaG9yeik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgaWYgKGlzTGVmdFRvUmlnaHQpXHJcbiAgICAgICAgICAgICAgdGhpcy5hZGRMb2NhbE1heFBvbHkoaG9yeiwgYWUsIGhvcnoudG9wKTtcclxuICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgIHRoaXMuYWRkTG9jYWxNYXhQb2x5KGFlLCBob3J6LCBob3J6LnRvcCk7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICB0aGlzLmRlbGV0ZUZyb21BRUwoYWUpO1xyXG4gICAgICAgICAgdGhpcy5kZWxldGVGcm9tQUVMKGhvcnopO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gaWYgaG9yekVkZ2UgaXMgYSBtYXhpbWEsIGtlZXAgZ29pbmcgdW50aWwgd2UgcmVhY2hcclxuICAgICAgICAvLyBpdHMgbWF4aW1hIHBhaXIsIG90aGVyd2lzZSBjaGVjayBmb3IgYnJlYWsgY29uZGl0aW9uc1xyXG4gICAgICAgIGlmICh2ZXJ0ZXhfbWF4ICE9PSBob3J6LnZlcnRleFRvcCB8fCBDbGlwcGVyQmFzZS5pc09wZW5FbmRBY3RpdmUoaG9yeikpIHtcclxuICAgICAgICAgIC8vIG90aGVyd2lzZSBzdG9wIHdoZW4gJ2FlJyBpcyBiZXlvbmQgdGhlIGVuZCBvZiB0aGUgaG9yaXpvbnRhbCBsaW5lXHJcbiAgICAgICAgICBpZiAoKGlzTGVmdFRvUmlnaHQgJiYgYWUuY3VyWCA+IHJpZ2h0WCkgfHwgKCFpc0xlZnRUb1JpZ2h0ICYmIGFlLmN1clggPCBsZWZ0WCkpIGJyZWFrO1xyXG5cclxuICAgICAgICAgIGlmIChhZS5jdXJYID09PSBob3J6LnRvcC54ICYmICFDbGlwcGVyQmFzZS5pc0hvcml6b250YWwoYWUpKSB7XHJcbiAgICAgICAgICAgIHB0ID0gQ2xpcHBlckJhc2UubmV4dFZlcnRleChob3J6KS5wdDtcclxuXHJcbiAgICAgICAgICAgIC8vIHRvIG1heGltaXplIHRoZSBwb3NzaWJpbGl0eSBvZiBwdXR0aW5nIG9wZW4gZWRnZXMgaW50b1xyXG4gICAgICAgICAgICAvLyBzb2x1dGlvbnMsIHdlJ2xsIG9ubHkgYnJlYWsgaWYgaXQncyBwYXN0IEhvcnpFZGdlJ3MgZW5kXHJcbiAgICAgICAgICAgIGlmIChDbGlwcGVyQmFzZS5pc09wZW4oYWUpICYmICFDbGlwcGVyQmFzZS5pc1NhbWVQb2x5VHlwZShhZSwgaG9yeikgJiYgIUNsaXBwZXJCYXNlLmlzSG90RWRnZUFjdGl2ZShhZSkpIHtcclxuICAgICAgICAgICAgICBpZiAoKGlzTGVmdFRvUmlnaHQgJiYgKENsaXBwZXJCYXNlLnRvcFgoYWUsIHB0LnkpID4gcHQueCkpIHx8ICghaXNMZWZ0VG9SaWdodCAmJiAoQ2xpcHBlckJhc2UudG9wWChhZSwgcHQueSkgPCBwdC54KSkpIGJyZWFrO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIC8vIG90aGVyd2lzZSBmb3IgZWRnZXMgYXQgaG9yekVkZ2UncyBlbmQsIG9ubHkgc3RvcCB3aGVuIGhvcnpFZGdlJ3NcclxuICAgICAgICAgICAgLy8gb3V0c2xvcGUgaXMgZ3JlYXRlciB0aGFuIGUncyBzbG9wZSB3aGVuIGhlYWRpbmcgcmlnaHQgb3Igd2hlblxyXG4gICAgICAgICAgICAvLyBob3J6RWRnZSdzIG91dHNsb3BlIGlzIGxlc3MgdGhhbiBlJ3Mgc2xvcGUgd2hlbiBoZWFkaW5nIGxlZnQuXHJcbiAgICAgICAgICAgIGVsc2UgaWYgKChpc0xlZnRUb1JpZ2h0ICYmIChDbGlwcGVyQmFzZS50b3BYKGFlLCBwdC55KSA+PSBwdC54KSkgfHwgKCFpc0xlZnRUb1JpZ2h0ICYmIChDbGlwcGVyQmFzZS50b3BYKGFlLCBwdC55KSA8PSBwdC54KSkpIGJyZWFrO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcHQgPSBuZXcgUG9pbnQ2NChhZS5jdXJYLCBZKTtcclxuXHJcbiAgICAgICAgaWYgKGlzTGVmdFRvUmlnaHQpIHtcclxuICAgICAgICAgIHRoaXMuaW50ZXJzZWN0RWRnZXMoaG9yeiwgYWUsIHB0KTtcclxuICAgICAgICAgIHRoaXMuc3dhcFBvc2l0aW9uc0luQUVMKGhvcnosIGFlKTtcclxuICAgICAgICAgIGhvcnouY3VyWCA9IGFlLmN1clg7XHJcbiAgICAgICAgICBhZSA9IGhvcnoubmV4dEluQUVMO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICB0aGlzLmludGVyc2VjdEVkZ2VzKGFlLCBob3J6LCBwdCk7XHJcbiAgICAgICAgICB0aGlzLnN3YXBQb3NpdGlvbnNJbkFFTChhZSwgaG9yeik7XHJcbiAgICAgICAgICBob3J6LmN1clggPSBhZS5jdXJYO1xyXG4gICAgICAgICAgYWUgPSBob3J6LnByZXZJbkFFTDtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUoaG9yeikpXHJcbiAgICAgICAgICB0aGlzLmFkZFRvSG9yelNlZ0xpc3QodGhpcy5nZXRMYXN0T3AoaG9yeikpO1xyXG4gICAgICB9IC8vIHdlJ3ZlIHJlYWNoZWQgdGhlIGVuZCBvZiB0aGlzIGhvcml6b250YWxcclxuXHJcbiAgICAgIC8vIGNoZWNrIGlmIHdlJ3ZlIGZpbmlzaGVkIGxvb3BpbmdcclxuICAgICAgLy8gdGhyb3VnaCBjb25zZWN1dGl2ZSBob3Jpem9udGFsc1xyXG4gICAgICBpZiAoaG9yeklzT3BlbiAmJiBDbGlwcGVyQmFzZS5pc09wZW5FbmRBY3RpdmUoaG9yeikpIHsgLy8gaWUgb3BlbiBhdCB0b3BcclxuICAgICAgICBpZiAoQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKGhvcnopKSB7XHJcbiAgICAgICAgICBDbGlwcGVyQmFzZS5hZGRPdXRQdChob3J6LCBob3J6LnRvcCk7XHJcbiAgICAgICAgICBpZiAoQ2xpcHBlckJhc2UuaXNGcm9udChob3J6KSlcclxuICAgICAgICAgICAgaG9yei5vdXRyZWMhLmZyb250RWRnZSA9IHVuZGVmaW5lZDtcclxuICAgICAgICAgIGVsc2VcclxuICAgICAgICAgICAgaG9yei5vdXRyZWMhLmJhY2tFZGdlID0gdW5kZWZpbmVkO1xyXG4gICAgICAgICAgaG9yei5vdXRyZWMgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuZGVsZXRlRnJvbUFFTChob3J6KTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH0gZWxzZSBpZiAoQ2xpcHBlckJhc2UubmV4dFZlcnRleChob3J6KS5wdC55ICE9PSBob3J6LnRvcC55KVxyXG4gICAgICAgIGJyZWFrO1xyXG5cclxuICAgICAgLy8gc3RpbGwgbW9yZSBob3Jpem9udGFscyBpbiBib3VuZCB0byBwcm9jZXNzIC4uLlxyXG4gICAgICBpZiAoQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKGhvcnopKSB7XHJcbiAgICAgICAgQ2xpcHBlckJhc2UuYWRkT3V0UHQoaG9yeiwgaG9yei50b3ApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aGlzLnVwZGF0ZUVkZ2VJbnRvQUVMKGhvcnopO1xyXG5cclxuICAgICAgaWYgKHRoaXMucHJlc2VydmVDb2xsaW5lYXIgJiYgIWhvcnpJc09wZW4gJiYgQ2xpcHBlckJhc2UuaG9yeklzU3Bpa2UoaG9yeikpIHtcclxuICAgICAgICBDbGlwcGVyQmFzZS50cmltSG9yeihob3J6LCB0cnVlKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gQ2xpcHBlckJhc2UucmVzZXRIb3J6RGlyZWN0aW9uKGhvcnosIHZlcnRleF9tYXgpO1xyXG4gICAgICBpc0xlZnRUb1JpZ2h0ID0gcmVzdWx0LmlzTGVmdFRvUmlnaHRcclxuICAgICAgbGVmdFggPSByZXN1bHQubGVmdFhcclxuICAgICAgcmlnaHRYID0gcmVzdWx0LnJpZ2h0WFxyXG4gICAgfVxyXG5cclxuICAgIGlmIChDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUoaG9yeikpIHtcclxuICAgICAgY29uc3Qgb3AgPSBDbGlwcGVyQmFzZS5hZGRPdXRQdChob3J6LCBob3J6LnRvcCk7XHJcbiAgICAgIHRoaXMuYWRkVG9Ib3J6U2VnTGlzdChvcCk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy51cGRhdGVFZGdlSW50b0FFTChob3J6KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZG9Ub3BPZlNjYW5iZWFtKHk6IG51bWJlcik6IHZvaWQge1xyXG4gICAgdGhpcy5fc2VsID0gdW5kZWZpbmVkOyAvLyBfc2VsIGlzIHJldXNlZCB0byBmbGFnIGhvcml6b250YWxzIChzZWUgcHVzaEhvcnogYmVsb3cpXHJcbiAgICBsZXQgYWU6IEFjdGl2ZSB8IHVuZGVmaW5lZCA9IHRoaXMuX2FjdGl2ZXM7XHJcblxyXG4gICAgd2hpbGUgKGFlKSB7XHJcbiAgICAgIC8vIE5CICdhZScgd2lsbCBuZXZlciBiZSBob3Jpem9udGFsIGhlcmVcclxuICAgICAgaWYgKGFlLnRvcC55ID09PSB5KSB7XHJcbiAgICAgICAgYWUuY3VyWCA9IGFlLnRvcC54O1xyXG5cclxuICAgICAgICBpZiAoQ2xpcHBlckJhc2UuaXNNYXhpbWFBY3RpdmUoYWUpKSB7XHJcbiAgICAgICAgICBhZSA9IHRoaXMuZG9NYXhpbWEoYWUpOyAvLyBUT1AgT0YgQk9VTkQgKE1BWElNQSlcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgLy8gSU5URVJNRURJQVRFIFZFUlRFWCAuLi5cclxuICAgICAgICBpZiAoQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKGFlKSlcclxuICAgICAgICAgIENsaXBwZXJCYXNlLmFkZE91dFB0KGFlLCBhZS50b3ApO1xyXG5cclxuICAgICAgICB0aGlzLnVwZGF0ZUVkZ2VJbnRvQUVMKGFlKTtcclxuXHJcbiAgICAgICAgaWYgKENsaXBwZXJCYXNlLmlzSG9yaXpvbnRhbChhZSkpXHJcbiAgICAgICAgICB0aGlzLnB1c2hIb3J6KGFlKTsgLy8gaG9yaXpvbnRhbHMgYXJlIHByb2Nlc3NlZCBsYXRlclxyXG4gICAgICB9IGVsc2UgeyAvLyBpLmUuIG5vdCB0aGUgdG9wIG9mIHRoZSBlZGdlXHJcbiAgICAgICAgYWUuY3VyWCA9IENsaXBwZXJCYXNlLnRvcFgoYWUsIHkpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBhZSA9IGFlLm5leHRJbkFFTDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgZG9NYXhpbWEoYWU6IEFjdGl2ZSk6IEFjdGl2ZSB8IHVuZGVmaW5lZCB7XHJcbiAgICBjb25zdCBwcmV2RTogQWN0aXZlIHwgdW5kZWZpbmVkID0gYWUucHJldkluQUVMXHJcbiAgICBsZXQgbmV4dEU6IEFjdGl2ZSB8IHVuZGVmaW5lZCA9IGFlLm5leHRJbkFFTFxyXG5cclxuICAgIGlmIChDbGlwcGVyQmFzZS5pc09wZW5FbmRBY3RpdmUoYWUpKSB7XHJcbiAgICAgIGlmIChDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUoYWUpKSBDbGlwcGVyQmFzZS5hZGRPdXRQdChhZSwgYWUudG9wKTtcclxuICAgICAgaWYgKCFDbGlwcGVyQmFzZS5pc0hvcml6b250YWwoYWUpKSB7XHJcbiAgICAgICAgaWYgKENsaXBwZXJCYXNlLmlzSG90RWRnZUFjdGl2ZShhZSkpIHtcclxuICAgICAgICAgIGlmIChDbGlwcGVyQmFzZS5pc0Zyb250KGFlKSlcclxuICAgICAgICAgICAgYWUub3V0cmVjIS5mcm9udEVkZ2UgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgICBlbHNlXHJcbiAgICAgICAgICAgIGFlLm91dHJlYyEuYmFja0VkZ2UgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgICBhZS5vdXRyZWMgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMuZGVsZXRlRnJvbUFFTChhZSk7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIG5leHRFO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG1heFBhaXI6IEFjdGl2ZSB8IHVuZGVmaW5lZCA9IENsaXBwZXJCYXNlLmdldE1heGltYVBhaXIoYWUpO1xyXG4gICAgaWYgKCFtYXhQYWlyKSByZXR1cm4gbmV4dEU7IC8vIGVNYXhQYWlyIGlzIGhvcml6b250YWxcclxuXHJcbiAgICBpZiAoQ2xpcHBlckJhc2UuaXNKb2luZWQoYWUpKSB0aGlzLnNwbGl0KGFlLCBhZS50b3ApO1xyXG4gICAgaWYgKENsaXBwZXJCYXNlLmlzSm9pbmVkKG1heFBhaXIpKSB0aGlzLnNwbGl0KG1heFBhaXIsIG1heFBhaXIudG9wKTtcclxuXHJcbiAgICAvLyBvbmx5IG5vbi1ob3Jpem9udGFsIG1heGltYSBoZXJlLlxyXG4gICAgLy8gcHJvY2VzcyBhbnkgZWRnZXMgYmV0d2VlbiBtYXhpbWEgcGFpciAuLi5cclxuICAgIHdoaWxlIChuZXh0RSAhPT0gbWF4UGFpcikge1xyXG4gICAgICB0aGlzLmludGVyc2VjdEVkZ2VzKGFlLCBuZXh0RSEsIGFlLnRvcCk7XHJcbiAgICAgIHRoaXMuc3dhcFBvc2l0aW9uc0luQUVMKGFlLCBuZXh0RSEpO1xyXG4gICAgICBuZXh0RSA9IGFlLm5leHRJbkFFTFxyXG4gICAgfVxyXG5cclxuICAgIGlmIChDbGlwcGVyQmFzZS5pc09wZW4oYWUpKSB7XHJcbiAgICAgIGlmIChDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUoYWUpKVxyXG4gICAgICAgIHRoaXMuYWRkTG9jYWxNYXhQb2x5KGFlLCBtYXhQYWlyLCBhZS50b3ApO1xyXG4gICAgICB0aGlzLmRlbGV0ZUZyb21BRUwobWF4UGFpcik7XHJcbiAgICAgIHRoaXMuZGVsZXRlRnJvbUFFTChhZSk7XHJcbiAgICAgIHJldHVybiAocHJldkUgPyBwcmV2RS5uZXh0SW5BRUwgOiB0aGlzLl9hY3RpdmVzKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBoZXJlIGFlLm5leHRJbkFlbCA9PSBFTmV4dCA9PSBFTWF4UGFpciAuLi5cclxuICAgIGlmIChDbGlwcGVyQmFzZS5pc0hvdEVkZ2VBY3RpdmUoYWUpKVxyXG4gICAgICB0aGlzLmFkZExvY2FsTWF4UG9seShhZSwgbWF4UGFpciwgYWUudG9wKTtcclxuXHJcbiAgICB0aGlzLmRlbGV0ZUZyb21BRUwoYWUpO1xyXG4gICAgdGhpcy5kZWxldGVGcm9tQUVMKG1heFBhaXIpO1xyXG4gICAgcmV0dXJuIChwcmV2RSA/IHByZXZFLm5leHRJbkFFTCA6IHRoaXMuX2FjdGl2ZXMpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgaXNKb2luZWQoZTogQWN0aXZlKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gZS5qb2luV2l0aCAhPT0gSm9pbldpdGguTm9uZTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3BsaXQoZTogQWN0aXZlLCBjdXJyUHQ6IElQb2ludDY0KTogdm9pZCB7XHJcbiAgICBpZiAoZS5qb2luV2l0aCA9PT0gSm9pbldpdGguUmlnaHQpIHtcclxuICAgICAgZS5qb2luV2l0aCA9IEpvaW5XaXRoLk5vbmU7XHJcbiAgICAgIGUubmV4dEluQUVMIS5qb2luV2l0aCA9IEpvaW5XaXRoLk5vbmU7XHJcbiAgICAgIHRoaXMuYWRkTG9jYWxNaW5Qb2x5KGUsIGUubmV4dEluQUVMISwgY3VyclB0LCB0cnVlKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGUuam9pbldpdGggPSBKb2luV2l0aC5Ob25lO1xyXG4gICAgICBlLnByZXZJbkFFTCEuam9pbldpdGggPSBKb2luV2l0aC5Ob25lO1xyXG4gICAgICB0aGlzLmFkZExvY2FsTWluUG9seShlLnByZXZJbkFFTCEsIGUsIGN1cnJQdCwgdHJ1ZSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNoZWNrSm9pbkxlZnQoZTogQWN0aXZlLCBwdDogSVBvaW50NjQsIGNoZWNrQ3Vyclg6IGJvb2xlYW4gPSBmYWxzZSk6IHZvaWQge1xyXG4gICAgY29uc3QgcHJldiA9IGUucHJldkluQUVMO1xyXG4gICAgaWYgKCFwcmV2IHx8IENsaXBwZXJCYXNlLmlzT3BlbihlKSB8fCBDbGlwcGVyQmFzZS5pc09wZW4ocHJldikgfHxcclxuICAgICAgIUNsaXBwZXJCYXNlLmlzSG90RWRnZUFjdGl2ZShlKSB8fCAhQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKHByZXYpKSByZXR1cm47XHJcblxyXG4gICAgaWYgKChwdC55IDwgZS50b3AueSArIDIgfHwgcHQueSA8IHByZXYudG9wLnkgKyAyKSAmJiAvLyBhdm9pZCB0cml2aWFsIGpvaW5zXHJcbiAgICAgICgoZS5ib3QueSA+IHB0LnkpIHx8IChwcmV2LmJvdC55ID4gcHQueSkpKSByZXR1cm47IC8vICgjNDkwKVxyXG5cclxuICAgIGlmIChjaGVja0N1cnJYKSB7XHJcbiAgICAgIGlmIChDbGlwcGVyLnBlcnBlbmRpY0Rpc3RGcm9tTGluZVNxcmQocHQsIHByZXYuYm90LCBwcmV2LnRvcCkgPiAwLjI1KSByZXR1cm47XHJcbiAgICB9IGVsc2UgaWYgKGUuY3VyWCAhPT0gcHJldi5jdXJYKSByZXR1cm47XHJcbiAgICBpZiAoSW50ZXJuYWxDbGlwcGVyLmNyb3NzUHJvZHVjdChlLnRvcCwgcHQsIHByZXYudG9wKSAhPT0gMCkgcmV0dXJuO1xyXG5cclxuICAgIGlmIChlLm91dHJlYyEuaWR4ID09PSBwcmV2Lm91dHJlYyEuaWR4KVxyXG4gICAgICB0aGlzLmFkZExvY2FsTWF4UG9seShwcmV2LCBlLCBwdCk7XHJcbiAgICBlbHNlIGlmIChlLm91dHJlYyEuaWR4IDwgcHJldi5vdXRyZWMhLmlkeClcclxuICAgICAgQ2xpcHBlckJhc2Uuam9pbk91dHJlY1BhdGhzKGUsIHByZXYpO1xyXG4gICAgZWxzZVxyXG4gICAgICBDbGlwcGVyQmFzZS5qb2luT3V0cmVjUGF0aHMocHJldiwgZSk7XHJcbiAgICBwcmV2LmpvaW5XaXRoID0gSm9pbldpdGguUmlnaHQ7XHJcbiAgICBlLmpvaW5XaXRoID0gSm9pbldpdGguTGVmdDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY2hlY2tKb2luUmlnaHQoZTogQWN0aXZlLCBwdDogSVBvaW50NjQsIGNoZWNrQ3Vyclg6IGJvb2xlYW4gPSBmYWxzZSk6IHZvaWQge1xyXG4gICAgY29uc3QgbmV4dCA9IGUubmV4dEluQUVMO1xyXG4gICAgaWYgKENsaXBwZXJCYXNlLmlzT3BlbihlKSB8fCAhQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKGUpIHx8IENsaXBwZXJCYXNlLmlzSm9pbmVkKGUpIHx8XHJcbiAgICAgICFuZXh0IHx8IENsaXBwZXJCYXNlLmlzT3BlbihuZXh0KSB8fCAhQ2xpcHBlckJhc2UuaXNIb3RFZGdlQWN0aXZlKG5leHQpKSByZXR1cm47XHJcblxyXG4gICAgaWYgKChwdC55IDwgZS50b3AueSArIDIgfHwgcHQueSA8IG5leHQudG9wLnkgKyAyKSAmJiAvLyBhdm9pZCB0cml2aWFsIGpvaW5zXHJcbiAgICAgICgoZS5ib3QueSA+IHB0LnkpIHx8IChuZXh0LmJvdC55ID4gcHQueSkpKSByZXR1cm47IC8vICgjNDkwKVxyXG5cclxuICAgIGlmIChjaGVja0N1cnJYKSB7XHJcbiAgICAgIGlmIChDbGlwcGVyLnBlcnBlbmRpY0Rpc3RGcm9tTGluZVNxcmQocHQsIG5leHQuYm90LCBuZXh0LnRvcCkgPiAwLjI1KSByZXR1cm47XHJcbiAgICB9IGVsc2UgaWYgKGUuY3VyWCAhPT0gbmV4dC5jdXJYKSByZXR1cm47XHJcbiAgICBpZiAoSW50ZXJuYWxDbGlwcGVyLmNyb3NzUHJvZHVjdChlLnRvcCwgcHQsIG5leHQudG9wKSAhPT0gMCkgcmV0dXJuO1xyXG5cclxuICAgIGlmIChlLm91dHJlYyEuaWR4ID09PSBuZXh0Lm91dHJlYyEuaWR4KVxyXG4gICAgICB0aGlzLmFkZExvY2FsTWF4UG9seShlLCBuZXh0LCBwdCk7XHJcbiAgICBlbHNlIGlmIChlLm91dHJlYyEuaWR4IDwgbmV4dC5vdXRyZWMhLmlkeClcclxuICAgICAgQ2xpcHBlckJhc2Uuam9pbk91dHJlY1BhdGhzKGUsIG5leHQpO1xyXG4gICAgZWxzZVxyXG4gICAgICBDbGlwcGVyQmFzZS5qb2luT3V0cmVjUGF0aHMobmV4dCwgZSk7XHJcbiAgICBlLmpvaW5XaXRoID0gSm9pbldpdGguUmlnaHQ7XHJcbiAgICBuZXh0LmpvaW5XaXRoID0gSm9pbldpdGguTGVmdDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGZpeE91dFJlY1B0cyhvdXRyZWM6IE91dFJlYyk6IHZvaWQge1xyXG4gICAgbGV0IG9wID0gb3V0cmVjLnB0cyE7XHJcbiAgICBkbyB7XHJcbiAgICAgIG9wIS5vdXRyZWMgPSBvdXRyZWM7XHJcbiAgICAgIG9wID0gb3AubmV4dCE7XHJcbiAgICB9IHdoaWxlIChvcCAhPT0gb3V0cmVjLnB0cyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBzZXRIb3J6U2VnSGVhZGluZ0ZvcndhcmQoaHM6IEhvcnpTZWdtZW50LCBvcFA6IE91dFB0LCBvcE46IE91dFB0KTogYm9vbGVhbiB7XHJcbiAgICBpZiAob3BQLnB0LnggPT09IG9wTi5wdC54KSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAob3BQLnB0LnggPCBvcE4ucHQueCkge1xyXG4gICAgICBocy5sZWZ0T3AgPSBvcFA7XHJcbiAgICAgIGhzLnJpZ2h0T3AgPSBvcE47XHJcbiAgICAgIGhzLmxlZnRUb1JpZ2h0ID0gdHJ1ZTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGhzLmxlZnRPcCA9IG9wTjtcclxuICAgICAgaHMucmlnaHRPcCA9IG9wUDtcclxuICAgICAgaHMubGVmdFRvUmlnaHQgPSBmYWxzZTtcclxuICAgIH1cclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgdXBkYXRlSG9yelNlZ21lbnQoaHM6IEhvcnpTZWdtZW50KTogYm9vbGVhbiB7XHJcbiAgICBjb25zdCBvcCA9IGhzLmxlZnRPcDtcclxuICAgIGNvbnN0IG91dHJlYyA9IHRoaXMuZ2V0UmVhbE91dFJlYyhvcC5vdXRyZWMpITtcclxuICAgIGNvbnN0IG91dHJlY0hhc0VkZ2VzID0gb3V0cmVjLmZyb250RWRnZSAhPT0gdW5kZWZpbmVkO1xyXG4gICAgY29uc3QgY3Vycl95ID0gb3AucHQueTtcclxuICAgIGxldCBvcFAgPSBvcCwgb3BOID0gb3A7XHJcblxyXG4gICAgaWYgKG91dHJlY0hhc0VkZ2VzKSB7XHJcbiAgICAgIGNvbnN0IG9wQSA9IG91dHJlYy5wdHMhLCBvcFogPSBvcEEubmV4dCE7XHJcbiAgICAgIHdoaWxlIChvcFAgIT09IG9wWiAmJiBvcFAucHJldi5wdC55ID09PSBjdXJyX3kpXHJcbiAgICAgICAgb3BQID0gb3BQLnByZXY7XHJcbiAgICAgIHdoaWxlIChvcE4gIT09IG9wQSAmJiBvcE4ubmV4dCEucHQueSA9PT0gY3Vycl95KVxyXG4gICAgICAgIG9wTiA9IG9wTi5uZXh0ITtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHdoaWxlIChvcFAucHJldiAhPT0gb3BOICYmIG9wUC5wcmV2LnB0LnkgPT09IGN1cnJfeSlcclxuICAgICAgICBvcFAgPSBvcFAucHJldjtcclxuICAgICAgd2hpbGUgKG9wTi5uZXh0ICE9PSBvcFAgJiYgb3BOLm5leHQhLnB0LnkgPT09IGN1cnJfeSlcclxuICAgICAgICBvcE4gPSBvcE4ubmV4dCE7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzdWx0ID0gdGhpcy5zZXRIb3J6U2VnSGVhZGluZ0ZvcndhcmQoaHMsIG9wUCwgb3BOKSAmJiBocy5sZWZ0T3AhLmhvcnogPT09IHVuZGVmaW5lZDtcclxuXHJcbiAgICBpZiAocmVzdWx0KVxyXG4gICAgICBocy5sZWZ0T3AhLmhvcnogPSBocztcclxuICAgIGVsc2VcclxuICAgICAgaHMucmlnaHRPcCA9IHVuZGVmaW5lZDsgLy8gKGZvciBzb3J0aW5nKVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBkdXBsaWNhdGVPcChvcDogT3V0UHQsIGluc2VydF9hZnRlcjogYm9vbGVhbik6IE91dFB0IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IG5ldyBPdXRQdChvcC5wdCwgb3Aub3V0cmVjKTtcclxuICAgIGlmIChpbnNlcnRfYWZ0ZXIpIHtcclxuICAgICAgcmVzdWx0Lm5leHQgPSBvcC5uZXh0O1xyXG4gICAgICByZXN1bHQubmV4dCEucHJldiA9IHJlc3VsdDtcclxuICAgICAgcmVzdWx0LnByZXYgPSBvcDtcclxuICAgICAgb3AubmV4dCA9IHJlc3VsdDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHJlc3VsdC5wcmV2ID0gb3AucHJldjtcclxuICAgICAgcmVzdWx0LnByZXYubmV4dCA9IHJlc3VsdDtcclxuICAgICAgcmVzdWx0Lm5leHQgPSBvcDtcclxuICAgICAgb3AucHJldiA9IHJlc3VsdDtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNvbnZlcnRIb3J6U2Vnc1RvSm9pbnMoKTogdm9pZCB7XHJcbiAgICBsZXQgayA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IGhzIG9mIHRoaXMuX2hvcnpTZWdMaXN0KSB7XHJcbiAgICAgIGlmIChDbGlwcGVyQmFzZS51cGRhdGVIb3J6U2VnbWVudChocykpIGsrKztcclxuICAgIH1cclxuICAgIGlmIChrIDwgMikgcmV0dXJuO1xyXG4gICAgdGhpcy5faG9yelNlZ0xpc3Quc29ydCgoaHMxLCBoczIpID0+IHtcclxuICAgICAgaWYgKCFoczEgfHwgIWhzMikgcmV0dXJuIDA7XHJcbiAgICAgIGlmICghaHMxLnJpZ2h0T3ApIHtcclxuICAgICAgICByZXR1cm4gIWhzMi5yaWdodE9wID8gMCA6IDE7XHJcbiAgICAgIH0gZWxzZSBpZiAoIWhzMi5yaWdodE9wKVxyXG4gICAgICAgIHJldHVybiAtMTtcclxuICAgICAgZWxzZVxyXG4gICAgICAgIHJldHVybiBoczEubGVmdE9wIS5wdC54IC0gaHMyLmxlZnRPcCEucHQueDtcclxuICAgIH0pO1xyXG5cclxuICAgIGZvciAobGV0IGkgPSAwOyBpIDwgayAtIDE7IGkrKykge1xyXG4gICAgICBjb25zdCBoczEgPSB0aGlzLl9ob3J6U2VnTGlzdFtpXTtcclxuICAgICAgLy8gZm9yIGVhY2ggSG9yelNlZ21lbnQsIGZpbmQgb3RoZXJzIHRoYXQgb3ZlcmxhcFxyXG4gICAgICBmb3IgKGxldCBqID0gaSArIDE7IGogPCBrOyBqKyspIHtcclxuICAgICAgICBjb25zdCBoczIgPSB0aGlzLl9ob3J6U2VnTGlzdFtqXTtcclxuICAgICAgICBpZiAoaHMyLmxlZnRPcCEucHQueCA+PSBoczEucmlnaHRPcCEucHQueCB8fFxyXG4gICAgICAgICAgaHMyLmxlZnRUb1JpZ2h0ID09PSBoczEubGVmdFRvUmlnaHQgfHxcclxuICAgICAgICAgIGhzMi5yaWdodE9wIS5wdC54IDw9IGhzMS5sZWZ0T3AhLnB0LngpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgICBjb25zdCBjdXJyX3kgPSBoczEubGVmdE9wLnB0Lnk7XHJcblxyXG4gICAgICAgIGlmIChoczEubGVmdFRvUmlnaHQpIHtcclxuICAgICAgICAgIHdoaWxlIChoczEubGVmdE9wLm5leHQhLnB0LnkgPT09IGN1cnJfeSAmJlxyXG4gICAgICAgICAgICBoczEubGVmdE9wLm5leHQhLnB0LnggPD0gaHMyLmxlZnRPcC5wdC54KSB7XHJcbiAgICAgICAgICAgIGhzMS5sZWZ0T3AgPSBoczEubGVmdE9wLm5leHQhO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgd2hpbGUgKGhzMi5sZWZ0T3AucHJldi5wdC55ID09PSBjdXJyX3kgJiZcclxuICAgICAgICAgICAgaHMyLmxlZnRPcC5wcmV2LnB0LnggPD0gaHMxLmxlZnRPcC5wdC54KSB7XHJcbiAgICAgICAgICAgIGhzMi5sZWZ0T3AgPSBoczIubGVmdE9wLnByZXY7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb25zdCBqb2luID0gbmV3IEhvcnpKb2luKFxyXG4gICAgICAgICAgICBDbGlwcGVyQmFzZS5kdXBsaWNhdGVPcChoczEubGVmdE9wLCB0cnVlKSxcclxuICAgICAgICAgICAgQ2xpcHBlckJhc2UuZHVwbGljYXRlT3AoaHMyLmxlZnRPcCwgZmFsc2UpXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgICAgdGhpcy5faG9yekpvaW5MaXN0LnB1c2goam9pbik7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIHdoaWxlIChoczEubGVmdE9wLnByZXYucHQueSA9PT0gY3Vycl95ICYmXHJcbiAgICAgICAgICAgIGhzMS5sZWZ0T3AucHJldi5wdC54IDw9IGhzMi5sZWZ0T3AucHQueCkge1xyXG4gICAgICAgICAgICBoczEubGVmdE9wID0gaHMxLmxlZnRPcC5wcmV2O1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgd2hpbGUgKGhzMi5sZWZ0T3AubmV4dCEucHQueSA9PT0gY3Vycl95ICYmXHJcbiAgICAgICAgICAgIGhzMi5sZWZ0T3AubmV4dCEucHQueCA8PSBoczEubGVmdE9wLnB0LngpIHtcclxuICAgICAgICAgICAgaHMyLmxlZnRPcCA9IGhzMi5sZWZ0T3AubmV4dCE7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb25zdCBqb2luID0gbmV3IEhvcnpKb2luKFxyXG4gICAgICAgICAgICBDbGlwcGVyQmFzZS5kdXBsaWNhdGVPcChoczIubGVmdE9wLCB0cnVlKSxcclxuICAgICAgICAgICAgQ2xpcHBlckJhc2UuZHVwbGljYXRlT3AoaHMxLmxlZnRPcCwgZmFsc2UpXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgICAgdGhpcy5faG9yekpvaW5MaXN0LnB1c2goam9pbik7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBnZXRDbGVhblBhdGgob3A6IE91dFB0KTogUGF0aDY0IHtcclxuICAgIGNvbnN0IHJlc3VsdCA9IG5ldyBQYXRoNjQoKTtcclxuICAgIGxldCBvcDIgPSBvcDtcclxuICAgIHdoaWxlIChvcDIubmV4dCAhPT0gb3AgJiZcclxuICAgICAgKChvcDIucHQueCA9PT0gb3AyLm5leHQhLnB0LnggJiYgb3AyLnB0LnggPT09IG9wMi5wcmV2LnB0LngpIHx8XHJcbiAgICAgICAgKG9wMi5wdC55ID09PSBvcDIubmV4dCEucHQueSAmJiBvcDIucHQueSA9PT0gb3AyLnByZXYucHQueSkpKSB7XHJcbiAgICAgIG9wMiA9IG9wMi5uZXh0ITtcclxuICAgIH1cclxuICAgIHJlc3VsdC5wdXNoKG9wMi5wdCk7XHJcbiAgICBsZXQgcHJldk9wID0gb3AyO1xyXG4gICAgb3AyID0gb3AyLm5leHQhO1xyXG5cclxuICAgIHdoaWxlIChvcDIgIT09IG9wKSB7XHJcbiAgICAgIGlmICgob3AyLnB0LnggIT09IG9wMi5uZXh0IS5wdC54IHx8IG9wMi5wdC54ICE9PSBwcmV2T3AucHQueCkgJiZcclxuICAgICAgICAob3AyLnB0LnkgIT09IG9wMi5uZXh0IS5wdC55IHx8IG9wMi5wdC55ICE9PSBwcmV2T3AucHQueSkpIHtcclxuICAgICAgICByZXN1bHQucHVzaChvcDIucHQpO1xyXG4gICAgICAgIHByZXZPcCA9IG9wMjtcclxuICAgICAgfVxyXG4gICAgICBvcDIgPSBvcDIubmV4dCE7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgcG9pbnRJbk9wUG9seWdvbihwdDogSVBvaW50NjQsIG9wOiBPdXRQdCk6IFBvaW50SW5Qb2x5Z29uUmVzdWx0IHtcclxuICAgIGlmIChvcCA9PT0gb3AubmV4dCB8fCBvcC5wcmV2ID09PSBvcC5uZXh0KVxyXG4gICAgICByZXR1cm4gUG9pbnRJblBvbHlnb25SZXN1bHQuSXNPdXRzaWRlO1xyXG5cclxuICAgIGxldCBvcDIgPSBvcDtcclxuICAgIGRvIHtcclxuICAgICAgaWYgKG9wLnB0LnkgIT09IHB0LnkpIGJyZWFrO1xyXG4gICAgICBvcCA9IG9wLm5leHQhO1xyXG4gICAgfSB3aGlsZSAob3AgIT09IG9wMik7XHJcbiAgICBpZiAob3AucHQueSA9PT0gcHQueSkgIC8vIG5vdCBhIHByb3BlciBwb2x5Z29uXHJcbiAgICAgIHJldHVybiBQb2ludEluUG9seWdvblJlc3VsdC5Jc091dHNpZGU7XHJcblxyXG4gICAgbGV0IGlzQWJvdmUgPSBvcC5wdC55IDwgcHQueVxyXG4gICAgY29uc3Qgc3RhcnRpbmdBYm92ZSA9IGlzQWJvdmU7XHJcbiAgICBsZXQgdmFsID0gMDtcclxuXHJcbiAgICBvcDIgPSBvcC5uZXh0ITtcclxuICAgIHdoaWxlIChvcDIgIT09IG9wKSB7XHJcbiAgICAgIGlmIChpc0Fib3ZlKVxyXG4gICAgICAgIHdoaWxlIChvcDIgIT09IG9wICYmIG9wMi5wdC55IDwgcHQueSkgb3AyID0gb3AyLm5leHQhO1xyXG4gICAgICBlbHNlXHJcbiAgICAgICAgd2hpbGUgKG9wMiAhPT0gb3AgJiYgb3AyLnB0LnkgPiBwdC55KSBvcDIgPSBvcDIubmV4dCE7XHJcbiAgICAgIGlmIChvcDIgPT09IG9wKSBicmVhaztcclxuXHJcbiAgICAgIGlmIChvcDIucHQueSA9PT0gcHQueSkge1xyXG4gICAgICAgIGlmIChvcDIucHQueCA9PT0gcHQueCB8fCAob3AyLnB0LnkgPT09IG9wMi5wcmV2LnB0LnkgJiZcclxuICAgICAgICAgIChwdC54IDwgb3AyLnByZXYucHQueCkgIT09IChwdC54IDwgb3AyLnB0LngpKSlcclxuICAgICAgICAgIHJldHVybiBQb2ludEluUG9seWdvblJlc3VsdC5Jc09uO1xyXG4gICAgICAgIG9wMiA9IG9wMi5uZXh0ITtcclxuICAgICAgICBpZiAob3AyID09PSBvcCkgYnJlYWs7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChvcDIucHQueCA8PSBwdC54IHx8IG9wMi5wcmV2LnB0LnggPD0gcHQueCkge1xyXG4gICAgICAgIGlmIChvcDIucHJldi5wdC54IDwgcHQueCAmJiBvcDIucHQueCA8IHB0LngpXHJcbiAgICAgICAgICB2YWwgPSAxIC0gdmFsO1xyXG4gICAgICAgIGVsc2Uge1xyXG4gICAgICAgICAgY29uc3QgZCA9IEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3Qob3AyLnByZXYucHQsIG9wMi5wdCwgcHQpO1xyXG4gICAgICAgICAgaWYgKGQgPT09IDApIHJldHVybiBQb2ludEluUG9seWdvblJlc3VsdC5Jc09uO1xyXG4gICAgICAgICAgaWYgKChkIDwgMCkgPT09IGlzQWJvdmUpIHZhbCA9IDEgLSB2YWw7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICAgIGlzQWJvdmUgPSAhaXNBYm92ZTtcclxuICAgICAgb3AyID0gb3AyLm5leHQhO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChpc0Fib3ZlICE9PSBzdGFydGluZ0Fib3ZlKSB7XHJcbiAgICAgIGNvbnN0IGQgPSBJbnRlcm5hbENsaXBwZXIuY3Jvc3NQcm9kdWN0KG9wMi5wcmV2LnB0LCBvcDIucHQsIHB0KTtcclxuICAgICAgaWYgKGQgPT09IDApIHJldHVybiBQb2ludEluUG9seWdvblJlc3VsdC5Jc09uO1xyXG4gICAgICBpZiAoKGQgPCAwKSA9PT0gaXNBYm92ZSkgdmFsID0gMSAtIHZhbDtcclxuICAgIH1cclxuXHJcbiAgICBpZiAodmFsID09PSAwKSByZXR1cm4gUG9pbnRJblBvbHlnb25SZXN1bHQuSXNPdXRzaWRlO1xyXG4gICAgZWxzZSByZXR1cm4gUG9pbnRJblBvbHlnb25SZXN1bHQuSXNJbnNpZGU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBwYXRoMUluc2lkZVBhdGgyKG9wMTogT3V0UHQsIG9wMjogT3V0UHQpOiBib29sZWFuIHtcclxuICAgIGxldCByZXN1bHQ6IFBvaW50SW5Qb2x5Z29uUmVzdWx0O1xyXG4gICAgbGV0IG91dHNpZGVfY250ID0gMDtcclxuICAgIGxldCBvcCA9IG9wMTtcclxuICAgIGRvIHtcclxuICAgICAgcmVzdWx0ID0gdGhpcy5wb2ludEluT3BQb2x5Z29uKG9wLnB0LCBvcDIpO1xyXG4gICAgICBpZiAocmVzdWx0ID09PSBQb2ludEluUG9seWdvblJlc3VsdC5Jc091dHNpZGUpICsrb3V0c2lkZV9jbnQ7XHJcbiAgICAgIGVsc2UgaWYgKHJlc3VsdCA9PT0gUG9pbnRJblBvbHlnb25SZXN1bHQuSXNJbnNpZGUpIC0tb3V0c2lkZV9jbnQ7XHJcbiAgICAgIG9wID0gb3AubmV4dCE7XHJcbiAgICB9IHdoaWxlIChvcCAhPT0gb3AxICYmIE1hdGguYWJzKG91dHNpZGVfY250KSA8IDIpO1xyXG4gICAgaWYgKE1hdGguYWJzKG91dHNpZGVfY250KSA+IDEpIHJldHVybiAob3V0c2lkZV9jbnQgPCAwKTtcclxuXHJcbiAgICBjb25zdCBtcCA9IENsaXBwZXJCYXNlLmdldEJvdW5kc1BhdGgodGhpcy5nZXRDbGVhblBhdGgob3AxKSkubWlkUG9pbnQoKTtcclxuICAgIGNvbnN0IHBhdGgyID0gdGhpcy5nZXRDbGVhblBhdGgob3AyKTtcclxuICAgIHJldHVybiBJbnRlcm5hbENsaXBwZXIucG9pbnRJblBvbHlnb24obXAsIHBhdGgyKSAhPT0gUG9pbnRJblBvbHlnb25SZXN1bHQuSXNPdXRzaWRlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBtb3ZlU3BsaXRzKGZyb21PcjogT3V0UmVjLCB0b09yOiBPdXRSZWMpOiB2b2lkIHtcclxuICAgIGlmICghZnJvbU9yLnNwbGl0cykgcmV0dXJuO1xyXG4gICAgdG9Pci5zcGxpdHMgPSB0b09yLnNwbGl0cyB8fCBbXTtcclxuICAgIGZvciAoY29uc3QgaSBvZiBmcm9tT3Iuc3BsaXRzKSB7XHJcbiAgICAgIHRvT3Iuc3BsaXRzLnB1c2goaSk7XHJcbiAgICB9XHJcbiAgICBmcm9tT3Iuc3BsaXRzID0gdW5kZWZpbmVkO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBwcm9jZXNzSG9yekpvaW5zKCk6IHZvaWQge1xyXG4gICAgZm9yIChjb25zdCBqIG9mIHRoaXMuX2hvcnpKb2luTGlzdCkge1xyXG4gICAgICBjb25zdCBvcjEgPSBDbGlwcGVyQmFzZS5nZXRSZWFsT3V0UmVjKGoub3AxIS5vdXRyZWMpITtcclxuICAgICAgbGV0IG9yMiA9IENsaXBwZXJCYXNlLmdldFJlYWxPdXRSZWMoai5vcDIhLm91dHJlYykhO1xyXG5cclxuICAgICAgY29uc3Qgb3AxYiA9IGoub3AxIS5uZXh0ITtcclxuICAgICAgY29uc3Qgb3AyYiA9IGoub3AyIS5wcmV2ITtcclxuICAgICAgai5vcDEhLm5leHQgPSBqLm9wMiE7XHJcbiAgICAgIGoub3AyIS5wcmV2ID0gai5vcDEhO1xyXG4gICAgICBvcDFiLnByZXYgPSBvcDJiO1xyXG4gICAgICBvcDJiLm5leHQgPSBvcDFiO1xyXG5cclxuICAgICAgaWYgKG9yMSA9PT0gb3IyKSB7XHJcbiAgICAgICAgb3IyID0gdGhpcy5uZXdPdXRSZWMoKTtcclxuICAgICAgICBvcjIucHRzID0gb3AxYjtcclxuICAgICAgICBDbGlwcGVyQmFzZS5maXhPdXRSZWNQdHMob3IyKTtcclxuXHJcbiAgICAgICAgaWYgKG9yMS5wdHMhLm91dHJlYyA9PT0gb3IyKSB7XHJcbiAgICAgICAgICBvcjEucHRzID0gai5vcDE7XHJcbiAgICAgICAgICBvcjEucHRzIS5vdXRyZWMgPSBvcjE7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAodGhpcy5fdXNpbmdfcG9seXRyZWUpIHtcclxuICAgICAgICAgIGlmIChDbGlwcGVyQmFzZS5wYXRoMUluc2lkZVBhdGgyKG9yMS5wdHMhLCBvcjIucHRzKSkge1xyXG4gICAgICAgICAgICBjb25zdCB0bXAgPSBvcjEucHRzO1xyXG4gICAgICAgICAgICBvcjEucHRzID0gb3IyLnB0cztcclxuICAgICAgICAgICAgb3IyLnB0cyA9IHRtcDtcclxuICAgICAgICAgICAgQ2xpcHBlckJhc2UuZml4T3V0UmVjUHRzKG9yMSk7XHJcbiAgICAgICAgICAgIENsaXBwZXJCYXNlLmZpeE91dFJlY1B0cyhvcjIpO1xyXG4gICAgICAgICAgICBvcjIub3duZXIgPSBvcjE7XHJcbiAgICAgICAgICB9IGVsc2UgaWYgKENsaXBwZXJCYXNlLnBhdGgxSW5zaWRlUGF0aDIob3IyLnB0cywgb3IxLnB0cyEpKSB7XHJcbiAgICAgICAgICAgIG9yMi5vd25lciA9IG9yMTtcclxuICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIG9yMi5vd25lciA9IG9yMS5vd25lcjtcclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICBvcjEuc3BsaXRzID0gb3IxLnNwbGl0cyB8fCBbXTtcclxuICAgICAgICAgIG9yMS5zcGxpdHMucHVzaChvcjIuaWR4KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgb3IyLm93bmVyID0gb3IxO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBvcjIucHRzID0gdW5kZWZpbmVkO1xyXG4gICAgICAgIGlmICh0aGlzLl91c2luZ19wb2x5dHJlZSkge1xyXG4gICAgICAgICAgQ2xpcHBlckJhc2Uuc2V0T3duZXIob3IyLCBvcjEpO1xyXG4gICAgICAgICAgdGhpcy5tb3ZlU3BsaXRzKG9yMiwgb3IxKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgb3IyLm93bmVyID0gb3IxO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgcHRzUmVhbGx5Q2xvc2UocHQxOiBJUG9pbnQ2NCwgcHQyOiBJUG9pbnQ2NCk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIChNYXRoLmFicyhwdDEueCAtIHB0Mi54KSA8IDIpICYmIChNYXRoLmFicyhwdDEueSAtIHB0Mi55KSA8IDIpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgaXNWZXJ5U21hbGxUcmlhbmdsZShvcDogT3V0UHQpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBvcC5uZXh0IS5uZXh0ID09PSBvcC5wcmV2ICYmXHJcbiAgICAgICh0aGlzLnB0c1JlYWxseUNsb3NlKG9wLnByZXYucHQsIG9wLm5leHQhLnB0KSB8fFxyXG4gICAgICAgIHRoaXMucHRzUmVhbGx5Q2xvc2Uob3AucHQsIG9wLm5leHQhLnB0KSB8fFxyXG4gICAgICAgIHRoaXMucHRzUmVhbGx5Q2xvc2Uob3AucHQsIG9wLnByZXYucHQpKTtcclxuICB9XHJcblxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBpc1ZhbGlkQ2xvc2VkUGF0aChvcDogT3V0UHQgfCB1bmRlZmluZWQpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBvcCAhPT0gdW5kZWZpbmVkICYmIG9wLm5leHQgIT09IG9wICYmXHJcbiAgICAgIChvcC5uZXh0ICE9PSBvcC5wcmV2IHx8ICF0aGlzLmlzVmVyeVNtYWxsVHJpYW5nbGUob3ApKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGRpc3Bvc2VPdXRQdChvcDogT3V0UHQpOiBPdXRQdCB8IHVuZGVmaW5lZCB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBvcC5uZXh0ID09PSBvcCA/IHVuZGVmaW5lZCA6IG9wLm5leHQ7XHJcbiAgICBvcC5wcmV2Lm5leHQgPSBvcC5uZXh0O1xyXG4gICAgb3AubmV4dCEucHJldiA9IG9wLnByZXY7XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjbGVhbkNvbGxpbmVhcihvdXRyZWM6IE91dFJlYyB8IHVuZGVmaW5lZCk6IHZvaWQge1xyXG4gICAgb3V0cmVjID0gQ2xpcHBlckJhc2UuZ2V0UmVhbE91dFJlYyhvdXRyZWMpO1xyXG5cclxuICAgIGlmIChvdXRyZWMgPT09IHVuZGVmaW5lZCB8fCBvdXRyZWMuaXNPcGVuKSByZXR1cm47XHJcblxyXG4gICAgaWYgKCFDbGlwcGVyQmFzZS5pc1ZhbGlkQ2xvc2VkUGF0aChvdXRyZWMucHRzKSkge1xyXG4gICAgICBvdXRyZWMucHRzID0gdW5kZWZpbmVkO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IHN0YXJ0T3A6IE91dFB0ID0gb3V0cmVjLnB0cyE7XHJcbiAgICBsZXQgb3AyOiBPdXRQdCB8IHVuZGVmaW5lZCA9IHN0YXJ0T3A7XHJcbiAgICBmb3IgKDsgOykge1xyXG4gICAgICAvLyBOQiBpZiBwcmVzZXJ2ZUNvbGxpbmVhciA9PSB0cnVlLCB0aGVuIG9ubHkgcmVtb3ZlIDE4MCBkZWcuIHNwaWtlc1xyXG4gICAgICBpZiAoSW50ZXJuYWxDbGlwcGVyLmNyb3NzUHJvZHVjdChvcDIhLnByZXYucHQsIG9wMiEucHQsIG9wMiEubmV4dCEucHQpID09PSAwICYmXHJcbiAgICAgICAgKG9wMiEucHQgPT09IG9wMiEucHJldi5wdCB8fCBvcDIhLnB0ID09PSBvcDIhLm5leHQhLnB0IHx8ICF0aGlzLnByZXNlcnZlQ29sbGluZWFyIHx8XHJcbiAgICAgICAgICBJbnRlcm5hbENsaXBwZXIuZG90UHJvZHVjdChvcDIhLnByZXYucHQsIG9wMiEucHQsIG9wMiEubmV4dCEucHQpIDwgMCkpIHtcclxuXHJcbiAgICAgICAgaWYgKG9wMiA9PT0gb3V0cmVjLnB0cykge1xyXG4gICAgICAgICAgb3V0cmVjLnB0cyA9IG9wMiEucHJldjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIG9wMiA9IENsaXBwZXJCYXNlLmRpc3Bvc2VPdXRQdChvcDIhKTtcclxuICAgICAgICBpZiAoIUNsaXBwZXJCYXNlLmlzVmFsaWRDbG9zZWRQYXRoKG9wMikpIHtcclxuICAgICAgICAgIG91dHJlYy5wdHMgPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHN0YXJ0T3AgPSBvcDIhO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIG9wMiA9IG9wMiEubmV4dDtcclxuICAgICAgaWYgKG9wMiA9PT0gc3RhcnRPcCkgYnJlYWs7XHJcbiAgICB9XHJcbiAgICB0aGlzLmZpeFNlbGZJbnRlcnNlY3RzKG91dHJlYyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRvU3BsaXRPcChvdXRyZWM6IE91dFJlYywgc3BsaXRPcDogT3V0UHQpOiB2b2lkIHtcclxuICAgIC8vIHNwbGl0T3AucHJldiA8PT4gc3BsaXRPcCAmJlxyXG4gICAgLy8gc3BsaXRPcC5uZXh0IDw9PiBzcGxpdE9wLm5leHQubmV4dCBhcmUgaW50ZXJzZWN0aW5nXHJcbiAgICBjb25zdCBwcmV2T3A6IE91dFB0ID0gc3BsaXRPcC5wcmV2O1xyXG4gICAgY29uc3QgbmV4dE5leHRPcDogT3V0UHQgPSBzcGxpdE9wLm5leHQhLm5leHQhO1xyXG4gICAgb3V0cmVjLnB0cyA9IHByZXZPcDtcclxuXHJcbiAgICBjb25zdCBpcDogSVBvaW50NjQgPSBJbnRlcm5hbENsaXBwZXIuZ2V0SW50ZXJzZWN0UG9pbnQoXHJcbiAgICAgIHByZXZPcC5wdCwgc3BsaXRPcC5wdCwgc3BsaXRPcC5uZXh0IS5wdCwgbmV4dE5leHRPcC5wdCkuaXA7XHJcblxyXG4gICAgY29uc3QgYXJlYTE6IG51bWJlciA9IENsaXBwZXJCYXNlLmFyZWEocHJldk9wKTtcclxuICAgIGNvbnN0IGFic0FyZWExOiBudW1iZXIgPSBNYXRoLmFicyhhcmVhMSk7XHJcblxyXG4gICAgaWYgKGFic0FyZWExIDwgMikge1xyXG4gICAgICBvdXRyZWMucHRzID0gdW5kZWZpbmVkO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYXJlYTI6IG51bWJlciA9IENsaXBwZXJCYXNlLmFyZWFUcmlhbmdsZShpcCwgc3BsaXRPcC5wdCwgc3BsaXRPcC5uZXh0IS5wdCk7XHJcbiAgICBjb25zdCBhYnNBcmVhMjogbnVtYmVyID0gTWF0aC5hYnMoYXJlYTIpO1xyXG5cclxuICAgIC8vIGRlLWxpbmsgc3BsaXRPcCBhbmQgc3BsaXRPcC5uZXh0IGZyb20gdGhlIHBhdGhcclxuICAgIC8vIHdoaWxlIGluc2VydGluZyB0aGUgaW50ZXJzZWN0aW9uIHBvaW50XHJcbiAgICBpZiAoaXAgPT09IHByZXZPcC5wdCB8fCBpcCA9PT0gbmV4dE5leHRPcC5wdCkge1xyXG4gICAgICBuZXh0TmV4dE9wLnByZXYgPSBwcmV2T3A7XHJcbiAgICAgIHByZXZPcC5uZXh0ID0gbmV4dE5leHRPcDtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGNvbnN0IG5ld09wMiA9IG5ldyBPdXRQdChpcCwgb3V0cmVjKTtcclxuICAgICAgbmV3T3AyLnByZXYgPSBwcmV2T3A7XHJcbiAgICAgIG5ld09wMi5uZXh0ID0gbmV4dE5leHRPcDtcclxuICAgICAgbmV4dE5leHRPcC5wcmV2ID0gbmV3T3AyO1xyXG4gICAgICBwcmV2T3AubmV4dCA9IG5ld09wMjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBuYjogYXJlYTEgaXMgdGhlIHBhdGgncyBhcmVhICpiZWZvcmUqIHNwbGl0dGluZywgd2hlcmVhcyBhcmVhMiBpc1xyXG4gICAgLy8gdGhlIGFyZWEgb2YgdGhlIHRyaWFuZ2xlIGNvbnRhaW5pbmcgc3BsaXRPcCAmIHNwbGl0T3AubmV4dC5cclxuICAgIC8vIFNvIHRoZSBvbmx5IHdheSBmb3IgdGhlc2UgYXJlYXMgdG8gaGF2ZSB0aGUgc2FtZSBzaWduIGlzIGlmXHJcbiAgICAvLyB0aGUgc3BsaXQgdHJpYW5nbGUgaXMgbGFyZ2VyIHRoYW4gdGhlIHBhdGggY29udGFpbmluZyBwcmV2T3Agb3JcclxuICAgIC8vIGlmIHRoZXJlJ3MgbW9yZSB0aGFuIG9uZSBzZWxmPWludGVyc2VjdGlvbi5cclxuICAgIGlmIChhYnNBcmVhMiA+IDEgJiZcclxuICAgICAgKGFic0FyZWEyID4gYWJzQXJlYTEgfHwgKGFyZWEyID4gMCkgPT09IChhcmVhMSA+IDApKSkge1xyXG5cclxuICAgICAgY29uc3QgbmV3T3V0UmVjOiBPdXRSZWMgPSB0aGlzLm5ld091dFJlYygpO1xyXG4gICAgICBuZXdPdXRSZWMub3duZXIgPSBvdXRyZWMub3duZXI7XHJcbiAgICAgIHNwbGl0T3Aub3V0cmVjID0gbmV3T3V0UmVjO1xyXG4gICAgICBzcGxpdE9wLm5leHQhLm91dHJlYyA9IG5ld091dFJlYztcclxuXHJcbiAgICAgIGNvbnN0IG5ld09wOiBPdXRQdCA9IG5ldyBPdXRQdChpcCwgbmV3T3V0UmVjKTtcclxuICAgICAgbmV3T3AucHJldiA9IHNwbGl0T3AubmV4dCE7XHJcbiAgICAgIG5ld09wLm5leHQgPSBzcGxpdE9wO1xyXG4gICAgICBuZXdPdXRSZWMucHRzID0gbmV3T3A7XHJcbiAgICAgIHNwbGl0T3AucHJldiA9IG5ld09wO1xyXG4gICAgICBzcGxpdE9wLm5leHQhLm5leHQgPSBuZXdPcDtcclxuXHJcbiAgICAgIGlmICh0aGlzLl91c2luZ19wb2x5dHJlZSkge1xyXG4gICAgICAgIGlmIChDbGlwcGVyQmFzZS5wYXRoMUluc2lkZVBhdGgyKHByZXZPcCwgbmV3T3ApKSB7XHJcbiAgICAgICAgICBuZXdPdXRSZWMuc3BsaXRzID0gbmV3T3V0UmVjLnNwbGl0cyB8fCBbXTtcclxuICAgICAgICAgIG5ld091dFJlYy5zcGxpdHMucHVzaChvdXRyZWMuaWR4KTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgb3V0cmVjLnNwbGl0cyA9IG91dHJlYy5zcGxpdHMgfHwgW107XHJcbiAgICAgICAgICBvdXRyZWMuc3BsaXRzLnB1c2gobmV3T3V0UmVjLmlkeCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICAvLyBlbHNlIHsgc3BsaXRPcCA9IHVuZGVmaW5lZDsgc3BsaXRPcC5uZXh0ID0gdW5kZWZpbmVkOyB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZpeFNlbGZJbnRlcnNlY3RzKG91dHJlYzogT3V0UmVjKTogdm9pZCB7XHJcbiAgICBsZXQgb3AyOiBPdXRQdCA9IG91dHJlYy5wdHMhO1xyXG4gICAgZm9yICg7IDspIHtcclxuICAgICAgaWYgKG9wMi5wcmV2ID09PSBvcDIubmV4dCEubmV4dCkgYnJlYWs7XHJcbiAgICAgIGlmIChJbnRlcm5hbENsaXBwZXIuc2Vnc0ludGVyc2VjdChvcDIucHJldi5wdCwgb3AyLnB0LCBvcDIubmV4dCEucHQsIG9wMi5uZXh0IS5uZXh0IS5wdCkpIHtcclxuICAgICAgICB0aGlzLmRvU3BsaXRPcChvdXRyZWMsIG9wMik7XHJcbiAgICAgICAgaWYgKCFvdXRyZWMucHRzKSByZXR1cm47XHJcbiAgICAgICAgb3AyID0gb3V0cmVjLnB0cztcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBvcDIgPSBvcDIubmV4dCE7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG9wMiA9PT0gb3V0cmVjLnB0cykgYnJlYWs7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBzdGF0aWMgYnVpbGRQYXRoKG9wOiBPdXRQdCB8IHVuZGVmaW5lZCwgcmV2ZXJzZTogYm9vbGVhbiwgaXNPcGVuOiBib29sZWFuLCBwYXRoOiBQYXRoNjQpOiBib29sZWFuIHtcclxuICAgIGlmIChvcCA9PT0gdW5kZWZpbmVkIHx8IG9wLm5leHQgPT09IG9wIHx8ICghaXNPcGVuICYmIG9wLm5leHQgPT09IG9wLnByZXYpKSByZXR1cm4gZmFsc2U7XHJcbiAgICBwYXRoLmxlbmd0aCA9IDBcclxuXHJcbiAgICBsZXQgbGFzdFB0OiBJUG9pbnQ2NDtcclxuICAgIGxldCBvcDI6IE91dFB0O1xyXG4gICAgaWYgKHJldmVyc2UpIHtcclxuICAgICAgbGFzdFB0ID0gb3AucHQ7XHJcbiAgICAgIG9wMiA9IG9wLnByZXY7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBvcCA9IG9wLm5leHQhO1xyXG4gICAgICBsYXN0UHQgPSBvcC5wdDtcclxuICAgICAgb3AyID0gb3AubmV4dCE7XHJcbiAgICB9XHJcbiAgICBwYXRoLnB1c2gobGFzdFB0KTtcclxuXHJcbiAgICB3aGlsZSAob3AyICE9PSBvcCkge1xyXG4gICAgICBpZiAob3AyLnB0ICE9PSBsYXN0UHQpIHtcclxuICAgICAgICBsYXN0UHQgPSBvcDIucHQ7XHJcbiAgICAgICAgcGF0aC5wdXNoKGxhc3RQdCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHJldmVyc2UpIHtcclxuICAgICAgICBvcDIgPSBvcDIucHJldjtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBvcDIgPSBvcDIubmV4dCE7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAocGF0aC5sZW5ndGggPT09IDMgJiYgdGhpcy5pc1ZlcnlTbWFsbFRyaWFuZ2xlKG9wMikpIHJldHVybiBmYWxzZTtcclxuICAgIGVsc2UgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgYnVpbGRQYXRocyhzb2x1dGlvbkNsb3NlZDogUGF0aHM2NCwgc29sdXRpb25PcGVuOiBQYXRoczY0KTogYm9vbGVhbiB7XHJcbiAgICBzb2x1dGlvbkNsb3NlZC5sZW5ndGggPSAwXHJcbiAgICBzb2x1dGlvbk9wZW4ubGVuZ3RoID0gMFxyXG5cclxuICAgIGxldCBpID0gMDtcclxuICAgIHdoaWxlIChpIDwgdGhpcy5fb3V0cmVjTGlzdC5sZW5ndGgpIHtcclxuICAgICAgY29uc3Qgb3V0cmVjID0gdGhpcy5fb3V0cmVjTGlzdFtpKytdO1xyXG4gICAgICBpZiAoIW91dHJlYy5wdHMpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgY29uc3QgcGF0aCA9IG5ldyBQYXRoNjQoKTtcclxuICAgICAgaWYgKG91dHJlYy5pc09wZW4pIHtcclxuICAgICAgICBpZiAoQ2xpcHBlckJhc2UuYnVpbGRQYXRoKG91dHJlYy5wdHMsIHRoaXMucmV2ZXJzZVNvbHV0aW9uLCB0cnVlLCBwYXRoKSkge1xyXG4gICAgICAgICAgc29sdXRpb25PcGVuLnB1c2gocGF0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMuY2xlYW5Db2xsaW5lYXIob3V0cmVjKTtcclxuICAgICAgICAvLyBjbG9zZWQgcGF0aHMgc2hvdWxkIGFsd2F5cyByZXR1cm4gYSBQb3NpdGl2ZSBvcmllbnRhdGlvblxyXG4gICAgICAgIC8vIGV4Y2VwdCB3aGVuIHJldmVyc2VTb2x1dGlvbiA9PSB0cnVlXHJcbiAgICAgICAgaWYgKENsaXBwZXJCYXNlLmJ1aWxkUGF0aChvdXRyZWMucHRzLCB0aGlzLnJldmVyc2VTb2x1dGlvbiwgZmFsc2UsIHBhdGgpKSB7XHJcbiAgICAgICAgICBzb2x1dGlvbkNsb3NlZC5wdXNoKHBhdGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBnZXRCb3VuZHNQYXRoKHBhdGg6IFBhdGg2NCk6IFJlY3Q2NCB7XHJcbiAgICBpZiAocGF0aC5sZW5ndGggPT09IDApIHJldHVybiBuZXcgUmVjdDY0KCk7XHJcbiAgICBjb25zdCByZXN1bHQgPSBDbGlwcGVyLkludmFsaWRSZWN0NjQ7XHJcbiAgICBmb3IgKGNvbnN0IHB0IG9mIHBhdGgpIHtcclxuICAgICAgaWYgKHB0LnggPCByZXN1bHQubGVmdCkgcmVzdWx0LmxlZnQgPSBwdC54O1xyXG4gICAgICBpZiAocHQueCA+IHJlc3VsdC5yaWdodCkgcmVzdWx0LnJpZ2h0ID0gcHQueDtcclxuICAgICAgaWYgKHB0LnkgPCByZXN1bHQudG9wKSByZXN1bHQudG9wID0gcHQueTtcclxuICAgICAgaWYgKHB0LnkgPiByZXN1bHQuYm90dG9tKSByZXN1bHQuYm90dG9tID0gcHQueTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNoZWNrQm91bmRzKG91dHJlYzogT3V0UmVjKTogYm9vbGVhbiB7XHJcbiAgICBpZiAob3V0cmVjLnB0cyA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoIW91dHJlYy5ib3VuZHMuaXNFbXB0eSgpKSByZXR1cm4gdHJ1ZTtcclxuICAgIHRoaXMuY2xlYW5Db2xsaW5lYXIob3V0cmVjKTtcclxuICAgIGlmIChvdXRyZWMucHRzID09PSB1bmRlZmluZWQgfHwgIUNsaXBwZXJCYXNlLmJ1aWxkUGF0aChvdXRyZWMucHRzLCB0aGlzLnJldmVyc2VTb2x1dGlvbiwgZmFsc2UsIG91dHJlYy5wYXRoKSlcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgb3V0cmVjLmJvdW5kcyA9IENsaXBwZXJCYXNlLmdldEJvdW5kc1BhdGgob3V0cmVjLnBhdGgpO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGNoZWNrU3BsaXRPd25lcihvdXRyZWM6IE91dFJlYywgc3BsaXRzOiBudW1iZXJbXSB8IHVuZGVmaW5lZCk6IGJvb2xlYW4ge1xyXG4gICAgZm9yIChjb25zdCBpIG9mIHNwbGl0cyEpIHtcclxuICAgICAgY29uc3Qgc3BsaXQ6IE91dFJlYyB8IHVuZGVmaW5lZCA9IENsaXBwZXJCYXNlLmdldFJlYWxPdXRSZWModGhpcy5fb3V0cmVjTGlzdFtpXSk7XHJcbiAgICAgIGlmIChzcGxpdCA9PT0gdW5kZWZpbmVkIHx8IHNwbGl0ID09PSBvdXRyZWMgfHwgc3BsaXQucmVjdXJzaXZlU3BsaXQgPT09IG91dHJlYykgY29udGludWU7XHJcbiAgICAgIHNwbGl0LnJlY3Vyc2l2ZVNwbGl0ID0gb3V0cmVjOyAvLyM1OTlcclxuICAgICAgaWYgKHNwbGl0IS5zcGxpdHMgIT09IHVuZGVmaW5lZCAmJiB0aGlzLmNoZWNrU3BsaXRPd25lcihvdXRyZWMsIHNwbGl0LnNwbGl0cykpIHJldHVybiB0cnVlO1xyXG4gICAgICBpZiAoQ2xpcHBlckJhc2UuaXNWYWxpZE93bmVyKG91dHJlYywgc3BsaXQpICYmXHJcbiAgICAgICAgdGhpcy5jaGVja0JvdW5kcyhzcGxpdCkgJiZcclxuICAgICAgICBzcGxpdC5ib3VuZHMuY29udGFpbnNSZWN0KG91dHJlYy5ib3VuZHMpICYmXHJcbiAgICAgICAgQ2xpcHBlckJhc2UucGF0aDFJbnNpZGVQYXRoMihvdXRyZWMucHRzISwgc3BsaXQucHRzISkpIHtcclxuICAgICAgICBvdXRyZWMub3duZXIgPSBzcGxpdDsgLy9mb3VuZCBpbiBzcGxpdFxyXG4gICAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlY3Vyc2l2ZUNoZWNrT3duZXJzKG91dHJlYzogT3V0UmVjLCBwb2x5cGF0aDogUG9seVBhdGhCYXNlKTogdm9pZCB7XHJcbiAgICAvLyBwcmUtY29uZGl0aW9uOiBvdXRyZWMgd2lsbCBoYXZlIHZhbGlkIGJvdW5kc1xyXG4gICAgLy8gcG9zdC1jb25kaXRpb246IGlmIGEgdmFsaWQgcGF0aCwgb3V0cmVjIHdpbGwgaGF2ZSBhIHBvbHlwYXRoXHJcblxyXG4gICAgaWYgKG91dHJlYy5wb2x5cGF0aCAhPT0gdW5kZWZpbmVkIHx8IG91dHJlYy5ib3VuZHMuaXNFbXB0eSgpKSByZXR1cm47XHJcblxyXG4gICAgd2hpbGUgKG91dHJlYy5vd25lciAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIGlmIChvdXRyZWMub3duZXIuc3BsaXRzICE9PSB1bmRlZmluZWQgJiZcclxuICAgICAgICB0aGlzLmNoZWNrU3BsaXRPd25lcihvdXRyZWMsIG91dHJlYy5vd25lci5zcGxpdHMpKSBicmVhaztcclxuICAgICAgZWxzZSBpZiAob3V0cmVjLm93bmVyLnB0cyAhPT0gdW5kZWZpbmVkICYmIHRoaXMuY2hlY2tCb3VuZHMob3V0cmVjLm93bmVyKSAmJlxyXG4gICAgICAgIENsaXBwZXJCYXNlLnBhdGgxSW5zaWRlUGF0aDIob3V0cmVjLnB0cyEsIG91dHJlYy5vd25lci5wdHMhKSkgYnJlYWs7XHJcbiAgICAgIG91dHJlYy5vd25lciA9IG91dHJlYy5vd25lci5vd25lcjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAob3V0cmVjLm93bmVyICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgaWYgKG91dHJlYy5vd25lci5wb2x5cGF0aCA9PT0gdW5kZWZpbmVkKVxyXG4gICAgICAgIHRoaXMucmVjdXJzaXZlQ2hlY2tPd25lcnMob3V0cmVjLm93bmVyLCBwb2x5cGF0aCk7XHJcbiAgICAgIG91dHJlYy5wb2x5cGF0aCA9IG91dHJlYy5vd25lci5wb2x5cGF0aCEuYWRkQ2hpbGQob3V0cmVjLnBhdGgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgb3V0cmVjLnBvbHlwYXRoID0gcG9seXBhdGguYWRkQ2hpbGQob3V0cmVjLnBhdGgpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIGJ1aWxkVHJlZShwb2x5dHJlZTogUG9seVBhdGhCYXNlLCBzb2x1dGlvbk9wZW46IFBhdGhzNjQpOiB2b2lkIHtcclxuICAgIHBvbHl0cmVlLmNsZWFyKCk7XHJcbiAgICBzb2x1dGlvbk9wZW4ubGVuZ3RoID0gMFxyXG5cclxuICAgIGxldCBpID0gMDtcclxuICAgIHdoaWxlIChpIDwgdGhpcy5fb3V0cmVjTGlzdC5sZW5ndGgpIHtcclxuICAgICAgY29uc3Qgb3V0cmVjOiBPdXRSZWMgPSB0aGlzLl9vdXRyZWNMaXN0W2krK107XHJcbiAgICAgIGlmIChvdXRyZWMucHRzID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgaWYgKG91dHJlYy5pc09wZW4pIHtcclxuICAgICAgICBjb25zdCBvcGVuX3BhdGggPSBuZXcgUGF0aDY0KCk7XHJcbiAgICAgICAgaWYgKENsaXBwZXJCYXNlLmJ1aWxkUGF0aChvdXRyZWMucHRzLCB0aGlzLnJldmVyc2VTb2x1dGlvbiwgdHJ1ZSwgb3Blbl9wYXRoKSlcclxuICAgICAgICAgIHNvbHV0aW9uT3Blbi5wdXNoKG9wZW5fcGF0aCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHRoaXMuY2hlY2tCb3VuZHMob3V0cmVjKSlcclxuICAgICAgICB0aGlzLnJlY3Vyc2l2ZUNoZWNrT3duZXJzKG91dHJlYywgcG9seXRyZWUpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHVibGljIGdldEJvdW5kcygpOiBSZWN0NjQge1xyXG4gICAgY29uc3QgYm91bmRzID0gQ2xpcHBlci5JbnZhbGlkUmVjdDY0O1xyXG4gICAgZm9yIChjb25zdCB0IG9mIHRoaXMuX3ZlcnRleExpc3QpIHtcclxuICAgICAgbGV0IHYgPSB0O1xyXG4gICAgICBkbyB7XHJcbiAgICAgICAgaWYgKHYucHQueCA8IGJvdW5kcy5sZWZ0KSBib3VuZHMubGVmdCA9IHYucHQueDtcclxuICAgICAgICBpZiAodi5wdC54ID4gYm91bmRzLnJpZ2h0KSBib3VuZHMucmlnaHQgPSB2LnB0Lng7XHJcbiAgICAgICAgaWYgKHYucHQueSA8IGJvdW5kcy50b3ApIGJvdW5kcy50b3AgPSB2LnB0Lnk7XHJcbiAgICAgICAgaWYgKHYucHQueSA+IGJvdW5kcy5ib3R0b20pIGJvdW5kcy5ib3R0b20gPSB2LnB0Lnk7XHJcbiAgICAgICAgdiA9IHYubmV4dCE7XHJcbiAgICAgIH0gd2hpbGUgKHYgIT09IHQpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGJvdW5kcy5pc0VtcHR5KCkgPyBuZXcgUmVjdDY0KDAsIDAsIDAsIDApIDogYm91bmRzO1xyXG4gIH1cclxuXHJcbn1cclxuXHJcblxyXG5leHBvcnQgY2xhc3MgQ2xpcHBlcjY0IGV4dGVuZHMgQ2xpcHBlckJhc2Uge1xyXG5cclxuICBvdmVycmlkZSBhZGRQYXRoKHBhdGg6IFBhdGg2NCwgcG9seXR5cGU6IFBhdGhUeXBlLCBpc09wZW46IGJvb2xlYW4gPSBmYWxzZSk6IHZvaWQge1xyXG4gICAgc3VwZXIuYWRkUGF0aChwYXRoLCBwb2x5dHlwZSwgaXNPcGVuKTtcclxuICB9XHJcblxyXG4gIGFkZFJldXNhYmxlRGF0YShyZXVzYWJsZURhdGE6IFJldXNlYWJsZURhdGFDb250YWluZXI2NCk6IHZvaWQge1xyXG4gICAgc3VwZXIuYWRkUmV1c2VhYmxlRGF0YShyZXVzYWJsZURhdGEpO1xyXG4gIH1cclxuXHJcbiAgb3ZlcnJpZGUgYWRkUGF0aHMocGF0aHM6IFBhdGhzNjQsIHBvbHl0eXBlOiBQYXRoVHlwZSwgaXNPcGVuOiBib29sZWFuID0gZmFsc2UpOiB2b2lkIHtcclxuICAgIHN1cGVyLmFkZFBhdGhzKHBhdGhzLCBwb2x5dHlwZSwgaXNPcGVuKTtcclxuICB9XHJcblxyXG4gIGFkZFN1YmplY3RQYXRocyhwYXRoczogUGF0aHM2NCk6IHZvaWQge1xyXG4gICAgdGhpcy5hZGRQYXRocyhwYXRocywgUGF0aFR5cGUuU3ViamVjdCk7XHJcbiAgfVxyXG5cclxuICBhZGRPcGVuU3ViamVjdFBhdGhzKHBhdGhzOiBQYXRoczY0KTogdm9pZCB7XHJcbiAgICB0aGlzLmFkZFBhdGhzKHBhdGhzLCBQYXRoVHlwZS5TdWJqZWN0LCB0cnVlKTtcclxuICB9XHJcblxyXG4gIGFkZENsaXBQYXRocyhwYXRoczogUGF0aHM2NCk6IHZvaWQge1xyXG4gICAgdGhpcy5hZGRQYXRocyhwYXRocywgUGF0aFR5cGUuQ2xpcCk7XHJcbiAgfVxyXG5cclxuICBleGVjdXRlKGNsaXBUeXBlOiBDbGlwVHlwZSwgZmlsbFJ1bGU6IEZpbGxSdWxlLCBzb2x1dGlvbkNsb3NlZDogUGF0aHM2NCwgc29sdXRpb25PcGVuID0gbmV3IFBhdGhzNjQoKSk6IGJvb2xlYW4ge1xyXG4gICAgc29sdXRpb25DbG9zZWQubGVuZ3RoID0gMFxyXG4gICAgc29sdXRpb25PcGVuLmxlbmd0aCA9IDBcclxuICAgIHRyeSB7XHJcbiAgICAgIHRoaXMuZXhlY3V0ZUludGVybmFsKGNsaXBUeXBlLCBmaWxsUnVsZSk7XHJcbiAgICAgIHRoaXMuYnVpbGRQYXRocyhzb2x1dGlvbkNsb3NlZCwgc29sdXRpb25PcGVuKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIHRoaXMuX3N1Y2NlZWRlZCA9IGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuY2xlYXJTb2x1dGlvbk9ubHkoKTtcclxuICAgIHJldHVybiB0aGlzLl9zdWNjZWVkZWQ7XHJcbiAgfVxyXG5cclxuXHJcbiAgZXhlY3V0ZVBvbHlUcmVlKGNsaXBUeXBlOiBDbGlwVHlwZSwgZmlsbFJ1bGU6IEZpbGxSdWxlLCBwb2x5dHJlZTogUG9seVRyZWU2NCwgb3BlblBhdGhzID0gbmV3IFBhdGhzNjQoKSk6IGJvb2xlYW4ge1xyXG4gICAgcG9seXRyZWUuY2xlYXIoKTtcclxuICAgIG9wZW5QYXRocy5sZW5ndGggPSAwXHJcbiAgICB0aGlzLl91c2luZ19wb2x5dHJlZSA9IHRydWU7XHJcbiAgICB0cnkge1xyXG4gICAgICB0aGlzLmV4ZWN1dGVJbnRlcm5hbChjbGlwVHlwZSwgZmlsbFJ1bGUpO1xyXG4gICAgICB0aGlzLmJ1aWxkVHJlZShwb2x5dHJlZSwgb3BlblBhdGhzKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIHRoaXMuX3N1Y2NlZWRlZCA9IGZhbHNlO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuY2xlYXJTb2x1dGlvbk9ubHkoKTtcclxuICAgIHJldHVybiB0aGlzLl9zdWNjZWVkZWQ7XHJcbiAgfVxyXG5cclxufVxyXG5cclxuZXhwb3J0IGFic3RyYWN0IGNsYXNzIFBvbHlQYXRoQmFzZSB7XHJcbiAgcHJvdGVjdGVkIF9wYXJlbnQ/OiBQb2x5UGF0aEJhc2U7XHJcbiAgY2hpbGRyZW46IEFycmF5PFBvbHlQYXRoQmFzZT4gPSBbXTtcclxuICBwdWJsaWMgcG9seWdvbj86IFBhdGg2NDtcclxuXHJcbiAgZ2V0IGlzSG9sZSgpOiBib29sZWFuIHtcclxuICAgIHJldHVybiB0aGlzLmdldElzSG9sZSgpO1xyXG4gIH1cclxuXHJcbiAgY29uc3RydWN0b3IocGFyZW50PzogUG9seVBhdGhCYXNlKSB7XHJcbiAgICB0aGlzLl9wYXJlbnQgPSBwYXJlbnQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldExldmVsKCk6IG51bWJlciB7XHJcbiAgICBsZXQgcmVzdWx0ID0gMDtcclxuICAgIGxldCBwcDogUG9seVBhdGhCYXNlIHwgdW5kZWZpbmVkID0gdGhpcy5fcGFyZW50O1xyXG4gICAgd2hpbGUgKHBwICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgKytyZXN1bHQ7XHJcbiAgICAgIHBwID0gcHAuX3BhcmVudDtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBnZXQgbGV2ZWwoKTogbnVtYmVyIHtcclxuICAgIHJldHVybiB0aGlzLmdldExldmVsKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldElzSG9sZSgpOiBib29sZWFuIHtcclxuICAgIGNvbnN0IGx2bCA9IHRoaXMuZ2V0TGV2ZWwoKTtcclxuICAgIHJldHVybiBsdmwgIT09IDAgJiYgKGx2bCAmIDEpID09PSAwO1xyXG4gIH1cclxuXHJcbiAgZ2V0IGNvdW50KCk6IG51bWJlciB7XHJcbiAgICByZXR1cm4gdGhpcy5jaGlsZHJlbi5sZW5ndGg7XHJcbiAgfVxyXG5cclxuICBhYnN0cmFjdCBhZGRDaGlsZChwOiBQYXRoNjQpOiBQb2x5UGF0aEJhc2U7XHJcblxyXG4gIGNsZWFyKCk6IHZvaWQge1xyXG4gICAgdGhpcy5jaGlsZHJlbi5sZW5ndGggPSAwXHJcbiAgfVxyXG5cclxuICBmb3JFYWNoID0gdGhpcy5jaGlsZHJlbi5mb3JFYWNoXHJcblxyXG4gIHByaXZhdGUgdG9TdHJpbmdJbnRlcm5hbChpZHg6IG51bWJlciwgbGV2ZWw6IG51bWJlcik6IHN0cmluZyB7XHJcbiAgICBsZXQgcmVzdWx0ID0gXCJcIiwgcGFkZGluZyA9IFwiXCIsIHBsdXJhbCA9IFwic1wiO1xyXG4gICAgaWYgKHRoaXMuY2hpbGRyZW4ubGVuZ3RoID09PSAxKSBwbHVyYWwgPSBcIlwiO1xyXG4gICAgcGFkZGluZyA9IHBhZGRpbmcucGFkU3RhcnQobGV2ZWwgKiAyKTtcclxuICAgIGlmICgobGV2ZWwgJiAxKSA9PT0gMClcclxuICAgICAgcmVzdWx0ICs9IGAke3BhZGRpbmd9Ky0gaG9sZSAoJHtpZHh9KSBjb250YWlucyAke3RoaXMuY2hpbGRyZW4ubGVuZ3RofSBuZXN0ZWQgcG9seWdvbiR7cGx1cmFsfS5cXG5gO1xyXG4gICAgZWxzZVxyXG4gICAgICByZXN1bHQgKz0gYCR7cGFkZGluZ30rLSBwb2x5Z29uICgke2lkeH0pIGNvbnRhaW5zICR7dGhpcy5jaGlsZHJlbi5sZW5ndGh9IGhvbGUke3BsdXJhbH0uXFxuYDtcclxuXHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuY2hpbGRyZW4ubGVuZ3RoOyBpKyspXHJcbiAgICAgIGlmICh0aGlzLmNoaWxkcmVuW2ldLmNoaWxkcmVuLmxlbmd0aCA+IDApXHJcbiAgICAgICAgcmVzdWx0ICs9IHRoaXMuY2hpbGRyZW5baV0udG9TdHJpbmdJbnRlcm5hbChpLCBsZXZlbCArIDEpO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHRvU3RyaW5nKCk6IHN0cmluZyB7XHJcbiAgICBpZiAodGhpcy5sZXZlbCA+IDApIHJldHVybiBcIlwiOyAvL29ubHkgYWNjZXB0IHRyZWUgcm9vdCBcclxuICAgIGxldCBwbHVyYWwgPSBcInNcIjtcclxuICAgIGlmICh0aGlzLmNoaWxkcmVuLmxlbmd0aCA9PT0gMSkgcGx1cmFsID0gXCJcIjtcclxuICAgIGxldCByZXN1bHQgPSBgUG9seXRyZWUgd2l0aCAke3RoaXMuY2hpbGRyZW4ubGVuZ3RofSBwb2x5Z29uJHtwbHVyYWx9LlxcbmA7XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IHRoaXMuY2hpbGRyZW4ubGVuZ3RoOyBpKyspXHJcbiAgICAgIGlmICh0aGlzLmNoaWxkcmVuW2ldLmNoaWxkcmVuLmxlbmd0aCA+IDApXHJcbiAgICAgICAgcmVzdWx0ICs9IHRoaXMuY2hpbGRyZW5baV0udG9TdHJpbmdJbnRlcm5hbChpLCAxKTtcclxuICAgIHJldHVybiByZXN1bHQgKyAnXFxuJztcclxuICB9XHJcblxyXG59IC8vIGVuZCBvZiBQb2x5UGF0aEJhc2UgY2xhc3NcclxuXHJcbmV4cG9ydCBjbGFzcyBQb2x5UGF0aDY0IGV4dGVuZHMgUG9seVBhdGhCYXNlIHtcclxuXHJcbiAgY29uc3RydWN0b3IocGFyZW50PzogUG9seVBhdGhCYXNlKSB7XHJcbiAgICBzdXBlcihwYXJlbnQpO1xyXG4gIH1cclxuXHJcbiAgYWRkQ2hpbGQocDogUGF0aDY0KTogUG9seVBhdGhCYXNlIHtcclxuICAgIGNvbnN0IG5ld0NoaWxkID0gbmV3IFBvbHlQYXRoNjQodGhpcyk7XHJcbiAgICAobmV3Q2hpbGQgYXMgUG9seVBhdGg2NCkucG9seWdvbiA9IHA7XHJcbiAgICB0aGlzLmNoaWxkcmVuLnB1c2gobmV3Q2hpbGQpO1xyXG4gICAgcmV0dXJuIG5ld0NoaWxkO1xyXG4gIH1cclxuXHJcbiAgZ2V0KGluZGV4OiBudW1iZXIpOiBQb2x5UGF0aDY0IHtcclxuICAgIGlmIChpbmRleCA8IDAgfHwgaW5kZXggPj0gdGhpcy5jaGlsZHJlbi5sZW5ndGgpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZE9wZXJhdGlvbkV4Y2VwdGlvblwiKTtcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLmNoaWxkcmVuW2luZGV4XSBhcyBQb2x5UGF0aDY0O1xyXG4gIH1cclxuXHJcbiAgY2hpbGQoaW5kZXg6IG51bWJlcik6IFBvbHlQYXRoNjQge1xyXG4gICAgaWYgKGluZGV4IDwgMCB8fCBpbmRleCA+PSB0aGlzLmNoaWxkcmVuLmxlbmd0aCkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkT3BlcmF0aW9uRXhjZXB0aW9uXCIpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMuY2hpbGRyZW5baW5kZXhdIGFzIFBvbHlQYXRoNjQ7XHJcbiAgfVxyXG5cclxuICBhcmVhKCk6IG51bWJlciB7XHJcbiAgICBsZXQgcmVzdWx0ID0gdGhpcy5wb2x5Z29uID8gQ2xpcHBlci5hcmVhKHRoaXMucG9seWdvbikgOiAwO1xyXG4gICAgZm9yIChjb25zdCBwb2x5UGF0aEJhc2Ugb2YgdGhpcy5jaGlsZHJlbikge1xyXG4gICAgICBjb25zdCBjaGlsZCA9IHBvbHlQYXRoQmFzZSBhcyBQb2x5UGF0aDY0O1xyXG4gICAgICByZXN1bHQgKz0gY2hpbGQuYXJlYSgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcbn1cclxuXHJcblxyXG5leHBvcnQgY2xhc3MgUG9seVRyZWU2NCBleHRlbmRzIFBvbHlQYXRoNjQgeyB9XHJcblxyXG5cclxuZXhwb3J0IGNsYXNzIENsaXBwZXJMaWJFeGNlcHRpb24gZXh0ZW5kcyBFcnJvciB7XHJcbiAgY29uc3RydWN0b3IoZGVzY3JpcHRpb246IHN0cmluZykge1xyXG4gICAgc3VwZXIoZGVzY3JpcHRpb24pO1xyXG4gIH1cclxufVxyXG4iXX0=