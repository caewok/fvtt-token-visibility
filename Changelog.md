## 0.6.1
Improve compatibility between ATV and ATC.
Fix for welcome dialog not going away. Closes issue #75.
Fix for case sensitive import failing. Closes issue #73.
Update lib geometry to v0.2.13.

## 0.6.0
Split Alternative Token Visibility from Alternative Token Cover. This module handles token visibility only. All cover-related features moveed to Alternative Token Cover.

Refactor the settings menu. Split viewer from target settings. Add two and three-point settings. Allow multiple viewer points to be used with Area2d and Area3d. Handle tile transparency with Area3d algorithm. A lot of backend work on patches and visibility calculator.

## 0.5.8
- Correctly ignore tokens if the token cover settings do not consider tokens to be cover. Closes issue #58.

## 0.5.7
- Fix for midiqol workflow not triggering.
- Fix for some "id not found" errors when deleting active effects.

## 0.5.6
- Fix for Levels incompatibility error on startup. Closes issue #54.

## 0.5.5
- Slightly inset the token shape to avoid triggering cover when the cover line hits only the exact corner of a token square. Closes issue #49.
- Fix typo in `module.json` that prevented Starfinder cover items from loading. Closes issue #53.
- Add checks for when `actor.statuses` is undefined. Closes issue #52.
- Fix occasional error when tokens have limited angle vision. Closes issue #48.
- Update geometry lib to v0.2.9.

## 0.5.4
- Fixes to how cover status data id is handled. Switch from label to name to accommodate Foundry change. Migrate old cover status data objects.
- Better tests to prevent multiple cover statuses on a single token.
- Improve compatibility with DFred's Convenient Effects. Use DFred's total cover status.
- Added a CoverDialog class to handle various user dialogs.
- Change cover macros to only accept a single token from which to test cover, for simplicity.
- Add setting to use or ignore token for cover when token is prone. Closes issue #46.
- Add workflow option to notify user of cover calculations, and allow the user confirm/cancel only. Closes issue #45. Allow workflow to be used with dnd5e even without midiqol (workflow triggered on item attack roll).
- Add LOS option to use corners-->corners to measure token visibility. Closes issue #44.
- Added support for Starfinder RPG. Cover is added using items from the Compendium. Items with the flag `tokenvisibility.cover` are assumed to be cover, and the item folder for the system is checked before pulling from the compendium. Closes issue #43.
- Update geometry lib to v0.2.7.

## 0.5.3
Fix the possibly borked v0.5.1 and v0.5.2. (Amazing what a stray ";" can do!)

## 0.5.2
Update geometry lib to v0.2.2.

## 0.5.1
Update geometry lib to v0.2.1. Handle token prone and token height using geometry lib elevation getters.

## 0.5.0
Updated for Foundry v11. Update geometry lib to v0.2.0.

## 0.4.6
- Fix how token height was calculated in some situations.

## 0.4.5
- Fix for issue #40 (error with Area2d).
- Fix for issue #39 (failure to detect token cover using center to center in PF2e)

## 0.4.4
- Update to lib geometry v0.1.5.
- Possible fix for issue #33 (null error reading "length").
- Keep the high cover setting even when using DFred's (closes issue #31).
- Add setting for dnd5e 1/2 cover for tokens. Tokens in this setting will not contribute to cover, except that if tokens block they cause 1/2 cover at minimum. For area3d, token must block ≥ low cover area. Closes issue #30.
- Add setting to set token heights to half if the token is prone. Works for either live or dead tokens. The dead tokens are half-height setting is removed in favor of using prone status. This simplifies code dealing with half-height tokens.
- Fix for Area3d algorithm when testing a wall that does not reach the height of the token.
- Add changelog dialog on first load.

## 0.4.3
Update to lib geometry v0.1.4.

## 0.4.2
Update to lib geometry v0.1.3.

## 0.4.1
Area2d algorithm improvements:
- Fix area calculation when token shape is split in half by a wall
- Handle holes in the area calculation

Area3d algorithm improvements:
- Fix some errors in `constructFromWall` thrown when using Levels.
- Possible fix for issue #33 (getting length from null object in `Area3d.visionPolygon`).

## 0.4.0
Partial re-write of how the Area3d algorithm works, to better handle objects adjacent to the target. Might be a bit faster in some situations, as it devotes more effort to removing unneeded walls earlier.

