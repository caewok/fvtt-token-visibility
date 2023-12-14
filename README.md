[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-token-visibility)](https://github.com/caewok/fvtt-token-visibility/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-token-visibility/releases/latest/download/module.json&label=Foundry%20Version&query=$.compatibleCoreVersion&colorB=blueviolet)](https://github.com/caewok/fvtt-token-visibility/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-token-visibility)](LICENSE)

# Alternative Token Visibility
This module provides options to modify Foundry's default methods for measuring visibility range and line-of-sight between tokens. Some options are more performant, while others trade some performance for a more precise method of computing visibility. Alt Token Visibility is particularly useful when dealing with token elevations, elevated tiles, and walls with limited heights or depth.

Line-of-Sight Algorithm choices:
- Points. Test whether a 3d ray from a point on the viewer token to a point on the target token is blocked by an obstacle. Multiple points on the target can be tested to determine whether a threshold percentage of rays is met for visibility. For overhead tiles, considers them to block unless the ray passes through a transparent portion of the tile.
- Area2d. Test the percentage of the overhead view of a target token that is viewable from the perspective of a point on the viewer token. For overhead tiles, does not consider transparency.
- Area3d. Test the percentage of the 3d view of a target token that is viewable from the perspective of a point on the viewer token. For overhead tiles, uses webGL to test transparency.

Major features:
- Choose whether one or more points on the viewing target are tested for line-of-sight, with the best result taken. Options include a "stereo" version that uses two points on the front facing side of the token.
- Change the number of points used to determine range.
- Adjust viewer and target line-of-sight point locations, shifting from the token border to the center.
- Account for wall height (using the [Wall Height](https://github.com/theripper93/wall-height) module) and overhead tiles.
- Adjust the vision height for tokens and prone tokens.
- Debugging mode to visualize the line-of-sight and range.
- Optionally have live, dead, or prone tokens block line-of-sight.

As of v0.6.0, all features related to cover calculations have been split off to a new module, [Alternative Token Cover](https://github.com/caewok/fvtt-token-cover).

# Installation
Add this [Manifest URL](https://github.com/caewok/fvtt-token-visibility/releases/latest/download/module.json) in Foundry to install.

# Dependencies
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)
- [socketlib](https://github.com/manuelVo/foundryvtt-socketlib)

# Recommended module additions
- [Wall Height](https://github.com/theripper93/wall-height). Not only does Wall Height provide the ability to set elevation for wall tops and bottoms, it also gives tokens height based on their size. The Area3d option for Alt Token Visibility takes full advantage of token height.
- [Elevated Vision](https://github.com/caewok/fvtt-elevated-vision). Can assist with setting terrain and token elevations.
- [Token Lean](https://github.com/WesBelmont/token-lean). Useful when you want players to be able to "peer" over limited-height walls.

## Levels
Token Visibility is intended to work with the [Levels](https://github.com/theripper93/Levels) module. Both the Points and the Area3d algorithms will ignore transparent portions of tiles as expected in Levels. The Area2d algorithm treats overhead tiles as blocking regardless of transparency and thus may not work in all cases with Levels. 

# Token Height
Token height, for purposes of measuring vision, can be changed using the [Wall Height](https://github.com/theripper93/wall-height) module. Token height is otherwise set based on scale of the token—namely,the number of grid squares it occupies. 

Note that very large tokens can be quite tall, and may poke through an overhead tile. Depending on your settings, this may cause large tokens to be visible if a sufficient portion of the token is visible.

# Main Settings Menu
<img width="565" alt="ATV Settings - Main" src="https://github.com/caewok/fvtt-token-visibility/assets/1267134/adb0b1ff-9f99-4425-9ae5-771c2f03cfa5">

## Debug Range and Debug LOS
When enabled, these will visualize the range and line-of-sight algorithms on the canvas. Range is indicated by dots on the target tokens, red for out-of-range and green for in-range. For LOS Area3d, you must control a token and target another token to make a popout window appear that will show a 3d view from the perspective of the controlled token looking directly at the targeted token. (You might need to move the controlled token to force the popout to refresh.)

# ATV Settings Configuration Menu
Most of the relevant ATV module settings appear in a popout when you hit the "Configure" button in the main settings menu.

## Viewer Line-of-Sight
Settings relevant to the viewing token.
<img width="699" alt="ATV Settings - Viewer LOS" src="https://github.com/caewok/fvtt-token-visibility/assets/1267134/208d6aa6-b96c-4d10-b14f-f484f4cd1b3a">

The viewing points are the viewing token's "eyes." If more than one viewing point, the viewer will have line-of-sight to the target if at least one point would have line-of-sight. When more than one point is used, an "offset" allows you to determine how far each point lies on a line between the viewer center and the viewer border. If two points are used, they are set to the token's front-facing direction.

## Target Line-of-Sight
Settings relevant to the target token.
<img width="699" alt="ATV Settings - Target LOS" src="https://github.com/caewok/fvtt-token-visibility/assets/1267134/584a7715-e536-4b3d-92f3-5afae1314242">

## Percent Threshold
The percent threshold governs how much of a target token must be viewable for a viewing token to be considered to have line-of-sight to the target. For the Points algorithm, this is the percent of points that are visible on the target. For the Area2d and Area3d algorithms, this is the percent area visible compared to what the target area would be with no obstacles. Note that targets against a wall will have their token shape trimmed accordingly, so that they are not visible through the wall. 

### Large Token Subtargeting
If enabled, tokens larger than a grid square will be considered visible if at least one grid square's worth of the token is visible. For the Points algorithm, each grid square that the target occupies is tested separately as if it were a single token. For the Area2d and Area3d algorithms, the percentage area required is based on the size of a single grid square instead of the size of the entire target. The result is that tokens larger than a grid square can be more than 100% visible.

This setting is slightly less performant but very useful for larger tokens. For example, without large token subtargeting, 3 grid squares of a dragon could be visible and—depending on your percentage threshold setting—this may still be insufficient to "see" the dragon.

### Points Algorithm
The points algorithm tests whether a 3d ray from the viewing point to a point on the target token is blocked by an obstacle. As with the viewer, the offset determines how close each point is to the center of the target token. The percentage threshold determines how many visible points on the target are required for the viewer to be considered to have line-of-sight to the target. If 3d points are enabled, additional points at the top and bottom of the target token will be tested. 

### Area2d Algorithm
The Area2d algorithm tests how much of the overhead target token shape is visible. It usually is very performant, but less intuitive and less accurate than the Area3d algorithm. It treats all overhead tiles as opaque.

### Area3d Algorithm
The Area3d algorithm constructs a simplistic 3d model of the scene from the point of view of the viewing token looking toward the target token. It then measures the visible area of the 3d target. This can be faster than the Points algorithm in certain scenes. 

If overhead tiles are encountered within the viewing triangle, the Area3d algorithm switches to webGL to construct its 3d model. This allows it to take into account transparent portions of the overhead tile. The webGL is much slower, however, so it only uses it when necessary. (The slowdown is primarily because the webGL scene must be converted back into pixels that Javascript can then summarize to determine the viewable area.)

## Range
<img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/settings-range.jpg" width="400" alt="Range Settings for the Alt Token Visibility Module">

### Range Points
Base Foundry calculates token (and other object) visibility by considering 9 points arranged around the token: the center point plus 8 points spaced out in a rectangular shape.

<img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/token_dots.jpg" width="200" alt="9 red dots inside a large token square">

Range Points lets you change that number:
- Token center ony (1 point)
- Token corners and center (5 points)
- Foundry default (9 points)

Note that the LOS algorithm, "Points on Token," will test the number of points chosen here.

### Test Bottom and Top Token Points
The [Wall Height](https://github.com/theripper93/wall-height) module sets a token height based on the token size. If the token has a height, this option will mirror the points from the bottom of the token to the top of the token, and also add an exact center point. If the token does not have a height, this option is ignored.

### Measure Range Distance in 3d
If enabled, all range measurements will be in three dimensions. Meaning that, for example, a token flying at 35 feet may be unable to view a target at 0 feet if the token only has 30 feet of darkvision and the scene is dark.

## Line-of-sight (LOS)
<img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/settings-los.jpg" width="400" alt="LOS Settings for the Alt Token Visibility Module">

### Line of Sight Algorithm

By default, line-of-sight uses the "light" wall restriction when considering whether walls block. This is the same as default Foundry.

Line of Sight Algorithm lets you select from:
- Points on Token.
- Corners.
- Token Area
- Token Area 3d

Points on Token LOS uses the number of points set by the Range Points. If Range Points is set to 9, this would be the Foundry default.

Corners LOS Mimics the DND5e DMG line-of-sight test, measured from corner of the token to corner of the target. The target is visible if it would have less than High cover (usually, if one or more corners are visible). (For dnd5e, this is usually described as "Total" cover.) The percent setting for High cover will affect this LOS option.

#### Point on Token

By default, Foundry measures line-of-sight by drawing a line from the viewer to the 9 points on the target token. If at least one line is not obstructed, then the viewer has line-of-sight to the target.

https://user-images.githubusercontent.com/1267134/199608338-c869bc26-a987-4166-9199-be53d11b222d.mov

#### Token Area 2d

Token area works by intersecting the line-of-sight polygon for the viewer token with the 2d shape of the target token (overhead view). In the picture of the token above, this would be the area within the orange border of the token. As walls or wall shadows obscure more of the target token shape, less of its percentage area is viewable.

Note that if the target token is overlapping one or more walls, a "constrained" target shape is first constructed that approximates the portion of the target shape on the same side of the wall(s) as the center point of the target token. This prevents situations where a target token slightly overlapping a wall would otherwise be seen from the "wrong" side of the wall.

https://user-images.githubusercontent.com/1267134/199608374-d438f129-23c1-475a-941e-7e30f65ee67e.mov

#### Token Area 3d

Token area 3d constructs a view of the target from the perspective of the viewer token. It is basically equivalent to a first-person shooter view. The walls and the target token shape are then "flattened" in this 2d perspective. The target token area without any walls is compared to one with parts of the target token cut away where walls block.

As with Token Area 2d, the target token is trimmed if walls overlap the target.

This method is probably the most accurate way to determine if a token has visibility of another token, and should, in theory, work even in [Ripper's 3d Canvas](https://theripper93.com/).

https://user-images.githubusercontent.com/1267134/199608396-22c017fc-2c58-4f5e-ace0-898ede8aa6fd.mov

Here is another example with debug drawing on, to illustrate the token's viewing perspective. The token has limited angle vision, as seen by the blue shading, and there are two terrain walls, which cross each other, of different heights. The bright green is where the terrain walls cross and thus block vision. (The light green is only a single terrain wall and would not block vision.) The target in this case is the giant ape, displayed as a red box. The token is above the ground, but not above the giant ape. So it is looking down on the smaller terrain wall in front of it.

![Area3d Limited Angle Terrain Wall](https://user-images.githubusercontent.com/1267134/203361623-75e1e29f-0c7e-41e9-81ef-01ff67698328.jpg)

### Percent Token Area

For Area 2d and Area 3d, the GM can decide how much of the token must be viewable in order to be "visible." Usually, a low percentage—--say 10% or 20%—--works reasonably well.

The GM can change the percent area required for a token to be visibile, and change how large the token boundary appears for purposes of the visibility test.

Note that the area is calculated as a percentage based on the total area of the token that **could** be seen. Thus, if a token has an area of 100 but partially overlaps a wall such that 75% of the token rectangle is viewable, then the token only has an area of 75 for purposes of this calculation.

Setting the Percent Token Area to 1 means that the entire token area must be viewable for the token to be seen. Setting the Percent Token Area to 0 means that if any part of the token is viewable, then it is seen.

| <img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/visibility-area-100.jpg" width="300" alt="Settings for the Alt Token Visibility Module"> |
|:--:|
| <em>Area set to 1. Lizard only viewable once our wizard moves completely beyond the wall.<em> |

| <img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/visibility-area-50.jpg" width="300" alt="Settings for the Alt Token Visibility Module"> |
|:--:|
| <em>Area set to 0.5. Lizard viewable once our wizard can view half of it.</em> |

| <img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/visibility-area-10.jpg" width="300" alt="Settings for the Alt Token Visibility Module"> |
|:--:|
| <em>Area set to 0.1. Lizard viewable when nearly any of it can be seen beyond the wall.</em> |

## Cover

Cover is abstracted into three distinct levels: low, medium, and high. It is expected that these cover types are ordered, such that as a token becomes less viewable due to a portion of the token being behind an obstacle, the token goes from low --> medium --> high cover.

Settings allow the GM to define the precise limits for cover and the algorithm used. Use the active effet configuration settings to re-name the cover types and apply various active effects.

<img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/settings-cover.jpg" width="400" alt="Cover Settings for the Alt Token Visibility Module">

### Cover Algorithm

By default, cover algorithms uses the "move" wall restriction when considering whether walls block. This is intended to be consistent with how walls that would physically block movement are most likely to provide cover. Using the API, it is possible to change this for a given calculation. For example:

```js
api = game.modules.get('tokenvisibility').api;
calc = new api.CoverCalculator(token, target); // token and target are both Tokens you must define.
calc.config.type = "sound"  // "move", "light", "sound", "sight"
calc.targetCover()

```

Cover algorithm choices can be split into Points and Area.

Points algorithms draw lines from a point on the viewing token to a point on the targeting token. Either the center or the corner of the viewing token or targeting token can be used. In addition, for larger tokens, an option is available to use only one of the grid squares of the larger token. For this option, the square with the least cover is used.

Area algorithms use the Area 2d or Area 3d algorithms used by LOS, described above.

The following options are provided:
- Viewer center to target center (This is the PF2e default.)
- Viewer center to target corners
- Viewer corners to target corners
- Viewer center to corners of a select target square
- Viewer corners to corners of a select target square (This is the dnd5e DMG method.)
- Area 2d
- Area 3d

### Triggers

The GM can set the "trigger," representing the percent of the token that must not be visible in order to achieve the level of cover.

Center-to-center algorithm: As only one test is done using this algorithm, a single cover type must be selected by the GM.

Points-based algorithms: Percentage of lines blocked for a given grid square/hex test.

Area-based algorithm: Percentage of the token area that is obscured.

### Effects
<img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/settings-cover-effects.jpg" width="400" alt="Cover effects Settings for the Alt Token Visibility Module">

The GM can define the name of each cover level, provide an icon, and define active effects for each cover type. Default active effects are provided for dnd5e low (half) and medium (three-quarters) cover. Cover effects can be set as status conditions on a token.

For PF2e, status effects are not added as status conditions. PF2e already has cover effects and the GM is advised to use those.

### Combatant targeting applies cover

When enabled, this option applies cover status to targeted tokens during combat. During combat only, if the user that owns the current combatant targets a token, cover is measured and, when applicable, a cover status condition is added to the targeted token.

### Display cover in chat

For dnd5e, enabling this will use the dnd5e attack hook to display cover of targeted tokens in the chat, when an attack is initiated. Targeted tokens without cover are not included in the chat message, and so if no targeted tokens have cover, nothing will be output to chat.

### Dead tokens grant cover

The GM can choose whether dead tokens grant cover and whether to use half the height of the token or the full height. You will need to set the "Token HP Attribute" for your system.

### Live tokens grant cover

The GM can choose whether live tokens should be considered cover. If the "Token HP Attribute" is not set, all tokens will be considered cover if this is set.

### Token HP attribute

This tells Alternative Token Visibility where to find the HP value for a token in your system. The default for dnd5e is "system.attributes.hp.value." A token with 0 or less HP is considered "dead" for purposes of cover.

### Midiqol Attack Workflow

If [Midiqol](https://gitlab.com/tposney/midi-qol) is active, the GM can choose whether cover status conditions should be applied to targeted tokens. Statuses are applied after targeting occurs in the midiqol workflow. Options:

- Do not test for cover
- Ask user to confirm.
- Ask GM to confirm.
- Apply automatically

For the confirmation options, this pops up a list of targets with calculated covers. Cover types can then be changed by the user or GM, respectively.

## Ignoring Cover

A token can be set to ignore cover less than or equal to some amount. For example, a token set to ignore Medium cover (3/4 cover in DND5e) will also ignore Low cover (1/2 cover in DND5e). Tokens can be set to ignore cover for all attacks (all), or any of the following: melee weapon (mwak), ranged weapon (rwak), melee spell (msak), or ranged spell (rsak).

To set ignoring cover on a specific token, use, for example:
```js
api = game.modules.get('tokenvisibility').api;
cover_type = api.COVER_TYPES;

_token.ignoresCoverType.all = cover_type.LOW;
_token.ignoresCoverType.rwak = cover_type.MEDIUM;

rangedWeaponIgnored = _token.ignoresCoverType.rwak;
```

For linked actors, these values will be set on the actor.

In dnd5e, tokens can also be set to ignore cover for all attacks using the Special Traits token configuration menu.

For Midiqol workflows, the special flags for sharpshooter and spell sniper will be checked when using `_token.ignoresCoverType` and during the midi workflow if cover checking is enabled in the midiqol attack workflow setting, described above.

# Cover Macro

A compendium macro, "Measure Cover" is provided to allow users to easily measure cover. Select one or more tokens and target one or more tokens. Cover will be measured for each token --> target combination and the results reported in a pop-up.

<img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/settings-cover-macro.jpg" width="400" alt="Cover Macro for the Alt Token Visibility Module">

A second version of this macro, "Cover Debug Tester" temporarily enables the debug visibility so you can get a better sense of what the cover algorithm is detecting.

If a token is set to ignore cover, that information will be provided in the pop-up display. It is assumed the GM or user will than take that information into account as needed.

# Methodology
Base Foundry calculates token (and other object) visibility by considering 9 points arranged around the token: the center point plus 8 points spaced out in a rectangular shape.

<img src="https://raw.githubusercontent.com/caewok/fvtt-token-visibility/feature/screenshots/screenshots/token_dots.jpg" width="200" alt="9 red dots inside a large token square">

Alt Token Visibility instead considers the whole token shape—the orange outline in the above image.

# Performance

Depending on settings and scene layout, Alternative Token Visibility may be faster or slower than the default Foundry approach. (The default Foundry approach is already very fast, so the speed improvement, if any, is minimal.) It is usually slower.

Setting area = 0 tends to be a bit faster than other area settings. When area is set to less than or equal to 50%, calculations for visible tokens tend to be faster. When area is set to greater than 50%, calculations for non-visible tokens tend to be faster. When a token partially overlaps a wall, Alt Token Visibility must re-construct the visible shape, which is slow.

Area3d can be faster than Area2d, depending on settings and scene layout.

You can test performance on a given scene by selecting a token on the scene and running the following code in the console. This will test whether the selected token can see every other token in the scene, and will test cover, for a variety of settings.

```js
api = game.modules.get('tokenvisibility').api;
N = 100; // Change if you want more iterations.
api.bench.benchAll(N)
```

# API

Various methods and classes are exposed at `game.modules.get('tokenvisibility').api`. These may change over time as this module evolves.

Of interest:

- Benchmarking methods, at `api.bench`.
- Cover calculator class: `api.CoverCalculator`.
- Class to assist with ignoring cover:

```js
IgnoresCoverClasses: {
      IgnoresCover,
      IgnoresCoverDND5e,
      IgnoresCoverSimbuls
    },`
```
Each class has methods to set and return cover types to be ignored for all, mwak, msak, rwak, and rsak. The parent class is `IgnoresCover`. See `IgnoresCoverDND5e` for an example extension for system-specific values.

- Area2d and 3d classes: `api.Area2d` and `api.Area3d`
- Debug toggles. `api.debug.range`, `api.debug.los`, `api.debug.cover`. This will draw various indicators on the screen to help understand what a given algorithm is doing.

Feel free to message me in Discord if you have questions about specific methods.
