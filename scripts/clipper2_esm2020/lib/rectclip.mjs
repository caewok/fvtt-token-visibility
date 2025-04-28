/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  8 September 2023                                                  *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2023                                         *
* Purpose   :  FAST rectangular clipping                                       *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
//
// Converted from C# implemention https://github.com/AngusJohnson/Clipper2/blob/main/CSharp/Clipper2Lib/Clipper.Core.cs
// Removed support for USINGZ
//
// Converted by ChatGPT 4 August 3 version https://help.openai.com/en/articles/6825453-chatgpt-release-notes
//
import { Clipper } from "./clipper.mjs";
import { InternalClipper, Path64, Paths64, Point64 } from "./core.mjs";
import { PointInPolygonResult } from "./engine.mjs";
export class OutPt2 {
    constructor(pt) {
        this.pt = pt;
        this.ownerIdx = 0;
    }
}
var Location;
(function (Location) {
    Location[Location["left"] = 0] = "left";
    Location[Location["top"] = 1] = "top";
    Location[Location["right"] = 2] = "right";
    Location[Location["bottom"] = 3] = "bottom";
    Location[Location["inside"] = 4] = "inside";
})(Location || (Location = {}));
export class RectClip64 {
    constructor(rect) {
        this.currIdx = -1;
        this.rect = rect;
        this.mp = rect.midPoint();
        this.rectPath = rect.asPath();
        this.results = [];
        this.edges = Array(8).fill(undefined).map(() => []);
    }
    add(pt, startingNewPath = false) {
        let currIdx = this.results.length;
        let result;
        if (currIdx === 0 || startingNewPath) {
            result = new OutPt2(pt);
            this.results.push(result);
            result.ownerIdx = currIdx;
            result.prev = result;
            result.next = result;
        }
        else {
            currIdx--;
            const prevOp = this.results[currIdx];
            if (prevOp.pt === pt)
                return prevOp;
            result = new OutPt2(pt);
            result.ownerIdx = currIdx;
            result.next = prevOp.next;
            prevOp.next.prev = result;
            prevOp.next = result;
            result.prev = prevOp;
            this.results[currIdx] = result;
        }
        return result;
    }
    static path1ContainsPath2(path1, path2) {
        let ioCount = 0;
        for (const pt of path2) {
            const pip = InternalClipper.pointInPolygon(pt, path1);
            switch (pip) {
                case PointInPolygonResult.IsInside:
                    ioCount--;
                    break;
                case PointInPolygonResult.IsOutside:
                    ioCount++;
                    break;
            }
            if (Math.abs(ioCount) > 1)
                break;
        }
        return ioCount <= 0;
    }
    static isClockwise(prev, curr, prevPt, currPt, rectMidPoint) {
        if (this.areOpposites(prev, curr))
            return InternalClipper.crossProduct(prevPt, rectMidPoint, currPt) < 0;
        else
            return this.headingClockwise(prev, curr);
    }
    static areOpposites(prev, curr) {
        return Math.abs(prev - curr) === 2;
    }
    static headingClockwise(prev, curr) {
        return (prev + 1) % 4 === curr;
    }
    static getAdjacentLocation(loc, isClockwise) {
        const delta = isClockwise ? 1 : 3;
        return (loc + delta) % 4;
    }
    static unlinkOp(op) {
        if (op.next === op)
            return undefined;
        op.prev.next = op.next;
        op.next.prev = op.prev;
        return op.next;
    }
    static unlinkOpBack(op) {
        if (op.next === op)
            return undefined;
        op.prev.next = op.next;
        op.next.prev = op.prev;
        return op.prev;
    }
    static getEdgesForPt(pt, rec) {
        let result = 0;
        if (pt.x === rec.left)
            result = 1;
        else if (pt.x === rec.right)
            result = 4;
        if (pt.y === rec.top)
            result += 2;
        else if (pt.y === rec.bottom)
            result += 8;
        return result;
    }
    static isHeadingClockwise(pt1, pt2, edgeIdx) {
        switch (edgeIdx) {
            case 0: return pt2.y < pt1.y;
            case 1: return pt2.x > pt1.x;
            case 2: return pt2.y > pt1.y;
            default: return pt2.x < pt1.x;
        }
    }
    static hasHorzOverlap(left1, right1, left2, right2) {
        return (left1.x < right2.x) && (right1.x > left2.x);
    }
    static hasVertOverlap(top1, bottom1, top2, bottom2) {
        return (top1.y < bottom2.y) && (bottom1.y > top2.y);
    }
    static addToEdge(edge, op) {
        if (op.edge)
            return;
        op.edge = edge;
        edge.push(op);
    }
    static uncoupleEdge(op) {
        if (!op.edge)
            return;
        for (let i = 0; i < op.edge.length; i++) {
            const op2 = op.edge[i];
            if (op2 === op) {
                op.edge[i] = undefined;
                break;
            }
        }
        op.edge = undefined;
    }
    static setNewOwner(op, newIdx) {
        op.ownerIdx = newIdx;
        let op2 = op.next;
        while (op2 !== op) {
            op2.ownerIdx = newIdx;
            op2 = op2.next;
        }
    }
    addCorner(prev, curr) {
        if (RectClip64.headingClockwise(prev, curr))
            this.add(this.rectPath[prev]);
        else
            this.add(this.rectPath[curr]);
    }
    addCornerByRef(loc, isClockwise) {
        if (isClockwise) {
            this.add(this.rectPath[loc]);
            loc = RectClip64.getAdjacentLocation(loc, true);
        }
        else {
            loc = RectClip64.getAdjacentLocation(loc, false);
            this.add(this.rectPath[loc]);
        }
    }
    static getLocation(rec, pt) {
        let loc;
        if (pt.x === rec.left && pt.y >= rec.top && pt.y <= rec.bottom) {
            loc = Location.left; // pt on rec
            return { success: false, loc };
        }
        if (pt.x === rec.right && pt.y >= rec.top && pt.y <= rec.bottom) {
            loc = Location.right; // pt on rec
            return { success: false, loc };
        }
        if (pt.y === rec.top && pt.x >= rec.left && pt.x <= rec.right) {
            loc = Location.top; // pt on rec
            return { success: false, loc };
        }
        if (pt.y === rec.bottom && pt.x >= rec.left && pt.x <= rec.right) {
            loc = Location.bottom; // pt on rec
            return { success: false, loc };
        }
        if (pt.x < rec.left)
            loc = Location.left;
        else if (pt.x > rec.right)
            loc = Location.right;
        else if (pt.y < rec.top)
            loc = Location.top;
        else if (pt.y > rec.bottom)
            loc = Location.bottom;
        else
            loc = Location.inside;
        return { success: true, loc };
    }
    static isHorizontal(pt1, pt2) {
        return pt1.y == pt2.y;
    }
    static getSegmentIntersection(p1, p2, p3, p4) {
        let res1 = InternalClipper.crossProduct(p1, p3, p4);
        let res2 = InternalClipper.crossProduct(p2, p3, p4);
        let ip = new Point64(0, 0);
        const equals = (lhs, rhs) => {
            return lhs.x === rhs.x && lhs.y === rhs.y;
        };
        if (res1 === 0) {
            ip = p1;
            if (res2 === 0)
                return { ip, success: false };
            else if (equals(p1, p3) || equals(p1, p4))
                return { ip, success: true };
            else if (RectClip64.isHorizontal(p3, p4))
                return { ip, success: ((p1.x > p3.x) === (p1.x < p4.x)) };
            else
                return { ip, success: ((p1.y > p3.y) === (p1.y < p4.y)) };
        }
        else if (res2 === 0) {
            ip = p2;
            if (equals(p2, p3) || equals(p2, p4))
                return { ip, success: true };
            else if (RectClip64.isHorizontal(p3, p4))
                return { ip, success: ((p2.x > p3.x) === (p2.x < p4.x)) };
            else
                return { ip, success: ((p2.y > p3.y) === (p2.y < p4.y)) };
        }
        if ((res1 > 0) === (res2 > 0))
            return { ip: new Point64(0, 0), success: false };
        let res3 = InternalClipper.crossProduct(p3, p1, p2);
        let res4 = InternalClipper.crossProduct(p4, p1, p2);
        if (res3 === 0) {
            ip = p3;
            if (equals(p3, p1) || equals(p3, p2))
                return { ip, success: true };
            else if (RectClip64.isHorizontal(p1, p2))
                return { ip, success: ((p3.x > p1.x) === (p3.x < p2.x)) };
            else
                return { ip, success: ((p3.y > p1.y) === (p3.y < p2.y)) };
        }
        else if (res4 === 0) {
            ip = p4;
            if (equals(p4, p1) || equals(p4, p2))
                return { ip, success: true };
            else if (RectClip64.isHorizontal(p1, p2))
                return { ip, success: ((p4.x > p1.x) === (p4.x < p2.x)) };
            else
                return { ip, success: ((p4.y > p1.y) === (p4.y < p2.y)) };
        }
        if ((res3 > 0) === (res4 > 0))
            return { ip: new Point64(0, 0), success: false };
        return InternalClipper.getIntersectPoint(p1, p2, p3, p4);
    }
    static getIntersection(rectPath, p, p2, loc) {
        // gets the pt of intersection between rectPath and segment(p, p2) that's closest to 'p'
        // when result == false, loc will remain unchanged
        let ip = new Point64();
        let result;
        switch (loc) {
            case Location.left:
                if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[3])).success)
                    return { success: true, loc, ip: result.ip };
                else if (p.y < rectPath[0].y && (result = RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[1])).success) {
                    loc = Location.top;
                    return { success: true, loc, ip: result.ip };
                }
                else if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[2], rectPath[3])).success) {
                    loc = Location.bottom;
                    return { success: true, loc, ip: result.ip };
                }
                else
                    return { success: false, loc, ip };
            case Location.right:
                if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[1], rectPath[2])).success)
                    return { success: true, loc, ip: result.ip };
                else if (p.y < rectPath[0].y && (result = RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[1])).success) {
                    loc = Location.top;
                    return { success: true, loc, ip: result.ip };
                }
                else if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[2], rectPath[3])).success) {
                    loc = Location.bottom;
                    return { success: true, loc, ip: result.ip };
                }
                else
                    return { success: false, loc, ip };
            case Location.top:
                if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[1])).success)
                    return { success: true, loc, ip: result.ip };
                else if (p.x < rectPath[0].x && (result = RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[3])).success) {
                    loc = Location.left;
                    return { success: true, loc, ip: result.ip };
                }
                else if (p.x > rectPath[1].x && (result = RectClip64.getSegmentIntersection(p, p2, rectPath[1], rectPath[2])).success) {
                    loc = Location.right;
                    return { success: true, loc, ip: result.ip };
                }
                else
                    return { success: false, loc, ip };
            case Location.bottom:
                if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[2], rectPath[3])).success)
                    return { success: true, loc, ip: result.ip };
                else if (p.x < rectPath[3].x && (result = RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[3])).success) {
                    loc = Location.left;
                    return { success: true, loc, ip: result.ip };
                }
                else if (p.x > rectPath[2].x && (result = RectClip64.getSegmentIntersection(p, p2, rectPath[1], rectPath[2])).success) {
                    loc = Location.right;
                    return { success: true, loc, ip: result.ip };
                }
                else
                    return { success: false, loc, ip };
            default:
                if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[3])).success) {
                    loc = Location.left;
                    return { success: true, loc, ip: result.ip };
                }
                else if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[0], rectPath[1])).success) {
                    loc = Location.top;
                    return { success: true, loc, ip: result.ip };
                }
                else if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[1], rectPath[2])).success) {
                    loc = Location.right;
                    return { success: true, loc, ip: result.ip };
                }
                else if ((result = RectClip64.getSegmentIntersection(p, p2, rectPath[2], rectPath[3])).success) {
                    loc = Location.bottom;
                    return { success: true, loc, ip: result.ip };
                }
                else
                    return { success: false, loc, ip };
        }
    }
    getNextLocation(path, context) {
        switch (context.loc) {
            case Location.left:
                while (context.i <= context.highI && path[context.i].x <= this.rect.left)
                    context.i++;
                if (context.i > context.highI)
                    break;
                if (path[context.i].x >= this.rect.right)
                    context.loc = Location.right;
                else if (path[context.i].y <= this.rect.top)
                    context.loc = Location.top;
                else if (path[context.i].y >= this.rect.bottom)
                    context.loc = Location.bottom;
                else
                    context.loc = Location.inside;
                break;
            case Location.top:
                while (context.i <= context.highI && path[context.i].y <= this.rect.top)
                    context.i++;
                if (context.i > context.highI)
                    break;
                if (path[context.i].y >= this.rect.bottom)
                    context.loc = Location.bottom;
                else if (path[context.i].x <= this.rect.left)
                    context.loc = Location.left;
                else if (path[context.i].x >= this.rect.right)
                    context.loc = Location.right;
                else
                    context.loc = Location.inside;
                break;
            case Location.right:
                while (context.i <= context.highI && path[context.i].x >= this.rect.right)
                    context.i++;
                if (context.i > context.highI)
                    break;
                if (path[context.i].x <= this.rect.left)
                    context.loc = Location.left;
                else if (path[context.i].y <= this.rect.top)
                    context.loc = Location.top;
                else if (path[context.i].y >= this.rect.bottom)
                    context.loc = Location.bottom;
                else
                    context.loc = Location.inside;
                break;
            case Location.bottom:
                while (context.i <= context.highI && path[context.i].y >= this.rect.bottom)
                    context.i++;
                if (context.i > context.highI)
                    break;
                if (path[context.i].y <= this.rect.top)
                    context.loc = Location.top;
                else if (path[context.i].x <= this.rect.left)
                    context.loc = Location.left;
                else if (path[context.i].x >= this.rect.right)
                    context.loc = Location.right;
                else
                    context.loc = Location.inside;
                break;
            case Location.inside:
                while (context.i <= context.highI) {
                    if (path[context.i].x < this.rect.left)
                        context.loc = Location.left;
                    else if (path[context.i].x > this.rect.right)
                        context.loc = Location.right;
                    else if (path[context.i].y > this.rect.bottom)
                        context.loc = Location.bottom;
                    else if (path[context.i].y < this.rect.top)
                        context.loc = Location.top;
                    else {
                        this.add(path[context.i]);
                        context.i++;
                        continue;
                    }
                    break;
                }
                break;
        }
    }
    executeInternal(path) {
        if (path.length < 3 || this.rect.isEmpty())
            return;
        const startLocs = [];
        let firstCross = Location.inside;
        let crossingLoc = firstCross, prev = firstCross;
        let i;
        const highI = path.length - 1;
        let result = RectClip64.getLocation(this.rect, path[highI]);
        let loc = result.loc;
        if (!result.success) {
            i = highI - 1;
            while (i >= 0 && !result.success) {
                i--;
                result = RectClip64.getLocation(this.rect, path[i]);
                prev = result.loc;
            }
            if (i < 0) {
                for (const pt of path) {
                    this.add(pt);
                }
                return;
            }
            if (prev == Location.inside)
                loc = Location.inside;
        }
        const startingLoc = loc;
        ///////////////////////////////////////////////////
        i = 0;
        while (i <= highI) {
            prev = loc;
            const prevCrossLoc = crossingLoc;
            this.getNextLocation(path, { loc, i, highI });
            if (i > highI)
                break;
            const prevPt = (i == 0) ? path[highI] : path[i - 1];
            crossingLoc = loc;
            let result = RectClip64.getIntersection(this.rectPath, path[i], prevPt, crossingLoc);
            const ip = result.ip;
            if (!result.success) {
                if (prevCrossLoc == Location.inside) {
                    const isClockw = RectClip64.isClockwise(prev, loc, prevPt, path[i], this.mp);
                    do {
                        startLocs.push(prev);
                        prev = RectClip64.getAdjacentLocation(prev, isClockw);
                    } while (prev != loc);
                    crossingLoc = prevCrossLoc;
                }
                else if (prev != Location.inside && prev != loc) {
                    const isClockw = RectClip64.isClockwise(prev, loc, prevPt, path[i], this.mp);
                    do {
                        this.addCornerByRef(prev, isClockw);
                    } while (prev != loc);
                }
                ++i;
                continue;
            }
            ////////////////////////////////////////////////////
            // we must be crossing the rect boundary to get here
            ////////////////////////////////////////////////////
            if (loc == Location.inside) {
                if (firstCross == Location.inside) {
                    firstCross = crossingLoc;
                    startLocs.push(prev);
                }
                else if (prev != crossingLoc) {
                    const isClockw = RectClip64.isClockwise(prev, crossingLoc, prevPt, path[i], this.mp);
                    do {
                        this.addCornerByRef(prev, isClockw);
                    } while (prev != crossingLoc);
                }
            }
            else if (prev != Location.inside) {
                // passing right through rect. 'ip' here will be the second
                // intersect pt but we'll also need the first intersect pt (ip2)
                loc = prev;
                result = RectClip64.getIntersection(this.rectPath, prevPt, path[i], loc);
                const ip2 = result.ip;
                if (prevCrossLoc != Location.inside && prevCrossLoc != loc)
                    this.addCorner(prevCrossLoc, loc);
                if (firstCross == Location.inside) {
                    firstCross = loc;
                    startLocs.push(prev);
                }
                loc = crossingLoc;
                this.add(ip2);
                if (ip == ip2) {
                    loc = RectClip64.getLocation(this.rect, path[i]).loc;
                    this.addCorner(crossingLoc, loc);
                    crossingLoc = loc;
                    continue;
                }
            }
            else {
                loc = crossingLoc;
                if (firstCross == Location.inside)
                    firstCross = crossingLoc;
            }
            this.add(ip);
        } //while i <= highI
        ///////////////////////////////////////////////////
        if (firstCross == Location.inside) {
            if (startingLoc != Location.inside) {
                if (this.pathBounds.containsRect(this.rect) && RectClip64.path1ContainsPath2(path, this.rectPath)) {
                    for (let j = 0; j < 4; j++) {
                        this.add(this.rectPath[j]);
                        RectClip64.addToEdge(this.edges[j * 2], this.results[0]);
                    }
                }
            }
        }
        else if (loc != Location.inside && (loc != firstCross || startLocs.length > 2)) {
            if (startLocs.length > 0) {
                prev = loc;
                for (const loc2 of startLocs) {
                    if (prev == loc2)
                        continue;
                    this.addCornerByRef(prev, RectClip64.headingClockwise(prev, loc2));
                    prev = loc2;
                }
                loc = prev;
            }
            if (loc != firstCross)
                this.addCornerByRef(loc, RectClip64.headingClockwise(loc, firstCross));
        }
    }
    execute(paths) {
        const result = [];
        if (this.rect.isEmpty())
            return result;
        for (const path of paths) {
            if (path.length < 3)
                continue;
            this.pathBounds = Clipper.getBounds(path);
            if (!this.rect.intersects(this.pathBounds))
                continue;
            else if (this.rect.containsRect(this.pathBounds)) {
                result.push(path);
                continue;
            }
            this.executeInternal(path);
            this.checkEdges();
            for (let i = 0; i < 4; ++i)
                this.tidyEdgePair(i, this.edges[i * 2], this.edges[i * 2 + 1]);
            for (const op of this.results) {
                const tmp = this.getPath(op);
                if (tmp.length > 0)
                    result.push(tmp);
            }
            this.results.length = 0;
            for (let i = 0; i < 8; i++)
                this.edges[i].length = 0;
        }
        return result;
    }
    checkEdges() {
        for (let i = 0; i < this.results.length; i++) {
            let op = this.results[i];
            let op2 = op;
            if (op === undefined)
                continue;
            do {
                if (InternalClipper.crossProduct(op2.prev.pt, op2.pt, op2.next.pt) === 0) {
                    if (op2 === op) {
                        op2 = RectClip64.unlinkOpBack(op2);
                        if (op2 === undefined)
                            break;
                        op = op2.prev;
                    }
                    else {
                        op2 = RectClip64.unlinkOpBack(op2);
                        if (op2 === undefined)
                            break;
                    }
                }
                else {
                    op2 = op2.next;
                }
            } while (op2 !== op);
            if (op2 === undefined) {
                this.results[i] = undefined;
                continue;
            }
            this.results[i] = op2;
            let edgeSet1 = RectClip64.getEdgesForPt(op.prev.pt, this.rect);
            op2 = op;
            do {
                const edgeSet2 = RectClip64.getEdgesForPt(op2.pt, this.rect);
                if (edgeSet2 !== 0 && op2.edge === undefined) {
                    const combinedSet = (edgeSet1 & edgeSet2);
                    for (let j = 0; j < 4; ++j) {
                        if ((combinedSet & (1 << j)) !== 0) {
                            if (RectClip64.isHeadingClockwise(op2.prev.pt, op2.pt, j))
                                RectClip64.addToEdge(this.edges[j * 2], op2);
                            else
                                RectClip64.addToEdge(this.edges[j * 2 + 1], op2);
                        }
                    }
                }
                edgeSet1 = edgeSet2;
                op2 = op2.next;
            } while (op2 !== op);
        }
    }
    tidyEdgePair(idx, cw, ccw) {
        if (ccw.length === 0)
            return;
        const isHorz = (idx === 1 || idx === 3);
        const cwIsTowardLarger = (idx === 1 || idx === 2);
        let i = 0, j = 0;
        let p1, p2, p1a, p2a, op, op2;
        while (i < cw.length) {
            p1 = cw[i];
            if (!p1 || p1.next === p1.prev) {
                cw[i++] = undefined;
                j = 0;
                continue;
            }
            const jLim = ccw.length;
            while (j < jLim && (!ccw[j] || ccw[j].next === ccw[j].prev))
                ++j;
            if (j === jLim) {
                ++i;
                j = 0;
                continue;
            }
            if (cwIsTowardLarger) {
                p1 = cw[i].prev;
                p1a = cw[i];
                p2 = ccw[j];
                p2a = ccw[j].prev;
            }
            else {
                p1 = cw[i];
                p1a = cw[i].prev;
                p2 = ccw[j].prev;
                p2a = ccw[j];
            }
            if ((isHorz && !RectClip64.hasHorzOverlap(p1.pt, p1a.pt, p2.pt, p2a.pt)) ||
                (!isHorz && !RectClip64.hasVertOverlap(p1.pt, p1a.pt, p2.pt, p2a.pt))) {
                ++j;
                continue;
            }
            const isRejoining = cw[i].ownerIdx !== ccw[j].ownerIdx;
            if (isRejoining) {
                this.results[p2.ownerIdx] = undefined;
                RectClip64.setNewOwner(p2, p1.ownerIdx);
            }
            if (cwIsTowardLarger) {
                // p1 >> | >> p1a;
                // p2 << | << p2a;
                p1.next = p2;
                p2.prev = p1;
                p1a.prev = p2a;
                p2a.next = p1a;
            }
            else {
                // p1 << | << p1a;
                // p2 >> | >> p2a;
                p1.prev = p2;
                p2.next = p1;
                p1a.next = p2a;
                p2a.prev = p1a;
            }
            if (!isRejoining) {
                const new_idx = this.results.length;
                this.results.push(p1a);
                RectClip64.setNewOwner(p1a, new_idx);
            }
            if (cwIsTowardLarger) {
                op = p2;
                op2 = p1a;
            }
            else {
                op = p1;
                op2 = p2a;
            }
            this.results[op.ownerIdx] = op;
            this.results[op2.ownerIdx] = op2;
            // and now lots of work to get ready for the next loop
            let opIsLarger, op2IsLarger;
            if (isHorz) { // X
                opIsLarger = op.pt.x > op.prev.pt.x;
                op2IsLarger = op2.pt.x > op2.prev.pt.x;
            }
            else { // Y
                opIsLarger = op.pt.y > op.prev.pt.y;
                op2IsLarger = op2.pt.y > op2.prev.pt.y;
            }
            if ((op.next === op.prev) || (op.pt === op.prev.pt)) {
                if (op2IsLarger === cwIsTowardLarger) {
                    cw[i] = op2;
                    ccw[j++] = undefined;
                }
                else {
                    ccw[j] = op2;
                    cw[i++] = undefined;
                }
            }
            else if ((op2.next === op2.prev) || (op2.pt === op2.prev.pt)) {
                if (opIsLarger === cwIsTowardLarger) {
                    cw[i] = op;
                    ccw[j++] = undefined;
                }
                else {
                    ccw[j] = op;
                    cw[i++] = undefined;
                }
            }
            else if (opIsLarger === op2IsLarger) {
                if (opIsLarger === cwIsTowardLarger) {
                    cw[i] = op;
                    RectClip64.uncoupleEdge(op2);
                    RectClip64.addToEdge(cw, op2);
                    ccw[j++] = undefined;
                }
                else {
                    cw[i++] = undefined;
                    ccw[j] = op2;
                    RectClip64.uncoupleEdge(op);
                    RectClip64.addToEdge(ccw, op);
                    j = 0;
                }
            }
            else {
                if (opIsLarger === cwIsTowardLarger)
                    cw[i] = op;
                else
                    ccw[j] = op;
                if (op2IsLarger === cwIsTowardLarger)
                    cw[i] = op2;
                else
                    ccw[j] = op2;
            }
        }
    }
    getPath(op) {
        const result = new Path64();
        if (!op || op.prev === op.next)
            return result;
        let op2 = op.next;
        while (op2 && op2 !== op) {
            if (InternalClipper.crossProduct(op2.prev.pt, op2.pt, op2.next.pt) === 0) {
                op = op2.prev;
                op2 = RectClip64.unlinkOp(op2);
            }
            else {
                op2 = op2.next;
            }
        }
        if (!op2)
            return new Path64();
        result.push(op.pt);
        op2 = op.next;
        while (op2 !== op) {
            result.push(op2.pt);
            op2 = op2.next;
        }
        return result;
    }
}
export class RectClipLines64 extends RectClip64 {
    constructor(rect) {
        super(rect);
    }
    execute(paths) {
        const result = new Paths64();
        if (this.rect.isEmpty())
            return result;
        for (const path of paths) {
            if (path.length < 2)
                continue;
            this.pathBounds = Clipper.getBounds(path);
            if (!this.rect.intersects(this.pathBounds))
                continue;
            this.executeInternal(path);
            for (const op of this.results) {
                const tmp = this.getPath(op);
                if (tmp.length > 0)
                    result.push(tmp);
            }
            // Clean up after every loop
            this.results.length = 0; // Clear the array
            for (let i = 0; i < 8; i++) {
                this.edges[i].length = 0; // Clear each array
            }
        }
        return result;
    }
    getPath(op) {
        const result = new Path64();
        if (!op || op === op.next)
            return result;
        op = op.next; // starting at path beginning
        result.push(op.pt);
        let op2 = op.next;
        while (op2 !== op) {
            result.push(op2.pt);
            op2 = op2.next;
        }
        return result;
    }
    executeInternal(path) {
        this.results = [];
        if (path.length < 2 || this.rect.isEmpty())
            return;
        let prev = Location.inside;
        let i = 1;
        const highI = path.length - 1;
        let result = RectClipLines64.getLocation(this.rect, path[0]);
        let loc = result.loc;
        if (!result.success) {
            while (i <= highI && !result.success) {
                i++;
                result = RectClipLines64.getLocation(this.rect, path[i]);
                prev = result.loc;
            }
            if (i > highI) {
                for (const pt of path)
                    this.add(pt);
            }
            if (prev == Location.inside)
                loc = Location.inside;
            i = 1;
        }
        if (loc == Location.inside)
            this.add(path[0]);
        while (i <= highI) {
            prev = loc;
            this.getNextLocation(path, { loc, i, highI });
            if (i > highI)
                break;
            const prevPt = path[i - 1];
            let crossingLoc = loc;
            let result = RectClipLines64.getIntersection(this.rectPath, path[i], prevPt, crossingLoc);
            const ip = result.ip;
            crossingLoc = result.loc;
            if (!result.success) {
                i++;
                continue;
            }
            if (loc == Location.inside) {
                this.add(ip, true);
            }
            else if (prev !== Location.inside) {
                crossingLoc = prev;
                result = RectClipLines64.getIntersection(this.rectPath, prevPt, path[i], crossingLoc);
                const ip2 = result.ip;
                crossingLoc = result.loc;
                this.add(ip2);
                this.add(ip);
            }
            else {
                this.add(ip);
            }
        }
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicmVjdGNsaXAuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi8uLi8uLi8uLi9wcm9qZWN0cy9jbGlwcGVyMi1qcy9zcmMvbGliL3JlY3RjbGlwLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7Ozs7O2dGQU9nRjtBQUVoRixFQUFFO0FBQ0YsdUhBQXVIO0FBQ3ZILDZCQUE2QjtBQUM3QixFQUFFO0FBQ0YsNEdBQTRHO0FBQzVHLEVBQUU7QUFFRixPQUFPLEVBQUUsT0FBTyxFQUFFLE1BQU0sV0FBVyxDQUFDO0FBQ3BDLE9BQU8sRUFBWSxlQUFlLEVBQUUsTUFBTSxFQUFFLE9BQU8sRUFBRSxPQUFPLEVBQVUsTUFBTSxRQUFRLENBQUM7QUFDckYsT0FBTyxFQUFFLG9CQUFvQixFQUFFLE1BQU0sVUFBVSxDQUFDO0FBRWhELE1BQU0sT0FBTyxNQUFNO0lBUWpCLFlBQVksRUFBWTtRQUN0QixJQUFJLENBQUMsRUFBRSxHQUFHLEVBQUUsQ0FBQztRQUNiLElBQUksQ0FBQyxRQUFRLEdBQUcsQ0FBQyxDQUFBO0lBQ25CLENBQUM7Q0FDRjtBQUVELElBQUssUUFFSjtBQUZELFdBQUssUUFBUTtJQUNYLHVDQUFJLENBQUE7SUFBRSxxQ0FBRyxDQUFBO0lBQUUseUNBQUssQ0FBQTtJQUFFLDJDQUFNLENBQUE7SUFBRSwyQ0FBTSxDQUFBO0FBQ2xDLENBQUMsRUFGSSxRQUFRLEtBQVIsUUFBUSxRQUVaO0FBRUQsTUFBTSxPQUFPLFVBQVU7SUFTckIsWUFBWSxJQUFZO1FBRmQsWUFBTyxHQUFHLENBQUMsQ0FBQyxDQUFDO1FBR3JCLElBQUksQ0FBQyxJQUFJLEdBQUcsSUFBSSxDQUFDO1FBQ2pCLElBQUksQ0FBQyxFQUFFLEdBQUcsSUFBSSxDQUFDLFFBQVEsRUFBRSxDQUFDO1FBQzFCLElBQUksQ0FBQyxRQUFRLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxDQUFDO1FBQzlCLElBQUksQ0FBQyxPQUFPLEdBQUcsRUFBRSxDQUFDO1FBQ2xCLElB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TUFBTSxHQUFHLEdBQWEsTUFBTSxDQUFDLEVBQUUsQ0FBQTtnQkFDL0IsV0FBVyxHQUFHLE1BQU0sQ0FBQyxHQUFHLENBQUE7Z0JBRXhCLElBQUksQ0FBQyxHQUFHLENBQUMsR0FBRyxDQUFDLENBQUM7Z0JBQ2QsSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsQ0FBQzthQUNkO2lCQUFNO2dCQUNMLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLENBQUM7YUFDZDtTQUNGO0lBQ0gsQ0FBQztDQUNGIiwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuKiBBdXRob3IgICAgOiAgQW5ndXMgSm9obnNvbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICpcclxuKiBEYXRlICAgICAgOiAgOCBTZXB0ZW1iZXIgMjAyMyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIFdlYnNpdGUgICA6ICBodHRwOi8vd3d3LmFuZ3Vzai5jb20gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIENvcHlyaWdodCA6ICBBbmd1cyBKb2huc29uIDIwMTAtMjAyMyAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIFB1cnBvc2UgICA6ICBGQVNUIHJlY3Rhbmd1bGFyIGNsaXBwaW5nICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qIExpY2Vuc2UgICA6ICBodHRwOi8vd3d3LmJvb3N0Lm9yZy9MSUNFTlNFXzFfMC50eHQgICAgICAgICAgICAgICAgICAgICAgICAgICAgKlxyXG4qKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqL1xyXG5cclxuLy9cclxuLy8gQ29udmVydGVkIGZyb20gQyMgaW1wbGVtZW50aW9uIGh0dHBzOi8vZ2l0aHViLmNvbS9Bbmd1c0pvaG5zb24vQ2xpcHBlcjIvYmxvYi9tYWluL0NTaGFycC9DbGlwcGVyMkxpYi9DbGlwcGVyLkNvcmUuY3NcclxuLy8gUmVtb3ZlZCBzdXBwb3J0IGZvciBVU0lOR1pcclxuLy9cclxuLy8gQ29udmVydGVkIGJ5IENoYXRHUFQgNCBBdWd1c3QgMyB2ZXJzaW9uIGh0dHBzOi8vaGVscC5vcGVuYWkuY29tL2VuL2FydGljbGVzLzY4MjU0NTMtY2hhdGdwdC1yZWxlYXNlLW5vdGVzXHJcbi8vXHJcblxyXG5pbXBvcnQgeyBDbGlwcGVyIH0gZnJvbSBcIi4vY2xpcHBlclwiO1xyXG5pbXBvcnQgeyBJUG9pbnQ2NCwgSW50ZXJuYWxDbGlwcGVyLCBQYXRoNjQsIFBhdGhzNjQsIFBvaW50NjQsIFJlY3Q2NCB9IGZyb20gXCIuL2NvcmVcIjtcclxuaW1wb3J0IHsgUG9pbnRJblBvbHlnb25SZXN1bHQgfSBmcm9tIFwiLi9lbmdpbmVcIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBPdXRQdDIge1xyXG4gIG5leHQ/OiBPdXRQdDI7XHJcbiAgcHJldj86IE91dFB0MjtcclxuXHJcbiAgcHQ6IElQb2ludDY0O1xyXG4gIG93bmVySWR4OiBudW1iZXI7XHJcbiAgZWRnZT86IEFycmF5PE91dFB0MiB8IHVuZGVmaW5lZD47XHJcblxyXG4gIGNvbnN0cnVjdG9yKHB0OiBJUG9pbnQ2NCkge1xyXG4gICAgdGhpcy5wdCA9IHB0O1xyXG4gICAgdGhpcy5vd25lcklkeCA9IDBcclxuICB9XHJcbn1cclxuXHJcbmVudW0gTG9jYXRpb24ge1xyXG4gIGxlZnQsIHRvcCwgcmlnaHQsIGJvdHRvbSwgaW5zaWRlXHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBSZWN0Q2xpcDY0IHtcclxuICBwcm90ZWN0ZWQgcmVjdDogUmVjdDY0O1xyXG4gIHByb3RlY3RlZCBtcDogUG9pbnQ2NDtcclxuICBwcm90ZWN0ZWQgcmVjdFBhdGg6IFBhdGg2NDtcclxuICBwcm90ZWN0ZWQgcGF0aEJvdW5kcyE6IFJlY3Q2NDtcclxuICBwcm90ZWN0ZWQgcmVzdWx0czogQXJyYXk8T3V0UHQyIHwgdW5kZWZpbmVkPlxyXG4gIHByb3RlY3RlZCBlZGdlczogQXJyYXk8T3V0UHQyIHwgdW5kZWZpbmVkPltdO1xyXG4gIHByb3RlY3RlZCBjdXJySWR4ID0gLTE7XHJcblxyXG4gIGNvbnN0cnVjdG9yKHJlY3Q6IFJlY3Q2NCkge1xyXG4gICAgdGhpcy5yZWN0ID0gcmVjdDtcclxuICAgIHRoaXMubXAgPSByZWN0Lm1pZFBvaW50KCk7XHJcbiAgICB0aGlzLnJlY3RQYXRoID0gcmVjdC5hc1BhdGgoKTtcclxuICAgIHRoaXMucmVzdWx0cyA9IFtdO1xyXG4gICAgdGhpcy5lZGdlcyA9IEFycmF5KDgpLmZpbGwodW5kZWZpbmVkKS5tYXAoKCkgPT4gW10pO1xyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIGFkZChwdDogSVBvaW50NjQsIHN0YXJ0aW5nTmV3UGF0aDogYm9vbGVhbiA9IGZhbHNlKTogT3V0UHQyIHtcclxuICAgIGxldCBjdXJySWR4ID0gdGhpcy5yZXN1bHRzLmxlbmd0aDtcclxuICAgIGxldCByZXN1bHQ6IE91dFB0MjtcclxuICAgIGlmIChjdXJySWR4ID09PSAwIHx8IHN0YXJ0aW5nTmV3UGF0aCkge1xyXG4gICAgICByZXN1bHQgPSBuZXcgT3V0UHQyKHB0KTtcclxuICAgICAgdGhpcy5yZXN1bHRzLnB1c2gocmVzdWx0KTtcclxuICAgICAgcmVzdWx0Lm93bmVySWR4ID0gY3VycklkeDtcclxuICAgICAgcmVzdWx0LnByZXYgPSByZXN1bHQ7XHJcbiAgICAgIHJlc3VsdC5uZXh0ID0gcmVzdWx0O1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgY3VycklkeC0tO1xyXG4gICAgICBjb25zdCBwcmV2T3AgPSB0aGlzLnJlc3VsdHNbY3VycklkeF07XHJcbiAgICAgIGlmIChwcmV2T3AhLnB0ID09PSBwdCkgcmV0dXJuIHByZXZPcCE7XHJcbiAgICAgIHJlc3VsdCA9IG5ldyBPdXRQdDIocHQpO1xyXG4gICAgICByZXN1bHQub3duZXJJZHggPSBjdXJySWR4O1xyXG4gICAgICByZXN1bHQubmV4dCA9IHByZXZPcCEubmV4dDtcclxuICAgICAgcHJldk9wIS5uZXh0IS5wcmV2ID0gcmVzdWx0O1xyXG4gICAgICBwcmV2T3AhLm5leHQgPSByZXN1bHQ7XHJcbiAgICAgIHJlc3VsdC5wcmV2ID0gcHJldk9wITtcclxuICAgICAgdGhpcy5yZXN1bHRzW2N1cnJJZHhdID0gcmVzdWx0O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIHBhdGgxQ29udGFpbnNQYXRoMihwYXRoMTogUGF0aDY0LCBwYXRoMjogUGF0aDY0KTogYm9vbGVhbiB7XHJcbiAgICBsZXQgaW9Db3VudCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IHB0IG9mIHBhdGgyKSB7XHJcbiAgICAgIGNvbnN0IHBpcCA9IEludGVybmFsQ2xpcHBlci5wb2ludEluUG9seWdvbihwdCwgcGF0aDEpO1xyXG4gICAgICBzd2l0Y2ggKHBpcCkge1xyXG4gICAgICAgIGNhc2UgUG9pbnRJblBvbHlnb25SZXN1bHQuSXNJbnNpZGU6XHJcbiAgICAgICAgICBpb0NvdW50LS07IGJyZWFrO1xyXG4gICAgICAgIGNhc2UgUG9pbnRJblBvbHlnb25SZXN1bHQuSXNPdXRzaWRlOlxyXG4gICAgICAgICAgaW9Db3VudCsrOyBicmVhaztcclxuICAgICAgfVxyXG4gICAgICBpZiAoTWF0aC5hYnMoaW9Db3VudCkgPiAxKSBicmVhaztcclxuICAgIH1cclxuICAgIHJldHVybiBpb0NvdW50IDw9IDA7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBpc0Nsb2Nrd2lzZShwcmV2OiBMb2NhdGlvbiwgY3VycjogTG9jYXRpb24sIHByZXZQdDogSVBvaW50NjQsIGN1cnJQdDogSVBvaW50NjQsIHJlY3RNaWRQb2ludDogUG9pbnQ2NCk6IGJvb2xlYW4ge1xyXG4gICAgaWYgKHRoaXMuYXJlT3Bwb3NpdGVzKHByZXYsIGN1cnIpKVxyXG4gICAgICByZXR1cm4gSW50ZXJuYWxDbGlwcGVyLmNyb3NzUHJvZHVjdChwcmV2UHQsIHJlY3RNaWRQb2ludCwgY3VyclB0KSA8IDA7XHJcbiAgICBlbHNlXHJcbiAgICAgIHJldHVybiB0aGlzLmhlYWRpbmdDbG9ja3dpc2UocHJldiwgY3Vycik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBhcmVPcHBvc2l0ZXMocHJldjogTG9jYXRpb24sIGN1cnI6IExvY2F0aW9uKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gTWF0aC5hYnMocHJldiAtIGN1cnIpID09PSAyO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgaGVhZGluZ0Nsb2Nrd2lzZShwcmV2OiBMb2NhdGlvbiwgY3VycjogTG9jYXRpb24pOiBib29sZWFuIHtcclxuICAgIHJldHVybiAocHJldiArIDEpICUgNCA9PT0gY3VycjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGdldEFkamFjZW50TG9jYXRpb24obG9jOiBMb2NhdGlvbiwgaXNDbG9ja3dpc2U6IGJvb2xlYW4pOiBMb2NhdGlvbiB7XHJcbiAgICBjb25zdCBkZWx0YSA9IGlzQ2xvY2t3aXNlID8gMSA6IDM7XHJcbiAgICByZXR1cm4gKGxvYyArIGRlbHRhKSAlIDQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyB1bmxpbmtPcChvcDogT3V0UHQyIHwgdW5kZWZpbmVkKTogT3V0UHQyIHwgdW5kZWZpbmVkIHtcclxuICAgIGlmIChvcCEubmV4dCA9PT0gb3ApIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICBvcCEucHJldiEubmV4dCA9IG9wIS5uZXh0O1xyXG4gICAgb3AhLm5leHQhLnByZXYgPSBvcCEucHJldjtcclxuICAgIHJldHVybiBvcCEubmV4dDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIHVubGlua09wQmFjayhvcDogT3V0UHQyIHwgdW5kZWZpbmVkKTogT3V0UHQyIHwgdW5kZWZpbmVkIHtcclxuICAgIGlmIChvcCEubmV4dCA9PT0gb3ApIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICBvcCEucHJldiEubmV4dCA9IG9wIS5uZXh0O1xyXG4gICAgb3AhLm5leHQhLnByZXYgPSBvcCEucHJldjtcclxuICAgIHJldHVybiBvcCEucHJldjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGdldEVkZ2VzRm9yUHQocHQ6IElQb2ludDY0LCByZWM6IFJlY3Q2NCk6IG51bWJlciB7XHJcbiAgICBsZXQgcmVzdWx0ID0gMDtcclxuICAgIGlmIChwdC54ID09PSByZWMubGVmdCkgcmVzdWx0ID0gMTtcclxuICAgIGVsc2UgaWYgKHB0LnggPT09IHJlYy5yaWdodCkgcmVzdWx0ID0gNDtcclxuICAgIGlmIChwdC55ID09PSByZWMudG9wKSByZXN1bHQgKz0gMjtcclxuICAgIGVsc2UgaWYgKHB0LnkgPT09IHJlYy5ib3R0b20pIHJlc3VsdCArPSA4O1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGlzSGVhZGluZ0Nsb2Nrd2lzZShwdDE6IElQb2ludDY0LCBwdDI6IElQb2ludDY0LCBlZGdlSWR4OiBudW1iZXIpOiBib29sZWFuIHtcclxuICAgIHN3aXRjaCAoZWRnZUlkeCkge1xyXG4gICAgICBjYXNlIDA6IHJldHVybiBwdDIueSA8IHB0MS55O1xyXG4gICAgICBjYXNlIDE6IHJldHVybiBwdDIueCA+IHB0MS54O1xyXG4gICAgICBjYXNlIDI6IHJldHVybiBwdDIueSA+IHB0MS55O1xyXG4gICAgICBkZWZhdWx0OiByZXR1cm4gcHQyLnggPCBwdDEueDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGhhc0hvcnpPdmVybGFwKGxlZnQxOiBJUG9pbnQ2NCwgcmlnaHQxOiBJUG9pbnQ2NCwgbGVmdDI6IElQb2ludDY0LCByaWdodDI6IElQb2ludDY0KTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gKGxlZnQxLnggPCByaWdodDIueCkgJiYgKHJpZ2h0MS54ID4gbGVmdDIueCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyBoYXNWZXJ0T3ZlcmxhcCh0b3AxOiBJUG9pbnQ2NCwgYm90dG9tMTogSVBvaW50NjQsIHRvcDI6IElQb2ludDY0LCBib3R0b20yOiBJUG9pbnQ2NCk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuICh0b3AxLnkgPCBib3R0b20yLnkpICYmIChib3R0b20xLnkgPiB0b3AyLnkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgYWRkVG9FZGdlKGVkZ2U6IChPdXRQdDIgfCB1bmRlZmluZWQpW10sIG9wOiBPdXRQdDIpOiB2b2lkIHtcclxuICAgIGlmIChvcC5lZGdlKSByZXR1cm47XHJcbiAgICBvcC5lZGdlID0gZWRnZTtcclxuICAgIGVkZ2UucHVzaChvcCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN0YXRpYyB1bmNvdXBsZUVkZ2Uob3A6IE91dFB0Mik6IHZvaWQge1xyXG4gICAgaWYgKCFvcC5lZGdlKSByZXR1cm47XHJcbiAgICBmb3IgKGxldCBpID0gMDsgaSA8IG9wLmVkZ2UubGVuZ3RoOyBpKyspIHtcclxuICAgICAgY29uc3Qgb3AyID0gb3AuZWRnZVtpXTtcclxuICAgICAgaWYgKG9wMiA9PT0gb3ApIHtcclxuICAgICAgICBvcC5lZGdlW2ldID0gdW5kZWZpbmVkO1xyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBvcC5lZGdlID0gdW5kZWZpbmVkO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgc2V0TmV3T3duZXIob3A6IE91dFB0MiwgbmV3SWR4OiBudW1iZXIpOiB2b2lkIHtcclxuICAgIG9wLm93bmVySWR4ID0gbmV3SWR4O1xyXG4gICAgbGV0IG9wMiA9IG9wLm5leHQhO1xyXG4gICAgd2hpbGUgKG9wMiAhPT0gb3ApIHtcclxuICAgICAgb3AyLm93bmVySWR4ID0gbmV3SWR4O1xyXG4gICAgICBvcDIgPSBvcDIubmV4dCE7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFkZENvcm5lcihwcmV2OiBMb2NhdGlvbiwgY3VycjogTG9jYXRpb24pOiB2b2lkIHtcclxuICAgIGlmIChSZWN0Q2xpcDY0LmhlYWRpbmdDbG9ja3dpc2UocHJldiwgY3VycikpXHJcbiAgICAgIHRoaXMuYWRkKHRoaXMucmVjdFBhdGhbcHJldl0pO1xyXG4gICAgZWxzZVxyXG4gICAgICB0aGlzLmFkZCh0aGlzLnJlY3RQYXRoW2N1cnJdKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYWRkQ29ybmVyQnlSZWYobG9jOiBMb2NhdGlvbiwgaXNDbG9ja3dpc2U6IGJvb2xlYW4pOiB2b2lkIHtcclxuICAgIGlmIChpc0Nsb2Nrd2lzZSkge1xyXG4gICAgICB0aGlzLmFkZCh0aGlzLnJlY3RQYXRoW2xvY10pO1xyXG4gICAgICBsb2MgPSBSZWN0Q2xpcDY0LmdldEFkamFjZW50TG9jYXRpb24obG9jLCB0cnVlKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGxvYyA9IFJlY3RDbGlwNjQuZ2V0QWRqYWNlbnRMb2NhdGlvbihsb2MsIGZhbHNlKTtcclxuICAgICAgdGhpcy5hZGQodGhpcy5yZWN0UGF0aFtsb2NdKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByb3RlY3RlZCBzdGF0aWMgZ2V0TG9jYXRpb24ocmVjOiBSZWN0NjQsIHB0OiBJUG9pbnQ2NCk6IHsgc3VjY2VzczogYm9vbGVhbiwgbG9jOiBMb2NhdGlvbiB9IHtcclxuICAgIGxldCBsb2M6IExvY2F0aW9uO1xyXG5cclxuICAgIGlmIChwdC54ID09PSByZWMubGVmdCAmJiBwdC55ID49IHJlYy50b3AgJiYgcHQueSA8PSByZWMuYm90dG9tKSB7XHJcbiAgICAgIGxvYyA9IExvY2F0aW9uLmxlZnQ7IC8vIHB0IG9uIHJlY1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbG9jIH1cclxuICAgIH1cclxuICAgIGlmIChwdC54ID09PSByZWMucmlnaHQgJiYgcHQueSA+PSByZWMudG9wICYmIHB0LnkgPD0gcmVjLmJvdHRvbSkge1xyXG4gICAgICBsb2MgPSBMb2NhdGlvbi5yaWdodDsgLy8gcHQgb24gcmVjXHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBsb2MgfTtcclxuICAgIH1cclxuICAgIGlmIChwdC55ID09PSByZWMudG9wICYmIHB0LnggPj0gcmVjLmxlZnQgJiYgcHQueCA8PSByZWMucmlnaHQpIHtcclxuICAgICAgbG9jID0gTG9jYXRpb24udG9wOyAvLyBwdCBvbiByZWNcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGxvYyB9O1xyXG4gICAgfVxyXG4gICAgaWYgKHB0LnkgPT09IHJlYy5ib3R0b20gJiYgcHQueCA+PSByZWMubGVmdCAmJiBwdC54IDw9IHJlYy5yaWdodCkge1xyXG4gICAgICBsb2MgPSBMb2NhdGlvbi5ib3R0b207IC8vIHB0IG9uIHJlY1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbG9jIH07XHJcbiAgICB9XHJcbiAgICBpZiAocHQueCA8IHJlYy5sZWZ0KSBsb2MgPSBMb2NhdGlvbi5sZWZ0O1xyXG4gICAgZWxzZSBpZiAocHQueCA+IHJlYy5yaWdodCkgbG9jID0gTG9jYXRpb24ucmlnaHQ7XHJcbiAgICBlbHNlIGlmIChwdC55IDwgcmVjLnRvcCkgbG9jID0gTG9jYXRpb24udG9wO1xyXG4gICAgZWxzZSBpZiAocHQueSA+IHJlYy5ib3R0b20pIGxvYyA9IExvY2F0aW9uLmJvdHRvbTtcclxuICAgIGVsc2UgbG9jID0gTG9jYXRpb24uaW5zaWRlO1xyXG5cclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGxvYyB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGF0aWMgaXNIb3Jpem9udGFsKHB0MTogSVBvaW50NjQsIHB0MjogSVBvaW50NjQpOiBib29sZWFuIHtcclxuICAgIHJldHVybiBwdDEueSA9PSBwdDIueTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhdGljIGdldFNlZ21lbnRJbnRlcnNlY3Rpb24ocDE6IElQb2ludDY0LCBwMjogSVBvaW50NjQsIHAzOiBJUG9pbnQ2NCwgcDQ6IElQb2ludDY0KTogeyBzdWNjZXNzOiBib29sZWFuLCBpcDogSVBvaW50NjQgfSB7XHJcbiAgICBsZXQgcmVzMSA9IEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3QocDEsIHAzLCBwNCk7XHJcbiAgICBsZXQgcmVzMiA9IEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3QocDIsIHAzLCBwNCk7XHJcbiAgICBsZXQgaXA6IElQb2ludDY0ID0gbmV3IFBvaW50NjQoMCwgMCk7XHJcblxyXG4gICAgY29uc3QgZXF1YWxzID0gKGxoczogSVBvaW50NjQsIHJoczogSVBvaW50NjQpOiBib29sZWFuID0+IHtcclxuICAgICAgcmV0dXJuIGxocy54ID09PSByaHMueCAmJiBsaHMueSA9PT0gcmhzLnk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHJlczEgPT09IDApIHtcclxuICAgICAgaXAgPSBwMTtcclxuICAgICAgaWYgKHJlczIgPT09IDApIHJldHVybiB7IGlwLCBzdWNjZXNzOiBmYWxzZSB9O1xyXG4gICAgICBlbHNlIGlmIChlcXVhbHMocDEsIHAzKSB8fCBlcXVhbHMocDEsIHA0KSkgcmV0dXJuIHsgaXAsIHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgZWxzZSBpZiAoUmVjdENsaXA2NC5pc0hvcml6b250YWwocDMsIHA0KSkgcmV0dXJuIHsgaXAsIHN1Y2Nlc3M6ICgocDEueCA+IHAzLngpID09PSAocDEueCA8IHA0LngpKSB9O1xyXG4gICAgICBlbHNlIHJldHVybiB7IGlwLCBzdWNjZXNzOiAoKHAxLnkgPiBwMy55KSA9PT0gKHAxLnkgPCBwNC55KSkgfTtcclxuICAgIH1cclxuICAgIGVsc2UgaWYgKHJlczIgPT09IDApIHtcclxuICAgICAgaXAgPSBwMjtcclxuICAgICAgaWYgKGVxdWFscyhwMiwgcDMpIHx8IGVxdWFscyhwMiwgcDQpKSByZXR1cm4geyBpcCwgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICBlbHNlIGlmIChSZWN0Q2xpcDY0LmlzSG9yaXpvbnRhbChwMywgcDQpKSByZXR1cm4geyBpcCwgc3VjY2VzczogKChwMi54ID4gcDMueCkgPT09IChwMi54IDwgcDQueCkpIH07XHJcbiAgICAgIGVsc2UgcmV0dXJuIHsgaXAsIHN1Y2Nlc3M6ICgocDIueSA+IHAzLnkpID09PSAocDIueSA8IHA0LnkpKSB9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmICgocmVzMSA+IDApID09PSAocmVzMiA+IDApKSByZXR1cm4geyBpcDogbmV3IFBvaW50NjQoMCwgMCksIHN1Y2Nlc3M6IGZhbHNlIH07XHJcblxyXG4gICAgbGV0IHJlczMgPSBJbnRlcm5hbENsaXBwZXIuY3Jvc3NQcm9kdWN0KHAzLCBwMSwgcDIpO1xyXG4gICAgbGV0IHJlczQgPSBJbnRlcm5hbENsaXBwZXIuY3Jvc3NQcm9kdWN0KHA0LCBwMSwgcDIpO1xyXG5cclxuICAgIGlmIChyZXMzID09PSAwKSB7XHJcbiAgICAgIGlwID0gcDM7XHJcbiAgICAgIGlmIChlcXVhbHMocDMsIHAxKSB8fCBlcXVhbHMocDMsIHAyKSkgcmV0dXJuIHsgaXAsIHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgICAgZWxzZSBpZiAoUmVjdENsaXA2NC5pc0hvcml6b250YWwocDEsIHAyKSkgcmV0dXJuIHsgaXAsIHN1Y2Nlc3M6ICgocDMueCA+IHAxLngpID09PSAocDMueCA8IHAyLngpKSB9O1xyXG4gICAgICBlbHNlIHJldHVybiB7IGlwLCBzdWNjZXNzOiAoKHAzLnkgPiBwMS55KSA9PT0gKHAzLnkgPCBwMi55KSkgfTtcclxuICAgIH1cclxuICAgIGVsc2UgaWYgKHJlczQgPT09IDApIHtcclxuICAgICAgaXAgPSBwNDtcclxuICAgICAgaWYgKGVxdWFscyhwNCwgcDEpIHx8IGVxdWFscyhwNCwgcDIpKSByZXR1cm4geyBpcCwgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgICBlbHNlIGlmIChSZWN0Q2xpcDY0LmlzSG9yaXpvbnRhbChwMSwgcDIpKSByZXR1cm4geyBpcCwgc3VjY2VzczogKChwNC54ID4gcDEueCkgPT09IChwNC54IDwgcDIueCkpIH07XHJcbiAgICAgIGVsc2UgcmV0dXJuIHsgaXAsIHN1Y2Nlc3M6ICgocDQueSA+IHAxLnkpID09PSAocDQueSA8IHAyLnkpKSB9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmICgocmVzMyA+IDApID09PSAocmVzNCA+IDApKSByZXR1cm4geyBpcDogbmV3IFBvaW50NjQoMCwgMCksIHN1Y2Nlc3M6IGZhbHNlIH07XHJcblxyXG4gICAgcmV0dXJuIEludGVybmFsQ2xpcHBlci5nZXRJbnRlcnNlY3RQb2ludChwMSwgcDIsIHAzLCBwNCk7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgc3RhdGljIGdldEludGVyc2VjdGlvbihyZWN0UGF0aDogUGF0aDY0LCBwOiBJUG9pbnQ2NCwgcDI6IElQb2ludDY0LCBsb2M6IExvY2F0aW9uKTogeyBzdWNjZXNzOiBib29sZWFuLCBsb2M6IExvY2F0aW9uLCBpcDogSVBvaW50NjQgfSB7XHJcbiAgICAvLyBnZXRzIHRoZSBwdCBvZiBpbnRlcnNlY3Rpb24gYmV0d2VlbiByZWN0UGF0aCBhbmQgc2VnbWVudChwLCBwMikgdGhhdCdzIGNsb3Nlc3QgdG8gJ3AnXHJcbiAgICAvLyB3aGVuIHJlc3VsdCA9PSBmYWxzZSwgbG9jIHdpbGwgcmVtYWluIHVuY2hhbmdlZFxyXG4gICAgbGV0IGlwOiBJUG9pbnQ2NCA9IG5ldyBQb2ludDY0KCk7XHJcbiAgICBsZXQgcmVzdWx0OiB7IHN1Y2Nlc3M6IGJvb2xlYW4sIGlwOiBJUG9pbnQ2NCB9XHJcblxyXG4gICAgc3dpdGNoIChsb2MpIHtcclxuICAgICAgY2FzZSBMb2NhdGlvbi5sZWZ0OlxyXG4gICAgICAgIGlmICgocmVzdWx0ID0gUmVjdENsaXA2NC5nZXRTZWdtZW50SW50ZXJzZWN0aW9uKHAsIHAyLCByZWN0UGF0aFswXSwgcmVjdFBhdGhbM10pKS5zdWNjZXNzKVxyXG4gICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbG9jLCBpcDogcmVzdWx0LmlwIH1cclxuICAgICAgICBlbHNlIGlmIChwLnkgPCByZWN0UGF0aFswXS55ICYmIChyZXN1bHQgPSBSZWN0Q2xpcDY0LmdldFNlZ21lbnRJbnRlcnNlY3Rpb24ocCwgcDIsIHJlY3RQYXRoWzBdLCByZWN0UGF0aFsxXSkpLnN1Y2Nlc3MpIHtcclxuICAgICAgICAgIGxvYyA9IExvY2F0aW9uLnRvcDtcclxuICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGxvYywgaXA6IHJlc3VsdC5pcCB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2UgaWYgKChyZXN1bHQgPSBSZWN0Q2xpcDY0LmdldFNlZ21lbnRJbnRlcnNlY3Rpb24ocCwgcDIsIHJlY3RQYXRoWzJdLCByZWN0UGF0aFszXSkpLnN1Y2Nlc3MpIHtcclxuICAgICAgICAgIGxvYyA9IExvY2F0aW9uLmJvdHRvbTtcclxuICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGxvYywgaXA6IHJlc3VsdC5pcCB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2UgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGxvYywgaXAgfVxyXG5cclxuICAgICAgY2FzZSBMb2NhdGlvbi5yaWdodDpcclxuICAgICAgICBpZiAoKHJlc3VsdCA9IFJlY3RDbGlwNjQuZ2V0U2VnbWVudEludGVyc2VjdGlvbihwLCBwMiwgcmVjdFBhdGhbMV0sIHJlY3RQYXRoWzJdKSkuc3VjY2VzcylcclxuICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGxvYywgaXA6IHJlc3VsdC5pcCB9XHJcbiAgICAgICAgZWxzZSBpZiAocC55IDwgcmVjdFBhdGhbMF0ueSAmJiAocmVzdWx0ID0gUmVjdENsaXA2NC5nZXRTZWdtZW50SW50ZXJzZWN0aW9uKHAsIHAyLCByZWN0UGF0aFswXSwgcmVjdFBhdGhbMV0pKS5zdWNjZXNzKSB7XHJcbiAgICAgICAgICBsb2MgPSBMb2NhdGlvbi50b3A7XHJcbiAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBsb2MsIGlwOiByZXN1bHQuaXAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlIGlmICgocmVzdWx0ID0gUmVjdENsaXA2NC5nZXRTZWdtZW50SW50ZXJzZWN0aW9uKHAsIHAyLCByZWN0UGF0aFsyXSwgcmVjdFBhdGhbM10pKS5zdWNjZXNzKSB7XHJcbiAgICAgICAgICBsb2MgPSBMb2NhdGlvbi5ib3R0b207XHJcbiAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBsb2MsIGlwOiByZXN1bHQuaXAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlIHJldHVybiB7IHN1Y2Nlc3M6IGZhbHNlLCBsb2MsIGlwIH1cclxuXHJcbiAgICAgIGNhc2UgTG9jYXRpb24udG9wOlxyXG4gICAgICAgIGlmICgocmVzdWx0ID0gUmVjdENsaXA2NC5nZXRTZWdtZW50SW50ZXJzZWN0aW9uKHAsIHAyLCByZWN0UGF0aFswXSwgcmVjdFBhdGhbMV0pKS5zdWNjZXNzKVxyXG4gICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbG9jLCBpcDogcmVzdWx0LmlwIH1cclxuICAgICAgICBlbHNlIGlmIChwLnggPCByZWN0UGF0aFswXS54ICYmIChyZXN1bHQgPSBSZWN0Q2xpcDY0LmdldFNlZ21lbnRJbnRlcnNlY3Rpb24ocCwgcDIsIHJlY3RQYXRoWzBdLCByZWN0UGF0aFszXSkpLnN1Y2Nlc3MpIHtcclxuICAgICAgICAgIGxvYyA9IExvY2F0aW9uLmxlZnQ7XHJcbiAgICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlLCBsb2MsIGlwOiByZXN1bHQuaXAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBlbHNlIGlmIChwLnggPiByZWN0UGF0aFsxXS54ICYmIChyZXN1bHQgPSBSZWN0Q2xpcDY0LmdldFNlZ21lbnRJbnRlcnNlY3Rpb24ocCwgcDIsIHJlY3RQYXRoWzFdLCByZWN0UGF0aFsyXSkpLnN1Y2Nlc3MpIHtcclxuICAgICAgICAgIGxvYyA9IExvY2F0aW9uLnJpZ2h0O1xyXG4gICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbG9jLCBpcDogcmVzdWx0LmlwIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbG9jLCBpcCB9XHJcblxyXG4gICAgICBjYXNlIExvY2F0aW9uLmJvdHRvbTpcclxuICAgICAgICBpZiAoKHJlc3VsdCA9IFJlY3RDbGlwNjQuZ2V0U2VnbWVudEludGVyc2VjdGlvbihwLCBwMiwgcmVjdFBhdGhbMl0sIHJlY3RQYXRoWzNdKSkuc3VjY2VzcylcclxuICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGxvYywgaXA6IHJlc3VsdC5pcCB9XHJcbiAgICAgICAgZWxzZSBpZiAocC54IDwgcmVjdFBhdGhbM10ueCAmJiAocmVzdWx0ID0gUmVjdENsaXA2NC5nZXRTZWdtZW50SW50ZXJzZWN0aW9uKHAsIHAyLCByZWN0UGF0aFswXSwgcmVjdFBhdGhbM10pKS5zdWNjZXNzKSB7XHJcbiAgICAgICAgICBsb2MgPSBMb2NhdGlvbi5sZWZ0O1xyXG4gICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbG9jLCBpcDogcmVzdWx0LmlwIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAocC54ID4gcmVjdFBhdGhbMl0ueCAmJiAocmVzdWx0ID0gUmVjdENsaXA2NC5nZXRTZWdtZW50SW50ZXJzZWN0aW9uKHAsIHAyLCByZWN0UGF0aFsxXSwgcmVjdFBhdGhbMl0pKS5zdWNjZXNzKSB7XHJcbiAgICAgICAgICBsb2MgPSBMb2NhdGlvbi5yaWdodDtcclxuICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGxvYywgaXA6IHJlc3VsdC5pcCB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2UgcmV0dXJuIHsgc3VjY2VzczogZmFsc2UsIGxvYywgaXAgfVxyXG5cclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICBpZiAoKHJlc3VsdCA9IFJlY3RDbGlwNjQuZ2V0U2VnbWVudEludGVyc2VjdGlvbihwLCBwMiwgcmVjdFBhdGhbMF0sIHJlY3RQYXRoWzNdKSkuc3VjY2Vzcykge1xyXG4gICAgICAgICAgbG9jID0gTG9jYXRpb24ubGVmdDtcclxuICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGxvYywgaXA6IHJlc3VsdC5pcCB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2UgaWYgKChyZXN1bHQgPSBSZWN0Q2xpcDY0LmdldFNlZ21lbnRJbnRlcnNlY3Rpb24ocCwgcDIsIHJlY3RQYXRoWzBdLCByZWN0UGF0aFsxXSkpLnN1Y2Nlc3MpIHtcclxuICAgICAgICAgIGxvYyA9IExvY2F0aW9uLnRvcDtcclxuICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGxvYywgaXA6IHJlc3VsdC5pcCB9XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGVsc2UgaWYgKChyZXN1bHQgPSBSZWN0Q2xpcDY0LmdldFNlZ21lbnRJbnRlcnNlY3Rpb24ocCwgcDIsIHJlY3RQYXRoWzFdLCByZWN0UGF0aFsyXSkpLnN1Y2Nlc3MpIHtcclxuICAgICAgICAgIGxvYyA9IExvY2F0aW9uLnJpZ2h0O1xyXG4gICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbG9jLCBpcDogcmVzdWx0LmlwIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSBpZiAoKHJlc3VsdCA9IFJlY3RDbGlwNjQuZ2V0U2VnbWVudEludGVyc2VjdGlvbihwLCBwMiwgcmVjdFBhdGhbMl0sIHJlY3RQYXRoWzNdKSkuc3VjY2Vzcykge1xyXG4gICAgICAgICAgbG9jID0gTG9jYXRpb24uYm90dG9tO1xyXG4gICAgICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSwgbG9jLCBpcDogcmVzdWx0LmlwIH1cclxuICAgICAgICB9XHJcbiAgICAgICAgZWxzZSByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgbG9jLCBpcCB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgZ2V0TmV4dExvY2F0aW9uKHBhdGg6IFBhdGg2NCwgY29udGV4dDogeyBsb2M6IExvY2F0aW9uLCBpOiBudW1iZXIsIGhpZ2hJOiBudW1iZXIgfSk6IHZvaWQge1xyXG5cclxuICAgIHN3aXRjaCAoY29udGV4dC5sb2MpIHtcclxuICAgICAgY2FzZSBMb2NhdGlvbi5sZWZ0OlxyXG4gICAgICAgIHdoaWxlIChjb250ZXh0LmkgPD0gY29udGV4dC5oaWdoSSAmJiBwYXRoW2NvbnRleHQuaV0ueCA8PSB0aGlzLnJlY3QubGVmdCkgY29udGV4dC5pKys7XHJcbiAgICAgICAgaWYgKGNvbnRleHQuaSA+IGNvbnRleHQuaGlnaEkpIGJyZWFrO1xyXG4gICAgICAgIGlmIChwYXRoW2NvbnRleHQuaV0ueCA+PSB0aGlzLnJlY3QucmlnaHQpIGNvbnRleHQubG9jID0gTG9jYXRpb24ucmlnaHQ7XHJcbiAgICAgICAgZWxzZSBpZiAocGF0aFtjb250ZXh0LmldLnkgPD0gdGhpcy5yZWN0LnRvcCkgY29udGV4dC5sb2MgPSBMb2NhdGlvbi50b3A7XHJcbiAgICAgICAgZWxzZSBpZiAocGF0aFtjb250ZXh0LmldLnkgPj0gdGhpcy5yZWN0LmJvdHRvbSkgY29udGV4dC5sb2MgPSBMb2NhdGlvbi5ib3R0b207XHJcbiAgICAgICAgZWxzZSBjb250ZXh0LmxvYyA9IExvY2F0aW9uLmluc2lkZTtcclxuICAgICAgICBicmVhaztcclxuXHJcbiAgICAgIGNhc2UgTG9jYXRpb24udG9wOlxyXG4gICAgICAgIHdoaWxlIChjb250ZXh0LmkgPD0gY29udGV4dC5oaWdoSSAmJiBwYXRoW2NvbnRleHQuaV0ueSA8PSB0aGlzLnJlY3QudG9wKSBjb250ZXh0LmkrKztcclxuICAgICAgICBpZiAoY29udGV4dC5pID4gY29udGV4dC5oaWdoSSkgYnJlYWs7XHJcbiAgICAgICAgaWYgKHBhdGhbY29udGV4dC5pXS55ID49IHRoaXMucmVjdC5ib3R0b20pIGNvbnRleHQubG9jID0gTG9jYXRpb24uYm90dG9tO1xyXG4gICAgICAgIGVsc2UgaWYgKHBhdGhbY29udGV4dC5pXS54IDw9IHRoaXMucmVjdC5sZWZ0KSBjb250ZXh0LmxvYyA9IExvY2F0aW9uLmxlZnQ7XHJcbiAgICAgICAgZWxzZSBpZiAocGF0aFtjb250ZXh0LmldLnggPj0gdGhpcy5yZWN0LnJpZ2h0KSBjb250ZXh0LmxvYyA9IExvY2F0aW9uLnJpZ2h0O1xyXG4gICAgICAgIGVsc2UgY29udGV4dC5sb2MgPSBMb2NhdGlvbi5pbnNpZGU7XHJcbiAgICAgICAgYnJlYWs7XHJcblxyXG4gICAgICBjYXNlIExvY2F0aW9uLnJpZ2h0OlxyXG4gICAgICAgIHdoaWxlIChjb250ZXh0LmkgPD0gY29udGV4dC5oaWdoSSAmJiBwYXRoW2NvbnRleHQuaV0ueCA+PSB0aGlzLnJlY3QucmlnaHQpIGNvbnRleHQuaSsrO1xyXG4gICAgICAgIGlmIChjb250ZXh0LmkgPiBjb250ZXh0LmhpZ2hJKSBicmVhaztcclxuICAgICAgICBpZiAocGF0aFtjb250ZXh0LmldLnggPD0gdGhpcy5yZWN0LmxlZnQpIGNvbnRleHQubG9jID0gTG9jYXRpb24ubGVmdDtcclxuICAgICAgICBlbHNlIGlmIChwYXRoW2NvbnRleHQuaV0ueSA8PSB0aGlzLnJlY3QudG9wKSBjb250ZXh0LmxvYyA9IExvY2F0aW9uLnRvcDtcclxuICAgICAgICBlbHNlIGlmIChwYXRoW2NvbnRleHQuaV0ueSA+PSB0aGlzLnJlY3QuYm90dG9tKSBjb250ZXh0LmxvYyA9IExvY2F0aW9uLmJvdHRvbTtcclxuICAgICAgICBlbHNlIGNvbnRleHQubG9jID0gTG9jYXRpb24uaW5zaWRlO1xyXG4gICAgICAgIGJyZWFrO1xyXG5cclxuICAgICAgY2FzZSBMb2NhdGlvbi5ib3R0b206XHJcbiAgICAgICAgd2hpbGUgKGNvbnRleHQuaSA8PSBjb250ZXh0LmhpZ2hJICYmIHBhdGhbY29udGV4dC5pXS55ID49IHRoaXMucmVjdC5ib3R0b20pIGNvbnRleHQuaSsrO1xyXG4gICAgICAgIGlmIChjb250ZXh0LmkgPiBjb250ZXh0LmhpZ2hJKSBicmVhaztcclxuICAgICAgICBpZiAocGF0aFtjb250ZXh0LmldLnkgPD0gdGhpcy5yZWN0LnRvcCkgY29udGV4dC5sb2MgPSBMb2NhdGlvbi50b3A7XHJcbiAgICAgICAgZWxzZSBpZiAocGF0aFtjb250ZXh0LmldLnggPD0gdGhpcy5yZWN0LmxlZnQpIGNvbnRleHQubG9jID0gTG9jYXRpb24ubGVmdDtcclxuICAgICAgICBlbHNlIGlmIChwYXRoW2NvbnRleHQuaV0ueCA+PSB0aGlzLnJlY3QucmlnaHQpIGNvbnRleHQubG9jID0gTG9jYXRpb24ucmlnaHQ7XHJcbiAgICAgICAgZWxzZSBjb250ZXh0LmxvYyA9IExvY2F0aW9uLmluc2lkZTtcclxuICAgICAgICBicmVhaztcclxuXHJcbiAgICAgIGNhc2UgTG9jYXRpb24uaW5zaWRlOlxyXG4gICAgICAgIHdoaWxlIChjb250ZXh0LmkgPD0gY29udGV4dC5oaWdoSSkge1xyXG4gICAgICAgICAgaWYgKHBhdGhbY29udGV4dC5pXS54IDwgdGhpcy5yZWN0LmxlZnQpIGNvbnRleHQubG9jID0gTG9jYXRpb24ubGVmdDtcclxuICAgICAgICAgIGVsc2UgaWYgKHBhdGhbY29udGV4dC5pXS54ID4gdGhpcy5yZWN0LnJpZ2h0KSBjb250ZXh0LmxvYyA9IExvY2F0aW9uLnJpZ2h0O1xyXG4gICAgICAgICAgZWxzZSBpZiAocGF0aFtjb250ZXh0LmldLnkgPiB0aGlzLnJlY3QuYm90dG9tKSBjb250ZXh0LmxvYyA9IExvY2F0aW9uLmJvdHRvbTtcclxuICAgICAgICAgIGVsc2UgaWYgKHBhdGhbY29udGV4dC5pXS55IDwgdGhpcy5yZWN0LnRvcCkgY29udGV4dC5sb2MgPSBMb2NhdGlvbi50b3A7XHJcbiAgICAgICAgICBlbHNlIHtcclxuICAgICAgICAgICAgdGhpcy5hZGQocGF0aFtjb250ZXh0LmldKTtcclxuICAgICAgICAgICAgY29udGV4dC5pKys7XHJcbiAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJvdGVjdGVkIGV4ZWN1dGVJbnRlcm5hbChwYXRoOiBQYXRoNjQpOiB2b2lkIHtcclxuICAgIGlmIChwYXRoLmxlbmd0aCA8IDMgfHwgdGhpcy5yZWN0LmlzRW1wdHkoKSkgcmV0dXJuO1xyXG4gICAgY29uc3Qgc3RhcnRMb2NzOiBMb2NhdGlvbltdID0gW107XHJcblxyXG4gICAgbGV0IGZpcnN0Q3Jvc3M6IExvY2F0aW9uID0gTG9jYXRpb24uaW5zaWRlO1xyXG4gICAgbGV0IGNyb3NzaW5nTG9jOiBMb2NhdGlvbiA9IGZpcnN0Q3Jvc3MsIHByZXY6IExvY2F0aW9uID0gZmlyc3RDcm9zcztcclxuXHJcbiAgICBsZXQgaTogbnVtYmVyXHJcbiAgICBjb25zdCBoaWdoSSA9IHBhdGgubGVuZ3RoIC0gMTtcclxuICAgIGxldCByZXN1bHQgPSBSZWN0Q2xpcDY0LmdldExvY2F0aW9uKHRoaXMucmVjdCwgcGF0aFtoaWdoSV0pXHJcbiAgICBsZXQgbG9jOiBMb2NhdGlvbiA9IHJlc3VsdC5sb2NcclxuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgaSA9IGhpZ2hJIC0gMTtcclxuICAgICAgd2hpbGUgKGkgPj0gMCAmJiAhcmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICBpLS1cclxuICAgICAgICByZXN1bHQgPSBSZWN0Q2xpcDY0LmdldExvY2F0aW9uKHRoaXMucmVjdCwgcGF0aFtpXSlcclxuICAgICAgICBwcmV2ID0gcmVzdWx0LmxvY1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChpIDwgMCkge1xyXG4gICAgICAgIGZvciAoY29uc3QgcHQgb2YgcGF0aCkge1xyXG4gICAgICAgICAgdGhpcy5hZGQocHQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHByZXYgPT0gTG9jYXRpb24uaW5zaWRlKSBsb2MgPSBMb2NhdGlvbi5pbnNpZGU7XHJcbiAgICB9XHJcbiAgICBjb25zdCBzdGFydGluZ0xvYyA9IGxvYztcclxuXHJcbiAgICAvLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cclxuICAgIGkgPSAwO1xyXG4gICAgd2hpbGUgKGkgPD0gaGlnaEkpIHtcclxuICAgICAgcHJldiA9IGxvYztcclxuICAgICAgY29uc3QgcHJldkNyb3NzTG9jOiBMb2NhdGlvbiA9IGNyb3NzaW5nTG9jO1xyXG4gICAgICB0aGlzLmdldE5leHRMb2NhdGlvbihwYXRoLCB7IGxvYywgaSwgaGlnaEkgfSk7XHJcbiAgICAgIGlmIChpID4gaGlnaEkpIGJyZWFrO1xyXG5cclxuICAgICAgY29uc3QgcHJldlB0ID0gKGkgPT0gMCkgPyBwYXRoW2hpZ2hJXSA6IHBhdGhbaSAtIDFdO1xyXG4gICAgICBjcm9zc2luZ0xvYyA9IGxvYztcclxuXHJcbiAgICAgIGxldCByZXN1bHQgPSBSZWN0Q2xpcDY0LmdldEludGVyc2VjdGlvbih0aGlzLnJlY3RQYXRoLCBwYXRoW2ldLCBwcmV2UHQsIGNyb3NzaW5nTG9jKVxyXG4gICAgICBjb25zdCBpcDogSVBvaW50NjQgPSByZXN1bHQuaXBcclxuXHJcbiAgICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgICBpZiAocHJldkNyb3NzTG9jID09IExvY2F0aW9uLmluc2lkZSkge1xyXG4gICAgICAgICAgY29uc3QgaXNDbG9ja3cgPSBSZWN0Q2xpcDY0LmlzQ2xvY2t3aXNlKHByZXYsIGxvYywgcHJldlB0LCBwYXRoW2ldLCB0aGlzLm1wKTtcclxuICAgICAgICAgIGRvIHtcclxuICAgICAgICAgICAgc3RhcnRMb2NzLnB1c2gocHJldik7XHJcbiAgICAgICAgICAgIHByZXYgPSBSZWN0Q2xpcDY0LmdldEFkamFjZW50TG9jYXRpb24ocHJldiwgaXNDbG9ja3cpO1xyXG4gICAgICAgICAgfSB3aGlsZSAocHJldiAhPSBsb2MpO1xyXG4gICAgICAgICAgY3Jvc3NpbmdMb2MgPSBwcmV2Q3Jvc3NMb2M7XHJcbiAgICAgICAgfSBlbHNlIGlmIChwcmV2ICE9IExvY2F0aW9uLmluc2lkZSAmJiBwcmV2ICE9IGxvYykge1xyXG4gICAgICAgICAgY29uc3QgaXNDbG9ja3cgPSBSZWN0Q2xpcDY0LmlzQ2xvY2t3aXNlKHByZXYsIGxvYywgcHJldlB0LCBwYXRoW2ldLCB0aGlzLm1wKTtcclxuICAgICAgICAgIGRvIHtcclxuICAgICAgICAgICAgdGhpcy5hZGRDb3JuZXJCeVJlZihwcmV2LCBpc0Nsb2Nrdyk7XHJcbiAgICAgICAgICB9IHdoaWxlIChwcmV2ICE9IGxvYyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgICsraTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xyXG4gICAgICAvLyB3ZSBtdXN0IGJlIGNyb3NzaW5nIHRoZSByZWN0IGJvdW5kYXJ5IHRvIGdldCBoZXJlXHJcbiAgICAgIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy9cclxuICAgICAgaWYgKGxvYyA9PSBMb2NhdGlvbi5pbnNpZGUpIHtcclxuICAgICAgICBpZiAoZmlyc3RDcm9zcyA9PSBMb2NhdGlvbi5pbnNpZGUpIHtcclxuICAgICAgICAgIGZpcnN0Q3Jvc3MgPSBjcm9zc2luZ0xvYztcclxuICAgICAgICAgIHN0YXJ0TG9jcy5wdXNoKHByZXYpO1xyXG4gICAgICAgIH0gZWxzZSBpZiAocHJldiAhPSBjcm9zc2luZ0xvYykge1xyXG4gICAgICAgICAgY29uc3QgaXNDbG9ja3cgPSBSZWN0Q2xpcDY0LmlzQ2xvY2t3aXNlKHByZXYsIGNyb3NzaW5nTG9jLCBwcmV2UHQsIHBhdGhbaV0sIHRoaXMubXApO1xyXG4gICAgICAgICAgZG8ge1xyXG4gICAgICAgICAgICB0aGlzLmFkZENvcm5lckJ5UmVmKHByZXYsIGlzQ2xvY2t3KTtcclxuICAgICAgICAgIH0gd2hpbGUgKHByZXYgIT0gY3Jvc3NpbmdMb2MpO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIGlmIChwcmV2ICE9IExvY2F0aW9uLmluc2lkZSkge1xyXG4gICAgICAgIC8vIHBhc3NpbmcgcmlnaHQgdGhyb3VnaCByZWN0LiAnaXAnIGhlcmUgd2lsbCBiZSB0aGUgc2Vjb25kXHJcbiAgICAgICAgLy8gaW50ZXJzZWN0IHB0IGJ1dCB3ZSdsbCBhbHNvIG5lZWQgdGhlIGZpcnN0IGludGVyc2VjdCBwdCAoaXAyKVxyXG5cclxuICAgICAgICBsb2MgPSBwcmV2O1xyXG4gICAgICAgIHJlc3VsdCA9IFJlY3RDbGlwNjQuZ2V0SW50ZXJzZWN0aW9uKHRoaXMucmVjdFBhdGgsIHByZXZQdCwgcGF0aFtpXSwgbG9jKTtcclxuICAgICAgICBjb25zdCBpcDI6IElQb2ludDY0ID0gcmVzdWx0LmlwXHJcblxyXG4gICAgICAgIGlmIChwcmV2Q3Jvc3NMb2MgIT0gTG9jYXRpb24uaW5zaWRlICYmIHByZXZDcm9zc0xvYyAhPSBsb2MpXHJcbiAgICAgICAgICB0aGlzLmFkZENvcm5lcihwcmV2Q3Jvc3NMb2MsIGxvYyk7XHJcblxyXG4gICAgICAgIGlmIChmaXJzdENyb3NzID09IExvY2F0aW9uLmluc2lkZSkge1xyXG4gICAgICAgICAgZmlyc3RDcm9zcyA9IGxvYztcclxuICAgICAgICAgIHN0YXJ0TG9jcy5wdXNoKHByZXYpO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgbG9jID0gY3Jvc3NpbmdMb2M7XHJcbiAgICAgICAgdGhpcy5hZGQoaXAyKTtcclxuICAgICAgICBpZiAoaXAgPT0gaXAyKSB7XHJcbiAgICAgICAgICBsb2MgPSBSZWN0Q2xpcDY0LmdldExvY2F0aW9uKHRoaXMucmVjdCwgcGF0aFtpXSkubG9jO1xyXG4gICAgICAgICAgdGhpcy5hZGRDb3JuZXIoY3Jvc3NpbmdMb2MsIGxvYyk7XHJcbiAgICAgICAgICBjcm9zc2luZ0xvYyA9IGxvYztcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBsb2MgPSBjcm9zc2luZ0xvYztcclxuICAgICAgICBpZiAoZmlyc3RDcm9zcyA9PSBMb2NhdGlvbi5pbnNpZGUpXHJcbiAgICAgICAgICBmaXJzdENyb3NzID0gY3Jvc3NpbmdMb2M7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMuYWRkKGlwKTtcclxuICAgIH0vL3doaWxlIGkgPD0gaGlnaElcclxuICAgIC8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vLy8vL1xyXG5cclxuICAgIGlmIChmaXJzdENyb3NzID09IExvY2F0aW9uLmluc2lkZSkge1xyXG4gICAgICBpZiAoc3RhcnRpbmdMb2MgIT0gTG9jYXRpb24uaW5zaWRlKSB7XHJcbiAgICAgICAgaWYgKHRoaXMucGF0aEJvdW5kcy5jb250YWluc1JlY3QodGhpcy5yZWN0KSAmJiBSZWN0Q2xpcDY0LnBhdGgxQ29udGFpbnNQYXRoMihwYXRoLCB0aGlzLnJlY3RQYXRoKSkge1xyXG4gICAgICAgICAgZm9yIChsZXQgaiA9IDA7IGogPCA0OyBqKyspIHtcclxuICAgICAgICAgICAgdGhpcy5hZGQodGhpcy5yZWN0UGF0aFtqXSk7XHJcbiAgICAgICAgICAgIFJlY3RDbGlwNjQuYWRkVG9FZGdlKHRoaXMuZWRnZXNbaiAqIDJdLCB0aGlzLnJlc3VsdHNbMF0hKTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSBpZiAobG9jICE9IExvY2F0aW9uLmluc2lkZSAmJiAobG9jICE9IGZpcnN0Q3Jvc3MgfHwgc3RhcnRMb2NzLmxlbmd0aCA+IDIpKSB7XHJcbiAgICAgIGlmIChzdGFydExvY3MubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIHByZXYgPSBsb2M7XHJcbiAgICAgICAgZm9yIChjb25zdCBsb2MyIG9mIHN0YXJ0TG9jcykge1xyXG4gICAgICAgICAgaWYgKHByZXYgPT0gbG9jMikgY29udGludWU7XHJcbiAgICAgICAgICB0aGlzLmFkZENvcm5lckJ5UmVmKHByZXYsIFJlY3RDbGlwNjQuaGVhZGluZ0Nsb2Nrd2lzZShwcmV2LCBsb2MyKSk7XHJcbiAgICAgICAgICBwcmV2ID0gbG9jMjtcclxuICAgICAgICB9XHJcbiAgICAgICAgbG9jID0gcHJldjtcclxuICAgICAgfVxyXG4gICAgICBpZiAobG9jICE9IGZpcnN0Q3Jvc3MpXHJcbiAgICAgICAgdGhpcy5hZGRDb3JuZXJCeVJlZihsb2MsIFJlY3RDbGlwNjQuaGVhZGluZ0Nsb2Nrd2lzZShsb2MsIGZpcnN0Q3Jvc3MpKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHB1YmxpYyBleGVjdXRlKHBhdGhzOiBQYXRoczY0KTogUGF0aHM2NCB7XHJcbiAgICBjb25zdCByZXN1bHQ6IFBhdGhzNjQgPSBbXTtcclxuICAgIGlmICh0aGlzLnJlY3QuaXNFbXB0eSgpKSByZXR1cm4gcmVzdWx0O1xyXG5cclxuICAgIGZvciAoY29uc3QgcGF0aCBvZiBwYXRocykge1xyXG4gICAgICBpZiAocGF0aC5sZW5ndGggPCAzKSBjb250aW51ZTtcclxuICAgICAgdGhpcy5wYXRoQm91bmRzID0gQ2xpcHBlci5nZXRCb3VuZHMocGF0aCk7XHJcblxyXG4gICAgICBpZiAoIXRoaXMucmVjdC5pbnRlcnNlY3RzKHRoaXMucGF0aEJvdW5kcykpIGNvbnRpbnVlO1xyXG4gICAgICBlbHNlIGlmICh0aGlzLnJlY3QuY29udGFpbnNSZWN0KHRoaXMucGF0aEJvdW5kcykpIHtcclxuICAgICAgICByZXN1bHQucHVzaChwYXRoKTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLmV4ZWN1dGVJbnRlcm5hbChwYXRoKTtcclxuICAgICAgdGhpcy5jaGVja0VkZ2VzKCk7XHJcbiAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgNDsgKytpKVxyXG4gICAgICAgIHRoaXMudGlkeUVkZ2VQYWlyKGksIHRoaXMuZWRnZXNbaSAqIDJdLCB0aGlzLmVkZ2VzW2kgKiAyICsgMV0pO1xyXG5cclxuICAgICAgZm9yIChjb25zdCBvcCBvZiB0aGlzLnJlc3VsdHMpIHtcclxuICAgICAgICBjb25zdCB0bXAgPSB0aGlzLmdldFBhdGgob3ApO1xyXG4gICAgICAgIGlmICh0bXAubGVuZ3RoID4gMCkgcmVzdWx0LnB1c2godG1wKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5yZXN1bHRzLmxlbmd0aCA9IDBcclxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCA4OyBpKyspXHJcbiAgICAgICAgdGhpcy5lZGdlc1tpXS5sZW5ndGggPSAwXHJcbiAgICB9XHJcbiAgICByZXR1cm4gcmVzdWx0O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjaGVja0VkZ2VzKCk6IHZvaWQge1xyXG4gICAgZm9yIChsZXQgaSA9IDA7IGkgPCB0aGlzLnJlc3VsdHMubGVuZ3RoOyBpKyspIHtcclxuICAgICAgbGV0IG9wID0gdGhpcy5yZXN1bHRzW2ldO1xyXG4gICAgICBsZXQgb3AyID0gb3A7XHJcblxyXG4gICAgICBpZiAob3AgPT09IHVuZGVmaW5lZCkgY29udGludWU7XHJcblxyXG4gICAgICBkbyB7XHJcbiAgICAgICAgaWYgKEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3Qob3AyIS5wcmV2IS5wdCwgb3AyIS5wdCwgb3AyIS5uZXh0IS5wdCkgPT09IDApIHtcclxuICAgICAgICAgIGlmIChvcDIgPT09IG9wKSB7XHJcbiAgICAgICAgICAgIG9wMiA9IFJlY3RDbGlwNjQudW5saW5rT3BCYWNrKG9wMik7XHJcbiAgICAgICAgICAgIGlmIChvcDIgPT09IHVuZGVmaW5lZCkgYnJlYWs7XHJcbiAgICAgICAgICAgIG9wID0gb3AyLnByZXY7XHJcbiAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBvcDIgPSBSZWN0Q2xpcDY0LnVubGlua09wQmFjayhvcDIpO1xyXG4gICAgICAgICAgICBpZiAob3AyID09PSB1bmRlZmluZWQpIGJyZWFrO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICBvcDIgPSBvcDIhLm5leHQ7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IHdoaWxlIChvcDIgIT09IG9wKTtcclxuXHJcbiAgICAgIGlmIChvcDIgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMucmVzdWx0c1tpXSA9IHVuZGVmaW5lZDtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLnJlc3VsdHNbaV0gPSBvcDI7XHJcblxyXG4gICAgICBsZXQgZWRnZVNldDEgPSBSZWN0Q2xpcDY0LmdldEVkZ2VzRm9yUHQob3AhLnByZXYhLnB0LCB0aGlzLnJlY3QpO1xyXG4gICAgICBvcDIgPSBvcDtcclxuICAgICAgZG8ge1xyXG4gICAgICAgIGNvbnN0IGVkZ2VTZXQyID0gUmVjdENsaXA2NC5nZXRFZGdlc0ZvclB0KG9wMiEucHQsIHRoaXMucmVjdCk7XHJcbiAgICAgICAgaWYgKGVkZ2VTZXQyICE9PSAwICYmIG9wMiEuZWRnZSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICBjb25zdCBjb21iaW5lZFNldCA9IChlZGdlU2V0MSAmIGVkZ2VTZXQyKTtcclxuICAgICAgICAgIGZvciAobGV0IGogPSAwOyBqIDwgNDsgKytqKSB7XHJcbiAgICAgICAgICAgIGlmICgoY29tYmluZWRTZXQgJiAoMSA8PCBqKSkgIT09IDApIHtcclxuICAgICAgICAgICAgICBpZiAoUmVjdENsaXA2NC5pc0hlYWRpbmdDbG9ja3dpc2Uob3AyIS5wcmV2IS5wdCwgb3AyIS5wdCwgaikpXHJcbiAgICAgICAgICAgICAgICBSZWN0Q2xpcDY0LmFkZFRvRWRnZSh0aGlzLmVkZ2VzW2ogKiAyXSwgb3AyISk7XHJcbiAgICAgICAgICAgICAgZWxzZVxyXG4gICAgICAgICAgICAgICAgUmVjdENsaXA2NC5hZGRUb0VkZ2UodGhpcy5lZGdlc1tqICogMiArIDFdLCBvcDIhKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgICBlZGdlU2V0MSA9IGVkZ2VTZXQyO1xyXG4gICAgICAgIG9wMiA9IG9wMiEubmV4dDtcclxuICAgICAgfSB3aGlsZSAob3AyICE9PSBvcCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHRpZHlFZGdlUGFpcihpZHg6IG51bWJlciwgY3c6IEFycmF5PE91dFB0MiB8IHVuZGVmaW5lZD4sIGNjdzogQXJyYXk8T3V0UHQyIHwgdW5kZWZpbmVkPik6IHZvaWQge1xyXG4gICAgaWYgKGNjdy5sZW5ndGggPT09IDApIHJldHVybjtcclxuICAgIGNvbnN0IGlzSG9yeiA9IChpZHggPT09IDEgfHwgaWR4ID09PSAzKTtcclxuICAgIGNvbnN0IGN3SXNUb3dhcmRMYXJnZXIgPSAoaWR4ID09PSAxIHx8IGlkeCA9PT0gMik7XHJcbiAgICBsZXQgaSA9IDAsIGogPSAwO1xyXG4gICAgbGV0IHAxOiBPdXRQdDIgfCB1bmRlZmluZWQsIHAyOiBPdXRQdDIgfCB1bmRlZmluZWQsIHAxYTogT3V0UHQyIHwgdW5kZWZpbmVkLCBwMmE6IE91dFB0MiB8IHVuZGVmaW5lZCwgb3A6IE91dFB0MiB8IHVuZGVmaW5lZCwgb3AyOiBPdXRQdDIgfCB1bmRlZmluZWQ7XHJcblxyXG4gICAgd2hpbGUgKGkgPCBjdy5sZW5ndGgpIHtcclxuICAgICAgcDEgPSBjd1tpXTtcclxuICAgICAgaWYgKCFwMSB8fCBwMS5uZXh0ID09PSBwMS5wcmV2KSB7XHJcbiAgICAgICAgY3dbaSsrXSA9IHVuZGVmaW5lZDtcclxuICAgICAgICBqID0gMDtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgakxpbSA9IGNjdy5sZW5ndGg7XHJcbiAgICAgIHdoaWxlIChqIDwgakxpbSAmJiAoIWNjd1tqXSB8fCBjY3dbal0hLm5leHQgPT09IGNjd1tqXSEucHJldikpICsrajtcclxuXHJcbiAgICAgIGlmIChqID09PSBqTGltKSB7XHJcbiAgICAgICAgKytpO1xyXG4gICAgICAgIGogPSAwO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoY3dJc1Rvd2FyZExhcmdlcikge1xyXG4gICAgICAgIHAxID0gY3dbaV0hLnByZXYhO1xyXG4gICAgICAgIHAxYSA9IGN3W2ldO1xyXG4gICAgICAgIHAyID0gY2N3W2pdO1xyXG4gICAgICAgIHAyYSA9IGNjd1tqXSEucHJldiE7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcDEgPSBjd1tpXTtcclxuICAgICAgICBwMWEgPSBjd1tpXSEucHJldiE7XHJcbiAgICAgICAgcDIgPSBjY3dbal0hLnByZXYhO1xyXG4gICAgICAgIHAyYSA9IGNjd1tqXTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKChpc0hvcnogJiYgIVJlY3RDbGlwNjQuaGFzSG9yek92ZXJsYXAocDEhLnB0LCBwMWEhLnB0LCBwMiEucHQsIHAyYSEucHQpKSB8fFxyXG4gICAgICAgICghaXNIb3J6ICYmICFSZWN0Q2xpcDY0Lmhhc1ZlcnRPdmVybGFwKHAxIS5wdCwgcDFhIS5wdCwgcDIhLnB0LCBwMmEhLnB0KSkpIHtcclxuICAgICAgICArK2o7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGlzUmVqb2luaW5nID0gY3dbaV0hLm93bmVySWR4ICE9PSBjY3dbal0hLm93bmVySWR4O1xyXG5cclxuICAgICAgaWYgKGlzUmVqb2luaW5nKSB7XHJcbiAgICAgICAgdGhpcy5yZXN1bHRzW3AyIS5vd25lcklkeF0gPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgUmVjdENsaXA2NC5zZXROZXdPd25lcihwMiEsIHAxIS5vd25lcklkeCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChjd0lzVG93YXJkTGFyZ2VyKSB7XHJcbiAgICAgICAgLy8gcDEgPj4gfCA+PiBwMWE7XHJcbiAgICAgICAgLy8gcDIgPDwgfCA8PCBwMmE7XHJcbiAgICAgICAgcDEhLm5leHQgPSBwMjtcclxuICAgICAgICBwMiEucHJldiA9IHAxO1xyXG4gICAgICAgIHAxYSEucHJldiA9IHAyYTtcclxuICAgICAgICBwMmEhLm5leHQgPSBwMWE7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gcDEgPDwgfCA8PCBwMWE7XHJcbiAgICAgICAgLy8gcDIgPj4gfCA+PiBwMmE7XHJcbiAgICAgICAgcDEhLnByZXYgPSBwMjtcclxuICAgICAgICBwMiEubmV4dCA9IHAxO1xyXG4gICAgICAgIHAxYSEubmV4dCA9IHAyYTtcclxuICAgICAgICBwMmEhLnByZXYgPSBwMWE7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmICghaXNSZWpvaW5pbmcpIHtcclxuICAgICAgICBjb25zdCBuZXdfaWR4ID0gdGhpcy5yZXN1bHRzLmxlbmd0aDtcclxuICAgICAgICB0aGlzLnJlc3VsdHMucHVzaChwMWEpO1xyXG4gICAgICAgIFJlY3RDbGlwNjQuc2V0TmV3T3duZXIocDFhISwgbmV3X2lkeCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChjd0lzVG93YXJkTGFyZ2VyKSB7XHJcbiAgICAgICAgb3AgPSBwMjtcclxuICAgICAgICBvcDIgPSBwMWE7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgb3AgPSBwMTtcclxuICAgICAgICBvcDIgPSBwMmE7XHJcbiAgICAgIH1cclxuICAgICAgdGhpcy5yZXN1bHRzW29wIS5vd25lcklkeF0gPSBvcDtcclxuICAgICAgdGhpcy5yZXN1bHRzW29wMiEub3duZXJJZHhdID0gb3AyO1xyXG5cclxuICAgICAgLy8gYW5kIG5vdyBsb3RzIG9mIHdvcmsgdG8gZ2V0IHJlYWR5IGZvciB0aGUgbmV4dCBsb29wXHJcblxyXG4gICAgICBsZXQgb3BJc0xhcmdlcjogYm9vbGVhbiwgb3AySXNMYXJnZXI6IGJvb2xlYW47XHJcbiAgICAgIGlmIChpc0hvcnopIHsgLy8gWFxyXG4gICAgICAgIG9wSXNMYXJnZXIgPSBvcCEucHQueCA+IG9wIS5wcmV2IS5wdC54O1xyXG4gICAgICAgIG9wMklzTGFyZ2VyID0gb3AyIS5wdC54ID4gb3AyIS5wcmV2IS5wdC54O1xyXG4gICAgICB9IGVsc2UgeyAgICAgIC8vIFlcclxuICAgICAgICBvcElzTGFyZ2VyID0gb3AhLnB0LnkgPiBvcCEucHJldiEucHQueTtcclxuICAgICAgICBvcDJJc0xhcmdlciA9IG9wMiEucHQueSA+IG9wMiEucHJldiEucHQueTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKChvcCEubmV4dCA9PT0gb3AhLnByZXYpIHx8IChvcCEucHQgPT09IG9wIS5wcmV2IS5wdCkpIHtcclxuICAgICAgICBpZiAob3AySXNMYXJnZXIgPT09IGN3SXNUb3dhcmRMYXJnZXIpIHtcclxuICAgICAgICAgIGN3W2ldID0gb3AyO1xyXG4gICAgICAgICAgY2N3W2orK10gPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgIGNjd1tqXSA9IG9wMjtcclxuICAgICAgICAgIGN3W2krK10gPSB1bmRlZmluZWQ7XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKChvcDIhLm5leHQgPT09IG9wMiEucHJldikgfHwgKG9wMiEucHQgPT09IG9wMiEucHJldiEucHQpKSB7XHJcbiAgICAgICAgaWYgKG9wSXNMYXJnZXIgPT09IGN3SXNUb3dhcmRMYXJnZXIpIHtcclxuICAgICAgICAgIGN3W2ldID0gb3A7XHJcbiAgICAgICAgICBjY3dbaisrXSA9IHVuZGVmaW5lZDtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgY2N3W2pdID0gb3A7XHJcbiAgICAgICAgICBjd1tpKytdID0gdW5kZWZpbmVkO1xyXG4gICAgICAgIH1cclxuICAgICAgfSBlbHNlIGlmIChvcElzTGFyZ2VyID09PSBvcDJJc0xhcmdlcikge1xyXG4gICAgICAgIGlmIChvcElzTGFyZ2VyID09PSBjd0lzVG93YXJkTGFyZ2VyKSB7XHJcbiAgICAgICAgICBjd1tpXSA9IG9wO1xyXG4gICAgICAgICAgUmVjdENsaXA2NC51bmNvdXBsZUVkZ2Uob3AyISk7XHJcbiAgICAgICAgICBSZWN0Q2xpcDY0LmFkZFRvRWRnZShjdywgb3AyISk7XHJcbiAgICAgICAgICBjY3dbaisrXSA9IHVuZGVmaW5lZDtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgY3dbaSsrXSA9IHVuZGVmaW5lZDtcclxuICAgICAgICAgIGNjd1tqXSA9IG9wMjtcclxuICAgICAgICAgIFJlY3RDbGlwNjQudW5jb3VwbGVFZGdlKG9wISk7XHJcbiAgICAgICAgICBSZWN0Q2xpcDY0LmFkZFRvRWRnZShjY3csIG9wISk7XHJcbiAgICAgICAgICBqID0gMDtcclxuICAgICAgICB9XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaWYgKG9wSXNMYXJnZXIgPT09IGN3SXNUb3dhcmRMYXJnZXIpXHJcbiAgICAgICAgICBjd1tpXSA9IG9wO1xyXG4gICAgICAgIGVsc2VcclxuICAgICAgICAgIGNjd1tqXSA9IG9wO1xyXG5cclxuICAgICAgICBpZiAob3AySXNMYXJnZXIgPT09IGN3SXNUb3dhcmRMYXJnZXIpXHJcbiAgICAgICAgICBjd1tpXSA9IG9wMjtcclxuICAgICAgICBlbHNlXHJcbiAgICAgICAgICBjY3dbal0gPSBvcDI7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByb3RlY3RlZCBnZXRQYXRoKG9wOiBPdXRQdDIgfCB1bmRlZmluZWQpOiBQYXRoNjQge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gbmV3IFBhdGg2NCgpO1xyXG4gICAgaWYgKCFvcCB8fCBvcC5wcmV2ID09PSBvcC5uZXh0KSByZXR1cm4gcmVzdWx0O1xyXG5cclxuICAgIGxldCBvcDI6IE91dFB0MiB8IHVuZGVmaW5lZCA9IG9wLm5leHQ7XHJcbiAgICB3aGlsZSAob3AyICYmIG9wMiAhPT0gb3ApIHtcclxuICAgICAgaWYgKEludGVybmFsQ2xpcHBlci5jcm9zc1Byb2R1Y3Qob3AyLnByZXYhLnB0LCBvcDIucHQsIG9wMi5uZXh0IS5wdCkgPT09IDApIHtcclxuICAgICAgICBvcCA9IG9wMi5wcmV2ITtcclxuICAgICAgICBvcDIgPSBSZWN0Q2xpcDY0LnVubGlua09wKG9wMik7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgb3AyID0gb3AyLm5leHQhO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFvcDIpIHJldHVybiBuZXcgUGF0aDY0KCk7XHJcblxyXG4gICAgcmVzdWx0LnB1c2gob3AucHQpO1xyXG4gICAgb3AyID0gb3AubmV4dCE7XHJcbiAgICB3aGlsZSAob3AyICE9PSBvcCkge1xyXG4gICAgICByZXN1bHQucHVzaChvcDIucHQpO1xyXG4gICAgICBvcDIgPSBvcDIubmV4dCE7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBSZWN0Q2xpcExpbmVzNjQgZXh0ZW5kcyBSZWN0Q2xpcDY0IHtcclxuXHJcbiAgY29uc3RydWN0b3IocmVjdDogUmVjdDY0KSB7XHJcbiAgICBzdXBlcihyZWN0KTtcclxuICB9XHJcblxyXG4gIHB1YmxpYyBvdmVycmlkZSBleGVjdXRlKHBhdGhzOiBQYXRoczY0KTogUGF0aHM2NCB7XHJcbiAgICBjb25zdCByZXN1bHQgPSBuZXcgUGF0aHM2NCgpO1xyXG4gICAgaWYgKHRoaXMucmVjdC5pc0VtcHR5KCkpIHJldHVybiByZXN1bHQ7XHJcbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgcGF0aHMpIHtcclxuICAgICAgaWYgKHBhdGgubGVuZ3RoIDwgMikgY29udGludWU7XHJcbiAgICAgIHRoaXMucGF0aEJvdW5kcyA9IENsaXBwZXIuZ2V0Qm91bmRzKHBhdGgpO1xyXG4gICAgICBpZiAoIXRoaXMucmVjdC5pbnRlcnNlY3RzKHRoaXMucGF0aEJvdW5kcykpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgdGhpcy5leGVjdXRlSW50ZXJuYWwocGF0aCk7XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IG9wIG9mIHRoaXMucmVzdWx0cykge1xyXG4gICAgICAgIGNvbnN0IHRtcCA9IHRoaXMuZ2V0UGF0aChvcCk7XHJcbiAgICAgICAgaWYgKHRtcC5sZW5ndGggPiAwKSByZXN1bHQucHVzaCh0bXApO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBDbGVhbiB1cCBhZnRlciBldmVyeSBsb29wXHJcbiAgICAgIHRoaXMucmVzdWx0cy5sZW5ndGggPSAwOyAvLyBDbGVhciB0aGUgYXJyYXlcclxuICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCA4OyBpKyspIHtcclxuICAgICAgICB0aGlzLmVkZ2VzW2ldLmxlbmd0aCA9IDA7IC8vIENsZWFyIGVhY2ggYXJyYXlcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIHByb3RlY3RlZCBvdmVycmlkZSBnZXRQYXRoKG9wOiBPdXRQdDIgfCB1bmRlZmluZWQpOiBQYXRoNjQge1xyXG4gICAgY29uc3QgcmVzdWx0ID0gbmV3IFBhdGg2NCgpO1xyXG4gICAgaWYgKCFvcCB8fCBvcCA9PT0gb3AubmV4dCkgcmV0dXJuIHJlc3VsdDtcclxuICAgIG9wID0gb3AubmV4dDsgLy8gc3RhcnRpbmcgYXQgcGF0aCBiZWdpbm5pbmcgXHJcbiAgICByZXN1bHQucHVzaChvcCEucHQpO1xyXG4gICAgbGV0IG9wMiA9IG9wIS5uZXh0ITtcclxuICAgIHdoaWxlIChvcDIgIT09IG9wKSB7XHJcbiAgICAgIHJlc3VsdC5wdXNoKG9wMi5wdCk7XHJcbiAgICAgIG9wMiA9IG9wMi5uZXh0ITtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBwcm90ZWN0ZWQgb3ZlcnJpZGUgIGV4ZWN1dGVJbnRlcm5hbChwYXRoOiBQYXRoNjQpOiB2b2lkIHtcclxuICAgIHRoaXMucmVzdWx0cyA9IFtdO1xyXG4gICAgaWYgKHBhdGgubGVuZ3RoIDwgMiB8fCB0aGlzLnJlY3QuaXNFbXB0eSgpKSByZXR1cm47XHJcblxyXG4gICAgbGV0IHByZXY6IExvY2F0aW9uID0gTG9jYXRpb24uaW5zaWRlO1xyXG4gICAgbGV0IGkgPSAxO1xyXG4gICAgY29uc3QgaGlnaEkgPSBwYXRoLmxlbmd0aCAtIDE7XHJcblxyXG4gICAgbGV0IHJlc3VsdCA9IFJlY3RDbGlwTGluZXM2NC5nZXRMb2NhdGlvbih0aGlzLnJlY3QsIHBhdGhbMF0pXHJcbiAgICBsZXQgbG9jOiBMb2NhdGlvbiA9IHJlc3VsdC5sb2NcclxuICAgIGlmICghcmVzdWx0LnN1Y2Nlc3MpIHtcclxuICAgICAgd2hpbGUgKGkgPD0gaGlnaEkgJiYgIXJlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgICAgaSsrXHJcbiAgICAgICAgcmVzdWx0ID0gUmVjdENsaXBMaW5lczY0LmdldExvY2F0aW9uKHRoaXMucmVjdCwgcGF0aFtpXSlcclxuICAgICAgICBwcmV2ID0gcmVzdWx0LmxvY1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChpID4gaGlnaEkpIHtcclxuICAgICAgICBmb3IgKGNvbnN0IHB0IG9mIHBhdGgpIHRoaXMuYWRkKHB0KTtcclxuICAgICAgfVxyXG4gICAgICBpZiAocHJldiA9PSBMb2NhdGlvbi5pbnNpZGUpIGxvYyA9IExvY2F0aW9uLmluc2lkZTtcclxuICAgICAgaSA9IDE7XHJcbiAgICB9XHJcbiAgICBpZiAobG9jID09IExvY2F0aW9uLmluc2lkZSkgdGhpcy5hZGQocGF0aFswXSk7XHJcblxyXG4gICAgd2hpbGUgKGkgPD0gaGlnaEkpIHtcclxuICAgICAgcHJldiA9IGxvYztcclxuICAgICAgdGhpcy5nZXROZXh0TG9jYXRpb24ocGF0aCwgeyBsb2MsIGksIGhpZ2hJIH0pO1xyXG5cclxuICAgICAgaWYgKGkgPiBoaWdoSSkgYnJlYWs7XHJcblxyXG4gICAgICBjb25zdCBwcmV2UHQ6IElQb2ludDY0ID0gcGF0aFtpIC0gMV07XHJcbiAgICAgIGxldCBjcm9zc2luZ0xvYzogTG9jYXRpb24gPSBsb2M7XHJcblxyXG4gICAgICBsZXQgcmVzdWx0ID0gUmVjdENsaXBMaW5lczY0LmdldEludGVyc2VjdGlvbih0aGlzLnJlY3RQYXRoLCBwYXRoW2ldLCBwcmV2UHQsIGNyb3NzaW5nTG9jKVxyXG4gICAgICBjb25zdCBpcDogSVBvaW50NjQgPSByZXN1bHQuaXBcclxuICAgICAgY3Jvc3NpbmdMb2MgPSByZXN1bHQubG9jXHJcblxyXG4gICAgICBpZiAoIXJlc3VsdC5zdWNjZXNzKSB7XHJcbiAgICAgICAgaSsrO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAobG9jID09IExvY2F0aW9uLmluc2lkZSkge1xyXG4gICAgICAgIHRoaXMuYWRkKGlwLCB0cnVlKTtcclxuICAgICAgfSBlbHNlIGlmIChwcmV2ICE9PSBMb2NhdGlvbi5pbnNpZGUpIHtcclxuICAgICAgICBjcm9zc2luZ0xvYyA9IHByZXY7XHJcblxyXG4gICAgICAgIHJlc3VsdCA9IFJlY3RDbGlwTGluZXM2NC5nZXRJbnRlcnNlY3Rpb24odGhpcy5yZWN0UGF0aCwgcHJldlB0LCBwYXRoW2ldLCBjcm9zc2luZ0xvYyk7XHJcbiAgICAgICAgY29uc3QgaXAyOiBJUG9pbnQ2NCA9IHJlc3VsdC5pcFxyXG4gICAgICAgIGNyb3NzaW5nTG9jID0gcmVzdWx0LmxvY1xyXG5cclxuICAgICAgICB0aGlzLmFkZChpcDIpO1xyXG4gICAgICAgIHRoaXMuYWRkKGlwKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLmFkZChpcCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcbn1cclxuIl19