Additional fixes for measuring cover using 2d area calculation when tokens block (#27).
Improvements to the 3d wall-intersection test (issues #24 and #25).
Better handling of terrain walls when they intersect a token shape for area3d.
Incorporate changes to improve Perfect Vision compatibility (thanks @dev7355608!) (issues #9, #17, #18).
Potential fix for `constrainedTokenBorder.toPolygon` error (issues #4 and #28).

## 0.3.8
Add token shapes to the 3d area calculation (issue #27)
Fixes for measuring cover using the 2d area calculation when tokens block.

## 0.3.7
Use a shared geometry submodule (issue #20).
Fix conflict with Force Client Settings (issue #23).
Fix for Dfred's cover getting applied repeatedly on the same token (issue #26).

## 0.3.6
Compatibility with DFred's Convenient Effects -- uses DFred 1/2 and 3/4 cover when that module is active. (Closes issue #12.)

## 0.3.5
Compatibility with Levels v3.5.7 (Fixes issues #19 and 13).
Light sources that grant visibility now respect the points algorithm setting for LOS. Fixes issue #16.
Catch when the range is less or equal to zero for testing visibility. Fixes issue #15 and aligns with [Foundry issue #8505](https://github.com/foundryvtt/foundryvtt/issues/8505).

## 0.3.4
Reset the settings cache when changing a setting value. Also fixes the welcome pop-up to avoid it repeating.

## 0.3.3
- Change name of property to token.ignoresCoverType to avoid naming conflict with Simbul's Cover Calculator. Fixes issue #11.
- Check if tests exist for testing range visibility. Possible fix to issue #10.
- Catch when spell sniper or sharpshooter flags don't exist, to avoid an error being thrown.

## 0.3.2
Use different technique to hide settings submenus when different algorithms are chosen, which should reduce weirdness in the settings menu.

Fix error when getting average token elevation.

Use an IgnoreCover class that can be different for different systems, and split ignoring cover into all, mwak, msak, rwak, and rsak. Allows for Spell Sniper and Sharpshooter designations using midi. Closes issue #8.

Add handling of limited angle vision for Area3d algorithm (closes issue #4).

## 0.3.1
Fix issue #7 (Welcome message).

## 0.3.0

*New Features*
- Use "move" wall restriction for cover, which more closely corresponds to typical physics for cover. Note that limited move walls (terrain walls) are possible, which would provide cover beyond the first wall.
- Consider tiles for visibility and cover if Levels module is active.
  - For Points or Area2d algorithms, transparent tile pixels are ignored.
  - For Area3d algorithm, drawings can be used to create holes in tiles. See Drawing config to set an ellipse, polygon, or rectangle as a hole.
- Add ability for tokens to ignore cover. (Closes issue #3.)
  - DND5e: Add an actor special feat menu to ignore certain levels of cover. This is the same as, and compatible with, Simbul's Cover Calculator. The flag `dnd5e.helpersIgnoreCover` stores this value.
  - Non-DND5e: Adds a flag, `tokenvisibility.ignoreCover`
  - Can set whether a token ignores cover using the `token.ignoresCover` property.
- Add "Cover Debug Tester" macro that turns on visualization of the cover algorithm.
- Add setting to count live tokens as cover
- Add setting to count dead tokens as cover or count half the height of dead tokens as cover. (Closes issue #2.)

*Bug Fixes*
- Fix for area algorithms where viewer and target tokens overlap.
- Improved handling of visibility and cover when Levels is active.
- Address issue #6 (warning message re los mapping)
- Possible fix for issue #5 (wall is over the tokens)
- Possible fix for issue #4 (tokens visible beyond LOS range)
- Improved handling of terrain walls for Area3d algorithm.

*Code improvements*
- Refactor the 3d points representation for Foundry tokens, tiles, drawings, walls.
- Add handling for terrain walls for Area3d algorithm.
- Add handling for tiles for Area3d algorithm.
- Add handling for tokens for Area3d algorithm.
- Add settings for using tokens (live or dead) for cover (all algorithms).
- Add tile handling for cover points algorithms. Transparent tile pixels do not provide cover, as expected for Levels holes.
- Improved handling of perspective transform for different Foundry objects.
- Cache the LOS value for a given point as is done in base Foundry.
- Cache settings

## 0.2.1
Fix for `_hasLOS` not initialized error, which occurs sometimes with Levels installed.

## 0.2.0
Revamp Range settings:
- Choice of single point, 5 points, or 9 points (Foundry default)
- Toggle to add additional "3d" points to measure token height and token elevation
- Toggle to perform 3d range distance measurements

Revamp Line-of-sight settings:
- Choice of points (same as number of range points), area2d, or area3d.
- For area2d and area3d, select percentage area that counts for visible
- New area3d measures based on the token ("viewer") perspective, looking directly at the target in 3d space

Add Cover calculations with settings:
- Customizable low, medium, high cover active effects and names.
- Status conditions for low, medium, high cover for those effects.
- Various options on calculating cover based on token or target corners or centers.
- Options to use the same area2d or area3d algorithms used by LOS.
- Toggle to display cover results to chat when targeting tokens for an attack.
- Options for handling cover check with midiqol.

Fixes to improve compatibility with Perfect Vision and Levels.

## 0.1.3
Fix issue #1 (Area vision failing when area === 0).

## 0.1.2
Updates for compatibility with Foundry v10.286.

## 0.1.1
Update name to better distinguish from core Foundry functionality.

## 0.1
Initial release.

Calculate token visibility using actual token boundaries.
Settings to test visibility by percent area and to adjust the boundary size used for visibility.

Add API methods to allow testing for cover and testing for visibility.

## 0.0.1-alpha1
Initial release for testing.
