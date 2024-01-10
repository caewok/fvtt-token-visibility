[![Version (latest)](https://img.shields.io/github/v/release/caewok/fvtt-token-visibility)](https://github.com/caewok/fvtt-token-visibility/releases/latest)
[![Foundry Version](https://img.shields.io/badge/dynamic/json.svg?url=https://github.com/caewok/fvtt-token-visibility/releases/latest/download/module.json&label=Foundry%20Version&query=$.minimumCoreVersion&colorB=blueviolet)](https://github.com/caewok/fvtt-token-visibility/releases/latest)
[![License](https://img.shields.io/github/license/caewok/fvtt-token-visibility)](LICENSE)

![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https://forge-vtt.com/api/bazaar/package/tokenvisibility&colorB=4aa94a)
![Latest Release Download Count](https://img.shields.io/github/downloads/caewok/fvtt-token-visibility/latest/module.zip)
![All Downloads](https://img.shields.io/github/downloads/caewok/fvtt-token-visibility/total)


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
Settings relevant to calculating range between the viewer and target.

<img width="699" alt="ATV Settings - Range" src="https://github.com/caewok/fvtt-token-visibility/assets/1267134/5538be90-0466-499c-ac7b-24bd2f7e4cff">

Options are provided to adjust how many points are tested when calculating range. The viewer center point is always used, and if any point on the target is within range, the target will be considered within range. Note that the difference in performance between these options is negligible, and so you should select whatever makes sense in your campaign setting.

## Other
Other settings that affect the line-of-sight calculation.

<img width="699" alt="ATV Settings - Other" src="https://github.com/caewok/fvtt-token-visibility/assets/1267134/8cbc98d8-9dc7-4e67-b5d1-d23c0e6c2c9f">

Optionally, you can have live or dead tokens block vision. Prone tokens can also optionally block vision. For these settings to work, you must tell ATV what the prone status is for your system, and where to find the hit points attribute. (It is assumed that 0 or below means "dead" for purposes of defining dead tokens.) 

The vision height multiplier allows you to change the height at which a viewing token observes the scene. Think of this as the height of the eyes of the token above the ground, as a percentage of the total token height.

# Performance

You can test performance on a given scene by running the following code in the console. This will test whether the tokens in the scene can see every other token in the scene for a variety of settings. If you control one or more tokens, those will be treated as the viewing tokens. Targeting one or more tokens will test those targets against the viewing tokens.

```js
api = game.modules.get('tokenvisibility').api;
N = 100; // Change if you want more iterations.
api.bench.benchAll(N)
```

# API

Various methods and classes are exposed at `game.modules.get('tokenvisibility').api`. These may change over time as this module evolves.

Feel free to message me in Discord if you have questions about specific methods.
