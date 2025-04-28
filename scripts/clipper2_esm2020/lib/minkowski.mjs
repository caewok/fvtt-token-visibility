/*******************************************************************************
* Author    :  Angus Johnson                                                   *
* Date      :  15 October 2022                                                 *
* Website   :  http://www.angusj.com                                           *
* Copyright :  Angus Johnson 2010-2022                                         *
* Purpose   :  Minkowski Sum and Difference                                    *
* License   :  http://www.boost.org/LICENSE_1_0.txt                            *
*******************************************************************************/
//
// Converted from C# implemention https://github.com/AngusJohnson/Clipper2/blob/main/CSharp/Clipper2Lib/Clipper.Core.cs
// Removed support for USINGZ
//
// Converted by ChatGPT 4 August 3 version https://help.openai.com/en/articles/6825453-chatgpt-release-notes
//
import { Clipper } from "./clipper.mjs";
import { FillRule } from "./core.mjs";
export class Minkowski {
    static minkowskiInternal(pattern, path, isSum, isClosed) {
        const delta = isClosed ? 0 : 1;
        const patLen = pattern.length;
        const pathLen = path.length;
        const tmp = [];
        for (const pathPt of path) {
            const path2 = [];
            if (isSum) {
                for (const basePt of pattern)
                    path2.push({ x: pathPt.x + basePt.x, y: pathPt.y + basePt.y });
            }
            else {
                for (const basePt of pattern)
                    path2.push({ x: pathPt.x - basePt.x, y: pathPt.y - basePt.y });
            }
            tmp.push(path2);
        }
        const result = [];
        let g = isClosed ? pathLen - 1 : 0;
        let h = patLen - 1;
        for (let i = delta; i < pathLen; i++) {
            for (let j = 0; j < patLen; j++) {
                const quad = [tmp[g][h], tmp[i][h], tmp[i][j], tmp[g][j]];
                if (!Clipper.isPositive(quad))
                    result.push(Clipper.reversePath(quad));
                else
                    result.push(quad);
                h = j;
            }
            g = i;
        }
        return result;
    }
    static sum(pattern, path, isClosed) {
        return Clipper.Union(this.minkowskiInternal(pattern, path, true, isClosed), undefined, FillRule.NonZero);
    }
    static diff(pattern, path, isClosed) {
        return Clipper.Union(this.minkowskiInternal(pattern, path, false, isClosed), undefined, FillRule.NonZero);
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWlua293c2tpLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vcHJvamVjdHMvY2xpcHBlcjItanMvc3JjL2xpYi9taW5rb3dza2kudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7Ozs7Ozs7Z0ZBT2dGO0FBRWhGLEVBQUU7QUFDRix1SEFBdUg7QUFDdkgsNkJBQTZCO0FBQzdCLEVBQUU7QUFDRiw0R0FBNEc7QUFDNUcsRUFBRTtBQUVGLE9BQU8sRUFBRSxPQUFPLEVBQUUsTUFBTSxXQUFXLENBQUM7QUFDcEMsT0FBTyxFQUFFLFFBQVEsRUFBNkIsTUFBTSxRQUFRLENBQUM7QUFHN0QsTUFBTSxPQUFPLFNBQVM7SUFDWixNQUFNLENBQUMsaUJBQWlCLENBQUMsT0FBZSxFQUFFLElBQVksRUFBRSxLQUFjLEVBQUUsUUFBaUI7UUFDL0YsTUFBTSxLQUFLLEdBQUcsUUFBUSxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQztRQUMvQixNQUFNLE1BQU0sR0FBRyxPQUFPLENBQUMsTUFBTSxDQUFDO1FBQzlCLE1BQU0sT0FBTyxHQUFHLElBQUksQ0FBQyxNQUFNLENBQUM7UUFDNUIsTUFBTSxHQUFHLEdBQTJCLEVBQUUsQ0FBQTtRQUV0QyxLQUFLLE1BQU0sTUFBTSxJQUFJLElBQUksRUFBRTtZQUN6QixNQUFNLEtBQUssR0FBb0IsRUFBRSxDQUFBO1lBQ2pDLElBQUksS0FBSyxFQUFFO2dCQUNULEtBQUssTUFBTSxNQUFNLElBQUksT0FBTztvQkFDMUIsS0FBSyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsRUFBRSxNQUFNLENBQUMsQ0FBQyxHQUFHLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxDQUFDLEdBQUcsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLENBQUM7YUFDbEU7aUJBQU07Z0JBQ0wsS0FBSyxNQUFNLE1BQU0sSUFBSSxPQUFPO29CQUMxQixLQUFLLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxDQUFDLEdBQUcsTUFBTSxDQUFDLENBQUMsRUFBRSxDQUFDLEVBQUUsTUFBTSxDQUFDLENBQUMsR0FBRyxNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQzthQUNsRTtZQUNELEdBQUcsQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFDLENBQUM7U0FDakI7UUFFRCxNQUFNLE1BQU0sR0FBMkIsRUFBRSxDQUFBO1FBQ3pDLElBQUksQ0FBQyxHQUFHLFFBQVEsQ0FBQyxDQUFDLENBQUMsT0FBTyxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO1FBRW5DLElBQUksQ0FBQyxHQUFHLE1BQU0sR0FBRyxDQUFDLENBQUM7UUFDbkIsS0FBSyxJQUFJLENBQUMsR0FBRyxLQUFLLEVBQUUsQ0FBQyxHQUFHLE9BQU8sRUFBRSxDQUFDLEVBQUUsRUFBRTtZQUNwQyxLQUFLLElBQUksQ0FBQyxHQUFHLENBQUMsRUFBRSxDQUFDLEdBQUcsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFFO2dCQUMvQixNQUFNLElBQUksR0FBVyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsRUFBRSxHQUFHLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLEVBQUUsR0FBRyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxFQUFFLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDO2dCQUNsRSxJQUFJLENBQUMsT0FBTyxDQUFDLFVBQVUsQ0FBQyxJQUFJLENBQUM7b0JBQzNCLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBTyxDQUFDLFdBQVcsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFDOztvQkFFdkMsTUFBTSxDQUFDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztnQkFDcEIsQ0FBQyxHQUFHLENBQUMsQ0FBQzthQUNQO1lBQ0QsQ0FBQyxHQUFHLENBQUMsQ0FBQztTQUNQO1FBQ0QsT0FBTyxNQUFNLENBQUM7SUFDaEIsQ0FBQztJQUVNLE1BQU0sQ0FBQyxHQUFHLENBQUMsT0FBZSxFQUFFLElBQVksRUFBRSxRQUFpQjtRQUNoRSxPQUFPLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDM0csQ0FBQztJQUVNLE1BQU0sQ0FBQyxJQUFJLENBQUMsT0FBZSxFQUFFLElBQVksRUFBRSxRQUFpQjtRQUNqRSxPQUFPLE9BQU8sQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLGlCQUFpQixDQUFDLE9BQU8sRUFBRSxJQUFJLEVBQUUsS0FBSyxFQUFFLFFBQVEsQ0FBQyxFQUFFLFNBQVMsRUFBRSxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUM7SUFDNUcsQ0FBQztDQUVGIiwic291cmNlc0NvbnRlbnQiOlsiLyoqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKipcclxuKiBBdXRob3IgICAgOiAgQW5ndXMgSm9obnNvbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICpcclxuKiBEYXRlICAgICAgOiAgMTUgT2N0b2JlciAyMDIyICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICpcclxuKiBXZWJzaXRlICAgOiAgaHR0cDovL3d3dy5hbmd1c2ouY29tICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICpcclxuKiBDb3B5cmlnaHQgOiAgQW5ndXMgSm9obnNvbiAyMDEwLTIwMjIgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICpcclxuKiBQdXJwb3NlICAgOiAgTWlua293c2tpIFN1bSBhbmQgRGlmZmVyZW5jZSAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICpcclxuKiBMaWNlbnNlICAgOiAgaHR0cDovL3d3dy5ib29zdC5vcmcvTElDRU5TRV8xXzAudHh0ICAgICAgICAgICAgICAgICAgICAgICAgICAgICpcclxuKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKioqKi9cclxuXHJcbi8vXHJcbi8vIENvbnZlcnRlZCBmcm9tIEMjIGltcGxlbWVudGlvbiBodHRwczovL2dpdGh1Yi5jb20vQW5ndXNKb2huc29uL0NsaXBwZXIyL2Jsb2IvbWFpbi9DU2hhcnAvQ2xpcHBlcjJMaWIvQ2xpcHBlci5Db3JlLmNzXHJcbi8vIFJlbW92ZWQgc3VwcG9ydCBmb3IgVVNJTkdaXHJcbi8vXHJcbi8vIENvbnZlcnRlZCBieSBDaGF0R1BUIDQgQXVndXN0IDMgdmVyc2lvbiBodHRwczovL2hlbHAub3BlbmFpLmNvbS9lbi9hcnRpY2xlcy82ODI1NDUzLWNoYXRncHQtcmVsZWFzZS1ub3Rlc1xyXG4vL1xyXG5cclxuaW1wb3J0IHsgQ2xpcHBlciB9IGZyb20gXCIuL2NsaXBwZXJcIjtcclxuaW1wb3J0IHsgRmlsbFJ1bGUsIElQb2ludDY0LCBQYXRoNjQsIFBhdGhzNjQgfSBmcm9tIFwiLi9jb3JlXCI7XHJcblxyXG5cclxuZXhwb3J0IGNsYXNzIE1pbmtvd3NraSB7XHJcbiAgcHJpdmF0ZSBzdGF0aWMgbWlua293c2tpSW50ZXJuYWwocGF0dGVybjogUGF0aDY0LCBwYXRoOiBQYXRoNjQsIGlzU3VtOiBib29sZWFuLCBpc0Nsb3NlZDogYm9vbGVhbik6IFBhdGhzNjQge1xyXG4gICAgY29uc3QgZGVsdGEgPSBpc0Nsb3NlZCA/IDAgOiAxO1xyXG4gICAgY29uc3QgcGF0TGVuID0gcGF0dGVybi5sZW5ndGg7XHJcbiAgICBjb25zdCBwYXRoTGVuID0gcGF0aC5sZW5ndGg7XHJcbiAgICBjb25zdCB0bXA6IEFycmF5PEFycmF5PElQb2ludDY0Pj4gPSBbXVxyXG5cclxuICAgIGZvciAoY29uc3QgcGF0aFB0IG9mIHBhdGgpIHtcclxuICAgICAgY29uc3QgcGF0aDI6IEFycmF5PElQb2ludDY0PiA9IFtdXHJcbiAgICAgIGlmIChpc1N1bSkge1xyXG4gICAgICAgIGZvciAoY29uc3QgYmFzZVB0IG9mIHBhdHRlcm4pXHJcbiAgICAgICAgICBwYXRoMi5wdXNoKHsgeDogcGF0aFB0LnggKyBiYXNlUHQueCwgeTogcGF0aFB0LnkgKyBiYXNlUHQueSB9KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBmb3IgKGNvbnN0IGJhc2VQdCBvZiBwYXR0ZXJuKVxyXG4gICAgICAgICAgcGF0aDIucHVzaCh7IHg6IHBhdGhQdC54IC0gYmFzZVB0LngsIHk6IHBhdGhQdC55IC0gYmFzZVB0LnkgfSk7XHJcbiAgICAgIH1cclxuICAgICAgdG1wLnB1c2gocGF0aDIpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJlc3VsdDogQXJyYXk8QXJyYXk8SVBvaW50NjQ+PiA9IFtdXHJcbiAgICBsZXQgZyA9IGlzQ2xvc2VkID8gcGF0aExlbiAtIDEgOiAwO1xyXG5cclxuICAgIGxldCBoID0gcGF0TGVuIC0gMTtcclxuICAgIGZvciAobGV0IGkgPSBkZWx0YTsgaSA8IHBhdGhMZW47IGkrKykge1xyXG4gICAgICBmb3IgKGxldCBqID0gMDsgaiA8IHBhdExlbjsgaisrKSB7XHJcbiAgICAgICAgY29uc3QgcXVhZDogUGF0aDY0ID0gW3RtcFtnXVtoXSwgdG1wW2ldW2hdLCB0bXBbaV1bal0sIHRtcFtnXVtqXV07XHJcbiAgICAgICAgaWYgKCFDbGlwcGVyLmlzUG9zaXRpdmUocXVhZCkpXHJcbiAgICAgICAgICByZXN1bHQucHVzaChDbGlwcGVyLnJldmVyc2VQYXRoKHF1YWQpKTtcclxuICAgICAgICBlbHNlXHJcbiAgICAgICAgICByZXN1bHQucHVzaChxdWFkKTtcclxuICAgICAgICBoID0gajtcclxuICAgICAgfVxyXG4gICAgICBnID0gaTtcclxuICAgIH1cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG5cclxuICBwdWJsaWMgc3RhdGljIHN1bShwYXR0ZXJuOiBQYXRoNjQsIHBhdGg6IFBhdGg2NCwgaXNDbG9zZWQ6IGJvb2xlYW4pOiBQYXRoczY0IHtcclxuICAgIHJldHVybiBDbGlwcGVyLlVuaW9uKHRoaXMubWlua293c2tpSW50ZXJuYWwocGF0dGVybiwgcGF0aCwgdHJ1ZSwgaXNDbG9zZWQpLCB1bmRlZmluZWQsIEZpbGxSdWxlLk5vblplcm8pO1xyXG4gIH1cclxuXHJcbiAgcHVibGljIHN0YXRpYyBkaWZmKHBhdHRlcm46IFBhdGg2NCwgcGF0aDogUGF0aDY0LCBpc0Nsb3NlZDogYm9vbGVhbik6IFBhdGhzNjQge1xyXG4gICAgcmV0dXJuIENsaXBwZXIuVW5pb24odGhpcy5taW5rb3dza2lJbnRlcm5hbChwYXR0ZXJuLCBwYXRoLCBmYWxzZSwgaXNDbG9zZWQpLCB1bmRlZmluZWQsIEZpbGxSdWxlLk5vblplcm8pO1xyXG4gIH1cclxuXHJcbn1cclxuIl19